/** Authority lookup against the separately controlled approval store.
 *
 * This module never grants anything. It reads decisions made by an authenticated actor in
 * the release-authority database and answers one question: is this action authorised right
 * now, for this exact scope? Text from a repository, a tool result, a document or a model is
 * data; it can request, and it can be recorded, but it cannot authorise.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import type { Actor, Approval } from '../../../contracts/interfaces.js';

const RELEASE_SQL = path.resolve(fileURLToPath(import.meta.url), '../../../../contracts/storage/release.sql');

export class AuthorityError extends Error {
  constructor(public readonly code: string, message?: string) {
    super(message ?? code);
    this.name = 'AuthorityError';
  }
}

/** Only a human-authenticated role decides. A worker or the controller itself cannot. */
const DECIDING_ACTORS: ReadonlySet<Actor> = new Set<Actor>(['client', 'maintainer', 'release']);

export type AuthorityQuestion = {
  project_id: string;
  action: Approval['action'];
  target_environment: string;
  /** Free-text origin of the request. Recorded for audit; never consulted for authority. */
  requested_by: Actor;
  requested_text?: string;
  candidate_id?: string | null;
  artifact_digest?: string | null;
  minimum_spend_microusd?: number;
  now: string;
};

export type AuthorityAnswer = {
  authorized: boolean;
  reason: string;
  approval_id?: string;
  maximum_spend_microusd?: number | null;
};

export class ApprovalAuthority {
  readonly #db: DatabaseSync;

