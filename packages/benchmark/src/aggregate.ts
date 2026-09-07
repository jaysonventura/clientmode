/** Benchmark aggregation.
 *
 * Three things are easy to get wrong in the flattering direction, so they are the whole
 * point of this module:
 *
 *   - **Failures and blocked runs stay in the denominator.** A trial that could not run
 *     because an environment was missing is not removed from the sample; it is reported as
 *     blocked and still counted, because a client who lacks that environment has exactly
 *     that experience.
 *   - **Unknown cost is never zero.** A usage event without a settled cost reserves its
 *     configured upper bound and is counted separately, and the roll-up says the coverage is
 *     partial rather than quoting a total as if it were complete.
 *   - **Duplicate usage is de-duplicated but not discarded silently.** The duplicate is
 *     flagged, because a provider reporting the same event twice is a real accounting fault.
 */
import type { Arm, EngineeringFamily, TaskSpec } from './specs.js';

export type UsageEvent = {
  event_id: string;
  attempt_id: string;
  cost_microusd: number | null;
  usage_complete: boolean;
};

export type TrialOutcome = 'ACCEPTED' | 'REJECTED' | 'FAILED' | 'BLOCKED';

export type Trial = {
  trial_id: string;
  spec_id: string;
  family: EngineeringFamily;
  arm: Arm;
  repeat: number;
  order_index: number;
  provider_id: string;
  provider_version: string | null;
  snapshot_digest: string;
  grader_id: string;
  budget_policy_digest: string;
  outcome: TrialOutcome;
  /** The external grader's decision, taken the same way for every arm. */
  accepted_by_grader: boolean;
  /** The worker said the work was ready and the grader disagreed. */
  false_ready: boolean;
  /** Questions put to the client during the trial. */
  client_questions: number;
  wall_ms: number;
  blocked_reason: string | null;
  /** Retained so a reader can check a rejection against the defect that was injected. */
  injected_defect: 'none' | 'unit_visible' | 'semantic';
  repaired: boolean;
  grader_reasons: string[];
  usage: UsageEvent[];
};

export type CostRollup = {
  known_microusd: number;
  unknown_events: number;
  reserved_for_unknown_microusd: number;
  total_including_unknown_microusd: number;
  duplicate_events_flagged: string[];
  coverage: 'complete' | 'partial';
};

/** Roll up cost over trials. Duplicates are counted once and named; unknowns reserve their
 * upper bound and are never folded into the known total. */
export function rollupCost(trials: readonly Trial[], unknown_reserve_microusd: number): CostRollup {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  let known = 0;
  let unknown = 0;
  for (const trial of trials) {
    for (const event of trial.usage) {
      if (seen.has(event.event_id)) { duplicates.push(event.event_id); continue; }
      seen.add(event.event_id);
      if (event.usage_complete && event.cost_microusd !== null) known += event.cost_microusd;
      else unknown += 1;
    }
  }
  const reserved = unknown * unknown_reserve_microusd;
  return {
    known_microusd: known, unknown_events: unknown, reserved_for_unknown_microusd: reserved,
    total_including_unknown_microusd: known + reserved,
    duplicate_events_flagged: duplicates,
    coverage: unknown === 0 ? 'complete' : 'partial',
  };
}

/** Every usage event is either accounted to an attempt that ran, or flagged. Silence is the
 * failure mode being prevented: an event with no owning attempt means spend nobody sees. */
export function accountUsage(trials: readonly Trial[], known_attempt_ids: ReadonlySet<string>): {
  accounted: number; flagged: Array<{ event_id: string; reason: string }>;
} {
  const flagged: Array<{ event_id: string; reason: string }> = [];
  let accounted = 0;
  const seen = new Set<string>();
  for (const trial of trials) {
    for (const event of trial.usage) {
      if (seen.has(event.event_id)) { flagged.push({ event_id: event.event_id, reason: 'DUPLICATE_USAGE_EVENT' }); continue; }
      seen.add(event.event_id);
      if (!known_attempt_ids.has(event.attempt_id)) { flagged.push({ event_id: event.event_id, reason: 'UNKNOWN_ATTEMPT' }); continue; }
      if (!event.usage_complete || event.cost_microusd === null) { flagged.push({ event_id: event.event_id, reason: 'UNKNOWN_COST' }); continue; }
      accounted += 1;
    }
  }
  return { accounted, flagged };
}

