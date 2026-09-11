/** macOS, Linux and Windows differ in three places that matter to an install: how an executable is
 * found, what a launcher is, and how arguments survive a `.cmd` shim.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findExecutable, launcherToolkitRoot, spawnPlan, writeLauncher } from '../../packages/packaging/src/platform.js';

const dir = (): string => mkdtempSync(path.join(tmpdir(), 'cm-platform-'));

test('an executable is found on PATH, honouring PATHEXT on Windows', () => {
  const a = dir(); const b = dir();
  writeFileSync(path.join(b, 'codex.CMD'), '@echo off\n');
  writeFileSync(path.join(a, 'claude'), '#!/bin/sh\n', { mode: 0o755 });
  const win = { PATH: [a, b].join(';'), PATHEXT: '.COM;.EXE;.BAT;.CMD' };
  assert.equal(findExecutable('codex', win, 'win32'), path.join(b, 'codex.CMD'));
  assert.equal(findExecutable('claude', win, 'win32'), null, 'an extensionless file is not runnable on Windows');
  assert.equal(findExecutable('claude', { PATH: [a, b].join(':') }, 'darwin'), path.join(a, 'claude'));
  assert.equal(findExecutable('missing', { PATH: a }, 'darwin'), null);
});

test('a .cmd shim is run through cmd.exe with every argument quoted, a real .exe directly', () => {
  const direct = spawnPlan('C:\\Tools\\claude.exe', ['--append-system-prompt-file', 'C:\\a b\\HANDOFF.md'], 'win32');
  assert.deepEqual(direct, { command: 'C:\\Tools\\claude.exe', args: ['--append-system-prompt-file', 'C:\\a b\\HANDOFF.md'], verbatim: false });
  // cmd.exe by full path: by bare name Windows can resolve it from the project folder first.
  const shim = spawnPlan('C:\\npm\\codex.cmd', ['fix the "checkout" & ship', '100%'], 'win32', { ComSpec: 'C:\\Windows\\system32\\cmd.exe' });
  assert.equal(shim.command, 'C:\\Windows\\system32\\cmd.exe');
  assert.equal(spawnPlan('C:\\npm\\codex.cmd', [], 'win32', { SystemRoot: 'D:\\Win' }).command, 'D:\\Win\\System32\\cmd.exe');
  assert.equal(shim.verbatim, true);
  assert.deepEqual(shim.args.slice(0, 3), ['/d', '/s', '/c']);
  const line = shim.args[3]!;
  // Metacharacters are caret-escaped twice: once for cmd.exe, once for the batch file it runs.
  assert.ok(line.includes('^^^&'), line);
  assert.ok(line.includes('^^^%'), line);
  assert.ok(!/(?<!\^)&/.test(line), `no bare ampersand in ${line}`);
  assert.deepEqual(spawnPlan('/usr/local/bin/codex', ['a b'], 'darwin'), { command: '/usr/local/bin/codex', args: ['a b'], verbatim: false });
});

test('the launcher is a shell script on macOS and a .cmd plus a shell script on Windows', () => {
  const bin = dir();
  const posix = writeLauncher({ bin_dir: bin, toolkit_root: '/Users/a b/.client-mode/toolkit', node: '/opt/node/bin/node', platform: 'darwin' });
  assert.deepEqual(posix, [path.join(bin, 'cm')]);
  const script = readFileSync(path.join(bin, 'cm'), 'utf8');
  assert.match(script, /^#!\/bin\/sh\n/);
  assert.match(script, /exec "\/opt\/node\/bin\/node" --disable-warning=ExperimentalWarning "\$CM_TOOLKIT_ROOT\/cm\.js" "\$@"/);
  assert.equal(statSync(path.join(bin, 'cm')).mode & 0o111, 0o111);
  assert.equal(launcherToolkitRoot(script), '/Users/a b/.client-mode/toolkit');

  const winBin = dir();
  const written = writeLauncher({ bin_dir: winBin, toolkit_root: 'C:\\Users\\A B\\.client-mode\\toolkit', node: 'C:\\Users\\A B\\.client-mode\\runtime\\node.exe', platform: 'win32' });
  assert.deepEqual(written, [path.join(winBin, 'cm.cmd'), path.join(winBin, 'cm')]);
  const cmd = readFileSync(path.join(winBin, 'cm.cmd'), 'utf8');
  assert.match(cmd, /^@echo off\r\n/);
  // The node call and the exit share one line: cmd.exe re-reads a batch file after each line, and
  // `cm uninstall` deletes this one while it runs ("The batch file cannot be found").
  assert.ok(cmd.includes('"C:\\Users\\A B\\.client-mode\\runtime\\node.exe" --disable-warning=ExperimentalWarning "%CM_TOOLKIT_ROOT%\\cm.js" %* & exit /b\r\n'), cmd);
  assert.ok(!cmd.includes('\n') || cmd.includes('\r\n'), 'CRLF line endings for cmd.exe');
  assert.equal(launcherToolkitRoot(cmd), 'C:\\Users\\A B\\.client-mode\\toolkit');
});

test('a launcher that names no toolkit yields null rather than a guess', () => {
  const d = dir();
  mkdirSync(d, { recursive: true });
  assert.equal(launcherToolkitRoot('#!/bin/sh\necho hi\n'), null);
});

test('doctor finds Windows hosts in their install locations, and still refuses anything outside them', async () => {
  const { whichTrusted } = await import('../../packages/providers/src/capabilities.js');
  const { defaultTrustedRoots } = await import('../../apps/cli/src/doctor.js');
  const appData = dir();
  const npmDir = path.join(appData, 'npm');
  mkdirSync(npmDir, { recursive: true });
  writeFileSync(path.join(npmDir, 'codex.cmd'), '@echo off\n');
  const roots = defaultTrustedRoots({ APPDATA: appData, LOCALAPPDATA: dir(), USERPROFILE: dir() }, 'win32');
  assert.ok(roots.includes(npmDir), JSON.stringify(roots));
  // Windows paths are case-insensitive; which spelling of the extension matched does not matter.
  assert.equal(whichTrusted('codex', roots, { PATH: '', PATHEXT: '.EXE;.CMD' }, 'win32')?.toLowerCase(), path.join(npmDir, 'codex.cmd').toLowerCase());
  const untrusted = dir();
  writeFileSync(path.join(untrusted, 'gemini.cmd'), '@echo off\n');
  assert.equal(whichTrusted('gemini', roots, { PATH: untrusted, PATHEXT: '.CMD' }, 'win32'), null, 'on PATH but outside every trusted root');
  assert.ok(defaultTrustedRoots({ HOME: '/Users/x' }, 'darwin').includes('/opt/homebrew/bin'));
});
