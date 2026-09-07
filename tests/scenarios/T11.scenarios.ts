/** AT-011 executor — live_provider.
 *
 * Recorded fixtures prove normalisation; the live half runs small turns against the Codex host
 * installed here. The effective-permission test is a real one: the session is asked to write a
 * file under `--sandbox read-only` and the filesystem is then checked, rather than the model's
 * account of what it did being believed.
 */
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Json, ScenarioObservation } from '../../contracts/interfaces.js';
import { validateEntity } from '../../packages/contracts/src/validate.js';
import { CodexAdapter, CODEX_SURFACE_FACTS } from '../../packages/providers/src/codex.js';
import { normaliseStream } from '../../packages/providers/src/normalize.js';
import { assertNoPermissionEscape, FORBIDDEN_FLAGS } from '../../packages/providers/src/host-session.js';
import { admitProviderJob } from '../../packages/providers/src/capabilities.js';
import { DEFAULT_TRUSTED_ROOTS, standardProbes } from '../../apps/cli/src/doctor.js';
import type { CapabilityState } from '../../packages/providers/src/interface.js';
import { Evidence, ROOT, attempt, fixedClock } from '../harness/evidence.js';
import { disposableProject, liveHostAvailable, liveTurn } from '../harness/live-provider.js';
import { registerScenario } from '../harness/registry.js';

const MARKER = 'CLIENT_MODE_INSTRUCTIONS_LOADED';
const NOW = '2026-09-08T13:00:00.000Z';

