/** Live provider helpers.
 *
 * A live gate is either executed against the installed host or reported BLOCKED. It is never
 * quietly satisfied by the recorded fixtures — those prove normalisation, not integration.
 *
 * Live turns here are deliberately tiny. They run on the machine's existing authorized native
 * account; nothing configures metered API billing, and no gate treats a missing account as a
 * pass.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export type LiveAvailability =
  | { available: true; executable: string; version: string }
  | { available: false; reason: string };

export type LiveTurn = { exit_code: number | null; signal: string | null; stdout: string; stderr: string; lines: string[] };

/** stdin is closed, not merely unused. A host that reads stdin for extra instructions will
 * otherwise wait for input that never arrives and be killed by the deadline instead of
 * answering — which looks exactly like an unavailable account. */
export function liveTurn(input: {
  executable: string; argv: string[]; cwd: string; timeout_ms?: number;
}): Promise<LiveTurn> {
  return new Promise(resolve => {
    const child = spawn(input.executable, input.argv, {
      cwd: input.cwd, stdio: ['ignore', 'pipe', 'pipe'], shell: false,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += String(chunk); });
    child.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-16_000); });
    const timer = setTimeout(() => {
      try { if (child.pid !== undefined) process.kill(child.pid, 'SIGKILL'); } catch { /* already gone */ }
    }, input.timeout_ms ?? 300_000);
    child.on('error', error => {
      clearTimeout(timer);
      resolve({ exit_code: null, signal: null, stdout, stderr: String((error as Error).message), lines: [] });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({
        exit_code: code, signal: signal === null ? null : String(signal),
        stdout, stderr, lines: stdout.split('\n').filter(line => line.trim() !== ''),
      });
    });
  });
}

export async function liveHostAvailable(executable: string): Promise<LiveAvailability> {
  const outcome = await liveTurn({ executable, argv: ['--version'], cwd: process.cwd(), timeout_ms: 30_000 });
  if (outcome.exit_code !== 0) return { available: false, reason: `exit ${String(outcome.exit_code)}: ${outcome.stderr.slice(0, 160)}` };
  const version = /(\d+\.\d+\.\d+)/.exec(outcome.stdout.split('\n')[0] ?? '')?.[1];
  return version === undefined
    ? { available: false, reason: `version output not recognised: ${outcome.stdout.slice(0, 80)}` }
    : { available: true, executable, version };
}

/** A throwaway project outside the toolkit repository, so the session under test loads the
 * generated instructions and not this repository's. */
export function disposableProject(instructions: { file: string; body: string }): string {
  const root = mkdtempSync(path.join(tmpdir(), 'cm-live-project-'));
  mkdirSync(path.dirname(path.join(root, instructions.file)), { recursive: true });
  writeFileSync(path.join(root, instructions.file), instructions.body);
  return root;
}
