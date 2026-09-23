/** `cm install` and `cm uninstall` end to end, in a disposable home that already looks like a
 * real one: an earlier Client Mode install, the claude-dev-team plugin enabled, its always-on
 * section pasted into CLAUDE.md, and host settings the person chose themselves.
 *
 * `claude` is kept off PATH so the plugin is declared in settings.json rather than installed by a
 * CLI that would reach outside the disposable home.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fingerprintTree } from '../../packages/packaging/src/install.js';
import { ROOT } from '../harness/evidence.js';

type Home = { home: string; cmHome: string; bin: string; env: NodeJS.ProcessEnv };

function disposableHome(): Home {
  const home = mkdtempSync(path.join(tmpdir(), 'cm-e2e-'));
  const pathDir = path.join(home, '.path');
  mkdirSync(pathDir);
  symlinkSync(process.execPath, path.join(pathDir, 'node'));
  const cmHome = path.join(home, '.client-mode');
  return {
    home, cmHome, bin: path.join(home, '.local', 'bin'),
    env: {
      HOME: home, USERPROFILE: home, CM_HOME: cmHome, NODE_NO_WARNINGS: '1',
      PATH: [pathDir, '/usr/bin', '/bin'].join(path.delimiter),
      TMPDIR: process.env['TMPDIR'] ?? tmpdir(),
    },
  };
}

function cm(h: Home, argv: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, ['--import', 'tsx', path.join(ROOT, 'apps/cli/src/cm.ts'), ...argv], {
    cwd: ROOT, env: h.env, encoding: 'utf8', timeout: 240_000,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

const put = (file: string, text: string): void => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text); };
const json = (file: string): Record<string, any> => JSON.parse(readFileSync(file, 'utf8')) as Record<string, any>;

const LEGACY_SECTION = '# Operating mode — tech-lead orchestrator (claude-dev-team)\n\nYou operate as a **tech-lead orchestrator**.\n\n## Triage tiers\n- T0 solo\n';

function seed(h: Home): Record<string, string> {
  const files: Record<string, string> = {
    '.claude/settings.json': `${JSON.stringify({
      permissions: { defaultMode: 'bypassPermissions', allow: ['Bash(git status)'] },
      enabledPlugins: { 'cdt@claude-dev-team': true, 'superpowers@claude-plugins-official': true },
      theme: 'dark',
    }, null, 2)}\n`,
    '.claude/CLAUDE.md': `# My own notes\n\nKeep these.\n\n${LEGACY_SECTION}`,
    '.codex/config.toml': 'model = "gpt-6-astra"\napproval_policy = "never"\nsandbox_mode = "workspace-write"\n\n[sandbox_workspace_write]\nnetwork_access = true\n',
    '.codex/AGENTS.md': '# codex notes\n',
    '.gemini/settings.json': `${JSON.stringify({ ui: { theme: 'GitHub' } }, null, 2)}\n`,
  };
  for (const [relative, text] of Object.entries(files)) put(path.join(h.home, relative), text);
  return files;
}

test('install configures all four hosts from one toolkit, and uninstall puts every file back', () => {
  const h = disposableHome();
  const original = seed(h);
  // An install made by the previous version: a skill copied into ~/.claude/skills and its record.
  const oldSkill = path.join(h.home, '.claude', 'skills', 'cm-debug', 'SKILL.md');
  put(oldSkill, '---\nname: debug\ndescription: old\n---\n');
  put(path.join(h.cmHome, 'install-claude.json'), JSON.stringify({
    plan: { distribution: 'sha256:old', provider: 'claude', install_root: path.join(h.home, '.claude'), changes: [], owned_paths: [], approved: true },
    applied_at: '2026-09-08T00:00:00.000Z', backups: [], created: [oldSkill], merged: [], launcher: null, toolkit_root: null,
  }));

  // A dry run writes nothing at all.
  const before = fingerprintTree(h.home);
  const dry = cm(h, ['install', '--dry-run', '--bin-dir', h.bin]);
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /claude[\s\S]*codex[\s\S]*gemini[\s\S]*cursor/);
  assert.match(dry.stdout, /codex .*Stop hook in .*hooks\.json/, 'the plan names the Codex Stop hook before installing it');
  assert.deepEqual(fingerprintTree(h.home), before, 'dry run left the home untouched');

  // A skill of the person's own, with a name that happens to start with cm-, in the shared directory.
  const theirs = path.join(h.home, '.agents', 'skills', 'cm-mine', 'SKILL.md');
  put(theirs, '---\nname: cm-mine\ndescription: mine\n---\n');

  const installed = cm(h, ['install', '--bin-dir', h.bin]);
  assert.equal(installed.status, 0, `${installed.stdout}\n${installed.stderr}`);

  // One toolkit, which is also the Claude plugin marketplace.
  const toolkit = path.join(h.cmHome, 'toolkit');
  assert.ok(existsSync(path.join(toolkit, 'cm.js')));
  assert.equal(json(path.join(toolkit, '.claude-plugin', 'marketplace.json')).plugins[0].source, './plugin');
  assert.ok(existsSync(path.join(toolkit, 'plugin', 'skills', 'tdd', 'SKILL.md')));
  assert.equal(existsSync(path.join(toolkit, 'plugin', 'toolkit', 'node_modules')), false);

  // Claude: plugin declared, old plugin off, auto mode, rules first, legacy section moved out.
  const claudeSettings = json(path.join(h.home, '.claude', 'settings.json'));
  assert.equal(claudeSettings.permissions.defaultMode, 'auto');
  assert.deepEqual(claudeSettings.permissions.allow, ['Bash(git status)']);
  assert.deepEqual(claudeSettings.extraKnownMarketplaces.clientmode, { source: { source: 'directory', path: toolkit } });
  assert.equal(claudeSettings.enabledPlugins['cm@clientmode'], true);
  assert.equal(claudeSettings.enabledPlugins['cdt@claude-dev-team'], false);
  assert.equal(claudeSettings.enabledPlugins['superpowers@claude-plugins-official'], true);
  const claudeMd = readFileSync(path.join(h.home, '.claude', 'CLAUDE.md'), 'utf8');
  assert.ok(claudeMd.startsWith('<!-- client-mode:start -->\n# Client Mode'));
  assert.match(claudeMd, /`cm:tdd`/);
  assert.match(claudeMd, /Keep these\./);
  assert.doesNotMatch(claudeMd, /tech-lead orchestrator \(claude-dev-team\)/);
  assert.equal(existsSync(oldSkill), false, 'the previous install\'s skill copy is gone');

  // Codex, Gemini, Cursor.
  const codexConfig = readFileSync(path.join(h.home, '.codex', 'config.toml'), 'utf8');
  assert.match(codexConfig, /^sandbox_mode = "danger-full-access"$/m);
  assert.match(codexConfig, /^approval_policy = "never"$/m);
  assert.match(readFileSync(path.join(h.home, '.codex', 'AGENTS.md'), 'utf8'), /## Test first, always/);
  assert.ok(existsSync(path.join(h.home, '.agents', 'skills', 'cm-tdd', 'SKILL.md')));
  const codexGate = path.join(h.home, '.codex', 'cm', 'stop-gate.mjs');
  assert.ok(existsSync(codexGate), 'the Codex Stop gate is installed');
  assert.match(JSON.stringify(json(path.join(h.home, '.codex', 'hooks.json')).hooks.Stop), /stop-gate\.mjs/);
  assert.match(readFileSync(path.join(h.home, '.gemini', 'GEMINI.md'), 'utf8'), /`cm-orchestration`/);
  assert.ok(existsSync(path.join(h.home, '.gemini', 'policies', 'client-mode.toml')));
  assert.deepEqual(json(path.join(h.home, '.gemini', 'settings.json')), { ui: { theme: 'GitHub' } }, 'folder trust left on');
  assert.match(readFileSync(path.join(h.home, '.cursor', 'rules', 'client-mode.mdc'), 'utf8'), /alwaysApply: true/);
  assert.equal(json(path.join(h.home, '.cursor', 'cli-config.json')).approvalMode, 'unrestricted');

  // The launcher runs the installed toolkit, and doctor sees all four hosts.
  const launcher = path.join(h.bin, process.platform === 'win32' ? 'cm.cmd' : 'cm');
  assert.ok(existsSync(launcher));
  const doctor = spawnSync(launcher, ['doctor', '--json'], { env: h.env, encoding: 'utf8', timeout: 120_000, shell: process.platform === 'win32' });
  const report = JSON.parse(doctor.stdout) as { install: { hosts: Array<{ host: string }>; findings: Array<{ code: string }> } };
  assert.deepEqual(report.install.hosts.map(entry => entry.host), ['claude', 'codex', 'gemini', 'cursor']);
  // claude is off PATH here, so the plugin is declared but not installed, and doctor says exactly that.
  assert.deepEqual(report.install.findings.filter(f => f.code !== 'STORE_WORLD_READABLE').map(f => f.code), ['CLAUDE_PLUGIN_PENDING'], JSON.stringify(report.install.findings));

  // Uninstall: every file the person had is back, and nothing of ours is left.
  const removed = cm(h, ['uninstall']);
  assert.equal(removed.status, 0, `${removed.stdout}\n${removed.stderr}`);
  for (const [relative, text] of Object.entries(original)) {
    const file = path.join(h.home, relative);
    if (relative.endsWith('.json')) assert.deepEqual(json(file), JSON.parse(text), relative);
    else assert.equal(readFileSync(file, 'utf8'), text, relative);
  }
  assert.ok(existsSync(theirs), 'their own cm-mine skill survives uninstall');
  assert.equal(existsSync(path.join(h.home, '.codex', 'hooks.json')), false, 'the hooks.json the install created is gone');
  assert.equal(existsSync(path.join(h.home, '.codex', 'cm')), false, 'the Codex gate is gone');
  assert.deepEqual(readdirSync(path.join(h.home, '.agents', 'skills')), ['cm-mine']);
  for (const gone of ['.cursor', '.gemini/GEMINI.md', '.gemini/policies', '.codex/client-mode', '.claude/client-mode', '.client-mode/toolkit']) {
    assert.equal(existsSync(path.join(h.home, gone)), false, `${gone} removed`);
  }
  assert.equal(existsSync(launcher), false);
  assert.deepEqual(readdirSync(h.cmHome).filter(entry => entry.startsWith('install-')), []);
});

test('--no-autonomy leaves every permission setting exactly as it was', () => {
  const h = disposableHome();
  const original = seed(h);
  const installed = cm(h, ['install', '--host', 'claude,codex', '--no-autonomy', '--bin-dir', h.bin]);
  assert.equal(installed.status, 0, installed.stderr);
  assert.equal(json(path.join(h.home, '.claude', 'settings.json')).permissions.defaultMode, 'bypassPermissions');
  assert.equal(readFileSync(path.join(h.home, '.codex', 'config.toml'), 'utf8'), original['.codex/config.toml']);
  // Without autonomy Codex keeps asking before commands, so nothing may run a repo's checks unasked.
  assert.equal(existsSync(path.join(h.home, '.codex', 'hooks.json')), false, 'no Stop hook without autonomy');
  assert.equal(existsSync(path.join(h.home, '.codex', 'cm')), false, 'no Stop gate without autonomy');
  assert.equal(existsSync(path.join(h.home, '.gemini', 'GEMINI.md')), false, 'only the hosts asked for');
  assert.ok(statSync(path.join(h.home, '.agents', 'skills', 'cm-tdd')).isDirectory());
});
