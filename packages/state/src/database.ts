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
export const SCHEMA_VERSION = 3;

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
