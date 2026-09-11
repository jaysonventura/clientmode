/** Registering the `cm` plugin with Claude Code.
 *
 * The installed toolkit is itself a plugin marketplace (`.claude-plugin/marketplace.json` beside
 * `plugin/`), so Claude Code installs from the copy on this machine and needs no network or
 * GitHub access for it. With the `claude` CLI on PATH the documented commands do the work; without
 * it the same registration is declared in the user settings file, which Claude Code reads on its
 * next start.
 *
 * `cdt@claude-dev-team` is the plugin this one replaces. Leaving it enabled would load every agent,
 * command and hook twice, so it is switched off — recorded, and switched back on by uninstall.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { restoreAutonomy, setJsonKeys, type AutonomyChange } from './autonomy.js';
import { existsSync, readFileSync } from 'node:fs';
import { spawnPlan } from './platform.js';

export const MARKETPLACE = 'clientmode';
export const PLUGIN_ID = `cm@${MARKETPLACE}`;
const LEGACY_PLUGIN_ID = 'cdt@claude-dev-team';

export type Runner = (argv: string[]) => { status: number | null; stdout: string; stderr: string };

export type PluginRegistration = {
  method: 'cli' | 'settings';
  settings_file: string;
  settings_changes: AutonomyChange[];
  notes: string[];
};

function defaultRunner(executable: string): Runner {
  return argv => {
    const plan = spawnPlan(executable, argv);
    const result = spawnSync(plan.command, plan.args, { encoding: 'utf8', timeout: 300_000, windowsVerbatimArguments: plan.verbatim });
    return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? String(result.error?.message ?? '') };
  };
}

function legacyEnabled(settingsFile: string): boolean {
  if (!existsSync(settingsFile)) return false;
  try {
    const parsed = JSON.parse(readFileSync(settingsFile, 'utf8')) as { enabledPlugins?: Record<string, unknown> };
    return parsed.enabledPlugins?.[LEGACY_PLUGIN_ID] === true;
  } catch { return false; }
}

export function registerClaudePlugin(input: {
  config_root: string; marketplace_dir: string; claude: string | null; run?: Runner;
}): PluginRegistration {
  const settings_file = path.join(input.config_root, 'settings.json');
  const notes: string[] = [];
  let method: PluginRegistration['method'] = 'settings';

  if (input.claude !== null) {
    const run = input.run ?? defaultRunner(input.claude);
    const steps = [
      ['plugin', 'marketplace', 'add', input.marketplace_dir],
      ['plugin', 'install', PLUGIN_ID, '--scope', 'user'],
    ];
    const failed = steps.map(argv => ({ argv, result: run(argv) })).find(step => step.result.status !== 0);
    if (failed === undefined) method = 'cli';
    else notes.push(`\`claude ${failed.argv.join(' ')}\` failed (${(failed.result.stderr || failed.result.stdout).trim().slice(0, 200)}); declared the plugin in ${settings_file} instead.`);
  } else {
    notes.push(`claude is not on PATH; declared the plugin in ${settings_file} so Claude Code picks it up on its next start.`);
  }

  const entries: Parameters<typeof setJsonKeys>[1] = [];
  if (method === 'settings') {
    entries.push(
      { key_path: ['extraKnownMarketplaces', MARKETPLACE], value: { source: { source: 'directory', path: input.marketplace_dir } } },
      { key_path: ['enabledPlugins', PLUGIN_ID], value: true },
    );
  }
  if (legacyEnabled(settings_file)) entries.push({ key_path: ['enabledPlugins', LEGACY_PLUGIN_ID], value: false });
  const written = entries.length === 0 ? { changes: [], notes: [] } : setJsonKeys(settings_file, entries);
  notes.push(...written.notes);
  return { method, settings_file, settings_changes: written.changes, notes };
}

export function unregisterClaudePlugin(input: { registration: PluginRegistration; claude: string | null; run?: Runner }): { notes: string[] } {
  const notes: string[] = [];
  if (input.registration.method === 'cli' && input.claude !== null) {
    const run = input.run ?? defaultRunner(input.claude);
    for (const argv of [['plugin', 'uninstall', PLUGIN_ID], ['plugin', 'marketplace', 'remove', MARKETPLACE]]) {
      const result = run(argv);
      if (result.status !== 0) notes.push(`\`claude ${argv.join(' ')}\` failed: ${(result.stderr || result.stdout).trim().slice(0, 200)}`);
    }
  } else if (input.registration.method === 'cli') {
    notes.push(`claude is not on PATH; remove the plugin with \`claude plugin uninstall ${PLUGIN_ID}\` when it is.`);
  }
  const restored = restoreAutonomy(input.registration.settings_changes);
  notes.push(...restored.left_alone.map(entry => `left alone: ${entry}`));
  return { notes };
}
