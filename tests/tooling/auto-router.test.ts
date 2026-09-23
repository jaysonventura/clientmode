/** The router and cost governor follow the lead rules: wider fan-out (an agent team or a workflow)
 * runs only when the person asks, and no wave has more than two child jobs running at once. Out of
 * the box that means assist mode, where the governor asks before convening either engine; the person
 * can opt in to self-running escalation with `cdt-config autonomy auto`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT } from '../harness/evidence.js';

function machine() {
  const home = mkdtempSync(path.join(tmpdir(), 'cm-auto-'));
  mkdirSync(path.join(home, '.claude'), { recursive: true });
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home };
  delete env.CDT_ENV_FILE;
  const run = (script: string, ...args: string[]): string =>
    spawnSync('bash', [path.join(ROOT, 'plugin/hooks', script), ...args], { env, encoding: 'utf8' }).stdout;
  const usage = (weekly: number): void => writeFileSync(path.join(home, '.claude/.cdt-usage.json'),
    JSON.stringify({ weekly, session: 10, ts: Math.floor(Date.now() / 1000) }));
  return { home, run, usage };
}

test('out of the box the governor asks before convening an agent team, even with headroom', () => {
  const m = machine();
  m.usage(20);
  assert.match(m.run('auto.sh', 'status'), /assist/);
  assert.match(m.run('auto.sh', 'gate', 'team'), /^ASK/);
});

test('an agent team runs without asking only after the person opts in to auto', () => {
  const m = machine();
  m.usage(20);
  m.run('config.sh', 'autonomy', 'auto');
  assert.match(m.run('auto.sh', 'gate', 'team'), /^ALLOW/);
});

test('fan-out sizing never recommends more than two child jobs running at once', () => {
  const m = machine();
  m.usage(20);
  for (const tier of ['T2', 'T3']) {
    const out = m.run('auto.sh', 'fanout', tier);
    assert.match(out, /at most 2 running at once/, tier);
    assert.doesNotMatch(out, /parallel agents/, tier);
  }
});

test('reset restores assist, not self-running escalation', () => {
  const m = machine();
  m.run('config.sh', 'autonomy', 'auto');
  m.run('config.sh', 'reset');
  assert.match(readFileSync(path.join(m.home, '.claude/claude-dev-team.env'), 'utf8'), /^CDT_AUTONOMY=assist$/m);
});

test('an unrecognised autonomy value falls back to assist; a spelling of auto gets every auto check', () => {
  const m = machine();
  m.usage(20);
  const gate = (value: string): string => {
    writeFileSync(path.join(m.home, '.claude/claude-dev-team.env'), `CDT_AUTONOMY=${value}\n`);
    return m.run('auto.sh', 'gate', 'team');
  };
  for (const value of ['yes', 'on', 'automatic', 'assist\r']) assert.match(gate(value), /^ASK/, JSON.stringify(value));
  // A spelling of auto is auto, with all of auto's checks: an unknown budget still asks.
  assert.match(gate('Auto\r'), /^ALLOW/);
  rmSync(path.join(m.home, '.claude/.cdt-usage.json'));
  assert.match(gate('Auto\r'), /^ASK/);
});

test('the mode descriptions say assist asks before a team', () => {
  const m = machine();
  assert.doesNotMatch(m.run('auto.sh', 'status'), /auto-teams|auto-summon/);
  assert.doesNotMatch(m.run('config.sh', 'autonomy', 'assist'), /auto-teams|auto-summon/);
});
