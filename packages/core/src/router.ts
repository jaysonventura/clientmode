/** Dispatch policy, delegation limits, capability gates and bounded repair.
 *
 * Every limit here is enforced in controller state before a provider is started, not written
 * into an instruction and hoped for. Responsibilities are assignments on tasks, not processes:
 * covering a CTO, PM, QA or security responsibility never means launching an agent per title.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { Actor, ProviderAdapter, ProviderContext } from '../../../contracts/interfaces.js';
import { appendEvent } from '../../state/src/events.js';
import { enqueue } from '../../state/src/outbox.js';
import type { ControllerDatabase } from '../../state/src/database.js';
import { BudgetError, BudgetLedger } from './budget.js';
import { ApprovalAuthority } from './approvals.js';

/** Initial defaults from the handoff. Values live in state, not in a prompt. */
export const DISPATCH_LIMITS = {
  maximum_children_per_lead: 2,
  maximum_depth: 1,
  active_writers_per_project: 1,
  maximum_repair_cycles: 3,
  task_ceiling_seconds: 1800,
  check_timeout_seconds: 300,
} as const;

export class RoutingError extends Error {
  constructor(public readonly code: string, message?: string) {
    super(message ?? code);
    this.name = 'RoutingError';
  }
}

export type DispatchRequest = {
  project_id: string;
  run_id: string;
  attempt_id: string;
  parent_attempt_id: string | null;
  depth: number;
  estimated_microusd: number;
  context: ProviderContext;
  actor: Actor;
};

export type DispatchOutcome = { admitted: true; reservation_id: string } | { admitted: false; reason: string };

/** Company responsibilities are titles on work, and titles confer no authority. */
export const RESPONSIBILITIES = [
  'architecture', 'product', 'delivery', 'design', 'engineering', 'quality',
  'security', 'reliability', 'documentation',
] as const;
export type Responsibility = (typeof RESPONSIBILITIES)[number];

export type ResponsibilityAssignment = {
  assignment_id: string; task_id: string; attempt_id: string | null;
  responsibility: Responsibility; risk_tier: 'low' | 'moderate' | 'high'; review_required: boolean;
};

export type RepairDecision =
  | { proceed: true; cycle_number: number }
  | { proceed: false; outcome: 'BLOCKED'; reason: 'ATTEMPT_LIMIT' | 'DEADLINE_PASSED' | 'REPEATED_DIAGNOSIS_WITHOUT_EVIDENCE' };

export class Router {
  readonly #db: ControllerDatabase;
  readonly #budget: BudgetLedger;
  readonly #authority: ApprovalAuthority;
  readonly #now: () => string;

  constructor(input: {
    db: ControllerDatabase; budget: BudgetLedger; authority: ApprovalAuthority; clock?: () => string;
  }) {
    this.#db = input.db;
    this.#budget = input.budget;
    this.#authority = input.authority;
    this.#now = input.clock ?? (() => new Date().toISOString());
  }

