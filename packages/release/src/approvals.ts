/** Release-side approval consumption.
 *
 * An approval is scoped to one action, project, candidate, artifact, environment and policy,
 * it expires, and it is consumed exactly once. Consumption is a conditional UPDATE inside a
 * transaction, so two concurrent releases cannot both claim the same grant.
 */
import type { DatabaseSync } from 'node:sqlite';
import type { Approval } from '../../../contracts/interfaces.js';

export class ApprovalConsumptionError extends Error {
  constructor(public readonly code: string, subject = '') {
    super(subject === '' ? code : `${code}: ${subject}`);
    this.name = 'ApprovalConsumptionError';
  }
}

export type ApprovalScope = {
  project_id: string;
  action: Approval['action'];
  candidate_id: string | null;
  artifact_digest: string | null;
  target_environment: string;
  policy_digest: string;
};

export type ScopeCheck = { valid: boolean; reasons: string[] };

/** Every scope field is compared; nothing is inferred from the requester's description. */
export function checkScope(approval: Record<string, unknown>, wanted: ApprovalScope, now: string): ScopeCheck {
  const reasons: string[] = [];
  if (String(approval['project_id']) !== wanted.project_id) reasons.push('PROJECT_MISMATCH');
  if (String(approval['action']) !== wanted.action) reasons.push('ACTION_MISMATCH');
  if ((approval['candidate_id'] ?? null) !== wanted.candidate_id) reasons.push('CANDIDATE_MISMATCH');
  if ((approval['artifact_digest'] ?? null) !== wanted.artifact_digest) reasons.push('ARTIFACT_MISMATCH');
  if (String(approval['target_environment']) !== wanted.target_environment) reasons.push('ENVIRONMENT_MISMATCH');
  if (String(approval['policy_digest']) !== wanted.policy_digest) reasons.push('POLICY_MISMATCH');
  if (Date.parse(String(approval['expires_at'])) <= Date.parse(now)) reasons.push('APPROVAL_EXPIRED');
  if (approval['consumed_by_release_id'] !== null) reasons.push('ALREADY_CONSUMED');
  return { valid: reasons.length === 0, reasons };
}

export type Consumption =
  | { consumed: true; approval_id: string; nonce: string }
  | { consumed: false; reasons: string[] };

/** Consume the grant for one release. A replay of the same release id is idempotent; a
 * different release id against a consumed grant is refused. */
export function consumeApproval(db: DatabaseSync, input: {
  approval_id: string; release_id: string; scope: ApprovalScope; now: string;
}): Consumption {
  db.exec('BEGIN IMMEDIATE');
  try {
    const approval = db.prepare('SELECT * FROM approvals WHERE approval_id = ?').get(input.approval_id) as Record<string, unknown> | undefined;
    if (!approval) { db.exec('ROLLBACK'); return { consumed: false, reasons: ['UNKNOWN_APPROVAL'] }; }
    if (approval['consumed_by_release_id'] === input.release_id) {
      db.exec('COMMIT');
      return { consumed: true, approval_id: input.approval_id, nonce: String(approval['nonce']) };
    }
    const scope = checkScope(approval, input.scope, input.now);
    if (!scope.valid) { db.exec('ROLLBACK'); return { consumed: false, reasons: scope.reasons }; }
    const updated = db.prepare('UPDATE approvals SET consumed_by_release_id = ? WHERE approval_id = ? AND consumed_by_release_id IS NULL')
      .run(input.release_id, input.approval_id);
    if (Number(updated.changes) !== 1) { db.exec('ROLLBACK'); return { consumed: false, reasons: ['ALREADY_CONSUMED'] }; }
    db.prepare('INSERT INTO authority_audit (audit_id, actor_id, operation, target_ref, decision, created_at) VALUES (?,?,?,?,?,?)')
      .run(`aud_consume_${input.release_id}`, String(approval['actor_id']), `consume.${String(approval['action'])}`, input.approval_id, 'allow', input.now);
    db.exec('COMMIT');
    return { consumed: true, approval_id: input.approval_id, nonce: String(approval['nonce']) };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
