/** Operator metrics and retention.
 *
 * Two numbers here are easy to get wrong in the flattering direction:
 *
 *   - **Unknown cost.** A provider that reports tokens and no price, or nothing at all, must
 *     not contribute zero. Zero spends real capacity while the ledger says nothing happened.
 *     Unknown usage is counted separately and reserved at its configured upper bound.
 *   - **Failed attempts.** The cost of work that did not succeed is part of what the work
 *     cost. Excluding it makes every project look cheaper than it was.
 *
 * Retention deletes by age, and a legal or organisational lock stops the deletion rather than
 * hiding the record.
 */
import type { ControllerDatabase } from '../../state/src/database.js';

export type UsageRollup = {
  events: number;
  complete_events: number;
  unknown_events: number;
  known_cost_microusd: number;
  reserved_for_unknown_microusd: number;
  total_including_unknown_microusd: number;
  failed_attempt_cost_microusd: number;
  successful_attempt_cost_microusd: number;
  /** Never a number. If coverage is incomplete the caller must say so. */
  coverage: 'complete' | 'partial';
};

/** Roll up usage for a run, counting the failures and refusing to zero the unknowns. */
export function rollupUsage(db: ControllerDatabase, input: { run_id: string; unknown_reserve_microusd: number }): UsageRollup {
  const rows = db.all(`SELECT u.cost_microusd AS cost, u.usage_complete AS complete, a.status AS attempt_status
                       FROM usage_events u JOIN task_attempts a ON a.attempt_id = u.attempt_id
                       WHERE u.run_id = ?`, input.run_id);
  let known = 0;
  let unknown = 0;
  let failed = 0;
  let succeeded = 0;
  for (const row of rows) {
    const complete = Number(row['complete']) === 1 && row['cost'] !== null;
    const cost = complete ? Number(row['cost']) : input.unknown_reserve_microusd;
    if (complete) known += Number(row['cost']);
    else unknown += 1;
    // A revoked or failed attempt still spent what it spent.
    if (['REVOKED', 'FAILED'].includes(String(row['attempt_status']))) failed += cost;
    else succeeded += cost;
  }
  const reserved = unknown * input.unknown_reserve_microusd;
  return {
    events: rows.length, complete_events: rows.length - unknown, unknown_events: unknown,
    known_cost_microusd: known, reserved_for_unknown_microusd: reserved,
    total_including_unknown_microusd: known + reserved,
    failed_attempt_cost_microusd: failed, successful_attempt_cost_microusd: succeeded,
    coverage: unknown === 0 ? 'complete' : 'partial',
  };
}

export type OperatorHealth = {
  queue_depth: number;
  oldest_queued_age_seconds: number | null;
  stale_leases: number;
  running_attempts: number;
  revoked_attempts: number;
  outbox_pending: number;
  runs_blocked: number;
  /** Counted, because an attestation that failed to verify is an incident, not noise. */
  invalid_attestations: number;
};

export function operatorHealth(db: ControllerDatabase, input: { now: string; invalid_attestations?: number }): OperatorHealth {
  const count = (sql: string, ...params: Array<string | number>): number =>
    Number(db.get(sql, ...params)?.['n'] ?? 0);
  const oldest = db.get("SELECT MIN(deadline) AS oldest FROM task_attempts WHERE status = 'QUEUED'");
  const oldestAt = oldest?.['oldest'] === null || oldest?.['oldest'] === undefined ? null : String(oldest['oldest']);
  return {
    queue_depth: count("SELECT COUNT(*) AS n FROM task_attempts WHERE status = 'QUEUED'"),
    oldest_queued_age_seconds: oldestAt === null ? null : Math.round((Date.parse(input.now) - Date.parse(oldestAt)) / 1000),
    stale_leases: count('SELECT COUNT(*) AS n FROM workspace_leases WHERE active = 1 AND expires_at <= ?', input.now),
    running_attempts: count("SELECT COUNT(*) AS n FROM task_attempts WHERE status = 'RUNNING'"),
    revoked_attempts: count("SELECT COUNT(*) AS n FROM task_attempts WHERE status = 'REVOKED'"),
    outbox_pending: count("SELECT COUNT(*) AS n FROM outbox WHERE status = 'PENDING'"),
    runs_blocked: count("SELECT COUNT(*) AS n FROM runs WHERE state = 'BLOCKED'"),
    invalid_attestations: input.invalid_attestations ?? 0,
  };
}

/** Telemetry is off unless someone turned it on. There is no default that phones home. */
export type TelemetrySettings = { enabled: boolean; endpoint: string | null; enabled_by: string | null };

export const DEFAULT_TELEMETRY: TelemetrySettings = { enabled: false, endpoint: null, enabled_by: null };

export function telemetryFrom(settings: Record<string, unknown> | undefined): TelemetrySettings {
  if (settings === undefined) return DEFAULT_TELEMETRY;
  const enabled = settings['telemetry'] === true || (settings['telemetry'] as Record<string, unknown> | undefined)?.['enabled'] === true;
  if (!enabled) return DEFAULT_TELEMETRY;
  const block = (settings['telemetry'] as Record<string, unknown> | undefined) ?? {};
  return { enabled: true, endpoint: typeof block['endpoint'] === 'string' ? block['endpoint'] : null, enabled_by: typeof block['enabled_by'] === 'string' ? block['enabled_by'] : 'unknown' };
}

export type RetentionClass = 'operational_log' | 'screenshot' | 'audit_evidence' | 'release_manifest';

/** The defaults from the handoff. An organisation may configure different periods. */
export const RETENTION_DAYS: Record<RetentionClass, number> = {
  operational_log: 30,
  screenshot: 30,
  audit_evidence: 90,
  release_manifest: 365,
};

export type RetainedItem = {
  id: string;
  retention_class: RetentionClass;
  created_at: string;
  /** A legal or organisational hold. It stops deletion and is reported, never bypassed. */
  hold: { reason: string; released_at: string | null } | null;
};

export type RetentionDecision = {
  id: string;
  retention_class: RetentionClass;
  age_days: number;
  action: 'retain' | 'delete' | 'retain_under_hold';
  reason: string;
};

export function applyRetention(items: RetainedItem[], now: string): RetentionDecision[] {
  return items.map(item => {
    const age_days = Math.floor((Date.parse(now) - Date.parse(item.created_at)) / 86_400_000);
    const limit = RETENTION_DAYS[item.retention_class];
    if (item.hold !== null && item.hold.released_at === null) {
      return { id: item.id, retention_class: item.retention_class, age_days, action: 'retain_under_hold', reason: item.hold.reason };
    }
    return age_days > limit
      ? { id: item.id, retention_class: item.retention_class, age_days, action: 'delete', reason: `older than the ${limit}-day retention period` }
      : { id: item.id, retention_class: item.retention_class, age_days, action: 'retain', reason: `within the ${limit}-day retention period` };
  });
}

export type ExportOutcome =
  | { exported: true; ids: string[] }
  | { exported: false; blocked: Array<{ id: string; reason: string }> };

/** Export and deletion respect holds, and explain them rather than failing silently. */
export function exportOrDelete(items: RetainedItem[], input: { ids: string[]; operation: 'export' | 'delete' }): ExportOutcome {
  const blocked = items
    .filter(item => input.ids.includes(item.id) && item.hold !== null && item.hold.released_at === null)
    .map(item => ({ id: item.id, reason: `${input.operation} blocked by a retention hold: ${item.hold!.reason}` }));
  return blocked.length > 0 ? { exported: false, blocked } : { exported: true, ids: input.ids };
}
