/** Durable per-run event log and audit trail. Callers append inside their own transaction
 * so a state change and its event either both commit or neither does.
 */
import { randomUUID } from 'node:crypto';
import type { AuditEvent } from '../../../contracts/interfaces.js';
import type { ControllerDatabase } from './database.js';

export type EventKind = AuditEvent['event_type'];

export type AppendEvent = {
  run_id: string;
  project_id: string | null;
  kind: EventKind;
  actor_id: string;
  payload: Record<string, unknown>;
  at: string;
};

/** Monotonic per-run sequence. Selected and inserted in the caller's transaction. */
export function appendEvent(db: ControllerDatabase, event: AppendEvent): AuditEvent {
  const row = db.get('SELECT COALESCE(MAX(sequence), 0) AS last FROM events WHERE run_id = ?', event.run_id);
  const sequence = Number(row?.['last'] ?? 0) + 1;
  const event_id = `evt_${randomUUID()}`;
  const payload_json = JSON.stringify(event.payload);
  db.run('INSERT INTO events (run_id, sequence, event_id, kind, payload_json, created_at) VALUES (?,?,?,?,?,?)',
    event.run_id, sequence, event_id, event.kind, payload_json, event.at);
  db.run('INSERT INTO audit_events (audit_id, project_id, run_id, actor_id, kind, payload_json, created_at) VALUES (?,?,?,?,?,?,?)',
    `aud_${randomUUID()}`, event.project_id, event.run_id, event.actor_id, event.kind, payload_json, event.at);
  return {
    kind: 'audit_event', schema_version: 1, event_id, run_id: event.run_id, sequence,
    actor_id: event.actor_id, event_type: event.kind, payload: event.payload, occurred_at: event.at,
  };
}

export function readEvents(db: ControllerDatabase, run_id: string, after = 0): AuditEvent[] {
  return db.all('SELECT * FROM events WHERE run_id = ? AND sequence > ? ORDER BY sequence', run_id, after)
    .map(row => ({
      kind: 'audit_event' as const, schema_version: 1 as const,
      event_id: String(row['event_id']), run_id: String(row['run_id']), sequence: Number(row['sequence']),
      actor_id: 'controller', event_type: String(row['kind']) as EventKind,
      payload: JSON.parse(String(row['payload_json'])) as Record<string, unknown>,
      occurred_at: String(row['created_at']),
    }));
}
