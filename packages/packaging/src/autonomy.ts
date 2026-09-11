/** Letting each host act without approval prompts, reversibly.
 *
 * Every change is recorded with the value it replaced, so uninstall puts back what the person had.
 * A value they changed after the install is theirs and is left alone. A settings file that does
 * not parse is never rewritten: a file with comments in it is someone's, and guessing at it is how
 * a machine ends up with a host that will not start.
 *
 * What each host documents (checked 2026-09-11):
 * - Claude Code: `permissions.defaultMode: "auto"` in the user settings file.
 * - Codex: `approval_policy = "never"` with `sandbox_mode = "danger-full-access"`, and
 *   `[notice] hide_full_access_warning = true` for the one-time warning.
 * - Gemini CLI: YOLO cannot be set in settings.json; a user policy that allows every tool is the
 *   file-based equivalent, and folder trust would otherwise prompt in every new folder.
 * - Cursor: the CLI reads `approvalMode: "unrestricted"`; the IDE's Run Everything is UI-only.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { HostLayout } from './hosts.js';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export type AutonomyChange =
  | { kind: 'json'; file: string; key_path: string[]; wrote: Json; previous?: Json; created_file: boolean }
  | { kind: 'toml'; file: string; table: string | null; key: string; wrote: string; previous: string | null; created_file: boolean }
  | { kind: 'file'; file: string; digest: string };

export type AutonomyOutcome = { changes: AutonomyChange[]; notes: string[] };

const digest = (text: string): string => `sha256:${createHash('sha256').update(text).digest('hex')}`;

function readJson(file: string): { value: Record<string, Json> } | { error: string } {
  if (!existsSync(file)) return { value: {} };
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { error: 'not a JSON object' };
    return { value: parsed as Record<string, Json> };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

function writeJson(file: string, value: Record<string, Json>): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function getPath(root: Record<string, Json>, keys: string[]): Json | undefined {
  let node: Json | undefined = root;
  for (const key of keys) {
    if (node === null || typeof node !== 'object' || Array.isArray(node)) return undefined;
    node = (node as Record<string, Json>)[key];
  }
  return node;
}

function setPath(root: Record<string, Json>, keys: string[], value: Json): void {
  let node = root;
  for (const key of keys.slice(0, -1)) {
    const next = node[key];
    if (next === null || typeof next !== 'object' || Array.isArray(next)) node[key] = {};
    node = node[key] as Record<string, Json>;
  }
  node[keys[keys.length - 1]!] = value;
}

/** Remove a key, and any parent objects that removing it left empty. */
function deletePath(root: Record<string, Json>, keys: string[]): void {
  const parents: Array<Record<string, Json>> = [root];
  let node = root;
  for (const key of keys.slice(0, -1)) {
    const next = node[key];
    if (next === null || typeof next !== 'object' || Array.isArray(next)) return;
    node = next as Record<string, Json>;
    parents.push(node);
  }
  delete node[keys[keys.length - 1]!];
  for (let depth = keys.length - 2; depth >= 0; depth -= 1) {
    const child = parents[depth + 1]!;
    if (Object.keys(child).length > 0) break;
    delete parents[depth]![keys[depth]!];
  }
}

/** Set JSON keys in one file. Returns the recorded changes, or a note when the file is not ours
 * to parse. */
export function setJsonKeys(file: string, entries: Array<{ key_path: string[]; value: Json }>): AutonomyOutcome {
  const read = readJson(file);
  if ('error' in read) {
    return { changes: [], notes: [`left ${file} unchanged: it does not parse as plain JSON (${read.error}). Set ${entries.map(e => e.key_path.join('.')).join(', ')} there yourself.`] };
  }
  const created_file = !existsSync(file);
  const changes: AutonomyChange[] = [];
  for (const entry of entries) {
    const previous = getPath(read.value, entry.key_path);
    setPath(read.value, entry.key_path, entry.value);
    changes.push({ kind: 'json', file, key_path: entry.key_path, wrote: entry.value, ...(previous === undefined ? {} : { previous }), created_file });
  }
  writeJson(file, read.value);
  return { changes, notes: [] };
}

