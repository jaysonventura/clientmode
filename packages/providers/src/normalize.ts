/** Normalising provider output into the controller's own event vocabulary.
 *
 * Two disciplines matter here more than completeness:
 *
 *   - An event shape this version has never seen is counted and ignored. It is never guessed
 *     at, and it never becomes a claim, a usage figure or a session identifier.
 *   - An absent counter is `unavailable`, and a partial one is `partial`. Nothing missing is
 *     recorded as zero, because a zero would be spent silently against the budget.
 *
 * The shapes below were observed from the installed hosts and are recorded in
 * fixtures/provider-events/. They are recordings, not a contract the providers owe us.
 */
import { randomUUID } from 'node:crypto';
import type { ProviderEvent, UsageEvent } from '../../../contracts/interfaces.js';

export type NormalisationContext = {
  provider: 'claude' | 'codex' | 'mock';
  run_id: string;
  attempt_id: string;
  billing_mode: 'native_account' | 'approved_api';
  occurred_at: string;
};

export type Normalised = {
  event: ProviderEvent | null;
  /** Set when the line parsed as JSON but its shape is not one this version understands. */
  unrecognised: boolean;
  raw_type: string | null;
};

const ignored = (raw_type: string | null): Normalised => ({ event: null, unrecognised: false, raw_type });
const unknown = (raw_type: string | null): Normalised => ({ event: null, unrecognised: true, raw_type });

