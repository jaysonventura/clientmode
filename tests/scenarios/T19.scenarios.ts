/** AT-019 executor.
 *
 * Synthetic secret canaries are pushed through the log on the paths they really arrive on — a
 * worker error, a tool result, a provider error — and then the whole stored log is searched for
 * the canary values. Retention runs on a fixed clock against items of each class, including one
 * under a legal hold.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ClientRequest, Json, ScenarioObservation, UsageEvent } from '../../contracts/interfaces.js';
import { ControllerDatabase } from '../../packages/state/src/database.js';
import { LifecycleService } from '../../packages/core/src/lifecycle.js';
import { OperationalLog } from '../../packages/observability/src/logging.js';
import { containsSecret, redact } from '../../packages/observability/src/redaction.js';
import {
  applyRetention, exportOrDelete, operatorHealth, rollupUsage, telemetryFrom,
  DEFAULT_TELEMETRY, RETENTION_DAYS, type RetainedItem,
} from '../../packages/observability/src/metrics.js';
import { Evidence, fixedClock } from '../harness/evidence.js';
import { registerScenario } from '../harness/registry.js';

const PROJECT = 'project_t19';
const OTHER_PROJECT = 'project_t19_other';
const NOW = '2026-09-08T21:00:00.000Z';

/** Synthetic canaries. None of these is a real credential. */
const CANARIES = {
  bearer: 'sk-fixture-9f2b7c41d8e35a06b1c4',
  aws: 'AKIAFIXTURE1234567XY',
  password: 'hunter2-fixture-password',
  privateKey: '-----BEGIN PRIVATE KEY-----\nMIIFIXTURENOTAREALKEY\n-----END PRIVATE KEY-----',
  urlCredential: 'https://deployuser:fixture-pass-9931@staging.example/app',
  jsonToken: 'ghp_fixtureTOKEN0123456789abcdef',
};

