#!/usr/bin/env node
// Has Claude Code's best-practices page changed since docs/BEST_PRACTICES_ALIGNMENT.md was checked?
//   node scripts/check-best-practices.mjs            fetch the page and compare with the snapshot
//   node scripts/check-best-practices.mjs --file X   compare a saved copy instead (offline)
//   node scripts/check-best-practices.mjs --update   record the current page as the new snapshot
// Exit 0: same page. Exit 1: the page changed — re-read it and update the alignment table.
// Exit 2: the page could not be read, which is a gap, not a pass.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SOURCE = 'https://code.claude.com/docs/en/best-practices';
const SNAPSHOT = new URL('../docs/best-practices.snapshot.json', import.meta.url);
const CLOSING = new Set(['Develop your intuition', 'Related resources']);

export function snapshot(markdown) {
  const found = [...markdown.matchAll(/^(#{2,3}) (.+?)\s*$/gm)];
  const text = markdown.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim();
  return {
    headings: found.map(m => m[2]),
    levels: found.map(m => m[1].length),
    sha256: createHash('sha256').update(text).digest('hex'),
  };
}

export function compare(before, after) {
  return {
    changed: before.sha256 !== after.sha256,
    added: after.headings.filter(h => !before.headings.includes(h)),
    removed: before.headings.filter(h => !after.headings.includes(h)),
  };
}

/** The sections that carry a practice: every heading without subsections, minus the closing ones. */
export function practices({ headings, levels }) {
  return headings.filter((h, i) => !CLOSING.has(h) && !(levels[i] === 2 && levels[i + 1] === 3));
}

/** Practices the alignment table does not name in its first column. */
export function uncovered(recorded, table) {
  const named = new Set([...table.matchAll(/^\| ([^|]+?) \|/gm)].map(m => m[1].trim()));
  return practices(recorded).filter(h => !named.has(h));
}

async function main(argv) {
  const at = argv.indexOf('--file');
  let markdown;
  try {
    if (at !== -1) markdown = readFileSync(argv[at + 1], 'utf8');
    else {
      const response = await fetch(`${SOURCE}.md`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      markdown = await response.text();
    }
  } catch (error) {
    console.error(`check-best-practices: could not read the page (${error.message}). Not checked.`);
    return 2;
  }
  const now = snapshot(markdown);
  if (argv.includes('--update')) {
    writeFileSync(SNAPSHOT, `${JSON.stringify({ source: SOURCE, checked: new Date().toLocaleDateString('en-CA'), ...now }, null, 2)}\n`);
    console.log(`check-best-practices: snapshot updated (${now.headings.length} sections).`);
    return 0;
  }
  const recorded = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
  const diff = compare(recorded, now);
  if (!diff.changed) { console.log(`check-best-practices: unchanged since ${recorded.checked}.`); return 0; }
  console.log(`check-best-practices: the page changed since ${recorded.checked}.`);
  for (const h of diff.added) console.log(`  + ${h}`);
  for (const h of diff.removed) console.log(`  - ${h}`);
  if (!diff.added.length && !diff.removed.length) console.log('  (same sections, different wording)');
  console.log('Re-read the page, update docs/BEST_PRACTICES_ALIGNMENT.md, then run with --update.');
  return 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
