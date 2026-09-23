/** The Codex Stop hook `cm install` owns: the project's own checks run when a turn ends.
 *
 * Codex reads lifecycle hooks from `hooks.json` beside `config.toml` and adds them to every other
 * source (learn.chatgpt.com/docs/hooks; `features.hooks` is stable in 0.154.0). The install copies
 * the gate script under `<config_root>/cm/`, adds one `Stop` entry naming it, and records both;
 * uninstall removes exactly that entry and leaves every other hook where the person put it.
 * Codex asks the person to trust a new hook once, through `/hooks`.
 */
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { readJson, writeJson, type Json } from './autonomy.js';

export type CodexHookRecord = { hooks_file: string; script: string; command: string; created_file: boolean };

const quoted = (file: string): string => `"${file.replace(/"/g, '\\"')}"`;

function entriesFor(root: Record<string, Json>): Json[] {
  const hooks = root['hooks'];
  if (hooks === null || typeof hooks !== 'object' || Array.isArray(hooks)) root['hooks'] = {};
  const table = root['hooks'] as Record<string, Json>;
  if (!Array.isArray(table['Stop'])) table['Stop'] = [];
  return table['Stop'] as Json[];
}

const isOurs = (entry: Json, command: string): boolean => JSON.stringify(entry).includes(JSON.stringify(command).slice(1, -1));

export function installCodexStopHook(input: { config_root: string; gate_source: string }): { record: CodexHookRecord | null; notes: string[] } {
  const hooks_file = path.join(input.config_root, 'hooks.json');
  const read = readJson(hooks_file);
  if ('error' in read) {
    return { record: null, notes: [`left ${hooks_file} unchanged: it does not parse as plain JSON (${read.error}); the Codex Stop gate was not installed.`] };
  }
  const created_file = !existsSync(hooks_file);
  const script = path.join(input.config_root, 'cm', 'stop-gate.mjs');
  mkdirSync(path.dirname(script), { recursive: true });
  copyFileSync(input.gate_source, script);
  const command = `node ${quoted(script)}`;
  const stop = entriesFor(read.value);
  if (!stop.some(entry => isOurs(entry, command))) {
    stop.push({ hooks: [{ type: 'command', command, timeout: 900, statusMessage: 'Client Mode: running the project checks' }] });
  }
  writeJson(hooks_file, read.value);
  return {
    record: { hooks_file, script, command, created_file },
    notes: ['codex: approve the Client Mode Stop hook once with /hooks; Codex runs a new hook only after it is trusted.'],
  };
}

export function removeCodexStopHook(record: CodexHookRecord): void {
  rmSync(path.dirname(record.script), { recursive: true, force: true });
  const read = readJson(record.hooks_file);
  if ('error' in read || !existsSync(record.hooks_file)) return;
  const table = read.value['hooks'];
  if (table === null || typeof table !== 'object' || Array.isArray(table)) return;
  const hooks = table as Record<string, Json>;
  if (Array.isArray(hooks['Stop'])) {
    hooks['Stop'] = hooks['Stop'].filter(entry => !isOurs(entry, record.command));
    if ((hooks['Stop'] as Json[]).length === 0) delete hooks['Stop'];
  }
  if (record.created_file && Object.keys(hooks).length === 0 && Object.keys(read.value).length === 1) {
    rmSync(record.hooks_file, { force: true });
    return;
  }
  writeJson(record.hooks_file, read.value);
}
