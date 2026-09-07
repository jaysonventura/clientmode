/** The client event stream.
 *
 * Every run has a monotonic sequence. A client that reconnects sends the last sequence it saw
 * and receives exactly what it missed — no gap, no duplicate — because replay reads the same
 * durable log the live stream is appended to, rather than a separate in-memory buffer that can
 * drift from it.
 *
 * Quiet mode is a filter on what the *client* sees, never on what is recorded. Routine progress
 * stays in the log for the engineering drawer and the audit trail; it is simply not narrated.
 */
import { readEvents, type EventKind } from '../../../packages/state/src/events.js';
import type { ControllerDatabase } from '../../../packages/state/src/database.js';

export type ClientEvent = {
  sequence: number;
  run_id: string;
  kind: EventKind;
  /** What the client sees. Absent means this event is internal-only in quiet mode. */
  client_text: string | null;
  payload: Record<string, unknown>;
  occurred_at: string;
};

/** The only event kinds a quiet console narrates: a question it must answer, a real blocker, a
 * readiness change, and the approval it has to decide. Everything else is drawer material. */
const CLIENT_VISIBLE: Partial<Record<EventKind, (payload: Record<string, unknown>) => string>> = {
  question_asked: payload => `A question needs your answer: ${String(payload['question_id'])}`,
  question_answered: () => 'Answer recorded.',
  readiness_changed: payload => `Status: ${String(payload['to'])}`,
  approval_requested: payload => `An approval is waiting: ${String(payload['action'] ?? 'action')}`,
  security_denial: payload => `Blocked: ${String(payload['reason'] ?? 'a security boundary refused this')}`,
  budget_paused: payload => `Paused: ${String(payload['reason'] ?? 'budget')}`,
};

/** Routine internal traffic. Recorded, never narrated. */
export const ROUTINE_KINDS: EventKind[] = [
  'job_admitted', 'job_revoked', 'candidate_sealed', 'verification_requested',
  'attempt_fenced', 'responsibility_assigned', 'contract_revised', 'message_received',
  'request_received', 'evidence_rejected', 'deployment_intent', 'deployment_observed', 'approval_recorded',
];

export type StreamMode = 'quiet' | 'drawer';

export function toClientEvent(input: {
  sequence: number; run_id: string; kind: EventKind;
  payload: Record<string, unknown>; occurred_at: string; mode: StreamMode;
}): ClientEvent {
  const render = CLIENT_VISIBLE[input.kind];
  const material = input.kind === 'readiness_changed'
    ? ['BLOCKED', 'READY_FOR_REVIEW', 'AWAITING_RELEASE_APPROVAL', 'RELEASED', 'FAILED', 'CANCELLED'].includes(String(input.payload['to']))
    // A question that was queued behind another is recorded, not shown: one at a time.
    : input.kind === 'question_asked' ? input.payload['status'] === 'OPEN'
    : true;
  const client_text = render !== undefined && material ? render(input.payload) : null;
  return {
    sequence: input.sequence, run_id: input.run_id, kind: input.kind,
    client_text: input.mode === 'drawer' ? (client_text ?? `${input.kind}`) : client_text,
    payload: input.payload, occurred_at: input.occurred_at,
  };
}

/** Replay from the durable log. `after` is the last sequence the client acknowledged. */
export function replay(db: ControllerDatabase, input: { run_id: string; after: number; mode: StreamMode }): ClientEvent[] {
  return readEvents(db, input.run_id, input.after).map(event => toClientEvent({
    sequence: event.sequence, run_id: event.run_id, kind: event.event_type,
    payload: event.payload, occurred_at: event.occurred_at, mode: input.mode,
  }));
}

export function encodeServerSentEvent(event: ClientEvent): string {
  return `id: ${event.sequence}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`;
}

/** A stream is correct when the sequences it delivered are contiguous and unique. */
export function checkContinuity(events: ClientEvent[], from: number): { contiguous: boolean; duplicates: number[]; gaps: number[] } {
  const seen = new Set<number>();
  const duplicates: number[] = [];
  const gaps: number[] = [];
  let expected = from + 1;
  for (const event of events) {
    if (seen.has(event.sequence)) duplicates.push(event.sequence);
    seen.add(event.sequence);
    while (expected < event.sequence) { gaps.push(expected); expected += 1; }
    if (event.sequence === expected) expected += 1;
  }
  return { contiguous: duplicates.length === 0 && gaps.length === 0, duplicates, gaps };
}