export type Interval = { low: number; high: number };

/** Wilson score interval. A proportion quoted without one invites reading noise as a result. */
export function wilson(successes: number, trials: number, z = 1.96): Interval {
  if (trials === 0) return { low: 0, high: 1 };
  const p = successes / trials;
  const denominator = 1 + (z * z) / trials;
  const centre = p + (z * z) / (2 * trials);
  const spread = z * Math.sqrt((p * (1 - p)) / trials + (z * z) / (4 * trials * trials));
  return { low: Math.max(0, (centre - spread) / denominator), high: Math.min(1, (centre + spread) / denominator) };
}

export type ArmResult = {
  arm: Arm;
  trials: number;
  accepted: number;
  rejected: number;
  failed: number;
  blocked: number;
  false_ready: number;
  /** accepted / trials, with blocked and failed still in the denominator. */
  accepted_rate: number;
  accepted_rate_interval: Interval;
  median_client_questions: number;
  median_wall_ms: number;
  cost: CostRollup;
};

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : ((sorted[middle - 1]! + sorted[middle]!) / 2);
}

export function summariseArm(arm: Arm, trials: readonly Trial[], unknown_reserve_microusd: number): ArmResult {
  const mine = trials.filter(trial => trial.arm === arm);
  const accepted = mine.filter(trial => trial.outcome === 'ACCEPTED').length;
  return {
    arm, trials: mine.length, accepted,
    rejected: mine.filter(trial => trial.outcome === 'REJECTED').length,
    failed: mine.filter(trial => trial.outcome === 'FAILED').length,
    blocked: mine.filter(trial => trial.outcome === 'BLOCKED').length,
    false_ready: mine.filter(trial => trial.false_ready).length,
    accepted_rate: mine.length === 0 ? 0 : accepted / mine.length,
    accepted_rate_interval: wilson(accepted, mine.length),
    median_client_questions: median(mine.map(trial => trial.client_questions)),
    median_wall_ms: median(mine.map(trial => trial.wall_ms)),
    cost: rollupCost(mine, unknown_reserve_microusd),
  };
}

export type FamilyResult = {
  family: EngineeringFamily;
  arm: Arm;
  trials: number;
  accepted: number;
  blocked: number;
  accepted_rate_interval: Interval;
};

/** Per-family results are retained, never blended away. */
export function summariseFamilies(trials: readonly Trial[], families: readonly EngineeringFamily[], arms: readonly Arm[]): FamilyResult[] {
  const out: FamilyResult[] = [];
  for (const family of families) {
    for (const arm of arms) {
      const mine = trials.filter(trial => trial.family === family && trial.arm === arm);
      out.push({
        family, arm, trials: mine.length,
        accepted: mine.filter(trial => trial.outcome === 'ACCEPTED').length,
        blocked: mine.filter(trial => trial.outcome === 'BLOCKED').length,
        accepted_rate_interval: wilson(mine.filter(trial => trial.outcome === 'ACCEPTED').length, mine.length),
      });
    }
  }
  return out;
}

/** The declared denominator, stated so a reader can check nothing was dropped. */
export function denominator(specs: readonly TaskSpec[], arms: readonly Arm[], repeats: number, trials: readonly Trial[]): {
  expected: number; observed: number; complete: boolean; missing: number;
} {
  const expected = specs.length * arms.length * repeats;
  return { expected, observed: trials.length, complete: trials.length === expected, missing: expected - trials.length };
}
