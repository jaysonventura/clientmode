/** Installing and removing a distribution.
 *
 * Installation is a diff first and an action second. The plan lists every file that would be
 * created, replaced or merged, and nothing is written until the plan is approved. Files the
 * installer did not create are never deleted, and a settings file is merged key by key with a
 * backup rather than replaced.
 *
 * Uninstall restores exactly what installation changed. An unrelated key someone added in the
 * meantime is left alone, because it was never ours.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Distribution } from './build.js';

export class InstallError extends Error {
  constructor(public readonly code: string, subject = '') {
    super(subject === '' ? code : `${code}: ${subject}`);
    this.name = 'InstallError';
  }
}

export type PlannedChange =
  | { action: 'create'; target: string; bytes: number }
  | { action: 'replace'; target: string; bytes: number; existing_digest: string; backup: string }
  | { action: 'merge'; target: string; adds_keys: string[]; preserves_keys: string[]; backup: string };

export type InstallPlan = {
  distribution: string;
  provider: Distribution['provider'];
  install_root: string;
  changes: PlannedChange[];
  /** Nothing outside these paths is touched, now or at uninstall. */
  owned_paths: string[];
  approved: boolean;
};

export type InstallRecord = {
  plan: InstallPlan;
  applied_at: string;
  backups: Array<{ target: string; backup: string }>;
  created: string[];
  merged: Array<{ target: string; keys: string[] }>;
  /** Where this install actually put the launcher and the toolkit. Recorded because `doctor`
   * has no other way to know: `--bin-dir` moves the launcher, and a health check that inspects
   * the default path instead reports on a file this install never wrote. */
  launcher?: string | null;
  toolkit_root?: string | null;
};

const SETTINGS_FILE = 'settings.json';
const OWNED_SETTINGS_KEYS = ['clientMode'];

function digestOfFile(file: string): string {
  return `sha256:${createHash('sha256').update(readFileSync(file)).digest('hex')}`;
}

function walk(root: string, prefix = ''): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(root).sort()) {
    const absolute = path.join(root, entry);
    const relative = prefix === '' ? entry : `${prefix}/${entry}`;
    if (statSync(absolute).isDirectory()) found.push(...walk(absolute, relative));
    else found.push(relative);
  }
  return found;
}

/** The dry run. It writes nothing and returns exactly what applying would do. */
export function planInstall(input: { distribution: Distribution; install_root: string }): InstallPlan {
  const changes: PlannedChange[] = [];
  const owned_paths: string[] = [];
  const packageRoot = path.join(input.install_root, 'client-mode');

  for (const file of walk(input.distribution.root)) {
    const target = path.join(packageRoot, file);
    owned_paths.push(target);
    if (existsSync(target)) {
      changes.push({ action: 'replace', target, bytes: file.length, existing_digest: digestOfFile(target), backup: `${target}.backup` });
    } else {
      changes.push({ action: 'create', target, bytes: statSync(path.join(input.distribution.root, file)).size });
    }
  }

  // The host's settings file is merged, never replaced: it belongs to the user.
  const settings = path.join(input.install_root, SETTINGS_FILE);
  const existing = existsSync(settings) ? JSON.parse(readFileSync(settings, 'utf8')) as Record<string, unknown> : {};
  changes.push({
    action: 'merge', target: settings,
    adds_keys: OWNED_SETTINGS_KEYS,
    preserves_keys: Object.keys(existing).filter(key => !OWNED_SETTINGS_KEYS.includes(key)),
    backup: `${settings}.backup`,
  });

  return {
    distribution: input.distribution.distribution_digest,
    provider: input.distribution.provider,
    install_root: input.install_root,
    changes, owned_paths, approved: false,
  };
}

export function approve(plan: InstallPlan): InstallPlan {
  return { ...plan, approved: true };
}

/** Apply an approved plan. An unapproved plan is refused: the diff is the authorization. */
export function applyInstall(input: { plan: InstallPlan; distribution: Distribution; now: string }): InstallRecord {
  if (!input.plan.approved) throw new InstallError('PLAN_NOT_APPROVED', input.plan.distribution);
  const backups: InstallRecord['backups'] = [];
  const created: string[] = [];
  const merged: InstallRecord['merged'] = [];

  for (const change of input.plan.changes) {
    if (change.action === 'merge') {
      const existing = existsSync(change.target) ? JSON.parse(readFileSync(change.target, 'utf8')) as Record<string, unknown> : {};
      if (existsSync(change.target)) {
        copyFileSync(change.target, change.backup);
        backups.push({ target: change.target, backup: change.backup });
      }
      const next = { ...existing, clientMode: { version: input.distribution.version, provider: input.distribution.provider } };
      mkdirSync(path.dirname(change.target), { recursive: true });
      writeFileSync(change.target, JSON.stringify(next, null, 2) + '\n');
      merged.push({ target: change.target, keys: OWNED_SETTINGS_KEYS });
      continue;
    }
    const relative = path.relative(path.join(input.plan.install_root, 'client-mode'), change.target);
    const source = path.join(input.distribution.root, relative);
    mkdirSync(path.dirname(change.target), { recursive: true });
    if (change.action === 'replace') {
      copyFileSync(change.target, change.backup);
      backups.push({ target: change.target, backup: change.backup });
    }
    copyFileSync(source, change.target);
    created.push(change.target);
  }
  return { plan: input.plan, applied_at: input.now, backups, created, merged };
}

/** Remove what we installed and restore what we changed. Nothing else. */
export function uninstall(record: InstallRecord): { removed: string[]; restored: string[]; left_alone: string[] } {
  const removed: string[] = [];
  const restored: string[] = [];
  const left_alone: string[] = [];

  for (const target of record.created) {
    const backup = record.backups.find(entry => entry.target === target);
    if (backup !== undefined) {
      copyFileSync(backup.backup, target);
      rmSync(backup.backup, { force: true });
      restored.push(target);
      continue;
    }
    rmSync(target, { force: true });
    removed.push(target);
  }

  for (const merge of record.merged) {
    if (!existsSync(merge.target)) continue;
    const current = JSON.parse(readFileSync(merge.target, 'utf8')) as Record<string, unknown>;
    for (const key of merge.keys) delete current[key];
    left_alone.push(...Object.keys(current));
    if (Object.keys(current).length === 0) {
      const backup = record.backups.find(entry => entry.target === merge.target);
      if (backup === undefined) rmSync(merge.target, { force: true });
      else { copyFileSync(backup.backup, merge.target); rmSync(backup.backup, { force: true }); restored.push(merge.target); }
      continue;
    }
    writeFileSync(merge.target, JSON.stringify(current, null, 2) + '\n');
    restored.push(merge.target);
    const backup = record.backups.find(entry => entry.target === merge.target);
    if (backup !== undefined) rmSync(backup.backup, { force: true });
  }

  // Directories we created and that are now empty go too; anything else stays.
  const packageRoot = path.join(record.plan.install_root, 'client-mode');
  if (existsSync(packageRoot) && walk(packageRoot).length === 0) rmSync(packageRoot, { recursive: true, force: true });
  return { removed, restored, left_alone: [...new Set(left_alone)] };
}

/** A fingerprint of everything under a root, for proving that unrelated files did not move. */
export function fingerprintTree(root: string): Record<string, string> {
  if (!existsSync(root)) return {};
  return Object.fromEntries(walk(root).map(file => [file, digestOfFile(path.join(root, file))]));
}
