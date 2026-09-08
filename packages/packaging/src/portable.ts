/** The portable toolkit: what an install actually puts on a machine.
 *
 * A checkout is a developer's arrangement. What ships is one bundled entry point plus the files
 * the controller reads at runtime, in a directory that does not depend on where the source
 * happened to live. `esbuild` is loaded here rather than imported, because it is a build-time
 * dependency of the installer and must not become a load-time dependency of the CLI.
 */
import { chmodSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { toolkitRoot } from '../../contracts/src/toolkit-root.js';

export type PortableToolkit = {
  root: string;
  entry: string;
  launcher: string | null;
  bytes: number;
  carried: string[];
};

/** Files the controller opens at runtime. Without these the bundle is not an install. */
export const CARRIED_DIRECTORIES = ['contracts', 'adapters', 'skills'] as const;

export async function buildPortableToolkit(input: {
  out_root: string; source_root?: string; launcher_path?: string | null;
}): Promise<PortableToolkit> {
  const source = input.source_root ?? toolkitRoot();
  const root = input.out_root;
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });

  const { build } = await import('esbuild');
  const entry = path.join(root, 'cm.js');
  await build({
    entryPoints: [path.join(source, 'apps/cli/src/cm.ts')],
    bundle: true, platform: 'node', format: 'esm', target: 'node22',
    outfile: entry, logLevel: 'silent',
    // The console bundler and the browser driver stay outside: both are optional capabilities,
    // and an install without them still has to run every other command.
    external: ['esbuild', 'playwright', './console-bundle.js'],
    banner: { js: "import { createRequire as __cmRequire } from 'node:module';\nconst require = __cmRequire(import.meta.url);" },
  });
  // The console is compiled here, where esbuild is available, and shipped compiled. Building
  // it on the client's machine would have made a browser toolchain a runtime dependency of
  // opening a run — which is exactly what `cm open` failed on outside a checkout.
  const { buildConsoleAssets } = await import(path.join(source, 'apps/cli/src/console-bundle.ts'));
  await (buildConsoleAssets as (out: string) => Promise<string>)(path.join(root, 'console'));

  for (const directory of CARRIED_DIRECTORIES) {
    cpSync(path.join(source, directory), path.join(root, directory), { recursive: true });
  }
  writeFileSync(path.join(root, 'package.json'),
    JSON.stringify({ name: 'client-mode-toolkit', type: 'module', private: true }, null, 2) + '\n');

  let launcher: string | null = null;
  if (input.launcher_path !== null && input.launcher_path !== undefined) {
    mkdirSync(path.dirname(input.launcher_path), { recursive: true });
    // The launcher names the toolkit it belongs to, so the CLI never has to guess and never
    // depends on where the source was when it was installed.
    writeFileSync(input.launcher_path, `#!/bin/sh
# Client Mode. Installed by \`cm install\`; remove it with \`cm uninstall\`.
CM_TOOLKIT_ROOT="\${CM_TOOLKIT_ROOT:-${root}}"
export CM_TOOLKIT_ROOT
exec "${process.execPath}" "$CM_TOOLKIT_ROOT/cm.js" "$@"
`);
    // A `mode` on writeFileSync only applies when the file is created, so an existing launcher
    // would keep whatever it had. chmod always applies.
    chmodSync(input.launcher_path, 0o755);
    launcher = input.launcher_path;
  }

  return {
    root, entry, launcher,
    bytes: readFileSync(entry).byteLength,
    carried: [...CARRIED_DIRECTORIES],
  };
}
