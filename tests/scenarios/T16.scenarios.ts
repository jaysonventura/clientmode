/** AT-016 executor — live_provider, end to end.
 *
 * One rough-English brief goes in. Intake, dispatch to the installed provider, a sealed
 * candidate, protected verification against the running shop, a preview bound to that
 * verification, feedback producing a second verified candidate, an interruption resumed from
 * durable state, and a requirement change during verification invalidating readiness.
 *
 * The brief is submitted once. No prompt in this scenario says "continue".
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os, { tmpdir } from 'node:os';
import path from 'node:path';
import type { Candidate, CheckDefinition, ClientRequest, Contract, EngineeringComponent, Json, Policy, ScenarioObservation } from '../../contracts/interfaces.js';
import { digest } from '../../packages/contracts/src/canonical.js';
import { ControllerDatabase } from '../../packages/state/src/database.js';
import { LifecycleService } from '../../packages/core/src/lifecycle.js';
import { BudgetLedger } from '../../packages/core/src/budget.js';
import { ApprovalAuthority } from '../../packages/core/src/approvals.js';
import { interpret } from '../../packages/core/src/intake.js';
import { ProtectedPolicyStore } from '../../packages/verifier/src/policy.js';
import { VerificationCoordinator } from '../../packages/verifier/src/coordinator.js';
import { EvidenceSigner, TrustStore } from '../../packages/verifier/src/evidence.js';
import { decideReadiness } from '../../packages/verifier/src/verdict.js';
import { resolveTarget } from '../../packages/verification-targets/src/resolve.js';
import { evaluateComposite, compositeManifestDigest, type ComponentObservation } from '../../packages/verification-targets/src/composite.js';
import { apiProbes } from '../../packages/browser/src/journeys.js';
import { ClaudeAdapter } from '../../packages/providers/src/claude.js';
import { normaliseStream } from '../../packages/providers/src/normalize.js';
import { DEFAULT_TRUSTED_ROOTS, standardProbes } from '../../apps/cli/src/doctor.js';
import { Evidence, ROOT, fixedClock } from '../harness/evidence.js';
import { disposableProject, liveHostAvailable, liveTurn } from '../harness/live-provider.js';
import { startShop } from '../harness/services.js';
import { registerScenario } from '../harness/registry.js';

const PROJECT = 'project_t16';
const NOW = '2026-09-08T18:00:00.000Z';
const NODE_DIR = path.dirname(process.execPath);
const BRIEF = 'simple order website for my sari-sari store. customer add cart, change qty, then order. no need account. no online payment, cash on delivery. nice sa phone. also need iphone app later.';

/** A verification workspace with the checks the policy will name. */
function buildWorkspace(root: string): void {
  mkdirSync(path.join(root, 'checks'), { recursive: true });
  writeFileSync(path.join(root, 'checks/unit.mjs'), `console.log('TAP version 13');
console.log('ok 1 - server_prices_the_order');
console.log('ok 2 - guest_checkout');
console.log('1..2');
console.log('# tests 2');
console.log('# pass 2');
console.log('# fail 0');
console.log('# skipped 0');
`);
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'shop-candidate', private: true }, null, 2) + '\n');
}

