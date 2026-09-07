/** AT-030 executor — document jobs end to end, quiet UI and the shared budget.
 *
 * An empty project with no Git repository asks for a document review. Nothing manufactures a
 * software run, a repository or a deployment prompt. A second job creates a document from a
 * brief with no input files at all. The controller is then restarted mid-job, and the question,
 * the answer and the client's request are all still there.
 */
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DocumentJob, DocumentResult, Json, ScenarioObservation } from '../../contracts/interfaces.js';
import { digest } from '../../packages/contracts/src/canonical.js';
import { ControllerDatabase } from '../../packages/state/src/database.js';
import { LifecycleService } from '../../packages/core/src/lifecycle.js';
import { BudgetLedger } from '../../packages/core/src/budget.js';
import { SessionStore } from '../../apps/controller/src/auth.js';
import { DocumentStore } from '../../packages/documents/src/ingest.js';
import { DocumentJobService } from '../../packages/documents/src/jobs.js';
import { buildScope, inventoryVersion } from '../../packages/documents/src/inventory.js';
import { buildReport, describeArtifact } from '../../packages/documents/src/edit.js';
import {
  DOCUMENT_ROUTES, answerDocumentQuestion, downloadArtifact, getJob,
  listDocumentQuestions, quietView, submitDocumentMessage,
} from '../../apps/controller/src/document-routes.js';
import * as corpus from '../../fixtures/documents/corpus.js';
import { Evidence, attempt, fixedClock } from '../harness/evidence.js';
import { registerScenario } from '../harness/registry.js';

const PROJECT = 'project_t30';
const OTHER_PROJECT = 'project_t30_other';
const NOW = '2026-09-09T11:00:00.000Z';

