/** Start and stop the real fixture services a probe runs against. Each service prints its
 * bound URL on stdout so nothing has to guess a port.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { ROOT } from './evidence.js';

export type RunningService = { url: string; stop: () => Promise<void>; pid: number | undefined };

async function start(command: string, args: string[], env: NodeJS.ProcessEnv, label: string): Promise<RunningService> {
  const child: ChildProcess = spawn(command, args, {
    cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const url = await new Promise<string>((resolve, reject) => {
    let buffered = '';
    const timer = setTimeout(() => reject(new Error(`${label}_DID_NOT_START`)), 20_000);
    child.stdout?.on('data', chunk => {
      buffered += String(chunk);
      const line = buffered.split('\n').find(entry => entry.trim().startsWith('{'));
      if (line === undefined) return;
      try {
        const parsed = JSON.parse(line) as { url?: string };
        if (typeof parsed.url === 'string') { clearTimeout(timer); resolve(parsed.url); }
      } catch { /* keep buffering */ }
    });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', code => { clearTimeout(timer); reject(new Error(`${label}_EXITED_${code}`)); });
  });
  return {
    url, pid: child.pid,
    stop: async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      await new Promise<void>(resolve => { child.once('exit', () => resolve()); child.kill('SIGKILL'); });
    },
  };
}

export function startShop(options: { defect?: string; databaseFile?: string } = {}): Promise<RunningService> {
  return start(process.execPath, [path.join(ROOT, 'fixtures/shop/server.mjs')], {
    PORT: '0',
    ...(options.defect === undefined ? {} : { SHOP_DEFECT: options.defect }),
    ...(options.databaseFile === undefined ? {} : { SHOP_DB: options.databaseFile }),
  }, 'SHOP');
}

export function startPricingService(python: string): Promise<RunningService> {
  return start(python, [path.join(ROOT, 'fixtures/services/pricing_service.py')], {}, 'PRICING_SERVICE');
}
