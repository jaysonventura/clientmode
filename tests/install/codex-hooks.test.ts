/** Codex runs the project's own checks when a turn ends, through a Stop hook that `cm install`
 * owns the way it owns the rules block: one entry, added beside the person's hooks, removed exactly.
 * The gate blocks with the real failure output, skips work it has already seen pass, and stops
 * blocking after three repair cycles so it can never trap a session.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { installCodexStopHook, removeCodexStopHook } from '../../packages/packaging/src/codex-hooks.js';
import { ROOT } from '../harness/evidence.js';

const GATE = path.join(ROOT, 'adapters/codex/stop-gate.mjs');
const temp = (prefix: string): string => mkdtempSync(path.join(tmpdir(), prefix));
const json = (file: string): any => JSON.parse(readFileSync(file, 'utf8'));
const stopEntries = (file: string): any[] => (json(file).hooks?.Stop ?? []) as any[];

test('install adds one Stop entry beside the person\'s hooks; reinstall does not duplicate; uninstall removes only ours', () => {
  const root = temp('cm-codex-');
  const hooks = path.join(root, 'hooks.json');
  const mine = { hooks: [{ type: 'command', command: 'echo mine' }] };
  writeFileSync(hooks, JSON.stringify({ hooks: { Stop: [mine], PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo pre' }] }] } }));

  const first = installCodexStopHook({ config_root: root, gate_source: GATE });
  assert.ok(first.record !== null);
  assert.ok(existsSync(first.record.script));
  assert.equal(stopEntries(hooks).length, 2);
  assert.ok(JSON.stringify(stopEntries(hooks)).includes(first.record.script));

  const again = installCodexStopHook({ config_root: root, gate_source: GATE });
  assert.equal(stopEntries(hooks).length, 2, 'reinstall must not add a second entry');

  removeCodexStopHook(again.record!);
  assert.deepEqual(stopEntries(hooks), [mine]);
  assert.equal(json(hooks).hooks.PreToolUse.length, 1);
  assert.equal(existsSync(again.record!.script), false);
});

test('a hooks.json the install created is removed with it; an unreadable one is left alone', () => {
  const fresh = temp('cm-codex-');
  const r = installCodexStopHook({ config_root: fresh, gate_source: GATE });
  removeCodexStopHook(r.record!);
  assert.equal(existsSync(path.join(fresh, 'hooks.json')), false);

  const broken = temp('cm-codex-');
  writeFileSync(path.join(broken, 'hooks.json'), '{ not json');
  const b = installCodexStopHook({ config_root: broken, gate_source: GATE });
  assert.equal(b.record, null);
  assert.match(b.notes.join('\n'), /hooks\.json/);
  assert.equal(readFileSync(path.join(broken, 'hooks.json'), 'utf8'), '{ not json');
});

function project(test_exit: number): string {
  const dir = temp('cm-proj-');
  const git = (...args: string[]) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: `node -e "console.log('suite output');process.exit(${String(test_exit)})"` } }));
  git('add', '.'); git('commit', '-qm', 'init');
  writeFileSync(path.join(dir, 'app.js'), 'export const x = 1;\n');
  return dir;
}

const stop = (cwd: string, state: string, session = 's1') => spawnSync(process.execPath, [GATE], {
  input: JSON.stringify({ session_id: session, cwd, hook_event_name: 'Stop', stop_hook_active: false }),
  encoding: 'utf8', env: { ...process.env, CM_CODEX_GATE_STATE: state },
});

test('the gate blocks with the failing command and its output, then lets a fixed change finish', () => {
  const dir = project(1); const state = temp('cm-state-');
  const red = stop(dir, state);
  assert.equal(red.status, 0, red.stderr);
  const verdict = JSON.parse(red.stdout) as { decision: string; reason: string };
  assert.equal(verdict.decision, 'block');
  assert.match(verdict.reason, /npm run test/);
  assert.match(verdict.reason, /suite output/);

  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } }));
  const green = stop(dir, state);
  assert.equal(green.stdout.trim(), '');
});

test('an unchanged tree that already passed is not re-run, and a clean tree is never checked', () => {
  const dir = project(0); const state = temp('cm-state-');
  const runs = path.join(state, 'runs.txt');
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: `node -e "require('fs').appendFileSync('${runs}','x')"` } }));
  assert.equal(stop(dir, state).stdout.trim(), '');
  assert.equal(stop(dir, state).stdout.trim(), '');
  assert.equal(readFileSync(runs, 'utf8'), 'x', 'the second stop re-ran checks on an unchanged tree');
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "process.exit(1)"' } }));
  spawnSync('git', ['stash', '-q', '--include-untracked'], { cwd: dir });
  assert.equal(stop(dir, state).stdout.trim(), '', 'nothing changed since HEAD, nothing to check');
});

test('an explicit .cm/checks file wins over package scripts', () => {
  const dir = project(0); const state = temp('cm-state-');
  mkdirSync(path.join(dir, '.cm'));
  writeFileSync(path.join(dir, '.cm', 'checks'), '# the project says what proves a change\nnode -e "console.log(\'custom check\');process.exit(3)"\n');
  const out = JSON.parse(stop(dir, state).stdout) as { reason: string };
  assert.match(out.reason, /custom check/);
});

test('after three blocked repair cycles the gate stops blocking and says BLOCKER', () => {
  const dir = project(1); const state = temp('cm-state-');
  for (let i = 1; i <= 3; i += 1) {
    writeFileSync(path.join(dir, 'app.js'), `export const x = ${String(i)};\n`);
    assert.equal((JSON.parse(stop(dir, state).stdout) as { decision: string }).decision, 'block', `cycle ${String(i)}`);
  }
  writeFileSync(path.join(dir, 'app.js'), 'export const x = 4;\n');
  const capped = stop(dir, state);
  assert.equal(capped.stdout.trim(), '');
  assert.match(capped.stderr, /BLOCKER/);
});

test('uninstall gives back the person\'s hooks.json byte for byte, including an empty Stop list', () => {
  const root = temp('cm-codex-');
  const hooks = path.join(root, 'hooks.json');
  const original = '{"hooks": {"Stop": [], "PreToolUse": [{"matcher": "Bash", "hooks": [{"type": "command", "command": "echo pre"}]}]}}\n';
  writeFileSync(hooks, original);
  const r = installCodexStopHook({ config_root: root, gate_source: GATE });
  removeCodexStopHook(r.record!);
  assert.equal(readFileSync(hooks, 'utf8'), original);
});

test('a cm folder that was already there, and the person\'s files in it, survive uninstall', () => {
  const root = temp('cm-codex-');
  mkdirSync(path.join(root, 'cm'));
  writeFileSync(path.join(root, 'cm', 'notes.txt'), 'mine');
  const r = installCodexStopHook({ config_root: root, gate_source: GATE });
  removeCodexStopHook(r.record!);
  assert.equal(readFileSync(path.join(root, 'cm', 'notes.txt'), 'utf8'), 'mine');
  assert.equal(existsSync(path.join(root, 'cm', 'stop-gate.mjs')), false);
});

test('the hook command names the node that installed it, not whichever node is first on PATH', () => {
  const r = installCodexStopHook({ config_root: temp('cm-codex-'), gate_source: GATE });
  assert.ok(r.record!.command.includes(process.execPath));
});

test('on Windows the command is `node "<script>"`, which both cmd and PowerShell run', () => {
  const r = installCodexStopHook({ config_root: temp('cm-codex-'), gate_source: GATE, platform: 'win32' });
  assert.match(r.record!.command, /^node "[^"]+stop-gate\.mjs"$/);
});
