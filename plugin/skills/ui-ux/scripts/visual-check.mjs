#!/usr/bin/env node
// Capture the running page and put it beside the reference it is meant to match.
//
//   node visual-check.mjs --url <url> --reference <png> [--scale 2] [--viewport 1440x900] [--full-page] [--out <dir>]
//
// --scale is the reference's pixel density: 2 for a Retina/HiDPI screenshot. The page is rendered at
// the reference's CSS size (pixels ÷ scale) with the same density, so it hits the same breakpoint.
//
// Writes <out>/actual.png, <out>/compare.png (reference | actual | differences in red) and
// <out>/summary.json (sizes, mismatch ratio, the three regions that differ most). Open compare.png
// and look at it: the ratio says where to look, not whether the page is right.
//
// Uses the project's own Playwright (resolved from the current directory), so it runs unchanged in
// any host that has the skill. Exit 0: compared. 2: bad arguments. 3: no Playwright in this project.
// 4: the page could not be captured. On 3 and 4 nothing is written — no capture, no comparison.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const REGIONS = ['top-left', 'top-centre', 'top-right', 'middle-left', 'centre', 'middle-right', 'bottom-left', 'bottom-centre', 'bottom-right'];

function parse(argv) {
  const out = { fullPage: false, out: '.visual-check', scale: '1' };
  for (let i = 0; i < argv.length; i += 1) {
    const [flag, value] = [argv[i], argv[i + 1]];
    if (flag === '--full-page') { out.fullPage = true; continue; }
    if (!['--url', '--reference', '--viewport', '--out', '--scale'].includes(flag) || value === undefined) return null;
    out[flag.slice(2)] = value; i += 1;
  }
  if (!out.url || !out.reference || !existsSync(out.reference)) return null;
  if (out.viewport && !/^\d+x\d+$/.test(out.viewport)) return null;
  if (!/^[1-4](\.\d+)?$/.test(out.scale)) return null;
  const head = readFileSync(out.reference).subarray(0, 8);
  if (!head.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return null;
  return out;
}

function loadPlaywright() {
  const require = createRequire(path.join(process.cwd(), 'noop.js'));
  for (const name of ['playwright', '@playwright/test', 'playwright-core']) {
    try { return require(name); } catch { /* try the next one */ }
  }
  return null;
}

/** Runs in the browser: compare two PNGs pixel by pixel and draw reference | actual | diff. */
function compareInPage({ reference, actual, regions }) {
  const load = src => new Promise((resolve, reject) => {
    const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = src;
  });
  return Promise.all([load(reference), load(actual)]).then(([ref, act]) => {
    const w = Math.min(ref.width, act.width); const h = Math.min(ref.height, act.height);
    const pixels = img => {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
      return ctx.getImageData(0, 0, w, h).data;
    };
    const a = pixels(ref); const b = pixels(act);
    const diff = document.createElement('canvas'); diff.width = w; diff.height = h;
    const dctx = diff.getContext('2d'); const out = dctx.createImageData(w, h);
    const cells = new Array(9).fill(0); const cellSize = new Array(9).fill(0);
    let mismatched = 0;
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const i = (y * w + x) * 4;
        const delta = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
        const cell = Math.min(2, Math.floor((y * 3) / h)) * 3 + Math.min(2, Math.floor((x * 3) / w));
        cellSize[cell] += 1;
        const grey = 255 - (255 - (a[i] + a[i + 1] + a[i + 2]) / 3) * 0.25;
        if (delta > 32) {
          mismatched += 1; cells[cell] += 1;
          out.data.set([220, 38, 38, 255], i);
        } else out.data.set([grey, grey, grey, 255], i);
      }
    }
    dctx.putImageData(out, 0, 0);
    const board = document.getElementById('board');
    for (const [label, node] of [['reference', ref], ['actual', act], ['differences', diff]]) {
      const figure = document.createElement('figure');
      const caption = document.createElement('figcaption'); caption.textContent = label;
      figure.append(caption, node); board.append(figure);
    }
    const ranked = cells.map((n, k) => ({ region: regions[k], ratio: cellSize[k] ? n / cellSize[k] : 0 }))
      .filter(r => r.ratio > 0).sort((p, q) => q.ratio - p.ratio).slice(0, 3)
      .map(r => ({ region: r.region, ratio: Math.round(r.ratio * 10000) / 10000 }));
    return {
      reference_size: [ref.width, ref.height], actual_size: [act.width, act.height],
      size_match: ref.width === act.width && ref.height === act.height,
      compared_size: [w, h], mismatch_ratio: Math.round((mismatched / (w * h)) * 10000) / 10000, regions: ranked,
    };
  });
}

async function main(argv) {
  const args = parse(argv);
  if (!args) {
    console.error('usage: visual-check.mjs --url <url> --reference <png> [--scale 2] [--viewport WxH] [--full-page] [--out <dir>]  (the reference must be a PNG)');
    return 2;
  }
  const playwright = loadPlaywright();
  if (!playwright) {
    console.error(`visual-check: no Playwright in ${process.cwd()} — install it in the project (npm i -D playwright && npx playwright install chromium). Nothing was captured or compared.`);
    return 3;
  }
  const referencePng = readFileSync(args.reference);
  const [refW, refH] = [referencePng.readUInt32BE(16), referencePng.readUInt32BE(20)];
  const scale = Number(args.scale);
  const [width, height] = args.viewport ? args.viewport.split('x').map(Number) : [Math.round(refW / scale), Math.round(refH / scale)];

  const browser = await playwright.chromium.launch();
  try {
    let actualPng;
    try {
      const tab = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale });
      await tab.goto(args.url, { waitUntil: 'networkidle' });
      actualPng = await tab.screenshot({ fullPage: args.fullPage });
    } catch (error) {
      console.error(`visual-check: could not capture ${args.url} (${String(error.message).split('\n')[0]}). Nothing was compared.`);
      return 4;
    }
    const board = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await board.setContent('<style>body{margin:0;font:14px system-ui}#board{display:flex;gap:16px;padding:16px;align-items:flex-start;width:max-content}figure{margin:0}figcaption{padding:0 0 6px;color:#333}canvas,img{display:block;border:1px solid #999}</style><div id="board"></div>');
    const summary = await board.evaluate(compareInPage, {
      reference: `data:image/png;base64,${referencePng.toString('base64')}`,
      actual: `data:image/png;base64,${actualPng.toString('base64')}`,
      regions: REGIONS,
    });
    mkdirSync(args.out, { recursive: true });
    writeFileSync(path.join(args.out, 'actual.png'), actualPng);
    await board.locator('#board').screenshot({ path: path.join(args.out, 'compare.png') });
    const result = { url: args.url, reference: args.reference, viewport: [width, height], ...summary };
    writeFileSync(path.join(args.out, 'summary.json'), `${JSON.stringify(result, null, 2)}\n`);
    console.log(`visual-check: ${Math.round(summary.mismatch_ratio * 1000) / 10}% of pixels differ` +
      (summary.size_match ? '' : ` (sizes differ: reference ${summary.reference_size.join('x')}, actual ${summary.actual_size.join('x')})`) +
      (summary.regions.length ? `; most in ${summary.regions.map(r => r.region).join(', ')}` : '') +
      `. Open ${path.join(args.out, 'compare.png')} and look before judging.`);
    return 0;
  } finally {
    await browser.close();
  }
}

process.exitCode = await main(process.argv.slice(2));
