/** Freezing the configuration, and proving the holdout stayed unseen.
 *
 * The order matters and is recorded: the configuration is frozen first, the holdout is opened
 * second. A configuration that could still be changed after the specs were read is a
 * rehearsal, whatever the numbers say afterwards.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { digest } from '../../contracts/src/canonical.js';

export type FrozenConfiguration = {
  configuration_digest: string;
  frozen_at: string;
  arm: string;
  policy_digest: string;
  maximum_repair_cycles: number;
  reviewer: string;
  prompt_sources: string[];
};

export function freezeConfiguration(input: Omit<FrozenConfiguration, 'configuration_digest'>): FrozenConfiguration {
  return { ...input, configuration_digest: digest(input) };
}

export type LeakScan = {
  scanned_files: number;
  roots: string[];
  hits: Array<{ file: string; token: string }>;
};

const SKIP = new Set(['node_modules', '.git', '.venv', 'dist', '__pycache__', '.mypy_cache', 'qa']);

function walk(root: string, out: string[]): void {
  let entries: string[];
  try { entries = readdirSync(root); } catch { return; }
  for (const entry of entries) {
    if (SKIP.has(entry)) continue;
    const full = path.join(root, entry);
    let stats;
    try { stats = statSync(full); } catch { continue; }
    if (stats.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|mjs|md|json|txt|py|swift|rs|yml|yaml)$/.test(entry)) out.push(full);
  }
}

/** Scans the toolkit's prompts, skills, adapters and source for anything that would mean the
 * holdout was available while the configuration was being tuned. The holdout module itself
 * and the gate that runs it are excluded by path: they are where the specs are allowed to be. */
export function scanForLeaks(input: { roots: string[]; tokens: string[]; allowed_paths: string[] }): LeakScan {
  const files: string[] = [];
  for (const root of input.roots) walk(root, files);
  const candidates = files.filter(file => !input.allowed_paths.some(allowed => file.includes(allowed)));
  const tokens = [...new Set(input.tokens)].filter(token => token.length >= 9);
  const hits: Array<{ file: string; token: string }> = [];
  for (const file of candidates) {
    let content: string;
    try { content = readFileSync(file, 'utf8'); } catch { continue; }
    for (const token of tokens) if (content.includes(token)) hits.push({ file, token });
  }
  return { scanned_files: candidates.length, roots: input.roots, hits };
}
