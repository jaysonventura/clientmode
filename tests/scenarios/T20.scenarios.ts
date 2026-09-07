/** AT-020 executor.
 *
 * The candidate really tries to rewrite the protected policy store and the CI workflow, from a
 * sandboxed process. The destination really times out. The migration really fails and is
 * really restored, with row counts checked either side. The runbooks are really executed.
 */
import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os, { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Candidate, CheckDefinition, Json, Policy, ScenarioObservation } from '../../contracts/interfaces.js';
import { digest } from '../../packages/contracts/src/canonical.js';
import { ProtectedPolicyStore } from '../../packages/verifier/src/policy.js';
import { VerificationCoordinator } from '../../packages/verifier/src/coordinator.js';
import { execute } from '../../packages/verifier/src/executor.js';
import { ApprovalAuthority } from '../../packages/core/src/approvals.js';
import { attest } from '../../packages/release/src/attestation.js';
import { deploy, reconcile, readDeployment, type Destination } from '../../packages/release/src/deploy.js';
import { runSmoke } from '../../packages/release/src/smoke.js';
import { rollback } from '../../packages/release/src/rollback.js';
import type { ApprovalScope } from '../../packages/release/src/approvals.js';
import { runRunbook, parseRunbook } from '../../apps/cli/src/runbook.js';
import { Evidence, ROOT, attempt, attemptAsync, fixedClock } from '../harness/evidence.js';
import { registerScenario } from '../harness/registry.js';

const PROJECT = 'project_t20';
const NOW = '2026-09-08T22:00:00.000Z';
const ARTIFACT = `sha256:${'a'.repeat(64)}`;
const NODE_DIR = path.dirname(process.execPath);

/** A destination that times out on its first promote and remembers the operation anyway —
 * the case where the caller cannot tell refusal from acceptance. */
class TimingOutDestination implements Destination {
  readonly name = 'mock-destination-with-timeout';
  readonly calls: Array<{ method: string; idempotency_key: string }> = [];
  readonly #operations = new Map<string, string>();
  #failNext = true;

  async promote(input: { artifact_digest: string; target_environment: string; idempotency_key: string }): Promise<{ operation_id: string }> {
    this.calls.push({ method: 'promote', idempotency_key: input.idempotency_key });
    const operation_id = this.#operations.get(input.idempotency_key) ?? `op_${this.#operations.size + 1}`;
    this.#operations.set(input.idempotency_key, operation_id);
    if (this.#failNext) {
      this.#failNext = false;
      // The destination accepted it, then the call timed out. Both facts are true.
      throw new Error('destination timeout after the request was accepted');
    }
    return { operation_id };
  }

  async lookup(idempotency_key: string): Promise<{ operation_id: string; state: 'IN_PROGRESS' | 'COMPLETE' | 'ABSENT' }> {
    this.calls.push({ method: 'lookup', idempotency_key });
    const operation_id = this.#operations.get(idempotency_key);
    return operation_id === undefined ? { operation_id: '', state: 'ABSENT' } : { operation_id, state: 'COMPLETE' };
  }

  get promoteCount(): number { return this.calls.filter(call => call.method === 'promote').length; }
}

