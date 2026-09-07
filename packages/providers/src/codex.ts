/** Codex adapter.
 *
 * Uses the host's documented non-interactive surface for the installed version:
 * `codex exec --json` for a task thread, `codex exec resume <thread-id>` to continue one, and
 * `--sandbox read-only` unless the task genuinely needs to write. Flags come from
 * `codex exec --help` on this machine.
 *
 * The transport is recorded on every report, because a terminal thread and an interactive App
 * Server client are different surfaces with different capabilities, and neither inherits the
 * other's.
 */
import type { CapabilityReport, ProviderAdapter, ProviderContext, ProviderEvent } from '../../../contracts/interfaces.js';
import { detectCapabilities, detectHost } from './capabilities.js';
import { assertNoPermissionEscape, cancelHostProcess, startHostProcess, type HostSession } from './host-session.js';
import { normaliseCodexLine, type NormalisationContext } from './normalize.js';
import { buildTaskPrompt } from './claude.js';
import type { CapabilityProbe } from './interface.js';

export type CodexTransport = 'exec_json' | 'app_server';

export type CodexAdapterOptions = {
  executable: string;
  trusted_roots: string[];
  probes: CapabilityProbe[];
  clock?: () => string;
  sandbox?: 'read-only' | 'workspace-write';
  transport?: CodexTransport;
  skip_git_repo_check?: boolean;
  extra_args?: string[];
  model?: string;
};

/** What a terminal thread can and cannot claim. Recorded rather than assumed, because a
 * terminal session has no browser of its own and must not imply one. */
export const CODEX_SURFACE_FACTS = {
  exec_json: {
    transport: 'exec_json',
    interactive_approvals: false,
    built_in_browser_vision: false,
    browser_evidence_source: 'controller-owned Playwright probes in packages/browser',
  },
  app_server: {
    transport: 'app_server',
    interactive_approvals: true,
    built_in_browser_vision: false,
    browser_evidence_source: 'controller-owned Playwright probes in packages/browser',
  },
} as const;

export class CodexAdapter implements ProviderAdapter {
  readonly name = 'codex' as const;
  readonly #options: CodexAdapterOptions;
  readonly #now: () => string;
  readonly #sessions = new Map<string, HostSession>();

  constructor(options: CodexAdapterOptions) {
    this.#options = options;
    this.#now = options.clock ?? (() => new Date().toISOString());
  }

  get transport(): CodexTransport { return this.#options.transport ?? 'exec_json'; }

  /** A terminal thread never reports browser vision, whatever a task prompt asks for. */
  surfaceFacts(): typeof CODEX_SURFACE_FACTS[CodexTransport] {
    return CODEX_SURFACE_FACTS[this.transport];
  }

  async discover(_signal: AbortSignal): Promise<CapabilityReport> {
    const host = await detectHost({
      provider: 'codex', surface: this.transport === 'app_server' ? 'app_server' : 'native_cli',
      executable: this.#options.executable, trusted_roots: this.#options.trusted_roots,
      sdk_package: '@openai/codex-sdk',
    });
    const detection = await detectCapabilities({
      host, probes: this.#options.probes, billing_mode: 'native_account', observed_at: this.#now(),
    });
    return {
      ...detection.report,
      capabilities: [
        ...detection.report.capabilities,
        {
          name: 'browser_vision',
          documented: false, configured: false, observed_working: false,
          evidence_refs: [`transport:${this.transport}`],
          limitation: `This ${this.transport} transport has no browser of its own; browser evidence comes from ${this.surfaceFacts().browser_evidence_source}.`,
        },
      ],
    };
  }

  argvFor(input: { prompt: string; resume?: string }): string[] {
    const argv = ['exec'];
    if (input.resume !== undefined) argv.push('resume', input.resume);
    argv.push('--json', '--sandbox', this.#options.sandbox ?? 'read-only');
    if (this.#options.skip_git_repo_check !== false) argv.push('--skip-git-repo-check');
    if (this.#options.model !== undefined) argv.push('--model', this.#options.model);
    argv.push(...(this.#options.extra_args ?? []));
    argv.push(input.prompt);
    assertNoPermissionEscape(argv);
    return argv;
  }

  async *start(context: ProviderContext, signal: AbortSignal): AsyncIterable<ProviderEvent> {
    yield* this.#run(context, signal, {});
  }

  async *resume(session_id: string, context: ProviderContext, signal: AbortSignal): AsyncIterable<ProviderEvent> {
    yield* this.#run(context, signal, { resume: session_id });
  }

  async *#run(context: ProviderContext, signal: AbortSignal, mode: { resume?: string }): AsyncIterable<ProviderEvent> {
    const host = await detectHost({
      provider: 'codex', surface: 'native_cli',
      executable: this.#options.executable, trusted_roots: this.#options.trusted_roots,
    });
    if (host.executable_path === null) {
      yield { type: 'blocked', attempt_id: context.attempt_id, code: 'HOST_NOT_INSTALLED', message: 'Codex host not found on a trusted path' };
      return;
    }
    const argv = this.argvFor({ prompt: buildTaskPrompt(context), ...mode });
    const session = startHostProcess({ executable: host.executable_path, argv, cwd: context.workspace_id, signal });
    this.#sessions.set(context.attempt_id, session);

    const normalisation: NormalisationContext = {
      provider: 'codex', run_id: context.run_id, attempt_id: context.attempt_id,
      billing_mode: context.billing_mode, occurred_at: this.#now(),
    };
    let end: 'completed_turn' | 'cancelled' | 'limit' | 'error' = 'completed_turn';
    try {
      for await (const line of session.lines) {
        const normalised = normaliseCodexLine(line, { ...normalisation, occurred_at: this.#now() });
        if (normalised.event !== null) {
          if (normalised.event.type === 'blocked') end = 'error';
          yield normalised.event;
        }
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
    return { acknowledged: cancelHostProcess(session.child), requires_reconciliation: true };
  }
}
