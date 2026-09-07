/** AT-021 executor — the adversarial suite.
 *
 * Every public mutation from docs/QUALIFICATION.md section 3 is executed against the real
 * services and its rejection recorded. These fixtures are public engineering regressions and
 * are never described as held-out proof; the held-out set is T23's, authored separately.
 */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os, { tmpdir } from 'node:os';
import path from 'node:path';
import type { Candidate, CheckDefinition, ClientRequest, Contract, Evidence as EvidenceRecord, Json, Policy, ScenarioObservation } from '../../contracts/interfaces.js';
import { digest } from '../../packages/contracts/src/canonical.js';
import { validateEntity } from '../../packages/contracts/src/validate.js';
import { ControllerDatabase } from '../../packages/state/src/database.js';
import { LifecycleService } from '../../packages/core/src/lifecycle.js';
import { checkFence } from '../../packages/state/src/leases.js';
import { snapshot } from '../../packages/workspace/src/snapshot.js';
import { checkIntegration } from '../../packages/workspace/src/integrate.js';
import { ProtectedPolicyStore } from '../../packages/verifier/src/policy.js';
import { VerificationCoordinator } from '../../packages/verifier/src/coordinator.js';
import { EvidenceSigner, TrustStore } from '../../packages/verifier/src/evidence.js';
import { decideReadiness } from '../../packages/verifier/src/verdict.js';
import { execute } from '../../packages/verifier/src/executor.js';
import { ApprovalAuthority } from '../../packages/core/src/approvals.js';
import { attest } from '../../packages/release/src/attestation.js';
import { deploy, reconcile, type Destination } from '../../packages/release/src/deploy.js';
import type { ApprovalScope } from '../../packages/release/src/approvals.js';
import { apiProbes, openBrowser, responsiveSweep, guestCheckoutJourney, type BrowserSession } from '../../packages/browser/src/journeys.js';
import { observeKeyboard, runAxe } from '../../packages/browser/src/accessibility.js';
import { ArtifactStore } from '../../packages/browser/src/artifacts.js';
import { evaluateComposite, compositeManifestDigest } from '../../packages/verification-targets/src/composite.js';
import { resolveTarget } from '../../packages/verification-targets/src/resolve.js';
import { evaluateGrounding, FIXTURE_CORPUS, UNGROUNDED_ANSWER } from '../../packages/verification-targets/src/model-evals.js';
import { BudgetLedger } from '../../packages/core/src/budget.js';
import { assessGrounding } from '../../packages/core/src/stack-grounding.js';
import { buildSwiftBinary, interactWithNativeBinary, SWIFT_PRICING_DEFECT_SOURCE } from '../../packages/verification-targets/src/native-ui.js';
import { Evidence, ROOT, attempt, attemptAsync, fixedClock } from '../harness/evidence.js';
import { startShop } from '../harness/services.js';
import { registerScenario } from '../harness/registry.js';

const PROJECT = 'project_t21';
const NOW = '2026-09-08T23:00:00.000Z';
const NODE_DIR = path.dirname(process.execPath);

type Attack = { id: string; family: string; rejected: boolean; how: string };

class NoopDestination implements Destination {
  readonly name = 'mock-destination';
  readonly calls: string[] = [];
  readonly #operations = new Map<string, string>();
  async promote(input: { artifact_digest: string; target_environment: string; idempotency_key: string }): Promise<{ operation_id: string }> {
    this.calls.push(`promote:${input.idempotency_key}`);
    const id = this.#operations.get(input.idempotency_key) ?? `op_${this.#operations.size + 1}`;
    this.#operations.set(input.idempotency_key, id);
    return { operation_id: id };
  }
  async lookup(idempotency_key: string): Promise<{ operation_id: string; state: 'IN_PROGRESS' | 'COMPLETE' | 'ABSENT' }> {
    this.calls.push(`lookup:${idempotency_key}`);
    const id = this.#operations.get(idempotency_key);
    return id === undefined ? { operation_id: '', state: 'ABSENT' } : { operation_id: id, state: 'COMPLETE' };
  }
}

