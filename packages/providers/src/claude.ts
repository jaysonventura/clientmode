/** Claude Code adapter.
 *
 * Uses the host's documented non-interactive surface for the installed version:
 * `claude -p --output-format stream-json --verbose`, with `--session-id` to name a session
 * and `--resume` to continue one. Flags are taken from `claude --help` on the machine the
 * adapter runs on, not copied from an older report.
 *
 * The adapter carries no credential. The host authenticates through its own documented store,
 * and a candidate process never sees either.
 */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { CapabilityReport, ProviderAdapter, ProviderContext, ProviderEvent } from '../../../contracts/interfaces.js';
import { detectCapabilities, detectHost } from './capabilities.js';
import { assertNoPermissionEscape, cancelHostProcess, startHostProcess, type HostSession } from './host-session.js';
import { claudeEndReason, normaliseClaudeLine, type NormalisationContext } from './normalize.js';
import type { CapabilityProbe } from './interface.js';

export type ClaudeAdapterOptions = {
  executable: string;
  trusted_roots: string[];
  probes: CapabilityProbe[];
  clock?: () => string;
  /** Tools the worker may never use, regardless of what its task text asks for. */
  disallowed_tools?: string[];
  permission_mode?: 'plan' | 'acceptEdits' | 'manual' | 'dontAsk';
  extra_args?: string[];
  model?: string;
  /** The only MCP servers the worker may load. A client repository's `.mcp.json` is never
   * read: under `-p` the host would load it without asking (docs: mcp#project-scope). */
  mcp_config?: string;
};

/** The prompt is assembled from the bounded context packet. The full handoff, other projects'
 * facts and previous sessions are deliberately not in it. */
export function buildTaskPrompt(context: ProviderContext): string {
  const requirements = context.contract.requirements
    .filter(requirement => requirement.classification !== 'unresolved')
    .map(requirement => `- [${requirement.classification}] ${requirement.id}: ${requirement.description}`)
    .join('\n');
  const components = context.engineering_context.components
    .map(component => `- ${component.component_id} (${component.languages.join(', ') || 'no declared language'}) on ${component.target_platforms.join(', ')}; checks: ${component.required_check_ids.join(', ')}`)
    .join('\n');
  return [
    `Task ${context.task.task_id}, attempt ${context.task.attempt_id}.`,
    `Allowed write scope: ${context.task.allowed_write_paths.join(', ') || 'none'}.`,
    '',
    'Approved requirements:',
    requirements,
    '',
    'Components in scope:',
    components,
    '',
    'Report what you changed and what you could not verify. Your claim is not acceptance:',
    'protected checks run separately and decide readiness.',
  ].join('\n');
}

export class ClaudeAdapter implements ProviderAdapter {
  readonly name = 'claude' as const;
  readonly #options: ClaudeAdapterOptions;
  readonly #now: () => string;
  readonly #sessions = new Map<string, HostSession>();

  constructor(options: ClaudeAdapterOptions) {
    this.#options = options;
    this.#now = options.clock ?? (() => new Date().toISOString());
  }

  async discover(_signal: AbortSignal): Promise<CapabilityReport> {
    const host = await detectHost({
      provider: 'claude', surface: 'native_cli',
      executable: this.#options.executable, trusted_roots: this.#options.trusted_roots,
      sdk_package: '@anthropic-ai/claude-agent-sdk',
    });
    const detection = await detectCapabilities({
      host, probes: this.#options.probes, billing_mode: 'native_account', observed_at: this.#now(),
    });
    return detection.report;
  }

