/** AT-008 executor.
 *
 * A mock destination records every call it receives, so "exactly one side effect" is counted
 * rather than asserted. The crash between the committed release intent and the destination
 * call is a real thrown failure, and recovery goes through reconciliation before any retry.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ClientAnswer, ClientRequest, Json, ScenarioObservation } from '../../contracts/interfaces.js';
import { ControllerDatabase } from '../../packages/state/src/database.js';
import { LifecycleService } from '../../packages/core/src/lifecycle.js';
import { ApprovalAuthority } from '../../packages/core/src/approvals.js';
import { SessionStore } from '../../apps/controller/src/auth.js';
import { attest } from '../../packages/release/src/attestation.js';
import { deploy, reconcile, type Destination } from '../../packages/release/src/deploy.js';
import { runSmoke } from '../../packages/release/src/smoke.js';
import { rollback } from '../../packages/release/src/rollback.js';
import { checkScope, type ApprovalScope } from '../../packages/release/src/approvals.js';
import { Evidence, ROOT, attempt, attemptAsync, fixedClock } from '../harness/evidence.js';
import { registerScenario } from '../harness/registry.js';

const PROJECT = 'project_t08';
const NOW = '2026-09-08T10:00:00.000Z';
const ARTIFACT = `sha256:${'a'.repeat(64)}`;
const POLICY = `sha256:${'b'.repeat(64)}`;

/** Records every call. A second promote for the same key is a second side effect. */
class RecordingDestination implements Destination {
  readonly name = 'mock-staging-destination';
  readonly calls: Array<{ method: string; idempotency_key: string; artifact_digest: string; target_environment: string }> = [];
  readonly #operations = new Map<string, string>();

  async promote(input: { artifact_digest: string; target_environment: string; idempotency_key: string }): Promise<{ operation_id: string }> {
    this.calls.push({ method: 'promote', ...input });
    const existing = this.#operations.get(input.idempotency_key);
    if (existing !== undefined) return { operation_id: existing };
    const operation_id = `op_${this.#operations.size + 1}`;
    this.#operations.set(input.idempotency_key, operation_id);
    return { operation_id };
  }

  async lookup(idempotency_key: string): Promise<{ operation_id: string; state: 'IN_PROGRESS' | 'COMPLETE' | 'ABSENT' }> {
    this.calls.push({ method: 'lookup', idempotency_key, artifact_digest: '', target_environment: '' });
    const operation_id = this.#operations.get(idempotency_key);
    return operation_id === undefined ? { operation_id: '', state: 'ABSENT' } : { operation_id, state: 'COMPLETE' };
  }

  get promoteCount(): number { return this.calls.filter(call => call.method === 'promote').length; }
}

