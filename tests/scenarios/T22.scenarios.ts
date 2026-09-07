/** AT-022 executor — baseline benchmark and cost accounting.
 *
 * Two things are executed here, and they are not the same thing:
 *
 *   1. **The trial tooling**, on small synthetic observations that deliberately contain
 *      failures, blocked runs, duplicate usage events and unknown costs. This establishes that
 *      the denominators and the cost roll-up behave before any real number is quoted.
 *   2. **The pilot**, 20 predeclared task specs x 3 arms x 3 repeats = 180 trials, each one a
 *      real verification through the protected authority, run in a recorded random order
 *      against frozen snapshots with one external grader and one budget policy.
 *
 * The pilot's worker is a deterministic simulated worker, declared as such. No metered
 * evaluation budget has been approved, so no live provider pilot was run and none is claimed;
 * the arms are compared only as far as the recorded intervals allow, and the claim linter
 * refuses anything further.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { CheckDefinition, Json, Policy, ScenarioObservation } from '../../contracts/interfaces.js';
import { digest } from '../../packages/contracts/src/canonical.js';
import { ProtectedPolicyStore } from '../../packages/verifier/src/policy.js';
import { VerificationCoordinator } from '../../packages/verifier/src/coordinator.js';
import { EvidenceSigner, TrustStore } from '../../packages/verifier/src/evidence.js';
import { ARMS, ENGINEERING_FAMILIES, PILOT_SPECS } from '../../packages/benchmark/src/specs.js';
import { accountUsage, denominator, rollupCost, summariseArm, summariseFamilies, type Trial } from '../../packages/benchmark/src/aggregate.js';
import { checkProtocol, seededOrder } from '../../packages/benchmark/src/protocol.js';
import { reviewClaims, type Claim } from '../../packages/benchmark/src/claims.js';
import { runTrial, type TrialContext } from '../../packages/benchmark/src/trial.js';
import { Evidence, fixedClock } from '../harness/evidence.js';
import { registerScenario } from '../harness/registry.js';

const PROJECT = 'project_t22';
const NOW = '2026-09-09T00:00:00.000Z';
const NODE_DIR = path.dirname(process.execPath);
const REPEATS = 3;
const SEED = 20_260_909;
const UNKNOWN_RESERVE_MICROUSD = 50_000;

/** Small synthetic observations, run before any real number is quoted. */
function syntheticTrials(): Trial[] {
  const common = {
    family: 'web' as const, repeat: 1, provider_id: 'synthetic', provider_version: null,
    snapshot_digest: 'sha256:synthetic', grader_id: 'grader_a', budget_policy_digest: 'sha256:budget',
    client_questions: 0, wall_ms: 10, injected_defect: 'none' as const, repaired: false, grader_reasons: [] as string[],
  };
  return [
    { ...common, trial_id: 's1', spec_id: 'sx', arm: 'native_single' as const, order_index: 0, outcome: 'ACCEPTED' as const, accepted_by_grader: true, false_ready: false, blocked_reason: null,
      usage: [{ event_id: 'e1', attempt_id: 'a1', cost_microusd: 1000, usage_complete: true }] },
    { ...common, trial_id: 's2', spec_id: 'sx', arm: 'native_single' as const, order_index: 1, outcome: 'FAILED' as const, accepted_by_grader: false, false_ready: true, blocked_reason: null,
      usage: [{ event_id: 'e2', attempt_id: 'a1', cost_microusd: null, usage_complete: false }] },
    { ...common, trial_id: 's3', spec_id: 'sx', arm: 'native_single' as const, order_index: 2, outcome: 'BLOCKED' as const, accepted_by_grader: false, false_ready: false, blocked_reason: 'MISSING_ENVIRONMENT:go',
      usage: [{ event_id: 'e1', attempt_id: 'a1', cost_microusd: 1000, usage_complete: true },
              { event_id: 'e3', attempt_id: 'orphan_attempt', cost_microusd: 500, usage_complete: true }] },
  ];
}

