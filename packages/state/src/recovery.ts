/** Restart reconciliation. Controller-owned state decides what may resume; a worker's
 * last message or a terminal transcript is not run state.
 */
import { appendEvent } from './events.js';
import { expire, type Lease } from './leases.js';
import type { ControllerDatabase } from './database.js';

export type ReconciliationReport = {
  expired_leases: string[];
  revoked_attempts: string[];
  runs_awaiting_reconciliation: string[];
  observed_at: string;
};

const IN_FLIGHT = ['RUNNING', 'VERIFYING', 'DEPLOYING'] as const;

/** Expire leases whose deadline passed, revoke the attempts that held them, and list the
 * runs whose external effects still need observing before work resumes. */
export function reconcile(db: ControllerDatabase, now: string): ReconciliationReport {
  return db.transaction(() => {
    const expired: Lease[] = expire(db, now);
    const revoked: string[] = [];
    for (const lease of expired) {
      const attempt = db.get('SELECT * FROM task_attempts WHERE attempt_id = ?', lease.attempt_id);
      if (!attempt || ['REVOKED', 'FAILED'].includes(String(attempt['status']))) continue;
      db.run("UPDATE task_attempts SET status = 'REVOKED' WHERE attempt_id = ?", lease.attempt_id);
      revoked.push(lease.attempt_id);
      appendEvent(db, {
        run_id: String(attempt['run_id']), project_id: String(attempt['project_id']),
        kind: 'attempt_fenced', actor_id: 'controller',
        payload: { attempt_id: lease.attempt_id, reason: 'LEASE_EXPIRED', epoch: lease.epoch }, at: now,
      });
    }
    const placeholders = IN_FLIGHT.map(() => '?').join(',');
    const runs = db.all(`SELECT run_id FROM runs WHERE state IN (${placeholders})`, ...IN_FLIGHT)
      .map(row => String(row['run_id']));
    return { expired_leases: expired.map(lease => lease.lease_id), revoked_attempts: revoked, runs_awaiting_reconciliation: runs, observed_at: now };
  });
}
