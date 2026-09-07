/** Running a provider host as a controlled child process.
 *
 * Shared by both adapters. It owns three things the adapters must not each reinvent:
 * refusing permission-escape flags, keeping the child in its own process group so cancel can
 * reach the whole tree, and turning stdout into lines without assuming the host flushes on
 * any particular boundary.
 */
import { spawn, type ChildProcess } from 'node:child_process';

/** Flags that would hand a worker more authority than the controller granted. The adapter
 * refuses to build a command line containing one, wherever the request came from. */
export const FORBIDDEN_FLAGS = [
  '--allow-dangerously-skip-permissions',
  '--dangerously-skip-permissions',
  '--dangerously-bypass-approvals-and-sandbox',
  '--dangerously-bypass-hook-trust',
  '--yolo',
] as const;

export class PermissionEscapeError extends Error {
  constructor(public readonly flag: string) {
    super(`PERMISSION_ESCAPE_REFUSED: ${flag}`);
    this.name = 'PermissionEscapeError';
  }
}

export function assertNoPermissionEscape(argv: readonly string[]): void {
  for (const argument of argv) {
    const flag = FORBIDDEN_FLAGS.find(forbidden => argument === forbidden || argument.startsWith(`${forbidden}=`));
    if (flag !== undefined) throw new PermissionEscapeError(flag);
  }
}

export type HostSession = {
  child: ChildProcess;
  lines: AsyncIterable<string>;
  stderr: () => string;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
};

/** The host's own credentials live in its documented store. The child gets the ambient
 * environment it needs to find them; it never receives controller or release secrets, which
 * are not in this process's environment to begin with. */
export function startHostProcess(input: {
  executable: string; argv: string[]; cwd: string; env?: NodeJS.ProcessEnv; signal?: AbortSignal;
}): HostSession {
  assertNoPermissionEscape([input.executable, ...input.argv]);
  const child = spawn(input.executable, input.argv, {
    cwd: input.cwd,
    env: { ...process.env, ...input.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true, // own process group, so cancel reaches subprocesses the host started
    shell: false,
  });

  let stderr = '';
  child.stderr?.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-8000); });

  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => {
    child.on('close', (code, signal) => resolve({ code, signal }));
    child.on('error', () => resolve({ code: null, signal: null }));
  });

  if (input.signal !== undefined) {
    input.signal.addEventListener('abort', () => cancelHostProcess(child), { once: true });
  }

  async function* lines(): AsyncIterable<string> {
    let buffer = '';
    if (child.stdout === null) return;
    for await (const chunk of child.stdout) {
      buffer += String(chunk);
      let index = buffer.indexOf('\n');
      while (index >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (line.trim() !== '') yield line;
        index = buffer.indexOf('\n');
      }
    }
    if (buffer.trim() !== '') yield buffer;
  }

  return { child, lines: lines(), stderr: () => stderr, exited };
}

/** Cancellation kills the group. Whether the host's external effects stopped is a separate
 * question, which is why the adapters report `requires_reconciliation`. */
export function cancelHostProcess(child: ChildProcess): boolean {
  if (child.pid === undefined || child.exitCode !== null) return false;
  try {
    process.kill(-child.pid, 'SIGTERM');
    return true;
  } catch {
    try {
      child.kill('SIGTERM');
      return true;
    } catch {
      return false;
    }
  }
}
