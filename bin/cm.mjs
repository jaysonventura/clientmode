#!/usr/bin/env node
/** The `cm` launcher.
 *
 * It re-executes node with tsx so the TypeScript entry point runs in place. A packaged build
 * replaces this file with the compiled entry point; the command surface does not change. */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(import.meta.url), '../..');
const result = spawnSync(
  process.execPath,
  ['--import', 'tsx', path.join(root, 'apps/cli/src/cm.ts'), ...process.argv.slice(2)],
  { stdio: 'inherit', cwd: process.cwd(), env: { ...process.env, NODE_NO_WARNINGS: '1' } },
);
process.exitCode = result.status ?? 8;
