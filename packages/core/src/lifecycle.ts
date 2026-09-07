/** Authoritative run lifecycle. Every transition is compare-and-swap on (run_id, state_version),
 * performed by an authenticated actor listed in the state machine, with the guard derived here
 * from stored records. A caller never supplies a guard boolean and a worker never transitions.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  Actor, ClientAnswer, ClientQuestion, ClientRequest, Contract, Run, RunMessage,
  StateStore, TaskAttempt, TransitionRequest, UsageEvent,
} from '../../../contracts/interfaces.js';
import { digest } from '../../contracts/src/canonical.js';
import { validateEntity } from '../../contracts/src/validate.js';
import { appendEvent } from '../../state/src/events.js';
import { acquire, revokeForAttempts, type Lease } from '../../state/src/leases.js';
import { enqueue } from '../../state/src/outbox.js';
import type { ControllerDatabase } from '../../state/src/database.js';

const MACHINE_PATH = path.resolve(fileURLToPath(import.meta.url), '../../../../contracts/state-machine.json');
type Rule = { from: Run['state']; to: Run['state']; actor: Actor; guard: string };
const MACHINE = JSON.parse(readFileSync(MACHINE_PATH, 'utf8')) as { states: Run['state'][]; transitions: Rule[] };

export class LifecycleError extends Error {
  constructor(public readonly code: string, message?: string) {
    super(message ?? code);
    this.name = 'LifecycleError';
  }
}

export type ControlAction = 'pause' | 'resume' | 'cancel' | 'block';

/** A transition may bind the records the target state requires; the values are still validated. */
export interface ControllerTransitionRequest extends TransitionRequest {
  bind?: { contract_id?: string | null; requirements_revision?: number; candidate_id?: string | null };
}

export type GuardContext = { db: ControllerDatabase; run: Run; request: ControllerTransitionRequest };
export type Guard = (context: GuardContext) => boolean;

function toRun(row: Record<string, unknown>): Run {
  return {
    kind: 'run', schema_version: 1,
    run_id: String(row['run_id']), project_id: String(row['project_id']),
    contract_id: row['contract_id'] === null ? null : String(row['contract_id']),
    requirements_revision: Number(row['requirements_revision']),
    state: String(row['state']) as Run['state'], state_version: Number(row['state_version']),
    idempotency_key: String(row['idempotency_key']),
    candidate_id: row['candidate_id'] === null ? null : String(row['candidate_id']),
    provider: String(row['provider']) as Run['provider'],
    created_at: String(row['created_at']), updated_at: String(row['updated_at']),
  };
}

function latestIntent(db: ControllerDatabase, run_id: string): Record<string, unknown> | undefined {
  return db.get('SELECT * FROM run_control_intents WHERE run_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1', run_id);
}

/** Guards this milestone can derive from controller-owned records. Anything else stays
 * unimplemented and therefore false: an underivable guard must never read as satisfied. */
