/** AT-024 executor — base software release rehearsal.
 *
 * This is a rehearsal of the release path, not a release. Both distributions are built from
 * this tree, archived, checksummed, installed from the archive into a path containing a space
 * and a non-ASCII character, loaded by both live hosts, exercised end to end through the
 * controller, then rolled back to a byte-identical tree.
 *
 * Nothing is published, nothing is deployed to a real destination, and the four signoff paths
 * are exercised to show that holding one of them does not grant another.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os, { tmpdir } from 'node:os';
import path from 'node:path';
import type { Candidate, ClientRequest, Contract, Json, Policy, ScenarioObservation } from '../../contracts/interfaces.js';
import { digest } from '../../packages/contracts/src/canonical.js';
import { ControllerDatabase } from '../../packages/state/src/database.js';
import { LifecycleService } from '../../packages/core/src/lifecycle.js';
import { ApprovalAuthority } from '../../packages/core/src/approvals.js';
import { buildDistribution, validateManifest } from '../../packages/packaging/src/build.js';
import { applyInstall, approve, fingerprintTree, planInstall, uninstall } from '../../packages/packaging/src/install.js';
import { buildInventory } from '../../packages/release/src/inventory.js';
import { reviewPublication, signoffSeparation, type Signoff } from '../../packages/release/src/publication.js';
import { attest } from '../../packages/release/src/attestation.js';
import { deploy, type Destination } from '../../packages/release/src/deploy.js';
import type { ApprovalScope } from '../../packages/release/src/approvals.js';
import { ProtectedPolicyStore } from '../../packages/verifier/src/policy.js';
import { VerificationCoordinator } from '../../packages/verifier/src/coordinator.js';
import { EvidenceSigner, TrustStore } from '../../packages/verifier/src/evidence.js';
import { decideReadiness } from '../../packages/verifier/src/verdict.js';
import { Evidence, ROOT, attempt, fixedClock } from '../harness/evidence.js';
import { liveHostAvailable, liveTurn } from '../harness/live-provider.js';
import { registerScenario } from '../harness/registry.js';

const PROJECT = 'project_t24';
const NOW = '2026-09-09T04:00:00.000Z';
const VERSION = '1.3.0-rc1';
const NODE_DIR = path.dirname(process.execPath);
/** A space and a non-ASCII character, because installed paths have both. */
const INSTALL_LEAF = 'Client Mode ñ';

class MockDestination implements Destination {
  readonly name = 'rehearsal-destination';
  readonly promotions: string[] = [];
  async promote(input: { artifact_digest: string; target_environment: string; idempotency_key: string }): Promise<{ operation_id: string }> {
    this.promotions.push(`${input.target_environment}:${input.artifact_digest}`);
    return { operation_id: `op_${this.promotions.length}` };
  }
  async lookup(): Promise<{ operation_id: string; state: 'IN_PROGRESS' | 'COMPLETE' | 'ABSENT' }> {
    return { operation_id: '', state: 'ABSENT' };
  }
}

