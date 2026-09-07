/** Qualification coverage rules.
 *
 * Two of these exist to stop a comfortable result from counting: a set of trials that only
 * ever ran JavaScript is not a broad-remit qualification, and a responsibility that nobody
 * produced anything for is not covered just because a title was assigned to it.
 */
import { DISPATCH_LIMITS, RESPONSIBILITIES, type Responsibility, type ResponsibilityAssignment } from '../../core/src/router.js';
import type { TargetStack } from './holdout.js';

const JS_STACKS: readonly TargetStack[] = ['typescript'];

export type BroadRemitVerdict = {
  qualified: boolean;
  executed_stacks: TargetStack[];
  reasons: string[];
};

/** A result set drawn only from the toolkit's own language qualifies nothing beyond it. */
export function qualifiesBroadRemit(trials: ReadonlyArray<{ stack: TargetStack; outcome: string }>): BroadRemitVerdict {
  const executed = [...new Set(trials.filter(trial => trial.outcome !== 'BLOCKED').map(trial => trial.stack))];
  const reasons: string[] = [];
  const nonJs = executed.filter(stack => !JS_STACKS.includes(stack));
  if (executed.length === 0) reasons.push('NO_EXECUTED_TRIALS');
  if (nonJs.length === 0) reasons.push('JAVASCRIPT_ONLY_RESULT_SET');
  if (nonJs.length < 2) reasons.push('FEWER_THAN_TWO_NON_JAVASCRIPT_STACKS');
  return { qualified: reasons.length === 0, executed_stacks: executed, reasons };
}

export type ResponsibilityOutput =
  | { responsibility: Responsibility; kind: 'output'; ref: string }
  | { responsibility: Responsibility; kind: 'scoped_out'; rationale: string };

export type CoverageVerdict = {
  covered: boolean;
  /** Assignments that produced neither an output nor a scoped applicability decision. */
  uncovered: Responsibility[];
  /** Fan-out actually observed, against the dispatch limits. A swarm is not coverage. */
  fan_out: { maximum_children_per_lead: number; maximum_depth: number; within_limits: boolean };
  risk_relevant: Responsibility[];
};

/** Every risk-relevant responsibility needs a genuine output or a scoped applicability
 * decision. Not every task needs every role, but silence is not a decision. */
export function responsibilityCoverage(input: {
  assignments: readonly ResponsibilityAssignment[];
  outputs: readonly ResponsibilityOutput[];
  observed_children_per_lead: number;
  observed_depth: number;
}): CoverageVerdict {
  const risk_relevant = [...new Set(input.assignments.filter(assignment => assignment.review_required).map(assignment => assignment.responsibility))];
  const answered = new Set(input.outputs.map(output => output.responsibility));
  const uncovered = risk_relevant.filter(responsibility => !answered.has(responsibility));
  const within_limits = input.observed_children_per_lead <= DISPATCH_LIMITS.maximum_children_per_lead &&
    input.observed_depth <= DISPATCH_LIMITS.maximum_depth;
  return {
    covered: uncovered.length === 0 && within_limits,
    uncovered,
    fan_out: {
      maximum_children_per_lead: input.observed_children_per_lead,
      maximum_depth: input.observed_depth,
      within_limits,
    },
    risk_relevant,
  };
}

export const ALL_RESPONSIBILITIES = RESPONSIBILITIES;
