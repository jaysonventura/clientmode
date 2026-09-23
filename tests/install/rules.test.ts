/** The rules every host reads say the same thing about when to stop, and stay short enough to be
 * read: a rule lost in a long file is a rule not followed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderRules } from '../../packages/packaging/src/hosts.js';
import { ROOT } from '../harness/evidence.js';

const STOP = 'The second failed fix for the same failure is the last one';
const read = (file: string): string => readFileSync(path.join(ROOT, file), 'utf8');

test('both rule sets and the debug skill carry the one stop rule', () => {
  for (const lead of [true, false]) {
    assert.ok(renderRules({ source_root: ROOT, lead, skill_reference: 'cm-' }).includes(STOP), `lead=${String(lead)}`);
  }
  assert.ok(read('plugin/skills/debug/SKILL.md').includes(STOP));
  assert.ok(!read('adapters/global/CLIENT_MODE_LEAD.md').includes('Three attempts at the same diagnosis'));
});