registerScenario('AT-030', async (): Promise<ScenarioObservation> => {
  const writer = await Evidence.open('T30');
  const sandbox = mkdtempSync(path.join(tmpdir(), 'cm-t30-'));
  const stateDir = path.join(sandbox, 'state');
  let db = ControllerDatabase.open(stateDir);

  try {
    const clock = fixedClock(NOW);
    const service = new LifecycleService(db, { clock });
    for (const project of [PROJECT, OTHER_PROJECT]) {
      service.registerProject({ project_id: project, registered_root_ref: `file://${sandbox}/${project}`, profile_id: 'discover', data_class: 'internal' });
    }
    const sessions = new SessionStore({ bootstrap_secret: 'bootstrap-fixture-secret', clock: () => NOW });
    const session = sessions.exchange({ bootstrap_secret: 'bootstrap-fixture-secret', actor: 'client', actor_id: 'owner_1', origin: 'http://127.0.0.1:7788' });
    if ('rejected' in session) throw new Error('SESSION_SETUP_FAILED');
    const context = { service, session, request_id: 'req-t30' };
    let store = new DocumentStore(db, { blob_root: path.join(sandbox, 'blobs'), clock });
    let jobs = new DocumentJobService(db, { clock });

    // ---- 1. A document-only request in an empty project ------------------------------------
    const projectRoot = path.join(sandbox, PROJECT);
    rmSync(projectRoot, { recursive: true, force: true });
    const emptyProjectEntries = (() => { try { return readdirSync(projectRoot); } catch { return []; } })();
    await service.createRun({
      kind: 'client_request', schema_version: 1, request_id: 'request_t30_review', project_id: PROJECT,
      message: 'please review this contract and tell me if the cancellation rules match',
      language_hint: 'en', attachment_ids: [], privacy_class: 'internal', created_at: NOW,
    }, 'idem-t30-review');
    const pdf = store.upload({ project_id: PROJECT, declared_media_type: corpus.MEDIA_TYPES.pdf, bytes: corpus.pdfTerms(), privacy_class: 'internal', idempotency_key: 't30-pdf' });
    if (!pdf.stored) throw new Error('FIXTURE_REJECTED');
    const reviewJob = jobs.create({
      project_id: PROJECT, request_id: 'request_t30_review', operation: 'review',
      input_version_ids: [pdf.version.version_id], idempotency_key: 'job-review',
    });
    const softwareRuns = Number(db.get('SELECT COUNT(*) AS n FROM runs WHERE project_id = ?', PROJECT)?.['n'] ?? 0);
    const candidates = Number(db.get('SELECT COUNT(*) AS n FROM candidates WHERE project_id = ?', PROJECT)?.['n'] ?? 0);
    const deployments = Number(db.get("SELECT COUNT(*) AS n FROM audit_events WHERE payload_json LIKE '%deploy%'")?.['n'] ?? 0);
    const gitCreated = (() => { try { return readdirSync(projectRoot).includes('.git'); } catch { return false; } })();
    const documentOnly = reviewJob.software_run_id === null && !gitCreated &&
      emptyProjectEntries.length === 0 && candidates === 0 && deployments === 0 &&
      // The run created above is the client's request record, not a software implementation run.
      softwareRuns === 1 && db.get('SELECT state FROM runs WHERE project_id = ?', PROJECT)?.['state'] === 'RECEIVED';

    // ---- 2. Create from a brief, with no input documents -----------------------------------
    await service.createRun({
      kind: 'client_request', schema_version: 1, request_id: 'request_t30_create', project_id: PROJECT,
      message: 'write me a one page summary of our cancellation policy for staff',
      language_hint: 'en', attachment_ids: [], privacy_class: 'internal', created_at: NOW,
    }, 'idem-t30-create');
    const createJob = jobs.create({
      project_id: PROJECT, request_id: 'request_t30_create', operation: 'create',
      input_version_ids: [], idempotency_key: 'job-create',
    });
    const generatedScope = buildScope({
      job_id: createJob.job_id, project_id: PROJECT, scope_mode: 'generated_output',
      inventories: [], created_at: NOW,
      generated_output_binding: {
        request_id: 'request_t30_create', instruction_revision: 1,
        output_requirements: ['one page', 'states the cancellation window', 'written for staff'],
      },
    }).scope;
    const fabricatedInventory = attempt(() => buildScope({
      job_id: createJob.job_id, project_id: PROJECT, scope_mode: 'generated_output',
      inventories: [inventoryVersion({ version: pdf.version, bytes: corpus.pdfTerms() })], created_at: NOW,
      generated_output_binding: { request_id: 'request_t30_create', instruction_revision: 1, output_requirements: [] },
    }));
    const summary = buildReport([{ heading: 'Cancellation policy', lines: ['A booking may be cancelled within 48 hours of confirmation.'] }]);
    const summaryArtifact = describeArtifact({ artifact_id: 'artifact_summary', bytes: summary, media_type: corpus.MEDIA_TYPES.pdf, editable: false });
    const createWorks = createJob.input_version_ids.length === 0 &&
      generatedScope.scope_mode === 'generated_output' && generatedScope.source_version_ids.length === 0 &&
      generatedScope.units.length === 0 && generatedScope.inventory_digest.startsWith('sha256:') &&
      !fabricatedInventory.ok && summaryArtifact.byte_length > 0;

    // ---- 3. A question, an answer, and a restart -------------------------------------------
    jobs.transition({ job_id: reviewJob.job_id, expected_version: reviewJob.state_version, target: 'PROCESSING', actor: 'controller', reason: 'review started', idempotency_key: 'start-review' });
    const attemptOne = jobs.startAttempt({ job_id: reviewJob.job_id, project_id: PROJECT });
    const question = jobs.askQuestion({
      job_id: reviewJob.job_id, project_id: PROJECT,
      prompt: 'The terms say 24 hours and the manual says 48. Which should the summary use?',
      recommendation: null,
      citations: [{ version_id: pdf.version.version_id, content_digest: pdf.version.content_digest, locator: { type: 'page', page_number: 2 } }],
    });
    const listed = listDocumentQuestions(context, jobs, reviewJob.job_id);
    const answered = answerDocumentQuestion(context, jobs, { question_id: question.question_id, project_id: PROJECT, request_id: 'request_t30_review' });
    const workerContext = { ...context, session: { ...session, actor: 'worker' as const } };
    const workerAnswer = answerDocumentQuestion(workerContext, jobs, { question_id: question.question_id, project_id: PROJECT, request_id: 'request_t30_review' });

    // Restart: everything is read back from durable state, not from memory.
    db.close();
    db = ControllerDatabase.open(stateDir);
    const restartedService = new LifecycleService(db, { clock: fixedClock(NOW) });
    jobs = new DocumentJobService(db, { clock: fixedClock(NOW) });
    store = new DocumentStore(db, { blob_root: path.join(sandbox, 'blobs'), clock: fixedClock(NOW) });
    const afterRestart = jobs.get(reviewJob.job_id);
    const answersAfterRestart = Number(db.get('SELECT COUNT(*) AS n FROM document_answers WHERE job_id = ?', reviewJob.job_id)?.['n'] ?? 0);
    const questionAfterRestart = db.get('SELECT status FROM document_questions WHERE question_id = ?', question.question_id);
    const requestAfterRestart = db.get('SELECT message FROM client_requests WHERE request_id = ?', 'request_t30_review');
    const eventsAfterRestart = jobs.events(reviewJob.job_id);
    const survivesRestart = listed.status === 200 && answered.status === 201 && workerAnswer.status === 403 &&
      afterRestart.job_id === reviewJob.job_id && answersAfterRestart === 1 &&
      String(questionAfterRestart?.['status']) === 'ANSWERED' &&
      String(requestAfterRestart?.['message']).includes('review this contract') &&
      eventsAfterRestart.some(event => event.kind === 'job.question_answered') &&
      restartedService.getRun !== undefined;

    // ---- 4. A changed direction mid-job fences the old attempt ------------------------------
    const currentJob = jobs.get(reviewJob.job_id);
    const revised = submitDocumentMessage(context, jobs, {
      job_id: reviewJob.job_id, project_id: PROJECT,
      expected_version: currentJob.state_version, message: 'actually just check the published terms',
    });
    const staleWrite = jobs.checkAttempt({ job_id: reviewJob.job_id, attempt_id: attemptOne.attempt_id, instruction_revision: 1 });
    const freshAttempt = jobs.startAttempt({ job_id: reviewJob.job_id, project_id: PROJECT });
    const freshWrite = jobs.checkAttempt({ job_id: reviewJob.job_id, attempt_id: freshAttempt.attempt_id, instruction_revision: jobs.get(reviewJob.job_id).instruction_revision });
    const crossJobWrite = jobs.checkAttempt({ job_id: createJob.job_id, attempt_id: attemptOne.attempt_id, instruction_revision: 1 });
    const staleCannotDeliver = revised.status === 201 && !staleWrite.accepted &&
      (staleWrite.reason === 'ATTEMPT_REVOKED' || staleWrite.reason === 'STALE_INSTRUCTION_REVISION') &&
      freshWrite.accepted && !crossJobWrite.accepted &&
      jobs.openQuestions(reviewJob.job_id).length === 0;

    // ---- 5. One budget for both kinds of work ------------------------------------------------
    const ledger = new BudgetLedger(db, { clock: fixedClock(NOW) });
    ledger.setPolicy({
      project_id: PROJECT, cap_microusd: 1_000_000, verification_reserve_microusd: 200_000,
      unknown_usage_reserve_microusd: 50_000, billing_mode: 'native_account',
    }, 'maintainer');
    const softwareRun = await restartedService.createRun({
      kind: 'client_request', schema_version: 1, request_id: 'request_t30_software', project_id: PROJECT,
      message: 'also build me a small ordering page', language_hint: 'en', attachment_ids: [], privacy_class: 'internal', created_at: NOW,
    }, 'idem-t30-software');
    restartedService.createAttempt({
      attempt_id: 'attempt_t30_software', project_id: PROJECT, run_id: softwareRun.run_id, task_id: 'task_t30',
      attempt_number: 1, role: 'writer', parent_attempt_id: null, depth: 0, workspace_id: sandbox,
      base_source_digest: `sha256:${'a'.repeat(64)}`, allowed_write_paths: ['src/'], dependency_task_ids: [],
      deadline: '2026-09-10T00:00:00.000Z', provider_session_id: null,
    });
    const softwareReservation = ledger.reserve({ project_id: PROJECT, run_id: softwareRun.run_id, attempt_id: 'attempt_t30_software', microusd: 600_000 });
    const documentAttempt = jobs.startAttempt({ job_id: createJob.job_id, project_id: PROJECT });
    const documentReservation = jobs.reserve({ project_id: PROJECT, job_id: createJob.job_id, attempt_id: documentAttempt.attempt_id, microusd: 300_000 });
    const smallDocumentReservation = jobs.reserve({ project_id: PROJECT, job_id: createJob.job_id, attempt_id: documentAttempt.attempt_id, microusd: 100_000 });
    jobs.recordUsage({ project_id: PROJECT, job_id: createJob.job_id, attempt_id: documentAttempt.attempt_id, provider: 'fixture', provider_event_id: 'evt-1', cost_microusd: 50_000 });
    const duplicateUsage = jobs.recordUsage({ project_id: PROJECT, job_id: createJob.job_id, attempt_id: documentAttempt.attempt_id, provider: 'fixture', provider_event_id: 'evt-1', cost_microusd: 50_000 });
    const afterUsage = jobs.reserve({ project_id: PROJECT, job_id: createJob.job_id, attempt_id: documentAttempt.attempt_id, microusd: 100_000 });
    const budgetShared = softwareReservation.state.reserved_microusd === 600_000 &&
      !documentReservation.reserved && documentReservation.reason === 'SHARED_BUDGET_EXHAUSTED' &&
      smallDocumentReservation.reserved && duplicateUsage.duplicate && !afterUsage.reserved;

    // ---- 6. The quiet view, and a partial result that still says so --------------------------
    const partialResult: DocumentResult = {
      kind: 'document_result', schema_version: 1, result_id: `dres_${reviewJob.job_id}`,
      job_id: reviewJob.job_id, project_id: PROJECT, instruction_revision: jobs.get(reviewJob.job_id).instruction_revision,
      source_scope_digest: digest({ scope: 'review' }), source_version_ids: [pdf.version.version_id],
      coverage: 'PARTIAL', limitations: ['Page 3 has no text layer and no OCR engine is installed.'],
      calculation_status: 'NOT_APPLICABLE', qa_evidence_ref: 'devidence_t30', artifacts: [summaryArtifact], created_at: NOW,
    };
    jobs.transition({ job_id: reviewJob.job_id, expected_version: jobs.get(reviewJob.job_id).state_version, target: 'VERIFYING', actor: 'controller', reason: 'checks', idempotency_key: 'verify-t30' });
    jobs.recordResult(partialResult);
    const partialJob = jobs.transition({
      job_id: reviewJob.job_id, expected_version: jobs.get(reviewJob.job_id).state_version, target: 'PARTIAL',
      actor: 'document_verifier', reason: 'one page unreadable', idempotency_key: 'partial-t30', result_id: partialResult.result_id,
    });
    const view = quietView({ job: partialJob, questions: jobs.openQuestions(reviewJob.job_id), limitations: partialResult.limitations, coverage: 'PARTIAL' });
    const completeView = quietView({ job: { ...partialJob, state: 'READY' } as DocumentJob, questions: [], limitations: [], coverage: 'COMPLETE' });
    const allEvents = jobs.events(reviewJob.job_id);
    const routineNarration = allEvents.filter(event =>
      /progress|status_update|role_report|standup|working on/i.test(event.kind));
    const quietButHonest = view.notices.some(notice => notice.includes('no text layer')) &&
      view.role_reports.length === 0 && completeView.notices.length === 0 &&
      routineNarration.length === 0 &&
      !Object.values(DOCUMENT_ROUTES).some(route => /progress|status|report/.test(route.path));

    // ---- 7. A replayed download cannot cross projects ----------------------------------------
    const own = downloadArtifact(context, {
      artifact: summaryArtifact, bytes: summary, requested_name: 'summary.pdf',
      artifact_project_id: PROJECT, session_project_id: PROJECT,
    });
    const replayed = downloadArtifact(context, {
      artifact: summaryArtifact, bytes: summary, requested_name: 'summary.pdf',
      artifact_project_id: PROJECT, session_project_id: OTHER_PROJECT,
    });
    const crossProjectJob = getJob(context, jobs, reviewJob.job_id, OTHER_PROJECT);
    const crossProjectRead = attempt(() => store.read({ project_id: OTHER_PROJECT, version_id: pdf.version.version_id }));
    const downloadScoped = own.status === 200 && replayed.status === 404 &&
      crossProjectJob.status === 404 && !crossProjectRead.ok;

    await writer.write('document-jobs.json', {
      review_job: reviewJob, create_job: createJob, generated_scope: generatedScope,
      fabricated_inventory_refused: fabricatedInventory.ok ? null : fabricatedInventory.message,
      software_runs: softwareRuns, candidates, git_created: gitCreated,
      restart: { job: afterRestart, answers: answersAfterRestart, question_status: questionAfterRestart, events: eventsAfterRestart.length },
      revision: revised, stale_attempt: staleWrite, fresh_attempt: freshWrite, cross_job_attempt: crossJobWrite,
      outbox: jobs.outbox(reviewJob.job_id),
    } as unknown as Json);
    await writer.write('budget.json', {
      software_reservation: softwareReservation.state, document_reservation: documentReservation,
      small_document_reservation: smallDocumentReservation, duplicate_usage: duplicateUsage, after_usage: afterUsage,
    } as unknown as Json);
    await writer.write('quiet-view.json', {
      partial: view, complete: completeView, routine_narration: routineNarration,
      routes: DOCUMENT_ROUTES, download: { own, replayed }, cross_project_job: crossProjectJob,
    } as unknown as Json);

    return {
      scenario_id: 'AT-030',
      mode: 'integration',
      observed: {
        document_only_needs_no_git_or_software_run: documentOnly,
        create_without_input_documents_works: createWorks,
        questions_and_feedback_survive_restart: survivesRestart,
        stale_attempts_cannot_deliver: staleCannotDeliver,
        software_and_document_budget_shared: budgetShared,
        no_routine_role_reports: quietButHonest,
        partial_limitations_still_visible: view.notices.length > 0 && partialJob.state === 'PARTIAL',
        replayed_download_cannot_cross_projects: downloadScoped,
        document_events: allEvents.length,
      } satisfies Record<string, Json>,
      artifact_paths: writer.paths,
    };
  } finally {
    db.close();
    rmSync(sandbox, { recursive: true, force: true });
  }
});
