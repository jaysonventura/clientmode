/** AT-015 executor.
 *
 * The real controller listens on loopback and serves the real React console, bundled from
 * `apps/console`. Chromium drives it. Quietness is counted from what the client can actually
 * read on screen, not from what the code intends to hide.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ClientRequest, Json, ScenarioObservation } from '../../contracts/interfaces.js';
import { ControllerDatabase } from '../../packages/state/src/database.js';
import { LifecycleService } from '../../packages/core/src/lifecycle.js';
import { appendEvent } from '../../packages/state/src/events.js';
import { SessionStore } from '../../apps/controller/src/auth.js';
import { createControllerServer, listenLoopback } from '../../apps/controller/src/server.js';
import { checkContinuity, replay, ROUTINE_KINDS } from '../../apps/controller/src/events.js';
import { openBrowser, type BrowserSession } from '../../packages/browser/src/journeys.js';
import { observeKeyboard, runAxe } from '../../packages/browser/src/accessibility.js';
import { ArtifactStore } from '../../packages/browser/src/artifacts.js';
import { Evidence, fixedClock } from '../harness/evidence.js';
import { buildConsole } from '../harness/console-build.js';
import { registerScenario } from '../harness/registry.js';

const PROJECT = 'project_t15';
const NOW = '2026-09-08T17:00:00.000Z';
const BOOTSTRAP = 'bootstrap-t15-secret';
/** A reference whose text is markup. It must reach the screen as characters, not as an element. */
const HTML_REFERENCE = '<img src=x onerror="window.__executed=true"><b>bold</b>';