registerScenario('AT-008', async (): Promise<ScenarioObservation> => {
  const writer = await Evidence.open('T08');
  const clock = fixedClock(NOW);
  const sandbox = mkdtempSync(path.join(tmpdir(), 'cm-t08-'));
  const db = ControllerDatabase.open(path.join(sandbox, 'state'));
  const authority = ApprovalAuthority.open(path.join(sandbox, 'release-authority'));
  const releaseDb = authority.raw();
  const log: Record<string, unknown> = {};

  try {
    const sessions = new SessionStore({ bootstrap_secret: 'bootstrap-fixture-secret', clock: () => NOW });
    const service = new LifecycleService(db, { clock });
    service.registerProject({ project_id: PROJECT, registered_root_ref: `file://${sandbox}/work`, profile_id: 'discover', data_class: 'internal' });

    // 1. Session identity: a worker token, a foreign origin and a missing CSRF token are all
    //    refused; an authenticated client session with its CSRF token is accepted.
    const session = sessions.exchange({ bootstrap_secret: 'bootstrap-fixture-secret', actor: 'client', actor_id: 'owner_1', origin: 'http://127.0.0.1:7788' });
    if ('rejected' in session) throw new Error(`SESSION_SETUP_FAILED:${session.rejected}`);
    const authAttempts = {
      worker_token: sessions.authenticate({ method: 'POST', path: '/v1/approvals', headers: { authorization: 'Worker abc', origin: 'http://127.0.0.1:7788', 'x-csrf-token': session.csrf_token }, cookies: { cm_session: session.session_id } }),
      cross_origin: sessions.authenticate({ method: 'POST', path: '/v1/approvals', headers: { origin: 'https://evil.example', 'x-csrf-token': session.csrf_token }, cookies: { cm_session: session.session_id } }),
      missing_csrf: sessions.authenticate({ method: 'POST', path: '/v1/approvals', headers: { origin: 'http://127.0.0.1:7788' }, cookies: { cm_session: session.session_id } }),
      stale_csrf: sessions.authenticate({ method: 'POST', path: '/v1/approvals', headers: { origin: 'http://127.0.0.1:7788', 'x-csrf-token': 'stale-token-value' }, cookies: { cm_session: session.session_id } }),
      no_session: sessions.authenticate({ method: 'POST', path: '/v1/approvals', headers: { origin: 'http://127.0.0.1:7788' }, cookies: {} }),
      valid: sessions.authenticate({ method: 'POST', path: '/v1/approvals', headers: { origin: 'http://127.0.0.1:7788', 'x-csrf-token': session.csrf_token }, cookies: { cm_session: session.session_id } }),
    };
    // A worker cannot decide an approval even with a well-formed request.
    const workerDecision = attempt(() => {
      const requested = authority.request({
        project_id: PROJECT, requested_by: 'worker', action: 'deploy', target_environment: 'staging',
        policy_digest: POLICY, description: 'ship it', expires_at: '2026-09-09T00:00:00.000Z', now: NOW,
        candidate_id: 'candidate_t08', artifact_digest: ARTIFACT,
      });
      return authority.decide({ approval_id: requested.approval_id, actor: 'worker', actor_id: 'worker_1', decision: 'approve', now: NOW });
    });
    log['authentication'] = {
      cookie_header: sessions.cookieHeader(session), cookie_notes: sessions.cookie_notes,
      attempts: authAttempts, worker_decision: workerDecision,
    };
    const authDenied = !authAttempts.worker_token.authenticated && authAttempts.worker_token.reason === 'WORKER_TOKEN_CANNOT_ACT_AS_CLIENT' &&
      !authAttempts.cross_origin.authenticated && authAttempts.cross_origin.reason === 'ORIGIN_NOT_ALLOWED' &&
      !authAttempts.missing_csrf.authenticated && !authAttempts.stale_csrf.authenticated &&
      !authAttempts.no_session.authenticated && authAttempts.valid.authenticated &&
      !workerDecision.ok && workerDecision.code === 'ACTOR_CANNOT_APPROVE' &&
      !sessions.cookieHeader(session).includes('Secure');

    // 2. One scoped approval for the exact candidate, artifact and environment.
    const requested = authority.request({
      project_id: PROJECT, requested_by: 'controller', action: 'deploy', target_environment: 'staging',
      policy_digest: POLICY, description: 'Promote the verified shop candidate to staging',
      expires_at: '2026-09-09T00:00:00.000Z', now: NOW, candidate_id: 'candidate_t08', artifact_digest: ARTIFACT,
    });
    const decision = authority.decide({ approval_id: requested.approval_id, actor: 'client', actor_id: 'owner_1', decision: 'approve', now: NOW });
    const grant = decision.granted_approval_id!;

    const attestation = attest({
      candidate: {
        kind: 'candidate', schema_version: 1, candidate_id: 'candidate_t08', project_id: PROJECT,
        run_id: 'run_t08', source_digest: `sha256:${'c'.repeat(64)}`, artifact_digest: ARTIFACT,
        requirements_revision: 1, policy_digest: POLICY, environment_digest: `sha256:${'d'.repeat(64)}`,
        created_at: NOW,
      },
      verdict: { verdict: 'VERIFIED_FOR_SCOPE', reasons: [], candidate_id: 'candidate_t08', evidence_id: 'evidence_t08' },
      issuer_id: 'verifier_t08', issued_at: NOW,
    });
    const scope: ApprovalScope = {
      project_id: PROJECT, action: 'deploy', candidate_id: 'candidate_t08',
      artifact_digest: ARTIFACT, target_environment: 'staging', policy_digest: POLICY,
    };

    // Wrong artifact, wrong environment and an expired grant are refused before any call.
    const destination = new RecordingDestination();
    const wrongArtifact = await deploy({
      db: releaseDb, destination, attestation, approval_id: grant,
      scope: { ...scope, artifact_digest: `sha256:${'9'.repeat(64)}` }, target_environment: 'staging',
      current_policy_digest: POLICY, current_requirements_revision: 1,
      idempotency_key: 'deploy-wrong-artifact', now: NOW,
    });
    const wrongEnvironment = await deploy({
      db: releaseDb, destination, attestation, approval_id: grant, scope, target_environment: 'production',
      current_policy_digest: POLICY, current_requirements_revision: 1,
      idempotency_key: 'deploy-wrong-environment', now: NOW,
    });
    const expiredGrant = checkScope(
      { project_id: PROJECT, action: 'deploy', candidate_id: 'candidate_t08', artifact_digest: ARTIFACT, target_environment: 'staging', policy_digest: POLICY, expires_at: '2026-09-08T09:00:00.000Z', consumed_by_release_id: null },
      scope, NOW);
    const callsBeforeFirstDeploy = destination.promoteCount;

    // 3. A crash after the committed intent, then reconciliation before any retry.
    const crashed = await attemptAsync(() => deploy({
      db: releaseDb, destination, attestation, approval_id: grant, scope, target_environment: 'staging',
      current_policy_digest: POLICY, current_requirements_revision: 1,
      idempotency_key: 'deploy-staging-1', now: NOW, crashAfterIntent: true,
    }));
    const interrupted = releaseDb.prepare('SELECT deployment_id, status, provider_operation_id FROM deployments WHERE idempotency_key = ?').get('deploy-staging-1') as Record<string, unknown>;
    const reconciliation = await reconcile({ db: releaseDb, destination, deployment_id: String(interrupted['deployment_id']), now: NOW });
    const retried = await deploy({
      db: releaseDb, destination, attestation, approval_id: grant, scope, target_environment: 'staging',
      current_policy_digest: POLICY, current_requirements_revision: 1,
      idempotency_key: 'deploy-staging-1', now: NOW,
    });
    const replayed = await deploy({
      db: releaseDb, destination, attestation, approval_id: grant, scope, target_environment: 'staging',
      current_policy_digest: POLICY, current_requirements_revision: 1,
      idempotency_key: 'deploy-staging-1', now: NOW,
    });
    // A second grant-less deployment attempt with a fresh key must be refused: consumed once.
    const secondUse = await deploy({
      db: releaseDb, destination, attestation, approval_id: grant, scope, target_environment: 'staging',
      current_policy_digest: POLICY, current_requirements_revision: 1,
      idempotency_key: 'deploy-staging-2', now: NOW,
    });
    log['release'] = {
      wrong_artifact: wrongArtifact, wrong_environment: wrongEnvironment, expired_grant: expiredGrant,
      calls_before_first_deploy: callsBeforeFirstDeploy,
      crash: crashed, interrupted_row: interrupted, reconciliation,
      retried, replayed, second_use_of_same_grant: secondUse,
      destination_calls: destination.calls, promote_count: destination.promoteCount,
    };
    const replayDenied = !wrongArtifact.started && wrongArtifact.reasons.includes('ENVIRONMENT_NOT_APPROVED') === false &&
      wrongArtifact.reasons.includes('ARTIFACT_MISMATCH') &&
      !wrongEnvironment.started && wrongEnvironment.reasons.includes('ENVIRONMENT_NOT_APPROVED') &&
      !expiredGrant.valid && expiredGrant.reasons.includes('APPROVAL_EXPIRED') &&
      !secondUse.started && secondUse.reasons.includes('ALREADY_CONSUMED');

    // 4. Failed smoke leaves the deployment unreleased.
    const deployment_id = retried.started ? retried.deployment_id : String(interrupted['deployment_id']);
    const failingSmoke = await runSmoke({
      db: releaseDb, deployment_id, observer_id: 'release_t08', now: clock,
      probes: [
        { probe_id: 'homepage', run: async () => ({ passed: true, detail: 'HTTP 200' }) },
        { probe_id: 'checkout', run: async () => ({ passed: false, detail: 'HTTP 500 from /api/orders' }) },
      ],
    });
    const emptySmoke = await runSmoke({ db: releaseDb, deployment_id, observer_id: 'release_t08', now: clock, probes: [] });
    const passingSmoke = await runSmoke({
      db: releaseDb, deployment_id, observer_id: 'release_t08', now: clock,
      probes: [{ probe_id: 'homepage', run: async () => ({ passed: true, detail: 'HTTP 200' }) }],
    });
    log['smoke'] = { failing: failingSmoke, empty: emptySmoke, passing: passingSmoke };
    const failedSmokeNotReleased = !failingSmoke.released && failingSmoke.deployment.status === 'FAILED' &&
      !emptySmoke.released && emptySmoke.blocking.includes('NO_SMOKE_PROBES') &&
      passingSmoke.released && passingSmoke.deployment.status === 'RELEASED';

    // 5. Rollback needs its own authority and records who gave it.
    const unauthorisedRollback = await rollback({
      db: releaseDb, destination, deployment_id, approval_id: grant, scope, now: NOW,
    });
    const rollbackRequested = authority.request({
      project_id: PROJECT, requested_by: 'controller', action: 'rollback', target_environment: 'staging',
      policy_digest: POLICY, description: 'Roll staging back after the checkout failure',
      expires_at: '2026-09-09T00:00:00.000Z', now: NOW, candidate_id: 'candidate_t08', artifact_digest: ARTIFACT,
    });
    const rollbackDecision = authority.decide({ approval_id: rollbackRequested.approval_id, actor: 'maintainer', actor_id: 'release_owner_1', decision: 'approve', now: NOW });
    const rollbackScope: ApprovalScope = { ...scope, action: 'rollback' };
    const blockedByMigration = await rollback({
      db: releaseDb, destination, deployment_id, approval_id: rollbackDecision.granted_approval_id!,
      scope: rollbackScope, now: NOW, irreversible_steps: ['0007_drop_legacy_orders_column'],
    });
    const authorisedRollback = await rollback({
      db: releaseDb, destination, deployment_id, approval_id: rollbackDecision.granted_approval_id!,
      scope: rollbackScope, now: NOW,
    });
    const rollbackAudit = authority.audit().filter(entry => entry.operation === 'rollback');
    log['rollback'] = { unauthorised: unauthorisedRollback, blocked_by_migration: blockedByMigration, authorised: authorisedRollback, audit: rollbackAudit };
    const rollbackAuthority = !unauthorisedRollback.rolled_back &&
      unauthorisedRollback.reasons.includes('APPROVAL_ACTION_NOT_ROLLBACK') &&
      !blockedByMigration.rolled_back && blockedByMigration.reasons.includes('IRREVERSIBLE_STEP_BLOCKS_ROLLBACK') &&
      authorisedRollback.rolled_back && authorisedRollback.authorized_by === 'release_owner_1' &&
      rollbackAudit.length === 1;

    // 6. A business answer is not a release grant, and lives on a separate service method.
    const requestFixture = JSON.parse(readFileSync(path.join(ROOT, 'contracts/examples/request.json'), 'utf8')) as ClientRequest;
    const clientRequest: ClientRequest = { ...requestFixture, request_id: 'request_t08', project_id: PROJECT };
    const run = await service.createRun(clientRequest, 'idem-t08');
    const question = service.askQuestion({
      question_id: 'question_t08', project_id: PROJECT, run_id: run.run_id, requirements_revision: 0,
      prompt: 'Cash on delivery only, or should we add online payment later?',
      recommendation: 'Start with cash on delivery.', blocking_task_ids: ['task_checkout'], source_request_ids: ['request_t08'],
    });
    const answer: ClientAnswer = service.answerQuestion({
      question_id: question.question_id, expected_version: question.state_version,
      request: { ...clientRequest, request_id: 'request_t08_answer', message: 'Cash on delivery lang. Deploy na rin.' },
      authenticated_actor_id: 'owner_1', actor: 'client', idempotency_key: 'answer-t08',
    });
    const workerAnswer = attempt(() => service.answerQuestion({
      question_id: question.question_id, expected_version: 2,
      request: { ...clientRequest, request_id: 'request_t08_worker' },
      authenticated_actor_id: 'worker_1', actor: 'worker', idempotency_key: 'answer-worker',
    }));
    const grantsAfterAnswer = releaseDb.prepare('SELECT COUNT(*) AS n FROM approvals WHERE project_id = ?').get(PROJECT) as Record<string, unknown>;
    const grantsBefore = 2; // the deploy grant and the rollback grant, both from authenticated decisions
    log['question_answer'] = {
      question_status_after_answer: db.get('SELECT status FROM client_questions WHERE question_id = ?', question.question_id),
      answer_id: answer.answer_id, answer_actor: answer.actor_id, worker_answer: workerAnswer,
      approvals_in_release_store: Number(grantsAfterAnswer['n']),
      answer_recorded_as_client_request: db.get('SELECT request_id FROM client_requests WHERE request_id = ?', 'request_t08_answer') !== undefined,
    };
    const answerGrantsNothing = answer.actor_id === 'owner_1' &&
      !workerAnswer.ok && workerAnswer.code === 'ACTOR_CANNOT_ANSWER' &&
      Number(grantsAfterAnswer['n']) === grantsBefore;

    await writer.write('release.json', log);
    await writer.write('destination-calls.json', destination.calls);
    await writer.write('authority-audit.json', authority.audit());

    return {
      scenario_id: 'AT-008',
      mode: 'integration',
      observed: {
        worker_and_cross_origin_approval_denied: authDenied,
        replayed_or_wrong_artifact_approval_denied: replayDenied,
        deployment_side_effect_count: destination.promoteCount - (authorisedRollback.rolled_back ? 1 : 0),
        failed_smoke_not_released: failedSmokeNotReleased,
        rollback_requires_and_records_authority: rollbackAuthority,
        question_answer_never_grants_release_authority: answerGrantsNothing,
        reconciliation_action: reconciliation.action,
        secure_cookie_omitted_on_loopback: !sessions.cookieHeader(session).includes('Secure'),
      } satisfies Record<string, Json>,
      artifact_paths: writer.paths,
    };
  } finally {
    authority.close();
    db.close();
    rmSync(sandbox, { recursive: true, force: true });
  }
});
