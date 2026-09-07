/** Live provider helpers.
 *
 * A live gate is either executed against the installed host or reported BLOCKED. It is never
 * quietly satisfied by the recorded fixtures — those prove normalisation, not integration.
 *
 * Live turns here are deliberately tiny. They run on the machine's existing authorized native
 * account; nothing configures metered API billing, and no gate treats a missing account as a
 * pass.
 */
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export type LiveAvailability =
  | { available: true; executable: string; version: string }
  | { available: false; reason: string };

export async function liveHostAvailable(executable: string): Promise<LiveAvailability> {
  try {
    const { stdout } = await run(executable, ['--version'], { timeout: 20_000 });
    const version = /(\d+\.\d+\.\d+)/.exec(stdout.split('\n')[0] ?? '')?.[1];
    return version === undefined
      ? { available: false, reason: `version output not recognised: ${stdout.slice(0, 80)}` }
      : { available: true, executable, version };
  } catch (error) {
    return { available: false, reason: String((error as Error).message).slice(0, 200) };
  }
}

/** A throwaway project outside the toolkit repository, so the session under test loads the
 * generated instructions and not this repository's. */
export function disposableProject(instructions: { file: string; body: string }): string {
  const root = mkdtempSync(path.join(tmpdir(), 'cm-live-project-'));
  mkdirSync(path.dirname(path.join(root, instructions.file)), { recursive: true });
  writeFileSync(path.join(root, instructions.file), instructions.body);
  return root;
}

export type LiveTurn = { exit_code: number | null; stdout: string; stderr: string; lines: string[] };

export async function liveTurn(input: {
  executable: string; argv: string[]; cwd: string; timeout_ms?: number;
}): Promise<LiveTurn> {
  try {
    const { stdout, stderr } = await run(input.executable, input.argv, {
      cwd: input.cwd, timeout: input.timeout_ms ?? 240_000, maxBuffer: 32 * 1024 * 1024,
    });
    return { exit_code: 0, stdout, stderr, lines: stdout.split('\n').filter(line => line.trim() !== '') };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    const stdout = failure.stdout ?? '';
    return {
      exit_code: typeof failure.code === 'number' ? failure.code : null,
      stdout, stderr: failure.stderr ?? String((error as Error).message),
      lines: stdout.split('\n').filter(line => line.trim() !== ''),
    };
  }
}
