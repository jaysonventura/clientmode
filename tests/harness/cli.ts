/** Invoke the real `cm` entry point in a child process.
 *
 * A command is only wired if running it produces a contract exit code. Calling the module
 * function directly would not catch a command that never reaches the dispatcher, which is the
 * failure this exists to find.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { ROOT } from './evidence.js';

export function runCli(argv: readonly string[], home: string): Promise<number> {
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['--import', 'tsx', path.join(ROOT, 'apps/cli/src/cm.ts'), ...argv], {
      cwd: ROOT, stdio: ['ignore', 'ignore', 'ignore'],
      env: { ...process.env, NODE_NO_WARNINGS: '1', CM_HOME: home },
    });
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, 120_000);
    child.on('close', code => { clearTimeout(timer); resolve(code ?? 8); });
    child.on('error', () => { clearTimeout(timer); resolve(8); });
  });
}

/** Open the same fresh state directory from several processes at one instant.
 *
 * The barrier is what makes this a race rather than a queue: without it, process startup
 * staggers the opens and the first one has finished migrating before the second begins. */
export function raceOpen(stateDir: string, workers: number): Promise<number[]> {
  const at = Date.now() + 1500;
  return Promise.all(Array.from({ length: workers }, () => new Promise<number>(resolve => {
    const child = spawn(process.execPath,
      ['--import', 'tsx', path.join(ROOT, 'tests/harness/concurrent-open.mts'), stateDir, String(at)],
      { cwd: ROOT, stdio: ['ignore', 'ignore', 'ignore'], env: { ...process.env, NODE_NO_WARNINGS: '1' } });
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, 60_000);
    child.on('close', code => { clearTimeout(timer); resolve(code ?? 1); });
    child.on('error', () => { clearTimeout(timer); resolve(1); });
  })));
}

/** Run the packaged toolkit's own entry point, from a directory that is not the checkout. */
export function runPackaged(entry: string, argv: readonly string[], home: string, cwd: string): Promise<number> {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [entry, ...argv], {
      cwd, stdio: ['ignore', 'ignore', 'ignore'],
      env: { ...process.env, NODE_NO_WARNINGS: '1', CM_HOME: home, CM_CWD: cwd },
    });
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, 120_000);
    child.on('close', code => { clearTimeout(timer); resolve(code ?? 8); });
    child.on('error', () => { clearTimeout(timer); resolve(8); });
  });
}
