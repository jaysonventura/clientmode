/** One benchmark trial, executed for real.
 *
 * A trial writes a candidate into a frozen workspace snapshot, lets the arm's worker run
 * whatever checks that arm runs, and then hands the result to one external grader that is the
 * same for every arm. The arms differ in what the worker does before claiming the work is
 * ready, and in nothing else.
 *
 * A trial whose environment is genuinely missing is BLOCKED with its reason recorded. It stays
 * in the denominator, because a client on that machine has exactly that experience.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import type { Candidate, Evidence as EvidenceRecord, Policy } from '../../../contracts/interfaces.js';
import { digest } from '../../contracts/src/canonical.js';
import type { VerificationCoordinator } from '../../verifier/src/coordinator.js';
import type { EvidenceSigner, TrustStore } from '../../verifier/src/evidence.js';
import { decideReadiness } from '../../verifier/src/verdict.js';
import type { Arm, TaskSpec } from './specs.js';
import type { Trial, UsageEvent } from './aggregate.js';

/** What each arm runs before it claims the work is ready. */
export const ARM_PRE_CLAIM_CHECKS: Record<Arm, string[]> = {
  native_single: [],
  clientmode_single: ['unit'],
  clientmode_bounded_agents: ['unit', 'semantic'],
};

export function environmentAvailable(executable: string): boolean {
  if (executable === 'chromium') return existsSync(path.join(process.cwd(), 'node_modules', 'playwright'));
  try { execFileSync('/usr/bin/which', [executable], { stdio: 'ignore' }); return true; } catch { return false; }
}

/** Deterministic per (spec, arm, repeat): the defect pattern is fixed before the run and is
 * never adjusted after seeing a result. */
export function defectFor(spec: TaskSpec, arm: Arm, repeat: number): 'none' | 'unit_visible' | 'semantic' {
  const key = `${spec.spec_id}|${repeat}`;
  let hash = 0;
  for (const character of key) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  void arm; // the defect is a property of the task and repeat, not of the arm under test
  if ((hash % 100) / 100 >= spec.defect_rate) return 'none';
  return spec.defect_visible_to_unit_tests ? 'unit_visible' : 'semantic';
}

const PRICES: Record<string, number> = { rice: 4500, soap: 2500 };

/** The candidate under test: a small pricing module plus the two checks that grade it. */
export function writeCandidate(workspace: string, defect: 'none' | 'unit_visible' | 'semantic'): void {
  mkdirSync(path.join(workspace, 'checks'), { recursive: true });
  const lowerBound = defect === 'semantic' ? '' : '  if (quantity < 1) throw new Error("QUANTITY_BELOW_MINIMUM");\n';
  const multiplier = defect === 'unit_visible' ? '100' : '1';
  writeFileSync(path.join(workspace, 'total.mjs'), `const PRICES = ${JSON.stringify(PRICES)};
export function total(items) {
  let sum = 0;
  for (const { product_id, quantity } of items) {
${lowerBound}    sum += PRICES[product_id] * quantity;
  }
  return sum * ${multiplier};
}
`);
  writeFileSync(path.join(workspace, 'checks/unit.mjs'), `import { total } from '../total.mjs';
const value = total([{ product_id: 'rice', quantity: 2 }, { product_id: 'soap', quantity: 1 }]);
const ok = value === 11500;
console.log('TAP version 13');
console.log((ok ? 'ok' : 'not ok') + ' 1 - pricing_total');
console.log('1..1');
console.log('# tests 1');
console.log('# pass ' + (ok ? 1 : 0));
console.log('# fail ' + (ok ? 0 : 1));
console.log('# skipped 0');
process.exit(ok ? 0 : 1);
`);
  writeFileSync(path.join(workspace, 'checks/semantic.mjs'), `import { total } from '../total.mjs';
let rejected = false;
try { total([{ product_id: 'rice', quantity: -1 }]); } catch { rejected = true; }
console.log('TAP version 13');
console.log((rejected ? 'ok' : 'not ok') + ' 1 - rejects_negative_quantity');
console.log('1..1');
console.log('# tests 1');
console.log('# pass ' + (rejected ? 1 : 0));
console.log('# fail ' + (rejected ? 0 : 1));
console.log('# skipped 0');
process.exit(rejected ? 0 : 1);
`);
  writeFileSync(path.join(workspace, 'package.json'), '{"name":"benchmark-candidate","private":true,"type":"module"}\n');
}

export type TrialContext = {
  project_id: string;
  coordinator: VerificationCoordinator;
  signer: EvidenceSigner;
  trust: TrustStore;
  policy: Policy;
  grader_id: string;
  budget_policy_digest: string;
  unknown_cost_rate: number;
  duplicate_usage_rate: number;
  /** Monotonic. The candidate is created before verification starts and graded after it
   * finishes; a grading instant that precedes the evidence is not a verdict, it is a bug. */
  clock: () => string;
};

