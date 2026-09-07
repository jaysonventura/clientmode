/** Task-local engineering context: what a worker is given, and what invalidates it.
 *
 * A worker receives a bounded packet — its contract, its task, its component evidence and its
 * budget mode — not the handoff, not other projects' facts, and not previous sessions. Every
 * stored fact carries the source digest it was read from, so a source change invalidates it
 * instead of aging quietly into a wrong answer.
 */
import { randomUUID } from 'node:crypto';
import type {
  BillingMode, Contract, EngineeringContext, ProviderContext, TaskAttempt,
} from '../../../contracts/interfaces.js';
import { digest } from '../../contracts/src/canonical.js';
import { validateEntity } from '../../contracts/src/validate.js';
import type { ControllerDatabase } from '../../state/src/database.js';

export class ContextError extends Error {
  constructor(public readonly code: string, message?: string) {
    super(message ?? code);
    this.name = 'ContextError';
  }
}

export type StoredFact = {
  fact_id: string; project_id: string; source_ref: string; source_digest: string;
  freshness_rule: string; observed_at: string; invalidated_at: string | null;
};

export class ContextStore {
  readonly #db: ControllerDatabase;
  constructor(db: ControllerDatabase) { this.#db = db; }

  /** Contexts are validated before storage: an unsupported grounding claim never persists. */
  store(context: EngineeringContext, input: { source_ref: string; freshness_rule: string; observed_at: string }): StoredFact {
    const validation = validateEntity(context);
    if (!validation.valid) throw new ContextError('INVALID_ENGINEERING_CONTEXT', validation.errors.join('; '));
    const fact_id = `fact_${randomUUID()}`;
    this.#db.run(`INSERT INTO context_facts (fact_id, project_id, source_ref, source_digest, value_json,
      freshness_rule, observed_at, invalidated_at) VALUES (?,?,?,?,?,?,?,NULL)`,
      fact_id, context.project_id, input.source_ref, context.source_digest,
      JSON.stringify(context), input.freshness_rule, input.observed_at);
    return {
      fact_id, project_id: context.project_id, source_ref: input.source_ref,
      source_digest: context.source_digest, freshness_rule: input.freshness_rule,
      observed_at: input.observed_at, invalidated_at: null,
    };
  }

  /** Facts read from a source digest that no longer matches are invalidated, not refreshed
   * in place: the conclusion drawn from the old bytes is what expired. */
  invalidateChangedSources(project_id: string, current_source_digest: string, at: string): string[] {
    const stale = this.#db.all(
      'SELECT fact_id FROM context_facts WHERE project_id = ? AND source_digest <> ? AND invalidated_at IS NULL',
      project_id, current_source_digest).map(row => String(row['fact_id']));
    for (const fact_id of stale) {
      this.#db.run('UPDATE context_facts SET invalidated_at = ? WHERE fact_id = ?', at, fact_id);
    }
    return stale;
  }

  /** Cross-project retrieval is not a filter to remember; it is impossible by query. */
  current(project_id: string): EngineeringContext[] {
    return this.#db.all('SELECT value_json FROM context_facts WHERE project_id = ? AND invalidated_at IS NULL ORDER BY observed_at',
      project_id).map(row => JSON.parse(String(row['value_json'])) as EngineeringContext);
  }
}

export type ContextPacket = {
  context: ProviderContext;
  packet_digest: string;
  byte_length: number;
};

/** Build the bounded packet handed to a provider adapter. */
export function buildProviderContext(input: {
  contract: Contract; task: TaskAttempt; engineering_context: EngineeringContext;
  evidence_ids: string[]; billing_mode: BillingMode; capability_report_id: string; workspace_id: string;
}): ContextPacket {
  if (input.engineering_context.project_id !== input.contract.project_id) {
    throw new ContextError('CROSS_PROJECT_CONTEXT', input.engineering_context.project_id);
  }
  if (input.task.project_id !== input.contract.project_id) {
    throw new ContextError('CROSS_PROJECT_TASK', input.task.project_id);
  }
  if (input.engineering_context.requirements_revision !== input.contract.revision) {
    throw new ContextError('STALE_CONTEXT_REVISION', String(input.engineering_context.requirements_revision));
  }
  const context: ProviderContext = {
    project_id: input.contract.project_id, run_id: input.task.run_id, attempt_id: input.task.attempt_id,
    workspace_id: input.workspace_id, contract: input.contract, task: input.task,
    evidence_ids: input.evidence_ids, engineering_context: input.engineering_context,
    billing_mode: input.billing_mode, capability_report_id: input.capability_report_id,
  };
  const serialized = JSON.stringify(context);
  return { context, packet_digest: digest(context), byte_length: Buffer.byteLength(serialized, 'utf8') };
}
