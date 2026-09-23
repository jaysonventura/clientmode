#!/usr/bin/env node
// Client Mode's Codex Stop hook: when a turn ends with changes in the working tree, run the
// project's own checks and hand any failure back to the agent instead of letting the turn end.
//
// Which checks, in the automation-first order: the commands listed in `.cm/checks` (one per line,
// `#` for comments) — the project saying what proves a change — otherwise the package scripts
// typecheck, lint and test, otherwise `make test`. A tree that already passed is not re-run.
// After three blocked repair cycles in one session it stops blocking and reports a BLOCKER on
// stderr, so it can never trap a session. Input and output follow learn.chatgpt.com/docs/hooks.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_BLOCKS = 3;
const TIMEOUT_MS = 10 * 60 * 1000;
const STATE_DIR = process.env.CM_CODEX_GATE_STATE ?? path.join(path.dirname(fileURLToPath(import.meta.url)), 'state');

const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 });

/** A digest of everything that differs from HEAD, or null when nothing does. */
function fingerprint(cwd) {
  const status = git(cwd, ['status', '--porcelain']);
  if (status.status !== 0 || status.stdout.length === 0) return null;
  const hash = createHash('sha256').update(git(cwd, ['diff', 'HEAD', '--binary']).stdout);
  const untracked = git(cwd, ['ls-files', '--others', '--exclude-standard', '-z']).stdout.toString('utf8').split('\0').filter(Boolean).sort();
  for (const file of untracked) {
    hash.update(file);
    try { hash.update(readFileSync(path.join(cwd, file))); } catch { /* removed meanwhile */ }
  }
  return hash.digest('hex');
}

function checks(cwd) {
  const explicit = path.join(cwd, '.cm', 'checks');
  if (existsSync(explicit)) {
    return readFileSync(explicit, 'utf8').split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  }
  const manifest = path.join(cwd, 'package.json');
  if (existsSync(manifest)) {
    let scripts = {};
    try { scripts = JSON.parse(readFileSync(manifest, 'utf8')).scripts ?? {}; } catch { /* unreadable manifest: no scripts */ }
    const runner = existsSync(path.join(cwd, 'pnpm-lock.yaml')) ? 'pnpm run' : existsSync(path.join(cwd, 'yarn.lock')) ? 'yarn run' : 'npm run';
    const found = ['typecheck', 'lint', 'test'].filter(name => typeof scripts[name] === 'string').map(name => `${runner} ${name}`);
    if (found.length > 0) return found;
  }
  const makefile = path.join(cwd, 'Makefile');
  if (existsSync(makefile) && /^test:/m.test(readFileSync(makefile, 'utf8'))) return ['make test'];
  return [];
}

function run(cwd, command) {
  const result = spawnSync(command, { cwd, shell: true, encoding: 'utf8', timeout: TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trimEnd().split('\n').slice(-40).join('\n');
  const exit = result.error?.code === 'ETIMEDOUT' ? 'timed out' : `exit ${String(result.status)}`;
  return { ok: result.status === 0, exit, output };
}

function main() {
  let input = {};
  try { input = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { return; }
  const cwd = input.cwd || process.cwd();
  const print = fingerprint(cwd);
  if (print === null) return;

  mkdirSync(STATE_DIR, { recursive: true });
  const stateFile = path.join(STATE_DIR, `${String(input.session_id || 'default').replace(/[^\w.-]/g, '_')}.json`);
  let state = { green: null, blocks: 0 };
  try { state = { ...state, ...JSON.parse(readFileSync(stateFile, 'utf8')) }; } catch { /* first stop */ }
  if (state.green === print) return;

  const commands = checks(cwd);
  if (commands.length === 0) {
    process.stderr.write('Client Mode: no project checks found (.cm/checks, package scripts or make test); nothing was verified.\n');
    return;
  }
  for (const command of commands) {
    const result = run(cwd, command);
    if (result.ok) continue;
    state.blocks += 1;
    writeFileSync(stateFile, JSON.stringify({ green: null, blocks: state.blocks }));
    if (state.blocks > MAX_BLOCKS) {
      process.stderr.write(`Client Mode: BLOCKER — \`${command}\` still fails (${result.exit}) after ${String(MAX_BLOCKS)} repair cycles. Report it as a BLOCKER with the output; do not claim it works.\n`);
      return;
    }
    process.stdout.write(JSON.stringify({
      decision: 'block',
      reason: `Client Mode: \`${command}\` failed (${result.exit}), repair cycle ${String(state.blocks)}/${String(MAX_BLOCKS)}. ` +
        'Find the cause and fix it; do not loosen the check. If this is the second failed fix for the same failure, stop editing and report the reproduction, evidence, suspected cause, attempts and unknowns.\n\n' +
        result.output,
    }));
    return;
  }
  writeFileSync(stateFile, JSON.stringify({ green: print, blocks: 0 }));
}

main();