function parse(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const value: unknown = JSON.parse(trimmed);
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function integerOrNull(value: unknown): number | null {
  return Number.isSafeInteger(value) ? value as number : null;
}

/** Coverage is decided by what the provider actually reported, never by a default. */
export function usageCoverage(input: { cost_usd: number | null; tokens_present: boolean }): UsageEvent['coverage'] {
  if (input.cost_usd !== null && input.tokens_present) return 'complete';
  if (input.tokens_present || input.cost_usd !== null) return 'partial';
  return 'unavailable';
}

function usageEvent(context: NormalisationContext, input: {
  provider_event_id: string;
  input_tokens: number | null; output_tokens: number | null;
  cache_read_tokens: number | null; cache_write_tokens: number | null;
  reasoning_tokens: number | null; cost_usd: number | null;
}): UsageEvent {
  const tokens_present = [input.input_tokens, input.output_tokens].some(value => value !== null);
  return {
    kind: 'usage_event', schema_version: 1,
    usage_event_id: `usage_${randomUUID()}`,
    provider_event_id: input.provider_event_id,
    run_id: context.run_id, attempt_id: context.attempt_id,
    provider: context.provider, billing_mode: context.billing_mode,
    input_tokens: input.input_tokens, output_tokens: input.output_tokens,
    cache_read_tokens: input.cache_read_tokens, cache_write_tokens: input.cache_write_tokens,
    reasoning_tokens: input.reasoning_tokens, cost_usd: input.cost_usd,
    coverage: usageCoverage({ cost_usd: input.cost_usd, tokens_present }),
    occurred_at: context.occurred_at,
  };
}

/** Claude Code `--output-format stream-json`. */
export function normaliseClaudeLine(line: string, context: NormalisationContext): Normalised {
  const event = parse(line);
  if (event === null) return ignored(null);
  const type = typeof event['type'] === 'string' ? event['type'] : null;

  if (type === 'system' && event['subtype'] === 'init') {
    const session_id = event['session_id'];
    if (typeof session_id !== 'string') return unknown('system/init');
    return { event: { type: 'session', session_id, attempt_id: context.attempt_id }, unrecognised: false, raw_type: 'system/init' };
  }
  // Hook and rate-limit notices are host-local telemetry, not run state.
  if (type === 'system' || type === 'rate_limit_event' || type === 'user' || type === 'stream_event') return ignored(type);

  if (type === 'assistant') {
    const message = event['message'] as { content?: unknown } | undefined;
    const content = Array.isArray(message?.content) ? message.content : [];
    const text = content
      .filter((part): part is { type: string; text: string } => typeof (part as { text?: unknown })?.text === 'string')
      .map(part => part.text).join('\n');
    if (text === '') return ignored('assistant');
    return { event: { type: 'claim', attempt_id: context.attempt_id, text }, unrecognised: false, raw_type: 'assistant' };
  }

  if (type === 'result') {
    const usage = (event['usage'] ?? {}) as Record<string, unknown>;
    const denials = Array.isArray(event['permission_denials']) ? event['permission_denials'] : [];
    if (denials.length > 0) {
      return {
        event: { type: 'blocked', attempt_id: context.attempt_id, code: 'PERMISSION_DENIED', message: `${denials.length} tool permission denial(s) recorded by the host` },
        unrecognised: false, raw_type: 'result/permission_denials',
      };
    }
    return {
      event: {
        type: 'usage',
        event: usageEvent(context, {
          provider_event_id: typeof event['uuid'] === 'string' ? event['uuid'] : `result:${String(event['session_id'])}`,
          input_tokens: integerOrNull(usage['input_tokens']),
          output_tokens: integerOrNull(usage['output_tokens']),
          cache_read_tokens: integerOrNull(usage['cache_read_input_tokens']),
          cache_write_tokens: integerOrNull(usage['cache_creation_input_tokens']),
          reasoning_tokens: integerOrNull((usage['output_tokens_details'] as Record<string, unknown> | undefined)?.['thinking_tokens']),
          cost_usd: typeof event['total_cost_usd'] === 'number' ? event['total_cost_usd'] : null,
        }),
      },
      unrecognised: false, raw_type: 'result',
    };
  }
  return unknown(type);
}

/** Claude's terminal event carries the outcome; `ended` is derived from it separately so a
 * single line can yield both usage and an end. */
export function claudeEndReason(line: string): 'completed_turn' | 'cancelled' | 'limit' | 'error' | null {
  const event = parse(line);
  if (event === null || event['type'] !== 'result') return null;
  if (event['is_error'] === true) return 'error';
  if (typeof event['stop_reason'] === 'string' && /limit/i.test(event['stop_reason'])) return 'limit';
  return 'completed_turn';
}

/** codex exec `--json`. */
export function normaliseCodexLine(line: string, context: NormalisationContext): Normalised {
  const event = parse(line);
  if (event === null) return ignored(null);
  const type = typeof event['type'] === 'string' ? event['type'] : null;

  if (type === 'thread.started') {
    const thread_id = event['thread_id'];
    if (typeof thread_id !== 'string') return unknown('thread.started');
    return { event: { type: 'session', session_id: thread_id, attempt_id: context.attempt_id }, unrecognised: false, raw_type: type };
  }
  if (type === 'turn.started') return ignored(type);

  if (type === 'item.completed') {
    const item = (event['item'] ?? {}) as Record<string, unknown>;
    if (item['type'] === 'agent_message' && typeof item['text'] === 'string') {
      return { event: { type: 'claim', attempt_id: context.attempt_id, text: item['text'] }, unrecognised: false, raw_type: `${type}/agent_message` };
    }
    // Other item kinds are real host output this version does not interpret.
    return ignored(`${type}/${String(item['type'])}`);
  }

  if (type === 'turn.completed') {
    const usage = (event['usage'] ?? {}) as Record<string, unknown>;
    return {
      event: {
        type: 'usage',
        event: usageEvent(context, {
          provider_event_id: `turn:${context.attempt_id}:${String(usage['input_tokens'] ?? 'unknown')}:${String(usage['output_tokens'] ?? 'unknown')}`,
          input_tokens: integerOrNull(usage['input_tokens']),
          output_tokens: integerOrNull(usage['output_tokens']),
          cache_read_tokens: integerOrNull(usage['cached_input_tokens']),
          cache_write_tokens: integerOrNull(usage['cache_write_input_tokens']),
          reasoning_tokens: integerOrNull(usage['reasoning_output_tokens']),
          // This host reports tokens and no monetary cost. Unknown stays unknown.
          cost_usd: null,
        }),
      },
      unrecognised: false, raw_type: type,
    };
  }
  if (type === 'turn.failed' || type === 'error') {
    return {
      event: { type: 'blocked', attempt_id: context.attempt_id, code: 'PROVIDER_ERROR', message: String(event['message'] ?? 'host reported a turn failure').slice(0, 300) },
      unrecognised: false, raw_type: type,
    };
  }
  return unknown(type);
}

export type StreamSummary = {
  events: ProviderEvent[];
  unrecognised: Array<string | null>;
  ignored: number;
  session_id: string | null;
  usage: UsageEvent[];
  claims: string[];
};

export function normaliseStream(lines: string[], context: NormalisationContext, provider: 'claude' | 'codex'): StreamSummary {
  const normalise = provider === 'claude' ? normaliseClaudeLine : normaliseCodexLine;
  const summary: StreamSummary = { events: [], unrecognised: [], ignored: 0, session_id: null, usage: [], claims: [] };
  for (const line of lines) {
    const result = normalise(line, context);
    if (result.unrecognised) { summary.unrecognised.push(result.raw_type); continue; }
    if (result.event === null) { summary.ignored += 1; continue; }
    summary.events.push(result.event);
    if (result.event.type === 'session') summary.session_id = result.event.session_id;
    if (result.event.type === 'usage') summary.usage.push(result.event.event);
    if (result.event.type === 'claim') summary.claims.push(result.event.text);
  }
  return summary;
}
