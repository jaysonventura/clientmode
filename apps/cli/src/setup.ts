/** `cm install` / `cm uninstall` across the four hosts.
 *
 * One toolkit is built into `$CM_HOME/toolkit`. It is the `cm` CLI, and it is also the marketplace
 * Claude Code installs the `cm` plugin from. Each host then gets the rules in the file it loads,
 * the skills where it reads them, and — unless `--no-autonomy` — its no-prompt setting.
 *
 * Every change is written to a per-host record before the command returns, and uninstall works
 * from that record alone: it restores the values that were replaced, removes what was created, and
 * leaves anything the person changed since then exactly as they left it.
 */
import { existsSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { applyAutonomy, restoreAutonomy, type AutonomyChange } from '../../../packages/packaging/src/autonomy.js';
import { PLUGIN_ID, registerClaudePlugin, unregisterClaudePlugin, type PluginRegistration, type Runner } from '../../../packages/packaging/src/claude-plugin.js';
import {
  HOSTS, SKILLS_DIRECTORY, activateHost, deactivateHost, hostLayout, migrateLegacyInstructions, restoreLegacyInstructions,
  type HostLayout, type HostName, type MovedSection,
} from '../../../packages/packaging/src/hosts.js';
import type { InstallRecord } from '../../../packages/packaging/src/install.js';
import { findExecutable, writeLauncher } from '../../../packages/packaging/src/platform.js';
import { makePrivateDirectory, PRIVATE_FILE_MODE } from '../../../packages/verifier/src/file-permissions.js';

export type SetupRecord = {
  schema: 2;
  host: HostName;
  version: string;
  installed_at: string;
  layout: HostLayout;
  lead: boolean;
  config_root_created: boolean;
  created: string[];
  autonomy: AutonomyChange[];
  plugin: PluginRegistration | null;
  legacy_sections: MovedSection[];
  launcher: string | null;
  launchers: string[];
  toolkit_root: string | null;
};

export function recordFile(cmHome: string, host: HostName): string {
  return path.join(cmHome, `install-${host}.json`);
}

/** `--host` accepts one host, a comma-separated list, or `all`; no `--host` means all four. */
export function parseHostList(value: string | true | undefined): HostName[] | null {
  if (value === undefined || value === true || value === 'all') return [...HOSTS];
  const names = value.split(',').map(entry => entry.trim()).filter(Boolean);
  if (names.length === 0 || !names.every(name => (HOSTS as readonly string[]).includes(name))) return null;
  return HOSTS.filter(host => names.includes(host));
}

export function readRecord(cmHome: string, host: HostName): SetupRecord | InstallRecord | null {
  const file = recordFile(cmHome, host);
  if (!existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, 'utf8')) as SetupRecord | InstallRecord; } catch { return null; }
}

const isSetupRecord = (record: SetupRecord | InstallRecord): record is SetupRecord => (record as SetupRecord).schema === 2;

/** A relocated host (`--install-root`) is configured in that directory alone, skills included, so
 * a sandboxed install never reaches the real home. */
function layoutFor(host: HostName, input: { home: string; env: NodeJS.ProcessEnv; install_root: string | null }): HostLayout {
  const layout = hostLayout(host, input.home, input.env);
  if (input.install_root === null) return layout;
  return {
    ...layout,
    config_root: input.install_root,
    instructions: path.join(input.install_root, path.relative(layout.config_root, layout.instructions)),
    skills_root: layout.skills_root === null ? null : path.join(input.install_root, 'skills'),
  };
}

function describeHost(layout: HostLayout, autonomy: boolean): string {
  const rules = layout.instructions_kind === 'owned-file' ? `rule file ${layout.instructions}` : `rules in ${layout.instructions}`;
  const skills = layout.skills_root === null ? `skills from plugin ${PLUGIN_ID}` : `skills in ${layout.skills_root}`;
  const permission = !autonomy ? 'permissions unchanged (--no-autonomy)' : {
    claude: 'permissions.defaultMode = "auto"',
    codex: 'approval_policy = "never", sandbox_mode = "danger-full-access"',
    gemini: 'allow-all tool policy (folder trust stays on)',
    cursor: 'CLI approvalMode = "unrestricted" (IDE Run Everything is a UI switch)',
  }[layout.host];
  return `  ${layout.host.padEnd(7)} ${rules}; ${skills}; ${permission}`;
}

