/** Installing sets each host to act without approval prompts, and uninstalling puts back exactly
 * what was there — including a value the person had chosen before, and never overwriting a value
 * they changed after the install.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { applyAutonomy, restoreAutonomy, setTomlKey } from '../../packages/packaging/src/autonomy.js';
import { hostLayout } from '../../packages/packaging/src/hosts.js';

const home = (): string => mkdtempSync(path.join(tmpdir(), 'cm-auto-'));
const json = (file: string): Record<string, any> => JSON.parse(readFileSync(file, 'utf8')) as Record<string, any>;
const put = (file: string, text: string): void => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text); };

test('Claude starts in auto mode; everything else in settings.json is kept and restored', () => {
  const h = home();
  const settings = path.join(h, '.claude', 'settings.json');
  const original = JSON.stringify({ permissions: { defaultMode: 'bypassPermissions', allow: ['Bash(git status)'] }, theme: 'dark' }, null, 2) + '\n';
  put(settings, original);
  const applied = applyAutonomy(hostLayout('claude', h, {}));
  assert.equal(json(settings).permissions.defaultMode, 'auto');
  assert.deepEqual(json(settings).permissions.allow, ['Bash(git status)']);
  assert.equal(json(settings).theme, 'dark');
  restoreAutonomy(applied.changes);
  assert.deepEqual(json(settings), JSON.parse(original));
});

test('a value the person changed after install is left alone on uninstall', () => {
  const h = home();
  const settings = path.join(h, '.claude', 'settings.json');
  put(settings, '{}\n');
  const applied = applyAutonomy(hostLayout('claude', h, {}));
  const edited = json(settings); edited.permissions.defaultMode = 'plan';
  writeFileSync(settings, JSON.stringify(edited));
  const outcome = restoreAutonomy(applied.changes);
  assert.equal(json(settings).permissions.defaultMode, 'plan');
  assert.ok(outcome.left_alone.some(entry => entry.includes('permissions.defaultMode')));
});

test('a settings file the installer created is removed again', () => {
  const h = home();
  const applied = applyAutonomy(hostLayout('claude', h, {}));
  assert.ok(existsSync(path.join(h, '.claude', 'settings.json')));
  restoreAutonomy(applied.changes);
  assert.equal(existsSync(path.join(h, '.claude', 'settings.json')), false);
});

test('a settings file that does not parse is never rewritten', () => {
  const h = home();
  const settings = path.join(h, '.claude', 'settings.json');
  put(settings, '{ // a comment\n "theme": "dark" }\n');
  const applied = applyAutonomy(hostLayout('claude', h, {}));
  assert.equal(readFileSync(settings, 'utf8'), '{ // a comment\n "theme": "dark" }\n');
  assert.equal(applied.changes.length, 0);
  assert.ok(applied.notes.some(note => note.includes(settings)));
});

test('Codex gets full access; comments, tables and key order survive, and restore is byte-identical', () => {
  const h = home();
  const config = path.join(h, '.codex', 'config.toml');
  const original = [
    'model = "gpt-6-astra"',
    '# my approval choice',
    'approval_policy = "on-request"',
    'sandbox_mode = "workspace-write"',
    '',
    '[sandbox_workspace_write]',
    'network_access = true',
    '',
    '[marketplaces.ponytail]',
    'source = "https://github.com/DietrichGebert/ponytail.git"',
    '',
  ].join('\n');
  put(config, original);
  const applied = applyAutonomy(hostLayout('codex', h, {}));
  const text = readFileSync(config, 'utf8');
  const beforeFirstTable = text.slice(0, text.indexOf('\n['));
  assert.match(beforeFirstTable, /^approval_policy = "never"$/m);
  assert.match(beforeFirstTable, /^sandbox_mode = "danger-full-access"$/m);
  assert.doesNotMatch(text, /on-request|workspace-write"/);
  assert.match(text, /\[notice\]\nhide_full_access_warning = true/);
  assert.match(text, /# my approval choice/);
  assert.match(text, /\[marketplaces\.ponytail\]\nsource = /);
  restoreAutonomy(applied.changes);
  assert.equal(readFileSync(config, 'utf8'), original);
});

test('Codex config that did not exist is created and removed again', () => {
  const h = home();
  const applied = applyAutonomy(hostLayout('codex', h, {}));
  const text = readFileSync(path.join(h, '.codex', 'config.toml'), 'utf8');
  assert.match(text, /^approval_policy = "never"$/m);
  restoreAutonomy(applied.changes);
  assert.equal(existsSync(path.join(h, '.codex', 'config.toml')), false);
});

test('TOML keys: an existing table gains the key, and a missing one is appended', () => {
  assert.deepEqual(setTomlKey('a = 1\n[notice]\nother = 2\n', 'notice', 'x', 'true'), { text: 'a = 1\n[notice]\nx = true\nother = 2\n', previous: null });
  assert.deepEqual(setTomlKey('a = 1\n', 'notice', 'x', 'true'), { text: 'a = 1\n\n[notice]\nx = true\n', previous: null });
  assert.deepEqual(setTomlKey('x = "old"\n[t]\n', null, 'x', '"new"'), { text: 'x = "new"\n[t]\n', previous: 'x = "old"' });
});

test('Gemini allows every tool through a user policy and skips folder trust; both are undone', () => {
  const h = home();
  const settings = path.join(h, '.gemini', 'settings.json');
  put(settings, JSON.stringify({ ui: { theme: 'GitHub' } }) + '\n');
  const applied = applyAutonomy(hostLayout('gemini', h, {}));
  const policy = readFileSync(path.join(h, '.gemini', 'policies', 'client-mode.toml'), 'utf8');
  assert.match(policy, /\[\[rule\]\]\ntoolName = "\*"\ndecision = "allow"\npriority = \d+/);
  assert.equal(json(settings).security.folderTrust.enabled, false);
  assert.equal(json(settings).ui.theme, 'GitHub');
  restoreAutonomy(applied.changes);
  assert.equal(existsSync(path.join(h, '.gemini', 'policies', 'client-mode.toml')), false);
  assert.deepEqual(json(settings), { ui: { theme: 'GitHub' } });
});

test('Cursor CLI runs unrestricted; a new config carries the required fields', () => {
  const h = home();
  const applied = applyAutonomy(hostLayout('cursor', h, {}));
  const config = json(path.join(h, '.cursor', 'cli-config.json'));
  assert.equal(config.approvalMode, 'unrestricted');
  assert.equal(config.version, 1);
  assert.deepEqual(config.permissions, { allow: [], deny: [] });
  assert.ok(applied.notes.some(note => /Run Everything/.test(note)), 'the IDE setting that cannot be written is named');
  restoreAutonomy(applied.changes);
  assert.equal(existsSync(path.join(h, '.cursor', 'cli-config.json')), false);
});

test('Cursor CLI config that exists keeps its permissions', () => {
  const h = home();
  const file = path.join(h, '.cursor', 'cli-config.json');
  const original = { version: 1, editor: { vimMode: true }, permissions: { allow: ['Shell(ls)'], deny: ['Shell(rm)'] }, approvalMode: 'allowlist' };
  put(file, JSON.stringify(original, null, 2) + '\n');
  const applied = applyAutonomy(hostLayout('cursor', h, {}));
  assert.equal(json(file).approvalMode, 'unrestricted');
  assert.deepEqual(json(file).permissions, original.permissions);
  restoreAutonomy(applied.changes);
  assert.deepEqual(json(file), original);
});
