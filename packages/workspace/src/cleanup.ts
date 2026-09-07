/** Workspace cleanup acts only on temporary workspaces this controller created.
 * A registered client root is never a cleanup target, including after a failed run.
 */
import { realpathSync, rmSync } from 'node:fs';
import path from 'node:path';

export class CleanupError extends Error {
  constructor(public readonly code: string, subject: string) {
    super(`${code}: ${subject}`);
    this.name = 'CleanupError';
  }
}

function contains(parent: string, child: string): boolean {
  return child === parent || child.startsWith(parent + path.sep);
}

/** Remove one owned workspace. Refuses anything outside the controller's workspace root
 * and anything that is, or contains, a registered project root. */
export function disposeWorkspace(input: {
  workspace_root: string; controller_workspace_root: string; registered_roots: string[];
}): { removed: boolean; path: string } {
  const owned = realpathSync(path.resolve(input.controller_workspace_root));
  const target = realpathSync(path.resolve(input.workspace_root));
  if (!contains(owned, target) || target === owned) throw new CleanupError('WORKSPACE_NOT_OWNED', target);
  for (const registered of input.registered_roots) {
    const root = realpathSync(path.resolve(registered.replace(/^file:\/\//, '')));
    if (contains(target, root) || root === target) throw new CleanupError('REGISTERED_ROOT_PROTECTED', root);
  }
  rmSync(target, { recursive: true, force: true });
  return { removed: true, path: target };
}