const TABLE_HEADER = /^\s*\[/;
const keyLine = (key: string): RegExp => new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=`);

/** Set one key in a TOML document without parsing the rest of it: a top-level key goes before the
 * first table header, a table key goes inside that table (which is appended if absent). Returns the
 * line it replaced, so the exact text can be put back. */
export function setTomlKey(text: string, table: string | null, key: string, literal: string): { text: string; previous: string | null } {
  const lines = text === '' ? [] : text.replace(/\n$/, '').split('\n');
  const line = `${key} = ${literal}`;
  let start = 0;
  let end = lines.findIndex(entry => TABLE_HEADER.test(entry));
  if (table !== null) {
    const header = lines.findIndex(entry => entry.trim() === `[${table}]`);
    if (header === -1) {
      const body = lines.length === 0 ? [] : [...lines, ''];
      return { text: `${[...body, `[${table}]`, line].join('\n')}\n`, previous: null };
    }
    start = header + 1;
    end = lines.findIndex((entry, index) => index >= start && TABLE_HEADER.test(entry));
  }
  if (end === -1) end = lines.length;
  const existing = lines.findIndex((entry, index) => index >= start && index < end && keyLine(key).test(entry));
  if (existing !== -1) {
    const previous = lines[existing]!;
    lines[existing] = line;
    return { text: `${lines.join('\n')}\n`, previous };
  }
  if (table === null) {
    // After the last top-level key, so a leading comment block stays at the top.
    let insertAt = 0;
    for (let index = 0; index < end; index += 1) if (/^\s*[A-Za-z0-9_-]+\s*=/.test(lines[index]!)) insertAt = index + 1;
    lines.splice(insertAt, 0, line);
  } else {
    lines.splice(start, 0, line);
  }
  return { text: `${lines.join('\n')}\n`, previous: null };
}

/** Undo `setTomlKey`: only if the line is still exactly what we wrote. */
function unsetTomlKey(text: string, change: Extract<AutonomyChange, { kind: 'toml' }>): { text: string; restored: boolean } {
  const lines = text.replace(/\n$/, '').split('\n');
  const ours = `${change.key} = ${change.wrote}`;
  let start = 0;
  let end = lines.findIndex(entry => TABLE_HEADER.test(entry));
  if (change.table !== null) {
    const header = lines.findIndex(entry => entry.trim() === `[${change.table}]`);
    if (header === -1) return { text, restored: false };
    start = header + 1;
    end = lines.findIndex((entry, index) => index >= start && TABLE_HEADER.test(entry));
  }
  if (end === -1) end = lines.length;
  const index = lines.findIndex((entry, at) => at >= start && at < end && entry === ours);
  if (index === -1) return { text, restored: false };
  if (change.previous !== null) lines[index] = change.previous;
  else lines.splice(index, 1);
  if (change.table !== null && change.previous === null) {
    // A table we appended and that is now empty goes too, with the blank line before it.
    const header = lines.findIndex(entry => entry.trim() === `[${change.table}]`);
    const next = lines.findIndex((entry, at) => at > header && TABLE_HEADER.test(entry));
    const body = lines.slice(header + 1, next === -1 ? lines.length : next).filter(entry => entry.trim() !== '');
    if (header !== -1 && body.length === 0) {
      const from = header > 0 && lines[header - 1]!.trim() === '' ? header - 1 : header;
      lines.splice(from, (next === -1 ? lines.length : next) - from);
    }
  }
  return { text: lines.length === 0 ? '' : `${lines.join('\n')}\n`, restored: true };
}

function setTomlKeys(file: string, entries: Array<{ table: string | null; key: string; literal: string }>): AutonomyOutcome {
  const created_file = !existsSync(file);
  let text = created_file ? '' : readFileSync(file, 'utf8');
  const changes: AutonomyChange[] = [];
  for (const entry of entries) {
    const next = setTomlKey(text, entry.table, entry.key, entry.literal);
    text = next.text;
    changes.push({ kind: 'toml', file, table: entry.table, key: entry.key, wrote: entry.literal, previous: next.previous, created_file });
  }
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
  return { changes, notes: [] };
}

const GEMINI_POLICY = `# Client Mode: allow every tool without a prompt. Installed by cm install; cm uninstall removes it.
# The rules still apply: money, data leaving the project and irreversible actions are asked about
# in the conversation first.
[[rule]]
toolName = "*"
decision = "allow"
priority = 900
`;

function writeOwnedFile(file: string, text: string): AutonomyOutcome {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
  return { changes: [{ kind: 'file', file, digest: digest(text) }], notes: [] };
}

const merge = (...outcomes: AutonomyOutcome[]): AutonomyOutcome =>
  ({ changes: outcomes.flatMap(o => o.changes), notes: outcomes.flatMap(o => o.notes) });

export function applyAutonomy(layout: HostLayout): AutonomyOutcome {
  const root = layout.config_root;
  switch (layout.host) {
    case 'claude': {
      const outcome = setJsonKeys(path.join(root, 'settings.json'), [
        { key_path: ['permissions', 'defaultMode'], value: 'auto' },
        // The one-time notice for entering auto mode from a setting rather than the built-in default.
        { key_path: ['skipAutoPermissionPrompt'], value: true },
      ]);
      outcome.notes.push('Claude Code: auto mode needs a Pro, Max or Team plan (or a supported cloud provider and model); where it is unavailable Claude starts in Manual mode.');
      return outcome;
    }
    case 'codex': {
      const outcome = setTomlKeys(path.join(root, 'config.toml'), [
        { table: null, key: 'approval_policy', literal: '"never"' },
        { table: null, key: 'sandbox_mode', literal: '"danger-full-access"' },
        { table: 'notice', key: 'hide_full_access_warning', literal: 'true' },
      ]);
      outcome.notes.push('Codex: still asks once whether to trust each new project folder; that screen has no global setting.');
      return outcome;
    }
    case 'gemini': {
      const outcome = merge(
        writeOwnedFile(path.join(root, 'policies', 'client-mode.toml'), GEMINI_POLICY),
        setJsonKeys(path.join(root, 'settings.json'), [{ key_path: ['security', 'folderTrust', 'enabled'], value: false }]),
      );
      outcome.notes.push('Gemini CLI: every tool is allowed by a user policy; `gemini --yolo` is the flag form if a managed setting overrides it.');
      return outcome;
    }
    case 'cursor': {
      const file = path.join(root, 'cli-config.json');
      const required = existsSync(file) ? [] : [
        { key_path: ['version'], value: 1 },
        { key_path: ['editor', 'vimMode'], value: false },
        { key_path: ['permissions', 'allow'], value: [] },
        { key_path: ['permissions', 'deny'], value: [] },
      ];
      const outcome = setJsonKeys(file, [...required, { key_path: ['approvalMode'], value: 'unrestricted' }]);
      outcome.notes.push('Cursor IDE: turn on Settings → Agents → Approvals & Execution → Run Everything yourself; it has no settings file. The Cursor CLI is set.');
      return outcome;
    }
  }
}

/** Put back what was replaced. Changes are undone in reverse, so a file we created is removed only
 * once every key we added to it is gone and nothing else was added in the meantime. */
export function restoreAutonomy(changes: AutonomyChange[]): { restored: string[]; left_alone: string[] } {
  const restored: string[] = [];
  const left_alone: string[] = [];
  for (const change of [...changes].reverse()) {
    if (!existsSync(change.file)) continue;
    if (change.kind === 'file') {
      if (digest(readFileSync(change.file, 'utf8')) === change.digest) {
        rmSync(change.file, { force: true });
        restored.push(change.file);
        const parent = path.dirname(change.file);
        if (readdirSync(parent).length === 0) rmSync(parent, { recursive: true, force: true });
      } else {
        left_alone.push(`${change.file} (edited since install)`);
      }
      continue;
    }
    if (change.kind === 'toml') {
      const next = unsetTomlKey(readFileSync(change.file, 'utf8'), change);
      if (!next.restored) { left_alone.push(`${change.file}: ${change.table === null ? '' : `${change.table}.`}${change.key} (changed since install)`); continue; }
      if (change.created_file && next.text.trim() === '') rmSync(change.file, { force: true });
      else writeFileSync(change.file, next.text);
      restored.push(`${change.file}: ${change.key}`);
      continue;
    }
    const read = readJson(change.file);
    const label = `${change.file}: ${change.key_path.join('.')}`;
    if ('error' in read) { left_alone.push(`${label} (file no longer parses)`); continue; }
    const current = getPath(read.value, change.key_path);
    if (JSON.stringify(current) !== JSON.stringify(change.wrote)) { left_alone.push(`${label} (changed since install)`); continue; }
    if (change.previous === undefined) deletePath(read.value, change.key_path);
    else setPath(read.value, change.key_path, change.previous);
    if (change.created_file && Object.keys(read.value).length === 0) rmSync(change.file, { force: true });
    else writeJson(change.file, read.value);
    restored.push(label);
  }
  return { restored, left_alone };
}