const GUARDS: Record<string, Guard> = {
  contract_valid: ({ db, run, request }) => {
    const contract_id = request.bind?.contract_id ?? run.contract_id;
    const revision = request.bind?.requirements_revision ?? run.requirements_revision;
    if (contract_id === null || contract_id === undefined || revision < 1) return false;
    return db.get('SELECT 1 AS ok FROM contracts WHERE project_id = ? AND contract_id = ? AND revision = ?',
      run.project_id, contract_id, revision) !== undefined;
  },
  authorized_and_budgeted: ({ db, run }) => {
    if (run.contract_id === null || run.requirements_revision < 1) return false;
    const project = db.get('SELECT 1 AS ok FROM projects WHERE project_id = ?', run.project_id);
    const reserved = db.get("SELECT 1 AS ok FROM budget_reservations WHERE run_id = ? AND status = 'RESERVED'", run.run_id);
    return project !== undefined && reserved !== undefined;
  },
  candidate_sealed: ({ db, run, request }) => {
    const candidate_id = request.bind?.candidate_id ?? run.candidate_id;
    if (candidate_id === null || candidate_id === undefined) return false;
    return db.get('SELECT 1 AS ok FROM candidates WHERE project_id = ? AND run_id = ? AND candidate_id = ?',
      run.project_id, run.run_id, candidate_id) !== undefined;
  },
  pause_requested: ({ db, run }) => String(latestIntent(db, run.run_id)?.['action'] ?? '') === 'pause',
  material_blocker: ({ db, run }) => {
    const intent = latestIntent(db, run.run_id);
    return String(intent?.['action'] ?? '') === 'block' && String(intent?.['reason'] ?? '').length > 0;
  },
  cancel_requested_and_leases_revoked: ({ db, run }) => {
    const intent = latestIntent(db, run.run_id);
    return String(intent?.['action'] ?? '') === 'cancel' && Number(intent?.['leases_revoked'] ?? 0) === 1;
  },
  precontract_input_resolved: ({ db, run }) => {
    const intent = latestIntent(db, run.run_id);
    if (String(intent?.['action'] ?? '') === 'resume') return true;
    return db.get("SELECT 1 AS ok FROM client_questions WHERE run_id = ? AND status = 'ANSWERED'", run.run_id) !== undefined;
  },
  new_client_requirement_revision: ({ db, run, request }) => {
    const revision = request.bind?.requirements_revision;
    if (revision === undefined || revision <= run.requirements_revision) return false;
    return db.get('SELECT 1 AS ok FROM contracts WHERE project_id = ? AND contract_id = ? AND revision = ?',
      run.project_id, request.bind?.contract_id ?? run.contract_id, revision) !== undefined;
  },
};

export class LifecycleService implements StateStore {
  readonly #db: ControllerDatabase;
  readonly #now: () => string;
  readonly #provider: Run['provider'];
  readonly #guards: Record<string, Guard>;

  constructor(db: ControllerDatabase, options: {
    clock?: () => string; provider?: Run['provider']; guards?: Record<string, Guard>;
  } = {}) {
    this.#db = db;
    this.#now = options.clock ?? (() => new Date().toISOString());
    this.#provider = options.provider ?? 'mock';
    this.#guards = { ...GUARDS, ...options.guards };
  }

  registerProject(project: { project_id: string; registered_root_ref: string; profile_id: string; data_class: string }): void {
    this.#db.run('INSERT OR IGNORE INTO projects (project_id, registered_root_ref, profile_id, data_class, created_at) VALUES (?,?,?,?,?)',
      project.project_id, project.registered_root_ref, project.profile_id, project.data_class, this.#now());
  }

  /** A contract revision is immutable once written; a later revision is a new row. */
  recordContract(contract: Contract): { digest: string } {
    const validation = validateEntity(contract);
    if (!validation.valid) throw new LifecycleError('INVALID_CONTRACT', validation.errors.join('; '));
    const contract_digest = digest(contract);
    const existing = this.#db.get('SELECT digest FROM contracts WHERE contract_id = ? AND revision = ?', contract.contract_id, contract.revision);
    if (existing) {
      if (String(existing['digest']) !== contract_digest) throw new LifecycleError('CONTRACT_REVISION_IMMUTABLE');
      return { digest: contract_digest };
    }
    this.#db.run('INSERT INTO contracts (contract_id, project_id, revision, contract_json, digest, created_at) VALUES (?,?,?,?,?,?)',
      contract.contract_id, contract.project_id, contract.revision, JSON.stringify(contract), contract_digest, this.#now());
    return { digest: contract_digest };
  }