registerScenario('AT-019', async (): Promise<ScenarioObservation> => {
  const writer = await Evidence.open('T19');
  const clock = fixedClock(NOW);
  const sandbox = mkdtempSync(path.join(tmpdir(), 'cm-t19-'));
  const db = ControllerDatabase.open(path.join(sandbox, 'state'));
  const log: Record<string, unknown> = {};

  try {
    const service = new LifecycleService(db, { clock });
    const operational = new OperationalLog(db);
    for (const project of [PROJECT, OTHER_PROJECT]) {
      service.registerProject({ project_id: project, registered_root_ref: `file://${sandbox}/${project}`, profile_id: 'discover', data_class: 'internal' });
    }

    // 1. Secrets arriving from a worker, a tool and a provider.
    const written = [
      operational.write({
        project_id: PROJECT, run_id: null, level: 'error', source: 'worker',
        message: `deploy failed: curl -H "Authorization: Bearer ${CANARIES.bearer}" https://api.example/deploy`,
        fields: { command: `AWS_ACCESS_KEY_ID=${CANARIES.aws} ./deploy.sh`, cwd: '/work' }, created_at: NOW,
      }),
      operational.write({
        project_id: PROJECT, run_id: null, level: 'warn', source: 'tool',
        message: `read config: DATABASE_PASSWORD=${CANARIES.password}`,
        fields: { file: '.env', contents: CANARIES.privateKey }, created_at: NOW,
      }),
      operational.write({
        project_id: PROJECT, run_id: null, level: 'error', source: 'provider',
        message: `upstream 401 for ${CANARIES.urlCredential}`,
        fields: { response: `{"error":"bad token","token":"${CANARIES.jsonToken}"}` }, created_at: NOW,
      }),
    ];
    const storedText = JSON.stringify(operational.read(PROJECT));
    const leaked = containsSecret(storedText, Object.values(CANARIES));
    log['redaction'] = {
      records: written.map(record => ({ source: record.source, message: record.message, fields: record.fields, redactions: record.redactions })),
      canaries_found_in_stored_log: leaked,
      rules_triggered: [...new Set(written.flatMap(record => record.redactions))],
    };
    const canariesRedacted = leaked.length === 0 &&
      written.every(record => record.redactions.length > 0) &&
      redact(`Bearer ${CANARIES.bearer}`).text.includes('[redacted]');

    // 2. Cross-project reads are impossible by query, and refused when asked for explicitly.
    operational.write({
      project_id: OTHER_PROJECT, run_id: null, level: 'info', source: 'controller',
      message: 'the other client uses supplier code SUPPLIER-PRIVATE-4417',
      fields: {}, created_at: NOW,
    });
    const own = operational.readForActor({ requesting_project_id: PROJECT, requested_project_id: PROJECT });
    const foreign = operational.readForActor({ requesting_project_id: PROJECT, requested_project_id: OTHER_PROJECT });
    const leakedAcross = own.allowed ? containsSecret(JSON.stringify(own.records), ['SUPPLIER-PRIVATE-4417']) : ['unreadable'];
    log['cross_project'] = { own_records: own.allowed ? own.records.length : 0, foreign, other_project_content_in_own_read: leakedAcross };
    const crossProjectDenied = foreign.allowed === false && foreign.reason === 'CROSS_PROJECT_LOG_READ_DENIED' &&
      leakedAcross.length === 0;

    // 3. Retention at 30, 90 and 365 days on a fixed clock, with a legal hold.
    const daysAgo = (days: number): string => new Date(Date.parse(NOW) - days * 86_400_000).toISOString();
    const items: RetainedItem[] = [
      { id: 'log-fresh', retention_class: 'operational_log', created_at: daysAgo(10), hold: null },
      { id: 'log-old', retention_class: 'operational_log', created_at: daysAgo(45), hold: null },
      { id: 'shot-old', retention_class: 'screenshot', created_at: daysAgo(31), hold: null },
      { id: 'audit-fresh', retention_class: 'audit_evidence', created_at: daysAgo(45), hold: null },
      { id: 'audit-old', retention_class: 'audit_evidence', created_at: daysAgo(120), hold: null },
      { id: 'manifest', retention_class: 'release_manifest', created_at: daysAgo(200), hold: null },
      { id: 'manifest-old-held', retention_class: 'release_manifest', created_at: daysAgo(400), hold: { reason: 'open dispute; legal hold', released_at: null } },
    ];
    const decisions = applyRetention(items, NOW);
    const exportBlocked = exportOrDelete(items, { ids: ['manifest-old-held'], operation: 'export' });
    const deleteBlocked = exportOrDelete(items, { ids: ['manifest-old-held', 'log-old'], operation: 'delete' });
    const exportAllowed = exportOrDelete(items, { ids: ['log-fresh'], operation: 'export' });
    log['retention'] = { policy_days: RETENTION_DAYS, decisions, export_blocked: exportBlocked, delete_blocked: deleteBlocked, export_allowed: exportAllowed };
    const byId = new Map(decisions.map(decision => [decision.id, decision]));
    const retentionEnforced =
      byId.get('log-fresh')?.action === 'retain' && byId.get('log-old')?.action === 'delete' &&
      byId.get('shot-old')?.action === 'delete' &&
      byId.get('audit-fresh')?.action === 'retain' && byId.get('audit-old')?.action === 'delete' &&
      byId.get('manifest')?.action === 'retain' &&
      byId.get('manifest-old-held')?.action === 'retain_under_hold' &&
      exportBlocked.exported === false && deleteBlocked.exported === false && exportAllowed.exported === true;

    // 4. Telemetry is off unless someone turned it on.
    const telemetry = {
      absent: telemetryFrom(undefined),
      empty: telemetryFrom({ theme: 'dark' }),
      disabled: telemetryFrom({ telemetry: { enabled: false } }),
      enabled: telemetryFrom({ telemetry: { enabled: true, endpoint: 'https://metrics.example', enabled_by: 'owner_1' } }),
    };
    log['telemetry'] = { default: DEFAULT_TELEMETRY, observed: telemetry };
    const telemetryOff = telemetry.absent.enabled === false && telemetry.empty.enabled === false &&
      telemetry.disabled.enabled === false && telemetry.enabled.enabled === true &&
      telemetry.enabled.enabled_by === 'owner_1' && DEFAULT_TELEMETRY.endpoint === null;

    // 5. Usage with gaps, duplicates and a failed attempt.
    const request: ClientRequest = {
      kind: 'client_request', schema_version: 1, request_id: 'request_t19', project_id: PROJECT,
      message: 'metrics fixture', language_hint: 'en', attachment_ids: [], privacy_class: 'internal', created_at: NOW,
    };
    const run = await service.createRun(request, 'idem-t19');
    for (const [attempt_id, status] of [['attempt_ok', 'RUNNING'], ['attempt_failed', 'FAILED']] as const) {
      service.createAttempt({
        attempt_id, project_id: PROJECT, run_id: run.run_id, task_id: `task_${attempt_id}`,
        attempt_number: 1, role: 'writer', parent_attempt_id: null, depth: 0, workspace_id: `ws_${attempt_id}`,
        base_source_digest: `sha256:${'a'.repeat(64)}`, allowed_write_paths: ['src/'], dependency_task_ids: [],
        deadline: '2026-09-09T00:00:00.000Z', provider_session_id: null,
      });
      db.run('UPDATE task_attempts SET status = ? WHERE attempt_id = ?', status, attempt_id);
    }
    const usage = (attempt_id: string, provider_event_id: string, cost_usd: number | null, coverage: UsageEvent['coverage']): UsageEvent => ({
      kind: 'usage_event', schema_version: 1, usage_event_id: `usage_${provider_event_id}`,
      provider_event_id, run_id: run.run_id, attempt_id, provider: 'mock', billing_mode: 'native_account',
      input_tokens: 1000, output_tokens: 100, cache_read_tokens: null, cache_write_tokens: null,
      reasoning_tokens: null, cost_usd, coverage, occurred_at: NOW,
    });
    const first = await service.recordUsage(usage('attempt_ok', 'event_1', 2, 'complete'));
    const duplicate = await service.recordUsage({ ...usage('attempt_ok', 'event_1', 2, 'complete'), usage_event_id: 'usage_dup' });
    await service.recordUsage(usage('attempt_ok', 'event_2', null, 'partial'));
    await service.recordUsage(usage('attempt_failed', 'event_3', 3, 'complete'));
    const rollup = rollupUsage(db, { run_id: run.run_id, unknown_reserve_microusd: 500_000 });
    log['usage'] = { first, duplicate, rollup };
    const unknownNotZero = rollup.unknown_events === 1 &&
      rollup.reserved_for_unknown_microusd === 500_000 &&
      rollup.total_including_unknown_microusd === rollup.known_cost_microusd + 500_000 &&
      rollup.coverage === 'partial' && first === 'inserted' && duplicate === 'duplicate';
    const failedCostIncluded = rollup.failed_attempt_cost_microusd === 3_000_000 &&
      rollup.total_including_unknown_microusd >= rollup.failed_attempt_cost_microusd &&
      rollup.successful_attempt_cost_microusd > 0;

    // 6. Operator health, read from the same durable state.
    db.run('INSERT INTO workspace_leases (lease_id, project_id, attempt_id, workspace_id, owner_id, is_writer, active, epoch, expires_at) VALUES (?,?,?,?,?,0,1,1,?)',
      'lease_stale', PROJECT, 'attempt_ok', 'ws_attempt_ok', 'worker_1', '2026-09-08T20:00:00.000Z');
    const health = operatorHealth(db, { now: NOW, invalid_attestations: 2 });
    log['health'] = health;

    await writer.write('observability.json', log);
    await writer.write('stored-log.json', operational.read(PROJECT));

    return {
      scenario_id: 'AT-019',
      mode: 'integration',
      observed: {
        secret_canaries_redacted: canariesRedacted,
        cross_project_read_denied: crossProjectDenied,
        retention_policy_enforced: retentionEnforced,
        telemetry_default_off: telemetryOff,
        unknown_usage_not_zero: unknownNotZero,
        failed_attempt_cost_included: failedCostIncluded,
        canaries_tested: Object.keys(CANARIES).length,
        stale_leases_reported: health.stale_leases,
        invalid_attestations_reported: health.invalid_attestations,
      } satisfies Record<string, Json>,
      artifact_paths: writer.paths,
    };
  } finally {
    db.close();
    rmSync(sandbox, { recursive: true, force: true });
  }
});
