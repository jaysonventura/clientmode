/** AT-010 executor — live_provider.
 *
 * Recorded fixtures prove normalisation. The live half runs three small turns against the
 * Claude host installed on this machine, in a throwaway project outside this repository, on
 * the existing authorized native account. Nothing here configures metered billing, and if the
 * host is unavailable the observations report BLOCKED rather than borrowing the fixture result.
 */
import { readFileSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Contract, EngineeringContext, Json, ProviderContext, ScenarioObservation, TaskAttempt } from '../../contracts/interfaces.js';
import { validateEntity } from '../../packages/contracts/src/validate.js';
import { ClaudeAdapter, buildTaskPrompt } from '../../packages/providers/src/claude.js';
import { normaliseStream } from '../../packages/providers/src/normalize.js';
import { assertNoPermissionEscape, FORBIDDEN_FLAGS } from '../../packages/providers/src/host-session.js';
import { DEFAULT_TRUSTED_ROOTS, standardProbes } from '../../apps/cli/src/doctor.js';
import { Evidence, ROOT, attempt, fixedClock } from '../harness/evidence.js';
import { disposableProject, liveHostAvailable, liveTurn } from '../harness/live-provider.js';
import { registerScenario } from '../harness/registry.js';

const MARKER = 'CLIENT_MODE_INSTRUCTIONS_LOADED';
const NOW = '2026-09-08T12:00:00.000Z';

function fixture<T>(name: string, patch: Partial<T>): T {
  return { ...(JSON.parse(readFileSync(path.join(ROOT, 'contracts/examples', `${name}.json`), 'utf8')) as T), ...patch };
}

function providerContext(workspace: string): ProviderContext {
  const contract = fixture<Contract>('contract', { contract_id: 'contract_t10', project_id: 'project_t10', request_ids: ['request_t10'] });
  const task: TaskAttempt = {
    kind: 'task_attempt', schema_version: 1, task_id: 'task_t10', attempt_id: 'attempt_t10',
    run_id: 'run_t10', project_id: 'project_t10', attempt_number: 1, role: 'writer',
    parent_attempt_id: null, depth: 0, workspace_id: workspace,
    base_source_digest: `sha256:${'a'.repeat(64)}`, allowed_write_paths: ['src/'],
    dependency_task_ids: [], lease_epoch: 1, deadline: '2026-09-09T00:00:00.000Z',
    provider_session_id: null, status: 'LEASED',
  };
  return {
    project_id: 'project_t10', run_id: 'run_t10', attempt_id: 'attempt_t10', workspace_id: workspace,
    contract, task, evidence_ids: [],
    engineering_context: fixture<EngineeringContext>('engineering-context', {
      context_id: 'ctx_t10', project_id: 'project_t10', task_id: 'task_t10', requirements_revision: contract.revision,
    }),
    billing_mode: 'native_account', capability_report_id: 'report_t10',
  };
}

