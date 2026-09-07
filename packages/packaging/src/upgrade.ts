/** Upgrades and rollback.
 *
 * An upgrade snapshots the state and configuration first, then migrates, then activates. A
 * failure at any of those points leaves the previous version running on the previous state,
 * because nothing is activated until the migration has committed.
 *
 * Rollback is only offered when it is actually safe. A migration that dropped data is not
 * reversible by restoring a binary, and saying so is more useful than a rollback that silently
 * loses what the new version wrote.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export class UpgradeError extends Error {
  constructor(public readonly code: string, subject = '') {
    super(subject === '' ? code : `${code}: ${subject}`);
    this.name = 'UpgradeError';
  }
}

export type Migration = {
  version: number;
  /** expand/contract where practical: additive first, destructive only after a contract step. */
  kind: 'expand' | 'contract';
  reversible: boolean;
  apply: (statePath: string) => void;
};

export type Snapshot = { taken_at: string; state_backup: string; config_backup: string | null; from_version: string };

export type UpgradeOutcome =
  | { upgraded: true; from: string; to: string; snapshot: Snapshot; applied_migrations: number[] }
  | { upgraded: false; from: string; to: string; snapshot: Snapshot; failed_at: number | null; reason: string; state_restored: boolean };

function digestFile(file: string): string {
  return existsSync(file) ? `sha256:${createHash('sha256').update(readFileSync(file)).digest('hex')}` : 'absent';
}

export function snapshot(input: { state_path: string; config_path: string | null; backup_dir: string; from_version: string; now: string }): Snapshot {
  mkdirSync(input.backup_dir, { recursive: true });
  const state_backup = path.join(input.backup_dir, `state-${input.from_version}.sqlite`);
  copyFileSync(input.state_path, state_backup);
  let config_backup: string | null = null;
  if (input.config_path !== null && existsSync(input.config_path)) {
    config_backup = path.join(input.backup_dir, `config-${input.from_version}.json`);
    copyFileSync(input.config_path, config_backup);
  }
  return { taken_at: input.now, state_backup, config_backup, from_version: input.from_version };
}

/** Snapshot, migrate, then activate. Activation is last so a failure leaves the old version
 * pointing at the old state. */
export function upgrade(input: {
  state_path: string; config_path: string | null; backup_dir: string;
  from_version: string; to_version: string; migrations: Migration[];
  activate: (version: string) => void; now: string;
}): UpgradeOutcome {
  const taken = snapshot({ state_path: input.state_path, config_path: input.config_path, backup_dir: input.backup_dir, from_version: input.from_version, now: input.now });
  const applied: number[] = [];
  const before = digestFile(input.state_path);

  for (const migration of input.migrations) {
    try {
      migration.apply(input.state_path);
      applied.push(migration.version);
    } catch (error) {
      // Restore the snapshot and leave the previous version active.
      copyFileSync(taken.state_backup, input.state_path);
      const restored = digestFile(input.state_path) === before;
      return {
        upgraded: false, from: input.from_version, to: input.to_version, snapshot: taken,
        failed_at: migration.version, state_restored: restored,
        reason: `migration ${migration.version} failed: ${String((error as Error).message).slice(0, 200)}`,
      };
    }
  }
  input.activate(input.to_version);
  return { upgraded: true, from: input.from_version, to: input.to_version, snapshot: taken, applied_migrations: applied };
}

export type RollbackAssessment =
  | { rollback_safe: true; restores_from: string }
  | { rollback_safe: false; reason: 'IRREVERSIBLE_MIGRATION_APPLIED'; irreversible: number[]; guidance: string };

/** Whether restoring the previous binary is actually a rollback, or just a lie about one. */
export function assessRollback(applied: Migration[], snapshotTaken: Snapshot): RollbackAssessment {
  const irreversible = applied.filter(migration => !migration.reversible).map(migration => migration.version);
  if (irreversible.length > 0) {
    return {
      rollback_safe: false, reason: 'IRREVERSIBLE_MIGRATION_APPLIED', irreversible,
      guidance: 'Restore the state snapshot and roll forward, or accept the data written since the migration is lost. A binary rollback alone would leave the schema ahead of the code.',
    };
  }
  return { rollback_safe: true, restores_from: snapshotTaken.state_backup };
}

export function restore(input: { snapshot: Snapshot; state_path: string; config_path: string | null }): { restored: string[] } {
  const restored: string[] = [];
  copyFileSync(input.snapshot.state_backup, input.state_path);
  restored.push(input.state_path);
  if (input.snapshot.config_backup !== null && input.config_path !== null) {
    copyFileSync(input.snapshot.config_backup, input.config_path);
    restored.push(input.config_path);
  }
  return { restored };
}

/** Configuration is merged, so an edit made while the upgrade was running survives it. */
export function mergeConfiguration(input: { config_path: string; owned_keys: string[]; owned_values: Record<string, unknown> }): {
  merged: Record<string, unknown>; preserved_keys: string[]; overwritten_keys: string[];
} {
  const current = existsSync(input.config_path) ? JSON.parse(readFileSync(input.config_path, 'utf8')) as Record<string, unknown> : {};
  const preserved_keys = Object.keys(current).filter(key => !input.owned_keys.includes(key));
  const overwritten_keys = Object.keys(current).filter(key => input.owned_keys.includes(key));
  const merged = { ...current, ...input.owned_values };
  writeFileSync(input.config_path, JSON.stringify(merged, null, 2) + '\n');
  return { merged, preserved_keys, overwritten_keys };
}

export function discardBackups(snapshotTaken: Snapshot): void {
  rmSync(snapshotTaken.state_backup, { force: true });
  if (snapshotTaken.config_backup !== null) rmSync(snapshotTaken.config_backup, { force: true });
}
