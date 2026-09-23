/** The history-lessons skill mines a repository's own git history for corrections worth learning
 * from: fixes, fixes that needed another fix on the same file, reverts, and tests added with a fix.
 * It only reads. Feature work, merges, lockfile bumps and bulk formatting are not candidates, and
 * the repository — committed history, index and uncommitted changes — is left exactly as found.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT } from '../harness/evidence.js';

const SCRIPT = path.join(ROOT, 'plugin/skills/history-lessons/scripts/mine-history.mjs');

interface Candidate { sha: string; subject: string; kinds: string[]; files: string[]; reverts?: string }
interface Cluster { file: string; shas: string[] }
interface Report {
  head: string; branch: string; dirty: number; sampled: number;
  candidates: Candidate[]; clusters: Cluster[]; skipped: { sha: string; reason: string }[];
}

function git(dir: string, args: string[], day = 1): string {
  const date = `2026-01-${String(day).padStart(2, '0')}T10:00:00Z`;
  const run = spawnSync('git', args, {
    cwd: dir, encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
  });
  assert.equal(run.status, 0, run.stderr);
  return run.stdout.trim();
}

function commit(dir: string, day: number, message: string, files: Record<string, string>): string {
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), text);
  }
  git(dir, ['add', '-A'], day);
  git(dir, ['commit', '-q', '-m', message], day);
  return git(dir, ['rev-parse', 'HEAD'], day);
}

function fixture(): { dir: string; sha: Record<string, string> } {
  const dir = mkdtempSync(path.join(tmpdir(), 'cm-history-'));
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'synthetic@example.test']);
  git(dir, ['config', 'user.name', 'Synthetic']);
  const sha: Record<string, string> = {};
  sha.cart = commit(dir, 1, 'feat: add cart', { 'src/cart.js': 'export const total = xs => xs.length;\n' });
  sha.fixture = commit(dir, 2, 'feat: add fixture loader', { 'src/fixtures.js': 'export const load = () => [];\n' });
  sha.fix1 = commit(dir, 3, 'fix: cart total ignores the discount', {
    'src/cart.js': 'export const total = (xs, d = 0) => xs.length - d;\n',
    'test/cart.test.js': 'test("discount", () => {});\n',
  });
  sha.fix2 = commit(dir, 5, 'Fix cart total rounding', { 'src/cart.js': 'export const total = (xs, d = 0) => Math.round(xs.length - d);\n' });
  sha.settings = commit(dir, 6, 'feat: settings page', { 'src/settings.js': 'export const settings = {};\n' });
  git(dir, ['revert', '--no-edit', 'HEAD'], 7);
  sha.revert = git(dir, ['rev-parse', 'HEAD']);
  const many: Record<string, string> = {};
  for (let i = 0; i < 30; i += 1) many[`src/gen/f${String(i)}.js`] = `export const v${String(i)} = ${String(i)};\n`;
  sha.format = commit(dir, 8, 'chore: format everything with prettier', many);
  sha.lock = commit(dir, 9, 'fix: bump lodash', { 'package-lock.json': '{"lockfileVersion":3}\n' });
  git(dir, ['checkout', '-q', '-b', 'side'], 10);
  sha.side = commit(dir, 10, 'feat: side branch work', { 'src/side.js': 'export const side = 1;\n' });
  git(dir, ['checkout', '-q', 'main'], 11);
  git(dir, ['merge', '-q', '--no-ff', '-m', 'Merge branch side (fix conflicts)', 'side'], 11);
  sha.merge = git(dir, ['rev-parse', 'HEAD']);
  writeFileSync(path.join(dir, 'src/cart.js'), 'uncommitted work in progress\n');
  return { dir, sha };
}

function snapshotGitDir(dir: string): string {
  const seen: string[] = [];
  const walk = (at: string): void => {
    for (const name of readdirSync(at).sort()) {
      const full = path.join(at, name);
      const s = statSync(full);
      if (s.isDirectory()) walk(full);
      else seen.push(`${path.relative(dir, full)} ${String(s.size)} ${String(s.mtimeMs)}`);
    }
  };
  walk(path.join(dir, '.git'));
  return seen.join('\n');
}

function mine(dir: string, ...extra: string[]): Report {
  const run = spawnSync(process.execPath, [SCRIPT, '--repo', dir, ...extra], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout) as Report;
}

test('fixes, repeat fixes on one file, reverts and tests-with-fix are candidates; features are not', () => {
  const { dir, sha } = fixture();
  const report = mine(dir);
  const bySha = new Map(report.candidates.map(c => [c.sha, c]));

  assert.deepEqual(bySha.get(sha.fix1!)?.kinds.sort(), ['fix', 'repeat-fix', 'test-with-fix']);
  assert.deepEqual(bySha.get(sha.fix2!)?.kinds.sort(), ['fix', 'repeat-fix']);
  assert.deepEqual(bySha.get(sha.revert!)?.kinds, ['revert']);
  assert.equal(bySha.get(sha.revert!)?.reverts, sha.settings);
  for (const feature of [sha.cart, sha.fixture, sha.settings, sha.side]) assert.equal(bySha.has(feature!), false);
  assert.deepEqual(report.clusters, [{ file: 'src/cart.js', shas: [sha.fix2, sha.fix1] }]);
});

test('merges are not sampled; lockfile-only and bulk formatting commits are skipped with a reason', () => {
  const { dir, sha } = fixture();
  const report = mine(dir);
  assert.equal(report.candidates.some(c => c.sha === sha.merge), false);
  assert.equal(report.skipped.some(s => s.sha === sha.merge), false);
  const reasons = new Map(report.skipped.map(s => [s.sha, s.reason]));
  assert.equal(reasons.get(sha.lock!), 'dependency or lockfile only');
  assert.equal(reasons.get(sha.format!), 'bulk change');
  assert.equal(report.sampled, 9);
  assert.equal(report.head, sha.merge);
  assert.equal(report.branch, 'main');
  assert.equal(report.dirty, 1);
});

test('--limit bounds the sample and --pick bounds the candidates', () => {
  const { dir } = fixture();
  assert.equal(mine(dir, '--limit', '3').sampled, 3);
  assert.equal(mine(dir, '--pick', '1').candidates.length, 1);
});

test('the repository is left exactly as it was found', () => {
  const { dir } = fixture();
  const status = git(dir, ['status', '--porcelain']);
  const before = snapshotGitDir(dir);
  mine(dir);
  assert.equal(snapshotGitDir(dir), before);
  assert.equal(git(dir, ['status', '--porcelain']), status);
  assert.equal(readFileSync(path.join(dir, 'src/cart.js'), 'utf8'), 'uncommitted work in progress\n');
});

test('a path that is not a git repository is refused with exit 2 and no output', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cm-history-none-'));
  const run = spawnSync(process.execPath, [SCRIPT, '--repo', dir], { encoding: 'utf8' });
  assert.equal(run.status, 2);
  assert.equal(run.stdout, '');
});
