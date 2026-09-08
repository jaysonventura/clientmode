/** Continuity across hosts.
 *
 * Each host resumes only its own sessions: Claude Code cannot pick up a Codex thread and Codex
 * cannot pick up a Claude one. What survives both is the controller's own record — the run and
 * its state, the requirements revision, the candidate, the open question, the events. This
 * module turns that record into a briefing the next session can act on, whichever host it is.
 *
 * The briefing states what is known and what is not. Work that was in flight when a session
 * ended is reported as in flight, not as progress: a session that stopped mid-task did not
 * finish it, and saying otherwise is how the next session repeats or skips work.
 */
import { randomUUID } from 'node:crypto';
import type { ControllerDatabase } from '../../state/src/database.js';
import { TaskLedger, type LedgerTask } from './tasks.js';

export type HostSession = {
  session_id: string;
  project_id: string;
  host: string;
  working_directory: string;
  started_at: string;
  ended_at: string | null;
  exit_code: number | null;
  handoff_note: string | null;
};

export function startSession(db: ControllerDatabase, input: {
  project_id: string; host: string; working_directory: string; at: string;
}): HostSession {
  const session: HostSession = {
    session_id: `hs_${randomUUID()}`, project_id: input.project_id, host: input.host,
    working_directory: input.working_directory, started_at: input.at,
    ended_at: null, exit_code: null, handoff_note: null,
  };
  db.run(`INSERT INTO host_sessions (session_id, project_id, host, working_directory, started_at, ended_at, exit_code, handoff_note)
    VALUES (?,?,?,?,?,NULL,NULL,NULL)`,
    session.session_id, session.project_id, session.host, session.working_directory, session.started_at);
  return session;
}

export function endSession(db: ControllerDatabase, input: {
  session_id: string; at: string; exit_code: number | null; note?: string;
}): void {
  db.run('UPDATE host_sessions SET ended_at = ?, exit_code = ?, handoff_note = ? WHERE session_id = ?',
    input.at, input.exit_code, input.note ?? null, input.session_id);
}

export function sessions(db: ControllerDatabase, project_id: string): HostSession[] {
  return db.all('SELECT * FROM host_sessions WHERE project_id = ? ORDER BY started_at', project_id)
    .map(row => ({
      session_id: String(row['session_id']), project_id: String(row['project_id']),
      host: String(row['host']), working_directory: String(row['working_directory']),
      started_at: String(row['started_at']),
      ended_at: row['ended_at'] === null ? null : String(row['ended_at']),
      exit_code: row['exit_code'] === null ? null : Number(row['exit_code']),
      handoff_note: row['handoff_note'] === null ? null : String(row['handoff_note']),
    }));
}

export type RunSummary = {
  run_id: string;
  state: string;
  state_version: number;
  requirements_revision: number;
  candidate_id: string | null;
  contract_id: string | null;
  open_question: string | null;
  updated_at: string;
  /** Attempts that were running when their session stopped. In flight is not progress. */
  interrupted_attempts: Array<{ attempt_id: string; task_id: string; role: string; status: string }>;
  recent_events: Array<{ kind: string; at: string }>;
  /** The ordered plan, and the one task the next session should pick up. */
  tasks: LedgerTask[];
  next_task: LedgerTask | null;
  done_count: number;
};

export type Handoff = {
  project_id: string;
  working_directory: string;
  generated_at: string;
  previous: { host: string; ended_at: string | null; exit_code: number | null } | null;
  runs: RunSummary[];
  /** True when there is nothing to continue. A fresh folder is not a failure. */
  nothing_in_progress: boolean;
};

const OPEN_STATES = ['RECEIVED', 'SCOPED', 'RUNNING', 'VERIFYING', 'BLOCKED', 'PAUSED',
  'READY_FOR_REVIEW', 'AWAITING_RELEASE_APPROVAL', 'DEPLOYING'];

export function buildHandoff(db: ControllerDatabase, input: {
  project_id: string; working_directory: string; at: string; event_limit?: number;
}): Handoff {
  const ledger = new TaskLedger(db);
  const previousRow = db.get(
    'SELECT host, ended_at, exit_code FROM host_sessions WHERE project_id = ? ORDER BY started_at DESC LIMIT 1',
    input.project_id);
  const runs = db.all(
    `SELECT run_id, state, state_version, requirements_revision, candidate_id, contract_id, updated_at
     FROM runs WHERE project_id = ? ORDER BY updated_at DESC`, input.project_id)
    .filter(row => OPEN_STATES.includes(String(row['state'])))
    .map(row => {
      const run_id = String(row['run_id']);
      const question = db.get(
        "SELECT prompt FROM client_questions WHERE run_id = ? AND status = 'OPEN' ORDER BY created_at LIMIT 1", run_id);
      return {
        run_id, state: String(row['state']), state_version: Number(row['state_version']),
        requirements_revision: Number(row['requirements_revision']),
        candidate_id: row['candidate_id'] === null ? null : String(row['candidate_id']),
        contract_id: row['contract_id'] === null ? null : String(row['contract_id']),
        open_question: question === undefined ? null : String(question['prompt']),
        updated_at: String(row['updated_at']),
        interrupted_attempts: db.all(
          "SELECT attempt_id, task_id, role, status FROM task_attempts WHERE run_id = ? AND status IN ('RUNNING','LEASED','QUEUED')", run_id)
          .map(attempt => ({
            attempt_id: String(attempt['attempt_id']), task_id: String(attempt['task_id']),
            role: String(attempt['role']), status: String(attempt['status']),
          })),
        recent_events: db.all('SELECT kind, created_at FROM events WHERE run_id = ? ORDER BY sequence DESC LIMIT ?',
          run_id, input.event_limit ?? 8)
          .map(event => ({ kind: String(event['kind']), at: String(event['created_at']) })).reverse(),
        tasks: ledger.list(run_id),
        next_task: ledger.next(run_id),
        done_count: ledger.list(run_id).filter(task => task.status === 'DONE').length,
      };
    });
  return {
    project_id: input.project_id, working_directory: input.working_directory, generated_at: input.at,
    previous: previousRow === undefined ? null : {
      host: String(previousRow['host']),
      ended_at: previousRow['ended_at'] === null ? null : String(previousRow['ended_at']),
      exit_code: previousRow['exit_code'] === null ? null : Number(previousRow['exit_code']),
    },
    runs, nothing_in_progress: runs.length === 0,
  };
}

