/** The ui-ux skill's visual check captures the running page, puts it beside the reference, and
 * points at the regions that differ most. It is a way to find mismatches, not a pass mark, and it
 * refuses to report anything when it cannot capture the page.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { ROOT } from '../harness/evidence.js';

const SCRIPT = path.join(ROOT, 'plugin/skills/ui-ux/scripts/visual-check.mjs');
const page = (left: number): string =>
  `<html><body style="margin:0;background:#fff"><div style="position:absolute;top:40px;left:${String(left)}px;width:120px;height:80px;background:#1d4ed8"></div></body></html>`;

async function fixtures(): Promise<{ dir: string; same: string; shifted: string; reference: string }> {
  const dir = mkdtempSync(path.join(tmpdir(), 'cm-visual-'));
  writeFileSync(path.join(dir, 'same.html'), page(20));
  writeFileSync(path.join(dir, 'shifted.html'), page(260));
  const reference = path.join(dir, 'reference.png');
  const browser = await chromium.launch();
  const tab = await browser.newPage({ viewport: { width: 400, height: 200 } });
  await tab.goto(pathToFileURL(path.join(dir, 'same.html')).href);
  await tab.screenshot({ path: reference });
  await browser.close();
  return { dir, same: pathToFileURL(path.join(dir, 'same.html')).href, shifted: pathToFileURL(path.join(dir, 'shifted.html')).href, reference };
}

const run = (args: string[], cwd = ROOT) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' });

test('a page that matches its reference has no mismatch; a moved block is found and located', async () => {
  const f = await fixtures();
  const same = run(['--url', f.same, '--reference', f.reference, '--viewport', '400x200', '--out', path.join(f.dir, 'a')]);
  assert.equal(same.status, 0, same.stderr);
  const a = JSON.parse(readFileSync(path.join(f.dir, 'a', 'summary.json'), 'utf8')) as { mismatch_ratio: number; size_match: boolean };
  assert.equal(a.size_match, true);
  assert.equal(a.mismatch_ratio, 0);

  const moved = run(['--url', f.shifted, '--reference', f.reference, '--viewport', '400x200', '--out', path.join(f.dir, 'b')]);
  assert.equal(moved.status, 0, moved.stderr);
  const b = JSON.parse(readFileSync(path.join(f.dir, 'b', 'summary.json'), 'utf8')) as { mismatch_ratio: number; regions: Array<{ region: string; ratio: number }> };
  assert.ok(b.mismatch_ratio > 0.05, String(b.mismatch_ratio));
  assert.ok(b.regions.length > 0 && b.regions.length <= 3);
  assert.ok(b.regions[0]!.ratio > 0);
  for (const file of ['actual.png', 'compare.png']) assert.ok(existsSync(path.join(f.dir, 'b', file)), file);
  assert.match(moved.stdout, /compare\.png/);
});

test('without Playwright in the project it says so and reports nothing', async () => {
  const f = await fixtures();
  const bare = mkdtempSync(path.join(tmpdir(), 'cm-noplaywright-'));
  const r = run(['--url', f.same, '--reference', f.reference, '--out', path.join(bare, 'out')], bare);
  assert.equal(r.status, 3);
  assert.match(r.stderr, /Playwright/);
  assert.equal(existsSync(path.join(bare, 'out', 'summary.json')), false);
});

test('missing arguments are refused', () => {
  const r = run(['--url', 'http://localhost:1']);
  assert.equal(r.status, 2);
});

test('a 2x (Retina) reference is compared at its CSS size with --scale 2', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cm-visual-'));
  writeFileSync(path.join(dir, 'p.html'), page(20));
  const reference = path.join(dir, 'ref2x.png');
  const browser = await chromium.launch();
  const tab = await browser.newPage({ viewport: { width: 400, height: 200 }, deviceScaleFactor: 2 });
  await tab.goto(pathToFileURL(path.join(dir, 'p.html')).href);
  await tab.screenshot({ path: reference });
  await browser.close();
  const r = run(['--url', pathToFileURL(path.join(dir, 'p.html')).href, '--reference', reference, '--scale', '2', '--out', path.join(dir, 'o')]);
  assert.equal(r.status, 0, r.stderr);
  const s = JSON.parse(readFileSync(path.join(dir, 'o', 'summary.json'), 'utf8')) as { viewport: number[]; size_match: boolean; mismatch_ratio: number };
  assert.deepEqual(s.viewport, [400, 200]);
  assert.equal(s.size_match, true);
  assert.equal(s.mismatch_ratio, 0);
});

test('a reference that is not a PNG is refused', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cm-visual-'));
  writeFileSync(path.join(dir, 'x.png'), 'not a png at all, just text');
  assert.equal(run(['--url', 'http://localhost:1', '--reference', path.join(dir, 'x.png')]).status, 2);
});
