/** Running a runbook.
 *
 * A runbook step is a fenced `sh` block tagged `step:<name>`. The runner executes each step in
 * order with the environment it is given and records the real exit code and output, so a
 * runbook that has never been run cannot pass for one that has.
 *
 * A step that cannot run here fails, and the runbook reports BLOCKED. It does not skip ahead.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export type RunbookStep = { name: string; script: string };

export type StepResult = { name: string; exit_code: number | null; stdout: string; stderr: string; ran: boolean };

export type RunbookOutcome = {
  runbook: string;
  steps: StepResult[];
  status: 'EXECUTED' | 'BLOCKED';
  blocked_at: string | null;
};

export function parseRunbook(markdown: string): RunbookStep[] {
  const steps: RunbookStep[] = [];
  const pattern = /```sh step:([a-z0-9-]+)\n([\s\S]*?)```/g;
  let match = pattern.exec(markdown);
  while (match !== null) {
    steps.push({ name: match[1]!, script: match[2]! });
    match = pattern.exec(markdown);
  }
  return steps;
}

export function runRunbook(input: { file: string; env: NodeJS.ProcessEnv; cwd: string }): RunbookOutcome {
  const steps = parseRunbook(readFileSync(input.file, 'utf8'));
  const results: StepResult[] = [];
  let blocked_at: string | null = null;

  for (const step of steps) {
    if (blocked_at !== null) {
      results.push({ name: step.name, exit_code: null, stdout: '', stderr: 'not run: an earlier step failed', ran: false });
      continue;
    }
    const run = spawnSync('/bin/sh', ['-c', step.script], {
      cwd: input.cwd, env: { PATH: '/usr/bin:/bin', ...input.env }, encoding: 'utf8', timeout: 30_000,
    });
    const result: StepResult = {
      name: step.name, exit_code: run.status,
      stdout: (run.stdout ?? '').slice(0, 4000), stderr: (run.stderr ?? '').slice(0, 2000), ran: true,
    };
    results.push(result);
    if (run.status !== 0) blocked_at = step.name;
  }

  return {
    runbook: input.file, steps: results,
    status: blocked_at === null ? 'EXECUTED' : 'BLOCKED',
    blocked_at,
  };
}
