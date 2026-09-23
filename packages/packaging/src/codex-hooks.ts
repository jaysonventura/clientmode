/** The Codex Stop hook `cm install` owns: the project's own checks run when a turn ends.
 *
 * Codex reads lifecycle hooks from `hooks.json` beside `config.toml` and adds them to every other
 * source (learn.chatgpt.com/docs/hooks; `features.hooks` is stable in 0.154.0). The install copies
 * the gate script under `<config_root>/cm/`, adds one `Stop` entry naming it, and records what it
 * found; uninstall removes exactly that entry — and when nothing else in the file changed, puts the
 * original bytes back. Codex asks the person to trust a new hook once, through `/hooks`.
 */
import { isDeepStrictEqual } from 'node:util';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { readJson, writeJson, type Json } from './autonomy.js';

export type CodexHookRecord = {
  hooks_file: string; script: string; command: string; created_file: boolean;
  /** The file as it was before install, so an untouched file goes back byte for byte. */
  original_text?: string | null;
  created_dir?: boolean;
};

const quoted = (file: string): string => `"${file.replace(/"/g, '\\"')}"`;

function entriesFor(root: Record<string, Json>): Json[] {
  const hooks = root['hooks'];
  if (hooks === null || typeof hooks !== 'object' || Array.isArray(hooks)) root['hooks'] = {};
  const table = root['hooks'] as Record<string, Json>;
  if (!Array.isArray(table['Stop'])) table['Stop'] = [];
  return table['Stop'] as Json[];
}

const isOurs = (entry: Json, command: string): boolean => JSON.stringify(entry).includes(JSON.stringify(command).slice(1, -1));

export function installCodexStopHook(input: { config_root: string; gate_source: string; node?: string; platform?: NodeJS.Platform }): { record: CodexHookRecord | null; notes: string[] } {
  const hooks_file = path.join(input.config_root, 'hooks.json');
  const read = readJson(hooks_file);
  if ('error' in read) {
    return { record: null, notes: [`left ${hooks_file} unchanged: it does not parse as plain JSON (${read.error}); the Codex Stop gate was not installed.`] };
  }
  const created_file = !existsSync(hooks_file);
  const original_text = created_file ? null : readFileSync(hooks_file, 'utf8');
  const script = path.join(input.config_root, 'cm', 'stop-gate.mjs');
  const created_dir = !existsSync(path.dirname(script));
  mkdirSync(path.dirname(script), { recursive: true });
  copyFileSync(input.gate_source, script);
  // POSIX: the node that installed it, not whichever node a GUI-launched Codex finds first on PATH.
  // Windows: `node "<script>"`, because two quoted strings in a row break both cmd /c and PowerShell.
  const command = (input.platform ?? process.platform) === 'win32'
    ? `node ${quoted(script)}` : `${quoted(input.node ?? process.execPath)} ${quoted(script)}`;
  const stop = entriesFor(read.value);
  if (!stop.some(entry => isOurs(entry, script))) {
    stop.push({ hooks: [{ type: 'command', command, timeout: 900, statusMessage: 'Client Mode: running the project checks' }] });
  }
  writeJson(hooks_file, read.value);
  return {
    record: { hooks_file, script, command, created_file, original_text, created_dir },
    notes: ['codex: approve the Client Mode Stop hook once with /hooks; Codex runs a new hook only after it is trusted.'],
  };
}

export function removeCodexStopHook(record: CodexHookRecord): void {
  const dir = path.dirname(record.script);
  rmSync(record.script, { force: true });
  rmSync(path.join(dir, 'state'), { recursive: true, force: true });
  if (record.created_dir !== false && existsSync(dir) && readdirSync(dir).length === 0) rmSync(dir, { recursive: true, force: true });

  const read = readJson(record.hooks_file);
  if ('error' in read || !existsSync(record.hooks_file)) return;
  const table = read.value['hooks'];
  if (table === null || typeof table !== 'object' || Array.isArray(table)) return;
  const hooks = table as Record<string, Json>;
  if (Array.isArray(hooks['Stop'])) {
    hooks['Stop'] = hooks['Stop'].filter(entry => !isOurs(entry, record.script));
    if ((hooks['Stop'] as Json[]).length === 0) delete hooks['Stop'];
  }
  if (Object.keys(hooks).length === 0) delete read.value['hooks'];

  if (record.created_file) {
    if (Object.keys(read.value).length === 0) rmSync(record.hooks_file, { force: true });
    else writeJson(record.hooks_file, read.value);
    return;
  }
  // Nothing else changed since install: the person gets their exact bytes back.
  if (record.original_text != null) {
    const original = JSON.parse(record.original_text) as Record<string, Json>;
    const withoutEmpty = (value: Record<string, Json>): Record<string, Json> => {
      const copy = JSON.parse(JSON.stringify(value)) as Record<string, Json>;
      const h = copy['hooks'] as Record<string, Json> | undefined;
      if (h && Array.isArray(h['Stop']) && h['Stop'].length === 0) delete h['Stop'];
      if (h && Object.keys(h).length === 0) delete copy['hooks'];
      return copy;
    };
    if (isDeepStrictEqual(withoutEmpty(original), read.value)) { writeFileSync(record.hooks_file, record.original_text); return; }
  }
  writeJson(record.hooks_file, read.value);
}
