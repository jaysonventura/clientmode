/** The "CDT Usage" macOS menu bar app is gone from Client Mode. The repository no longer ships or
 * mentions it outside the changelog, and an install that already has it is cleaned up once at
 * session start: the login item, the app bundle Client Mode built, and the copies under ~/.claude.
 * A bundle with any other identity is never touched.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT } from '../harness/evidence.js';

const OURS = 'com.jaysonventura.claude-dev-team.menubar';

function fakeApp(apps: string, id: string, calls: string): string {
  const bundle = path.join(apps, 'CDT Usage.app');
  mkdirSync(path.join(bundle, 'Contents/MacOS'), { recursive: true });
  writeFileSync(path.join(bundle, 'Contents/Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${id}</string></dict></plist>\n`);
  const exe = path.join(bundle, 'Contents/MacOS/cdt-menubar');
  writeFileSync(exe, `#!/usr/bin/env bash\necho "$*" >> "${calls}"\n`);
  chmodSync(exe, 0o755);
  return bundle;
}

function installedMachine(id: string) {
  const dir = mkdtempSync(path.join(tmpdir(), 'cm-menubar-'));
  const hooks = path.join(dir, 'plugin/hooks');
  const home = path.join(dir, 'home');
  const cdt = path.join(home, '.claude');
  const apps = path.join(dir, 'Applications');
  const calls = path.join(dir, 'app-calls');
  for (const d of [hooks, path.join(cdt, 'bin'), path.join(cdt, 'claude-dev-team-menubar/Sources'), apps]) mkdirSync(d, { recursive: true });
  copyFileSync(path.join(ROOT, 'plugin/hooks/session-start-vault.sh'), path.join(hooks, 'session-start-vault.sh'));
  for (const f of ['.cdt-menubar-installed', 'bin/cdt-menubar', 'bin/cdt-menubar-app']) writeFileSync(path.join(cdt, f), '');
  const bundle = fakeApp(apps, id, calls);
  const run = spawnSync('bash', [path.join(hooks, 'session-start-vault.sh')], {
    env: { ...process.env, HOME: home, CDT_MENUBAR_APPS: apps }, encoding: 'utf8', input: '{}',
  });
  return { cdt, bundle, calls, run };
}

test('session start retires an installed CDT Usage app and its leftovers', () => {
  const m = installedMachine(OURS);
  assert.equal(m.run.status, 0, m.run.stderr);
  assert.ok(existsSync(m.calls) && readFileSync(m.calls, 'utf8').includes('--unregister'), 'login item was not unregistered');
  assert.ok(!existsSync(m.bundle), 'the app bundle is still installed');
  for (const f of ['.cdt-menubar-installed', 'bin/cdt-menubar', 'bin/cdt-menubar-app', 'claude-dev-team-menubar']) {
    assert.ok(!existsSync(path.join(m.cdt, f)), `${f} was left behind`);
  }
});

test('a bundle that is not Client Mode\'s is never touched', () => {
  const m = installedMachine('com.example.someone-else');
  assert.ok(existsSync(m.bundle), 'removed an app Client Mode did not build');
  assert.ok(!existsSync(m.calls), 'ran a binary Client Mode did not build');
});

test('the repository no longer ships the app or points anyone at it', () => {
  assert.ok(!existsSync(path.join(ROOT, 'plugin/menubar')), 'plugin/menubar still ships');
  assert.ok(!existsSync(path.join(ROOT, 'plugin/hooks/menubar-install.sh')));
  assert.ok(!existsSync(path.join(ROOT, 'plugin/commands/menubar.md')));
  const readme = readFileSync(path.join(ROOT, 'plugin/README.md'), 'utf8');
  assert.equal(readme.match(/menu bar|CDT Usage/gi)?.length, 2, 'the plugin README should only note the removal');
  const grep = spawnSync('git', ['grep', '-n', '-i', '-I', '-E', 'cdt-menubar|menu bar|menubar|CDT Usage|realtime-usage|REALTIME_USAGE', '--',
    '.', ':!plugin/CHANGELOG.md', ':!plugin/hooks/session-start-vault.sh', ':!tests/tooling/menubar-removal.test.ts', ':!fixtures',
    // the two places that say it was removed and retired
    ':!plugin/README.md', ':!plugin/docs/architecture.md'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(grep.stdout, '', `still referenced:\n${grep.stdout}`);
});