  /** Argv is built here and validated before anything is spawned. */
  argvFor(input: { prompt: string; session_id?: string; resume?: string; instructions_file?: string }): string[] {
    const argv = [
      '-p', input.prompt,
      '--output-format', 'stream-json',
      '--verbose',
      '--permission-mode', this.#options.permission_mode ?? 'plan',
      '--strict-mcp-config',
      // Only the user's settings: a client repository's .claude/settings.json hooks, env block and
      // helpers would otherwise run under -p even in an untrusted folder (docs: permissions).
      // This also stops the project's CLAUDE.md from loading (observed on 2.1.280), so the
      // workspace instructions are appended explicitly below.
      '--setting-sources', 'user',
    ];
    if (input.instructions_file !== undefined) argv.push('--append-system-prompt-file', input.instructions_file);
    if (this.#options.mcp_config !== undefined) argv.push('--mcp-config', this.#options.mcp_config);
    if (input.resume !== undefined) argv.push('--resume', input.resume);
    else if (input.session_id !== undefined) argv.push('--session-id', input.session_id);
    if (this.#options.model !== undefined) argv.push('--model', this.#options.model);
    if ((this.#options.disallowed_tools ?? []).length > 0) {
      argv.push('--disallowedTools', ...(this.#options.disallowed_tools ?? []));
    }
    argv.push(...(this.#options.extra_args ?? []));
    assertNoPermissionEscape(argv);
    return argv;
  }

  /** Argv for a run in `workspace`: the workspace's CLAUDE.md, when there is one, is appended as
   * instructions, because `--setting-sources user` keeps the host from loading it. */
  argvForWorkspace(workspace: string, input: { prompt: string; session_id?: string; resume?: string }): string[] {
    const instructions = path.join(path.resolve(workspace), 'CLAUDE.md');
    return this.argvFor({ ...input, ...(existsSync(instructions) ? { instructions_file: instructions } : {}) });
  }

  async *start(context: ProviderContext, signal: AbortSignal): AsyncIterable<ProviderEvent> {
    yield* this.#run(context, signal, { session_id: randomUUID() });
  }

  async *resume(session_id: string, context: ProviderContext, signal: AbortSignal): AsyncIterable<ProviderEvent> {
    yield* this.#run(context, signal, { resume: session_id });
  }

  async *#run(context: ProviderContext, signal: AbortSignal, mode: { session_id?: string; resume?: string }): AsyncIterable<ProviderEvent> {
    const host = await detectHost({
      provider: 'claude', surface: 'native_cli',
      executable: this.#options.executable, trusted_roots: this.#options.trusted_roots,
    });
    if (host.executable_path === null) {
      yield { type: 'blocked', attempt_id: context.attempt_id, code: 'HOST_NOT_INSTALLED', message: 'Claude host not found on a trusted path' };
      return;
    }
    const argv = this.argvForWorkspace(context.workspace_id, { prompt: buildTaskPrompt(context), ...mode });
    const session = startHostProcess({
      executable: host.executable_path, argv, cwd: context.workspace_id, signal,
    });
    this.#sessions.set(context.attempt_id, session);

    const normalisation: NormalisationContext = {
      provider: 'claude', run_id: context.run_id, attempt_id: context.attempt_id,
      billing_mode: context.billing_mode, occurred_at: this.#now(),
    };
    let end: 'completed_turn' | 'cancelled' | 'limit' | 'error' = 'completed_turn';
    try {
      for await (const line of session.lines) {
        const reason = claudeEndReason(line);
        if (reason !== null) end = reason;
        const normalised = normaliseClaudeLine(line, { ...normalisation, occurred_at: this.#now() });
        if (normalised.event !== null) yield normalised.event;
      }
      const exit = await session.exited;
      if (exit.signal !== null) end = 'cancelled';
      else if (exit.code !== 0 && end === 'completed_turn') end = 'error';
    } finally {
      this.#sessions.delete(context.attempt_id);
    }
    yield { type: 'ended', attempt_id: context.attempt_id, reason: end };
  }

  async cancel(attempt_id: string): Promise<{ acknowledged: boolean; requires_reconciliation: boolean }> {
    const session = this.#sessions.get(attempt_id);
    if (session === undefined) return { acknowledged: false, requires_reconciliation: true };
    const acknowledged = cancelHostProcess(session.child);
    // Killing the group stops our tree. Whether anything the host started outside it has
    // finished is not knowable from here, so reconciliation is always required.
    return { acknowledged, requires_reconciliation: true };
  }
}