registerScenario('AT-024', async (): Promise<ScenarioObservation> => {
  const writer = await Evidence.open('T24');
  const clock = fixedClock(NOW);
  const sandbox = mkdtempSync(path.join(tmpdir(), 'cm-t24-'));
  const authorityDir = path.join(sandbox, 'verifier-authority');
  const db = ControllerDatabase.open(path.join(sandbox, 'state'));
  const store = ProtectedPolicyStore.open(authorityDir);
  const trust = new TrustStore(store);
  const signer = EvidenceSigner.open({ authority_dir: authorityDir, issuer_id: 'verifier_t24', trust, now: NOW });
  const authority = ApprovalAuthority.open(path.join(sandbox, 'release-authority'));

  try {
    // Recorded before anything else, so this task's own evidence directory exists when the
    // traceability sweep below asks whether every base task produced artifacts.
    await writer.write('rehearsal-started.json', { scenario_id: 'AT-024', version: VERSION, started_at: NOW });

    // ---- 1. Freeze the artifacts: build, archive, checksum ---------------------------------
    const outRoot = path.join(sandbox, 'dist');
    const distributions = (['claude', 'codex'] as const).map(provider => {
      const distribution = buildDistribution({ provider, source_root: ROOT, out_root: outRoot, version: VERSION });
      validateManifest(provider, distribution.manifest_path, distribution.root);
      const archive = path.join(sandbox, `client-mode-${provider}-${VERSION}.tar`);
      execFileSync('/usr/bin/tar', ['-cf', archive, '-C', path.dirname(distribution.root), path.basename(distribution.root)]);
      return { distribution, archive };
    });
    const checksums = distributions.map(entry => ({
      provider: entry.distribution.provider,
      archive: path.basename(entry.archive),
      archive_digest: `sha256:${createHash('sha256').update(readFileSync(entry.archive)).digest('hex')}`,
      distribution_digest: entry.distribution.distribution_digest,
      self_contained: entry.distribution.self_contained,
    }));
    writeFileSync(path.join(sandbox, 'SHA256SUMS'), checksums.map(entry => `${entry.archive_digest.slice(7)}  ${entry.archive}`).join('\n') + '\n');

    // ---- 2. Fresh-machine install from the archive -----------------------------------------
    const machine = path.join(sandbox, 'fresh-machine');
    const installRoot = path.join(machine, INSTALL_LEAF);
    mkdirSync(installRoot, { recursive: true });
    // Configuration that was already on the machine and must survive.
    writeFileSync(path.join(installRoot, 'existing-settings.json'), '{"theme":"dark"}\n');
    const before = fingerprintTree(installRoot);

    const installs = distributions.map(entry => {
      const unpacked = path.join(sandbox, 'unpacked', entry.distribution.provider);
      mkdirSync(unpacked, { recursive: true });
      execFileSync('/usr/bin/tar', ['-xf', entry.archive, '-C', unpacked]);
      const unpackedRoot = path.join(unpacked, path.basename(entry.distribution.root));
      const reDigest = digest(entry.distribution.files.map(file => ({
        path: file.path,
        digest: `sha256:${createHash('sha256').update(readFileSync(path.join(unpackedRoot, file.path))).digest('hex')}`,
      })));
      const declared = digest(entry.distribution.files.map(file => ({ path: file.path, digest: file.digest })));
      const plan = approve(planInstall({ distribution: { ...entry.distribution, root: unpackedRoot }, install_root: installRoot }));
      const record = applyInstall({ plan, distribution: { ...entry.distribution, root: unpackedRoot }, now: NOW });
      return { provider: entry.distribution.provider, unpacked_matches_checksums: reDigest === declared, plan, record };
    });
    const checksumsVerified = installs.every(entry => entry.unpacked_matches_checksums);
    const settingsSurvived = readFileSync(path.join(installRoot, 'existing-settings.json'), 'utf8') === '{"theme":"dark"}\n';

    // ---- 3. Both adapters load in fresh live sessions ---------------------------------------
    const adapters: Array<{ host: string; version: string | null; loaded: boolean; exit_code: number | null; observed: string; reason: string | null }> = [];
    for (const [host, instructionFile] of [['claude', 'CLAUDE.md'], ['codex', 'AGENTS.md']] as const) {
      const availability = await liveHostAvailable(host);
      if (!availability.available) {
        adapters.push({ host, version: null, loaded: false, exit_code: null, observed: '', reason: availability.reason });
        continue;
      }
      const project = path.join(sandbox, 'adapter-project', host);
      mkdirSync(project, { recursive: true });
      writeFileSync(path.join(project, instructionFile), readFileSync(path.join(ROOT, 'adapters', host, instructionFile), 'utf8'));
      const argv = host === 'claude'
        ? ['-p', 'Print only the marker string that your project instructions tell you to print.', '--permission-mode', 'plan', '--disallowedTools', 'Bash', 'Write', 'Edit']
        : ['exec', 'Print only the marker string that your project instructions tell you to print.', '--sandbox', 'read-only', '--skip-git-repo-check'];
      const turn = await liveTurn({ executable: host, argv, cwd: project, timeout_ms: 240_000 });
      adapters.push({
        host, version: availability.version,
        loaded: turn.exit_code === 0 && turn.stdout.includes('CLIENT_MODE_INSTRUCTIONS_LOADED'),
        exit_code: turn.exit_code, observed: turn.stdout.slice(-300).trim(),
        reason: turn.exit_code === 0 ? null : turn.stderr.slice(-200),
      });
    }
    const bothAdaptersQualified = adapters.length === 2 && adapters.every(adapter => adapter.loaded);

    // ---- 4. A supported client request, end to end ------------------------------------------
    const service = new LifecycleService(db, { clock });
    service.registerProject({ project_id: PROJECT, registered_root_ref: `file://${sandbox}/work`, profile_id: 'web-typescript', data_class: 'internal' });
    const workspace = path.join(sandbox, 'work');
    mkdirSync(path.join(workspace, 'checks'), { recursive: true });
    writeFileSync(path.join(workspace, 'checks/unit.mjs'), `console.log('TAP version 13');
console.log('ok 1 - release_rehearsal');
console.log('1..1');
console.log('# tests 1');
console.log('# pass 1');
console.log('# fail 0');
console.log('# skipped 0');
`);
    writeFileSync(path.join(workspace, 'package.json'), '{"name":"pilot","private":true}\n');
    store.registerEnvironmentProfile({
      profile_id: 'candidate', required_platform: null, required_executables: ['node'],
      denied_read_paths: [authorityDir, path.join(sandbox, 'release-authority')],
      allowed_write_paths: [workspace], allow_home_read: false, toolchain_paths: [NODE_DIR],
      description: 'Release rehearsal candidate sandbox.',
    }, 'security_owner', NOW);
    const definition = store.registerDefinition({
      definition: {
        check: { check_id: 'unit', required: true, result_kind: 'tests', minimum_tests: 1, required_assertion_ids: ['release_rehearsal'], maximum_skipped: 0 },
        argv: [process.execPath, 'checks/unit.mjs'], cwd_relative: '.', parser_id: 'tap13',
        timeout_seconds: 60, maximum_output_bytes: 65_536,
        environment_profile_id: 'candidate', network_profile_id: 'deny',
      }, parser_version: '1.0.0', approved_by: 'security_owner', at: NOW,
    });
    const draft = {
      kind: 'policy' as const, schema_version: 1 as const, policy_id: 'policy_t24', project_id: PROJECT,
      policy_digest: '', requirements_revision: 1, checks: [definition.check],
      maximum_age_seconds: 86_400, trusted_issuer_ids: ['verifier_t24'], authority: 'protected' as const,
    };
    const policy: Policy = { ...draft, policy_digest: digest(draft, 'policy_digest') };
    store.registerPolicy(policy, 'security_owner', NOW);

    const request: ClientRequest = {
      kind: 'client_request', schema_version: 1, request_id: 'request_t24', project_id: PROJECT,
      message: 'i want customers to be able to order rice from their phone', language_hint: 'mixed',
      attachment_ids: [], privacy_class: 'internal', created_at: NOW,
    };
    const run = await service.createRun(request, 'idem-t24');
    const contract = { ...JSON.parse(readFileSync(path.join(ROOT, 'contracts/examples/contract.json'), 'utf8')) as Contract, contract_id: 'contract_t24', project_id: PROJECT, request_ids: ['request_t24'] };
    service.recordContract(contract);
    await service.transition({
      run_id: run.run_id, expected_version: 1, target: 'SCOPED', actor: 'controller',
      reason: 'scoped from the client message', guard_evidence_ids: [], idempotency_key: 'scope-t24',
      bind: { contract_id: contract.contract_id, requirements_revision: 1 },
    });
    const coordinator = new VerificationCoordinator({ store, issuer_id: 'verifier_t24', clock, sandbox_parent: sandbox });
    const created_at = clock();
    const candidate: Candidate = {
      kind: 'candidate', schema_version: 1, candidate_id: 'candidate_t24', project_id: PROJECT, run_id: run.run_id,
      source_digest: digest({ pilot: 'rice' }), artifact_digest: digest({ artifact: 'rice' }),
      requirements_revision: 1, policy_digest: policy.policy_digest,
      environment_digest: digest({ platform: os.platform() }), created_at,
    };
    db.run('INSERT INTO candidates (candidate_id, project_id, run_id, source_digest, artifact_digest, requirements_revision, policy_digest, environment_digest, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      candidate.candidate_id, PROJECT, run.run_id, candidate.source_digest, candidate.artifact_digest,
      1, candidate.policy_digest, candidate.environment_digest, created_at);
    const verified = await coordinator.verify({
      project_id: PROJECT, run_id: run.run_id, attempt_id: 'attempt_t24', candidate,
      policy_digest: policy.policy_digest, requested_check_ids: [], workspace_root: workspace,
      idempotency_key: 'verify-t24',
    });
    const verdict = decideReadiness({
      candidate, policy, envelope: signer.seal({ ...verified.evidence, attempt_id: 'attempt_t24' }, 'verifier'),
      trust, now: clock(), expectedAttemptId: 'attempt_t24',
    });
    const requestCompleted = verdict.verdict === 'VERIFIED_FOR_SCOPE';

    // ---- 5. Staged rollout, then rollback ----------------------------------------------------
    const destination = new MockDestination();
    const releaseDb = authority.raw();
    const attestation = attest({ candidate, verdict, issuer_id: 'verifier_t24', issued_at: NOW });
    const scopeFor = (environment: string): ApprovalScope => ({
      project_id: PROJECT, action: 'deploy', candidate_id: candidate.candidate_id,
      artifact_digest: candidate.artifact_digest, target_environment: environment, policy_digest: policy.policy_digest,
    });
    // Staging is approved. Production is not, and is attempted anyway.
    const stagingRequest = authority.request({
      project_id: PROJECT, requested_by: 'controller', action: 'deploy', target_environment: 'staging',
      policy_digest: policy.policy_digest, description: 'staged rollout rehearsal', expires_at: '2026-09-11T00:00:00.000Z',
      now: NOW, candidate_id: candidate.candidate_id, artifact_digest: candidate.artifact_digest,
    });
    const stagingApproval = authority.decide({ approval_id: stagingRequest.approval_id, actor: 'release', actor_id: 'release_owner', decision: 'approve', now: NOW }).granted_approval_id!;
    const staged = await deploy({
      db: releaseDb, destination, attestation, approval_id: stagingApproval, scope: scopeFor('staging'),
      target_environment: 'staging', current_policy_digest: policy.policy_digest,
      current_requirements_revision: 1, idempotency_key: 'rollout-staging', now: NOW,
    });
    // Two ways a production promotion is attempted without authority: with no approval at
    // all, and by reusing the staging grant. Both are recorded.
    const productionNoApproval = await deploy({
      db: releaseDb, destination, attestation, approval_id: 'approval_that_was_never_granted',
      scope: scopeFor('production'), target_environment: 'production',
      current_policy_digest: policy.policy_digest, current_requirements_revision: 1,
      idempotency_key: 'rollout-production-unapproved', now: NOW,
    });
    const productionWithoutApproval = await deploy({
      db: releaseDb, destination, attestation, approval_id: stagingApproval, scope: scopeFor('production'),
      target_environment: 'production', current_policy_digest: policy.policy_digest,
      current_requirements_revision: 1, idempotency_key: 'rollout-production', now: NOW,
    });
    const productionRefused = !productionNoApproval.started && !productionWithoutApproval.started;
    const productionNeverPromoted = !destination.promotions.some(promotion => promotion.startsWith('production:'));

    // Rollback: uninstall both distributions and compare the tree byte for byte.
    for (const entry of [...installs].reverse()) uninstall(entry.record);
    const after = fingerprintTree(installRoot);
    const rolledBack = JSON.stringify(before) === JSON.stringify(after);

    // ---- 6. Inventory ------------------------------------------------------------------------
    const gateNames = Array.from({ length: 24 }, (_, index) => `AT-${String(index + 1).padStart(3, '0')}`);
    const inventory = buildInventory({
      source_root: ROOT, generated_at: NOW,
      artifacts: distributions.map((entry, index) => ({
        provider: entry.distribution.provider, version: VERSION,
        distribution_digest: entry.distribution.distribution_digest,
        files: entry.distribution.files.length, archive_path: distributions[index]!.archive,
      })),
      supported_versions: {
        node: process.versions.node, platform: `${os.platform()}-${os.arch()}`, os_release: os.release(),
        claude: adapters.find(adapter => adapter.host === 'claude')?.version ?? 'unavailable',
        codex: adapters.find(adapter => adapter.host === 'codex')?.version ?? 'unavailable',
      },
      gate_names: gateNames,
    });

    // ---- 7. Publication: remit and measured qualification, separately ------------------------
    const documents = ['docs/RELEASE_REMIT.md', 'docs/QUALIFICATION_MEASURED.md', 'docs/CLIENT_GUIDE.md', 'SUPPORT.md']
      .map(name => ({ name, text: readFileSync(path.join(ROOT, name), 'utf8') }));
    const measured = {
      observed: [
        { subject: 'Swift', evidence_ref: 'AT-023' }, { subject: 'Python', evidence_ref: 'AT-023' },
        { subject: 'Rust', evidence_ref: 'AT-023' }, { subject: 'TypeScript', evidence_ref: 'AT-023' },
        { subject: 'macOS', evidence_ref: 'AT-023' }, { subject: 'Chromium', evidence_ref: 'AT-014' },
      ],
      not_observed: ['Windows', 'Linux', 'Android', 'iOS', 'Go', 'Kotlin'],
    };
    const claimable = ['Swift', 'Python', 'Rust', 'TypeScript', 'macOS', 'Chromium', 'Windows', 'Linux', 'Android', 'iOS', 'Go', 'Kotlin'];
    const publication = reviewPublication({ documents, measured, claimable_subjects: claimable });
    const marketing = reviewPublication({
      documents: [{
        name: 'rejected-marketing.md',
        text: 'Client Mode works on any stack and every platform.\nThe shop fixture passes, so the toolkit is production-ready for everything.\nIt is the best autonomous engineer available and never fails.\nFully qualified on Windows, Linux and Android.',
      }],
      measured, claimable_subjects: claimable,
    });
    const remitSeparate = publication.publishable && !marketing.publishable &&
      marketing.findings.some(finding => finding.rule === 'UNIVERSAL_CLAIM') &&
      marketing.findings.some(finding => finding.rule === 'SUPERLATIVE') &&
      marketing.findings.some(finding => finding.rule === 'UNMEASURED_SUBJECT') &&
      documents.some(document => document.name.includes('RELEASE_REMIT')) &&
      documents.some(document => document.name.includes('QUALIFICATION_MEASURED'));

    // ---- 8. Four separate signoffs ------------------------------------------------------------
    const qualificationSignature = signer.seal({
      ...verified.evidence, attempt_id: 'attempt_t24',
    }, 'verifier');
    const clientAcceptance = service.recordFeedback({
      project_id: PROJECT, run_id: run.run_id, candidate_id: candidate.candidate_id,
      message: 'ok na siya, salamat', satisfaction: 'accepted', actor: 'client', authenticated_actor_id: 'owner_1',
    });
    const workerAcceptance = service.recordFeedback({
      project_id: PROJECT, run_id: run.run_id, candidate_id: candidate.candidate_id,
      message: 'looks good to me', satisfaction: 'accepted', actor: 'worker', authenticated_actor_id: 'worker_one',
    });
    // Holding client acceptance does not authorise a deployment.
    const deployOnClientAcceptance = authority.authorize({
      project_id: PROJECT, action: 'deploy', target_environment: 'production',
      candidate_id: candidate.candidate_id, artifact_digest: candidate.artifact_digest,
      requested_by: 'controller', now: NOW,
    });
    // Holding a deploy approval does not make the client satisfied, and does not seal evidence.
    const workerSeal = attempt(() => signer.seal({ ...verified.evidence, attempt_id: 'attempt_t24' }, 'worker'));
    const signoffs: Signoff[] = [
      { path: 'toolkit_qualification', authority: 'engineering, QA and the security owner', store: 'verifier-authority', granted: true, actor: 'security_owner', reference: policy.policy_digest },
      { path: 'deliverable_technical_readiness', authority: 'protected verifier', store: 'verifier-evidence', granted: requestCompleted, actor: 'verifier_t24', reference: verdict.verdict === 'VERIFIED_FOR_SCOPE' ? (verdict.evidence_id ?? '') : '' },
      { path: 'client_acceptance', authority: 'the authenticated client', store: 'controller-state', granted: clientAcceptance.recorded, actor: 'owner_1', reference: clientAcceptance.recorded ? clientAcceptance.feedback_id : '' },
      { path: 'production_release', authority: 'the release owner', store: 'release-authority', granted: staged.started, actor: 'release_owner', reference: stagingApproval },
    ];
    const separation = signoffSeparation(signoffs);
    const signoffsSeparate = separation.separate && !workerAcceptance.recorded &&
      !deployOnClientAcceptance.authorized && !workerSeal.ok;

    // ---- 9. The client is never asked to manage Markdown or agents ----------------------------
    const clientTouchedFiles = installs.flatMap(entry => entry.plan.changes.map(change => change.target));
    const clientGuide = readFileSync(path.join(ROOT, 'docs/CLIENT_GUIDE.md'), 'utf8');
    const consoleSource = ['apps/console/src/app/App.tsx', 'apps/console/src/features/RunView.tsx', 'apps/console/src/features/Preview.tsx']
      .map(file => readFileSync(path.join(ROOT, file), 'utf8')).join('\n');
    const clientActions = [...consoleSource.matchAll(/\/v1\/[A-Za-z0-9/${}_.-]+/g)]
      .map(match => match[0].replace(/\$\{[^}]*\}/g, ':id').replace(/\?.*$/, ''));
    const clientNotManaging = {
      guide_states_no_markdown: /never have to do/i.test(clientGuide) && /Write or maintain any Markdown file/i.test(clientGuide),
      guide_states_no_agents: /Choose, name, configure or supervise agents/i.test(clientGuide),
      client_authors_no_files: clientTouchedFiles.every(file => !file.includes('/skills/') || file.startsWith(installRoot)),
      console_actions: [...new Set(clientActions)],
      console_has_no_agent_management: !/agent|worker|subagent/i.test(consoleSource),
      console_has_no_markdown_editor: !/markdown|\.md\b/i.test(consoleSource),
    };
    const clientNotRequiredToManage = clientNotManaging.guide_states_no_markdown &&
      clientNotManaging.guide_states_no_agents && clientNotManaging.console_has_no_agent_management &&
      clientNotManaging.console_has_no_markdown_editor && clientNotManaging.console_actions.length >= 4;

    // ---- 10. Traceability: evidence or an explicit no-go ---------------------------------------
    const traceability = JSON.parse(readFileSync(path.join(ROOT, 'contracts/traceability.json'), 'utf8')) as {
      requirements: Array<{ requirement_id: string; task_ids: string[]; acceptance_scenario_ids: string[] }>;
    };
    const baseTasks = new Set(Array.from({ length: 24 }, (_, index) => `T${String(index + 1).padStart(2, '0')}`));
    const evidenceRoot = path.join(ROOT, 'qa', 'product');
    // A requirement is evidenced when every base task it maps to has an executed gate that
    // produced artifacts. Whether the assertions were separately proven load-bearing is a
    // different question, reported below under `red_evidence_retained` rather than folded in.
    const executedTask = (task: string): boolean => {
      const directory = path.join(evidenceRoot, task);
      return existsSync(path.join(ROOT, 'tests', 'tasks', `${task}.test.ts`)) &&
        existsSync(directory) && readdirSync(directory).some(entry => entry.endsWith('.json'));
    };
    const coverage = traceability.requirements.map(requirement => {
      const baseTaskIds = requirement.task_ids.filter(task => baseTasks.has(task));
      if (baseTaskIds.length === 0) {
        return { requirement_id: requirement.requirement_id, status: 'DEFERRED_TO_T25_T33' as const, evidence: [] as string[] };
      }
      const evidence = baseTaskIds.filter(executedTask);
      return {
        requirement_id: requirement.requirement_id,
        status: evidence.length === baseTaskIds.length ? 'EVIDENCED' as const : 'NO_GO' as const,
        evidence: evidence.map(task => `qa/product/${task}/`),
      };
    });
    const baseTaskList = [...baseTasks].sort();
    const redEvidence = baseTaskList.map(task => ({
      task, retained: existsSync(path.join(evidenceRoot, task, 'red-evidence.md')),
    }));
    const redEvidenceMissing = redEvidence.filter(entry => !entry.retained).map(entry => entry.task);
    const noGo = coverage.filter(entry => entry.status === 'NO_GO');
    const deferred = coverage.filter(entry => entry.status === 'DEFERRED_TO_T25_T33');
    const evidenced = coverage.filter(entry => entry.status === 'EVIDENCED');

    await writer.write('release-inventory.json', inventory as unknown as Json);
    await writer.write('rehearsal.json', {
      version: VERSION, checksums, installs: installs.map(entry => ({
        provider: entry.provider, checksums_verified: entry.unpacked_matches_checksums,
        planned_changes: entry.plan.changes.length, installed_files: entry.record.created.length,
      })),
      install_root: installRoot, existing_configuration_survived: settingsSurvived,
      rolled_back_to_identical_tree: rolledBack, tree_files_before: Object.keys(before).length,
      adapters, client_request: { run_id: run.run_id, verdict: verdict.verdict, message: request.message },
      rollout: {
        staged: staged.started, production_refused: productionRefused,
        production_no_approval_reasons: productionNoApproval.started ? [] : productionNoApproval.reasons,
        production_reused_staging_grant_reasons: productionWithoutApproval.started ? [] : productionWithoutApproval.reasons,
        destination_promotions: destination.promotions,
      },
      publication: { published: publication, rejected_marketing: marketing },
      signoffs, separation, client_surface: clientNotManaging,
      traceability: { evidenced: evidenced.length, deferred: deferred.length, no_go: noGo.map(entry => entry.requirement_id) },
      red_evidence_retained: { retained: redEvidence.filter(entry => entry.retained).map(entry => entry.task), missing: redEvidenceMissing },
      scope: 'Base software release rehearsal only. Nothing was published or deployed to a real destination; edition 1.3 also requires T25-T33 and gates G7 and G8.',
    } as unknown as Json);
    await writer.write('traceability-coverage.json', coverage as unknown as Json);

    return {
      scenario_id: 'AT-024',
      mode: 'manual_review',
      observed: {
        fresh_install_and_rollback_passed: checksumsVerified && installs.length === 2 && settingsSurvived && rolledBack && requestCompleted,
        artifact_inventory_complete: inventory.complete,
        both_adapters_qualified: bothAdaptersQualified,
        production_publication_requires_approval: productionRefused && productionNeverPromoted && staged.started,
        client_not_required_to_manage_markdown_or_agents: clientNotRequiredToManage,
        remit_separate_from_measured_qualification: remitSeparate,
        toolkit_app_client_and_release_signoffs_separate: signoffsSeparate,
        base_software_requirements_have_evidence_or_explicit_no_go: noGo.length === 0 && evidenced.length > 0,
        requirements_evidenced: evidenced.length,
        requirements_deferred_to_t25_t33: deferred.length,
        inventory_gaps: inventory.gaps,
        red_evidence_missing_for: redEvidenceMissing,
      } satisfies Record<string, Json>,
      artifact_paths: writer.paths,
    };
  } finally {
    authority.close();
    store.close();
    db.close();
    rmSync(sandbox, { recursive: true, force: true });
  }
});
