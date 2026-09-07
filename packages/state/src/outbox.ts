/** Transactional outbox: external effects are recorded with the state change that caused them
 * and delivered afterwards, so a crash between commit and delivery loses no intent.
 */
import { randomUUID } from 'node:crypto';
import type { ControllerDatabase } from './database.js';

export type OutboxEntry = {
  outbox_id: string;
  run_id: string;
  operation: string;
  idempotency_key: string;
  payload: Record<string, unknown>;
  status: 'PENDING' | 'DELIVERED' | 'FAILED';
  attempts: number;
};

function toEntry(row: Record<string, unknown>): OutboxEntry {
  return {
    outbox_id: String(row['outbox_id']), run_id: String(row['run_id']),
    operation: String(row['operation']), idempotency_key: String(row['idempotency_key']),
    payload: JSON.parse(String(row['payload_json'])) as Record<string, unknown>,
    status: String(row['status']) as OutboxEntry['status'], attempts: Number(row['attempts']),
  };
}

/** Replaying the same idempotency key returns the recorded entry instead of enqueuing twice. */
export function enqueue(db: ControllerDatabase, entry: {
  run_id: string; operation: string; idempotency_key: string;
  payload: Record<string, unknown>; at: string;
}): OutboxEntry {
  const existing = db.get('SELECT * FROM outbox WHERE idempotency_key = ?', entry.idempotency_key);
  if (existing) return toEntry(existing);
  const outbox_id = `obx_${randomUUID()}`;
  db.run('INSERT INTO outbox (outbox_id, run_id, operation, idempotency_key, payload_json, status, attempts, created_at) VALUES (?,?,?,?,?,?,0,?)',
    outbox_id, entry.run_id, entry.operation, entry.idempotency_key, JSON.stringify(entry.payload), 'PENDING', entry.at);
  return { outbox_id, run_id: entry.run_id, operation: entry.operation, idempotency_key: entry.idempotency_key, payload: entry.payload, status: 'PENDING', attempts: 0 };
}

export function pending(db: ControllerDatabase, limit = 50): OutboxEntry[] {
  return db.all('SELECT * FROM outbox WHERE status = ? ORDER BY created_at LIMIT ?', 'PENDING', limit).map(toEntry);
}

export function settle(db: ControllerDatabase, outbox_id: string, status: 'DELIVERED' | 'FAILED'): void {
  db.run('UPDATE outbox SET status = ?, attempts = attempts + 1 WHERE outbox_id = ?', status, outbox_id);
}
