/** Where the toolkit's own files are.
 *
 * The controller reads real files at runtime — the domain schema, the storage SQL, the adapter
 * instructions. In a checkout those sit four directories above the module; in a packaged
 * install they sit beside a single bundled file. A fixed `../../../..` is right in exactly one
 * of those two, which is how a tool ends up working only on the machine it was written on.
 *
 * So the root is found rather than assumed: walk up from wherever this code actually is until
 * the marker file appears.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MARKER = path.join('contracts', 'domain.schema.json');

function findRoot(from: string): string {
  let directory = from;
  for (let depth = 0; depth < 12; depth += 1) {
    if (existsSync(path.join(directory, MARKER))) return directory;
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  // Nothing found: report the directory searched from, so the failure names a real path rather
  // than a guess about one.
  return from;
}

let cached: string | null = null;

/** The toolkit root, resolved once. `CM_TOOLKIT_ROOT` overrides it for an unusual layout. */
export function toolkitRoot(): string {
  if (cached !== null) return cached;
  const declared = process.env['CM_TOOLKIT_ROOT'];
  cached = declared !== undefined && declared !== '' && existsSync(path.join(declared, MARKER))
    ? declared
    : findRoot(path.dirname(fileURLToPath(import.meta.url)));
  return cached;
}

export function toolkitFile(...parts: string[]): string {
  return path.join(toolkitRoot(), ...parts);
}
