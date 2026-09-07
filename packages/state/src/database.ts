/** Controller-owned SQLite state. Single writer per state directory.
 * A directory lock is an operational guard against two controllers, not a security boundary.
 * ponytail: node:sqlite is experimental on Node 22 LTS; the wrapper is the only place that
 * would need to change for a native driver, and openDatabase pins the pragmas either way.
 */
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

const SCHEMA_SQL = path.resolve(fileURLToPath(import.meta.url), '../../../../contracts/storage/controller.sql');
export const SCHEMA_VERSION = 4;

/** Product migrations layered on the reference DDL. The reference file stays unmodified;
 * controlled migrations are how the product extends it (handoff section 18). */
const MIGRATIONS: Array<{ version: number; sql: string }> = [
  {
    version: 2,
    sql: `CREATE TABLE run_control_intents (
 intent_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, run_id TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('pause','resume','cancel','block')),
 actor_id TEXT NOT NULL, state_version INTEGER NOT NULL CHECK(state_version >= 0),
 reason TEXT NOT NULL, leases_revoked INTEGER NOT NULL CHECK(leases_revoked IN (0,1)),
 created_at TEXT NOT NULL,
 FOREIGN KEY(project_id, run_id) REFERENCES runs(project_id, run_id)
);
CREATE INDEX run_control_intents_by_run ON run_control_intents(run_id, created_at);`,
  },
  {
    version: 3,
    sql: `CREATE TABLE budget_policies (
 project_id TEXT PRIMARY KEY REFERENCES projects(project_id),
 cap_microusd INTEGER NOT NULL CHECK(cap_microusd >= 0),
 verification_reserve_microusd INTEGER NOT NULL CHECK(verification_reserve_microusd >= 0),
 unknown_usage_reserve_microusd INTEGER NOT NULL CHECK(unknown_usage_reserve_microusd >= 0),
 billing_mode TEXT NOT NULL CHECK(billing_mode IN ('native_account','approved_api')),
 set_by TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE capability_grants (
 project_id TEXT NOT NULL REFERENCES projects(project_id),
 capability TEXT NOT NULL, enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
 approval_id TEXT NOT NULL, granted_by TEXT NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(project_id, capability)
);
CREATE TABLE repair_cycles (
 cycle_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, run_id TEXT NOT NULL,
 task_id TEXT NOT NULL, attempt_id TEXT NOT NULL, cycle_number INTEGER NOT NULL CHECK(cycle_number >= 1),
 diagnosis_digest TEXT NOT NULL, new_evidence_ref TEXT, outcome TEXT NOT NULL,
 created_at TEXT NOT NULL,
 FOREIGN KEY(project_id, run_id) REFERENCES runs(project_id, run_id)
);
CREATE TABLE responsibility_assignments (
 assignment_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, run_id TEXT NOT NULL,
 task_id TEXT NOT NULL, attempt_id TEXT, responsibility TEXT NOT NULL,
 risk_tier TEXT NOT NULL, review_required INTEGER NOT NULL CHECK(review_required IN (0,1)),
 created_at TEXT NOT NULL,
 FOREIGN KEY(project_id, run_id) REFERENCES runs(project_id, run_id),
 UNIQUE(run_id, task_id, responsibility)
);`,
  },
  {
    version: 4,
    sql: `CREATE TABLE attachments (
 attachment_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(project_id),
 media_type TEXT NOT NULL, byte_length INTEGER NOT NULL CHECK(byte_length >= 0),
 content_digest TEXT NOT NULL, privacy_class TEXT NOT NULL, storage_ref TEXT NOT NULL,
 idempotency_key TEXT NOT NULL, access_revoked_at TEXT, created_at TEXT NOT NULL,
 UNIQUE(project_id, idempotency_key), UNIQUE(project_id, attachment_id)
);
-- v1.3 additive reference schema. Load after controller.sql.
-- Schema constraints are not authority enforcement, OCR, rendering, or a production migration.
CREATE TABLE document_versions (
 version_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(project_id),
 document_id TEXT NOT NULL, attachment_id TEXT NOT NULL, content_digest TEXT NOT NULL,
 format TEXT NOT NULL, ingestion_status TEXT NOT NULL CHECK(ingestion_status IN('QUARANTINED','INGESTED','BLOCKED','UNSUPPORTED')),
 safety_status TEXT NOT NULL CHECK(safety_status IN('PASSED','FAILED','UNVERIFIED')),
 record_json TEXT NOT NULL, created_at TEXT NOT NULL,
 CHECK(ingestion_status!='INGESTED' OR safety_status='PASSED'),
 UNIQUE(project_id,version_id), UNIQUE(project_id,document_id,content_digest)
);
CREATE TRIGGER document_source_identity_immutable BEFORE UPDATE OF project_id,document_id,attachment_id,content_digest ON document_versions
 BEGIN SELECT RAISE(ABORT,'Source identity immutable; register a new version'); END;
CREATE TABLE document_jobs (
 job_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, request_id TEXT NOT NULL,
 operation TEXT NOT NULL CHECK(operation IN('read','analyze','review','edit','create','extract_requirements')),
 state TEXT NOT NULL CHECK(state IN('RECEIVED','PROCESSING','NEEDS_CLARIFICATION','VERIFYING','READY','PARTIAL','BLOCKED','PAUSED','CANCELLED','FAILED','STALE')),
 state_version INTEGER NOT NULL CHECK(state_version>=0), instruction_revision INTEGER NOT NULL CHECK(instruction_revision>=1),
 software_run_id TEXT, result_id TEXT, record_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 CHECK(state!='READY' OR result_id IS NOT NULL),
 FOREIGN KEY(project_id,request_id) REFERENCES client_requests(project_id,request_id),
 FOREIGN KEY(project_id,software_run_id) REFERENCES runs(project_id,run_id),
 FOREIGN KEY(project_id,job_id,result_id) REFERENCES document_results(project_id,job_id,result_id),
 UNIQUE(project_id,job_id)
);
CREATE TABLE document_job_sources (
 project_id TEXT NOT NULL, job_id TEXT NOT NULL, version_id TEXT NOT NULL,
 PRIMARY KEY(job_id,version_id),
 FOREIGN KEY(project_id,job_id) REFERENCES document_jobs(project_id,job_id),
 FOREIGN KEY(project_id,version_id) REFERENCES document_versions(project_id,version_id)
);
CREATE TABLE document_scopes (
 scope_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, job_id TEXT NOT NULL,
 scope_digest TEXT NOT NULL, inventory_digest TEXT NOT NULL, record_json TEXT NOT NULL,
 created_at TEXT NOT NULL,
 FOREIGN KEY(project_id,job_id) REFERENCES document_jobs(project_id,job_id),
 UNIQUE(project_id,job_id,scope_id)
);
CREATE TABLE document_results (
 result_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, job_id TEXT NOT NULL,
 instruction_revision INTEGER NOT NULL CHECK(instruction_revision>=1), source_scope_digest TEXT NOT NULL,
 qa_evidence_ref TEXT NOT NULL, record_json TEXT NOT NULL, created_at TEXT NOT NULL,
 FOREIGN KEY(project_id,job_id) REFERENCES document_jobs(project_id,job_id),
 UNIQUE(project_id,job_id,result_id)
);
CREATE TABLE document_questions (
 question_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, job_id TEXT NOT NULL,
 instruction_revision INTEGER NOT NULL CHECK(instruction_revision>=1),
 status TEXT NOT NULL CHECK(status IN('OPEN','ANSWERED','SUPERSEDED','CANCELLED')),
 record_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 FOREIGN KEY(project_id,job_id) REFERENCES document_jobs(project_id,job_id),
 UNIQUE(project_id,job_id,question_id)
);
CREATE UNIQUE INDEX one_document_question ON document_questions(job_id) WHERE status='OPEN';
CREATE TABLE document_answers (
 answer_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, job_id TEXT NOT NULL,
 question_id TEXT NOT NULL UNIQUE, request_id TEXT NOT NULL, actor_id TEXT NOT NULL, created_at TEXT NOT NULL,
 FOREIGN KEY(project_id,job_id,question_id) REFERENCES document_questions(project_id,job_id,question_id),
 FOREIGN KEY(project_id,request_id) REFERENCES client_requests(project_id,request_id)
);
CREATE TABLE document_dependencies (
 project_id TEXT NOT NULL, version_id TEXT NOT NULL, target_type TEXT NOT NULL CHECK(target_type IN('contract','context','document_result')),
 target_id TEXT NOT NULL, target_revision INTEGER NOT NULL CHECK(target_revision>=1), invalidated_at TEXT,
 PRIMARY KEY(project_id,version_id,target_type,target_id,target_revision),
 FOREIGN KEY(project_id,version_id) REFERENCES document_versions(project_id,version_id)
);
CREATE TABLE service_cases (
 case_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, request_id TEXT NOT NULL,
 severity TEXT NOT NULL CHECK(severity IN('critical','high','normal','low')),
 status TEXT NOT NULL CHECK(status IN('OPEN','TRIAGED','INVESTIGATING','RESOLVED','CLOSED')),
 record_json TEXT NOT NULL, created_at TEXT NOT NULL,
 FOREIGN KEY(project_id,request_id) REFERENCES client_requests(project_id,request_id)
);
-- All document/control/analysis attempts need one shared budget authority: production must
-- migrate usage/reservations to generic work ownership or add equivalent document tables.
-- The additive draft below records document attempts/costs without faking a software run.
CREATE TABLE document_attempts (
 attempt_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, job_id TEXT NOT NULL, lease_epoch INTEGER NOT NULL CHECK(lease_epoch>=1),
 status TEXT NOT NULL, record_json TEXT NOT NULL, created_at TEXT NOT NULL,
 FOREIGN KEY(project_id,job_id) REFERENCES document_jobs(project_id,job_id),
 UNIQUE(project_id,job_id,attempt_id)
);
CREATE TABLE document_usage (
 usage_id TEXT PRIMARY KEY, provider TEXT NOT NULL, provider_event_id TEXT NOT NULL,
 project_id TEXT NOT NULL, job_id TEXT NOT NULL, attempt_id TEXT NOT NULL,
 measured_cost_microusd INTEGER CHECK(measured_cost_microusd>=0), usage_complete INTEGER NOT NULL CHECK(usage_complete IN(0,1)),
 record_json TEXT NOT NULL, created_at TEXT NOT NULL,
 FOREIGN KEY(project_id,job_id,attempt_id) REFERENCES document_attempts(project_id,job_id,attempt_id),
 UNIQUE(provider,provider_event_id)
);
CREATE TABLE document_budget_reservations (
 reservation_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, job_id TEXT NOT NULL, attempt_id TEXT NOT NULL,
 reserved_microusd INTEGER CHECK(reserved_microusd>=0), reserved_tokens INTEGER CHECK(reserved_tokens>=0),
 status TEXT NOT NULL CHECK(status IN('RESERVED','SETTLED','RELEASED','UNKNOWN')),
 record_json TEXT NOT NULL, created_at TEXT NOT NULL,
 FOREIGN KEY(project_id,job_id,attempt_id) REFERENCES document_attempts(project_id,job_id,attempt_id)
);
CREATE TABLE document_events (
 job_id TEXT NOT NULL REFERENCES document_jobs(job_id), sequence INTEGER NOT NULL CHECK(sequence>=1),
 event_id TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(job_id,sequence)
);
CREATE TABLE document_outbox (
 outbox_id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES document_jobs(job_id),
 operation TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE, payload_json TEXT NOT NULL,
 status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0), created_at TEXT NOT NULL
);
`,
  },
];