export type SetupInput = {
  hosts: HostName[];
  home: string;
  cm_home: string;
  env: NodeJS.ProcessEnv;
  source_root: string;
  bin_dir: string;
  lead: boolean;
  autonomy: boolean;
  portable: boolean;
  install_root: string | null;
  dry_run: boolean;
  version: string;
  now: string;
};

export async function setupHosts(input: SetupInput): Promise<{ lines: string[]; notes: string[]; records: SetupRecord[]; toolkit_error: string | null }> {
  const layouts = input.hosts.map(host => layoutFor(host, input));
  const previous = input.hosts.filter(host => readRecord(input.cm_home, host) !== null);
  const lines: string[] = [];

  if (input.dry_run) {
    lines.push('Client Mode install plan — nothing has been written.', '');
    lines.push(`  toolkit ${path.join(input.cm_home, 'toolkit')}  (the cm CLI, and the marketplace Claude installs ${PLUGIN_ID} from)`);
    lines.push(`  launcher ${path.join(input.bin_dir, process.platform === 'win32' ? 'cm.cmd' : 'cm')}`);
    for (const layout of layouts) lines.push(describeHost(layout, input.autonomy));
    if (previous.length > 0) lines.push(`  previous install for ${previous.join(', ')} is removed first, from its own record`);
    lines.push('', 'Existing content is kept and every replaced value is recorded; `cm uninstall` puts it back.');
    return { lines, notes: [], records: [], toolkit_error: null };
  }

  makePrivateDirectory(input.cm_home);
  const notes: string[] = [];
  // The toolkit is built beside the installed one and swapped in only once it exists, so a build
  // that fails leaves the previous install — or no install — exactly as it was, and no host is ever
  // pointed at a toolkit that is not there.
  let toolkitRoot: string | null = null;
  let launchers: string[] = [];
  const finalToolkit = path.join(input.cm_home, 'toolkit');
  const stagedToolkit = `${finalToolkit}.next`;
  if (input.portable) {
    try {
      const { buildPortableToolkit } = await import('../../../packages/packaging/src/portable.js');
      await buildPortableToolkit({ out_root: stagedToolkit, source_root: input.source_root, launcher_path: null });
    } catch (error) {
      rmSync(stagedToolkit, { recursive: true, force: true });
      const message = String((error as Error).message).slice(0, 300);
      return { lines: [`the cm toolkit could not be built: ${message}`], notes: ['nothing was changed on this machine'], records: [], toolkit_error: message };
    }
  }
  // Reinstalling starts from a clean slate for these hosts, so every "previous value" recorded
  // below is the person's own and never a value an earlier install wrote.
  if (previous.length > 0) notes.push(...uninstallHosts({ hosts: previous, cm_home: input.cm_home, env: input.env, keep_toolkit: true }).notes);
  if (input.portable) {
    rmSync(finalToolkit, { recursive: true, force: true });
    renameSync(stagedToolkit, finalToolkit);
    toolkitRoot = finalToolkit;
    launchers = writeLauncher({ bin_dir: input.bin_dir, toolkit_root: finalToolkit, node: process.execPath });
  }
  const contentRoot = toolkitRoot ?? input.source_root;
  const records: SetupRecord[] = [];

  for (const layout of layouts) {
    const config_root_created = !existsSync(layout.config_root);
    const legacy_sections = migrateLegacyInstructions(layout);
    const activation = activateHost({ layout, source_root: contentRoot, lead: input.lead, skills_source: path.join(contentRoot, SKILLS_DIRECTORY) });
    const autonomy = input.autonomy ? applyAutonomy(layout) : { changes: [], notes: [] };
    const plugin = layout.host !== 'claude' ? null : registerClaudePlugin({
      config_root: layout.config_root, marketplace_dir: contentRoot,
      claude: input.install_root === null ? findExecutable('claude', input.env) : null,
    });
    const record: SetupRecord = {
      schema: 2, host: layout.host, version: input.version, installed_at: input.now, layout, lead: input.lead,
      config_root_created, created: activation.created, autonomy: autonomy.changes, plugin, legacy_sections,
      launcher: launchers[0] ?? null, launchers, toolkit_root: toolkitRoot,
    };
    writeFileSync(recordFile(input.cm_home, layout.host), `${JSON.stringify(record, null, 2)}\n`, { mode: PRIVATE_FILE_MODE });
    records.push(record);
    lines.push(`${activation.summary}${legacy_sections.length > 0 ? '; moved the old claude-dev-team section into the install record' : ''}`);
    if (plugin !== null) lines.push(`claude: plugin ${PLUGIN_ID} ${plugin.method === 'cli' ? 'installed with the claude CLI' : 'declared in settings.json'}`);
    notes.push(...autonomy.notes, ...(plugin?.notes ?? []));
  }

  lines.push(toolkitRoot === null ? `toolkit: not built; cm runs from ${input.source_root}` : `toolkit: ${toolkitRoot}`);
  if (launchers.length > 0) lines.push(`launcher: ${launchers.join(', ')}`);
  return { lines, notes, records, toolkit_error: null };
}

