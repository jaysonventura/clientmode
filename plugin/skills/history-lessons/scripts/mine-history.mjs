#!/usr/bin/env node
// List the corrections in a repository's history that are worth reading: the starting points for
// a history-lessons audit, not its findings.
//
//   node mine-history.mjs --repo <path> [--limit 100] [--pick 12] [--window-days 14]
//
// Samples the latest --limit non-merge commits on the current branch and prints JSON:
//   candidates  fixes, reverts, repeat fixes (another fix to the same file within --window-days)
//               and tests added with a fix, highest signal first, at most --pick
//   clusters    files that needed more than one fix inside the window
//   skipped     commits left out, with the reason (lockfile or dependency only, bulk change)
// A subject that says "fix" is a lead, not proof of a defect: read the diff before calling it one.
//
// Read-only: no optional locks, no fsmonitor, no external diff or textconv helpers, and nothing in
// the repository is run. Exit 0: printed. 2: bad arguments or not a git repository (prints nothing).
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FIX = /\b(fix(es|ed)?|bug(fix)?|hotfix|regression|broken|crash(es)?|patch(ed)?|resolves?|wrong|incorrect)\b/i;
const REVERT = /^Revert\b/;
const TEST = /(^|\/)(tests?|__tests__|spec)\/|[._-](test|spec)\.[a-z]+$/i;
const LOCK = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|composer\.lock|Gemfile\.lock|poetry\.lock|Cargo\.lock|go\.sum|Podfile\.lock|pubspec\.lock)$/;
const GENERATED = /(^|\/)(dist|build|vendor|node_modules|coverage|\.next|generated)\//;
const BULK_FILES = 25;
const DAY = 86_400_000;

function parse(argv) {
  const out = { limit: 100, pick: 12, windowDays: 14 };
  const names = { '--repo': 'repo', '--limit': 'limit', '--pick': 'pick', '--window-days': 'windowDays' };
  for (let i = 0; i < argv.length; i += 2) {
    const key = names[argv[i]];
    const value = argv[i + 1];
    if (!key || value === undefined) return null;
    out[key] = key === 'repo' ? value : Number(value);
    if (key !== 'repo' && !(Number.isInteger(out[key]) && out[key] > 0)) return null;
  }
  return out.repo ? out : null;
}

function git(repo, args) {
  const run = spawnSync('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-C', repo, ...args], {
    encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_PAGER: 'cat' },
  });
  return run.status === 0 ? run.stdout : null;
}

function commits(repo, limit) {
  const log = git(repo, ['log', '--no-merges', '--no-ext-diff', '--no-textconv', '--no-renames', `-n${String(limit)}`,
    '--format=%x1e%H%x1f%aI%x1f%s%x1f%b%x1d', '--name-only']);
  if (log === null) return null;
  return log.split('\x1e').filter(Boolean).map(record => {
    const [head, names = ''] = record.split('\x1d');
    const [sha, date, subject, body] = head.split('\x1f');
    return { sha, date, subject, body, files: names.split('\n').map(f => f.trim()).filter(Boolean) };
  });
}

function skipReason(c) {
  if (REVERT.test(c.subject)) return null;
  if (c.files.length > 0 && c.files.every(f => LOCK.test(f) || f.endsWith('package.json') || f.endsWith('composer.json'))
    && c.files.some(f => LOCK.test(f))) return 'dependency or lockfile only';
  if (c.files.length > BULK_FILES) return 'bulk change';
  if (c.files.length > 0 && c.files.every(f => GENERATED.test(f))) return 'generated output only';
  return null;
}

export function mine(repo, { limit = 100, pick = 12, windowDays = 14 } = {}) {
  const head = git(repo, ['rev-parse', 'HEAD']);
  const all = head === null ? null : commits(repo, limit);
  if (all === null) return null;
  const branch = (git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']) ?? '').trim();
  const dirty = (git(repo, ['status', '--porcelain']) ?? '').split('\n').filter(Boolean).length;

  const skipped = [];
  const kept = [];
  for (const c of all) {
    const reason = skipReason(c);
    if (reason) skipped.push({ sha: c.sha, reason }); else kept.push(c);
  }

  const kinds = new Map(kept.map(c => [c.sha, new Set()]));
  for (const c of kept) {
    if (REVERT.test(c.subject)) kinds.get(c.sha).add('revert');
    else if (FIX.test(c.subject)) {
      kinds.get(c.sha).add('fix');
      if (c.files.some(f => TEST.test(f))) kinds.get(c.sha).add('test-with-fix');
    }
  }

  const fixesByFile = new Map();
  for (const c of kept) {
    if (!kinds.get(c.sha).has('fix')) continue;
    for (const f of c.files) {
      if (TEST.test(f) || GENERATED.test(f) || LOCK.test(f)) continue;
      if (!fixesByFile.has(f)) fixesByFile.set(f, []);
      fixesByFile.get(f).push(c);
    }
  }
  const clusters = [];
  for (const [file, fixes] of fixesByFile) {
    const near = fixes.filter(a => fixes.some(b => b !== a && Math.abs(Date.parse(a.date) - Date.parse(b.date)) <= windowDays * DAY));
    if (near.length < 2) continue;
    clusters.push({ file, shas: near.map(c => c.sha) });
    for (const c of near) kinds.get(c.sha).add('repeat-fix');
  }
  clusters.sort((a, b) => b.shas.length - a.shas.length || a.file.localeCompare(b.file));

  const score = k => (k.has('revert') ? 3 : 0) + (k.has('fix') ? 2 : 0) + (k.has('repeat-fix') ? 2 : 0) + (k.has('test-with-fix') ? 1 : 0);
  const candidates = kept
    .filter(c => kinds.get(c.sha).size > 0)
    .map((c, order) => ({ c, order, k: kinds.get(c.sha) }))
    .sort((a, b) => score(b.k) - score(a.k) || a.order - b.order)
    .slice(0, pick)
    .map(({ c, k }) => {
      const out = { sha: c.sha, date: c.date, subject: c.subject, kinds: [...k], files: c.files.slice(0, 20) };
      const reverted = /This reverts commit ([0-9a-f]{7,40})/.exec(c.body);
      if (reverted) out.reverts = reverted[1];
      return out;
    });

  return { repo, branch, head: head.trim(), dirty, sampled: all.length, windowDays, candidates, clusters, skipped };
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const args = parse(process.argv.slice(2));
  const report = args && mine(args.repo, args);
  if (!report) {
    process.stderr.write('usage: mine-history.mjs --repo <git repository> [--limit N] [--pick N] [--window-days N]\n');
    process.exit(2);
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