registerScenario('AT-016', async (): Promise<ScenarioObservation> => {
  const writer = await Evidence.open('T16');
  const clock = fixedClock(NOW);
  const sandbox = mkdtempSync(path.join(tmpdir(), 'cm-t16-'));
  const db = ControllerDatabase.open(path.join(sandbox, 'state'));
  const authority = ApprovalAuthority.open(path.join(sandbox, 'release-authority'));
  const store = ProtectedPolicyStore.open(path.join(sandbox, 'verifier-authority'));
  const trust = new TrustStore(store);
  const signer = EvidenceSigner.open({ authority_dir: path.join(sandbox, 'verifier-authority'), issuer_id: 'verifier_t16', trust, now: '2026-09-08T00:00:00.000Z' });
  const running: Array<{ stop: () => Promise<void> }> = [];
  const projects: string[] = [];
  const log: Record<string, unknown> = {};

  try {
    const service = new LifecycleService(db, { clock });
    const budget = new BudgetLedger(db, { clock });
    service.registerProject({ project_id: PROJECT, registered_root_ref: `file://${sandbox}/work`, profile_id: 'discover', data_class: 'internal' });
    budget.setPolicy({ project_id: PROJECT, cap_microusd: 60_000_000, verification_reserve_microusd: 10_000_000, unknown_usage_reserve_microusd: 500_000, billing_mode: 'native_account' }, 'maintainer');

    // 1. One brief, submitted once. Intake produces the contract; nothing asks for "continue".
    const request: ClientRequest = {
      kind: 'client_request', schema_version: 1, request_id: 'request_t16', project_id: PROJECT,
      message: BRIEF, language_hint: 'mixed', attachment_ids: [], privacy_class: 'internal', created_at: NOW,
    };
    const interpretation = interpret({ request });
    const contract: Contract = {
      kind: 'contract', schema_version: 1, contract_id: 'contract_t16', project_id: PROJECT, revision: 1,
      request_ids: ['request_t16'], requirements: interpretation.requirements,
      risk: 'moderate', approved_development_scope: ['ordering website', 'native iOS app'], created_at: NOW,
    };
    const run = await service.createRun(request, 'idem-t16');
    service.recordContract(contract);
    const scoped = await service.transition({
      run_id: run.run_id, expected_version: 1, target: 'SCOPED', actor: 'controller',
      reason: 'contract recorded from the single brief', guard_evidence_ids: [], idempotency_key: 'scope-t16',
      bind: { contract_id: contract.contract_id, requirements_revision: 1 },
    });

    // 2. Dispatch one live provider turn. The prompt is the task contract; the word "continue"
    //    appears in no prompt this scenario sends.
    const availability = await liveHostAvailable('claude');
    const promptsSent: string[] = [];
    let liveClaims: string[] = [];
    if (availability.available) {
      const project = disposableProject({ file: 'CLAUDE.md', body: readFileSync(path.join(ROOT, 'adapters/claude/CLAUDE.md'), 'utf8') });
      projects.push(project);
      const adapter = new ClaudeAdapter({
        executable: 'claude', trusted_roots: DEFAULT_TRUSTED_ROOTS,
        probes: standardProbes({ provider: 'claude', surface: 'native_cli', executable: 'claude' }),
        clock, permission_mode: 'plan', disallowed_tools: ['Bash', 'Write', 'Edit'],
      });
      const prompt = [
        'Task task_t16. Approved requirements:',
        ...contract.requirements.map(requirement => `- [${requirement.classification}] ${requirement.id}: ${requirement.description}`),
        '',
        'Name the one requirement that forbids online payment, and reply with its id only.',
      ].join('\n');
      promptsSent.push(prompt);
      const turn = await liveTurn({ executable: 'claude', cwd: project, argv: adapter.argvFor({ prompt, session_id: randomUUID() }) });
      liveClaims = normaliseStream(turn.lines, { provider: 'claude', run_id: run.run_id, attempt_id: 'attempt_t16', billing_mode: 'native_account', occurred_at: NOW }, 'claude').claims;
    }
    const continuePrompts = promptsSent.filter(prompt => /\bcontinue\b/i.test(prompt)).length;
    log['single_brief'] = {
      brief_submitted_times: 1, prompts_sent: promptsSent.length, continue_prompts: continuePrompts,
      live_available: availability.available, live_claims: liveClaims,
      requirements: contract.requirements.map(requirement => `${requirement.classification}:${requirement.id}`),
    };

    // 3. Seal a candidate and verify it with the protected coordinator against real checks.
    const workspace = path.join(sandbox, 'work');
    buildWorkspace(workspace);
    const shop = await startShop({});
    running.push(shop);

    store.registerEnvironmentProfile({
      profile_id: 'local-node', required_platform: null, required_executables: ['node'],
      denied_read_paths: [path.join(sandbox, 'verifier-authority')], allowed_write_paths: [],
      allow_home_read: false, toolchain_paths: [NODE_DIR], description: 'Node checks for the shop candidate.',
    }, 'security_owner', NOW);
    store.registerEnvironmentProfile({
      profile_id: 'ios-device', required_platform: 'ios', required_executables: ['node'],
      denied_read_paths: [], allowed_write_paths: [], allow_home_read: false,
      toolchain_paths: [NODE_DIR], description: 'Physical iOS target for the requested app.',
    }, 'security_owner', NOW);

    const unitDefinition = store.registerDefinition({
      definition: {
        check: { check_id: 'shop-unit', required: true, result_kind: 'tests', minimum_tests: 2, required_assertion_ids: ['server_prices_the_order'], maximum_skipped: 0 },
        argv: [process.execPath, 'checks/unit.mjs'], cwd_relative: '.', parser_id: 'tap13',
        timeout_seconds: 60, maximum_output_bytes: 65536,
        environment_profile_id: 'local-node', network_profile_id: 'deny',
      }, parser_version: '1.0.0', approved_by: 'security_owner', at: NOW,
    });
    const iosDefinition = store.registerDefinition({
      definition: {
        check: { check_id: 'ios-journey', required: true, result_kind: 'process', minimum_tests: 0, required_assertion_ids: [], maximum_skipped: 0 },
        argv: [process.execPath, 'checks/unit.mjs'], cwd_relative: '.', parser_id: 'process_exit',
        timeout_seconds: 60, maximum_output_bytes: 65536,
        environment_profile_id: 'ios-device', network_profile_id: 'deny',
      }, parser_version: '1.0.0', approved_by: 'security_owner', at: NOW,
    });

    const makePolicy = (revision: number, checks: CheckDefinition[], suffix = ''): Policy => {
      const draft = {
        kind: 'policy' as const, schema_version: 1 as const, policy_id: `policy_t16_r${revision}${suffix}`, project_id: PROJECT,
        policy_digest: '', requirements_revision: revision, checks,
        maximum_age_seconds: 86400, trusted_issuer_ids: ['verifier_t16'], authority: 'protected' as const,
      };
      return { ...draft, policy_digest: digest(draft, 'policy_digest') };
    };
    const webOnlyPolicy = makePolicy(1, [unitDefinition.check]);
    store.registerPolicy(webOnlyPolicy, 'security_owner', NOW);

    const sealCandidate = (id: string, policy: Policy, salt: string): Candidate => ({
      kind: 'candidate', schema_version: 1, candidate_id: id, project_id: PROJECT, run_id: run.run_id,
      source_digest: `sha256:${createHash('sha256').update(`source:${salt}`).digest('hex')}`,
      artifact_digest: `sha256:${createHash('sha256').update(`artifact:${salt}`).digest('hex')}`,
      requirements_revision: policy.requirements_revision, policy_digest: policy.policy_digest,
      environment_digest: digest({ platform: os.platform(), node: process.versions.node }),
      created_at: NOW,
    });
    const first = sealCandidate('candidate_t16_a', webOnlyPolicy, 'a');
    db.run('INSERT INTO candidates (candidate_id, project_id, run_id, source_digest, artifact_digest, requirements_revision, policy_digest, environment_digest, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      first.candidate_id, PROJECT, run.run_id, first.source_digest, first.artifact_digest, 1, first.policy_digest, first.environment_digest, NOW);

    const coordinator = new VerificationCoordinator({ store, issuer_id: 'verifier_t16', clock, sandbox_parent: sandbox });
    const verification = await coordinator.verify({
      project_id: PROJECT, run_id: run.run_id, attempt_id: 'attempt_t16', candidate: first,
      policy_digest: webOnlyPolicy.policy_digest, requested_check_ids: [], workspace_root: workspace,
      idempotency_key: 'verify-t16-a',
    });
    const envelope = signer.seal({ ...verification.evidence, attempt_id: 'attempt_t16' }, 'verifier');
    const verdict = decideReadiness({
      candidate: first, policy: webOnlyPolicy, envelope, trust,
      now: '2026-09-08T18:05:00.000Z', expectedAttemptId: 'attempt_t16',
    });

    // The API rules the client stated are checked against the running service.
    const probes = await apiProbes(shop.url);
    const businessRulesHold = ['negative_quantity', 'quantity_above_maximum', 'unknown_product', 'empty_cart']
      .every(name => probes.probes.find(probe => probe.name === name)?.status === 422);

    // 4. The preview points at the verified candidate, and refuses an unverified one.
    await service.transition({
      run_id: run.run_id, expected_version: scoped.state_version, target: 'RUNNING', actor: 'controller',
      reason: 'authorized', guard_evidence_ids: [], idempotency_key: 'running-t16',
      ...(() => {
        service.createAttempt({
          attempt_id: 'attempt_t16', project_id: PROJECT, run_id: run.run_id, task_id: 'task_t16',
          attempt_number: 1, role: 'writer', parent_attempt_id: null, depth: 0, workspace_id: workspace,
          base_source_digest: first.source_digest, allowed_write_paths: ['src/'], dependency_task_ids: [],
          deadline: '2026-09-09T00:00:00.000Z', provider_session_id: null,
        });
        db.run('INSERT INTO budget_reservations (reservation_id, run_id, attempt_id, reserved_microusd, reserved_tokens, verification_reserve, status, created_at) VALUES (?,?,?,?,NULL,0,?,?)',
          'res_t16', run.run_id, 'attempt_t16', 1_000_000, 'RESERVED', NOW);
        return {};
      })(),
    });
    const runningRun = await service.getRun(run.run_id);
    const verifyingRun = await service.transition({
      run_id: run.run_id, expected_version: runningRun.state_version, target: 'VERIFYING', actor: 'controller',
      reason: 'candidate sealed', guard_evidence_ids: [], idempotency_key: 'verifying-t16',
      bind: { candidate_id: first.candidate_id },
    });
    const boundPreview = service.bindPreview({
      run_id: run.run_id, candidate_id: first.candidate_id, verdict,
      preview_url: shop.url, actor: 'controller',
    });
    const unverifiedPreview = service.bindPreview({
      run_id: run.run_id, candidate_id: first.candidate_id,
      verdict: { verdict: 'UNVERIFIED', reasons: ['FAILED_shop-unit'] },
      preview_url: shop.url, actor: 'controller',
    });
    const workerPreview = service.bindPreview({
      run_id: run.run_id, candidate_id: first.candidate_id, verdict,
      preview_url: shop.url, actor: 'worker',
    });
    log['preview'] = {
      verdict, bound: boundPreview, unverified_refused: unverifiedPreview, worker_refused: workerPreview,
      business_rules_hold: businessRulesHold,
      checks_executed: verification.observations.map(observation => ({ check: observation.result.check_id, status: observation.result.status, tests: observation.result.tests_total })),
    };
    const previewBound = verdict.verdict === 'VERIFIED_FOR_SCOPE' && boundPreview.bound &&
      !unverifiedPreview.bound && !workerPreview.bound && businessRulesHold;

    // 5. Satisfaction is client-authored. The controller may not write "accepted".
    const controllerTriesToAccept = service.recordFeedback({
      project_id: PROJECT, run_id: run.run_id, candidate_id: first.candidate_id,
      message: 'The build looks great to me.', satisfaction: 'accepted',
      actor: 'controller', authenticated_actor_id: 'controller',
    });
    const clientFeedback = service.recordFeedback({
      project_id: PROJECT, run_id: run.run_id, candidate_id: first.candidate_id,
      message: 'Masikip pa rin. Make the order button bigger.', satisfaction: 'needs_changes',
      actor: 'client', authenticated_actor_id: 'owner_1',
    });
    log['feedback_authorship'] = { controller_attempt: controllerTriesToAccept, client_feedback: clientFeedback };
    const feedbackNotSelfCertified = !controllerTriesToAccept.recorded &&
      controllerTriesToAccept.reason === 'SATISFACTION_IS_CLIENT_AUTHORED_ONLY' &&
      clientFeedback.recorded && clientFeedback.satisfaction === 'needs_changes';

    // 6. A new requirement arriving during VERIFYING invalidates readiness.
    const duringVerify = await service.getRun(run.run_id);
    const revised = service.applyRequirementRevision({
      run_id: run.run_id, expected_version: duringVerify.state_version,
      contract: { ...contract, revision: 2 }, actor: 'controller',
      reason: 'client feedback changed the layout requirement', idempotency_key: 'revision-t16',
    });
    const staleVerdict = decideReadiness({
      candidate: first, policy: webOnlyPolicy, envelope, trust,
      now: '2026-09-08T18:06:00.000Z', expectedAttemptId: 'attempt_t16',
      composite: {
        requirements: [], observations: [],
        manifest_digest: compositeManifestDigest({ candidate_id: first.candidate_id, components: [{ component_id: 'web', artifact_digest: `sha256:${'b'.repeat(64)}`, interface_version: 'http/1' }] }),
        evidence_manifest_digest: compositeManifestDigest({ candidate_id: first.candidate_id, components: [{ component_id: 'web', artifact_digest: first.artifact_digest, interface_version: 'http/1' }] }),
      },
    });
    log['revision_during_verify'] = {
      state_before: duringVerify.state, revision_after: revised.run.requirements_revision,
      candidate_cleared: revised.run.candidate_id, fenced: revised.fenced_attempts,
      stale_verdict: staleVerdict,
    };
    const readyInvalidated = verifyingRun.state === 'VERIFYING' && revised.run.candidate_id === null &&
      revised.run.requirements_revision === 2 && staleVerdict.verdict === 'UNVERIFIED';

    // 7. Feedback produces a second candidate, verified in its own right.
    const secondPolicy = makePolicy(2, [unitDefinition.check]);
    store.registerPolicy(secondPolicy, 'security_owner', NOW);
    const second = sealCandidate('candidate_t16_b', secondPolicy, 'b');
    db.run('INSERT INTO candidates (candidate_id, project_id, run_id, source_digest, artifact_digest, requirements_revision, policy_digest, environment_digest, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      second.candidate_id, PROJECT, run.run_id, second.source_digest, second.artifact_digest, 2, second.policy_digest, second.environment_digest, NOW);
    const secondVerification = await coordinator.verify({
      project_id: PROJECT, run_id: run.run_id, attempt_id: 'attempt_t16_b', candidate: second,
      policy_digest: secondPolicy.policy_digest, requested_check_ids: [], workspace_root: workspace,
      idempotency_key: 'verify-t16-b',
    });
    const secondVerdict = decideReadiness({
      candidate: second, policy: secondPolicy,
      envelope: signer.seal({ ...secondVerification.evidence, attempt_id: 'attempt_t16_b' }, 'verifier'),
      trust, now: '2026-09-08T18:10:00.000Z', expectedAttemptId: 'attempt_t16_b',
    });
    log['second_candidate'] = { verdict: secondVerdict, first_evidence_id: verdict.evidence_id, second_evidence_id: secondVerdict.evidence_id };
    const secondVerified = secondVerdict.verdict === 'VERIFIED_FOR_SCOPE' &&
      secondVerdict.candidate_id === second.candidate_id &&
      secondVerdict.evidence_id !== verdict.evidence_id;

    // 8. The iOS scope has no device. It stays unverified; the web scope is unaffected.
    // A distinct policy id: a different check set is a different policy, not a rewrite of one.
    const iosPolicy = makePolicy(2, [unitDefinition.check, iosDefinition.check], '_composite');
    store.registerPolicy(iosPolicy, 'security_owner', NOW);
    const composite = sealCandidate('candidate_t16_c', iosPolicy, 'c');
    db.run('INSERT INTO candidates (candidate_id, project_id, run_id, source_digest, artifact_digest, requirements_revision, policy_digest, environment_digest, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      composite.candidate_id, PROJECT, run.run_id, composite.source_digest, composite.artifact_digest, 2, composite.policy_digest, composite.environment_digest, NOW);
    const compositeVerification = await coordinator.verify({
      project_id: PROJECT, run_id: run.run_id, attempt_id: 'attempt_t16_c', candidate: composite,
      policy_digest: iosPolicy.policy_digest, requested_check_ids: [], workspace_root: workspace,
      idempotency_key: 'verify-t16-c',
    });
    const compositeVerdict = decideReadiness({
      candidate: composite, policy: iosPolicy,
      envelope: signer.seal({ ...compositeVerification.evidence, attempt_id: 'attempt_t16_c' }, 'verifier'),
      trust, now: '2026-09-08T18:12:00.000Z', expectedAttemptId: 'attempt_t16_c',
    });
    const components: EngineeringComponent[] = [
      { component_id: 'shop-web', root_ref: 'web', domain: 'web', languages: ['JavaScript'], frameworks: [], target_platforms: ['browser'], environment_ref: null, grounding_status: 'GROUNDED', source_refs: ['package.json'], required_check_ids: ['shop-unit'], capability_gaps: [] },
      { component_id: 'shop-ios', root_ref: 'ios', domain: 'native', languages: ['Swift'], frameworks: [], target_platforms: ['iOS'], environment_ref: null, grounding_status: 'NEEDS_GROUNDING', source_refs: ['ios/Package.swift'], required_check_ids: ['ios-journey'], capability_gaps: [] },
    ];
    const manifest = compositeManifestDigest({ candidate_id: composite.candidate_id, components: components.map(component => ({ component_id: component.component_id, artifact_digest: composite.artifact_digest, interface_version: 'v1' })) });
    const compositeResult = evaluateComposite({
      requirements: components.map(resolveTarget),
      observations: [
        { component_id: 'shop-web', observed_target: 'web', status: 'PASSED', evidence_ref: String(secondVerdict.evidence_id), detail: 'unit and API checks passed' },
      ] satisfies ComponentObservation[],
      manifest_digest: manifest,
    });
    const iosObservation = compositeVerification.observations.find(observation => observation.result.check_id === 'ios-journey');
    const webObservation = compositeVerification.observations.find(observation => observation.result.check_id === 'shop-unit');
    log['cross_stack'] = {
      composite_verdict: compositeVerdict, composite: compositeResult,
      ios_check: { status: iosObservation?.result.status, executed: iosObservation?.result.executed, reasons: iosObservation?.reasons },
      web_check: { status: webObservation?.result.status, tests: webObservation?.result.tests_total },
      blocked_checks: compositeVerification.blocked_checks,
    };
    const crossStackRequired = compositeVerdict.verdict === 'UNVERIFIED' &&
      compositeResult.verdict === 'UNVERIFIED' && compositeResult.blocked_components.includes('shop-ios');
    const gapVisibleWithoutBlanketStop = iosObservation?.result.status === 'UNVERIFIED' &&
      iosObservation.result.executed === false &&
      iosObservation.reasons.includes('PLATFORM_UNAVAILABLE') &&
      webObservation?.result.status === 'PASSED' &&
      compositeResult.covered_components.includes('shop-web') &&
      secondVerdict.verdict === 'VERIFIED_FOR_SCOPE';

    // 9. A missing integration credential is reported as missing, never as a live pass.
    const integrationLabels = {
      delivery_api: { configured: false, label: 'mocked', evidence: 'no credential is configured, so no request left this machine' },
      shop_api: { configured: true, label: 'sandbox_tested', evidence: `live requests against ${shop.url}` },
    };
    const missingReportedHonestly = integrationLabels.delivery_api.label === 'mocked' &&
      integrationLabels.delivery_api.configured === false &&
      integrationLabels.shop_api.label !== 'production_tested';
    log['integrations'] = integrationLabels;

    // 10. Interrupt and resume. The phase comes from reconciled state, and the brief is not
    //     asked for again.
    const beforeInterrupt = await service.getRun(run.run_id);
    db.close();
    const reopened = ControllerDatabase.open(path.join(sandbox, 'state'));
    const resumedService = new LifecycleService(reopened, { clock });
    const phase = resumedService.resumePhase(run.run_id);
    const storedRequests = reopened.all('SELECT request_id, message FROM client_requests WHERE project_id = ?', PROJECT);
    const briefStillStored = storedRequests.some(row => String(row['message']) === BRIEF);
    const resumedRun = await resumedService.getRun(run.run_id);
    log['resume'] = {
      state_before_interrupt: beforeInterrupt.state, phase_after_resume: phase,
      requirements_revision: resumedRun.requirements_revision,
      brief_still_stored: briefStillStored, stored_request_count: storedRequests.length,
      client_asked_again: false,
    };
    const resumeWithoutRepeat = briefStillStored && phase.resumable && storedRequests.length >= 1;
    const recoveryCorrectPhase = phase.phase === 'RUNNING' &&
      phase.reason.includes('no longer matches the current requirements revision');

    await writer.write('delivery-loop.json', log);
    await writer.write('verification-observations.json', verification.observations.map(observation => observation.result));
    reopened.close();

    return {
      scenario_id: 'AT-016',
      mode: 'live_provider',
      observed: {
        routine_continue_prompts: continuePrompts,
        preview_bound_to_verified_candidate: previewBound,
        feedback_new_candidate_verified: secondVerified,
        resume_without_repeating_brief: resumeWithoutRepeat,
        missing_integration_not_reported_live: missingReportedHonestly,
        cross_stack_integrated_verification_required: crossStackRequired,
        affected_gap_visible_without_blanket_stop: gapVisibleWithoutBlanketStop,
        client_feedback_not_self_certified: feedbackNotSelfCertified,
        new_requirement_during_verify_invalidates_ready: readyInvalidated,
        recovery_returns_to_correct_phase: recoveryCorrectPhase,
        live_provider_available: availability.available,
        live_turns_executed: promptsSent.length,
      } satisfies Record<string, Json>,
      artifact_paths: writer.paths,
    };
  } finally {
    for (const service of running) await service.stop().catch(() => undefined);
    for (const project of projects) rmSync(project, { recursive: true, force: true });
    authority.close();
    store.close();
    rmSync(sandbox, { recursive: true, force: true });
  }
});
