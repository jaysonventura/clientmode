/** Write ownership. Two writers in one project are refused by the database index, and two
 * writers over overlapping paths are refused here. Shared files always have one owner.
 */
import { acquire, type Lease } from '../../state/src/leases.js';
import type { ControllerDatabase } from '../../state/src/database.js';

/** Files that coordinate the whole project: never split between parallel writers. */
export const SHARED_OWNERSHIP_PATHS = [
  'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'go.sum', 'Cargo.lock',
  'poetry.lock', 'Gemfile.lock', 'composer.lock', 'Package.resolved', 'migrations/', 'db/migrate/',
] as const;

export class OwnershipError extends Error {
  constructor(public readonly code: string, subject: string) {
    super(`${code}: ${subject}`);
    this.name = 'OwnershipError';
  }
}

function normalise(claim: string): string {
  const trimmed = claim.replace(/^\.?\//, '');
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

/** Prefix containment in either direction is an overlap; equal paths are the same claim. */
export function overlaps(a: string, b: string): boolean {
  const left = normalise(a);
  const right = normalise(b);
  return left === right || left.startsWith(right) || right.startsWith(left);
}

export function activeClaims(db: ControllerDatabase, project_id: string): Array<{ attempt_id: string; paths: string[] }> {
  return db.all(`SELECT a.attempt_id AS attempt_id, a.allowed_write_paths_json AS paths
                 FROM workspace_leases l JOIN task_attempts a ON a.attempt_id = l.attempt_id
                 WHERE l.project_id = ? AND l.active = 1 AND l.is_writer = 1`, project_id)
    .map(row => ({ attempt_id: String(row['attempt_id']), paths: JSON.parse(String(row['paths'])) as string[] }));
}

/** A writer lease is granted only when its paths are disjoint from every active writer's. */
export function claimWriteScope(db: ControllerDatabase, request: {
  project_id: string; attempt_id: string; workspace_id: string; owner_id: string;
  paths: string[]; expires_at: string;
}): Lease {
  return db.transaction(() => {
    for (const existing of activeClaims(db, request.project_id)) {
      if (existing.attempt_id === request.attempt_id) continue;
      for (const held of existing.paths) {
        for (const wanted of request.paths) {
          if (overlaps(held, wanted)) {
            throw new OwnershipError('OVERLAPPING_WRITE_CLAIM', `${wanted} conflicts with ${existing.attempt_id}:${held}`);
          }
        }
      }
    }
    return acquire(db, { ...request, is_writer: true });
  });
}

/** A path is writable only if some allowed claim contains it. */
export function isWritable(allowed: string[], target: string): boolean {
  const file = target.replace(/^\.?\//, '');
  return allowed.some(claim => {
    const prefix = normalise(claim);
    return file === prefix.slice(0, -1) || file.startsWith(prefix);
  });
}