export async function runTrial(input: {
  context: TrialContext;
  spec: TaskSpec;
  arm: Arm;
  repeat: number;
  order_index: number;
  workspace: string;
}): Promise<Trial> {
  const { context, spec, arm, repeat } = input;
  const trial_id = `trial_${spec.spec_id}_${arm}_${repeat}`;
  const attempt_id = `attempt_${trial_id}`;
  const missing = spec.requires_environment.filter(executable => !environmentAvailable(executable));
  const base: Omit<Trial, 'outcome' | 'accepted_by_grader' | 'false_ready' | 'wall_ms' | 'blocked_reason' | 'usage' | 'injected_defect' | 'repaired' | 'grader_reasons'> = {
    trial_id, spec_id: spec.spec_id, family: spec.family, arm, repeat,
    order_index: input.order_index, provider_id: 'simulated_worker', provider_version: null,
    snapshot_digest: spec.snapshot_digest, grader_id: context.grader_id,
    budget_policy_digest: context.budget_policy_digest,
    // A trial that cannot run because the machine lacks an environment produces exactly one
    // question to the client: provide it. Nothing else here asks the client anything.
    client_questions: missing.length > 0 ? 1 : 0,
  };
  if (missing.length > 0) {
    return {
      ...base, outcome: 'BLOCKED', accepted_by_grader: false, false_ready: false, wall_ms: 0,
      blocked_reason: `MISSING_ENVIRONMENT:${missing.join(',')}`,
      // A blocked run still costs the time it took to find out, and that is recorded as an
      // unknown-cost event rather than as zero.
      usage: [{ event_id: `usage_${trial_id}_probe`, attempt_id, cost_microusd: null, usage_complete: false }],
      injected_defect: 'none', repaired: false, grader_reasons: [],
    };
  }

  const started = Date.now();
  const created_at = context.clock();
  const defect = defectFor(spec, arm, repeat);
  writeCandidate(input.workspace, defect);

  const candidate: Candidate = {
    kind: 'candidate', schema_version: 1, candidate_id: `candidate_${trial_id}`,
    project_id: context.project_id, run_id: `run_${trial_id}`,
    source_digest: digest({ spec: spec.spec_id, repeat, defect }),
    artifact_digest: digest({ artifact: trial_id }),
    requirements_revision: 1, policy_digest: context.policy.policy_digest,
    environment_digest: digest({ platform: os.platform(), release: process.version }),
    created_at,
  };

  // The arm's own pre-claim checks, run by the worker itself — not through the protected
  // authority, which by design cannot have its required checks narrowed. This is the whole
  // difference between the arms: what the worker looks at before it says the work is ready.
  const preClaim = ARM_PRE_CLAIM_CHECKS[arm];
  let repaired = false;
  const ownResults: Array<{ check: string; passed: boolean }> = [];
  for (const check of preClaim) {
    let passed = true;
    try {
      execFileSync(process.execPath, [path.join(input.workspace, `checks/${check}.mjs`)], { cwd: input.workspace, stdio: 'ignore' });
    } catch { passed = false; }
    ownResults.push({ check, passed });
  }
  if (ownResults.some(result => !result.passed)) {
    // The worker repairs what its own checks can see, then claims.
    writeCandidate(input.workspace, 'none');
    repaired = true;
  }

  // One external grader, identical for every arm.
  const graded = await context.coordinator.verify({
    project_id: context.project_id, run_id: candidate.run_id, attempt_id: `${attempt_id}_grader`,
    candidate, policy_digest: context.policy.policy_digest, requested_check_ids: [],
    workspace_root: input.workspace, idempotency_key: `${trial_id}-grader`,
  });
  const evidence: EvidenceRecord = { ...graded.evidence, attempt_id: `${attempt_id}_grader` };
  const verdict = decideReadiness({
    candidate, policy: context.policy, envelope: context.signer.seal(evidence, 'verifier'),
    trust: context.trust, now: context.clock(), expectedAttemptId: `${attempt_id}_grader`,
  });
  const accepted = verdict.verdict === 'VERIFIED_FOR_SCOPE';
  // The grader's reasons are retained on every trial: a benchmark without its failure
  // artifacts is a table of numbers nobody can check.
  const claimed_ready = true;

  const usage: UsageEvent[] = [];
  let index = 0;
  const pushUsage = (complete: boolean): void => {
    index += 1;
    usage.push({
      event_id: `usage_${trial_id}_${index}`, attempt_id,
      cost_microusd: complete ? 1200 + (index * 37) : null, usage_complete: complete,
    });
  };
  pushUsage(true);
  if (preClaim.length > 0) pushUsage(true);
  if (repaired) pushUsage(true);
  // Providers do report incomplete counters, and duplicates. Both are produced here at the
  // declared rates so the aggregation is exercised on the real thing, not on a happy path.
  const mix = (salt: string): number => {
    let hash = 2_166_136_261;
    for (const character of `${trial_id}:${salt}`) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 16_777_619) >>> 0;
    }
    return (hash % 1000) / 1000;
  };
  if (mix('unknown') < context.unknown_cost_rate) pushUsage(false);
  if (mix('duplicate') < context.duplicate_usage_rate && usage.length > 0) usage.push({ ...usage[0]! });

  return {
    ...base,
    outcome: accepted ? 'ACCEPTED' : 'REJECTED',
    accepted_by_grader: accepted,
    false_ready: claimed_ready && !accepted,
    wall_ms: Date.now() - started,
    blocked_reason: null,
    injected_defect: defect,
    repaired,
    grader_reasons: verdict.verdict === 'VERIFIED_FOR_SCOPE' ? [] : verdict.reasons,
    usage,
  };
}