  /** Active means admitted and working. A QUEUED attempt has not been admitted yet, and the
   * attempt currently being judged never counts against its own slot. */
  activeChildren(parent_attempt_id: string, exclude_attempt_id?: string): number {
    return Number(this.#db.get(
      "SELECT COUNT(*) AS n FROM task_attempts WHERE parent_attempt_id = ? AND status IN ('LEASED','RUNNING') AND attempt_id <> ?",
      parent_attempt_id, exclude_attempt_id ?? '')?.['n'] ?? 0);
  }

  /** Admission: depth, sibling count, exclusive write ownership, then budget reservation.
   * The dispatch record and its outbox entry commit before any provider process starts. */
  admit(request: DispatchRequest): DispatchOutcome {
    if (request.actor === 'worker') return { admitted: false, reason: 'ACTOR_CANNOT_DISPATCH' };
    if (request.depth > DISPATCH_LIMITS.maximum_depth) return { admitted: false, reason: 'DEPTH_LIMIT' };
    if (request.parent_attempt_id !== null) {
      const parent = this.#db.get('SELECT depth FROM task_attempts WHERE attempt_id = ?', request.parent_attempt_id);
      if (!parent) return { admitted: false, reason: 'UNKNOWN_PARENT_ATTEMPT' };
      if (Number(parent['depth']) >= DISPATCH_LIMITS.maximum_depth) return { admitted: false, reason: 'RECURSIVE_CHILD_REJECTED' };
      if (this.activeChildren(request.parent_attempt_id, request.attempt_id) >= DISPATCH_LIMITS.maximum_children_per_lead) {
        return { admitted: false, reason: 'CHILD_LIMIT' };
      }
    }
    try {
      return this.#db.transaction(() => {
        const reservation = this.#budget.reserve({
          project_id: request.project_id, run_id: request.run_id,
          attempt_id: request.attempt_id, microusd: request.estimated_microusd,
        });
        this.#db.run("UPDATE task_attempts SET status = 'RUNNING' WHERE attempt_id = ?", request.attempt_id);
        const at = this.#now();
        appendEvent(this.#db, {
          run_id: request.run_id, project_id: request.project_id, kind: 'job_admitted', actor_id: request.actor,
          payload: {
            attempt_id: request.attempt_id, parent_attempt_id: request.parent_attempt_id, depth: request.depth,
            reservation_id: reservation.reservation_id, available_microusd: reservation.state.available_microusd,
          }, at,
        });
        enqueue(this.#db, {
          run_id: request.run_id, operation: 'attempt.dispatch',
          idempotency_key: `dispatch:${request.attempt_id}`, payload: { attempt_id: request.attempt_id }, at,
        });
        return { admitted: true as const, reservation_id: reservation.reservation_id };
      });
    } catch (error) {
      if (error instanceof BudgetError) return { admitted: false, reason: error.code };
      throw error;
    }
  }

  /** Start a provider only after admission. A refused admission performs no provider call. */
  async dispatch(request: DispatchRequest, adapter: ProviderAdapter, signal: AbortSignal): Promise<DispatchOutcome> {
    const outcome = this.admit(request);
    if (!outcome.admitted) return outcome;
    for await (const event of adapter.start(request.context, signal)) {
      if (event.type === 'ended') break;
    }
    return outcome;
  }

  /** Optional capabilities stay disabled until a specific approval names them. A request
   * embedded in repository text, a document, or model output is data, not an authorisation. */
  capabilityEnabled(input: {
    project_id: string; capability: string; requested_by: Actor; requested_text?: string; now: string;
  }): { enabled: boolean; reason: string } {
    const grant = this.#db.get('SELECT * FROM capability_grants WHERE project_id = ? AND capability = ? AND enabled = 1',
      input.project_id, input.capability);
    if (!grant) return { enabled: false, reason: 'CAPABILITY_NOT_APPROVED' };
    const answer = this.#authority.authorize({
      project_id: input.project_id, action: 'install', target_environment: 'local',
      requested_by: input.requested_by, now: input.now,
      ...(input.requested_text === undefined ? {} : { requested_text: input.requested_text }),
    });
    return answer.authorized
      ? { enabled: true, reason: 'APPROVED_CAPABILITY' }
      : { enabled: false, reason: 'APPROVAL_NO_LONGER_VALID' };
  }

  /** Switching to metered billing needs an approval with an actual spend ceiling. */
  billingModeAllowed(input: {
    project_id: string; requested_mode: 'native_account' | 'approved_api';
    minimum_spend_microusd: number; requested_by: Actor; requested_text?: string; now: string;
  }): { allowed: boolean; reason: string; maximum_spend_microusd?: number | null } {
    if (input.requested_mode === 'native_account') return { allowed: true, reason: 'NATIVE_ACCOUNT_DEFAULT' };
    const answer = this.#authority.authorize({
      project_id: input.project_id, action: 'api_spend', target_environment: 'local',
      requested_by: input.requested_by, minimum_spend_microusd: input.minimum_spend_microusd, now: input.now,
      ...(input.requested_text === undefined ? {} : { requested_text: input.requested_text }),
    });
    return answer.authorized
      ? { allowed: true, reason: answer.reason, maximum_spend_microusd: answer.maximum_spend_microusd ?? null }
      : { allowed: false, reason: answer.reason };
  }

  /** Coverage is a set of assignments on existing work; it starts no processes. */
  planResponsibilities(input: {
    project_id: string; run_id: string; task_id: string; attempt_id: string | null;
    risk_tier: 'low' | 'moderate' | 'high'; responsibilities: readonly Responsibility[];
  }): ResponsibilityAssignment[] {
    const at = this.#now();
    return this.#db.transaction(() => input.responsibilities.map(responsibility => {
      const review_required = input.risk_tier !== 'low' &&
        ['security', 'quality', 'reliability', 'architecture'].includes(responsibility);
      const assignment_id = `asg_${randomUUID()}`;
      this.#db.run(`INSERT OR IGNORE INTO responsibility_assignments (assignment_id, project_id, run_id, task_id,
        attempt_id, responsibility, risk_tier, review_required, created_at) VALUES (?,?,?,?,?,?,?,?,?)`,
        assignment_id, input.project_id, input.run_id, input.task_id, input.attempt_id,
        responsibility, input.risk_tier, review_required ? 1 : 0, at);
      return { assignment_id, task_id: input.task_id, attempt_id: input.attempt_id, responsibility, risk_tier: input.risk_tier, review_required };
    }));
  }

  /** Three cycles at most, and the second repeat of one diagnosis without new evidence
   * blocks: adding agents or loosening a gate is not a repair. */
  evaluateRepair(input: {
    project_id: string; run_id: string; task_id: string; attempt_id: string;
    diagnosis: string; new_evidence_ref: string | null; deadline: string; now: string;
  }): RepairDecision {
    const digest = `sha256:${createHash('sha256').update(input.diagnosis, 'utf8').digest('hex')}`;
    return this.#db.transaction(() => {
      const history = this.#db.all('SELECT diagnosis_digest, new_evidence_ref FROM repair_cycles WHERE run_id = ? AND task_id = ? ORDER BY cycle_number',
        input.run_id, input.task_id);
      const record = (outcome: string): void => {
        this.#db.run(`INSERT INTO repair_cycles (cycle_id, project_id, run_id, task_id, attempt_id, cycle_number,
          diagnosis_digest, new_evidence_ref, outcome, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
          `rep_${randomUUID()}`, input.project_id, input.run_id, input.task_id, input.attempt_id,
          history.length + 1, digest, input.new_evidence_ref, outcome, input.now);
      };
      if (Date.parse(input.now) > Date.parse(input.deadline)) {
        record('BLOCKED:DEADLINE_PASSED');
        return { proceed: false as const, outcome: 'BLOCKED' as const, reason: 'DEADLINE_PASSED' as const };
      }
      if (history.length >= DISPATCH_LIMITS.maximum_repair_cycles) {
        record('BLOCKED:ATTEMPT_LIMIT');
        return { proceed: false as const, outcome: 'BLOCKED' as const, reason: 'ATTEMPT_LIMIT' as const };
      }
      const repeats = history.filter(row => String(row['diagnosis_digest']) === digest).length;
      if (repeats >= 1 && input.new_evidence_ref === null) {
        record('BLOCKED:REPEATED_DIAGNOSIS_WITHOUT_EVIDENCE');
        return { proceed: false as const, outcome: 'BLOCKED' as const, reason: 'REPEATED_DIAGNOSIS_WITHOUT_EVIDENCE' as const };
      }
      record('PROCEED');
      return { proceed: true as const, cycle_number: history.length + 1 };
    });
  }
}