registerScenario('AT-020', async (): Promise<ScenarioObservation> => {
  const writer = await Evidence.open('T20');
  const clock = fixedClock(NOW);
  const sandbox = mkdtempSync(path.join(tmpdir(), 'cm-t20-'));
  const authorityDir = path.join(sandbox, 'verifier-authority');
  const store = ProtectedPolicyStore.open(authorityDir);
  const authority = ApprovalAuthority.open(path.join(sandbox, 'release-authority'));
  const releaseDb = authority.raw();
  const log: Record<string, unknown> = {};

  try {
    // A candidate workspace with a planted policy and a planted workflow, hoping to be read.
    const workspace = path.join(sandbox, 'candidate');
    mkdirSync(path.join(workspace, 'checks'), { recursive: true });
    mkdirSync(path.join(workspace, '.github/workflows'), { recursive: true });
    writeFileSync(path.join(workspace, 'checks/unit.mjs'), `console.log('TAP version 13');
console.log('ok 1 - real_check');
console.log('1..1');
console.log('# tests 1');
console.log('# pass 1');
console.log('# fail 0');
console.log('# skipped 0');
`);
    writeFileSync(path.join(workspace, 'package.json'), '{"name":"candidate","private":true}\n');
    // The candidate's own idea of what should be checked, and of what CI should do.
    writeFileSync(path.join(workspace, 'client-mode-policy.json'), JSON.stringify({ checks: [], authority: 'protected', note: 'nothing to check here' }));
    writeFileSync(path.join(workspace, '.github/workflows/product-ci.yml'), 'jobs:\n  checks:\n    steps:\n      - run: echo "all green"\n');
    writeFileSync(path.join(workspace, 'pass.json'), JSON.stringify({ status: 'PASS', tests_total: 999 }));

    store.registerEnvironmentProfile({
      profile_id: 'candidate-sandbox', required_platform: null, required_executables: ['node'],
      denied_read_paths: [authorityDir, path.join(sandbox, 'release-authority')],
      allowed_write_paths: [workspace], allow_home_read: false, toolchain_paths: [NODE_DIR],
      description: 'Candidate build and test sandbox.',
    }, 'security_owner', NOW);
    const definition = store.registerDefinition({
      definition: {
        check: { check_id: 'unit', required: true, result_kind: 'tests', minimum_tests: 1, required_assertion_ids: ['real_check'], maximum_skipped: 0 },
        argv: [process.execPath, 'checks/unit.mjs'], cwd_relative: '.', parser_id: 'tap13',
        timeout_seconds: 60, maximum_output_bytes: 65536,
        environment_profile_id: 'candidate-sandbox', network_profile_id: 'deny',
      }, parser_version: '1.0.0', approved_by: 'security_owner', at: NOW,
    });
    const draft = {
      kind: 'policy' as const, schema_version: 1 as const, policy_id: 'policy_t20', project_id: PROJECT,
      policy_digest: '', requirements_revision: 1, checks: [definition.check] as CheckDefinition[],
      maximum_age_seconds: 86400, trusted_issuer_ids: ['verifier_t20'], authority: 'protected' as const,
    };
    const policy: Policy = { ...draft, policy_digest: digest(draft, 'policy_digest') };
    store.registerPolicy(policy, 'security_owner', NOW);

    // 1. The candidate attempts to replace the protected policy, the verifier database, and the
    //    CI workflow this repository actually uses.
    const repoWorkflow = path.join(ROOT, '.github/workflows/product-ci.yml');
    const workflowBefore = createHash('sha256').update(readFileSync(repoWorkflow)).digest('hex');
    const attacks = {
      verifier_database: await execute({
        argv: [process.execPath, '-e', `require('fs').writeFileSync(${JSON.stringify(path.join(authorityDir, 'verifier.sqlite'))}, 'wiped')`],
        cwd: workspace, sandbox_root: path.join(sandbox, 'attack-1'), timeout_seconds: 15, maximum_output_bytes: 32768,
        network_profile_id: 'deny', environment: store.environmentProfile('candidate-sandbox'), observer_id: 'verifier_t20', now: clock,
      }),
      read_signing_key: await execute({
        argv: [process.execPath, '-e', `process.stdout.write(require('fs').readdirSync(${JSON.stringify(authorityDir)}).join(','))`],
        cwd: workspace, sandbox_root: path.join(sandbox, 'attack-2'), timeout_seconds: 15, maximum_output_bytes: 32768,
        network_profile_id: 'deny', environment: store.environmentProfile('candidate-sandbox'), observer_id: 'verifier_t20', now: clock,
      }),
      rewrite_ci_workflow: await execute({
        argv: [process.execPath, '-e', `require('fs').writeFileSync(${JSON.stringify(repoWorkflow)}, 'jobs: {}\\n')`],
        cwd: workspace, sandbox_root: path.join(sandbox, 'attack-3'), timeout_seconds: 15, maximum_output_bytes: 32768,
        network_profile_id: 'deny', environment: store.environmentProfile('candidate-sandbox'), observer_id: 'verifier_t20', now: clock,
      }),
    };
    const workflowAfter = createHash('sha256').update(readFileSync(repoWorkflow)).digest('hex');

    // The coordinator resolves checks from the protected store, so the planted policy and the
    // planted pass.json are simply never consulted.
    const coordinator = new VerificationCoordinator({ store, issuer_id: 'verifier_t20', clock, sandbox_parent: sandbox });
    const candidate: Candidate = {
      kind: 'candidate', schema_version: 1, candidate_id: 'candidate_t20', project_id: PROJECT, run_id: 'run_t20',
      source_digest: `sha256:${'c'.repeat(64)}`, artifact_digest: ARTIFACT, requirements_revision: 1,
      policy_digest: policy.policy_digest, environment_digest: digest({ platform: os.platform() }), created_at: NOW,
    };
    const verification = await coordinator.verify({
      project_id: PROJECT, run_id: 'run_t20', attempt_id: 'attempt_t20', candidate,
      policy_digest: policy.policy_digest, requested_check_ids: [], workspace_root: workspace,
      idempotency_key: 'verify-t20',
    });
    const workflowText = readFileSync(repoWorkflow, 'utf8');
    // Comments explain the rule and mention the very words the rule forbids, so the check
    // inspects the directives rather than the prose around them.
    const workflowDirectives = workflowText.split('\n').filter(line => !/^\s*#/.test(line)).join('\n');
    const usesSecrets = /\$\{\{\s*secrets\./.test(workflowDirectives) || /^\s*secrets:/m.test(workflowDirectives);
    const usesEnvironment = /^\s*environment:/m.test(workflowDirectives);
    log['protected_policy'] = {
      attacks: Object.fromEntries(Object.entries(attacks).map(([name, outcome]) => [name, { exit_code: outcome.exit_code, stderr: outcome.stderr.slice(0, 180) }])),
      workflow_digest_unchanged: workflowBefore === workflowAfter,
      planted_policy_ignored: verification.observations.map(observation => observation.result.check_id),
      planted_pass_json_present: existsSync(path.join(workspace, 'pass.json')),
      checks_actually_run: verification.observations.map(observation => ({ check: observation.result.check_id, status: observation.result.status, tests: observation.result.tests_total })),
      ci_holds_no_secrets: !usesSecrets && !usesEnvironment,
      ci_permissions_block: /permissions:\s*\n\s*contents: read/.test(workflowDirectives),
      ci_pull_request_read_only: /permissions:\s*\n\s*contents: read/.test(workflowDirectives),
    };
    const policyProtected =
      Object.values(attacks).every(outcome => outcome.exit_code !== 0) &&
      workflowBefore === workflowAfter &&
      verification.observations.length === 1 &&
      verification.observations[0]?.result.check_id === 'unit' &&
      verification.observations[0]?.result.tests_total === 1 &&
      !usesSecrets && !usesEnvironment &&
      /permissions:\s*\n\s*contents: read/.test(workflowDirectives);

    // 2. The exact verified artifact is promoted, and a rebuild is refused.
    const attestation = attest({
      candidate,
      verdict: { verdict: 'VERIFIED_FOR_SCOPE', reasons: [], candidate_id: candidate.candidate_id, evidence_id: 'evidence_t20' },
      issuer_id: 'verifier_t20', issued_at: NOW,
    });
    const scope: ApprovalScope = {
      project_id: PROJECT, action: 'deploy', candidate_id: candidate.candidate_id,
      artifact_digest: ARTIFACT, target_environment: 'staging', policy_digest: policy.policy_digest,
    };
    const requested = authority.request({
      project_id: PROJECT, requested_by: 'controller', action: 'deploy', target_environment: 'staging',
      policy_digest: policy.policy_digest, description: 'promote the verified candidate to staging',
      expires_at: '2026-09-10T00:00:00.000Z', now: NOW, candidate_id: candidate.candidate_id, artifact_digest: ARTIFACT,
    });
    const grant = authority.decide({ approval_id: requested.approval_id, actor: 'maintainer', actor_id: 'release_owner', decision: 'approve', now: NOW }).granted_approval_id!;

    const destination = new TimingOutDestination();
    // 3. The first promote times out after the destination accepted it.
    const timedOut = await attemptAsync(() => deploy({
      db: releaseDb, destination, attestation, approval_id: grant, scope, target_environment: 'staging',
      current_policy_digest: policy.policy_digest, current_requirements_revision: 1,
      idempotency_key: 'deploy-t20', now: NOW,
    }));
    const row = releaseDb.prepare('SELECT deployment_id, status, provider_operation_id FROM deployments WHERE idempotency_key = ?').get('deploy-t20') as Record<string, unknown>;
    const reconciled = await reconcile({ db: releaseDb, destination, deployment_id: String(row['deployment_id']), now: NOW });
    const afterReconcile = readDeployment(releaseDb, String(row['deployment_id']));
    const retried = await deploy({
      db: releaseDb, destination, attestation, approval_id: grant, scope, target_environment: 'staging',
      current_policy_digest: policy.policy_digest, current_requirements_revision: 1,
      idempotency_key: 'deploy-t20', now: NOW,
    });
    // A rebuild gets its own grant, so the refusal is about the artifact rather than about the
    // first grant already being spent.
    const rebuildRequest = authority.request({
      project_id: PROJECT, requested_by: 'controller', action: 'deploy', target_environment: 'staging',
      policy_digest: policy.policy_digest, description: 'promote a rebuilt artifact',
      expires_at: '2026-09-10T00:00:00.000Z', now: NOW, candidate_id: candidate.candidate_id, artifact_digest: ARTIFACT,
    });
    const rebuildGrant = authority.decide({ approval_id: rebuildRequest.approval_id, actor: 'maintainer', actor_id: 'release_owner', decision: 'approve', now: NOW }).granted_approval_id!;
    const rebuilt = await deploy({
      db: releaseDb, destination, attestation: { ...attestation, artifact_digest: `sha256:${'9'.repeat(64)}` },
      approval_id: rebuildGrant, scope, target_environment: 'staging',
      current_policy_digest: policy.policy_digest, current_requirements_revision: 1,
      idempotency_key: 'deploy-t20-rebuilt', now: NOW,
    });
    log['deployment'] = {
      timed_out: timedOut, row_after_timeout: row, reconciliation: reconciled,
      operation_after_reconcile: afterReconcile.provider_operation_id,
      retried, rebuilt, promote_calls: destination.promoteCount, calls: destination.calls,
    };
    const artifactUnchanged = retried.started && retried.replayed &&
      !rebuilt.started && rebuilt.reasons.includes('ARTIFACT_MISMATCH') &&
      attestation.artifact_digest === candidate.artifact_digest;
    const reconciledAfterTimeout = String(row['status']) === 'DEPLOYING' &&
      row['provider_operation_id'] === null &&
      reconciled.destination_state === 'COMPLETE' &&
      reconciled.action === 'ADOPTED_EXISTING_OPERATION' &&
      afterReconcile.provider_operation_id !== null &&
      // One accepted promote, then adoption. No second promote for the same key.
      destination.promoteCount === 1;

    // 4. Migration recovery on synthetic data, with row counts either side.
    const synthetic = path.join(sandbox, 'synthetic.sqlite');
    const seed = new DatabaseSync(synthetic);
    seed.exec('CREATE TABLE orders (id INTEGER PRIMARY KEY, total_centavos INTEGER NOT NULL, note TEXT)');
    for (let index = 1; index <= 250; index += 1) {
      seed.prepare('INSERT INTO orders (id, total_centavos, note) VALUES (?,?,?)').run(index, index * 100, `synthetic-${index}`);
    }
    const rowsBefore = Number((seed.prepare('SELECT COUNT(*) AS n FROM orders').get() as Record<string, unknown>)['n']);
    seed.close();
    const backup = path.join(sandbox, 'synthetic.backup.sqlite');
    copyFileSync(synthetic, backup);

    const migrationFailure = attempt(() => {
      const db = new DatabaseSync(synthetic);
      db.exec('BEGIN IMMEDIATE');
      db.exec('ALTER TABLE orders ADD COLUMN delivery_fee_centavos INTEGER');
      db.exec('UPDATE orders SET delivery_fee_centavos = 500');
      db.exec('DROP TABLE orders_missing_table');
      db.exec('COMMIT');
      db.close();
      return 'migrated';
    });
    copyFileSync(backup, synthetic);
    const verify = new DatabaseSync(synthetic);
    const rowsAfter = Number((verify.prepare('SELECT COUNT(*) AS n FROM orders').get() as Record<string, unknown>)['n']);
    const columns = (verify.prepare('PRAGMA table_info(orders)').all() as Array<Record<string, unknown>>).map(column => String(column['name']));
    const sample = verify.prepare('SELECT note FROM orders WHERE id = 42').get() as Record<string, unknown>;
    verify.close();
    log['migration_recovery'] = {
      rows_before: rowsBefore, migration_failure: migrationFailure, rows_after_restore: rowsAfter,
      columns_after_restore: columns, sample_row_intact: String(sample['note']) === 'synthetic-42',
      roll_forward_guidance: 'restore the snapshot and roll forward; a binary rollback across a contract step leaves the schema ahead of the code',
    };
    const migrationRehearsed = !migrationFailure.ok && rowsBefore === 250 && rowsAfter === 250 &&
      !columns.includes('delivery_fee_centavos') && String(sample['note']) === 'synthetic-42';

    // 5. Failed smoke, then an authorized rollback, then the runbooks executed.
    const smoke = await runSmoke({
      db: releaseDb, deployment_id: String(row['deployment_id']), observer_id: 'release_t20', now: clock,
      probes: [{ probe_id: 'checkout', run: async () => ({ passed: false, detail: 'HTTP 500 from /api/orders' }) }],
    });
    const rollbackRequest = authority.request({
      project_id: PROJECT, requested_by: 'controller', action: 'rollback', target_environment: 'staging',
      policy_digest: policy.policy_digest, description: 'roll staging back after the failed smoke check',
      expires_at: '2026-09-10T00:00:00.000Z', now: NOW, candidate_id: candidate.candidate_id, artifact_digest: ARTIFACT,
    });
    const rollbackGrant = authority.decide({ approval_id: rollbackRequest.approval_id, actor: 'maintainer', actor_id: 'release_owner', decision: 'approve', now: NOW }).granted_approval_id!;
    const rolledBack = await rollback({
      db: releaseDb, destination, deployment_id: String(row['deployment_id']),
      approval_id: rollbackGrant, scope: { ...scope, action: 'rollback' }, now: NOW,
    });

    const runbookDir = path.join(ROOT, 'docs/runbooks');
    const runbooks = [
      { file: path.join(runbookDir, 'stuck-deployment.md'), env: { CM_DEPLOYMENT_ID: String(row['deployment_id']), CM_IDEMPOTENCY_KEY: 'deploy-t20', CM_DESTINATION_STATE: reconciled.destination_state } },
      { file: path.join(runbookDir, 'failed-migration.md'), env: { CM_STATE_BACKUP: backup, CM_STATE_PATH: synthetic, CM_IRREVERSIBLE: 'yes' } },
      { file: path.join(runbookDir, 'failed-smoke.md'), env: { CM_FAILED_PROBES: smoke.blocking.join(','), CM_ROLLBACK_APPROVED: 'yes', CM_DEPLOYMENT_ID: String(row['deployment_id']) } },
    ].map(entry => runRunbook({ file: entry.file, env: entry.env, cwd: sandbox }));
    // A runbook missing a required variable must fail rather than pass quietly.
    const missingVariable = runRunbook({ file: path.join(runbookDir, 'stuck-deployment.md'), env: {}, cwd: sandbox });
    log['runbooks'] = {
      executed: runbooks.map(outcome => ({
        runbook: path.basename(outcome.runbook), status: outcome.status,
        steps: outcome.steps.map(step => ({ name: step.name, exit_code: step.exit_code, stdout: step.stdout.trim() })),
      })),
      missing_variable: { status: missingVariable.status, blocked_at: missingVariable.blocked_at },
      smoke: { released: smoke.released, status: smoke.deployment.status, blocking: smoke.blocking },
      rollback: rolledBack.rolled_back ? { authorized_by: rolledBack.authorized_by, status: rolledBack.deployment.status } : rolledBack,
      step_counts: runbooks.map(outcome => parseRunbook(readFileSync(outcome.runbook, 'utf8')).length),
    };
    const runbooksExecuted = runbooks.every(outcome => outcome.status === 'EXECUTED' && outcome.steps.every(step => step.ran && step.exit_code === 0)) &&
      runbooks.reduce((total, outcome) => total + outcome.steps.length, 0) >= 9 &&
      missingVariable.status === 'BLOCKED' &&
      !smoke.released && smoke.deployment.status === 'FAILED' &&
      rolledBack.rolled_back && rolledBack.deployment.status === 'ROLLED_BACK';

    await writer.write('protected-ci.json', log);
    await writer.write('runbook-execution.json', runbooks);

    return {
      scenario_id: 'AT-020',
      mode: 'integration',
      observed: {
        candidate_cannot_replace_protected_policy: policyProtected,
        verified_artifact_promoted_unchanged: artifactUnchanged,
        deployment_reconciled_after_timeout: reconciledAfterTimeout,
        migration_recovery_rehearsed: migrationRehearsed,
        runbooks_executed: runbooksExecuted,
        promote_calls_for_one_deployment: destination.promoteCount,
        runbook_steps_executed: runbooks.reduce((total, outcome) => total + outcome.steps.length, 0),
      } satisfies Record<string, Json>,
      artifact_paths: writer.paths,
    };
  } finally {
    authority.close();
    store.close();
    rmSync(sandbox, { recursive: true, force: true });
  }
});
