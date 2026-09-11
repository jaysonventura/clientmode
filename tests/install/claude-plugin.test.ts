/** The `cm` plugin is registered with Claude Code from the installed toolkit, and the old
 * `cdt@claude-dev-team` plugin is switched off so the same agents and hooks never load twice.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PLUGIN_ID, registerClaudePlugin, unregisterClaudePlugin } from '../../packages/packaging/src/claude-plugin.js';

const setup = (settings?: object): { root: string; file: string } => {
  const root = mkdtempSync(path.join(tmpdir(), 'cm-plugin-'));
  const file = path.join(root, 'settings.json');
  if (settings !== undefined) { mkdirSync(root, { recursive: true }); writeFileSync(file, JSON.stringify(settings, null, 2) + '\n'); }
  return { root, file };
};
const json = (file: string): Record<string, any> => JSON.parse(readFileSync(file, 'utf8')) as Record<string, any>;

test('with the claude CLI: marketplace added from the toolkit, plugin installed at user scope', () => {
  const { root, file } = setup({ enabledPlugins: { 'cdt@claude-dev-team': true, 'other@x': true } });
  const calls: string[][] = [];
  const registration = registerClaudePlugin({
    config_root: root, marketplace_dir: '/opt/cm/toolkit', claude: '/bin/claude',
    run: (argv) => { calls.push(argv); return { status: 0, stdout: '', stderr: '' }; },
  });
  assert.equal(PLUGIN_ID, 'cm@clientmode');
  assert.equal(registration.method, 'cli');
  assert.deepEqual(calls, [
    ['plugin', 'marketplace', 'add', '/opt/cm/toolkit'],
    ['plugin', 'install', 'cm@clientmode', '--scope', 'user'],
  ]);
  assert.equal(json(file).enabledPlugins['cdt@claude-dev-team'], false, 'the old plugin is switched off');
  assert.equal(json(file).enabledPlugins['other@x'], true);

  const removals: string[][] = [];
  unregisterClaudePlugin({ registration, claude: '/bin/claude', run: (argv) => { removals.push(argv); return { status: 0, stdout: '', stderr: '' }; } });
  assert.deepEqual(removals, [['plugin', 'uninstall', 'cm@clientmode'], ['plugin', 'marketplace', 'remove', 'clientmode']]);
  assert.equal(json(file).enabledPlugins['cdt@claude-dev-team'], true, 'the old plugin comes back as it was');
});

test('without the claude CLI: declared in settings.json, and undone exactly', () => {
  const { root, file } = setup({ theme: 'dark' });
  const registration = registerClaudePlugin({ config_root: root, marketplace_dir: '/opt/cm/toolkit', claude: null });
  assert.equal(registration.method, 'settings');
  assert.deepEqual(json(file).extraKnownMarketplaces.clientmode, { source: { source: 'directory', path: '/opt/cm/toolkit' } });
  assert.equal(json(file).enabledPlugins['cm@clientmode'], true);
  assert.equal('cdt@claude-dev-team' in (json(file).enabledPlugins as object), false, 'nothing to switch off');
  unregisterClaudePlugin({ registration, claude: null });
  assert.deepEqual(json(file), { theme: 'dark' });
});

test('a failing CLI step falls back to settings.json and says why', () => {
  const { root, file } = setup();
  const registration = registerClaudePlugin({
    config_root: root, marketplace_dir: '/opt/cm/toolkit', claude: '/bin/claude',
    run: () => ({ status: 1, stdout: '', stderr: 'network down' }),
  });
  assert.equal(registration.method, 'settings');
  assert.ok(registration.notes.some(note => note.includes('network down')));
  assert.equal(json(file).enabledPlugins['cm@clientmode'], true);
  unregisterClaudePlugin({ registration, claude: null });
  assert.equal(existsSync(file), false);
});
