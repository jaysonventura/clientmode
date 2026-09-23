/** Client Mode is compared against Claude Code's best-practices page on every change. The check
 * records the page's sections and a hash of its text, notices when the page moves on, and fails
 * when the alignment table leaves a section of the page unaccounted for.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compare, practices, snapshot, uncovered } from '../../scripts/check-best-practices.mjs';

const root = new URL('../../', import.meta.url);
const page = [
  '# Best practices', 'intro',
  '## Give Claude a way to verify its work', 'run the check',
  '## Configure your environment',
  '### Write an effective CLAUDE.md', 'keep it short',
  '### Set up hooks', 'hooks are deterministic',
  '## Develop your intuition', 'notice what works',
  '## Related resources', '- links',
].join('\n');

test('a snapshot records the sections and a hash of the text', () => {
  const s = snapshot(page);
  assert.deepEqual(s.headings, ['Give Claude a way to verify its work', 'Configure your environment',
    'Write an effective CLAUDE.md', 'Set up hooks', 'Develop your intuition', 'Related resources']);
  assert.match(s.sha256, /^[0-9a-f]{64}$/);
});

test('an unchanged page is not drift; a new section or changed wording is', () => {
  const s = snapshot(page);
  assert.deepEqual(compare(s, snapshot(page)), { changed: false, added: [], removed: [] });
  const added = compare(s, snapshot(`${page}\n### Use /goal\ntext`));
  assert.equal(added.changed, true);
  assert.deepEqual(added.added, ['Use /goal']);
  const reworded = compare(s, snapshot(page.replace('keep it short', 'keep it under 200 lines')));
  assert.equal(reworded.changed, true);
  assert.deepEqual(reworded.added, []);
});

test('practices are the leaf sections, without the closing sections', () => {
  assert.deepEqual(practices(snapshot(page)),
    ['Give Claude a way to verify its work', 'Write an effective CLAUDE.md', 'Set up hooks']);
});

test('the alignment table names every practice in the recorded snapshot', () => {
  const recorded = JSON.parse(readFileSync(new URL('docs/best-practices.snapshot.json', root), 'utf8')) as { headings: string[]; levels: number[]; source: string };
  assert.equal(recorded.source, 'https://code.claude.com/docs/en/best-practices');
  const table = readFileSync(new URL('docs/BEST_PRACTICES_ALIGNMENT.md', root), 'utf8');
  assert.deepEqual(uncovered(recorded, table), []);
});

// The user rule (2026-09-23): the best-practices page and the pages it links to always win, so the
// check watches those pages too, and the alignment table's evidence must still exist in the repo.
import { LINKED, changedLinked, citedPaths, missingPaths } from '../../scripts/check-best-practices.mjs';

test('the check watches the linked docs pages Client Mode relies on', () => {
  for (const page of ['hooks', 'sub-agents', 'memory', 'skills', 'permission-modes', 'costs', 'headless', 'mcp']) {
    assert.ok(LINKED.includes(page), page);
  }
  assert.deepEqual(changedLinked({ hooks: 'a', skills: 'b' }, { hooks: 'a', skills: 'c' }), ['skills']);
  assert.deepEqual(changedLinked({ hooks: 'a' }, { hooks: 'a', mcp: 'x' }), ['mcp']);
});

test('every repository file the alignment table cites exists', () => {
  const table = readFileSync(new URL('docs/BEST_PRACTICES_ALIGNMENT.md', root), 'utf8');
  assert.deepEqual(citedPaths('see `plugin/hooks/x.sh` and `a/b.md`, not `cm:tdd` or `/goal`'), ['plugin/hooks/x.sh', 'a/b.md']);
  assert.deepEqual(missingPaths(citedPaths(table), new URL('.', root).pathname), []);
});
