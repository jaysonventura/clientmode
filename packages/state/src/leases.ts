/** Workspace leases with an epoch fencing token.
 * The epoch, not the expiry timestamp, decides whether a returning worker may still write:
 * a clock comparison cannot tell a slow worker from a reassigned one.
 */
import { randomUUID } from 'node:crypto';
import { ControllerDatabaseError, type ControllerDatabase } from './database.js';

export type Lease = {
  lease_id: string; project_id: string; attempt_id: string; workspace_id: string;
  owner_id: string; is_writer: boolean; active: boolean; epoch: number; expires_at: string;
};

function toLease(row: Record<string, unknown>): Lease {
  return {
    lease_id: String(row['lease_id']), project_id: String(row['project_id']),
    attempt_id: String(row['attempt_id']), workspace_id: String(row['workspace_id']),
    owner_id: String(row['owner_id']), is_writer: Number(row['is_writer']) === 1,
    active: Number(row['active']) === 1, epoch: Number(row['epoch']), expires_at: String(row['expires_at']),
  };
}

/** A new lease for an attempt always increases the epoch, so results from an earlier
 * holder are recognisable as stale even if that holder is still running. */
export function acquire(db: ControllerDatabase, request: {
  project_id: string; attempt_id: string; workspace_id: string;
  owner_id: string; is_writer: boolean; expires_at: string;
}): Lease {
  const previous = db.get('SELECT COALESCE(MAX(epoch), 0) AS epoch FROM workspace_leases WHERE attempt_id = ?', request.attempt_id);
  const epoch = Number(previous?.['epoch'] ?? 0) + 1;
  const lease_id = `lse_${randomUUID()}`;
  try {
    db.run('INSERT INTO workspace_leases (lease_id, project_id, attempt_id, workspace_id, owner_id, is_writer, active, epoch, expires_at) VALUES (?,?,?,?,?,?,1,?,?)',
      lease_id, request.project_id, request.attempt_id, request.workspace_id, request.owner_id,
      request.is_writer ? 1 : 0, epoch, request.expires_at);
  } catch (error) {
    // The partial unique index is the single enforcement point for one writer per project.
    // SQLite names the columns rather than the index, so match the table and constraint class.
    const message = String((error as Error).message);
    if (message.includes('UNIQUE constraint failed') && message.includes('workspace_leases')) {
      throw new ControllerDatabaseError('WRITER_LEASE_CONFLICT', `project ${request.project_id} already has an active writer`);
    }
    throw error;
  }
  db.run('UPDATE task_attempts SET lease_epoch = ? WHERE attempt_id = ?', epoch, request.attempt_id);
  return { lease_id, ...request, active: true, epoch };
}

export function active(db: ControllerDatabase, attempt_id: string): Lease | undefined {
  const row = db.get('SELECT * FROM workspace_leases WHERE attempt_id = ? AND active = 1 ORDER BY epoch DESC LIMIT 1', attempt_id);
  return row ? toLease(row) : undefined;
}

/** Deactivate leases whose deadline has passed. Returns what was actually expired. */
export function expire(db: ControllerDatabase, now: string): Lease[] {
  const stale = db.all('SELECT * FROM workspace_leases WHERE active = 1 AND expires_at <= ?', now).map(toLease);
  for (const lease of stale) db.run('UPDATE workspace_leases SET active = 0 WHERE lease_id = ?', lease.lease_id);
  return stale;
}

export function revokeForAttempts(db: ControllerDatabase, attempt_ids: string[]): Lease[] {
  const revoked: Lease[] = [];
  for (const attempt_id of attempt_ids) {
    for (const lease of db.all('SELECT * FROM workspace_leases WHERE attempt_id = ? AND active = 1', attempt_id).map(toLease)) {
      db.run('UPDATE workspace_leases SET active = 0 WHERE lease_id = ?', lease.lease_id);
      revoked.push(lease);
    }
  }
  return revoked;
}

export type FenceRejection =
  | 'UNKNOWN_ATTEMPT' | 'ATTEMPT_REVOKED' | 'STALE_LEASE_EPOCH' | 'LEASE_NOT_ACTIVE'
  | 'STALE_REQUIREMENTS_REVISION' | 'BASE_SOURCE_CHANGED';

/** Every worker result passes this gate before it can be integrated. */
export function checkFence(db: ControllerDatabase, result: {
  attempt_id: string; lease_epoch: number; requirements_revision?: number; base_source_digest?: string;
}): { accepted: boolean; reason?: FenceRejection } {
  const attempt = db.get('SELECT * FROM task_attempts WHERE attempt_id = ?', result.attempt_id);
  if (!attempt) return { accepted: false, reason: 'UNKNOWN_ATTEMPT' };
  if (String(attempt['status']) === 'REVOKED') return { accepted: false, reason: 'ATTEMPT_REVOKED' };
  if (Number(attempt['lease_epoch']) !== result.lease_epoch) return { accepted: false, reason: 'STALE_LEASE_EPOCH' };
  if (!active(db, result.attempt_id)) return { accepted: false, reason: 'LEASE_NOT_ACTIVE' };
  if (result.base_source_digest !== undefined && result.base_source_digest !== String(attempt['base_source_digest'])) {
    return { accepted: false, reason: 'BASE_SOURCE_CHANGED' };
  }
  if (result.requirements_revision !== undefined) {
    const run = db.get('SELECT requirements_revision FROM runs WHERE run_id = ?', String(attempt['run_id']));
    if (run && Number(run['requirements_revision']) !== result.requirements_revision) {
      return { accepted: false, reason: 'STALE_REQUIREMENTS_REVISION' };
    }
  }
  return { accepted: true };
}
