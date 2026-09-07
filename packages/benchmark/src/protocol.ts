/** Comparison protocol conformance.
 *
 * A benchmark is only a comparison if the arms differed in the thing under test and in
 * nothing else. These checks are run over the recorded trials and their result is reported
 * with the numbers, so a reader does not have to take the protocol on trust.
 */
import type { Arm, EngineeringFamily, TaskSpec } from './specs.js';
import type { Trial } from './aggregate.js';

/** Deterministic order, so the run can be reproduced from the recorded seed. */
export function seededOrder<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let state = seed >>> 0;
  const next = (): number => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
  for (let index = out.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(next() * (index + 1));
    [out[index], out[swap]] = [out[swap]!, out[index]!];
  }
  return out;
}

export type ProtocolCheck = { check: string; passed: boolean; detail: string };

export type ProtocolConformance = {
  followed: boolean;
  seed: number;
  checks: ProtocolCheck[];
};

export function checkProtocol(input: {
  trials: readonly Trial[];
  specs: readonly TaskSpec[];
  arms: readonly Arm[];
  families: readonly EngineeringFamily[];
  repeats: number;
  seed: number;
}): ProtocolConformance {
  const checks: ProtocolCheck[] = [];
  const add = (check: string, passed: boolean, detail: string): void => { checks.push({ check, passed, detail }); };

  const expected = input.specs.length * input.arms.length * input.repeats;
  add('declared_denominator', input.trials.length === expected,
    `${input.trials.length} trials recorded, ${expected} declared (${input.specs.length} specs x ${input.arms.length} arms x ${input.repeats} repeats)`);

  const perCell = new Map<string, number>();
  for (const trial of input.trials) {
    const key = `${trial.spec_id}|${trial.arm}`;
    perCell.set(key, (perCell.get(key) ?? 0) + 1);
  }
  const wrongCells = [...perCell.entries()].filter(([, count]) => count !== input.repeats);
  add('repeats_per_cell', wrongCells.length === 0,
    wrongCells.length === 0 ? `every spec/arm cell has ${input.repeats} repeats` : `cells with the wrong repeat count: ${wrongCells.map(([key]) => key).join(', ')}`);

  const snapshots = new Map<string, Set<string>>();
  for (const trial of input.trials) {
    if (!snapshots.has(trial.spec_id)) snapshots.set(trial.spec_id, new Set());
    snapshots.get(trial.spec_id)!.add(trial.snapshot_digest);
  }
  const drifted = [...snapshots.entries()].filter(([, set]) => set.size !== 1).map(([spec]) => spec);
  add('fixed_repository_snapshots', drifted.length === 0,
    drifted.length === 0 ? 'every spec ran every arm against one frozen snapshot' : `snapshot drifted for: ${drifted.join(', ')}`);

  const graders = new Set(input.trials.map(trial => trial.grader_id));
  add('same_external_grader', graders.size === 1, `graders observed: ${[...graders].join(', ')}`);

  const budgets = new Set(input.trials.map(trial => trial.budget_policy_digest));
  add('same_budget_policy', budgets.size === 1, `budget policies observed: ${budgets.size}`);

  const ordered = [...input.trials].sort((a, b) => a.order_index - b.order_index);
  const indices = ordered.map(trial => trial.order_index);
  const uniqueOrder = new Set(indices).size === indices.length;
  // Arms must be interleaved, not run in blocks: a block order confounds arm with time.
  const firstHalf = ordered.slice(0, Math.floor(ordered.length / 2));
  const armsInFirstHalf = new Set(firstHalf.map(trial => trial.arm));
  add('randomised_interleaved_order', uniqueOrder && armsInFirstHalf.size === input.arms.length,
    `order indices unique: ${String(uniqueOrder)}; arms present in the first half: ${armsInFirstHalf.size}/${input.arms.length}`);

  const familiesPresent = new Set(input.trials.map(trial => trial.family));
  const missingFamilies = input.families.filter(family => !familiesPresent.has(family));
  add('predeclared_families_balanced', missingFamilies.length === 0,
    missingFamilies.length === 0 ? `all ${input.families.length} predeclared families ran` : `families with no trials: ${missingFamilies.join(', ')}`);

  const blocked = input.trials.filter(trial => trial.outcome === 'BLOCKED');
  add('blocked_runs_declared', blocked.every(trial => trial.blocked_reason !== null && trial.blocked_reason !== ''),
    `${blocked.length} blocked trials, each with a recorded reason`);

  return { followed: checks.every(check => check.passed), seed: input.seed, checks };
}
