/** What the filesystem lets other people read.
 *
 * The signing key was created at 0600 and everything beside it was not. The protected policy
 * store, the approval store and the controller state were all created world-readable, which
 * means the record of who approved which deployment, and every client request, was open to any
 * other account on the machine.
 *
 * Directory mode matters as much as file mode: a 0700 directory keeps a stray world-readable
 * file inside it out of reach, and a 0755 directory undoes a careful 0600 the moment SQLite
 * creates a `-wal` sidecar behind you.
 */
import { chmodSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/** Owner only. These hold signing material, approvals and client content. */
export const PRIVATE_DIRECTORY_MODE = 0o700;
export const PRIVATE_FILE_MODE = 0o600;

export type PermissionFinding = { path: string; kind: 'file' | 'directory'; mode: string; expected: string };

/** Create a directory that was never briefly world-readable. `mkdirSync`'s mode is masked by
 * the umask, so it is set explicitly afterwards rather than trusted. */
/** `mkdirSync` applies `mode` to every directory it creates on the way down, so a fresh
 * `$CM_HOME/projects/<id>` is owner-only the whole way and not just at the leaf. The chmod is
 * for the other case: a directory that was already there, created at the process umask by an
 * earlier version or restored from a backup. */
export function makePrivateDirectory(directory: string): void {
  mkdirSync(directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  chmodSync(directory, PRIVATE_DIRECTORY_MODE);
}

/** Tighten a store and everything in it, including the sidecar files SQLite creates on its own
 * schedule. Called after every open, because `-wal` and `-shm` appear when the first write does,
 * not when the database is created. */
export function secureStore(directory: string): void {
  if (!existsSync(directory)) return;
  chmodSync(directory, PRIVATE_DIRECTORY_MODE);
  for (const entry of readdirSync(directory)) {
    const full = path.join(directory, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) secureStore(full);
    else chmodSync(full, PRIVATE_FILE_MODE);
  }
}

const octal = (mode: number): string => `0${(mode & 0o777).toString(8)}`;

/** Anything another account on this machine can actually reach and read.
 *
 * Reachability, not mode in isolation: a 0644 file inside a 0700 directory is not readable by
 * anyone else, and a 0600 file inside a 0755 directory becomes readable the moment its mode
 * slips. `secureStore` still forces 0600 on the store files themselves, so the two work
 * together — the directory keeps other accounts out, and the file mode survives the directory
 * being loosened later or the file being copied somewhere else. */
export function auditPermissions(roots: readonly string[]): PermissionFinding[] {
  const findings: PermissionFinding[] = [];
  const walk = (target: string): void => {
    if (!existsSync(target)) return;
    const stats = statSync(target);
    const mode = stats.mode & 0o777;
    if (stats.isDirectory()) {
      // A directory no other account can traverse hides everything below it whatever those
      // files are set to. Reporting them anyway turns a security check into noise nobody
      // reads, so the walk stops here and names the one path that has to change.
      // eslint-disable-next-line no-bitwise
      if ((mode & 0o077) === 0) return;
      findings.push({ path: target, kind: 'directory', mode: octal(mode), expected: octal(PRIVATE_DIRECTORY_MODE) });
      for (const entry of readdirSync(target)) walk(path.join(target, entry));
      return;
    }
    // eslint-disable-next-line no-bitwise
    if ((mode & 0o077) !== 0) findings.push({ path: target, kind: 'file', mode: octal(mode), expected: octal(PRIVATE_FILE_MODE) });
  };
  for (const root of roots) walk(root);
  return findings;
}