/** Exactly one attempt integrates a run. Parallel writers may exist on disjoint scope, but the
 * combined snapshot is sealed by one owner, and the claim is registered before any work lands. */
export type IntegrationOwnership = { run_id: string; integrator_attempt_id: string; claimed_at: string };

export class DeliveryOrchestrator {
  readonly #db: ControllerDatabase;
  readonly #now: () => string;

  constructor(input: { db: ControllerDatabase; clock?: () => string }) {
    this.#db = input.db;
    this.#now = input.clock ?? (() => new Date().toISOString());
  }

  /** First claim wins; a second attempt asking to integrate the same run is refused. */
  claimIntegration(run_id: string, attempt_id: string): { owned: boolean; owner: string } {
    return this.#db.transaction(() => {
      const existing = this.#db.get("SELECT attempt_id FROM responsibility_assignments WHERE run_id = ? AND responsibility = 'integration' LIMIT 1", run_id);
      if (existing !== undefined) {
        const owner = String(existing['attempt_id']);
        return { owned: owner === attempt_id, owner };
      }
      this.#db.run(`INSERT INTO responsibility_assignments (assignment_id, project_id, run_id, task_id, attempt_id,
        responsibility, risk_tier, review_required, created_at)
        SELECT ?, project_id, run_id, task_id, ?, 'integration', 'high', 1, ? FROM task_attempts WHERE attempt_id = ?`,
        `asg_int_${attempt_id}`, attempt_id, this.#now(), attempt_id);
      return { owned: true, owner: attempt_id };
    });
  }

  integrationOwner(run_id: string): string | null {
    const row = this.#db.get("SELECT attempt_id FROM responsibility_assignments WHERE run_id = ? AND responsibility = 'integration' LIMIT 1", run_id);
    return row === undefined ? null : String(row['attempt_id']);
  }
}

/** What a reviewer is given. The author's success narrative and unrelated conversation are
 * deliberately absent: a reviewer reads the contract, the diff and the evidence. */
export type ReviewPacket = {
  contract_id: string;
  requirements_revision: number;
  requirement_ids: string[];
  diff: Array<{ path: string; added: number; removed: number; hunks: string[] }>;
  evidence_refs: string[];
  excluded: string[];
};

export type ReviewFinding = {
  finding_id: string;
  severity: 'blocking' | 'major' | 'minor';
  scope: string;
  statement: string;
  /** Without a reproduction a finding is an opinion, and it cannot block. */
  reproduction: { steps: string[]; observed: string; expected: string } | null;
};

export function buildReviewPacket(input: {
  contract_id: string; requirements_revision: number; requirement_ids: string[];
  diff: ReviewPacket['diff']; evidence_refs: string[];
  author_narrative?: string; unrelated_log?: string;
}): ReviewPacket {
  const excluded: string[] = [];
  if (input.author_narrative !== undefined) excluded.push(`author_success_narrative:${Buffer.byteLength(input.author_narrative)}B`);
  if (input.unrelated_log !== undefined) excluded.push(`unrelated_log:${Buffer.byteLength(input.unrelated_log)}B`);
  return {
    contract_id: input.contract_id, requirements_revision: input.requirements_revision,
    requirement_ids: input.requirement_ids, diff: input.diff, evidence_refs: input.evidence_refs, excluded,
  };
}

/** A finding blocks only when it can be reproduced. */
export function admissibleFindings(findings: ReviewFinding[]): { blocking: ReviewFinding[]; rejected: Array<{ finding_id: string; reason: string }> } {
  const blocking: ReviewFinding[] = [];
  const rejected: Array<{ finding_id: string; reason: string }> = [];
  for (const finding of findings) {
    if (finding.severity !== 'blocking') continue;
    if (finding.reproduction === null || finding.reproduction.steps.length === 0) {
      rejected.push({ finding_id: finding.finding_id, reason: 'BLOCKING_FINDING_WITHOUT_REPRODUCTION' });
      continue;
    }
    blocking.push(finding);
  }
  return { blocking, rejected };
}

/** Text found in a repository, a tool result or a model message can request anything it likes.
 * It is recorded as data and it changes no authority. */
export type UntrustedInstruction = { source: string; text: string };

export function classifyUntrustedInstruction(instruction: UntrustedInstruction): {
  source: string; recorded: true; grants_authority: false; requested_actions: string[];
} {
  const requested: string[] = [];
  const patterns: Array<[RegExp, string]> = [
    // "skipping verification" and "skip the checks" are the same request; match the stem.
    [/\bskip\w*\b[^.\n]*\b(verification|verify|checks?|tests?|gates?)\b/i, 'skip_verification'],
    [/deploy|release|production/i, 'deploy'],
    [/api key|credential|secret|token/i, 'read_secrets'],
    [/bypass|--dangerously|disable .*sandbox/i, 'bypass_sandbox'],
    [/approve|authoriz/i, 'self_approve'],
  ];
  for (const [pattern, action] of patterns) if (pattern.test(instruction.text)) requested.push(action);
  return { source: instruction.source, recorded: true, grants_authority: false, requested_actions: requested };
}
