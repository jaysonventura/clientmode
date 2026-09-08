/** The page that loads the compiled console.
 *
 * Separate from the bundler on purpose: the boot data is per-run and has to be written every
 * time a console is opened, while the application is compiled once at install time. Keeping
 * this file free of `esbuild` is what lets a packaged toolkit open a console without a browser
 * toolchain on the client's machine.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export function writeConsoleIndex(outdir: string, boot: Record<string, unknown>): string {
  mkdirSync(outdir, { recursive: true });
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
