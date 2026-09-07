/** One holdout trial, under the frozen configuration.
 *
 * The configuration is frozen before the holdout is opened and is not changed afterwards, so
 * every trial gets the same treatment: a writer produces the candidate, an independent
 * reviewer runs the protected checks *and reads the change*, and the work is only claimed
 * ready when the reviewer has no blocking finding. The grader then re-runs the protected
 * checks itself, and an audit that the worker never sees looks for what escaped.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ClientRequest } from '../../../contracts/interfaces.js';
import { interpret, type MaterialQuestion } from '../../core/src/intake.js';
import { AUDIT_CASES, buildProgram, POLICY_CASES, toolchainAvailable, toolchainFor } from './program.js';
import type { HoldoutSpec } from './holdout.js';

export type ReviewFinding = { finding_id: string; severity: 'low' | 'moderate' | 'high'; detail: string };

/** The reviewer reads the change. The requirement is a lower bound of one, so a guard that is
 * missing or set at zero is a finding — stated as the rule, not as a list of known defects. */
export function reviewSource(source: string): ReviewFinding[] {
  const lowerBound = /(quantity\s*<\s*1)|(quantity\s*<\s*1\b)/.test(source);
  if (lowerBound) return [];
  const zeroBound = /quantity\s*<\s*0/.test(source);
  return [{
    finding_id: zeroBound ? 'LOWER_BOUND_AT_ZERO' : 'LOWER_BOUND_ABSENT',
    severity: 'high',
    detail: zeroBound
      ? 'the lower bound refuses negative quantities but accepts zero; the requirement is a minimum of one'
      : 'no lower bound on quantity is enforced',
  }];
}

/** A question that only asks permission to carry on is not a client question, it is chatter. */
const CONTINUE_PROMPT = /\b(shall i (continue|proceed|go ahead)|should i (continue|proceed)|do you want me to (continue|proceed)|ok to (continue|proceed)|may i (continue|proceed)|continue\?)\b/i;

export function countContinuePrompts(prompts: readonly string[]): number {
  return prompts.filter(prompt => CONTINUE_PROMPT.test(prompt)).length;
}

export type HoldoutTrial = {
  trial_id: string;
  spec_id: string;
  category: HoldoutSpec['category'];
  stack: HoldoutSpec['stack'];
  risk_tier: HoldoutSpec['risk_tier'];
  repeat: number;
  injected_defect: HoldoutSpec['defect'];
  toolchain: string;
  outcome: 'ACCEPTED' | 'REJECTED' | 'BLOCKED';
  blocked_reason: string | null;
  /** The worker said it was ready. */
  claimed_ready: boolean;
  /** Claimed ready and the grader disagreed. */
  false_ready: boolean;
  /** Findings still open when the work was claimed. */
  reviewer_findings: ReviewFinding[];
  /** Every finding the reviewer raised, including ones a repair then closed. */
  findings_raised: ReviewFinding[];
  /** Protected checks that were red at least once before the work was claimed. */
  check_failures_seen: string[];
  repair_cycles: number;
  grader_results: Array<{ check_id: string; passed: boolean; observed: string }>;
  audit_results: Array<{ case_id: string; passed: boolean; observed: string; severity: 'high' }>;
  escaped_defects: Array<{ case_id: string; severity: 'high' }>;
  material_questions: MaterialQuestion[];
  continue_prompts: number;
  /** Present for paired-language specs: the two briefs' requirement ids, for comparison. */
  paired_language: { english: string[]; taglish: string[]; equivalent: boolean } | null;
  wall_ms: number;
};

