/** AT-032 executor — support, incidents and honest coverage.
 *
 * A released application miscalculates a total. The case starts from what the client actually
 * wrote, the defect is reproduced against the running service, a regression is added, the
 * runbook is updated, and only then is the case resolved. Monitoring is not configured, and
 * the controller is stopped partway through — neither state is allowed to sound like cover.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Json, ScenarioObservation } from '../../contracts/interfaces.js';
import { ControllerDatabase } from '../../packages/state/src/database.js';
import { LifecycleService } from '../../packages/core/src/lifecycle.js';
import { DocumentStore } from '../../packages/documents/src/ingest.js';
import { DocumentJobService } from '../../packages/documents/src/jobs.js';
import {
  ServiceCaseService, authoriseOutbound, describeCoverage,
  recordSatisfaction, reviewCoverageClaim,
} from '../../packages/core/src/service-cases.js';
import { correctDocumentation, executeSnippet } from '../../packages/documents/src/writing.js';
import * as corpus from '../../fixtures/documents/corpus.js';
import { Evidence, ROOT, attempt, fixedClock } from '../harness/evidence.js';
import { startPricingApi, startShop } from '../harness/services.js';
import { registerScenario } from '../harness/registry.js';

const PROJECT = 'project_t32';
const NOW = '2026-09-09T13:00:00.000Z';

registerScenario('AT-032', async (): Promise<ScenarioObservation> => {
  const writer = await Evidence.open('T32');
  const clock = fixedClock(NOW);
  const sandbox = mkdtempSync(path.join(tmpdir(), 'cm-t32-'));
  const stateDir = path.join(sandbox, 'state');
  let db = ControllerDatabase.open(stateDir);
  const running: Array<{ stop: () => Promise<void> }> = [];

  try {
    const service = new LifecycleService(db, { clock });
    service.registerProject({ project_id: PROJECT, registered_root_ref: `file://${sandbox}`, profile_id: 'discover', data_class: 'internal' });
    let cases = new ServiceCaseService(db, { clock });

    // ---- 1. The client reports a calculation failure ----------------------------------------
    const report = await service.createRun({
      kind: 'client_request', schema_version: 1, request_id: 'request_t32_report', project_id: PROJECT,
      message: 'the total is wrong when i order two rice, it charges me too much',
      language_hint: 'mixed', attachment_ids: [], privacy_class: 'internal', created_at: NOW,
    }, 'idem-t32-report');
    const withoutRequest = attempt(() => cases.open({
      project_id: PROJECT, request_id: 'request_that_never_arrived', severity: 'high',
      coverage_mode: 'on_demand', summary: 'invented case',
    }));
    const openCase = cases.open({
      project_id: PROJECT, request_id: 'request_t32_report', severity: 'high',
      coverage_mode: 'on_demand', related_run_id: report.run_id,
      summary: 'Reported: the total for two rice is wrong.',
    });

    // ---- 2. Reproduce it against the running application -------------------------------------
    const defective = await startShop({ defect: 'negative-quantity' });
    running.push(defective);
    const probe = await fetch(`${defective.url}/api/orders`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'case-probe' },
      body: JSON.stringify({ items: [{ product_id: 'rice', quantity: -1 }], customer: { name: 'Ana Dela Cruz', mobile: '09000000001' } }),
    });
    const probeBody = await probe.json() as Record<string, unknown>;
    const reproduction = {
      attempted: true as const,
      reproduced: probe.status !== 422,
      observed: `POST /api/orders with quantity -1 returned ${String(probe.status)}`,
      expected: 'POST /api/orders with quantity -1 returns 422',
      evidence_ref: 'qa/product/T32/support-case.json#reproduction',
    };
    cases.transition(openCase.case_id, 'INVESTIGATING', 'reproduced against the running application');
    cases.link(openCase.case_id, { kind: 'software_run', run_id: report.run_id }, 'the client request that opened the case');

    // ---- 3. A documentation question becomes a document job ----------------------------------
    const store = new DocumentStore(db, { blob_root: path.join(sandbox, 'blobs'), clock });
    let jobs = new DocumentJobService(db, { clock });
    await service.createRun({
      kind: 'client_request', schema_version: 1, request_id: 'request_t32_docs', project_id: PROJECT,
      message: 'also the api docs say qty but that does not work', language_hint: 'en',
      attachment_ids: [], privacy_class: 'internal', created_at: NOW,
    }, 'idem-t32-docs');
    const documentation = store.upload({
      project_id: PROJECT, declared_media_type: corpus.MEDIA_TYPES.markdown,
      bytes: Buffer.from(corpus.API_DOCUMENTATION, 'utf8'), privacy_class: 'internal', idempotency_key: 't32-docs',
    });
    if (!documentation.stored) throw new Error('FIXTURE_REJECTED');
    const docJob = jobs.create({
      project_id: PROJECT, request_id: 'request_t32_docs', operation: 'edit',
      input_version_ids: [documentation.version.version_id], idempotency_key: 'job-t32-docs',
    });
    cases.link(openCase.case_id, { kind: 'document_job', job_id: docJob.job_id }, 'the documentation question raised in the same report');
    const api = await startPricingApi();
    running.push(api);
    const documented = await executeSnippet({ snippet_id: 'docs', base_url: api.url, path_and_query: '/price?product=rice&qty=2', expected_status: 200, expected_body_contains: '"total_centavos":9000' });
    const corrected = correctDocumentation({
      documentation: corpus.API_DOCUMENTATION,
      defects: [{ snippet_id: 'docs', documented: 'qty', observed: 'quantity', correction: 'the implementation reads quantity' }],
    });
    const verified = await executeSnippet({ snippet_id: 'docs-fixed', base_url: api.url, path_and_query: '/price?product=rice&quantity=2', expected_status: 200, expected_body_contains: '"total_centavos":9000' });

    // ---- 4. A duplicate report keeps both histories -------------------------------------------
    await service.createRun({
      kind: 'client_request', schema_version: 1, request_id: 'request_t32_duplicate', project_id: PROJECT,
      message: 'same problem again, two rice is charged wrong', language_hint: 'en',
      attachment_ids: [], privacy_class: 'internal', created_at: NOW,
    }, 'idem-t32-duplicate');
    const beforeDuplicate = cases.timeline(openCase.case_id).length;
    const duplicate = cases.reportAgain({
      case_id: openCase.case_id, project_id: PROJECT, request_id: 'request_t32_duplicate',
      summary: 'reported a second time by the same client',
    });
    const caseCount = Number(db.get('SELECT COUNT(*) AS n FROM service_cases WHERE project_id = ?', PROJECT)?.['n'] ?? 0);

    // ---- 5. Resolution needs work that actually happened --------------------------------------
    const prematureResolve = cases.resolve({
      case_id: openCase.case_id, reproduction, verification_evidence_ref: null,
      regression_added: false, documentation_updated: false,
    });
    const runbookPath = path.join(sandbox, 'runbook.md');
    writeFileSync(runbookPath, '# Failed calculation\n\nRevision 1.\n');
    const fixedShop = await startShop({});
    running.push(fixedShop);
    const afterFix = await fetch(`${fixedShop.url}/api/orders`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'case-verify' },
      body: JSON.stringify({ items: [{ product_id: 'rice', quantity: -1 }], customer: { name: 'Ana Dela Cruz', mobile: '09000000001' } }),
    });
    writeFileSync(runbookPath, '# Failed calculation\n\nRevision 2. Check the quantity lower bound in the order API.\n');
    cases.link(openCase.case_id, { kind: 'regression_test', test_ref: 'tests/tasks/T06.test.ts#negative_quantity', added_at: NOW }, 'a regression that fails without the fix');
    cases.link(openCase.case_id, { kind: 'runbook', path: 'runbook.md', revision: 2 }, 'runbook updated from what was observed');
    const resolved = cases.resolve({
      case_id: openCase.case_id, reproduction,
      verification_evidence_ref: `status:${String(afterFix.status)}`,
      regression_added: true, documentation_updated: corrected.applied.length === 1,
    });
    const notReproduced = cases.resolve({
      case_id: openCase.case_id, reproduction: { attempted: true, reproduced: false, observed: 'nothing', expected: '422', evidence_ref: 'x' },
      verification_evidence_ref: 'x', regression_added: true, documentation_updated: true,
    });

    // ---- 6. Coverage, and a stopped controller -------------------------------------------------
    const coverageBefore = describeCoverage({ monitoring_configured: false, controller_running: true, configured_response_target: null });
    const honestClaim = reviewCoverageClaim('Nothing is being watched for you. Tell us when something is wrong and we will look at it.', coverageBefore);
    const overpromise = reviewCoverageClaim('We monitor your application 24/7 with a 99.9% uptime SLA and immediate response.', coverageBefore);
    // Stop the controller. Whatever was true a moment ago, nothing is being observed now.
    const timelineBeforeStop = cases.timeline(openCase.case_id).length;
    db.close();
    const coverageStopped = describeCoverage({ monitoring_configured: true, controller_running: false, configured_response_target: 'next working day' });
    const stoppedClaim = reviewCoverageClaim('We are watching your application while you sleep.', coverageStopped);
    db = ControllerDatabase.open(stateDir);
    cases = new ServiceCaseService(db, { clock: fixedClock(NOW) });
    jobs = new DocumentJobService(db, { clock: fixedClock(NOW) });
    const timelineAfterRestart = cases.timeline(openCase.case_id);

    // ---- 7. Outbound actions and satisfaction ---------------------------------------------------
    const email = authoriseOutbound({
      action: { kind: 'email', recipient: 'customer@example.invalid', subject: 'Sorry about your order' },
      approvals: [],
    });
    const webhook = authoriseOutbound({ action: { kind: 'webhook', recipient: 'https://example.invalid/hook', subject: 'incident' }, approvals: [] });
    const approvedEmail = authoriseOutbound({
      action: { kind: 'email', recipient: 'owner@example.invalid', subject: 'Your case is resolved' },
      approvals: [{ capability: 'email', recipient: 'owner@example.invalid', granted_by: 'release_owner' }],
    });
    const agentSatisfaction = recordSatisfaction({ actor: 'worker', authenticated_client_id: 'owner_1', satisfaction: 'accepted' });
    const clientSatisfaction = recordSatisfaction({ actor: 'client', authenticated_client_id: 'owner_1', satisfaction: 'accepted' });
    const feedbackByWorker = new LifecycleService(db, { clock: fixedClock(NOW) }).recordFeedback({
      project_id: PROJECT, run_id: report.run_id, candidate_id: 'candidate_t32', message: 'looks fixed to me',
      satisfaction: 'accepted', actor: 'worker', authenticated_actor_id: 'worker_1',
    });

    const caseRecord = cases.get(openCase.case_id);
    await writer.write('support-case.json', {
      case: caseRecord, opened_without_request: withoutRequest,
      reproduction, probe_status: probe.status, probe_body: probeBody,
      after_fix_status: afterFix.status,
      duplicate: { ...duplicate, timeline_before: beforeDuplicate, case_rows: caseCount },
      resolution: { premature: prematureResolve, resolved, not_reproduced: notReproduced },
      timeline: timelineAfterRestart, timeline_before_stop: timelineBeforeStop,
      runbook: readFileSync(runbookPath, 'utf8'),
    } as unknown as Json);
    await writer.write('coverage-and-outbound.json', {
      coverage: { configured: coverageBefore, stopped: coverageStopped },
      claims: { honest: honestClaim, overpromise, while_stopped: stoppedClaim },
      outbound: { email, webhook, approved_email: approvedEmail },
      satisfaction: { agent: agentSatisfaction, client: clientSatisfaction, worker_feedback: feedbackByWorker },
      documentation: { documented, corrected: corrected.applied, verified },
    } as unknown as Json);

    return {
      scenario_id: 'AT-032',
      mode: 'integration',
      observed: {
        case_links_real_client_request_and_work:
          caseRecord.request_id === 'request_t32_report' && !withoutRequest.ok &&
          caseRecord.links.some(link => link.kind === 'software_run') &&
          caseRecord.links.some(link => link.kind === 'document_job'),
        resolution_requires_actual_evidence:
          !prematureResolve.resolved && prematureResolve.reasons.includes('NO_VERIFICATION_EVIDENCE') &&
          prematureResolve.reasons.includes('NO_REGRESSION_TEST') &&
          resolved.resolved && reproduction.reproduced && afterFix.status === 422 &&
          !notReproduced.resolved && notReproduced.reasons.includes('NOT_REPRODUCED'),
        regression_and_documentation_updated:
          caseRecord.links.some(link => link.kind === 'regression_test') &&
          caseRecord.links.some(link => link.kind === 'runbook' && link.revision === 2) &&
          documented.executed && !documented.matches_documentation &&
          corrected.applied.length === 1 && verified.matches_documentation,
        duplicate_reports_preserve_history:
          caseCount === 1 && duplicate.history_length > beforeDuplicate &&
          timelineAfterRestart.some(entry => entry.event === 'duplicate_report') &&
          timelineAfterRestart.some(entry => entry.detail.includes('request_t32_duplicate')) &&
          timelineAfterRestart.length >= timelineBeforeStop,
        no_fake_24x7_or_sla_claim:
          coverageBefore.mode === 'on_demand' && coverageBefore.response_target === null &&
          honestClaim.publishable && !overpromise.publishable &&
          overpromise.reasons.includes('COVERAGE_CLAIM_NOT_CONFIGURED') &&
          !stoppedClaim.publishable && stoppedClaim.reasons.includes('OBSERVATION_CLAIMED_WHILE_STOPPED'),
        outbound_actions_require_authorization:
          !email.allowed && !webhook.allowed && approvedEmail.allowed &&
          email.reason === 'OUTBOUND_EMAIL_NOT_AUTHORIZED',
        client_satisfaction_not_written_by_agent:
          !agentSatisfaction.recorded && clientSatisfaction.recorded && !feedbackByWorker.recorded,
        case_status: caseRecord.status,
        timeline_entries: timelineAfterRestart.length,
      } satisfies Record<string, Json>,
      artifact_paths: writer.paths,
    };
  } finally {
    for (const entry of running) await entry.stop().catch(() => undefined);
    db.close();
    rmSync(sandbox, { recursive: true, force: true });
  }
});
