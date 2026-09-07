/** The document job lifecycle.
 *
 * A document job is not a software run. It has its own tables, its own states and its own
 * questions, and it never needs a Git repository or a software candidate to exist. What it
 * does share is the budget: one broker, one balance, checked in one transaction, so a document
 * job and a software run cannot each spend the last of it.
 */
import { randomUUID } from 'node:crypto';
import type { DocumentAnswer, DocumentJob, DocumentQuestion, DocumentResult } from '../../../contracts/interfaces.js';
import { digest } from '../../contracts/src/canonical.js';
import type { ControllerDatabase } from '../../state/src/database.js';
import { BudgetLedger, BudgetError } from '../../core/src/budget.js';

export class DocumentJobError extends Error {
  constructor(public readonly code: string, subject = '') {
    super(subject === '' ? code : `${code}: ${subject}`);
    this.name = 'DocumentJobError';
  }
}

export type JobState = DocumentJob['state'];

/** The transitions from DOCUMENT_WORKFLOW.md section 7, and nothing else. */
export const TRANSITIONS: Record<JobState, JobState[]> = {
  RECEIVED: ['PROCESSING', 'BLOCKED', 'PAUSED', 'CANCELLED'],
  PROCESSING: ['NEEDS_CLARIFICATION', 'VERIFYING', 'PARTIAL', 'BLOCKED', 'PAUSED', 'CANCELLED', 'FAILED'],
  NEEDS_CLARIFICATION: ['PROCESSING', 'PAUSED', 'CANCELLED'],
  VERIFYING: ['READY', 'PARTIAL', 'PROCESSING', 'BLOCKED', 'PAUSED', 'CANCELLED', 'FAILED'],
  READY: ['STALE'],
  PARTIAL: ['STALE'],
  BLOCKED: ['PROCESSING', 'CANCELLED'],
  PAUSED: ['PROCESSING', 'CANCELLED'],
  CANCELLED: [],
  FAILED: [],
  STALE: [],
};

/** READY is awarded by the protected document-verification authority, never by a writer. */
export const READY_AWARDING_ACTORS = new Set(['document_verifier']);

export type TransitionRequest = {
  job_id: string; expected_version: number; target: JobState;
  actor: string; reason: string; idempotency_key: string;
  result_id?: string | null;
};

export class DocumentJobService {
  readonly #db: ControllerDatabase;
  readonly #now: () => string;
  readonly #budget: BudgetLedger;

  constructor(db: ControllerDatabase, options: { clock?: () => string } = {}) {
    this.#db = db;
    this.#now = options.clock ?? (() => new Date().toISOString());
    this.#budget = new BudgetLedger(db, options.clock === undefined ? {} : { clock: options.clock });
  }

