#!/usr/bin/env node
/** The `cm` launcher.
 *
 * It re-executes node from the toolkit directory so `--import tsx` resolves against the
 * toolkit's own dependencies rather than whatever directory the user happens to be in. The
 * directory they *were* in travels in CM_CWD, because that is the project they mean.
 * A packaged build replaces this with the compiled entry point; the surface does not change.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(import.meta.url), '../..');
const result = spawnSync(
  process.execPath,
  ['--import', 'tsx', path.join(root, 'apps/cli/src/cm.ts'), ...process.argv.slice(2)],
  { stdio: 'inherit', cwd: root, env: { ...process.env, NODE_NO_WARNINGS: '1', CM_CWD: process.cwd() } },
);
process.exitCode = result.status ?? 8;
