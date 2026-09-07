/** Claim discipline.
 *
 * A benchmark report is where an honest measurement turns into a marketing sentence. This
 * linter reads the report's own prose and refuses any comparative claim the recorded numbers
 * do not support: overlapping confidence intervals, a blocked or incomplete sample, a
 * different grader between the arms, or a simulated arm being compared as if it were live.
 */
import type { ArmResult } from './aggregate.js';

const COMPARATIVE = /\b(faster|cheaper|better|superior|outperform\w*|beats?|more reliable|higher quality|best[- ]in[- ]class|state[- ]of[- ]the[- ]art)\b/i;
const QUANTIFIED = /\b\d+(\.\d+)?\s*(x|%|percent|times)\b/i;

export type Claim = { id: string; text: string; compares: [string, string] | null };

export type ClaimVerdict = {
  claim_id: string;
  supported: boolean;
  reasons: string[];
};

/** A comparative claim is supported only when both arms ran the full declared sample, no
 * trial was blocked, and the confidence intervals do not overlap. */
export function reviewClaims(input: {
  claims: readonly Claim[];
  arms: readonly ArmResult[];
  sample_complete: boolean;
  simulated_arms: readonly string[];
}): { verdicts: ClaimVerdict[]; unsupported: ClaimVerdict[] } {
  const byArm = new Map(input.arms.map(arm => [String(arm.arm), arm]));
  const verdicts = input.claims.map(claim => {
    const reasons: string[] = [];
    const comparative = COMPARATIVE.test(claim.text) || QUANTIFIED.test(claim.text);
    if (!comparative) return { claim_id: claim.id, supported: true, reasons: ['not a comparative claim'] };
    if (claim.compares === null) reasons.push('COMPARATIVE_WITHOUT_NAMED_ARMS');
    if (!input.sample_complete) reasons.push('SAMPLE_INCOMPLETE');
    if (claim.compares !== null) {
      const [leftId, rightId] = claim.compares;
      const left = byArm.get(leftId);
      const right = byArm.get(rightId);
      if (left === undefined || right === undefined) reasons.push('UNKNOWN_ARM');
      else {
        if (left.blocked > 0 || right.blocked > 0) reasons.push('BLOCKED_TRIALS_IN_SAMPLE');
        const overlap = left.accepted_rate_interval.low <= right.accepted_rate_interval.high &&
          right.accepted_rate_interval.low <= left.accepted_rate_interval.high;
        if (overlap) reasons.push('CONFIDENCE_INTERVALS_OVERLAP');
        if (left.cost.coverage !== 'complete' || right.cost.coverage !== 'complete') reasons.push('COST_COVERAGE_PARTIAL');
      }
      if (input.simulated_arms.includes(leftId) || input.simulated_arms.includes(rightId)) {
        reasons.push('SIMULATED_ARM_NOT_A_LIVE_RESULT');
      }
    }
    return { claim_id: claim.id, supported: reasons.length === 0, reasons };
  });
  return { verdicts, unsupported: verdicts.filter(verdict => !verdict.supported) };
}