registerScenario('AT-015', async (): Promise<ScenarioObservation> => {
  const writer = await Evidence.open('T15');
  const clock = fixedClock(NOW);
  const sandbox = mkdtempSync(path.join(tmpdir(), 'cm-t15-'));
  const db = ControllerDatabase.open(path.join(sandbox, 'state'));
  const store = new ArtifactStore(path.join(sandbox, 'console-artifacts'));
  const log: Record<string, unknown> = {};
  let session: BrowserSession | null = null;
  let listening: { url: string; close: () => Promise<void> } | null = null;

  try {
    const service = new LifecycleService(db, { clock });
    const sessions = new SessionStore({ bootstrap_secret: BOOTSTRAP, clock: () => NOW });
    service.registerProject({ project_id: PROJECT, registered_root_ref: `file://${sandbox}/work`, profile_id: 'discover', data_class: 'internal' });

    const request: ClientRequest = {
      kind: 'client_request', schema_version: 1, request_id: 'request_t15', project_id: PROJECT,
      message: 'Simple ordering site. No account, no online payment.',
      language_hint: 'en', attachment_ids: [], privacy_class: 'internal', created_at: NOW,
    };
    const run = await service.createRun(request, 'idem-t15');

    // Routine internal traffic plus one material blocker, all recorded in the durable log.
    for (const kind of ROUTINE_KINDS) {
      appendEvent(db, { run_id: run.run_id, project_id: PROJECT, kind, actor_id: 'controller', payload: { note: 'routine internal progress' }, at: clock() });
    }
    const question = service.askQuestion({
      question_id: 'question_t15', project_id: PROJECT, run_id: run.run_id, requirements_revision: 0,
      prompt: `Should we record a deposit before delivery? Reference from your file: ${HTML_REFERENCE}`,
      recommendation: 'Start with payment on delivery only.',
      blocking_task_ids: ['task_checkout'], source_request_ids: ['request_t15'],
    });
    const queued = service.askQuestion({
      question_id: 'question_t15_second', project_id: PROJECT, run_id: run.run_id, requirements_revision: 0,
      prompt: 'A second question that must stay queued.', recommendation: null,
      blocking_task_ids: [], source_request_ids: ['request_t15'],
    });
    appendEvent(db, {
      run_id: run.run_id, project_id: PROJECT, kind: 'security_denial', actor_id: 'controller',
      payload: { reason: 'the delivery API credential is missing, so that integration is unverified' }, at: clock(),
    });

    // Boot the console against the real controller.
    const boot = { run_id: run.run_id, status: 'RECEIVED', bootstrap_secret: BOOTSTRAP };
    const consoleDir = await buildConsole(path.join(sandbox, 'console'), boot);
    const server = createControllerServer({ db, service, sessions, console_dir: consoleDir, project_id: PROJECT });
    listening = await listenLoopback(server);

    // 1. Event replay from a known sequence: no gap, no duplicate.
    const all = replay(db, { run_id: run.run_id, after: 0, mode: 'quiet' });
    const fromMiddle = replay(db, { run_id: run.run_id, after: 5, mode: 'quiet' });
    const continuityAll = checkContinuity(all, 0);
    const continuityResume = checkContinuity(fromMiddle, 5);
    const overlap = fromMiddle.filter(event => event.sequence <= 5);
    log['replay'] = {
      total: all.length, from_sequence_5: fromMiddle.length,
      continuity_all: continuityAll, continuity_resume: continuityResume,
      duplicates_before_resume_point: overlap.length,
      first_sequence_after_resume: fromMiddle[0]?.sequence ?? null,
    };
    const replayClean = continuityAll.contiguous && continuityResume.contiguous &&
      overlap.length === 0 && fromMiddle[0]?.sequence === 6 &&
      all.length === fromMiddle.length + 5;

    // 2. Quiet mode: routine progress is recorded and not narrated.
    const narrated = all.filter(event => event.client_text !== null);
    const routineNarrated = narrated.filter(event => ROUTINE_KINDS.includes(event.kind)).length;
    const drawer = replay(db, { run_id: run.run_id, after: 0, mode: 'drawer' });
    log['quiet'] = {
      recorded: all.length, narrated: narrated.length, routine_narrated: routineNarrated,
      narrated_kinds: [...new Set(narrated.map(event => event.kind))],
      drawer_lines: drawer.filter(event => event.client_text !== null).length,
    };

    // 3. Drive the real console in a real browser.
    const opened = await openBrowser();
    if (!('browser' in opened)) {
      log['browser'] = opened;
      await writer.write('console.json', log);
      return {
        scenario_id: 'AT-015', mode: 'integration',
        observed: {
          routine_narrative_messages: routineNarrated, material_blocker_visible: false,
          cancel_control_responsive: false, event_replay_no_gaps_or_duplicates: replayClean,
          keyboard_primary_actions_operable: false, cross_origin_mutations_denied: false,
          answer_and_active_message_flow_without_candidate: false,
          one_open_question_visible_per_run: false, text_reference_html_is_not_executed: false,
          browser_status: 'UNVERIFIED_BROWSER_UNAVAILABLE',
        } satisfies Record<string, Json>,
        artifact_paths: writer.paths,
      };
    }
    session = opened;
    const context = await session.browser.newContext({ viewport: { width: 390, height: 844 }, baseURL: listening.url });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(String(error.message)));
    // Every controller call the console makes is recorded, so a failure is visible as a
    // status rather than as an empty screen.
    const consoleCalls: Array<{ method: string; path: string; status: number }> = [];
    page.on('response', response => {
      const url = new URL(response.url());
      if (url.pathname.startsWith('/v1/')) consoleCalls.push({ method: response.request().method(), path: url.pathname, status: response.status() });
    });

    await page.goto('/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);

    // The direct API probes get their own browser context, and therefore their own cookie jar.
    // Exchanging a second session in the console's context would replace its cookie and leave
    // its CSRF token paired with a session that no longer exists — which is exactly what the
    // server should refuse, and not what these probes are here to test.
    const apiContext = await session.browser.newContext({ baseURL: listening.url });
    const exchange = await apiContext.request.post(`${listening.url}/v1/session`, {
      data: { bootstrap_secret: BOOTSTRAP, actor_id: 'owner_1' },
      headers: { origin: listening.url },
    });
    const exchanged = await exchange.json() as { csrf_token: string };

    const visibleMessages = await page.getByTestId('messages').locator('li').allTextContents();
    const blockerVisible = visibleMessages.some(text => text.includes('delivery API credential'));
    const promptText = await page.getByTestId('question-prompt').textContent();
    const executed = await page.evaluate(() => (window as unknown as { __executed?: boolean }).__executed === true);
    const imageCount = await page.locator('#question-heading ~ p img').count();
    log['console'] = {
      status: await page.getByTestId('status').textContent(),
      visible_messages: visibleMessages,
      blocker_visible: blockerVisible,
      question_prompt_contains_markup_as_text: (promptText ?? '').includes('<img src=x'),
      script_executed: executed, injected_img_elements: imageCount,
      page_errors: pageErrors, controller_calls: consoleCalls,
    };
    const referenceInert = (promptText ?? '').includes('<img src=x') && executed === false && imageCount === 0;

    // Only one question is offered, though two are open in the run.
    const questionCount = await page.locator('[data-testid="question-prompt"]').count();
    const questionsApi = await apiContext.request.get(`${listening.url}/v1/runs/${run.run_id}/questions`, { headers: { origin: listening.url } });
    const questionsBody = await questionsApi.json() as { questions: unknown[]; queued: number };
    log['questions'] = { rendered: questionCount, api: questionsBody, second_question_status: queued.status };
    const oneQuestionVisible = questionCount === 1 && questionsBody.questions.length === 1 && queued.status === 'SUPERSEDED';

    // 4. Keyboard operability and accessibility of the console itself.
    const keyboard = await observeKeyboard(page, '#answer-input');
    const axe = await runAxe(page);
    store.put(await page.screenshot({ fullPage: true }), 'image/png', '-console.png');
    log['accessibility'] = { keyboard, axe };
    const keyboardOperable = keyboard.reached.some(stop => stop.includes('answer-input')) &&
      keyboard.reached.some(stop => stop.includes('send-answer')) &&
      keyboard.reached.some(stop => stop.includes('cancel')) &&
      keyboard.unnamed_controls.length === 0 && axe.serious_or_critical === 0;

    // 5. Answer and active message with no candidate in existence, from the console.
    const beforeCandidate = await service.getRun(run.run_id);
    await page.getByTestId('answer-input').fill('Walang deposit. Bayad on delivery.');
    await page.getByTestId('send-answer').click();
    await page.waitForTimeout(300);
    const answerRows = Number(db.get('SELECT COUNT(*) AS n FROM client_answers WHERE question_id = ?', question.question_id)?.['n'] ?? 0);
    const runNow = await service.getRun(run.run_id);
    const messageResponse = await apiContext.request.post(`${listening.url}/v1/runs/${run.run_id}/messages`, {
      data: { message: 'Also make the main button easier to find.' },
      headers: { origin: listening.url, 'x-csrf-token': exchanged.csrf_token, 'idempotency-key': 'message-t15', 'if-match': String(runNow.state_version) },
    });
    log['answer_and_message'] = {
      candidate_before: beforeCandidate.candidate_id, contract_before: beforeCandidate.contract_id,
      answers_recorded: answerRows, message_status: messageResponse.status(),
      messages_recorded: Number(db.get('SELECT COUNT(*) AS n FROM run_messages WHERE run_id = ?', run.run_id)?.['n'] ?? 0),
    };
    const flowWithoutCandidate = beforeCandidate.candidate_id === null && answerRows === 1 && messageResponse.status() === 201;

    // 6. Cross-origin and worker-token mutations are refused by the running server.
    const foreignOrigin = await apiContext.request.post(`${listening.url}/v1/runs/${run.run_id}/messages`, {
      data: { message: 'from another site' },
      headers: { origin: 'https://evil.example', 'x-csrf-token': exchanged.csrf_token, 'idempotency-key': 'evil-1', 'if-match': '1' },
      failOnStatusCode: false,
    });
    const noCsrf = await apiContext.request.post(`${listening.url}/v1/runs/${run.run_id}/messages`, {
      data: { message: 'no token' },
      headers: { origin: listening.url, 'idempotency-key': 'evil-2', 'if-match': '1' },
      failOnStatusCode: false,
    });
    const workerToken = await apiContext.request.post(`${listening.url}/v1/runs/${run.run_id}/messages`, {
      data: { message: 'from a worker' },
      headers: { origin: listening.url, authorization: 'Worker abc', 'x-csrf-token': exchanged.csrf_token, 'idempotency-key': 'evil-3', 'if-match': '1' },
      failOnStatusCode: false,
    });
    log['cross_origin'] = {
      foreign_origin: foreignOrigin.status(), missing_csrf: noCsrf.status(), worker_token: workerToken.status(),
    };
    const crossOriginDenied = foreignOrigin.status() === 403 && noCsrf.status() === 403 && workerToken.status() === 403;

    // 7. Cancel stays responsive while work is notionally running.
    const cancelStarted = Date.now();
    await page.getByTestId('cancel').click();
    await page.waitForTimeout(200);
    const cancelElapsed = Date.now() - cancelStarted;
    const intents = db.all('SELECT action, leases_revoked FROM run_control_intents WHERE run_id = ?', run.run_id);
    const statusText = await page.getByTestId('status').textContent();
    const typedWhileBusy = await page.getByTestId('message-input').isEditable();
    log['cancel'] = {
      elapsed_ms: cancelElapsed, intents, status_after: statusText, input_still_editable: typedWhileBusy,
      controller_calls: consoleCalls,
    };
    const cancelResponsive = cancelElapsed < 1000 && intents.some(row => String(row['action']) === 'cancel') && typedWhileBusy;

    await apiContext.close();
    await context.close();
    await writer.write('console.json', log);
    await writer.write('replayed-events.json', all.map(event => ({ sequence: event.sequence, kind: event.kind, client_text: event.client_text })));

    return {
      scenario_id: 'AT-015',
      mode: 'integration',
      observed: {
        routine_narrative_messages: routineNarrated,
        material_blocker_visible: blockerVisible,
        cancel_control_responsive: cancelResponsive,
        event_replay_no_gaps_or_duplicates: replayClean,
        keyboard_primary_actions_operable: keyboardOperable,
        cross_origin_mutations_denied: crossOriginDenied,
        answer_and_active_message_flow_without_candidate: flowWithoutCandidate,
        one_open_question_visible_per_run: oneQuestionVisible,
        text_reference_html_is_not_executed: referenceInert,
        events_recorded: all.length,
        events_narrated: narrated.length,
      } satisfies Record<string, Json>,
      artifact_paths: writer.paths,
    };
  } finally {
    if (session !== null) await session.browser.close().catch(() => undefined);
    if (listening !== null) await listening.close().catch(() => undefined);
    db.close();
    rmSync(sandbox, { recursive: true, force: true });
  }
});
