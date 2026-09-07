/** Project onboarding. It reads; it never resets, stashes or cleans a client checkout.
 * Uncommitted and untracked work is inventory, not disposable state.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { inventoryStack, type StackInventory } from './stack-inventory.js';
import { snapshot, type SourceManifest, type SelectOptions } from './snapshot.js';

export class OnboardingError extends Error {
  constructor(public readonly code: string, subject: string) {
    super(`${code}: ${subject}`);
    this.name = 'OnboardingError';
  }
}

export type GitState = {
  available: boolean;
  head: string | null;
  branch: string | null;
  modified_tracked: string[];
  untracked: string[];
  staged: string[];
};

export type Onboarding = {
  project_id: string;
  registered_root_ref: string;
  real_root: string;
  git: GitState;
  inventory: StackInventory;
  manifest: SourceManifest;
};

function git(root: string, args: string[]): string | null {
  try {
    // trimEnd only: porcelain status codes are column-significant and a leading space is data.
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trimEnd();
  } catch {
    return null;
  }
}

/** Read-only Git inspection: rev-parse and status --porcelain, nothing that writes. */
export function readGitState(root: string): GitState {
  const inside = git(root, ['rev-parse', '--is-inside-work-tree']);
  if (inside !== 'true') {
    return { available: false, head: null, branch: null, modified_tracked: [], untracked: [], staged: [] };
  }
  const porcelain = git(root, ['status', '--porcelain=v1', '--untracked-files=all']) ?? '';
  const modified_tracked: string[] = [];
  const untracked: string[] = [];
  const staged: string[] = [];
  for (const line of porcelain.split('\n').filter(entry => entry.length > 0)) {
    const code = line.slice(0, 2);
    const file = line.slice(3).replace(/^"|"$/g, '');
    if (code === '??') { untracked.push(file); continue; }
    if (code[0] !== ' ' && code[0] !== '?') staged.push(file);
    if (code[1] === 'M' || code[1] === 'D') modified_tracked.push(file);
  }
  return {
    available: true,
    head: git(root, ['rev-parse', 'HEAD']),
    branch: git(root, ['rev-parse', '--abbrev-ref', 'HEAD']),
    modified_tracked: modified_tracked.sort(),
    untracked: untracked.sort(),
    staged: staged.sort(),
  };
}

export function onboard(input: {
  project_id: string; authorized_root: string; now?: string;
}, options: SelectOptions = {}): Onboarding {
  const authorized = path.resolve(input.authorized_root);
  if (!existsSync(authorized) || !statSync(authorized).isDirectory()) {
    throw new OnboardingError('UNAUTHORIZED_OR_MISSING_ROOT', authorized);
  }
  const real_root = realpathSync(authorized);
  const registered_root_ref = `file://${real_root}`;
  const git_state = readGitState(real_root);
  const inventory = inventoryStack(real_root, { ...options, ...(input.now === undefined ? {} : { now: input.now }) });
  const manifest = snapshot(real_root, registered_root_ref, options);
  return { project_id: input.project_id, registered_root_ref, real_root, git: git_state, inventory, manifest };
}
