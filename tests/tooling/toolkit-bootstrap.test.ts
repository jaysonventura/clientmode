/** The SessionStart bootstrap builds the toolkit that `cdt-verify` and the trusted verification
 * verdict live in. A build that fails once must not leave the toolkit unbuilt forever: it is retried
 * after a window, its output is kept where the next session can read it, and the session-start
 * warning says what is actually happening instead of promising a build that will never run.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT } from '../harness/evidence.js';

const HOOKS = path.join(ROOT, 'plugin/hooks');

interface Sandbox { dir: string; home: string; toolkit: string; calls: string; env: NodeJS.ProcessEnv }

function sandbox(npm: 'fail' | 'ok'): Sandbox {
  const dir = mkdtempSync(path.join(tmpdir(), 'cm-toolkit-'));
  const hooks = path.join(dir, 'plugin/hooks');
  const toolkit = path.join(dir, 'plugin/toolkit');
  const bin = path.join(dir, 'fakebin');
  const home = path.join(dir, 'home');
  const calls = path.join(dir, 'npm-calls');
  for (const d of [hooks, toolkit, bin, path.join(home, '.claude')]) mkdirSync(d, { recursive: true });
  for (const f of ['plugins.sh', 'plugins-lib.sh', 'session-start-vault.sh']) copyFileSync(path.join(HOOKS, f), path.join(hooks, f));
  writeFileSync(path.join(toolkit, 'package.json'), '{"name":"fake-toolkit"}\n');
  writeFileSync(path.join(home, '.claude/claude-dev-team.env'), '');
  const body = npm === 'fail'
    ? 'echo "npm ERR! network request to registry failed"; exit 1'
    : 'mkdir -p dist/cli && for n in hook cdt cdt-prompt cdt-spec cdt-verify; do echo "" > dist/cli/$n.js; done; mkdir -p node_modules';
  writeFileSync(path.join(bin, 'npm'), `#!/usr/bin/env bash\necho "$*" >> "${calls}"\n${body}\n`);
  chmodSync(path.join(bin, 'npm'), 0o755);
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, CDT_BOOTSTRAP: 'off' };
  delete env.CDT_HOME;
  return { dir, home, toolkit, calls, env };
}

function bootstrap(s: Sandbox): void {
  const run = spawnSync('bash', [path.join(s.dir, 'plugin/hooks/plugins.sh'), 'bootstrap', '--quiet'], { env: s.env, encoding: 'utf8', input: '' });
  assert.equal(run.status, 0, run.stderr);
}

function sessionStart(s: Sandbox): string {
  const run = spawnSync('bash', [path.join(s.dir, 'plugin/hooks/session-start-vault.sh')], { env: s.env, encoding: 'utf8', input: '{}' });
  return run.stdout;
}

const npmCalls = (s: Sandbox): number => existsSync(s.calls) ? readFileSync(s.calls, 'utf8').trim().split('\n').length : 0;
const stamp = (s: Sandbox): string => path.join(s.toolkit, '.cdt-build-attempted');
const log = (s: Sandbox): string => path.join(s.toolkit, '.cdt-build.log');

test('a failed build keeps its output in a log the next session can read', () => {
  const s = sandbox('fail');
  bootstrap(s);
  assert.ok(existsSync(log(s)), 'no build log was written');
  assert.match(readFileSync(log(s), 'utf8'), /network request to registry failed/);
});

test('a failed build is not retried inside the window', () => {
  const s = sandbox('fail');
  bootstrap(s);
  const first = npmCalls(s);
  assert.ok(first > 0, 'the first bootstrap never ran npm');
  bootstrap(s);
  assert.equal(npmCalls(s), first, 'the build was retried on the very next session');
});

test('a failed build is retried once the window has passed', () => {
  const s = sandbox('fail');
  bootstrap(s);
  const first = npmCalls(s);
  writeFileSync(stamp(s), `${Math.floor(Date.now() / 1000) - 25 * 3600}\n`);
  bootstrap(s);
  assert.ok(npmCalls(s) > first, 'a build that failed a day ago was never retried');
});

test('an empty stamp left by an older version counts as expired, so that install heals', () => {
  const s = sandbox('ok');
  writeFileSync(stamp(s), '');
  bootstrap(s);
  assert.ok(existsSync(path.join(s.toolkit, 'dist/cli/hook.js')), 'the legacy stamp still blocked the build');
});

test('session start promises a background build only when one will run', () => {
  const s = sandbox('fail');
  assert.match(sessionStart(s), /building it in the background/);
  bootstrap(s);
  const after = sessionStart(s);
  assert.doesNotMatch(after, /building it in the background/, 'still promising a build that is blocked');
  assert.match(after, /toolkit build failed/);
  assert.ok(after.includes(log(s)), 'the warning does not point at the build log');
});

test('doctor fails loudly while the toolkit is unbuilt, and passes once cdt-verify is there', () => {
  const s = sandbox('fail');
  copyFileSync(path.join(HOOKS, 'doctor.sh'), path.join(s.dir, 'plugin/hooks/doctor.sh'));
  const doctor = (): string => spawnSync('bash', [path.join(s.dir, 'plugin/hooks/doctor.sh')], { env: s.env, encoding: 'utf8' }).stdout;
  assert.match(doctor(), /\[FAIL\] toolkit not built/);
  mkdirSync(path.join(s.home, '.claude/bin'), { recursive: true });
  writeFileSync(path.join(s.home, '.claude/bin/cdt-verify'), '');
  assert.match(doctor(), /\[ok\]\s+toolkit built/);
});

test('a stamp with a leading zero or a retry setting of 08 still yields the failure warning', () => {
  const s = sandbox('fail');
  writeFileSync(stamp(s), `0${Math.floor(Date.now() / 1000) - 60}\n`);
  const out = spawnSync('bash', [path.join(s.dir, 'plugin/hooks/session-start-vault.sh')],
    { env: { ...s.env, CDT_TOOLKIT_RETRY_HOURS: '08' }, encoding: 'utf8', input: '{}' }).stdout;
  assert.match(out, /toolkit build failed/);
});

test('a stamp from the future (clock skew) does not block the retry', () => {
  const s = sandbox('fail');
  writeFileSync(stamp(s), `${Math.floor(Date.now() / 1000) + 3 * 3600}\n`);
  bootstrap(s);
  assert.ok(npmCalls(s) > 0, 'a future stamp blocked the build');
});

// `cm install` runs `plugins.sh toolkit` so cdt-verify works the moment the install finishes: the
// install replaces the toolkit copy, and links into the old one would otherwise dangle until a later
// SessionStart finished a background build.
function toolkitCommand(s: Sandbox, binDir: string): void {
  const run = spawnSync('bash', [path.join(s.dir, 'plugin/hooks/plugins.sh'), 'toolkit'],
    { env: { ...s.env, CDT_LINK_BIN_DIR: binDir }, encoding: 'utf8', input: '' });
  assert.equal(run.status, 0, run.stderr);
}

test('the install-time toolkit command builds and links cdt-verify where a shell can find it', () => {
  const s = sandbox('ok');
  const binDir = path.join(s.dir, 'launcher-bin');
  toolkitCommand(s, binDir);
  for (const link of [path.join(s.home, '.claude/bin/cdt-verify'), path.join(binDir, 'cdt-verify')]) {
    assert.ok(existsSync(link), `${link} is missing or dangling`);
  }
});

test('the install-time toolkit command builds even inside a failed build retry window', () => {
  const s = sandbox('ok');
  writeFileSync(stamp(s), String(Math.floor(Date.now() / 1000)));
  toolkitCommand(s, path.join(s.dir, 'launcher-bin'));
  assert.ok(existsSync(path.join(s.home, '.claude/bin/cdt-verify')), 'an explicit install must not wait out the retry window');
});