registerScenario('AT-010', async (): Promise<ScenarioObservation> => {
  const writer = await Evidence.open('T10');
  const clock = fixedClock(NOW);
  const log: Record<string, unknown> = {};
  const projects: string[] = [];

  try {
    const adapter = new ClaudeAdapter({
      executable: 'claude', trusted_roots: DEFAULT_TRUSTED_ROOTS,
      probes: standardProbes({ provider: 'claude', surface: 'native_cli', executable: 'claude' }),
      clock, permission_mode: 'plan', disallowed_tools: ['Bash', 'Write', 'Edit'],
    });

    // 1. Recorded protocol events normalise into the controller's vocabulary, and a shape
    //    this version has never seen is counted rather than interpreted.
    const recorded = readFileSync(path.join(ROOT, 'fixtures/provider-events/claude-stream.jsonl'), 'utf8').split('\n');
    const injected = [
      ...recorded,
      JSON.stringify({ type: 'a_future_event_type', payload: { session_id: 'not-a-session', total_cost_usd: 999 } }),
      JSON.stringify({ type: 'system', subtype: 'init' }), // init with no session id
      'not json at all',
    ];
    const normalisation = { provider: 'claude' as const, run_id: 'run_t10', attempt_id: 'attempt_t10', billing_mode: 'native_account' as const, occurred_at: NOW };
    const summary = normaliseStream(injected, normalisation, 'claude');
    const usage = summary.usage[0];
    log['normalisation'] = {
      session_id: summary.session_id, claims: summary.claims, ignored: summary.ignored,
      unrecognised: summary.unrecognised, usage,
      usage_schema: usage === undefined ? null : validateEntity(usage),
    };
    const eventsNormalised = summary.session_id !== null && summary.claims.length > 0 &&
      usage !== undefined && usage.coverage === 'complete' &&
      usage.input_tokens !== null && usage.cache_read_tokens !== null &&
      validateEntity(usage).valid &&
      summary.unrecognised.includes('a_future_event_type') &&
      summary.unrecognised.includes('system/init') &&
      // the unknown event's session id and cost were not adopted from its payload
      summary.session_id !== 'not-a-session' && usage.cost_usd !== 999;

    // 2. A worker cannot talk the adapter into a permission escape.
    const escapes = FORBIDDEN_FLAGS.map(flag => ({
      flag,
      refused: attempt(() => assertNoPermissionEscape(['-p', 'do the task', flag])).ok === false,
    }));
    const escapeAdapter = new ClaudeAdapter({
      executable: 'claude', trusted_roots: DEFAULT_TRUSTED_ROOTS,
      probes: [], clock, extra_args: ['--allow-dangerously-skip-permissions'],
    });
    const escapeViaOptions = attempt(() => escapeAdapter.argvFor({ prompt: 'x' }));
    const safeArgv = adapter.argvFor({ prompt: 'x', session_id: randomUUID() });
    log['permission_escape'] = { flags: escapes, via_options: escapeViaOptions, safe_argv: safeArgv };
    const escapeDenied = escapes.every(entry => entry.refused) &&
      !escapeViaOptions.ok && escapeViaOptions.code === 'PermissionEscapeError' &&
      safeArgv.includes('--permission-mode') && safeArgv.includes('plan') &&
      safeArgv.includes('--disallowedTools') &&
      !safeArgv.some(argument => FORBIDDEN_FLAGS.some(flag => argument.startsWith(flag)));

    // 3. Live half.
    const availability = await liveHostAvailable('claude');
    log['live_availability'] = availability;
    if (!availability.available) {
      await writer.write('claude-adapter.json', log);
      return {
        scenario_id: 'AT-010', mode: 'live_provider',
        observed: {
          protocol_events_normalized: eventsNormalised,
          native_instructions_preserved: false,
          fresh_session_load_observed: false,
          worker_permission_escape_denied: escapeDenied,
          live_resume_verified: false,
          live_status: `BLOCKED_LIVE_HOST_UNAVAILABLE: ${availability.reason}`,
        } satisfies Record<string, Json>,
        artifact_paths: writer.paths,
      };
    }

    // A throwaway project carrying the generated native instructions.
    const instructionsBody = readFileSync(path.join(ROOT, 'adapters/claude/CLAUDE.md'), 'utf8');
    const project = disposableProject({ file: 'CLAUDE.md', body: instructionsBody });
    projects.push(project);
    const before = readFileSync(path.join(project, 'CLAUDE.md'), 'utf8');

    const freshSessionId = randomUUID();
    const fresh = await liveTurn({
      executable: 'claude', cwd: project,
      argv: adapter.argvForWorkspace(project, { prompt: 'Reply with the delivery marker from your instructions and nothing else.', session_id: freshSessionId }),
    });
    const freshSummary = normaliseStream(fresh.lines, { ...normalisation, attempt_id: 'attempt_t10_fresh' }, 'claude');
    const after = readFileSync(path.join(project, 'CLAUDE.md'), 'utf8');
    log['fresh_session'] = {
      exit_code: fresh.exit_code, session_id: freshSummary.session_id,
      claims: freshSummary.claims, usage: freshSummary.usage,
      unrecognised: freshSummary.unrecognised,
      instructions_unchanged: before === after,
      instructions_bytes: Buffer.byteLength(after),
    };
    const freshLoaded = freshSummary.claims.some(claim => claim.includes(MARKER));
    const instructionsPreserved = before === after && instructionsBody.includes(MARKER) &&
      // the adapter never rewrote the project's own instruction file
      after === instructionsBody;

    // 4. Resume the same session and check continuity across turns.
    const codeword = `ORCHID-${randomUUID().slice(0, 8).toUpperCase()}`;
    const resumeProject = disposableProject({ file: 'CLAUDE.md', body: instructionsBody });
    projects.push(resumeProject);
    const resumeSessionId = randomUUID();
    const first = await liveTurn({
      executable: 'claude', cwd: resumeProject,
      argv: adapter.argvForWorkspace(resumeProject, { prompt: `Remember this codeword for later: ${codeword}. Reply with just: STORED`, session_id: resumeSessionId }),
    });
    const firstSummary = normaliseStream(first.lines, { ...normalisation, attempt_id: 'attempt_t10_resume_1' }, 'claude');
    const resumed = await liveTurn({
      executable: 'claude', cwd: resumeProject,
      argv: adapter.argvForWorkspace(resumeProject, { prompt: 'What codeword did I ask you to remember? Reply with the codeword only.', resume: firstSummary.session_id ?? resumeSessionId }),
    });
    const resumedSummary = normaliseStream(resumed.lines, { ...normalisation, attempt_id: 'attempt_t10_resume_2' }, 'claude');
    log['resume'] = {
      codeword_length: codeword.length,
      first_session: firstSummary.session_id, first_claims: firstSummary.claims,
      resumed_session: resumedSummary.session_id, resumed_claims: resumedSummary.claims,
      resumed_exit: resumed.exit_code,
      continuity: resumedSummary.claims.some(claim => claim.includes(codeword)),
      usage_across_turns: [...firstSummary.usage, ...resumedSummary.usage].map(entry => ({ coverage: entry.coverage, input_tokens: entry.input_tokens, output_tokens: entry.output_tokens, cost_usd: entry.cost_usd })),
    };
    const resumeVerified = firstSummary.session_id !== null &&
      resumedSummary.session_id !== null &&
      resumedSummary.claims.some(claim => claim.includes(codeword));

    // The task prompt handed to a worker carries the bounded packet and nothing wider.
    const prompt = buildTaskPrompt(providerContext(project));
    log['task_prompt'] = { bytes: Buffer.byteLength(prompt), mentions_scope: prompt.includes('Allowed write scope'), excerpt: prompt.slice(0, 400) };

    await writer.write('claude-adapter.json', log);
    await writer.write('normalised-events.json', summary.events);

    return {
      scenario_id: 'AT-010',
      mode: 'live_provider',
      observed: {
        protocol_events_normalized: eventsNormalised,
        native_instructions_preserved: instructionsPreserved,
        fresh_session_load_observed: freshLoaded,
        worker_permission_escape_denied: escapeDenied,
        live_resume_verified: resumeVerified,
        live_host_version: availability.version,
        live_turns_executed: 3,
        billing_mode: 'native_account',
      } satisfies Record<string, Json>,
      artifact_paths: writer.paths,
    };
  } finally {
    for (const project of projects) rmSync(project, { recursive: true, force: true });
  }
});