registerScenario('AT-021', async (): Promise<ScenarioObservation> => {
  const writer = await Evidence.open('T21');
  const clock = fixedClock(NOW);
  const sandbox = mkdtempSync(path.join(tmpdir(), 'cm-t21-'));
  const authorityDir = path.join(sandbox, 'verifier-authority');
  const db = ControllerDatabase.open(path.join(sandbox, 'state'));
  const store = ProtectedPolicyStore.open(authorityDir);
  const trust = new TrustStore(store);
  const signer = EvidenceSigner.open({ authority_dir: authorityDir, issuer_id: 'verifier_t21', trust, now: '2026-09-08T00:00:00.000Z' });
  const authority = ApprovalAuthority.open(path.join(sandbox, 'release-authority'));
  const releaseDb = authority.raw();
  const running: Array<{ stop: () => Promise<void> }> = [];
  const attacks: Attack[] = [];
  const record = (id: string, family: string, rejected: boolean, how: string): void => { attacks.push({ id, family, rejected, how }); };
  let session: BrowserSession | null = null;
  const log: Record<string, unknown> = {};

  try {
    const service = new LifecycleService(db, { clock });
    service.registerProject({ project_id: PROJECT, registered_root_ref: `file://${sandbox}/work`, profile_id: 'discover', data_class: 'internal' });

    const workspace = path.join(sandbox, 'work');
    mkdirSync(path.join(workspace, 'checks'), { recursive: true });
    writeFileSync(path.join(workspace, 'checks/unit.mjs'), `console.log('TAP version 13');
console.log('ok 1 - shop_total');
console.log('1..1');
console.log('# tests 1');
console.log('# pass 1');
console.log('# fail 0');
console.log('# skipped 0');
`);
    writeFileSync(path.join(workspace, 'package.json'), '{"name":"candidate","private":true}\n');

    store.registerEnvironmentProfile({
      profile_id: 'candidate', required_platform: null, required_executables: ['node'],
      denied_read_paths: [authorityDir, path.join(sandbox, 'release-authority'), path.join(sandbox, 'state')],
      allowed_write_paths: [workspace], allow_home_read: false, toolchain_paths: [NODE_DIR],
      description: 'Candidate sandbox for the adversarial suite.',
    }, 'security_owner', NOW);
    const definition = store.registerDefinition({
      definition: {
        check: { check_id: 'unit', required: true, result_kind: 'tests', minimum_tests: 1, required_assertion_ids: ['shop_total'], maximum_skipped: 0 },
        argv: [process.execPath, 'checks/unit.mjs'], cwd_relative: '.', parser_id: 'tap13',
        timeout_seconds: 60, maximum_output_bytes: 65536,
        environment_profile_id: 'candidate', network_profile_id: 'deny',
      }, parser_version: '1.0.0', approved_by: 'security_owner', at: NOW,
    });
    const draft = {
      kind: 'policy' as const, schema_version: 1 as const, policy_id: 'policy_t21', project_id: PROJECT,
      policy_digest: '', requirements_revision: 1, checks: [definition.check] as CheckDefinition[],
      maximum_age_seconds: 86400, trusted_issuer_ids: ['verifier_t21'], authority: 'protected' as const,
    };
    const policy: Policy = { ...draft, policy_digest: digest(draft, 'policy_digest') };
    store.registerPolicy(policy, 'security_owner', NOW);
    const coordinator = new VerificationCoordinator({ store, issuer_id: 'verifier_t21', clock, sandbox_parent: sandbox });

    const candidate: Candidate = {
      kind: 'candidate', schema_version: 1, candidate_id: 'candidate_t21', project_id: PROJECT, run_id: 'run_t21',
      source_digest: `sha256:${'c'.repeat(64)}`, artifact_digest: `sha256:${'a'.repeat(64)}`,
      requirements_revision: 1, policy_digest: policy.policy_digest,
      environment_digest: digest({ platform: os.platform() }), created_at: NOW,
    };
    const clean = await coordinator.verify({
      project_id: PROJECT, run_id: 'run_t21', attempt_id: 'attempt_t21', candidate,
      policy_digest: policy.policy_digest, requested_check_ids: [], workspace_root: workspace,
      idempotency_key: 'verify-clean',
    });
    const cleanEvidence: EvidenceRecord = { ...clean.evidence, attempt_id: 'attempt_t21' };
    const cleanVerdict = decideReadiness({
      candidate, policy, envelope: signer.seal(cleanEvidence, 'verifier'), trust,
      now: '2026-09-08T23:05:00.000Z', expectedAttemptId: 'attempt_t21',
    });

    // ---- Evidence attacks -------------------------------------------------------------
    const sealMutated = (mutate: (evidence: Record<string, unknown>) => void): unknown => {
      const mutated = JSON.parse(JSON.stringify(cleanEvidence)) as Record<string, unknown>;
      mutate(mutated);
      try {
        return signer.seal(mutated as unknown as EvidenceRecord, 'verifier');
      } catch {
        const payload = Buffer.from(JSON.stringify(mutated), 'utf8');
        return { kind: 'signed_envelope', schema_version: 1, issuer_id: 'verifier_t21', algorithm: 'Ed25519', payload_base64: payload.toString('base64'), signature_base64: Buffer.alloc(64).toString('base64') };
      }
    };
    const verdictFor = (envelope: unknown, now = '2026-09-08T23:05:00.000Z', attemptId = 'attempt_t21'): string =>
      decideReadiness({ candidate, policy, envelope, trust, now, expectedAttemptId: attemptId }).verdict;

    record('fake-pass-report', 'evidence', verdictFor(sealMutated(evidence => { evidence['results'] = [{ check_id: 'unit', status: 'PASS' }]; })) === 'UNVERIFIED', 'a PASS string in place of counted results');
    record('required-check-skipped', 'evidence', verdictFor(sealMutated(evidence => { (evidence['results'] as Array<Record<string, unknown>>)[0]!['status'] = 'SKIPPED'; })) === 'UNVERIFIED', 'required check skipped');
    record('zero-tests-discovered', 'evidence', verdictFor(sealMutated(evidence => { const r = (evidence['results'] as Array<Record<string, unknown>>)[0]!; r['tests_total'] = 0; r['tests_passed'] = 0; })) === 'UNVERIFIED', 'zero tests discovered');
    record('stale-candidate', 'evidence', verdictFor(sealMutated(evidence => { evidence['source_digest'] = `sha256:${'9'.repeat(64)}`; })) === 'UNVERIFIED', 'source digest no longer matches the candidate');
    record('changed-protected-policy', 'evidence', verdictFor(sealMutated(evidence => { evidence['policy_digest'] = `sha256:${'8'.repeat(64)}`; })) === 'UNVERIFIED', 'policy digest changed after the fact');
    record('cross-project-evidence', 'evidence', verdictFor(sealMutated(evidence => { evidence['project_id'] = 'someone_elses_project'; })) === 'UNVERIFIED', 'evidence from another project');
    record('replayed-stale-attempt', 'evidence', verdictFor(signer.seal(cleanEvidence, 'verifier'), '2026-09-08T23:05:00.000Z', 'a_newer_attempt') === 'UNVERIFIED', 'evidence from a superseded attempt');
    record('expired-evidence', 'evidence', verdictFor(signer.seal(cleanEvidence, 'verifier'), '2026-09-11T00:00:00.000Z') === 'UNVERIFIED', 'evidence older than the policy maximum age');
    record('source-mutated-after-verification', 'evidence', verdictFor(sealMutated(evidence => { evidence['integrity_passed'] = false; })) === 'UNVERIFIED', 'source changed during verification');
    const forgedSignature = { ...(signer.seal(cleanEvidence, 'verifier')), signature_base64: Buffer.alloc(64).toString('base64') };
    record('forged-signature', 'evidence', verdictFor(forgedSignature) === 'UNVERIFIED', 'signature replaced');
    const workerSigning = attempt(() => signer.seal(cleanEvidence, 'worker'));
    record('worker-signs-evidence', 'authority', !workerSigning.ok, 'a worker asked the signer to seal evidence');

    // ---- Sandbox attacks --------------------------------------------------------------
    const secretRead = await execute({
      argv: [process.execPath, '-e', `process.stdout.write(require('fs').readFileSync(${JSON.stringify(path.join(sandbox, 'state', 'state.sqlite'))}).length + '')`],
      cwd: workspace, sandbox_root: path.join(sandbox, 'atk-secret'), timeout_seconds: 15, maximum_output_bytes: 32768,
      network_profile_id: 'deny', environment: store.environmentProfile('candidate'), observer_id: 'verifier_t21', now: clock,
    });
    record('malicious-build-reads-controller-state', 'sandbox', secretRead.exit_code !== 0, 'candidate read the controller database');
    const network = await execute({
      argv: [process.execPath, '-e', `const n=require('net');const s=n.connect(80,'1.1.1.1');s.on('error',()=>process.exit(0));s.on('connect',()=>process.exit(7));setTimeout(()=>process.exit(0),2500)`],
      cwd: workspace, sandbox_root: path.join(sandbox, 'atk-net'), timeout_seconds: 20, maximum_output_bytes: 32768,
      network_profile_id: 'deny', environment: store.environmentProfile('candidate'), observer_id: 'verifier_t21', now: clock,
    });
    record('candidate-network-escape', 'sandbox', network.exit_code === 0, 'outbound connection refused by the sandbox');
    const outside = path.join(sandbox, 'outside-the-root');
    mkdirSync(outside, { recursive: true });
    writeFileSync(path.join(outside, 'secret.txt'), 'x');
    symlinkSync(outside, path.join(workspace, 'escape-link'));
    const escape = attempt(() => snapshot(workspace, `file://${workspace}`));
    rmSync(path.join(workspace, 'escape-link'));
    record('candidate-symlink-escape', 'sandbox', !escape.ok, 'symlink out of the authorized root refused when sealing');

    // ---- Lifecycle attacks -------------------------------------------------------------
    const request: ClientRequest = {
      kind: 'client_request', schema_version: 1, request_id: 'request_t21', project_id: PROJECT,
      message: 'adversarial fixture', language_hint: 'en', attachment_ids: [], privacy_class: 'internal', created_at: NOW,
    };
    const run = await service.createRun(request, 'idem-t21');
    const contract = { ...JSON.parse(readFileSync(path.join(ROOT, 'contracts/examples/contract.json'), 'utf8')) as Contract, contract_id: 'contract_t21', project_id: PROJECT, request_ids: ['request_t21'] };
    service.recordContract(contract);
    const scoped = await service.transition({
      run_id: run.run_id, expected_version: 1, target: 'SCOPED', actor: 'controller',
      reason: 'scoped', guard_evidence_ids: [], idempotency_key: 'scope-t21',
      bind: { contract_id: contract.contract_id, requirements_revision: 1 },
    });
    service.createAttempt({
      attempt_id: 'attempt_worker', project_id: PROJECT, run_id: run.run_id, task_id: 'task_worker',
      attempt_number: 1, role: 'writer', parent_attempt_id: null, depth: 0, workspace_id: workspace,
      base_source_digest: candidate.source_digest, allowed_write_paths: ['src/'], dependency_task_ids: [],
      deadline: '2026-09-09T00:00:00.000Z', provider_session_id: null,
    });
    const leased = await service.claimTask('task_worker', 'worker_one', '2026-09-09T00:00:00.000Z');
    const beforeCancel = checkFence(db, { attempt_id: 'attempt_worker', lease_epoch: leased.lease_epoch });
    service.requestControl({ run_id: run.run_id, action: 'cancel', actor: 'controller', reason: 'client cancelled' });
    const afterCancel = checkFence(db, { attempt_id: 'attempt_worker', lease_epoch: leased.lease_epoch });
    record('orphan-cancellation-late-result', 'lifecycle', beforeCancel.accepted && !afterCancel.accepted, `late worker result refused with ${String(afterCancel.reason)}`);
    const lateIntegration = checkIntegration(db, {
      project_id: PROJECT, attempt_id: 'attempt_worker', lease_epoch: leased.lease_epoch,
      requirements_revision: 1, changed_paths: ['src/checkout.js'],
    });
    record('late-patch-integration', 'lifecycle', !lateIntegration.accepted, `integration refused with ${String(lateIntegration.reason)}`);
    const workerReady = await attemptAsync(() => service.transition({
      run_id: run.run_id, expected_version: scoped.state_version, target: 'READY_FOR_REVIEW',
      actor: 'worker', reason: 'my tests passed', guard_evidence_ids: [], idempotency_key: 'worker-ready',
    }));
    record('worker-writes-ready-state', 'authority', !workerReady.ok, 'a worker tried to set READY_FOR_REVIEW');
    const staleAnswer = attempt(() => service.answerQuestion({
      question_id: 'question_that_does_not_exist', expected_version: 1,
      request: { ...request, request_id: 'request_stale_answer' },
      authenticated_actor_id: 'owner_1', actor: 'client', idempotency_key: 'stale-answer',
    }));
    record('stale-answer', 'lifecycle', !staleAnswer.ok, 'answer to a question that does not exist');

    // ---- Budget, replay and grounding attacks -------------------------------------------
    const ledger = new BudgetLedger(db, { clock });
    ledger.setPolicy({
      project_id: PROJECT, cap_microusd: 1_000_000, verification_reserve_microusd: 400_000,
      unknown_usage_reserve_microusd: 50_000, billing_mode: 'native_account',
    }, 'maintainer');
    ledger.reserve({ project_id: PROJECT, run_id: run.run_id, attempt_id: 'attempt_worker', microusd: 500_000 });
    const overCap = attempt(() => ledger.reserve({ project_id: PROJECT, run_id: run.run_id, attempt_id: 'attempt_worker', microusd: 500_000 }));
    record('budget-exhaustion-dispatch', 'lifecycle', !overCap.ok, 'a reservation crossing the cap was refused before dispatch');
    log['budget'] = { enforcement: ledger.enforcement(), state: ledger.state(PROJECT, run.run_id), over_cap: overCap };

    const replayedJob = await service.createRun(request, 'idem-t21');
    record('replayed-job', 'lifecycle', replayedJob.run_id === run.run_id, 'a replayed job identifier returned the original run rather than starting a second one');
    const workerPolicy = attempt(() => store.registerPolicy({ ...policy, policy_id: 'policy_worker' }, 'worker' as unknown as 'security_owner', NOW));
    record('worker-registers-policy', 'authority', !workerPolicy.ok, 'a worker tried to register a protected policy');

    const versionless = assessGrounding({
      component: {
        component_id: 'pricing_native', root_ref: 'native', domain: 'native', languages: ['Swift'],
        frameworks: ['SwiftUI'], target_platforms: ['macOS'], environment_ref: null,
        grounding_status: 'NEEDS_GROUNDING', source_refs: ['native'], required_check_ids: [], capability_gaps: [],
      },
      references: [{ kind: 'first_party_documentation', ref: 'https://example.invalid/swiftui', version: null, observed_at: NOW }],
      proposed_languages: ['Swift'],
    });
    record('wrong-dependency-version-api', 'cross-stack', !versionless.grounded, 'an unversioned documentation reference did not count as grounding');
    const conversion = assessGrounding({
      component: {
        component_id: 'pricing_native', root_ref: 'native', domain: 'native', languages: ['Swift'],
        frameworks: [], target_platforms: ['macOS'], environment_ref: null,
        grounding_status: 'GROUNDED', source_refs: ['native'], required_check_ids: [], capability_gaps: [],
      },
      references: [{ kind: 'repository_file', ref: 'native/main.swift', version: '5.9', observed_at: NOW }],
      proposed_languages: ['TypeScript'],
    });
    record('toolkit-conversion', 'cross-stack', !conversion.grounded, 'rewriting the client component into the toolkit language was refused');

    // ---- Release attacks ---------------------------------------------------------------
    const destination = new NoopDestination();
    const attestation = attest({ candidate, verdict: cleanVerdict, issuer_id: 'verifier_t21', issued_at: NOW });
    const scope: ApprovalScope = {
      project_id: PROJECT, action: 'deploy', candidate_id: candidate.candidate_id,
      artifact_digest: candidate.artifact_digest, target_environment: 'staging', policy_digest: policy.policy_digest,
    };
    const requested = authority.request({
      project_id: PROJECT, requested_by: 'controller', action: 'deploy', target_environment: 'staging',
      policy_digest: policy.policy_digest, description: 'staging promotion', expires_at: '2026-09-10T00:00:00.000Z',
      now: NOW, candidate_id: candidate.candidate_id, artifact_digest: candidate.artifact_digest,
    });
    const grant = authority.decide({ approval_id: requested.approval_id, actor: 'maintainer', actor_id: 'release_owner', decision: 'approve', now: NOW }).granted_approval_id!;
    const firstDeploy = await deploy({
      db: releaseDb, destination, attestation, approval_id: grant, scope, target_environment: 'staging',
      current_policy_digest: policy.policy_digest, current_requirements_revision: 1, idempotency_key: 'deploy-1', now: NOW,
    });
    const replayedApproval = await deploy({
      db: releaseDb, destination, attestation, approval_id: grant, scope, target_environment: 'staging',
      current_policy_digest: policy.policy_digest, current_requirements_revision: 1, idempotency_key: 'deploy-2', now: NOW,
    });
    record('replayed-deploy-approval', 'release', !replayedApproval.started, `refused with ${replayedApproval.started ? '' : replayedApproval.reasons.join(',')}`);
    const workerApproval = attempt(() => authority.decide({
      approval_id: authority.request({ project_id: PROJECT, requested_by: 'worker', action: 'deploy', target_environment: 'production', policy_digest: policy.policy_digest, description: 'self approval', expires_at: '2026-09-10T00:00:00.000Z', now: NOW }).approval_id,
      actor: 'worker', actor_id: 'worker_one', decision: 'approve', now: NOW,
    }));
    record('worker-self-approval', 'authority', !workerApproval.ok, 'a worker decided its own approval request');

    // A late instruction during DEPLOYING must not silently reverse the deployment.
    const deploymentId = firstDeploy.started ? firstDeploy.deployment_id : '';
    const beforeInstruction = releaseDb.prepare('SELECT status, provider_operation_id FROM deployments WHERE deployment_id = ?').get(deploymentId) as Record<string, unknown>;
    const lateMessage = service.submitMessage({
      run_id: run.run_id, expected_version: (await service.getRun(run.run_id)).state_version,
      request: { ...request, request_id: 'request_late_instruction', message: 'Stop! Undo the deploy.' },
      authenticated_actor_id: 'owner_1', idempotency_key: 'late-instruction',
    });
    const afterInstruction = releaseDb.prepare('SELECT status, provider_operation_id FROM deployments WHERE deployment_id = ?').get(deploymentId) as Record<string, unknown>;
    const reconciled = await reconcile({ db: releaseDb, destination, deployment_id: deploymentId, now: NOW });
    record('late-instruction-reverses-deploy', 'release',
      String(beforeInstruction['status']) === String(afterInstruction['status']) && reconciled.destination_state !== 'ABSENT',
      'a stop instruction changed no deployment state; the destination was asked first');

    // ---- Semantic defects with green unit tests -----------------------------------------
    const shop = await startShop({ defect: 'negative-quantity' });
    running.push(shop);
    const negative = await apiProbes(shop.url);
    const negativeStatus = negative.probes.find(probe => probe.name === 'negative_quantity')?.status;
    record('api-accepts-negative-quantity', 'semantic', negativeStatus !== 422, `the protected API probe observed ${String(negativeStatus)} where 422 is required`);

    const cleanShop = await startShop({});
    running.push(cleanShop);
    const attacker = await apiProbes(cleanShop.url);
    const attackerTotal = (attacker.probes.find(probe => probe.name === 'attacker_price')?.body as { order?: { total_centavos?: number } } | undefined)?.order?.total_centavos;
    record('attacker-selected-price', 'semantic', attackerTotal === 5500, 'a client-supplied price did not reach the total');
    const orders = await (await fetch(`${cleanShop.url}/api/orders`)).json() as { orders: Array<{ order_id: string }> };
    const duplicateOrders = orders.orders.filter(order => order.order_id === attacker.order_id).length;
    record('duplicate-order-side-effect', 'semantic', duplicateOrders === 1, 'a replayed idempotency key produced one order');

    const opened = await openBrowser();
    if ('browser' in opened) {
      session = opened;
      const store2 = new ArtifactStore(path.join(sandbox, 'probe-artifacts'));
      const overflowShop = await startShop({ defect: 'overflow' });
      running.push(overflowShop);
      const sweep = await responsiveSweep({ session, baseURL: overflowShop.url, store: store2, name: 'overflow' });
      record('ui-fixed-width-overflow', 'semantic', sweep.layouts.some(layout => layout.viewport.width <= 390 && layout.horizontal_overflow), 'horizontal overflow measured at a phone viewport');

      const hiddenShop = await startShop({ defect: 'hidden-submit' });
      running.push(hiddenShop);
      const hidden = await guestCheckoutJourney({ session, baseURL: hiddenShop.url, store: store2, name: 'hidden' });
      record('hidden-submit-button', 'semantic', !hidden.journey.submit_operable, 'the submit control was not operable');

      const labelShop = await startShop({ defect: 'missing-label' });
      running.push(labelShop);
      const context = await session.browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await context.newPage();
      await page.goto(labelShop.url, { waitUntil: 'networkidle' });
      await page.getByTestId('add-rice').click();
      const axe = await runAxe(page);
      const keyboard = await observeKeyboard(page, '#place-order');
      await context.close();
      record('missing-control-label', 'semantic', keyboard.unnamed_controls.length > 0 || axe.violations.some(violation => /label|name/i.test(violation.id)), 'a control with no accessible name was found');
    }

    // ---- Cross-stack false-ready mutations ----------------------------------------------
    const nativeWorkspace = path.join(sandbox, 'native');
    const defectBuild = buildSwiftBinary({ source: SWIFT_PRICING_DEFECT_SOURCE, workspace: nativeWorkspace, name: 'pricing-defect' });
    const nativeResult = defectBuild.built ? interactWithNativeBinary(defectBuild.binary, ['rice 2 soap 1']) : null;
    record('native-source-mutation', 'cross-stack', nativeResult !== null && !nativeResult.responses.includes('TOTAL 13500'), `the native binary returned ${nativeResult?.responses.join(',') ?? 'nothing'} instead of the correct total`);
    const ungrounded = evaluateGrounding({ answer: UNGROUNDED_ANSWER, corpus: FIXTURE_CORPUS, corpus_revision: 'fixture-v1' });
    record('evaluator-bypassing-model-answer', 'cross-stack', !ungrounded.passed, 'a confident answer citing a document that does not contain the fact was rejected');
    const staleRetrieval = evaluateGrounding({ answer: UNGROUNDED_ANSWER, corpus: [], corpus_revision: 'fixture-v0-removed' });
    record('stale-retrieval-revision', 'cross-stack', !staleRetrieval.passed, 'a corpus revision that no longer contains the cited documents was rejected');
    const webOnly = evaluateComposite({
      requirements: [
        { component_id: 'shop-web', target: 'web', required_tools: [], evidence_must_be: 'browser', available: true, missing: [], detail: '' },
        { component_id: 'pricing-native', target: 'native-macos', required_tools: [], evidence_must_be: 'binary', available: true, missing: [], detail: '' },
      ],
      observations: [{ component_id: 'shop-web', observed_target: 'web', status: 'PASSED', evidence_ref: 'browser', detail: 'passed' }],
      manifest_digest: compositeManifestDigest({ candidate_id: candidate.candidate_id, components: [{ component_id: 'shop-web', artifact_digest: candidate.artifact_digest, interface_version: 'v1' }] }),
    });
    record('web-subset-approves-native', 'cross-stack', webOnly.verdict === 'UNVERIFIED', 'a green web subset did not approve an unobserved native component');
    const substituted = evaluateComposite({
      requirements: [resolveTarget({ component_id: 'shop-ios', root_ref: 'ios', domain: 'native', languages: ['Swift'], frameworks: [], target_platforms: ['iOS'], environment_ref: null, grounding_status: 'NEEDS_GROUNDING', source_refs: ['ios'], required_check_ids: ['ios'], capability_gaps: [] })],
      observations: [{ component_id: 'shop-ios', observed_target: 'web', status: 'PASSED', evidence_ref: 'browser', detail: 'web offered for a native target' }],
      manifest_digest: 'sha256:0',
    });
    record('web-observation-for-native-target', 'cross-stack', substituted.verdict === 'UNVERIFIED', 'a browser observation offered for an iOS component was refused');

    // ---- Contract, SQL and API invariant regressions -------------------------------------
    const invariants = [
      ['run.running_without_contract', { ...JSON.parse(readFileSync(path.join(ROOT, 'contracts/examples/run.json'), 'utf8')) as Record<string, unknown>, contract_id: null, requirements_revision: 0, state: 'RUNNING' }],
      ['approval.deploy_without_artifact', { ...JSON.parse(readFileSync(path.join(ROOT, 'contracts/examples/approval.json'), 'utf8')) as Record<string, unknown>, action: 'deploy', candidate_id: null, artifact_digest: null }],
      ['attempt.reviewer_with_write_scope', { ...JSON.parse(readFileSync(path.join(ROOT, 'contracts/examples/attempt.json'), 'utf8')) as Record<string, unknown>, role: 'reviewer', allowed_write_paths: ['src/'] }],
    ] as const;
    const invariantResults = invariants.map(([id, entity]) => ({ id, valid: validateEntity(entity).valid }));
    const sqlCrossRun = attempt(() => db.run('INSERT INTO candidates (candidate_id, project_id, run_id, source_digest, artifact_digest, requirements_revision, policy_digest, environment_digest, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      'candidate_orphan', PROJECT, 'run_that_does_not_exist', candidate.source_digest, candidate.artifact_digest, 1, policy.policy_digest, candidate.environment_digest, NOW));
    const sqlReadyWithoutCandidate = attempt(() => db.run("UPDATE runs SET state = 'READY_FOR_REVIEW' WHERE run_id = ?", run.run_id));
    const apiSpec = JSON.parse(readFileSync(path.join(ROOT, 'contracts/api.openapi.json'), 'utf8')) as { paths: Record<string, Record<string, { security?: unknown; responses?: Record<string, unknown>; requestBody?: unknown }>> };
    const answerSecurity = apiSpec.paths['/v1/questions/{question_id}/answer']?.['post']?.security;
    const mutationsHave422 = Object.entries(apiSpec.paths).every(([, item]) =>
      Object.values(item).every(operation => operation.requestBody === undefined || (operation.responses !== undefined && '422' in operation.responses)));
    const invariantsHold = invariantResults.every(entry => !entry.valid) && !sqlCrossRun.ok && !sqlReadyWithoutCandidate.ok &&
      JSON.stringify(answerSecurity) === JSON.stringify([{ clientSession: [] }]) && mutationsHave422;
    record('contract-sql-api-invariants', 'regression', invariantsHold, 'schema conditionals, SQL foreign keys and OpenAPI security/error semantics all held');
    log['invariants'] = { schema: invariantResults, sql_cross_run: sqlCrossRun, sql_ready_without_candidate: sqlReadyWithoutCandidate, answer_security: answerSecurity, mutations_have_422: mutationsHave422 };

    // ---- Roll-up ------------------------------------------------------------------------
    const failed = attacks.filter(attack => !attack.rejected);
    const byFamily = Object.fromEntries([...new Set(attacks.map(attack => attack.family))].map(family => [
      family, { total: attacks.filter(attack => attack.family === family).length, rejected: attacks.filter(attack => attack.family === family && attack.rejected).length },
    ]));
    log['attacks'] = attacks;
    log['by_family'] = byFamily;
    log['unrejected'] = failed;
    log['external_effects'] = { destination_calls: destination.calls, promote_calls: destination.calls.filter(call => call.startsWith('promote:')).length };
    log['late_instruction'] = { message_id: lateMessage.message_id, applied_revision: lateMessage.applied_requirements_revision, before: beforeInstruction, after: afterInstruction, reconciliation: reconciled };
    log['fixture_scope'] = 'These are the public mutation self-tests from docs/QUALIFICATION.md section 3. They are engineering regressions, not held-out proof; the held-out set belongs to T23 and is authored separately.';

    await writer.write('adversarial.json', log);
    await writer.write('attacks.json', attacks);

    return {
      scenario_id: 'AT-021',
      mode: 'integration',
      observed: {
        every_mandatory_public_attack_rejected: failed.length === 0,
        no_unauthorized_external_effects: destination.calls.filter(call => call.startsWith('promote:')).length === 1,
        late_worker_results_quarantined: attacks.find(attack => attack.id === 'orphan-cancellation-late-result')?.rejected === true &&
          attacks.find(attack => attack.id === 'late-patch-integration')?.rejected === true,
        semantic_defects_rejected_despite_green_unit_tests: (byFamily['semantic']?.rejected ?? 0) === (byFamily['semantic']?.total ?? -1) &&
          (byFamily['semantic']?.total ?? 0) >= 6,
        cross_stack_false_ready_mutations_rejected: (byFamily['cross-stack']?.rejected ?? 0) === (byFamily['cross-stack']?.total ?? -1) &&
          (byFamily['cross-stack']?.total ?? 0) >= 5,
        contract_sql_api_invariants_regression: invariantsHold,
        late_instruction_cannot_silently_reverse_deploy: attacks.find(attack => attack.id === 'late-instruction-reverses-deploy')?.rejected === true,
        attacks_executed: attacks.length,
        attacks_rejected: attacks.length - failed.length,
      } satisfies Record<string, Json>,
      artifact_paths: writer.paths,
    };
  } finally {
    if (session !== null) await session.browser.close().catch(() => undefined);
    for (const service of running) await service.stop().catch(() => undefined);
    authority.close();
    store.close();
    db.close();
    rmSync(sandbox, { recursive: true, force: true });
    void randomUUID;
    void createHash;
    void existsSync;
  }
});
