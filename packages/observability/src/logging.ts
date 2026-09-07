/** Structured logs, redacted on write and scoped by project on read.
 *
 * A log line belongs to one project. There is no query that returns another project's lines,
 * so a cross-project read is not a filter someone can forget: it is a value that never appears
 * in the result set.
 */
import { randomUUID } from 'node:crypto';
import type { ControllerDatabase } from '../../state/src/database.js';
import { redactValue, redact } from './redaction.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogRecord = {
  log_id: string;
  project_id: string;
  run_id: string | null;
  level: LogLevel;
  source: 'worker' | 'tool' | 'provider' | 'controller' | 'verifier';
  message: string;
  fields: Record<string, unknown>;
  created_at: string;
  redactions: string[];
};

const MIGRATION = `CREATE TABLE IF NOT EXISTS operational_logs (
 log_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, run_id TEXT,
 level TEXT NOT NULL, source TEXT NOT NULL, message TEXT NOT NULL,
 fields_json TEXT NOT NULL, redactions_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS operational_logs_by_project ON operational_logs(project_id, created_at);`;

export class OperationalLog {
  readonly #db: ControllerDatabase;

  constructor(db: ControllerDatabase) {
    this.#db = db;
    for (const statement of MIGRATION.split(';').map(part => part.trim()).filter(part => part !== '')) {
      this.#db.run(statement);
    }
  }

  /** Redaction happens here, before the row exists. There is no unredacted copy. */
  write(input: Omit<LogRecord, 'log_id' | 'redactions'>): LogRecord {
    const message = redact(input.message);
    const fields = redactValue(input.fields) as Record<string, unknown>;
    const fieldRedactions = redact(JSON.stringify(input.fields)).matched;
    const record: LogRecord = {
      log_id: `log_${randomUUID()}`, project_id: input.project_id, run_id: input.run_id,
      level: input.level, source: input.source, message: message.text, fields,
      created_at: input.created_at, redactions: [...new Set([...message.matched, ...fieldRedactions])],
    };
    this.#db.run('INSERT INTO operational_logs (log_id, project_id, run_id, level, source, message, fields_json, redactions_json, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      record.log_id, record.project_id, record.run_id, record.level, record.source,
      record.message, JSON.stringify(record.fields), JSON.stringify(record.redactions), record.created_at);
    return record;
  }

  /** The project is the query, not a filter applied afterwards. */
  read(project_id: string): LogRecord[] {
    return this.#db.all('SELECT * FROM operational_logs WHERE project_id = ? ORDER BY created_at', project_id)
      .map(row => ({
        log_id: String(row['log_id']), project_id: String(row['project_id']),
        run_id: row['run_id'] === null ? null : String(row['run_id']),
        level: String(row['level']) as LogLevel, source: String(row['source']) as LogRecord['source'],
        message: String(row['message']), fields: JSON.parse(String(row['fields_json'])) as Record<string, unknown>,
        created_at: String(row['created_at']), redactions: JSON.parse(String(row['redactions_json'])) as string[],
      }));
  }

  readForActor(input: { requesting_project_id: string; requested_project_id: string }):
    { allowed: true; records: LogRecord[] } | { allowed: false; reason: 'CROSS_PROJECT_LOG_READ_DENIED' } {
    if (input.requesting_project_id !== input.requested_project_id) return { allowed: false, reason: 'CROSS_PROJECT_LOG_READ_DENIED' };
    return { allowed: true, records: this.read(input.requesting_project_id) };
  }
}
