/** MOCK PROTOCOL ADAPTER — deterministic, offline, and explicitly not a provider.
 * It satisfies no live-provider, protected-isolation or benchmark gate. Its only purpose is
 * to make controller-side calls observable without spending anything.
 */
import type {
  CapabilityReport, ProviderAdapter, ProviderContext, ProviderEvent, UsageEvent,
} from '../../contracts/interfaces.js';

export type ProviderCall = { kind: 'discover' | 'start' | 'resume' | 'cancel'; attempt_id: string | null; at: string };

export class FakeProvider implements ProviderAdapter {
  readonly name = 'claude' as const;
  readonly calls: ProviderCall[] = [];
  readonly sessions: string[] = [];
  #sequence = 0;

  constructor(private readonly clock: () => string) {}

  get startedCount(): number {
    return this.calls.filter(call => call.kind === 'start').length;
  }

  async discover(_signal: AbortSignal): Promise<CapabilityReport> {
    this.calls.push({ kind: 'discover', attempt_id: null, at: this.clock() });
    return {
      kind: 'capability_report', schema_version: 1, report_id: 'report_mock_protocol',
      provider: 'mock', host_surface: 'mock', host_version: 'mock-protocol-fixture',
      sdk_version: null, os: process.platform, billing_mode: 'unknown',
      capabilities: [{
        name: 'mock_protocol_stream', documented: false, configured: true, observed_working: true,
        evidence_refs: ['tests/harness/fake-provider.ts'],
        limitation: 'Offline protocol fixture; proves no installed host capability.',
      }],
      observed_at: this.clock(),
    };
  }

  async *start(context: ProviderContext, _signal: AbortSignal): AsyncIterable<ProviderEvent> {
    this.calls.push({ kind: 'start', attempt_id: context.attempt_id, at: this.clock() });
    const session_id = `session_mock_${++this.#sequence}`;
    this.sessions.push(session_id);
    yield { type: 'session', session_id, attempt_id: context.attempt_id };
    yield { type: 'claim', attempt_id: context.attempt_id, text: 'mock protocol claim, not evidence' };
    yield { type: 'ended', attempt_id: context.attempt_id, reason: 'completed_turn' };
  }

  async *resume(session_id: string, context: ProviderContext, _signal: AbortSignal): AsyncIterable<ProviderEvent> {
    this.calls.push({ kind: 'resume', attempt_id: context.attempt_id, at: this.clock() });
    yield { type: 'session', session_id, attempt_id: context.attempt_id };
    yield { type: 'ended', attempt_id: context.attempt_id, reason: 'completed_turn' };
  }

  async cancel(attempt_id: string): Promise<{ acknowledged: boolean; requires_reconciliation: boolean }> {
    this.calls.push({ kind: 'cancel', attempt_id, at: this.clock() });
    return { acknowledged: true, requires_reconciliation: true };
  }

  /** A protocol-shaped usage event. Its numbers are fixture values, not billing truth. */
  usage(input: { run_id: string; attempt_id: string; provider_event_id: string; cost_usd: number | null; coverage: UsageEvent['coverage'] }): UsageEvent {
    return {
      kind: 'usage_event', schema_version: 1,
      usage_event_id: `usage_${input.provider_event_id}`, provider_event_id: input.provider_event_id,
      run_id: input.run_id, attempt_id: input.attempt_id, provider: 'mock', billing_mode: 'native_account',
      input_tokens: 1000, output_tokens: 500, cache_read_tokens: null, cache_write_tokens: null,
      reasoning_tokens: null, cost_usd: input.cost_usd, coverage: input.coverage, occurred_at: this.clock(),
    };
  }
}