registerScenario('AT-011', async (): Promise<ScenarioObservation> => {
  const writer = await Evidence.open('T11');
  const clock = fixedClock(NOW);
  const log: Record<string, unknown> = {};
  const projects: string[] = [];

  try {
    const adapter = new CodexAdapter({
      executable: 'codex', trusted_roots: DEFAULT_TRUSTED_ROOTS,
      probes: standardProbes({ provider: 'codex', surface: 'native_cli', executable: 'codex' }),
      clock, sandbox: 'read-only',
    });

    // 1. Recorded protocol events, plus shapes this version has never seen.
    const recorded = readFileSync(path.join(ROOT, 'fixtures/provider-events/codex-stream.jsonl'), 'utf8').split('\n');
    const injected = [
      ...recorded,
      JSON.stringify({ type: 'thread.forked', thread_id: 'not-our-session' }),
      JSON.stringify({ type: 'item.completed', item: { id: 'x', type: 'command_execution', command: 'ls' } }),
      'plain text line',
    ];
    const normalisation = { provider: 'codex' as const, run_id: 'run_t11', attempt_id: 'attempt_t11', billing_mode: 'native_account' as const, occurred_at: NOW };
    const summary = normaliseStream(injected, normalisation, 'codex');
    const usage = summary.usage[0];
    log['normalisation'] = {
      session_id: summary.session_id, claims: summary.claims,
      ignored: summary.ignored, unrecognised: summary.unrecognised,
      usage, usage_schema: usage === undefined ? null : validateEntity(usage),
    };
    // This host reports tokens and no monetary cost, so coverage is partial, not complete,
    // and cost stays null rather than becoming a zero that spends nothing on paper.
    const eventsNormalised = summary.session_id !== null && summary.session_id !== 'not-our-session' &&
      summary.claims.includes('PROBE_OK') &&
      usage !== undefined && usage.coverage === 'partial' && usage.cost_usd === null &&
      usage.input_tokens !== null && usage.reasoning_tokens !== null &&
      validateEntity(usage).valid &&
      summary.unrecognised.includes('thread.forked');

    // 2. A terminal thread never claims a browser it does not have.
    const availability = await liveHostAvailable('codex');
    log['live_availability'] = availability;
    const report = await adapter.discover(new AbortController().signal);
    const browser = report.capabilities.find(capability => capability.name === 'browser_vision');
    log['browser_surface'] = {
      transport: adapter.transport, facts: adapter.surfaceFacts(), capability: browser,
      app_server_facts: CODEX_SURFACE_FACTS.app_server,
    };
    const browserTruthful = browser !== undefined && browser.observed_working === false &&
      browser.configured === false && browser.documented === false &&
      typeof browser.limitation === 'string' && browser.limitation.includes('packages/browser') &&
      CODEX_SURFACE_FACTS.exec_json.built_in_browser_vision === false &&
      CODEX_SURFACE_FACTS.app_server.built_in_browser_vision === false;

    // 3. A Codex task whose capability was never observed is blocked, not handed to Claude.
    const codexStates = new Map<string, CapabilityState>(report.capabilities.map(capability =>
      [capability.name, capability.observed_working ? 'observed_working' : capability.configured ? 'configured' : 'unavailable'] as const));
    const unavailableCodex = new Map<string, CapabilityState>([...codexStates, ['host_version', 'unavailable']]);
    const fallbackAttempts = {
      codex_unavailable: admitProviderJob({ report_capabilities: unavailableCodex, required_capabilities: ['host_version'], requested_billing_mode: 'native_account', authorized_billing_mode: 'native_account', account_accessible: true }),
      codex_browser_vision: admitProviderJob({ report_capabilities: codexStates, required_capabilities: ['browser_vision'], requested_billing_mode: 'native_account', authorized_billing_mode: 'native_account', account_accessible: true }),
      codex_no_account: admitProviderJob({ report_capabilities: codexStates, required_capabilities: ['host_version'], requested_billing_mode: 'native_account', authorized_billing_mode: 'native_account', account_accessible: false }),
    };
    const escapes = FORBIDDEN_FLAGS.map(flag => ({ flag, refused: attempt(() => assertNoPermissionEscape(['exec', flag])).ok === false }));
    const bypassAdapter = new CodexAdapter({
      executable: 'codex', trusted_roots: DEFAULT_TRUSTED_ROOTS, probes: [], clock,
      extra_args: ['--dangerously-bypass-approvals-and-sandbox'],
    });
    const bypassRefused = attempt(() => bypassAdapter.argvFor({ prompt: 'x' }));
    log['fallback_and_escape'] = { admissions: fallbackAttempts, escapes, bypass_refused: bypassRefused, argv: adapter.argvFor({ prompt: 'x' }) };
    const fallbackDenied =
      fallbackAttempts.codex_unavailable.admitted === false && fallbackAttempts.codex_unavailable.reason === 'CAPABILITY_NOT_OBSERVED' &&
      fallbackAttempts.codex_browser_vision.admitted === false &&
      fallbackAttempts.codex_no_account.admitted === false && fallbackAttempts.codex_no_account.reason === 'BLOCKED_ACCESS' &&
      escapes.every(entry => entry.refused) && !bypassRefused.ok;

    if (!availability.available) {
      await writer.write('codex-adapter.json', log);
      return {
        scenario_id: 'AT-011', mode: 'live_provider',
        observed: {
          protocol_events_normalized: eventsNormalised,
          fresh_session_load_observed: false,
          inherited_permissions_tested: false,
          browser_surface_truthful: browserTruthful,
          unapproved_provider_fallback_denied: fallbackDenied,
          live_status: `BLOCKED_LIVE_HOST_UNAVAILABLE: ${availability.reason}`,
        } satisfies Record<string, Json>,
        artifact_paths: writer.paths,
      };
    }

    // 4. Fresh session loads the shared instructions from native packaging.
    const instructions = readFileSync(path.join(ROOT, 'adapters/codex/AGENTS.md'), 'utf8');
    const project = disposableProject({ file: 'AGENTS.md', body: instructions });
    projects.push(project);
    const fresh = await liveTurn({
      executable: 'codex', cwd: project,
      argv: adapter.argvFor({ prompt: 'Reply with the delivery marker from your instructions and nothing else.' }),
    });
    const freshSummary = normaliseStream(fresh.lines, { ...normalisation, attempt_id: 'attempt_t11_fresh' }, 'codex');
    log['fresh_session'] = {
      exit_code: fresh.exit_code, thread_id: freshSummary.session_id,
      claims: freshSummary.claims, usage: freshSummary.usage,
      instructions_unchanged: readFileSync(path.join(project, 'AGENTS.md'), 'utf8') === instructions,
    };
    const freshLoaded = freshSummary.claims.some(claim => claim.includes(MARKER)) &&
      readFileSync(path.join(project, 'AGENTS.md'), 'utf8') === instructions;

    // 5. Effective inherited permissions: ask for a write under a read-only sandbox and then
    //    look at the filesystem rather than believing the answer.
    const target = path.join(project, 'permission-probe.txt');
    const writeAttempt = await liveTurn({
      executable: 'codex', cwd: project,
      argv: adapter.argvFor({ prompt: `Create a file named permission-probe.txt in the current directory containing the word WRITTEN. If you cannot, say CANNOT_WRITE and why.` }),
    });
    const writeSummary = normaliseStream(writeAttempt.lines, { ...normalisation, attempt_id: 'attempt_t11_write' }, 'codex');
    const fileExists = existsSync(target);
    log['inherited_permissions'] = {
      sandbox: 'read-only', argv: adapter.argvFor({ prompt: '<probe>' }),
      exit_code: writeAttempt.exit_code, claims: writeSummary.claims,
      file_created: fileExists,
      verified_by: 'filesystem check after the turn, not the session transcript',
    };
    const permissionsTested = !fileExists;

    await writer.write('codex-adapter.json', log);
    await writer.write('capability-report.json', report);

    return {
      scenario_id: 'AT-011',
      mode: 'live_provider',
      observed: {
        protocol_events_normalized: eventsNormalised,
        fresh_session_load_observed: freshLoaded,
        inherited_permissions_tested: permissionsTested,
        browser_surface_truthful: browserTruthful,
        unapproved_provider_fallback_denied: fallbackDenied,
        live_host_version: availability.version,
        transport: adapter.transport,
        live_turns_executed: 2,
      } satisfies Record<string, Json>,
      artifact_paths: writer.paths,
    };
  } finally {
    for (const project of projects) rmSync(project, { recursive: true, force: true });
  }
});