export function uninstallHosts(input: { hosts?: HostName[]; cm_home: string; env: NodeJS.ProcessEnv; keep_toolkit?: boolean; platform?: NodeJS.Platform }):
  { removed: HostName[]; notes: string[] } {
  const installed = HOSTS.filter(host => readRecord(input.cm_home, host) !== null);
  const targets = (input.hosts ?? installed).filter(host => installed.includes(host));
  const notes: string[] = [];
  const launchers = new Set<string>();
  let toolkit: string | null = null;

  for (const host of targets) {
    const record = readRecord(input.cm_home, host)!;
    if (!isSetupRecord(record)) {
      const leftovers = removeLegacyInstall(host, record, input.cm_home);
      for (const launcher of leftovers.launchers) launchers.add(launcher);
      toolkit = leftovers.toolkit ?? toolkit;
      rmSync(recordFile(input.cm_home, host), { force: true });
      continue;
    }
    if (record.plugin !== null) {
      notes.push(...unregisterClaudePlugin({ registration: record.plugin, claude: record.plugin.method === 'cli' ? findExecutable('claude', input.env) : null }).notes);
    }
    const restored = restoreAutonomy(record.autonomy);
    notes.push(...restored.left_alone.map(entry => `left alone: ${entry}`));
    // Skills in a shared directory stay while another installed host still reads them.
    const sharedStillNeeded = installed.some(other => other !== host && !targets.includes(other)
      && (readRecord(input.cm_home, other) as SetupRecord | null)?.layout?.skills_root === record.layout.skills_root);
    deactivateHost({ layout: record.layout, remove_skills: sharedStillNeeded ? false : record.created });
    restoreLegacyInstructions(record.legacy_sections);
    if (record.config_root_created && existsSync(record.layout.config_root) && readdirSync(record.layout.config_root).length === 0) {
      rmSync(record.layout.config_root, { recursive: true, force: true });
    }
    for (const launcher of record.launchers) launchers.add(launcher);
    if (record.toolkit_root !== null) toolkit = record.toolkit_root;
    rmSync(recordFile(input.cm_home, host), { force: true });
  }

  const remaining = HOSTS.filter(host => readRecord(input.cm_home, host) !== null);
  if (remaining.length === 0 && input.keep_toolkit !== true) {
    for (const launcher of launchers) rmSync(launcher, { force: true });
    if (toolkit !== null) rmSync(toolkit, { recursive: true, force: true });
    rmSync(path.join(input.cm_home, 'dist'), { recursive: true, force: true });
    notes.push(...removeBootstrapFootprint(input.cm_home, input.env, input.platform ?? process.platform));
  }
  return { removed: targets, notes };
}

/** An install made by Client Mode 1.x: a copy of the package under `<host>/client-mode/`, a
 * `clientMode` key merged into the host's settings.json, `cm-` skills and a marked section written
 * straight into the host directory, plus the toolkit and launcher.
 *
 * Its own uninstall is not replayed. That record lists the toolkit directory as a file, and it
 * restores settings from a backup taken at install time — which would silently undo every change
 * the person made to their settings since. Only what that install could own is taken back. */