  /** Idempotent by (project, request, key). A document-only request never creates a run. */
  create(input: {
    project_id: string; request_id: string; operation: DocumentJob['operation'];
    input_version_ids: string[]; idempotency_key: string; software_run_id?: string | null;
  }): DocumentJob {
    const at = this.#now();
    return this.#db.transaction(() => {
      const existing = this.#db.get(
        'SELECT record_json FROM document_jobs WHERE project_id = ? AND request_id = ? AND operation = ?',
        input.project_id, input.request_id, input.operation);
      if (existing !== undefined) return JSON.parse(String(existing['record_json'])) as DocumentJob;
      const job: DocumentJob = {
        kind: 'document_job', schema_version: 1, job_id: `djob_${randomUUID()}`,
        project_id: input.project_id, request_id: input.request_id, operation: input.operation,
        input_version_ids: [...input.input_version_ids],
        software_run_id: input.software_run_id ?? null,
        state: 'RECEIVED', state_version: 1, instruction_revision: 1, result_id: null,
        created_at: at, updated_at: at,
      };
      this.#db.run(`INSERT INTO document_jobs (job_id, project_id, request_id, operation, state, state_version,
        instruction_revision, software_run_id, result_id, record_json, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,NULL,?,?,?)`,
        job.job_id, job.project_id, job.request_id, job.operation, job.state, job.state_version,
        job.instruction_revision, job.software_run_id, JSON.stringify(job), at, at);
      for (const version_id of input.input_version_ids) {
        this.#db.run('INSERT INTO document_job_sources (project_id, job_id, version_id) VALUES (?,?,?)',
          input.project_id, job.job_id, version_id);
      }
      this.#appendEvent(job.job_id, 'job.received', { operation: job.operation, sources: input.input_version_ids.length }, at);
      this.#enqueue(job.job_id, 'job.received', `${input.idempotency_key}:received`, { job_id: job.job_id }, at);
      return job;
    });
  }

  get(job_id: string): DocumentJob {
    const row = this.#db.get('SELECT record_json FROM document_jobs WHERE job_id = ?', job_id);
    if (row === undefined) throw new DocumentJobError('UNKNOWN_JOB', job_id);
    return JSON.parse(String(row['record_json'])) as DocumentJob;
  }

  /** Compare-and-swap on the state version, exactly as the software lifecycle does. */
  transition(request: TransitionRequest): DocumentJob {
    const at = this.#now();
    return this.#db.transaction(() => {
      const job = this.get(request.job_id);
      if (!TRANSITIONS[job.state].includes(request.target)) {
        throw new DocumentJobError('ILLEGAL_TRANSITION', `${job.state}->${request.target}`);
      }
      if (request.target === 'READY') {
        if (!READY_AWARDING_ACTORS.has(request.actor)) throw new DocumentJobError('READY_REQUIRES_DOCUMENT_VERIFIER', request.actor);
        if (request.result_id === undefined || request.result_id === null) throw new DocumentJobError('READY_REQUIRES_RESULT');
      }
      const next: DocumentJob = {
        ...job, state: request.target, state_version: job.state_version + 1,
        result_id: request.result_id === undefined ? job.result_id : request.result_id,
        updated_at: at,
      };
      const updated = this.#db.run(
        `UPDATE document_jobs SET state = ?, state_version = state_version + 1, result_id = ?,
         record_json = ?, updated_at = ? WHERE job_id = ? AND state_version = ?`,
        next.state, next.result_id, JSON.stringify(next), at, request.job_id, request.expected_version);
      if (updated.changes === 0) throw new DocumentJobError('STATE_VERSION_CONFLICT', String(request.expected_version));
      this.#appendEvent(request.job_id, 'job.state_changed', { from: job.state, to: next.state, actor: request.actor, reason: request.reason }, at);
      return next;
    });
  }

  /** A client message during processing raises the instruction revision, which fences every
   * attempt started against the old one. */
  reviseInstructions(input: { job_id: string; expected_version: number; message: string; authenticated_actor_id: string }): {
    job: DocumentJob; fenced_attempts: string[];
  } {
    const at = this.#now();
    return this.#db.transaction(() => {
      const job = this.get(input.job_id);
      const next: DocumentJob = {
        ...job, instruction_revision: job.instruction_revision + 1,
        state_version: job.state_version + 1, updated_at: at,
      };
      const updated = this.#db.run(
        `UPDATE document_jobs SET instruction_revision = ?, state_version = state_version + 1,
         record_json = ?, updated_at = ? WHERE job_id = ? AND state_version = ?`,
        next.instruction_revision, JSON.stringify(next), at, input.job_id, input.expected_version);
      if (updated.changes === 0) throw new DocumentJobError('STATE_VERSION_CONFLICT', String(input.expected_version));
      const fenced = this.#db.all("SELECT attempt_id FROM document_attempts WHERE job_id = ? AND status = 'RUNNING'", input.job_id)
        .map(row => String(row['attempt_id']));
      for (const attempt_id of fenced) {
        this.#db.run("UPDATE document_attempts SET status = 'REVOKED' WHERE attempt_id = ?", attempt_id);
      }
      // An open question was asked about the previous instruction; it is superseded, not applied.
      this.#db.run("UPDATE document_questions SET status = 'SUPERSEDED', updated_at = ? WHERE job_id = ? AND status = 'OPEN'", at, input.job_id);
      this.#appendEvent(input.job_id, 'job.instructions_revised',
        { revision: next.instruction_revision, actor_id: input.authenticated_actor_id, fenced: fenced.length }, at);
      return { job: next, fenced_attempts: fenced };
    });
  }

  startAttempt(input: { job_id: string; project_id: string }): { attempt_id: string; lease_epoch: number } {
    const at = this.#now();
    return this.#db.transaction(() => {
      const previous = this.#db.get('SELECT COALESCE(MAX(lease_epoch), 0) AS epoch FROM document_attempts WHERE job_id = ?', input.job_id);
      const lease_epoch = Number(previous?.['epoch'] ?? 0) + 1;
      const attempt_id = `datt_${randomUUID()}`;
      const job = this.get(input.job_id);
      this.#db.run(`INSERT INTO document_attempts (attempt_id, project_id, job_id, lease_epoch, status, record_json, created_at)
        VALUES (?,?,?,?,?,?,?)`, attempt_id, input.project_id, input.job_id, lease_epoch, 'RUNNING',
        JSON.stringify({ instruction_revision: job.instruction_revision }), at);
      return { attempt_id, lease_epoch };
    });
  }

  /** A returning worker writes only if its attempt is still current. */
  checkAttempt(input: { job_id: string; attempt_id: string; instruction_revision: number }): { accepted: boolean; reason?: string } {
    const row = this.#db.get('SELECT * FROM document_attempts WHERE attempt_id = ? AND job_id = ?', input.attempt_id, input.job_id);
    if (row === undefined) return { accepted: false, reason: 'UNKNOWN_ATTEMPT' };
    if (String(row['status']) !== 'RUNNING') return { accepted: false, reason: `ATTEMPT_${String(row['status'])}` };
    const job = this.get(input.job_id);
    if (job.instruction_revision !== input.instruction_revision) return { accepted: false, reason: 'STALE_INSTRUCTION_REVISION' };
    return { accepted: true };
  }

  /** ------------------------------------------------------------ questions */

  askQuestion(input: {
    job_id: string; project_id: string; prompt: string; recommendation: string | null;
    citations: DocumentQuestion['citations'];
  }): DocumentQuestion {
    const at = this.#now();
    return this.#db.transaction(() => {
      const job = this.get(input.job_id);
      const open = this.#db.get("SELECT question_id FROM document_questions WHERE job_id = ? AND status = 'OPEN'", input.job_id);
      if (open !== undefined) throw new DocumentJobError('ONE_OPEN_QUESTION_PER_JOB', String(open['question_id']));
      const question: DocumentQuestion = {
        kind: 'document_question', schema_version: 1, question_id: `dq_${randomUUID()}`,
        job_id: input.job_id, project_id: input.project_id, instruction_revision: job.instruction_revision,
        prompt: input.prompt, recommendation: input.recommendation, citations: input.citations,
        status: 'OPEN', created_at: at,
      };
      this.#db.run(`INSERT INTO document_questions (question_id, project_id, job_id, instruction_revision, status, record_json, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?)`, question.question_id, input.project_id, input.job_id,
        question.instruction_revision, 'OPEN', JSON.stringify(question), at, at);
      return question;
    });
  }

  /** Only the authenticated client answers. An agent's conclusion is never relabelled as one. */
  answerQuestion(input: {
    question_id: string; project_id: string; request_id: string;
    actor: string; authenticated_actor_id: string;
  }): { recorded: true; answer: DocumentAnswer } | { recorded: false; reason: string } {
    const at = this.#now();
    if (input.actor !== 'client') return { recorded: false, reason: 'DOCUMENT_ANSWER_IS_CLIENT_AUTHORED_ONLY' };
    return this.#db.transaction(() => {
      const row = this.#db.get('SELECT * FROM document_questions WHERE question_id = ? AND project_id = ?',
        input.question_id, input.project_id);
      if (row === undefined) return { recorded: false as const, reason: 'UNKNOWN_QUESTION' };
      if (String(row['status']) !== 'OPEN') return { recorded: false as const, reason: `QUESTION_${String(row['status'])}` };
      const job = this.get(String(row['job_id']));
      if (Number(row['instruction_revision']) !== job.instruction_revision) {
        return { recorded: false as const, reason: 'STALE_INSTRUCTION_REVISION' };
      }
      const answer: DocumentAnswer = {
        kind: 'document_answer', schema_version: 1, answer_id: `da_${randomUUID()}`,
        question_id: input.question_id, job_id: job.job_id, project_id: input.project_id,
        request_id: input.request_id, actor_id: input.authenticated_actor_id, created_at: at,
      };
      this.#db.run("UPDATE document_questions SET status = 'ANSWERED', updated_at = ? WHERE question_id = ?", at, input.question_id);
      this.#db.run('INSERT INTO document_answers (answer_id, project_id, job_id, question_id, request_id, actor_id, created_at) VALUES (?,?,?,?,?,?,?)',
        answer.answer_id, input.project_id, job.job_id, input.question_id, input.request_id, input.authenticated_actor_id, at);
      this.#appendEvent(job.job_id, 'job.question_answered', { question_id: input.question_id, actor_id: input.authenticated_actor_id }, at);
      return { recorded: true as const, answer };
    });
  }

  openQuestions(job_id: string): DocumentQuestion[] {
    return this.#db.all("SELECT record_json FROM document_questions WHERE job_id = ? AND status = 'OPEN'", job_id)
      .map(row => JSON.parse(String(row['record_json'])) as DocumentQuestion);
  }

  /** ------------------------------------------------------------ results and dependencies */

  recordResult(result: DocumentResult): DocumentResult {
    this.#db.run(`INSERT INTO document_results (result_id, project_id, job_id, instruction_revision,
      source_scope_digest, qa_evidence_ref, record_json, created_at) VALUES (?,?,?,?,?,?,?,?)`,
      result.result_id, result.project_id, result.job_id, result.instruction_revision,
      result.source_scope_digest, result.qa_evidence_ref, JSON.stringify(result), result.created_at);
    for (const version_id of result.source_version_ids) {
      this.#db.run(`INSERT OR IGNORE INTO document_dependencies (project_id, version_id, target_type, target_id, target_revision, invalidated_at)
        VALUES (?,?,?,?,?,NULL)`, result.project_id, version_id, 'document_result', result.result_id, result.instruction_revision);
    }
    return result;
  }

  /** A new version of a source marks everything derived from the old one stale. Newly uploaded
   * bytes never overwrite the old version; the derived conclusion is what expires. */
  invalidateDerived(input: { project_id: string; version_id: string; at: string }): { results: string[]; jobs: string[] } {
    return this.#db.transaction(() => {
      const rows = this.#db.all(
        `SELECT target_id FROM document_dependencies WHERE project_id = ? AND version_id = ?
         AND target_type = 'document_result' AND invalidated_at IS NULL`, input.project_id, input.version_id);
      const results = rows.map(row => String(row['target_id']));
      this.#db.run(`UPDATE document_dependencies SET invalidated_at = ? WHERE project_id = ? AND version_id = ? AND invalidated_at IS NULL`,
        input.at, input.project_id, input.version_id);
      const jobs: string[] = [];
      for (const result_id of results) {
        const row = this.#db.get('SELECT job_id FROM document_results WHERE result_id = ?', result_id);
        if (row === undefined) continue;
        const job = this.get(String(row['job_id']));
        if (job.state !== 'READY' && job.state !== 'PARTIAL') continue;
        this.transition({
          job_id: job.job_id, expected_version: job.state_version, target: 'STALE',
          actor: 'controller', reason: `source ${input.version_id} was revised`, idempotency_key: `stale-${result_id}`,
        });
        jobs.push(job.job_id);
      }
      return { results, jobs };
    });
  }

  isCurrent(result_id: string): boolean {
    const row = this.#db.get(
      `SELECT COUNT(*) AS n FROM document_dependencies WHERE target_type = 'document_result' AND target_id = ? AND invalidated_at IS NOT NULL`,
      result_id);
    return Number(row?.['n'] ?? 0) === 0;
  }

  /** ------------------------------------------------------------ budget */

  /** One broker for both kinds of work. The reservation is taken against the same balance the
   * software runs use, in one transaction, so two job types cannot each spend the last of it. */
  reserve(input: { project_id: string; job_id: string; attempt_id: string; microusd: number }): {
    reserved: boolean; reason?: string; reservation_id?: string; available_after?: number;
  } {
    return this.#db.transaction(() => {
      const policy = this.#budget.policy(input.project_id);
      const softwareReserved = Number(this.#db.get(
        "SELECT COALESCE(SUM(reserved_microusd), 0) AS total FROM budget_reservations WHERE status = 'RESERVED' AND run_id IN (SELECT run_id FROM runs WHERE project_id = ?)",
        input.project_id)?.['total'] ?? 0);
      const softwareSettled = Number(this.#db.get(
        'SELECT COALESCE(SUM(cost_microusd), 0) AS total FROM usage_events WHERE usage_complete = 1 AND run_id IN (SELECT run_id FROM runs WHERE project_id = ?)',
        input.project_id)?.['total'] ?? 0);
      const documentReserved = Number(this.#db.get(
        "SELECT COALESCE(SUM(reserved_microusd), 0) AS total FROM document_budget_reservations WHERE project_id = ? AND status = 'RESERVED'",
        input.project_id)?.['total'] ?? 0);
      const documentKnown = Number(this.#db.get(
        'SELECT COALESCE(SUM(measured_cost_microusd), 0) AS total FROM document_usage WHERE project_id = ? AND usage_complete = 1',
        input.project_id)?.['total'] ?? 0);
      const documentUnknown = Number(this.#db.get(
        'SELECT COUNT(*) AS n FROM document_usage WHERE project_id = ? AND usage_complete = 0', input.project_id)?.['n'] ?? 0);
      const spent = softwareReserved + softwareSettled + documentReserved + documentKnown +
        documentUnknown * policy.unknown_usage_reserve_microusd;
      const available = policy.cap_microusd - policy.verification_reserve_microusd - spent;
      if (input.microusd > available) {
        return { reserved: false as const, reason: 'SHARED_BUDGET_EXHAUSTED', available_after: available };
      }
      const reservation_id = `dres_${randomUUID()}`;
      this.#db.run(`INSERT INTO document_budget_reservations (reservation_id, project_id, job_id, attempt_id,
        reserved_microusd, reserved_tokens, status, record_json, created_at) VALUES (?,?,?,?,?,NULL,?,?,?)`,
        reservation_id, input.project_id, input.job_id, input.attempt_id, input.microusd, 'RESERVED', '{}', this.#now());
      return { reserved: true as const, reservation_id, available_after: available - input.microusd };
    });
  }

  recordUsage(input: {
    project_id: string; job_id: string; attempt_id: string; provider: string;
    provider_event_id: string; cost_microusd: number | null;
  }): { recorded: boolean; duplicate: boolean } {
    try {
      this.#db.run(`INSERT INTO document_usage (usage_id, provider, provider_event_id, project_id, job_id, attempt_id,
        measured_cost_microusd, usage_complete, record_json, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        `dusage_${randomUUID()}`, input.provider, input.provider_event_id, input.project_id, input.job_id,
        input.attempt_id, input.cost_microusd, input.cost_microusd === null ? 0 : 1, '{}', this.#now());
      return { recorded: true, duplicate: false };
    } catch (error) {
      if (String((error as Error).message).includes('UNIQUE')) return { recorded: false, duplicate: true };
      throw error;
    }
  }

  events(job_id: string): Array<{ sequence: number; kind: string; payload: unknown }> {
    return this.#db.all('SELECT sequence, kind, payload_json FROM document_events WHERE job_id = ? ORDER BY sequence', job_id)
      .map(row => ({ sequence: Number(row['sequence']), kind: String(row['kind']), payload: JSON.parse(String(row['payload_json'])) }));
  }

  outbox(job_id: string): Array<{ operation: string; status: string; idempotency_key: string }> {
    return this.#db.all('SELECT operation, status, idempotency_key FROM document_outbox WHERE job_id = ? ORDER BY created_at', job_id)
      .map(row => ({ operation: String(row['operation']), status: String(row['status']), idempotency_key: String(row['idempotency_key']) }));
  }

  #appendEvent(job_id: string, kind: string, payload: unknown, at: string): void {
    const previous = this.#db.get('SELECT COALESCE(MAX(sequence), 0) AS sequence FROM document_events WHERE job_id = ?', job_id);
    this.#db.run('INSERT INTO document_events (job_id, sequence, event_id, kind, payload_json, created_at) VALUES (?,?,?,?,?,?)',
      job_id, Number(previous?.['sequence'] ?? 0) + 1, `dev_${randomUUID()}`, kind, JSON.stringify(payload), at);
  }

  #enqueue(job_id: string, operation: string, idempotency_key: string, payload: unknown, at: string): void {
    this.#db.run('INSERT OR IGNORE INTO document_outbox (outbox_id, job_id, operation, idempotency_key, payload_json, status, attempts, created_at) VALUES (?,?,?,?,?,?,0,?)',
      `dout_${randomUUID()}`, job_id, operation, idempotency_key, JSON.stringify(payload), 'PENDING', at);
  }
}

export { BudgetError, digest };
