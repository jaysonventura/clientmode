/** Bundle the quiet console.
 *
 * One implementation, used by `cm open` and by the console gate, so what a gate exercises and
 * what a client opens are the same bundle of the same React application.
 */
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../../../..');

export async function buildConsole(outdir: string, boot: Record<string, unknown>): Promise<string> {
  mkdirSync(outdir, { recursive: true });
  await build({
    entryPoints: [path.join(ROOT, 'apps/console/src/app/App.tsx')],
    bundle: true, format: 'esm', target: 'es2022', platform: 'browser',
    outfile: path.join(outdir, 'app.js'),
    jsx: 'automatic', loader: { '.css': 'css' }, logLevel: 'silent',
  });
  writeFileSync(path.join(outdir, 'index.html'), `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Client Mode</title>
<link rel="stylesheet" href="/app.css">
</head>
<body>
<div id="root"></div>
<script type="application/json" id="boot">${JSON.stringify(boot).replace(/</g, '\\u003c')}</script>
<script type="module" src="/app.js"></script>
</body>
</html>
`);
  return outdir;
}