registerScenario('AT-022', async (): Promise<ScenarioObservation> => {
  const writer = await Evidence.open('T22');
  const clock = fixedClock(NOW);
  const sandbox = mkdtempSync(path.join(tmpdir(), 'cm-t22-'));
  const authorityDir = path.join(sandbox, 'verifier-authority');
  const store = ProtectedPolicyStore.open(authorityDir);
  const trust = new TrustStore(store);
  const signer = EvidenceSigner.open({ authority_dir: authorityDir, issuer_id: 'verifier_t22', trust, now: NOW });

  try {
    // ---- 1. Trial tooling on synthetic observations ---------------------------------------
    const synthetic = syntheticTrials();
    const syntheticCost = rollupCost(synthetic, UNKNOWN_RESERVE_MICROUSD);
    const syntheticUsage = accountUsage(synthetic, new Set(['a1']));
    const syntheticArm = summariseArm('native_single', synthetic, UNKNOWN_RESERVE_MICROUSD);
    const toolingChecks = {
      failed_and_blocked_kept_in_denominator: syntheticArm.trials === 3 && syntheticArm.accepted === 1 &&
        Math.abs(syntheticArm.accepted_rate - 1 / 3) < 1e-9,
      unknown_cost_not_zero: syntheticCost.unknown_events === 1 &&
        syntheticCost.reserved_for_unknown_microusd === UNKNOWN_RESERVE_MICROUSD &&
        syntheticCost.total_including_unknown_microusd > syntheticCost.known_microusd &&
        syntheticCost.coverage === 'partial',
      duplicate_usage_flagged: syntheticCost.duplicate_events_flagged.includes('e1') &&
        syntheticUsage.flagged.some(entry => entry.reason === 'DUPLICATE_USAGE_EVENT'),
      orphan_usage_flagged: syntheticUsage.flagged.some(entry => entry.reason === 'UNKNOWN_ATTEMPT'),
      interval_wider_than_point: syntheticArm.accepted_rate_interval.high - syntheticArm.accepted_rate_interval.low > 0.3,
    };

    // ---- 2. The pilot ----------------------------------------------------------------------
    store.registerEnvironmentProfile({
      profile_id: 'candidate', required_platform: null, required_executables: ['node'],
      denied_read_paths: [authorityDir], allowed_write_paths: [sandbox],
      allow_home_read: false, toolchain_paths: [NODE_DIR],
      description: 'Benchmark candidate sandbox.',
    }, 'security_owner', NOW);
    const checks: CheckDefinition[] = [];
    for (const [id, script, assertionId] of [
      ['unit', 'checks/unit.mjs', 'pricing_total'],
      ['semantic', 'checks/semantic.mjs', 'rejects_negative_quantity'],
    ] as const) {
      const registered = store.registerDefinition({
        definition: {
          check: { check_id: id, required: true, result_kind: 'tests', minimum_tests: 1, required_assertion_ids: [assertionId], maximum_skipped: 0 },
          argv: [process.execPath, script], cwd_relative: '.', parser_id: 'tap13',
          timeout_seconds: 30, maximum_output_bytes: 32_768,
          environment_profile_id: 'candidate', network_profile_id: 'deny',
        }, parser_version: '1.0.0', approved_by: 'security_owner', at: NOW,
      });
      checks.push(registered.check);
    }
    const draft = {
      kind: 'policy' as const, schema_version: 1 as const, policy_id: 'policy_t22', project_id: PROJECT,
      policy_digest: '', requirements_revision: 1, checks,
      maximum_age_seconds: 86_400, trusted_issuer_ids: ['verifier_t22'], authority: 'protected' as const,
    };
    const policy: Policy = { ...draft, policy_digest: digest(draft, 'policy_digest') };
    store.registerPolicy(policy, 'security_owner', NOW);

    const budget_policy_digest = digest({ cap_microusd: 5_000_000, unknown_reserve: UNKNOWN_RESERVE_MICROUSD, billing_mode: 'native_account' });
    const context: TrialContext = {
      project_id: PROJECT,
      coordinator: new VerificationCoordinator({ store, issuer_id: 'verifier_t22', clock, sandbox_parent: sandbox }),
      signer, trust, policy, grader_id: 'protected_verification_authority',
      budget_policy_digest, unknown_cost_rate: 0.15, duplicate_usage_rate: 0.1, clock,
    };

    // The order is drawn once from a recorded seed and every cell is interleaved.
    const cells = PILOT_SPECS.flatMap(spec => ARMS.flatMap(arm =>
      Array.from({ length: REPEATS }, (_, index) => ({ spec, arm, repeat: index + 1 }))));
    const ordered = seededOrder(cells, SEED);

    const workspaces = new Map<string, string>();
    const trials: Trial[] = [];
    for (const [order_index, cell] of ordered.entries()) {
      const key = `${cell.spec.spec_id}|${cell.arm}|${cell.repeat}`;
      let workspace = workspaces.get(key);
      if (workspace === undefined) {
        workspace = path.join(sandbox, 'work', key.replace(/\|/g, '_'));
        mkdirSync(workspace, { recursive: true });
        workspaces.set(key, workspace);
      }
      trials.push(await runTrial({ context, spec: cell.spec, arm: cell.arm, repeat: cell.repeat, order_index, workspace }));
    }

    const armResults = ARMS.map(arm => summariseArm(arm, trials, UNKNOWN_RESERVE_MICROUSD));
    const familyResults = summariseFamilies(trials, ENGINEERING_FAMILIES, ARMS);
    const totals = denominator(PILOT_SPECS, ARMS, REPEATS, trials);
    const cost = rollupCost(trials, UNKNOWN_RESERVE_MICROUSD);
    const knownAttempts = new Set(trials.map(trial => `attempt_${trial.trial_id}`));
    const usage = accountUsage(trials, knownAttempts);
    const protocol = checkProtocol({ trials, specs: PILOT_SPECS, arms: ARMS, families: ENGINEERING_FAMILIES, repeats: REPEATS, seed: SEED });

    // ---- 3. The report's own sentences, put through the claim linter -----------------------
    const sample_complete = totals.complete && trials.every(trial => trial.outcome !== 'BLOCKED');
    // The sentences the report actually makes. Every one of them has to survive the linter.
    const reportClaims: Claim[] = [
      { id: 'R1', text: 'The pilot ran 180 trials across 20 predeclared specs and three arms; blocked and failed trials are retained in every denominator.', compares: null },
      { id: 'R2', text: 'Per-family results are reported separately and are not blended into one number.', compares: null },
      { id: 'R3', text: 'Cost is reported including a reserve for every usage event whose cost the provider did not settle.', compares: null },
      { id: 'R4', text: 'No live provider pilot was run, because no metered evaluation budget is approved. The arm is reported blocked.', compares: null },
      { id: 'R5', text: 'The arms are compared only as recorded; this run draws no conclusion about which arm is preferable.', compares: null },
    ];
    // The sentences it would be tempting to write. They are put through the same linter to
    // show it bites, and they are not part of the report.
    const temptingClaims: Claim[] = [
      { id: 'X1', text: 'Client Mode with bounded agents is faster and cheaper than a native single session.', compares: ['clientmode_bounded_agents', 'native_single'] },
      { id: 'X2', text: 'Client Mode with bounded agents accepted 3x more candidates than a native single session.', compares: ['clientmode_bounded_agents', 'native_single'] },
      { id: 'X3', text: 'Client Mode is more reliable than the alternatives.', compares: null },
    ];
    const reviewed = reviewClaims({ claims: reportClaims, arms: armResults, sample_complete, simulated_arms: [...ARMS] });
    const tempting = reviewClaims({ claims: temptingClaims, arms: armResults, sample_complete, simulated_arms: [...ARMS] });

    const liveArm = {
      status: 'blocked' as const,
      reason: 'NO_APPROVED_METERED_EVALUATION_BUDGET',
      detail: 'AT-022 requires an approved metered evaluation budget for the live provider pilot. None is configured, so no live pilot was executed and no live comparison is reported. The blocked arm is retained here rather than dropped from the design.',
      trials_executed: 0,
    };

    await writer.write('trials.json', trials as unknown as Json);
    await writer.write('benchmark-report.json', {
      declared: { specs: PILOT_SPECS.length, arms: ARMS.length, repeats: REPEATS, seed: SEED, families: ENGINEERING_FAMILIES },
      denominator: totals, arms: armResults, families: familyResults, cost, usage_accounting: usage,
      protocol, claims: reviewed, rejected_claims: tempting, live_provider_pilot: liveArm,
      worker: 'deterministic simulated worker; the arms differ only in what the worker runs before claiming the work is ready',
      tooling_checks: toolingChecks, synthetic: { cost: syntheticCost, usage: syntheticUsage, arm: syntheticArm },
    } as unknown as Json);

    const blocked = trials.filter(trial => trial.outcome === 'BLOCKED');
    // A benchmark where nothing was accepted, or nothing rejected, is not a measurement of
    // anything; it is a broken harness. The gate refuses both.
    const accepted = trials.filter(trial => trial.outcome === 'ACCEPTED').length;
    const rejected = trials.filter(trial => trial.outcome === 'REJECTED').length;
    const failuresRetained = totals.complete && blocked.length > 0 && accepted > 0 && rejected > 0 &&
      armResults.every(arm => arm.trials === PILOT_SPECS.length * REPEATS) &&
      armResults.every(arm => arm.accepted + arm.rejected + arm.failed + arm.blocked === arm.trials) &&
      toolingChecks.failed_and_blocked_kept_in_denominator;

    return {
      scenario_id: 'AT-022',
      mode: 'benchmark',
      observed: {
        failures_retained_in_denominator: failuresRetained,
        unknown_cost_explicit: cost.unknown_events > 0 && cost.coverage === 'partial' &&
          cost.reserved_for_unknown_microusd === cost.unknown_events * UNKNOWN_RESERVE_MICROUSD &&
          toolingChecks.unknown_cost_not_zero,
        all_worker_usage_accounted_or_flagged: usage.accounted + usage.flagged.length ===
          trials.reduce((sum, trial) => sum + trial.usage.length, 0) &&
          toolingChecks.duplicate_usage_flagged && toolingChecks.orphan_usage_flagged,
        comparison_protocol_followed: protocol.followed,
        unsupported_superiority_claims_absent: reviewed.unsupported.length === 0 &&
          tempting.unsupported.length === temptingClaims.length,
        per_engineering_family_results_retained:
          familyResults.length === ENGINEERING_FAMILIES.length * ARMS.length &&
          new Set(familyResults.map(result => result.family)).size === ENGINEERING_FAMILIES.length,
        trials_executed: trials.length,
        trials_accepted: accepted,
        trials_rejected: rejected,
        trials_blocked: blocked.length,
        live_provider_pilot: liveArm.reason,
      } satisfies Record<string, Json>,
      artifact_paths: writer.paths,
    };
  } finally {
    store.close();
    rmSync(sandbox, { recursive: true, force: true });
  }
});
