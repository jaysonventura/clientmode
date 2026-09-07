/** Uninstall, as an operation rather than a file deletion.
 *
 * Client work is not ours to remove. Evidence under a retention lock is not ours to remove.
 * What we take back are the files we installed and the settings keys we added, and anything we
 * decline to remove is reported with the reason rather than silently skipped.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { uninstall as removeInstalled, type InstallRecord } from './install.js';

export type RetentionRule = { path: string; retain_until: string; reason: string };

export type UninstallReport = {
  removed: string[];
  restored: string[];
  retained: Array<{ path: string; reason: string }>;
  project_work_untouched: string[];
};

/** Project roots and retained evidence are listed, then deliberately not touched. */
export function uninstallToolkit(input: {
  record: InstallRecord;
  project_roots: string[];
  retention: RetentionRule[];
  now: string;
}): UninstallReport {
  const outcome = removeInstalled(input.record);
  const retained = input.retention
    .filter(rule => Date.parse(rule.retain_until) > Date.parse(input.now))
    .map(rule => ({ path: rule.path, reason: `${rule.reason} (retained until ${rule.retain_until})` }));

  const project_work_untouched = input.project_roots.filter(root => existsSync(root)).map(root => {
    const entries = readdirSync(root).filter(entry => statSync(path.join(root, entry)).isFile()).length;
    return `${root} (${entries} file(s) left in place)`;
  });

  return { removed: outcome.removed, restored: outcome.restored, retained, project_work_untouched };
}
