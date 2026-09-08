/** Build the portable toolkit, the way `cm install` ships it.
 *
 * The test that matters is whether it still works with the source tree out of the picture, so
 * this produces a directory that carries everything the CLI reads at runtime and nothing that
 * points back at the checkout.
 */
import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './evidence.js';

export type PackagedToolkit = { root: string; entry: string; bytes: number };

export async function packageToolkit(outdir: string): Promise<PackagedToolkit> {
  mkdirSync(outdir, { recursive: true });
  const entry = path.join(outdir, 'cm.js');
  await build({
    entryPoints: [path.join(ROOT, 'apps/cli/src/cm.ts')],
    bundle: true, platform: 'node', format: 'esm', target: 'node22',
    outfile: entry, logLevel: 'silent',
    // The console bundler stays outside the bundle so its `esbuild` import stays dynamic: a
    // packaged install without esbuild runs every other command and reports the console as a
    // capability gap, rather than failing to start at all.
    external: ['esbuild', 'playwright', './console-bundle.js'],
    banner: { js: "import { createRequire as __cmRequire } from 'node:module';\nconst require = __cmRequire(import.meta.url);" },
  });
  // The files the toolkit reads at runtime travel with it.
  for (const directory of ['contracts', 'adapters', 'skills']) {
    cpSync(path.join(ROOT, directory), path.join(outdir, directory), { recursive: true });
  }
  writeFileSync(path.join(outdir, 'package.json'), JSON.stringify({ name: 'client-mode-toolkit', type: 'module', private: true }, null, 2) + '\n');
  return { root: outdir, entry, bytes: readFileSync(entry).byteLength };
}
