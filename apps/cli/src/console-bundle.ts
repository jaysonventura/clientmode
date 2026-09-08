/** Bundle the quiet console.
 *
 * One implementation, used by `cm open` and by the console gate, so what a gate exercises and
 * what a client opens are the same bundle of the same React application.
 */
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { toolkitRoot } from '../../../packages/contracts/src/toolkit-root.js';
import { writeConsoleIndex } from './console-page.js';

const ROOT = toolkitRoot();

/** The compiled application, without the per-run boot data. Built once at install time so a
 * packaged toolkit does not need esbuild on the client's machine to open a console. */
export async function buildConsoleAssets(outdir: string): Promise<string> {
  mkdirSync(outdir, { recursive: true });
  await build({
    entryPoints: [path.join(ROOT, 'apps/console/src/app/App.tsx')],
    bundle: true, format: 'esm', target: 'es2022', platform: 'browser',
    outfile: path.join(outdir, 'app.js'),
    jsx: 'automatic', loader: { '.css': 'css' }, logLevel: 'silent',
  });
  return outdir;
}

export async function buildConsole(outdir: string, boot: Record<string, unknown>): Promise<string> {
  await buildConsoleAssets(outdir);
  return writeConsoleIndex(outdir, boot);
}