/** The briefing, as the next session will read it.
 *
 * It never says work was completed. It says what state the controller recorded and what the
 * next session has to establish for itself. */
export function renderHandoff(handoff: Handoff): string {
  if (handoff.nothing_in_progress) {
    const previous = handoff.previous;
    return [
      '# Client Mode — nothing in progress',
      '',
      `Project ${handoff.project_id} at ${handoff.working_directory}.`,
      previous === null
        ? 'No earlier session is recorded for this folder.'
        : `The last session here was ${previous.host}${previous.ended_at === null ? ', and it is still open or ended without recording an exit' : `, which ended ${previous.ended_at}`}.`,
      '',
      'There is no unfinished run to continue. Start from what the client asks for.',
      '',
    ].join('\n');
  }

  const lines: string[] = [
    '# Client Mode — continue this project',
    '',
    `Project ${handoff.project_id} at ${handoff.working_directory}.`,
  ];
  const previous = handoff.previous;
  if (previous !== null) {
    lines.push(
      previous.ended_at === null
        ? `The previous session (${previous.host}) did not record an ending. Treat everything below as unfinished.`
        : `The previous session was ${previous.host}, ended ${previous.ended_at}` +
          `${previous.exit_code === null ? '' : ` with exit ${String(previous.exit_code)}`}.`);
  }
  lines.push('',
    'This is what the controller recorded. It is not a report that anything was finished — a',
    'session that stopped mid-task did not complete it. Verify before you build on any of it.',
    '');

  for (const run of handoff.runs) {
    lines.push(`## Run ${run.run_id}`, '',
      `- state: **${run.state}** (version ${String(run.state_version)}, requirements revision ${String(run.requirements_revision)})`,
      `- contract: ${run.contract_id ?? 'not yet bound'}`,
      `- candidate: ${run.candidate_id ?? 'none sealed'}`,
      `- last recorded change: ${run.updated_at}`);
    if (run.open_question !== null && run.open_question !== '') {
      lines.push('', `**There is an open question waiting for the client:** ${run.open_question}`,
        'Do not answer it yourself and do not proceed past it on an assumption.');
    }
    if (run.interrupted_attempts.length > 0) {
      lines.push('', 'Attempts that were still in flight when the last session stopped:');
      for (const attempt of run.interrupted_attempts) {
        lines.push(`- ${attempt.attempt_id} (${attempt.role} on ${attempt.task_id}) — ${attempt.status}`);
      }
      lines.push('', 'Their work is unverified. Re-check it rather than assuming it landed.');
    }
    if (run.tasks.length > 0) {
      lines.push('', `### Plan — ${String(run.done_count)} of ${String(run.tasks.length)} finished`, '');
      for (const task of run.tasks) {
        const mark = task.status === 'DONE' ? 'x' : ' ';
        const detail = task.status === 'DONE'
          ? `evidence: ${task.evidence_ref ?? ''}`
          : task.status === 'IN_PROGRESS'
            ? `started by ${task.claimed_by ?? 'an earlier session'} and **not finished**`
            : task.status.toLowerCase();
        lines.push(`- [${mark}] ${String(task.sequence)}. ${task.title} — ${detail}`);
      }
      const next = run.next_task;
      if (next === null) {
        lines.push('', 'Every task in the plan is finished with evidence. Nothing here to resume.');
      } else {
        lines.push('',
          `**Pick up task ${String(next.sequence)}: ${next.title}.**`,
          next.status === 'IN_PROGRESS'
            ? `It was started${next.claimed_by === null ? '' : ` by ${next.claimed_by}`} and never finished. Resume it — do not start the one after it, and do not begin something else.`
            : 'It is the first task in the plan that has no evidence against it. Everything before it is finished; everything after it waits.');
        lines.push('',
          'A task counts as finished only when there is a reference to something that was actually',
          'observed. If you cannot produce that, the task is not finished, whatever was said about it.');
      }
    }
    if (run.recent_events.length > 0) {
      lines.push('', `Recent events: ${run.recent_events.map(event => event.kind).join(' → ')}`);
    }
    lines.push('');
  }

  lines.push('## What to do next', '',
    '1. Work the task named above. Not the one after it, and not a new one.',
    '2. Establish its state yourself — run the checks before trusting anything recorded here.',
    '3. If a question above is open, it is the client\'s to answer. Nothing downstream of it is settled.',
    '4. Continue the run; do not start a second one for the same request.',
    '5. `cm status <run>` gives the same state as structured output.',
    '');
  return lines.join('\n');
}