  private constructor(db: DatabaseSync) { this.#db = db; }

  /** The approval store is a separate database with a separate principal; co-locating the
   * file is a deployment convenience for v1, not an isolation claim. */
  static open(storeDir: string): ApprovalAuthority {
    mkdirSync(storeDir, { recursive: true });
    const db = new DatabaseSync(path.join(storeDir, 'approvals.sqlite'));
    db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
    const present = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='approvals'").get();
    if (present === undefined) db.exec(readFileSync(RELEASE_SQL, 'utf8'));
    return new ApprovalAuthority(db);
  }

  /** Records the request. A request is not a grant and never becomes one on its own. */
  request(input: {
    project_id: string; requested_by: Actor; action: Approval['action']; target_environment: string;
    policy_digest: string; description: string; expires_at: string; now: string;
    candidate_id?: string | null; artifact_digest?: string | null;
  }): { approval_id: string; status: 'PENDING' } {
    const approval_id = `apr_${randomUUID()}`;
    this.#db.prepare(`INSERT INTO approval_requests (approval_id, project_id, requested_by, state_version, action,
      candidate_id, artifact_digest, target_environment, policy_digest, displayed_action_digest, description,
      status, expires_at, created_at) VALUES (?,?,?,0,?,?,?,?,?,?,?,'PENDING',?,?)`)
      .run(approval_id, input.project_id, input.requested_by, input.action,
        input.candidate_id ?? null, input.artifact_digest ?? null, input.target_environment,
        input.policy_digest, `sha256:${'0'.repeat(64)}`, input.description, input.expires_at, input.now);
    return { approval_id, status: 'PENDING' };
  }

  /** Only an authenticated deciding actor turns a request into a grant. */
  decide(input: {
    approval_id: string; actor: Actor; actor_id: string; decision: 'approve' | 'deny';
    now: string; maximum_spend_microusd?: number | null;
  }): { decision_id: string; granted_approval_id: string | null } {
    if (!DECIDING_ACTORS.has(input.actor)) {
      throw new AuthorityError('ACTOR_CANNOT_APPROVE', `${input.actor} cannot decide an approval request`);
    }
    const request = this.#db.prepare('SELECT * FROM approval_requests WHERE approval_id = ?')
      .get(input.approval_id) as Record<string, unknown> | undefined;
    if (!request) throw new AuthorityError('UNKNOWN_APPROVAL_REQUEST', input.approval_id);
    if (String(request['status']) !== 'PENDING') throw new AuthorityError('APPROVAL_NOT_PENDING', String(request['status']));

    let granted: string | null = null;
    if (input.decision === 'approve') {
      granted = `grant_${randomUUID()}`;
      this.#db.prepare(`INSERT INTO approvals (approval_id, project_id, actor_id, action, candidate_id, artifact_digest,
        target_environment, policy_digest, expires_at, nonce, maximum_spend_microusd, consumed_by_release_id, approved_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL,?)`)
        .run(granted, String(request['project_id']), input.actor_id, String(request['action']),
          request['candidate_id'] === null ? null : String(request['candidate_id']),
          request['artifact_digest'] === null ? null : String(request['artifact_digest']),
          String(request['target_environment']), String(request['policy_digest']),
          String(request['expires_at']), randomUUID(), input.maximum_spend_microusd ?? null, input.now);
    }
    const decision_id = `dec_${randomUUID()}`;
    this.#db.prepare('INSERT INTO approval_decisions (decision_id, approval_id, actor_id, decision, granted_approval_id, created_at) VALUES (?,?,?,?,?,?)')
      .run(decision_id, input.approval_id, input.actor_id, input.decision, granted, input.now);
    this.#db.prepare('UPDATE approval_requests SET status = ?, state_version = state_version + 1 WHERE approval_id = ?')
      .run(input.decision === 'approve' ? 'APPROVED' : 'DENIED', input.approval_id);
    this.#db.prepare('INSERT INTO authority_audit (audit_id, actor_id, operation, target_ref, decision, created_at) VALUES (?,?,?,?,?,?)')
      .run(`aud_${randomUUID()}`, input.actor_id, `approval.${String(request['action'])}`, input.approval_id, input.decision, input.now);
    return { decision_id, granted_approval_id: granted };
  }

  /** The authority predicate. Scope, environment, expiry, spend ceiling and single use all
   * have to match; nothing about the requester's wording is consulted. */
  authorize(question: AuthorityQuestion): AuthorityAnswer {
    const rows = this.#db.prepare(`SELECT * FROM approvals WHERE project_id = ? AND action = ?
      AND target_environment = ? AND consumed_by_release_id IS NULL`)
      .all(question.project_id, question.action, question.target_environment) as Array<Record<string, unknown>>;
    for (const row of rows) {
      if (Date.parse(String(row['expires_at'])) <= Date.parse(question.now)) continue;
      if (question.candidate_id !== undefined && row['candidate_id'] !== question.candidate_id) continue;
      if (question.artifact_digest !== undefined && row['artifact_digest'] !== question.artifact_digest) continue;
      const ceiling = row['maximum_spend_microusd'] === null ? null : Number(row['maximum_spend_microusd']);
      if (question.minimum_spend_microusd !== undefined && (ceiling === null || ceiling < question.minimum_spend_microusd)) continue;
      this.#audit(question, 'allow', String(row['approval_id']));
      return { authorized: true, reason: 'SCOPED_APPROVAL_PRESENT', approval_id: String(row['approval_id']), maximum_spend_microusd: ceiling };
    }
    this.#audit(question, 'deny', `${question.action}:${question.target_environment}`);
    return { authorized: false, reason: 'NO_MATCHING_SCOPED_APPROVAL' };
  }

  #audit(question: AuthorityQuestion, decision: 'allow' | 'deny', target: string): void {
    this.#db.prepare('INSERT INTO authority_audit (audit_id, actor_id, operation, target_ref, decision, created_at) VALUES (?,?,?,?,?,?)')
      .run(`aud_${randomUUID()}`, question.requested_by, `authorize.${question.action}`, target, decision, question.now);
  }

  audit(): Array<{ actor_id: string; operation: string; target_ref: string; decision: string }> {
    return (this.#db.prepare('SELECT actor_id, operation, target_ref, decision FROM authority_audit ORDER BY created_at, rowid').all() as Array<Record<string, unknown>>)
      .map(row => ({
        actor_id: String(row['actor_id']), operation: String(row['operation']),
        target_ref: String(row['target_ref']), decision: String(row['decision']),
      }));
  }

  close(): void { this.#db.close(); }
}