export function runHoldoutTrial(input: {
  spec: HoldoutSpec; repeat: number; workspace: string; project_id: string; maximum_repair_cycles: number;
}): HoldoutTrial {
  const { spec, repeat } = input;
  const trial_id = `holdout_${spec.spec_id}_${repeat}`;
  const started = Date.now();
  const base = {
    trial_id, spec_id: spec.spec_id, category: spec.category, stack: spec.stack,
    risk_tier: spec.risk_tier, repeat, injected_defect: spec.defect, toolchain: toolchainFor(spec.stack),
  };

  const request = (message: string, hint: ClientRequest['language_hint'], suffix: string): ClientRequest => ({
    kind: 'client_request', schema_version: 1, request_id: `${trial_id}_${suffix}`,
    project_id: input.project_id, message, language_hint: hint, attachment_ids: [],
    privacy_class: 'internal', created_at: '2026-09-09T00:00:00.000Z',
  });
  const english = interpret({ request: request(spec.brief_en, 'en', 'en') });
  const paired_language = spec.brief_taglish === null ? null : (() => {
    const taglish = interpret({ request: request(spec.brief_taglish!, 'mixed', 'tl') });
    const ids = (interpretation: typeof english): string[] => interpretation.requirements
      .filter(requirement => requirement.classification !== 'assumption').map(requirement => requirement.id).sort();
    return { english: ids(english), taglish: ids(taglish), equivalent: JSON.stringify(ids(english)) === JSON.stringify(ids(taglish)) };
  })();
  const material_questions = english.material_questions;
  // The frozen configuration asks material questions only. It never asks to carry on.
  const continue_prompts = countContinuePrompts(material_questions.map(question => question.prompt));

  if (!toolchainAvailable(spec.stack)) {
    return {
      ...base, outcome: 'BLOCKED', blocked_reason: `MISSING_TOOLCHAIN:${toolchainFor(spec.stack)}`,
      claimed_ready: false, false_ready: false, reviewer_findings: [], findings_raised: [], check_failures_seen: [], repair_cycles: 0,
      grader_results: [], audit_results: [], escaped_defects: [],
      material_questions, continue_prompts, paired_language, wall_ms: Date.now() - started,
    };
  }

  // Writer, then independent reviewer, then repair, bounded by the dispatch limit.
  let defect = spec.defect;
  let repair_cycles = 0;
  let reviewer_findings: ReviewFinding[] = [];
  // Findings are accumulated across cycles. Reporting only the last cycle's findings would
  // say "the reviewer found nothing" about every run the reviewer actually fixed.
  const findings_raised: ReviewFinding[] = [];
  const check_failures_seen: string[] = [];
  let built = buildProgram({ stack: spec.stack, defect, workspace: input.workspace });
  for (;;) {
    if (!built.built) {
      return {
        ...base, outcome: 'BLOCKED', blocked_reason: built.reason, claimed_ready: false, false_ready: false,
        reviewer_findings, findings_raised, check_failures_seen, repair_cycles, grader_results: [], audit_results: [], escaped_defects: [],
        material_questions, continue_prompts, paired_language, wall_ms: Date.now() - started,
      };
    }
    const checkFailures = POLICY_CASES.filter(testCase => built.built && built.run(testCase.argument) !== testCase.expected);
    reviewer_findings = reviewSource(readFileSync(built.source_file, 'utf8'));
    findings_raised.push(...reviewer_findings);
    check_failures_seen.push(...checkFailures.map(testCase => testCase.check_id));
    if (checkFailures.length === 0 && reviewer_findings.length === 0) break;
    if (repair_cycles >= input.maximum_repair_cycles) break;
    repair_cycles += 1;
    defect = 'none';
    built = buildProgram({ stack: spec.stack, defect, workspace: input.workspace });
  }
  const claimed_ready = built.built && reviewer_findings.length === 0;

  // The grader runs the protected checks itself. It does not take the worker's word.
  const grader_results = POLICY_CASES.map(testCase => {
    const observed = built.built ? built.run(testCase.argument) : 'NOT_BUILT';
    return { check_id: testCase.check_id, passed: observed === testCase.expected, observed };
  });
  const accepted = claimed_ready && grader_results.every(result => result.passed);

  // The audit the worker never sees. It runs on accepted work, which is where an escape hides.
  const audit_results = AUDIT_CASES.map(testCase => {
    const observed = built.built ? built.run(testCase.argument) : 'NOT_BUILT';
    return { case_id: testCase.case_id, passed: observed === testCase.expected, observed, severity: testCase.severity };
  });
  const escaped_defects = accepted
    ? audit_results.filter(result => !result.passed).map(result => ({ case_id: result.case_id, severity: 'high' as const }))
    : [];

  return {
    ...base,
    outcome: accepted ? 'ACCEPTED' : 'REJECTED',
    blocked_reason: null, claimed_ready,
    false_ready: claimed_ready && !accepted,
    reviewer_findings, findings_raised, check_failures_seen, repair_cycles, grader_results, audit_results, escaped_defects,
    material_questions, continue_prompts, paired_language, wall_ms: Date.now() - started,
  };
}

void path;
