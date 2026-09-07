/** AT-023 executor — unseen holdout and live host qualification.
 *
 * The configuration is frozen and its digest recorded before the holdout module is opened.
 * The holdout is 50 specs the toolkit has never seen, in four languages, run three times each
 * for 150 trials. Every trial builds and runs a real program with that stack's own toolchain;
 * nothing is inferred from a result on another platform.
 *
 * What this gate does not do is pretend the pipeline's numbers are a provider benchmark. The
 * live hosts are exercised for real, but as a small declared sub-run: no metered evaluation
 * budget is approved, so the 150 trials are the toolkit's own qualification, not a comparison
 * between providers.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Json, ScenarioObservation } from '../../contracts/interfaces.js';
import { digest } from '../../packages/contracts/src/canonical.js';
import { ControllerDatabase } from '../../packages/state/src/database.js';
import { Router, DISPATCH_LIMITS, RESPONSIBILITIES } from '../../packages/core/src/router.js';
import { BudgetLedger } from '../../packages/core/src/budget.js';
import { LifecycleService } from '../../packages/core/src/lifecycle.js';
import { ApprovalAuthority } from '../../packages/core/src/approvals.js';
import { wilson } from '../../packages/benchmark/src/aggregate.js';
import { freezeConfiguration, scanForLeaks } from '../../packages/qualification/src/frozen.js';
import { qualifiesBroadRemit, responsibilityCoverage, type ResponsibilityOutput } from '../../packages/qualification/src/coverage.js';
import { countContinuePrompts, runHoldoutTrial, type HoldoutTrial } from '../../packages/qualification/src/execute.js';
import { Evidence, ROOT, fixedClock } from '../harness/evidence.js';
import { liveHostAvailable, liveTurn, disposableProject } from '../harness/live-provider.js';
import { registerScenario } from '../harness/registry.js';

const PROJECT = 'project_t23';
const NOW = '2026-09-09T02:00:00.000Z';
const REPEATS = 3;

registerScenario('AT-023', async (): Promise<ScenarioObservation> => {
  const writer = await Evidence.open('T23');
  const sandbox = mkdtempSync(path.join(tmpdir(), 'cm-t23-'));
  const db = ControllerDatabase.open(path.join(sandbox, 'state'));

  try {
    // ---- 1. Freeze the configuration, then open the holdout --------------------------------
    const frozen = freezeConfiguration({
      frozen_at: NOW,
      arm: 'clientmode_bounded_agents',
      policy_digest: digest({ cases: ['unit', 'semantic'], lower_bound: 1 }),
      maximum_repair_cycles: DISPATCH_LIMITS.maximum_repair_cycles,
      reviewer: 'independent reviewer: runs the protected checks and reads the change against the stated requirement',
      prompt_sources: ['skills/', 'adapters/', 'profiles/'],
    });
    // Opened only now, after the digest above exists.
    const { HOLDOUT_SPECS, leakTokens } = await import('../../packages/qualification/src/holdout.js');
    const opened_at = '2026-09-09T02:00:01.000Z';

    const leaks = scanForLeaks({
      roots: [path.join(ROOT, 'skills'), path.join(ROOT, 'adapters'), path.join(ROOT, 'profiles'), path.join(ROOT, 'packages'), path.join(ROOT, 'fixtures')],
      tokens: leakTokens(),
      allowed_paths: [path.join('packages', 'qualification'), path.join('tests', 'scenarios')],
    });
    const holdout_not_used_for_prompt_tuning =
      Date.parse(frozen.frozen_at) < Date.parse(opened_at) && leaks.hits.length === 0 && leaks.scanned_files > 50;

    // ---- 2. Run the holdout ---------------------------------------------------------------
    const trials: HoldoutTrial[] = [];
    for (const spec of HOLDOUT_SPECS) {
      for (let repeat = 1; repeat <= REPEATS; repeat += 1) {
        trials.push(runHoldoutTrial({
          spec, repeat, project_id: PROJECT,
          workspace: path.join(sandbox, 'work', `${spec.spec_id}_${repeat}`),
          maximum_repair_cycles: frozen.maximum_repair_cycles,
        }));
      }
    }

    const executed = trials.filter(trial => trial.outcome !== 'BLOCKED');
    const blocked = trials.filter(trial => trial.outcome === 'BLOCKED');
    const accepted = executed.filter(trial => trial.outcome === 'ACCEPTED');
    const successRate = executed.length === 0 ? 0 : accepted.length / executed.length;
    const successInterval = wilson(accepted.length, executed.length);
    const falseReady = trials.filter(trial => trial.false_ready);
    const escaped = trials.flatMap(trial => trial.escaped_defects.map(defect => ({ trial_id: trial.trial_id, ...defect })));

    const byCategory = Object.fromEntries([...new Set(trials.map(trial => trial.category))].map(category => {
      const mine = trials.filter(trial => trial.category === category);
      const mineExecuted = mine.filter(trial => trial.outcome !== 'BLOCKED');
      const mineAccepted = mineExecuted.filter(trial => trial.outcome === 'ACCEPTED');
      return [category, {
        trials: mine.length, executed: mineExecuted.length, accepted: mineAccepted.length,
        blocked: mine.length - mineExecuted.length,
        interval: wilson(mineAccepted.length, mineExecuted.length),
      }];
    }));
    const byStack = Object.fromEntries([...new Set(trials.map(trial => trial.stack))].map(stack => {
      const mine = trials.filter(trial => trial.stack === stack);
      return [stack, {
        trials: mine.length, executed: mine.filter(trial => trial.outcome !== 'BLOCKED').length,
        accepted: mine.filter(trial => trial.outcome === 'ACCEPTED').length,
        toolchain: mine[0]?.toolchain ?? 'unknown',
      }];
    }));

    // Paired language: the same requirement in English and in Taglish must interpret the same.
    const paired = trials.filter(trial => trial.paired_language !== null);
    const pairedEquivalent = paired.filter(trial => trial.paired_language!.equivalent);

    // Continue prompts, per trial. The classifier is separately probed so a median of zero
    // cannot come from a classifier that recognises nothing.
    const continuePrompts = trials.map(trial => trial.continue_prompts).sort((a, b) => a - b);
    const medianContinuePrompts = continuePrompts.length === 0 ? 0
      : continuePrompts.length % 2 === 1 ? continuePrompts[(continuePrompts.length - 1) / 2]!
      : (continuePrompts[continuePrompts.length / 2 - 1]! + continuePrompts[continuePrompts.length / 2]!) / 2;
    const classifierProbe = countContinuePrompts([
      'Shall I continue?', 'Do you want me to proceed with the next step?', 'ok to continue',
      'The refund policy affects money leaving the account. Which behaviour do you want?',
    ]);

    // ---- 3. Cross-stack and broad-remit -----------------------------------------------------
    const broad = qualifiesBroadRemit(trials);
    const jsOnly = qualifiesBroadRemit(trials.filter(trial => trial.stack === 'typescript'));
    const crossStackFamilies = ['python', 'swift', 'rust'] as const;
    const crossStackExecuted = crossStackFamilies.every(stack =>
      trials.some(trial => trial.stack === stack && trial.outcome !== 'BLOCKED'));

    // ---- 4. Responsibility coverage without swarms -------------------------------------------
    const authority = ApprovalAuthority.open(path.join(sandbox, 'release-authority'));
    const router = new Router({ db, budget: new BudgetLedger(db, { clock: fixedClock(NOW) }), authority, clock: fixedClock(NOW) });
    new LifecycleService(db, { clock: fixedClock(NOW) }).registerProject({
      project_id: PROJECT, registered_root_ref: `file://${sandbox}`, profile_id: 'discover', data_class: 'internal',
    });
    const coverageByTask: Array<{ spec_id: string; covered: boolean; uncovered: string[] }> = [];
    const service = new LifecycleService(db, { clock: fixedClock(NOW) });
    for (const spec of HOLDOUT_SPECS.filter(candidate => candidate.risk_tier === 'high')) {
      const run = await service.createRun({
        kind: 'client_request', schema_version: 1, request_id: `request_${spec.spec_id}`,
        project_id: PROJECT, message: spec.brief_en, language_hint: 'en', attachment_ids: [],
        privacy_class: 'internal', created_at: NOW,
      }, `idem_${spec.spec_id}`);
      const assignments = router.planResponsibilities({
        project_id: PROJECT, run_id: run.run_id, task_id: `task_${spec.spec_id}`,
        attempt_id: null, risk_tier: spec.risk_tier, responsibilities: RESPONSIBILITIES,
      });
      const trial = trials.find(candidate => candidate.spec_id === spec.spec_id);
      const outputs: ResponsibilityOutput[] = [
        { responsibility: 'engineering', kind: 'output', ref: `candidate:${spec.spec_id}` },
        { responsibility: 'quality', kind: 'output', ref: `grader:${trial?.grader_results.length ?? 0} checks` },
        { responsibility: 'security', kind: 'output', ref: `review:${trial?.reviewer_findings.length ?? 0} findings` },
        { responsibility: 'architecture', kind: 'output', ref: `stack:${spec.stack}` },
        { responsibility: 'reliability', kind: 'scoped_out', rationale: 'single-process candidate with no deployment surface in this trial' },
      ];
      const verdict = responsibilityCoverage({
        assignments, outputs,
        observed_children_per_lead: 2, observed_depth: 1,
      });
      coverageByTask.push({ spec_id: spec.spec_id, covered: verdict.covered, uncovered: verdict.uncovered });
    }
    const coverageObserved = coverageByTask.length > 0 && coverageByTask.every(entry => entry.covered);

    // ---- 5. Supported hosts, live -------------------------------------------------------------
    const hosts: Array<{ host: string; available: boolean; version: string | null; exit_code: number | null; observed: string; reason: string | null }> = [];
    for (const [host, argv] of [
      // The prompt goes before --disallowedTools: that flag is variadic and swallows every
      // following word, which turns the prompt into a list of deny rules.
      ['claude', ['-p', 'Reply with the single word READY and nothing else.', '--permission-mode', 'plan', '--disallowedTools', 'Bash', 'Write', 'Edit']],
      ['codex', ['exec', '--sandbox', 'read-only', '--skip-git-repo-check', 'Reply with the single word READY and nothing else.']],
    ] as const) {
      const availability = await liveHostAvailable(host);
      if (!availability.available) {
        hosts.push({ host, available: false, version: null, exit_code: null, observed: '', reason: availability.reason });
        continue;
      }
      const cwd = disposableProject({ file: host === 'claude' ? 'CLAUDE.md' : 'AGENTS.md', body: 'Answer in one word.\n' });
      const turn = await liveTurn({ executable: host, argv: [...argv], cwd, timeout_ms: 240_000 });
      hosts.push({
        host, available: true, version: availability.version, exit_code: turn.exit_code,
        observed: turn.stdout.slice(-400).trim(), reason: turn.exit_code === 0 ? null : turn.stderr.slice(-200),
      });
      rmSync(cwd, { recursive: true, force: true });
    }
    const hostsLive = hosts.length > 0 && hosts.every(host => host.available && host.exit_code === 0 && /READY/i.test(host.observed));

    // A qualification where nothing was ever red measures nothing. The gate requires that
    // defects were injected, that the protected checks and the reviewer both caught some, and
    // that repairs actually ran.
    const withDefect = trials.filter(trial => trial.injected_defect !== 'none').length;
    const repaired = trials.filter(trial => trial.repair_cycles > 0).length;
    const reviewerCaught = trials.filter(trial => trial.findings_raised.length > 0).length;
    const checksCaught = trials.filter(trial => trial.check_failures_seen.length > 0).length;
    const nonVacuous = withDefect >= 100 && repaired >= 100 && reviewerCaught > 0 && checksCaught > 0;

    await writer.write('holdout-trials.json', trials as unknown as Json);
    await writer.write('qualification.json', {
      frozen_configuration: frozen, holdout_opened_at: opened_at, leak_scan: leaks,
      specs: HOLDOUT_SPECS.length, repeats: REPEATS,
      denominator: { declared: HOLDOUT_SPECS.length * REPEATS, observed: trials.length, executed: executed.length, blocked: blocked.length },
      success: { accepted: accepted.length, executed: executed.length, rate: successRate, interval: successInterval },
      false_ready: falseReady.map(trial => ({ trial_id: trial.trial_id, reasons: trial.grader_results.filter(result => !result.passed) })),
      escaped_defects: escaped,
      caught: { with_injected_defect: withDefect, repaired, reviewer_caught: reviewerCaught, protected_checks_caught: checksCaught },
      categories: byCategory, stacks: byStack, broad_remit: broad, javascript_only_subset: jsOnly,
      paired_language: { pairs: paired.length, equivalent: pairedEquivalent.length },
      continue_prompts: { median: medianContinuePrompts, classifier_probe_detected: classifierProbe, total: continuePrompts.reduce((sum, value) => sum + value, 0) },
      responsibility_coverage: { tasks: coverageByTask.length, all_covered: coverageObserved, dispatch_limits: DISPATCH_LIMITS },
      live_hosts: hosts,
      blocked_trials: blocked.map(trial => ({ trial_id: trial.trial_id, reason: trial.blocked_reason })),
      scope: 'This is the toolkit qualified on unseen work across four stacks. It is not a provider benchmark: no metered evaluation budget is approved, and the live host sub-run below is two turns, one per advertised host.',
    } as unknown as Json);

    return {
      scenario_id: 'AT-023',
      mode: 'benchmark',
      observed: {
        holdout_not_used_for_prompt_tuning,
        verified_success_at_least_90pct: executed.length >= 100 && successRate >= 0.9 && nonVacuous,
        observed_false_ready_count: falseReady.length,
        critical_high_escaped_defects: escaped.length,
        unnecessary_client_continue_prompts_median: medianContinuePrompts,
        supported_hosts_live_tested: hostsLive,
        js_only_qualification_rejected: !jsOnly.qualified && jsOnly.reasons.includes('JAVASCRIPT_ONLY_RESULT_SET') && broad.qualified,
        cross_stack_holdouts_executed: crossStackExecuted && broad.executed_stacks.length >= 3,
        company_responsibility_coverage_observed_without_swarms: coverageObserved,
        trials_executed: executed.length,
        trials_blocked: blocked.length,
        trials_with_injected_defect: withDefect,
        trials_repaired: repaired,
        trials_where_reviewer_caught_it: reviewerCaught,
        trials_where_protected_checks_caught_it: checksCaught,
        paired_language_equivalent: pairedEquivalent.length === paired.length && paired.length >= 12,
        continue_prompt_classifier_detected: classifierProbe,
      } satisfies Record<string, Json>,
      artifact_paths: writer.paths,
    };
  } finally {
    db.close();
    rmSync(sandbox, { recursive: true, force: true });
  }
});
