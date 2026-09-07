/** Deterministic source snapshots. The manifest, not the traversal, defines identity:
 * entries are sorted and canonically serialized, so two walks in different orders produce
 * the same digest while a single changed byte produces a different one.
 */
import { lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { digest } from '../../contracts/src/canonical.js';

export const MANIFEST_VERSION = 1;

/** Fixed before work starts: generated output and runtime state, never "all untracked files". */
export const DEFAULT_EXCLUDED_DIRECTORIES = [
  '.git', '.hg', '.svn', 'node_modules', '.venv', 'venv', '__pycache__', '.mypy_cache',
  '.pytest_cache', '.gradle', '.idea', 'DerivedData', 'Pods', 'dist', 'build', 'out',
  '.next', '.nuxt', '.turbo', '.terraform', 'bin/Debug', 'obj', '.dart_tool',
] as const;

export const DEFAULT_EXCLUDED_FILES = ['.DS_Store', 'Thumbs.db'] as const;

export type EntryKind = 'file' | 'symlink';

export type ManifestEntry = {
  path: string;
  kind: EntryKind;
  size: number;
  executable: boolean;
  content_digest: string;
  symlink_target?: string;
};

export type SourceManifest = {
  manifest_version: number;
  root_ref: string;
  entry_count: number;
  entries: ManifestEntry[];
  source_digest: string;
};

export class SnapshotError extends Error {
  constructor(public readonly code: string, public readonly subject: string) {
    super(`${code}: ${subject}`);
    this.name = 'SnapshotError';
  }
}

export type SelectOptions = {
  excludedDirectories?: readonly string[];
  excludedFiles?: readonly string[];
  /** Test hook for traversal order. Identity must not depend on it. */
  order?: (names: string[]) => string[];
};

/** Manifest paths are UTF-8, slash separated, relative, with no traversal or NUL. */
function assertSafeRelativePath(relative: string): void {
  if (relative.length === 0) throw new SnapshotError('EMPTY_PATH', relative);
  if (relative.includes('\0')) throw new SnapshotError('NUL_IN_PATH', JSON.stringify(relative));
  if (path.isAbsolute(relative)) throw new SnapshotError('ABSOLUTE_PATH', relative);
  for (const segment of relative.split('/')) {
    if (segment === '' || segment === '.' || segment === '..') throw new SnapshotError('UNSAFE_PATH_SEGMENT', relative);
  }
}

function fileDigest(absolute: string): { digest: string; size: number } {
  const bytes = readFileSync(absolute);
  return { digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`, size: bytes.byteLength };
}

/** Walk the authorized root and refuse anything that would leave it. */
export function selectEntries(root: string, options: SelectOptions = {}): ManifestEntry[] {
  const realRoot = realpathSync(root);
  const excludedDirectories = new Set(options.excludedDirectories ?? DEFAULT_EXCLUDED_DIRECTORIES);
  const excludedFiles = new Set(options.excludedFiles ?? DEFAULT_EXCLUDED_FILES);
  const order = options.order ?? ((names: string[]) => names);
  const entries: ManifestEntry[] = [];
  const seen = new Map<string, string>();

  const walk = (directory: string, prefix: string): void => {
    for (const name of order(readdirSync(directory))) {
      const absolute = path.join(directory, name);
      const relative = prefix === '' ? name : `${prefix}/${name}`;
      const status = lstatSync(absolute);
      if (status.isDirectory()) {
        if (excludedDirectories.has(name)) continue;
        walk(absolute, relative);
        continue;
      }
      if (excludedFiles.has(name)) continue;
      assertSafeRelativePath(relative);
      const collisionKey = relative.normalize('NFC').toLowerCase();
      const previous = seen.get(collisionKey);
      if (previous !== undefined && previous !== relative) throw new SnapshotError('PATH_COLLISION', `${previous} vs ${relative}`);
      seen.set(collisionKey, relative);

      if (status.isSymbolicLink()) {
        const target = readlinkSync(absolute);
        // Compare canonical paths: on macOS /var is itself a symlink to /private/var, so a
        // lexical comparison would report an escape for a link that never leaves the root.
        const lexical = path.resolve(path.dirname(absolute), target);
        let resolved: string;
        try {
          resolved = realpathSync(lexical);
        } catch {
          resolved = lexical; // Dangling link: judge it by where it points, not by what exists.
        }
        if (resolved !== realRoot && !resolved.startsWith(realRoot + path.sep)) {
          throw new SnapshotError('SYMLINK_ESCAPES_ROOT', `${relative} -> ${target}`);
        }
        entries.push({
          path: relative, kind: 'symlink', size: Buffer.byteLength(target), executable: false,
          content_digest: `sha256:${createHash('sha256').update(target, 'utf8').digest('hex')}`,
          symlink_target: target,
        });
        continue;
      }
      if (!status.isFile()) throw new SnapshotError('UNSUPPORTED_FILE_KIND', relative);
      const { digest: content_digest, size } = fileDigest(absolute);
      entries.push({ path: relative, kind: 'file', size, executable: (status.mode & 0o111) !== 0, content_digest });
    }
  };

  walk(realRoot, '');
  return entries;
}

/** Sorting and canonical serialization, not the filesystem, decide the digest. */
export function buildManifest(root_ref: string, entries: ManifestEntry[]): SourceManifest {
  const sorted = [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const manifest = {
    manifest_version: MANIFEST_VERSION, root_ref, entry_count: sorted.length, entries: sorted,
  };
  return { ...manifest, source_digest: digest(manifest) };
}

export function snapshot(root: string, root_ref: string, options: SelectOptions = {}): SourceManifest {
  return buildManifest(root_ref, selectEntries(root, options));
}
