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

test('both rule sets say Client Mode works as a senior AI engineer who uses AI, and that the title grants nothing', () => {
  for (const lead of [true, false]) {
    const text = renderRules({ source_root: ROOT, lead, skill_reference: 'cm-' });
    assert.ok(text.includes('senior AI engineer'), `lead=${String(lead)}`);
    assert.match(text, /uses AI to do the work/, `lead=${String(lead)}`);
  }
});

const words = (text: string): number => text.split(/\s+/).filter(Boolean).length;
const lead = (): string => renderRules({ source_root: ROOT, lead: true, skill_reference: 'cm-' });

test('the lead rules stay within the size they had before the workflow table was added', () => {
  assert.ok(words(lead()) <= 1209, `lead rules are ${String(words(lead()))} words`);
});

test('the lead rules route each kind of work to its workflow and name the host commands', () => {
  const text = lead();
  for (const needle of ['cm-ui-ux', 'cm-debug', 'cm-ai-eval', 'cm-database-change', '/goal', '/plan', '/compact', '/btw', '/side']) {
    assert.ok(text.includes(needle), needle);
  }
});

test('emphasis is rare enough to mean something', () => {
  const bold = lead().match(/\*\*[^*]+\*\*/g) ?? [];
  assert.ok(bold.length <= 3, `${String(bold.length)} bold phrases`);
});

test('rules the lead file must keep through any trim', () => {
  const text = lead();
  for (const rule of ['explicit instruction first', 'a check that never fails measures nothing', 'own runner and language', '`FULL:`',
    'cm-technical-writing', 'cm-gauge-improvements', 'walang delivery fee', 'Titles grant nothing', 'cm handoff']) {
    assert.ok(text.includes(rule), rule);
  }
});

test('the lead rules follow Claude Code best practices on planning and interviews', () => {
  const text = lead();
  // best-practices: plan when the approach is uncertain or several files change; the person approves the plan.
  assert.ok(text.includes('plan mode'), 'T2+ work plans in plan mode');
  assert.ok(!text.includes('approve an\n  implementation plan') && !text.includes('approve an implementation plan'),
    'the person approving a T2+ plan is not something the rules forbid asking');
  // best-practices: interview the person about behaviour and edge cases before a larger feature.
  assert.ok(text.includes('edge cases only they can decide'));
  assert.ok(text.includes('`ultracode`'), 'the ultracode keyword counts as asking for wider fan-out');
});

test('plan approval belongs to the person running the session, never to a client in a controller run', () => {
  assert.ok(lead().includes('the person running the session'), 'lead');
  const other = renderRules({ source_root: ROOT, lead: false, skill_reference: 'cm-' });
  assert.ok(other.includes('A client in a `cm run` is never asked to approve a plan'), 'non-lead');
  assert.ok(read('plugin/skills/orchestration/SKILL.md').includes('A client in a `cm run` is never asked to approve a plan'), 'orchestration');
});