function removeLegacyInstall(host: HostName, record: InstallRecord, cmHome: string): { launchers: string[]; toolkit: string | null } {
  const root = record.plan.install_root;
  rmSync(path.join(root, 'client-mode'), { recursive: true, force: true });
  for (const merge of record.merged) {
    if (!existsSync(merge.target)) continue;
    try {
      const current = JSON.parse(readFileSync(merge.target, 'utf8')) as Record<string, unknown>;
      for (const key of merge.keys) delete current[key];
      if (Object.keys(current).length === 0) rmSync(merge.target, { force: true });
      else writeFileSync(merge.target, `${JSON.stringify(current, null, 2)}\n`);
    } catch { /* a file that no longer parses is not ours to rewrite */ }
  }
  for (const backup of record.backups) rmSync(backup.backup, { force: true });
  deactivateHost({
    layout: { host, config_root: root, instructions: path.join(root, host === 'claude' ? 'CLAUDE.md' : 'AGENTS.md'), instructions_kind: 'block', skills_root: path.join(root, 'skills'), skill_reference: 'cm-' },
    remove_skills: true,
  });
  rmSync(path.join(root, host === 'claude' ? 'CLAUDE.md' : 'AGENTS.md') + '.client-mode-backup', { force: true });
  const toolkitRoot = path.join(cmHome, 'toolkit');
  const launchers = [
    ...(typeof record.launcher === 'string' ? [record.launcher] : []),
    ...record.created.filter(file => /[\\/]cm(\.cmd)?$/.test(file) && !file.startsWith(root)),
  ];
  const toolkit = typeof record.toolkit_root === 'string' ? record.toolkit_root
    : record.created.includes(toolkitRoot) ? toolkitRoot : null;
  return { launchers, toolkit };
}

/** Finish a Claude plugin registration that could only be declared in settings because `claude`
 * was not on PATH at install time. The declaration is taken back and the documented CLI install
 * runs instead; the record is updated either way. */
export function completePendingClaudePlugin(input: { cm_home: string; env: NodeJS.ProcessEnv; claude: string | null; run?: Runner }):
  'installed' | 'nothing-pending' | 'failed' {
  const record = readRecord(input.cm_home, 'claude');
  if (record === null || !isSetupRecord(record) || record.plugin === null || record.plugin.method !== 'settings' || input.claude === null) {
    return 'nothing-pending';
  }
  unregisterClaudePlugin({ registration: record.plugin, claude: null });
  const plugin = registerClaudePlugin({
    config_root: record.layout.config_root, marketplace_dir: record.plugin.marketplace_dir, claude: input.claude,
    ...(input.run === undefined ? {} : { run: input.run }),
  });
  writeFileSync(recordFile(input.cm_home, 'claude'), `${JSON.stringify({ ...record, plugin }, null, 2)}\n`, { mode: PRIVATE_FILE_MODE });
  return plugin.method === 'cli' ? 'installed' : 'failed';
}

/** What the one-line installers leave outside the host directories: the Node they downloaded and
 * the source they built from. Client work under `projects/` is never touched.
 *
 * The PATH line for `~/.local/bin` is deliberately left. The native Claude Code and Codex installers
 * put their own binaries there and skip adding the line when it is already present, so removing
 * ours could break a host in every new terminal. On Windows the running node.exe cannot delete
 * itself, so the runtime is named for the person to remove instead. */
function removeBootstrapFootprint(cmHome: string, _env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  const notes = ['left ~/.local/bin on PATH: other tools (the native Claude Code and Codex installers among them) use it too'];
  rmSync(path.join(cmHome, 'src'), { recursive: true, force: true });
  if (platform === 'win32') {
    if (existsSync(path.join(cmHome, 'runtime'))) notes.push(`remove ${path.join(cmHome, 'runtime')} once this window is closed (Windows cannot delete the running Node)`);
  } else {
    rmSync(path.join(cmHome, 'runtime'), { recursive: true, force: true });
  }
  return notes;
}
