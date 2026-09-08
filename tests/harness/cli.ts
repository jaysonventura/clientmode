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
  return runCliDetailed(argv, home).then(result => result.exit_code);
}

/** The exit code alone cannot tell an unwired command from a real capability gap: both are
 * `missing_capability`, and both are the honest answer for what they describe. The dispatcher's
 * own sentence is what distinguishes them. */
export const UNWIRED_MARKER = 'has no terminal entry point';

export function runCliDetailed(argv: readonly string[], home: string): Promise<{ exit_code: number; stderr: string }> {
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['--import', 'tsx', path.join(ROOT, 'apps/cli/src/cm.ts'), ...argv], {
      cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, NODE_NO_WARNINGS: '1', CM_HOME: home },
    });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-4000); });
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, 120_000);
    child.on('close', code => { clearTimeout(timer); resolve({ exit_code: code ?? 8, stderr }); });
    child.on('error', () => { clearTimeout(timer); resolve({ exit_code: 8, stderr }); });
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

/** Run the launcher `cm install` wrote, from a directory that is not the checkout. */
export function runLauncher(launcher: string, argv: readonly string[], home: string, cwd: string): Promise<number> {
  return new Promise(resolve => {
    const child = spawn(launcher, [...argv], {
      cwd, stdio: ['ignore', 'ignore', 'ignore'],
      env: { ...process.env, NODE_NO_WARNINGS: '1', CM_HOME: home, CM_CWD: cwd },
    });
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, 120_000);
    child.on('close', code => { clearTimeout(timer); resolve(code ?? 8); });
    child.on('error', () => { clearTimeout(timer); resolve(8); });
  });
}

/** Open a run through the packaged launcher and fetch the console it serves.
 *
 * The interesting failure is not an exit code: `cm open` stays running, so a console that
 * cannot be built shows up as a process that printed a capability gap instead of a URL. This
 * waits for the URL, asks the server for the page and the compiled application, and stops it. */
export function openConsoleThroughLauncher(launcher: string, argv: readonly string[], home: string, cwd: string):
Promise<{ url: string | null; page_status: number | null; boot_present: boolean; app_status: number | null; app_bytes: number; output: string }> {
  return new Promise(resolve => {
    const child = spawn(launcher, [...argv], {
      cwd, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_NO_WARNINGS: '1', CM_HOME: home, CM_CWD: cwd },
    });
    let output = '';
    const collect = (chunk: Buffer): void => { output += chunk.toString(); };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);

    let settled = false;
    const finish = async (): Promise<void> => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      clearTimeout(deadline);
      const url = /http:\/\/[0-9.]+:\d+/.exec(output)?.[0] ?? null;
      let page_status: number | null = null; let boot_present = false;
      let app_status: number | null = null; let app_bytes = 0;
      if (url !== null) {
        try {
          const page = await fetch(url);
          page_status = page.status;
          boot_present = (await page.text()).includes('id="boot"');
          const app = await fetch(new URL('/app.js', url));
          app_status = app.status;
          app_bytes = (await app.text()).length;
        } catch { /* recorded as what was actually reached */ }
      }
      try { child.kill('SIGTERM'); } catch { /* already gone */ }
      resolve({ url, page_status, boot_present, app_status, app_bytes, output });
    };
    const poll = setInterval(() => { if (/http:\/\/[0-9.]+:\d+/.test(output)) void finish(); }, 200);
    const deadline = setTimeout(() => { void finish(); }, 60_000);
    child.on('close', () => { void finish(); });
    child.on('error', () => { void finish(); });
  });
}