export type Row = Record<string, unknown>;
export type Clock = () => string;

export class ControllerDatabaseError extends Error {
  constructor(public readonly code: string, message?: string) {
    super(message ?? code);
    this.name = 'ControllerDatabaseError';
  }
}

/** Refuse a second controller on the same state directory; take over only a dead owner's lock. */
function acquireDirectoryLock(stateDir: string): () => void {
  const lockPath = path.join(stateDir, 'controller.lock');
  const claim = (): number => openSync(lockPath, 'wx');
  let handle: number;
  try {
    handle = claim();
  } catch {
    const owner = Number.parseInt(readFileSync(lockPath, 'utf8').trim(), 10);
    if (Number.isInteger(owner) && owner > 0 && isAlive(owner)) {
      throw new ControllerDatabaseError('CONTROLLER_ALREADY_RUNNING', `state directory is held by pid ${owner}`);
    }
    rmSync(lockPath, { force: true });
    handle = claim();
  }
  writeSync(handle, String(process.pid));
  closeSync(handle);
  return () => rmSync(lockPath, { force: true });
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export class ControllerDatabase {
  readonly #db: DatabaseSync;
  readonly #release: () => void;
  readonly #cache = new Map<string, StatementSync>();
  #depth = 0;
  #closed = false;

  private constructor(db: DatabaseSync, release: () => void) {
    this.#db = db;
    this.#release = release;
  }

  static open(stateDir: string, options: { busyTimeoutMs?: number } = {}): ControllerDatabase {
    mkdirSync(stateDir, { recursive: true });
    const release = acquireDirectoryLock(stateDir);
    try {
      const db = new DatabaseSync(path.join(stateDir, 'state.sqlite'));
      db.exec(`PRAGMA journal_mode = WAL;
               PRAGMA foreign_keys = ON;
               PRAGMA busy_timeout = ${Math.max(0, options.busyTimeoutMs ?? 5000)};
               PRAGMA synchronous = FULL;`);
      const bootstrapped = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get('schema_migrations') as Row | undefined;
      if (bootstrapped === undefined) {
        db.exec(readFileSync(SCHEMA_SQL, 'utf8'));
        db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
          .run(1, new Date().toISOString());
      }
      const at = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as Row;
      for (const migration of MIGRATIONS) {
        if (migration.version <= Number(at['version'] ?? 0)) continue;
        db.exec('BEGIN IMMEDIATE');
        try {
          db.exec(migration.sql);
          db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
            .run(migration.version, new Date().toISOString());
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      }
      return new ControllerDatabase(db, release);
    } catch (error) {
      release();
      throw error;
    }
  }

  #prepare(sql: string): StatementSync {
    let statement = this.#cache.get(sql);
    if (!statement) {
      statement = this.#db.prepare(sql);
      this.#cache.set(sql, statement);
    }
    return statement;
  }

  run(sql: string, ...params: Array<string | number | null>): { changes: number } {
    const result = this.#prepare(sql).run(...params);
    return { changes: Number(result.changes) };
  }

  get(sql: string, ...params: Array<string | number | null>): Row | undefined {
    return this.#prepare(sql).get(...params) as Row | undefined;
  }

  all(sql: string, ...params: Array<string | number | null>): Row[] {
    return this.#prepare(sql).all(...params) as Row[];
  }

  /** BEGIN IMMEDIATE so two controllers conflict on write intent, not at COMMIT. */
  transaction<T>(work: () => T): T {
    if (this.#depth > 0) return work();
    this.#db.exec('BEGIN IMMEDIATE');
    this.#depth += 1;
    try {
      const result = work();
      this.#db.exec('COMMIT');
      return result;
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    } finally {
      this.#depth -= 1;
    }
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#cache.clear();
    this.#db.close();
    this.#release();
  }
}
