/** The ordered task ledger.
 *
 * The point of this table is one question: what should the next session pick up? The answer is
 * the first task that is not finished, in order — not the next unclaimed one, and not the one
 * after the last thing somebody talked about.
 *
 * "Finished" means evidence. A task a worker left half-done, or claimed and abandoned, is not
 * finished, and the next session resumes it rather than moving past it. The schema enforces
 * that: a row cannot be `DONE` without an `evidence_ref`.
 */
import type { ControllerDatabase } from '../../state/src/database.js';

export class TaskLedgerError extends Error {
  constructor(public readonly code: string, subject = '') {
    super(subject === '' ? code : `${code}: ${subject}`);
    this.name = 'TaskLedgerError';
  }
}

export type TaskStatus = 'PENDING' | 'IN_PROGRESS' | 'DONE' | 'BLOCKED';

export type LedgerTask = {
  run_id: string;
  task_id: string;
  sequence: number;
  title: string;
  status: TaskStatus;
  evidence_ref: string | null;
  claimed_by: string | null;
  claimed_at: string | null;
  updated_at: string;
};

const rowToTask = (row: Record<string, unknown>): LedgerTask => ({
  run_id: String(row['run_id']), task_id: String(row['task_id']),
  sequence: Number(row['sequence']), title: String(row['title']),
  status: String(row['status']) as TaskStatus,
  evidence_ref: row['evidence_ref'] === null ? null : String(row['evidence_ref']),
  claimed_by: row['claimed_by'] === null ? null : String(row['claimed_by']),
  claimed_at: row['claimed_at'] === null ? null : String(row['claimed_at']),
  updated_at: String(row['updated_at']),
});

export class TaskLedger {
  readonly #db: ControllerDatabase;
  readonly #now: () => string;

  constructor(db: ControllerDatabase, options: { clock?: () => string } = {}) {
    this.#db = db;
    this.#now = options.clock ?? (() => new Date().toISOString());
  }

  /** Records the plan. Re-planning is additive: a task already in the ledger keeps its status,
   * so a second session cannot reset finished work by describing the plan again. */
  plan(input: { project_id: string; run_id: string; tasks: Array<{ task_id: string; title: string }> }): LedgerTask[] {
    const at = this.#now();
    return this.#db.transaction(() => {
      const existing = new Map(this.list(input.run_id).map(task => [task.task_id, task]));
      input.tasks.forEach((task, index) => {
        if (existing.has(task.task_id)) return;
        this.#db.run(`INSERT INTO run_tasks (project_id, run_id, task_id, sequence, title, status,
          evidence_ref, claimed_by, claimed_at, updated_at) VALUES (?,?,?,?,?,?,NULL,NULL,NULL,?)`,
          input.project_id, input.run_id, task.task_id, existing.size + index + 1, task.title, 'PENDING', at);
      });
      return this.list(input.run_id);
    });
  }

  list(run_id: string): LedgerTask[] {
    return this.#db.all('SELECT * FROM run_tasks WHERE run_id = ? ORDER BY sequence', run_id).map(rowToTask);
  }

  /** The first task that is not finished, in order. This is what a resuming session works on. */
  next(run_id: string): LedgerTask | null {
    return this.list(run_id).find(task => task.status !== 'DONE') ?? null;
  }

  claim(input: { run_id: string; task_id: string; by: string }): LedgerTask {
    const at = this.#now();
    const task = this.#get(input.run_id, input.task_id);
    if (task.status === 'DONE') throw new TaskLedgerError('TASK_ALREADY_FINISHED', input.task_id);
    this.#db.run("UPDATE run_tasks SET status = 'IN_PROGRESS', claimed_by = ?, claimed_at = ?, updated_at = ? WHERE run_id = ? AND task_id = ?",
      input.by, at, at, input.run_id, input.task_id);
    return this.#get(input.run_id, input.task_id);
  }

  /** Finishing needs a reference to something that was observed. A worker's assurance is not
   * one, and the schema refuses the row without it. */
  finish(input: { run_id: string; task_id: string; evidence_ref: string; by: string }): LedgerTask {
    if (input.evidence_ref.trim() === '') throw new TaskLedgerError('DONE_REQUIRES_EVIDENCE', input.task_id);
    const at = this.#now();
    this.#get(input.run_id, input.task_id);
    this.#db.run("UPDATE run_tasks SET status = 'DONE', evidence_ref = ?, claimed_by = ?, updated_at = ? WHERE run_id = ? AND task_id = ?",
      input.evidence_ref, input.by, at, input.run_id, input.task_id);
    return this.#get(input.run_id, input.task_id);
  }

  block(input: { run_id: string; task_id: string; reason: string }): LedgerTask {
    const at = this.#now();
    this.#get(input.run_id, input.task_id);
    this.#db.run("UPDATE run_tasks SET status = 'BLOCKED', claimed_by = NULL, updated_at = ? WHERE run_id = ? AND task_id = ?",
      at, input.run_id, input.task_id);
    void input.reason;
    return this.#get(input.run_id, input.task_id);
  }

  /** A session that stopped without finishing leaves its claim behind. Releasing it makes the
   * task available again without pretending it was never started. */
  releaseAbandoned(input: { run_id: string; claimed_by: string }): LedgerTask[] {
    const at = this.#now();
    const affected = this.list(input.run_id).filter(task => task.status === 'IN_PROGRESS' && task.claimed_by === input.claimed_by);
    for (const task of affected) {
      this.#db.run("UPDATE run_tasks SET status = 'PENDING', updated_at = ? WHERE run_id = ? AND task_id = ?",
        at, input.run_id, task.task_id);
    }
    return this.list(input.run_id).filter(task => affected.some(entry => entry.task_id === task.task_id));
  }

  progress(run_id: string): { total: number; done: number; next: LedgerTask | null; unfinished: LedgerTask[] } {
    const tasks = this.list(run_id);
    return {
      total: tasks.length,
      done: tasks.filter(task => task.status === 'DONE').length,
      next: tasks.find(task => task.status !== 'DONE') ?? null,
      unfinished: tasks.filter(task => task.status !== 'DONE'),
    };
  }

  #get(run_id: string, task_id: string): LedgerTask {
    const row = this.#db.get('SELECT * FROM run_tasks WHERE run_id = ? AND task_id = ?', run_id, task_id);
    if (row === undefined) throw new TaskLedgerError('UNKNOWN_TASK', task_id);
    return rowToTask(row);
  }
}