  /** Replaying an idempotency key returns the original run; a changed payload is a conflict. */
  async createRun(request: ClientRequest, idempotency_key: string): Promise<Run> {
    const validation = validateEntity(request);
    if (!validation.valid) throw new LifecycleError('INVALID_CLIENT_REQUEST', validation.errors.join('; '));
    const request_digest = digest(request);
    return this.#db.transaction(() => {
      const existing = this.#db.get('SELECT * FROM runs WHERE project_id = ? AND idempotency_key = ?', request.project_id, idempotency_key);
      if (existing) {
        if (String(existing['request_digest']) !== request_digest) {
          throw new LifecycleError('IDEMPOTENCY_KEY_CONFLICT', 'the key was already used with a different request');
        }
        return toRun(existing);
      }
      const at = this.#now();
      const run_id = `run_${randomUUID()}`;
      this.#storeRequest(request);
      this.#db.run(`INSERT INTO runs (run_id, project_id, contract_id, requirements_revision, state, state_version,
        idempotency_key, request_digest, candidate_id, provider, created_at, updated_at)
        VALUES (?,?,NULL,0,'RECEIVED',1,?,?,NULL,?,?,?)`,
        run_id, request.project_id, idempotency_key, request_digest, this.#provider, at, at);
      appendEvent(this.#db, {
        run_id, project_id: request.project_id, kind: 'request_received', actor_id: 'client',
        payload: { request_id: request.request_id, request_digest, language_hint: request.language_hint }, at,
      });
      enqueue(this.#db, { run_id, operation: 'run.received', idempotency_key: `${idempotency_key}:received`, payload: { run_id }, at });
      return toRun(this.#db.get('SELECT * FROM runs WHERE run_id = ?', run_id)!);
    });
  }

  #storeRequest(request: ClientRequest): void {
    this.#db.run(`INSERT OR IGNORE INTO client_requests (request_id, project_id, message, attachment_ids_json,
      language_hint, privacy_class, created_at) VALUES (?,?,?,?,?,?,?)`,
      request.request_id, request.project_id, request.message, JSON.stringify(request.attachment_ids),
      request.language_hint, request.privacy_class, request.created_at);
  }

  async getRun(run_id: string): Promise<Run> {
    const row = this.#db.get('SELECT * FROM runs WHERE run_id = ?', run_id);
    if (!row) throw new LifecycleError('UNKNOWN_RUN', run_id);
    return toRun(row);
  }

  async transition(request: ControllerTransitionRequest): Promise<Run> {
    const wide = request;
    return this.#db.transaction(() => {
      const row = this.#db.get('SELECT * FROM runs WHERE run_id = ?', request.run_id);
      if (!row) throw new LifecycleError('UNKNOWN_RUN', request.run_id);
      const run = toRun(row);
      if (request.actor === 'worker' || request.actor === 'client') {
        throw new LifecycleError('ACTOR_NOT_AUTHORITATIVE', `${request.actor} cannot transition run state`);
      }
      const rule = MACHINE.transitions.find(candidate =>
        candidate.from === run.state && candidate.to === request.target && candidate.actor === request.actor);
      if (!rule) throw new LifecycleError('TRANSITION_NOT_ALLOWED', `${run.state} -> ${request.target} by ${request.actor}`);
      const guard = this.#guards[rule.guard];
      if (!guard) throw new LifecycleError('GUARD_NOT_IMPLEMENTED', rule.guard);
      if (!guard({ db: this.#db, run, request: wide })) throw new LifecycleError('GUARD_NOT_SATISFIED', rule.guard);

      const at = this.#now();
      const bind = wide.bind ?? {};
      const contract_id = bind.contract_id !== undefined ? bind.contract_id : run.contract_id;
      const revision = bind.requirements_revision !== undefined ? bind.requirements_revision : run.requirements_revision;
      const candidate_id = bind.candidate_id !== undefined ? bind.candidate_id : run.candidate_id;
      const updated = this.#db.run(`UPDATE runs SET state = ?, state_version = state_version + 1, contract_id = ?,
        requirements_revision = ?, candidate_id = ?, updated_at = ? WHERE run_id = ? AND state_version = ?`,
        request.target, contract_id, revision, candidate_id, at, request.run_id, request.expected_version);
      if (updated.changes !== 1) throw new LifecycleError('STATE_VERSION_CONFLICT', `expected ${request.expected_version}`);

      appendEvent(this.#db, {
        run_id: run.run_id, project_id: run.project_id, kind: 'readiness_changed', actor_id: request.actor,
        payload: { from: run.state, to: request.target, guard: rule.guard, reason: request.reason, guard_evidence_ids: request.guard_evidence_ids }, at,
      });
      enqueue(this.#db, {
        run_id: run.run_id, operation: `run.${request.target.toLowerCase()}`,
        idempotency_key: request.idempotency_key, payload: { run_id: run.run_id, state: request.target }, at,
      });
      return toRun(this.#db.get('SELECT * FROM runs WHERE run_id = ?', run.run_id)!);
    });
  }

  /** Pause, resume, cancel and block record durable intent before any state change.
   * Cancelling revokes leases in the same transaction so no fenced attempt can integrate. */
  requestControl(input: {
    run_id: string; action: ControlAction; actor: Actor; reason: string;
  }): { intent_id: string; leases_revoked: string[] } {
    if (input.actor === 'worker') throw new LifecycleError('ACTOR_NOT_AUTHORITATIVE', 'worker cannot control a run');
    return this.#db.transaction(() => {
      const row = this.#db.get('SELECT * FROM runs WHERE run_id = ?', input.run_id);
      if (!row) throw new LifecycleError('UNKNOWN_RUN', input.run_id);
      const run = toRun(row);
      const at = this.#now();
      let revoked: Lease[] = [];
      if (input.action === 'cancel') {
        const attempts = this.#db.all("SELECT attempt_id FROM task_attempts WHERE run_id = ? AND status NOT IN ('REVOKED','FAILED')", run.run_id)
          .map(attempt => String(attempt['attempt_id']));
        revoked = revokeForAttempts(this.#db, attempts);
        for (const attempt_id of attempts) {
          this.#db.run("UPDATE task_attempts SET status = 'REVOKED' WHERE attempt_id = ?", attempt_id);
        }
      }
      const intent_id = `int_${randomUUID()}`;
      this.#db.run(`INSERT INTO run_control_intents (intent_id, project_id, run_id, action, actor_id, state_version, reason, leases_revoked, created_at)
        VALUES (?,?,?,?,?,?,?,?,?)`,
        intent_id, run.project_id, run.run_id, input.action, input.actor, run.state_version, input.reason,
        input.action === 'cancel' ? 1 : 0, at);
      appendEvent(this.#db, {
        run_id: run.run_id, project_id: run.project_id,
        kind: input.action === 'cancel' ? 'job_revoked' : 'budget_paused', actor_id: input.actor,
        payload: { action: input.action, reason: input.reason, revoked_leases: revoked.map(lease => lease.lease_id) }, at,
      });
      return { intent_id, leases_revoked: revoked.map(lease => lease.lease_id) };
    });
  }

  createAttempt(attempt: Omit<TaskAttempt, 'kind' | 'schema_version' | 'lease_epoch' | 'status'>): TaskAttempt {
    this.#db.run(`INSERT INTO task_attempts (attempt_id, project_id, run_id, task_id, attempt_number, role,
      parent_attempt_id, depth, workspace_id, allowed_write_paths_json, dependency_task_ids_json,
      base_source_digest, lease_epoch, deadline, provider_session_id, status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?,?, 'QUEUED')`,
      attempt.attempt_id, attempt.project_id, attempt.run_id, attempt.task_id, attempt.attempt_number,
      attempt.role, attempt.parent_attempt_id, attempt.depth, attempt.workspace_id,
      JSON.stringify(attempt.allowed_write_paths), JSON.stringify(attempt.dependency_task_ids),
      attempt.base_source_digest, attempt.deadline, attempt.provider_session_id);
    return { kind: 'task_attempt', schema_version: 1, lease_epoch: 1, status: 'QUEUED', ...attempt };
  }

  /** Leasing an attempt raises its epoch; the previous holder's result is stale from then on. */
  async claimTask(task_id: string, owner_id: string, deadline: string): Promise<TaskAttempt> {
    return this.#db.transaction(() => this.#claim(task_id, owner_id, deadline));
  }

  #claim(task_id: string, owner_id: string, deadline: string): TaskAttempt {
      const row = this.#db.get("SELECT * FROM task_attempts WHERE task_id = ? AND status IN ('QUEUED','LEASED') ORDER BY attempt_number DESC LIMIT 1", task_id);
      if (!row) throw new LifecycleError('UNKNOWN_TASK', task_id);
      const attempt_id = String(row['attempt_id']);
      const lease = acquire(this.#db, {
        project_id: String(row['project_id']), attempt_id, workspace_id: String(row['workspace_id']),
        owner_id, is_writer: String(row['role']) !== 'reviewer' && String(row['role']) !== 'explorer',
        expires_at: deadline,
      });
      this.#db.run("UPDATE task_attempts SET status = 'LEASED', deadline = ? WHERE attempt_id = ?", deadline, attempt_id);
      const updated = this.#db.get('SELECT * FROM task_attempts WHERE attempt_id = ?', attempt_id)!;
      return {
        kind: 'task_attempt', schema_version: 1,
        task_id: String(updated['task_id']), attempt_id, run_id: String(updated['run_id']),
        project_id: String(updated['project_id']), attempt_number: Number(updated['attempt_number']),
        role: String(updated['role']) as TaskAttempt['role'],
        parent_attempt_id: updated['parent_attempt_id'] === null ? null : String(updated['parent_attempt_id']),
        depth: Number(updated['depth']), workspace_id: String(updated['workspace_id']),
        base_source_digest: String(updated['base_source_digest']),
        allowed_write_paths: JSON.parse(String(updated['allowed_write_paths_json'])) as string[],
        dependency_task_ids: JSON.parse(String(updated['dependency_task_ids_json'])) as string[],
        lease_epoch: lease.epoch, deadline: String(updated['deadline']),
        provider_session_id: updated['provider_session_id'] === null ? null : String(updated['provider_session_id']),
        status: 'LEASED',
      };
  }

  /** Reassign a fenced attempt to a new owner. The epoch rises, so the previous holder's
   * result is rejected even if that process is still alive and finishes normally. */
  async reassignTask(task_id: string, owner_id: string, deadline: string): Promise<TaskAttempt> {
    return this.#db.transaction(() => {
      const row = this.#db.get("SELECT attempt_id FROM task_attempts WHERE task_id = ? AND status = 'REVOKED' ORDER BY attempt_number DESC LIMIT 1", task_id);
      if (!row) throw new LifecycleError('NO_REVOKED_ATTEMPT', task_id);
      this.#db.run("UPDATE task_attempts SET status = 'QUEUED' WHERE attempt_id = ?", String(row['attempt_id']));
      return this.#claim(task_id, owner_id, deadline);
    });
  }

  /** Provider event IDs deduplicate usage; an unknown counter stays unknown, never zero. */
  async recordUsage(event: UsageEvent): Promise<'inserted' | 'duplicate'> {
    const validation = validateEntity(event);
    if (!validation.valid) throw new LifecycleError('INVALID_USAGE_EVENT', validation.errors.join('; '));
    return this.#db.transaction(() => {
      const existing = this.#db.get('SELECT 1 AS ok FROM usage_events WHERE provider = ? AND provider_event_id = ?',
        event.provider, event.provider_event_id);
      if (existing) return 'duplicate';
      const attempt = this.#db.get('SELECT project_id, run_id FROM task_attempts WHERE attempt_id = ?', event.attempt_id);
      if (!attempt) throw new LifecycleError('UNKNOWN_ATTEMPT', event.attempt_id);
      if (String(attempt['run_id']) !== event.run_id) {
        throw new LifecycleError('ATTEMPT_RUN_MISMATCH', `${event.attempt_id} does not belong to ${event.run_id}`);
      }
      this.#db.run(`INSERT INTO usage_events (usage_event_id, provider_event_id, provider, billing_mode, project_id,
        run_id, attempt_id, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_microusd,
        usage_complete, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        event.usage_event_id, event.provider_event_id, event.provider, event.billing_mode,
        String(attempt['project_id']), event.run_id, event.attempt_id,
        event.input_tokens, event.output_tokens, event.cache_read_tokens, event.cache_write_tokens,
        event.cost_usd === null ? null : Math.round(event.cost_usd * 1_000_000),
        event.coverage === 'complete' ? 1 : 0, event.occurred_at);
      return 'inserted';
    });
  }

  /** One visible question per run; further questions are queued internally, never discarded. */
  askQuestion(question: Omit<ClientQuestion, 'kind' | 'schema_version' | 'status' | 'state_version' | 'created_at' | 'updated_at'>): ClientQuestion {
    return this.#db.transaction(() => {
      const at = this.#now();
      const open = this.#db.get("SELECT 1 AS ok FROM client_questions WHERE run_id = ? AND status = 'OPEN'", question.run_id);
      const status: ClientQuestion['status'] = open ? 'SUPERSEDED' : 'OPEN';
      this.#db.run(`INSERT INTO client_questions (question_id, project_id, run_id, requirements_revision, state_version,
        prompt, recommendation, blocking_task_ids_json, source_request_ids_json, status, created_at, updated_at)
        VALUES (?,?,?,?,1,?,?,?,?,?,?,?)`,
        question.question_id, question.project_id, question.run_id, question.requirements_revision,
        question.prompt, question.recommendation, JSON.stringify(question.blocking_task_ids),
        JSON.stringify(question.source_request_ids), status, at, at);
      appendEvent(this.#db, {
        run_id: question.run_id, project_id: question.project_id, kind: 'question_asked', actor_id: 'controller',
        payload: { question_id: question.question_id, status }, at,
      });
      return { kind: 'client_question', schema_version: 1, state_version: 1, status, created_at: at, updated_at: at, ...question };
    });
  }

  /** Answer, source request, question status, event and outbox commit together or not at all. */
  answerQuestion(input: {
    question_id: string; expected_version: number; request: ClientRequest;
    authenticated_actor_id: string; actor: Actor; idempotency_key: string;
  }): ClientAnswer {
    if (input.actor !== 'client') throw new LifecycleError('ACTOR_CANNOT_ANSWER', `${input.actor} cannot answer for the client`);
    const validation = validateEntity(input.request);
    if (!validation.valid) throw new LifecycleError('INVALID_CLIENT_REQUEST', validation.errors.join('; '));
    return this.#db.transaction(() => {
      const row = this.#db.get('SELECT * FROM client_questions WHERE question_id = ?', input.question_id);
      if (!row) throw new LifecycleError('UNKNOWN_QUESTION', input.question_id);
      if (String(row['status']) !== 'OPEN') throw new LifecycleError('QUESTION_NOT_OPEN', String(row['status']));
      if (Number(row['state_version']) !== input.expected_version) throw new LifecycleError('STATE_VERSION_CONFLICT');
      if (String(row['project_id']) !== input.request.project_id) throw new LifecycleError('CROSS_PROJECT_ANSWER');
      const at = this.#now();
      const run_id = String(row['run_id']);
      this.#storeRequest(input.request);
      const answer_id = `ans_${randomUUID()}`;
      this.#db.run('INSERT INTO client_answers (answer_id, question_id, project_id, run_id, request_id, actor_id, created_at) VALUES (?,?,?,?,?,?,?)',
        answer_id, input.question_id, input.request.project_id, run_id, input.request.request_id, input.authenticated_actor_id, at);
      this.#db.run("UPDATE client_questions SET status = 'ANSWERED', state_version = state_version + 1, updated_at = ? WHERE question_id = ? AND state_version = ?",
        at, input.question_id, input.expected_version);
      appendEvent(this.#db, {
        run_id, project_id: input.request.project_id, kind: 'question_answered', actor_id: input.authenticated_actor_id,
        payload: { question_id: input.question_id, request_id: input.request.request_id }, at,
      });
      enqueue(this.#db, { run_id, operation: 'question.answered', idempotency_key: input.idempotency_key, payload: { question_id: input.question_id }, at });
      return { kind: 'client_answer', schema_version: 1, answer_id, question_id: input.question_id,
        project_id: input.request.project_id, run_id, request_id: input.request.request_id,
        actor_id: input.authenticated_actor_id, created_at: at };
    });
  }

  /** A message during active work records intent. It is not an acceptance verdict. */
  submitMessage(input: {
    run_id: string; expected_version: number; request: ClientRequest;
    authenticated_actor_id: string; idempotency_key: string;
  }): RunMessage {
    return this.#db.transaction(() => {
      const row = this.#db.get('SELECT * FROM runs WHERE run_id = ?', input.run_id);
      if (!row) throw new LifecycleError('UNKNOWN_RUN', input.run_id);
      const run = toRun(row);
      if (run.state_version !== input.expected_version) throw new LifecycleError('STATE_VERSION_CONFLICT');
      if (run.project_id !== input.request.project_id) throw new LifecycleError('CROSS_PROJECT_MESSAGE');
      const at = this.#now();
      this.#storeRequest(input.request);
      const message_id = `msg_${randomUUID()}`;
      this.#db.run(`INSERT INTO run_messages (message_id, project_id, run_id, request_id, actor_id, applied_requirements_revision, created_at)
        VALUES (?,?,?,?,?,?,?)`,
        message_id, run.project_id, run.run_id, input.request.request_id, input.authenticated_actor_id, null, at);
      appendEvent(this.#db, {
        run_id: run.run_id, project_id: run.project_id, kind: 'message_received', actor_id: input.authenticated_actor_id,
        payload: { message_id, request_id: input.request.request_id }, at,
      });
      enqueue(this.#db, { run_id: run.run_id, operation: 'run.message', idempotency_key: input.idempotency_key, payload: { message_id }, at });
      return { kind: 'run_message', schema_version: 1, message_id, project_id: run.project_id, run_id: run.run_id,
        request_id: input.request.request_id, actor_id: input.authenticated_actor_id,
        applied_requirements_revision: null, created_at: at };
    });
  }


  /** A preview points at a candidate that passed protected verification, and at nothing else.
   * "Looks good" on an unverified build is the failure this prevents. */
  bindPreview(input: {
    run_id: string; candidate_id: string;
    verdict: { verdict: 'VERIFIED_FOR_SCOPE' | 'UNVERIFIED'; candidate_id?: string; evidence_id?: string; reasons: string[] };
    preview_url: string; actor: Actor;
  }): { bound: true; preview_url: string; candidate_id: string; evidence_id: string } | { bound: false; reasons: string[] } {
    if (input.actor === 'worker') return { bound: false, reasons: ['ACTOR_CANNOT_BIND_PREVIEW'] };
    if (input.verdict.verdict !== 'VERIFIED_FOR_SCOPE') return { bound: false, reasons: ['CANDIDATE_NOT_VERIFIED', ...input.verdict.reasons] };
    if (input.verdict.candidate_id !== input.candidate_id) return { bound: false, reasons: ['VERDICT_CANDIDATE_MISMATCH'] };
    if (input.verdict.evidence_id === undefined) return { bound: false, reasons: ['VERDICT_WITHOUT_EVIDENCE'] };
    const run = this.#db.get('SELECT candidate_id FROM runs WHERE run_id = ?', input.run_id);
    if (run === undefined) return { bound: false, reasons: ['UNKNOWN_RUN'] };
    if (String(run['candidate_id']) !== input.candidate_id) return { bound: false, reasons: ['RUN_CANDIDATE_MISMATCH'] };
    return { bound: true, preview_url: input.preview_url, candidate_id: input.candidate_id, evidence_id: input.verdict.evidence_id };
  }

  /** Satisfaction is written by the client or not at all. The controller may record that a
   * candidate was shown; it may never record that the client liked it. */
  recordFeedback(input: {
    project_id: string; run_id: string; candidate_id: string; message: string;
    satisfaction: 'not_recorded' | 'needs_changes' | 'accepted';
    actor: Actor; authenticated_actor_id: string;
  }): { recorded: true; feedback_id: string; satisfaction: string } | { recorded: false; reason: string } {
    if (input.satisfaction !== 'not_recorded' && input.actor !== 'client') {
      return { recorded: false, reason: 'SATISFACTION_IS_CLIENT_AUTHORED_ONLY' };
    }
    const at = this.#now();
    const feedback_id = `feedback_${randomUUID()}`;
    return this.#db.transaction(() => {
      this.#db.run('INSERT OR IGNORE INTO client_requests (request_id, project_id, message, attachment_ids_json, language_hint, privacy_class, created_at) VALUES (?,?,?,?,?,?,?)',
        feedback_id, input.project_id, input.message, '[]', 'mixed', 'internal', at);
      this.#db.run('INSERT INTO feedback (feedback_id, project_id, candidate_id, client_request_id, satisfaction, next_contract_revision, created_at) VALUES (?,?,?,?,?,NULL,?)',
        feedback_id, input.project_id, input.candidate_id, feedback_id, input.satisfaction, at);
      appendEvent(this.#db, {
        run_id: input.run_id, project_id: input.project_id, kind: 'question_answered', actor_id: input.authenticated_actor_id,
        payload: { feedback_id, satisfaction: input.satisfaction }, at,
      });
      return { recorded: true as const, feedback_id, satisfaction: input.satisfaction };
    });
  }

  /** After an interruption the phase comes from reconciled controller state. A run that was
   * verifying does not resume as ready, and a candidate invalidated meanwhile is not restored. */
  resumePhase(run_id: string): { phase: Run['state']; resumable: boolean; reason: string } {
    const row = this.#db.get('SELECT * FROM runs WHERE run_id = ?', run_id);
    if (!row) return { phase: 'FAILED', resumable: false, reason: 'UNKNOWN_RUN' };
    const run = toRun(row);
    // A run that is verifying or ready has, by definition, something to verify. A null
    // candidate there means the candidate was invalidated while the process was down, so the
    // phase cannot be resumed as it stood.
    const candidateStillValid = run.candidate_id !== null &&
      this.#db.get('SELECT 1 AS ok FROM candidates WHERE candidate_id = ? AND requirements_revision = ?', run.candidate_id, run.requirements_revision) !== undefined;
    if (run.state === 'VERIFYING' && !candidateStillValid) {
      return { phase: 'RUNNING', resumable: true, reason: 'the candidate no longer matches the current requirements revision, so verification restarts from build' };
    }
    if (run.state === 'READY_FOR_REVIEW' && !candidateStillValid) {
      return { phase: 'NEEDS_REPAIR', resumable: true, reason: 'readiness was invalidated by a requirements change' };
    }
    return { phase: run.state, resumable: !['CANCELLED', 'FAILED'].includes(run.state), reason: 'reconciled from controller-owned state' };
  }

  /** A material requirement change creates the next revision and fences every in-flight
   * attempt, dropping any readiness reference, in one transaction. */
  applyRequirementRevision(input: {
    run_id: string; expected_version: number; contract: Contract; actor: Actor; reason: string; idempotency_key: string;
  }): { run: Run; fenced_attempts: string[]; revoked_leases: string[] } {
    if (input.actor !== 'controller') throw new LifecycleError('ACTOR_NOT_AUTHORITATIVE', input.actor);
    return this.#db.transaction(() => {
      const run = toRun(this.#db.get('SELECT * FROM runs WHERE run_id = ?', input.run_id)
        ?? (() => { throw new LifecycleError('UNKNOWN_RUN', input.run_id); })());
      if (input.contract.revision <= run.requirements_revision) throw new LifecycleError('REVISION_NOT_ADVANCING');
      this.recordContract(input.contract);
      const at = this.#now();
      const attempts = this.#db.all("SELECT attempt_id FROM task_attempts WHERE run_id = ? AND status NOT IN ('REVOKED','FAILED')", run.run_id)
        .map(row => String(row['attempt_id']));
      const revoked = revokeForAttempts(this.#db, attempts);
      for (const attempt_id of attempts) {
        this.#db.run("UPDATE task_attempts SET status = 'REVOKED' WHERE attempt_id = ?", attempt_id);
        appendEvent(this.#db, {
          run_id: run.run_id, project_id: run.project_id, kind: 'attempt_fenced', actor_id: input.actor,
          payload: { attempt_id, reason: 'REQUIREMENTS_REVISED', revision: input.contract.revision }, at,
        });
      }
      const updated = this.#db.run(`UPDATE runs SET contract_id = ?, requirements_revision = ?, candidate_id = NULL,
        state_version = state_version + 1, updated_at = ? WHERE run_id = ? AND state_version = ?`,
        input.contract.contract_id, input.contract.revision, at, run.run_id, input.expected_version);
      if (updated.changes !== 1) throw new LifecycleError('STATE_VERSION_CONFLICT');
      appendEvent(this.#db, {
        run_id: run.run_id, project_id: run.project_id, kind: 'contract_revised', actor_id: input.actor,
        payload: { revision: input.contract.revision, reason: input.reason, fenced_attempts: attempts }, at,
      });
      enqueue(this.#db, { run_id: run.run_id, operation: 'run.reconcile_revision', idempotency_key: input.idempotency_key,
        payload: { revision: input.contract.revision }, at });
      return {
        run: toRun(this.#db.get('SELECT * FROM runs WHERE run_id = ?', run.run_id)!),
        fenced_attempts: attempts, revoked_leases: revoked.map(lease => lease.lease_id),
      };
    });
  }
}
