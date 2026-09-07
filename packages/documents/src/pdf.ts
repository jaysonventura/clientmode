/** PDF: build the fixtures, and read them with a qualified external tool.
 *
 * Text extraction goes through `pdftotext`, whose version is recorded with every result. A
 * scanned page has no text layer, and the reader says so rather than returning an empty string
 * that reads like an empty page — the difference decides whether a review is complete or
 * partial. Rendering goes through Ghostscript, and is reported unavailable when it is absent
 * rather than skipped quietly.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export type PdfPageSource = {
  /** Text lines drawn on the page. An empty list makes a page with no text layer. */
  lines: string[];
  /** A scanned page carries an image and no text: the reader must not call it empty. */
  scanned: boolean;
  printed_label?: string;
};

function pdfEscape(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/** A minimal, valid, uncompressed PDF. Uncompressed on purpose: the bytes a citation points at
 * should be readable by any tool a reviewer happens to have. */
export function buildPdf(pages: readonly PdfPageSource[]): Buffer {
  const objects: string[] = [];
  const pageIds = pages.map((_, index) => 3 + index * 2);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  const fontId = 3 + pages.length * 2;
  pages.forEach((page, index) => {
    const id = pageIds[index]!;
    const contentId = id + 1;
    const body = page.scanned
      // A scanned page: a filled rectangle standing in for the raster, and no text operators.
      ? '0.85 0.85 0.85 rg 40 500 520 250 re f'
      : page.lines.map((line, lineIndex) =>
        `BT /F1 12 Tf 56 ${760 - lineIndex * 18} Td (${pdfEscape(line)}) Tj ET`).join('\n');
    objects[id] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${body.length} >>\nstream\n${body}\nendstream`;
  });
  objects[fontId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

  let out = '%PDF-1.7\n';
  const offsets: number[] = [];
  for (let id = 1; id <= fontId; id += 1) {
    offsets[id] = out.length;
    out += `${id} 0 obj\n${objects[id] ?? '<< >>'}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${fontId + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= fontId; id += 1) out += `${String(offsets[id] ?? 0).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${fontId + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

export type ToolStatus = { name: string; available: boolean; version: string | null; detail: string };

function toolVersion(executable: string, argv: string[]): ToolStatus {
  try {
    // pdftotext prints its banner on stderr even when it exits 0, so both streams are read:
    // a tool whose version could not be established is not a qualified tool.
    const result = spawnSync(executable, argv, { encoding: 'utf8', timeout: 20_000 });
    if (result.error !== undefined && result.error !== null) throw result.error;
    const out = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
    return { name: executable, available: true, version: /(\d+\.\d+(\.\d+)?)/.exec(out)?.[1] ?? null, detail: out.split('\n')[0]?.trim() ?? '' };
  } catch (error) {
    const message = String((error as { stderr?: Buffer; message: string }).stderr ?? (error as Error).message);
    const version = /(\d+\.\d+(\.\d+)?)/.exec(message)?.[1] ?? null;
    // pdftotext prints its banner on stderr and exits non-zero for -v on some builds.
    return version === null
      ? { name: executable, available: false, version: null, detail: message.slice(0, 160) }
      : { name: executable, available: true, version, detail: message.split('\n')[0]?.trim() ?? '' };
  }
}

export function pdfToolchain(): { extractor: ToolStatus; renderer: ToolStatus } {
  return { extractor: toolVersion('pdftotext', ['-v']), renderer: toolVersion('gs', ['--version']) };
}

export type PdfPageRead = {
  page_number: number;
  text: string;
  /** No text operators were found on the page. It is not the same as an empty page. */
  has_text_layer: boolean;
  needs_visual_inspection: boolean;
};

export type PdfRead = {
  pages: PdfPageRead[];
  page_count: number;
  extractor: ToolStatus;
  /** Set when extraction could not run at all; the caller must report partial, not empty. */
  extraction_blocked: string | null;
};

/** Page count read from the file itself, so an extractor that returns nothing cannot make a
 * document look like it has no pages. */
export function pdfPageCount(bytes: Buffer): number {
  const text = bytes.toString('latin1');
  const declared = /\/Type\s*\/Pages[\s\S]*?\/Count\s+(\d+)/.exec(text)?.[1];
  return declared !== undefined ? Number(declared) : (text.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
}

export function readPdf(bytes: Buffer, workspace: string): PdfRead {
  const extractor = toolVersion('pdftotext', ['-v']);
  const page_count = pdfPageCount(bytes);
  if (!extractor.available) {
    return {
      pages: Array.from({ length: page_count }, (_, index) => ({
        page_number: index + 1, text: '', has_text_layer: false, needs_visual_inspection: true,
      })),
      page_count, extractor, extraction_blocked: 'PDF_EXTRACTOR_UNAVAILABLE',
    };
  }
  mkdirSync(workspace, { recursive: true });
  const file = path.join(workspace, 'source.pdf');
  writeFileSync(file, bytes);
  const pages: PdfPageRead[] = [];
  for (let page = 1; page <= page_count; page += 1) {
    const out = path.join(workspace, `page-${page}.txt`);
    let text = '';
    try {
      execFileSync('pdftotext', ['-f', String(page), '-l', String(page), '-layout', '-enc', 'UTF-8', file, out],
        { stdio: 'ignore', timeout: 60_000 });
      text = readFileSync(out, 'utf8').replace(/\f/g, '').trim();
    } catch { text = ''; }
    const has_text_layer = text.length > 0;
    pages.push({ page_number: page, text, has_text_layer, needs_visual_inspection: !has_text_layer });
  }
  return { pages, page_count, extractor, extraction_blocked: null };
}

export type RenderResult =
  | { rendered: true; renderer: ToolStatus; page_images: string[]; resolution_dpi: number }
  | { rendered: false; renderer: ToolStatus; reason: string };

/** Renders pages to PNG. A missing renderer is reported, never treated as a page that looked
 * fine. Network access is not required and no remote resource is fetched. */
export function renderPdf(input: { bytes: Buffer; workspace: string; dpi?: number }): RenderResult {
  const renderer = toolVersion('gs', ['--version']);
  if (!renderer.available) return { rendered: false, renderer, reason: 'PDF_RENDERER_UNAVAILABLE' };
  mkdirSync(input.workspace, { recursive: true });
  const file = path.join(input.workspace, 'render-source.pdf');
  writeFileSync(file, input.bytes);
  const dpi = input.dpi ?? 72;
  try {
    execFileSync('gs', ['-q', '-dSAFER', '-dBATCH', '-dNOPAUSE', '-dNOPROMPT', '-sDEVICE=png16m',
      `-r${String(dpi)}`, `-sOutputFile=${path.join(input.workspace, 'page-%d.png')}`, file],
      { stdio: 'ignore', timeout: 120_000 });
  } catch (error) {
    return { rendered: false, renderer, reason: `RENDER_FAILED:${String((error as Error).message).slice(0, 160)}` };
  }
  const page_images = readdirSync(input.workspace).filter(entry => /^page-\d+\.png$/.test(entry)).sort();
  return page_images.length === 0
    ? { rendered: false, renderer, reason: 'RENDERER_PRODUCED_NO_PAGES' }
    : { rendered: true, renderer, page_images, resolution_dpi: dpi };
}
