// Normalize a raw user prompt and surface cheap structural facts the hook gate needs.

import { TRIVIAL, hasAny, lc } from '../routing/keywords.js';

export interface Intake {
  raw: string;
  normalized: string;
  isSlashCommand: boolean;
  /** Claude Code delivered a harness event (e.g. a background-task completion), not a person's request. */
  isHarnessEvent: boolean;
  isTrivial: boolean;
  length: number;
}

export function intake(raw: string): Intake {
  const normalized = raw.replace(/\s+/g, ' ').trim();
  return {
    raw,
    normalized,
    isSlashCommand: normalized.startsWith('/'),
    isHarnessEvent: normalized.startsWith('<task-notification>'),
    isTrivial: hasAny(lc(normalized), TRIVIAL),
    length: normalized.length,
  };
}
