/** What happens after the install: Claude Code installed later, `cm doctor` on a machine where the
 * plugin is only declared, and an uninstall that also takes back the bootstrap's own footprint.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkInstall } from '../../packages/packaging/src/install-health.js';
import { completePendingClaudePlugin, readRecord, setupHosts, uninstallHosts, type SetupRecord } from '../../apps/cli/src/setup.js';
import { ROOT } from '../harness/evidence.js';

const json = (file: string): Record<string, any> => JSON.parse(readFileSync(file, 'utf8')) as Record<string, any>;

async function installClaudeWithoutCli(): Promise<{ home: string; cmHome: string; env: NodeJS.ProcessEnv }> {
  const home = mkdtempSync(path.join(tmpdir(), 'cm-life-'));
  const cmHome = path.join(home, '.client-mode');
  const env = { HOME: home, PATH: '' };
  await setupHosts({
    hosts: ['claude'], home, cm_home: cmHome, env, source_root: ROOT, bin_dir: path.join(home, 'bin'),
    lead: true, autonomy: true, portable: false, install_root: null, dry_run: false, version: 'test', now: '2026-09-11T00:00:00.000Z',
  });
  return { home, cmHome, env };
}

test('a plugin only declared in settings is reported pending, with the command that finishes it', async () => {
  const { home, cmHome } = await installClaudeWithoutCli();
  const record = readRecord(cmHome, 'claude') as SetupRecord;
  assert.equal(record.plugin?.method, 'settings');
  const health = checkInstall({
    home: cmHome, source_root: ROOT, launcher_path: path.join(home, 'bin', 'cm'),
    hosts: [{ host: 'claude', install_root: record.layout.config_root, skills_dir: null, instructions: record.layout.instructions, plugin_pending: true }],
  });
  const pending = health.findings.find(finding => finding.code === 'CLAUDE_PLUGIN_PENDING');
  assert.ok(pending, JSON.stringify(health.findings));
  assert.equal(pending.remedy, 'cm install --host claude');
});

test('once claude is on PATH the pending plugin is installed with the CLI and the settings declaration is taken back', async () => {
  const { cmHome, env } = await installClaudeWithoutCli();
  const settings = path.join((readRecord(cmHome, 'claude') as SetupRecord).layout.config_root, 'settings.json');
  assert.ok(json(settings).extraKnownMarketplaces?.clientmode);
  const calls: string[][] = [];
  const outcome = completePendingClaudePlugin({
    cm_home: cmHome, env, claude: '/bin/claude',
    run: argv => { calls.push(argv); return { status: 0, stdout: '', stderr: '' }; },
  });
  assert.equal(outcome, 'installed');
  assert.deepEqual(calls.map(argv => argv.slice(0, 2)), [['plugin', 'marketplace'], ['plugin', 'install']]);
  assert.equal((readRecord(cmHome, 'claude') as SetupRecord).plugin?.method, 'cli');
  assert.equal(json(settings).extraKnownMarketplaces?.clientmode, undefined);
  assert.equal(json(settings).permissions.defaultMode, 'auto', 'autonomy is untouched by the repair');
  assert.equal(completePendingClaudePlugin({ cm_home: cmHome, env, claude: '/bin/claude', run: () => ({ status: 0, stdout: '', stderr: '' }) }), 'nothing-pending');
});

test('the last uninstall removes the downloaded Node and the source, and leaves the shared PATH line alone', async () => {
  const { home, cmHome, env } = await installClaudeWithoutCli();
  const zshrc = path.join(home, '.zshrc');
  writeFileSync(zshrc, '# mine\nalias ll="ls -l"\n\nexport PATH="/x/.local/bin:$PATH" # client-mode:path\n');
  for (const dir of ['runtime/node/bin', 'src/apps']) mkdirSync(path.join(cmHome, dir), { recursive: true });
  mkdirSync(path.join(cmHome, 'projects', 'p1'), { recursive: true });
  const before = readFileSync(zshrc, 'utf8');
  const outcome = uninstallHosts({ cm_home: cmHome, env, platform: 'darwin' });
  // ~/.local/bin is where the native Claude Code and Codex installers put their binaries too; one of
  // them may rely on the line being there, so it stays, and the person is told.
  assert.equal(readFileSync(zshrc, 'utf8'), before);
  assert.ok(outcome.notes.some(note => note.includes('.local') && note.includes('PATH')), JSON.stringify(outcome.notes));
  assert.equal(existsSync(path.join(cmHome, 'runtime')), false);
  assert.equal(existsSync(path.join(cmHome, 'src')), false);
  assert.ok(existsSync(path.join(cmHome, 'projects', 'p1')), 'client work is never removed');
});
