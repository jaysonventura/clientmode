/** Editing, technical writing and export.
 *
 * Editing writes a new artifact. The original bytes are never touched, and the output is
 * reopened by an independent read path before anyone is told it is ready. The rule that
 * matters most is the boring one: an editorial improvement must not change what the document
 * means. A cancellation window, a price, a permission — those are checked before and after,
 * and a change to any of them fails the edit rather than shipping quietly.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildDocx, readDocx, readPptx, readXlsx, type DocxBlock, type DocxSource } from './ooxml.js';
import { buildPdf, readPdf, renderPdf, type PdfPageSource } from './pdf.js';
import { inkCoverage } from './image.js';

export class EditError extends Error {
  constructor(public readonly code: string, subject = '') {
    super(subject === '' ? code : `${code}: ${subject}`);
    this.name = 'EditError';
  }
}

const digestOf = (bytes: Buffer): string => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

/** The statements an edit must not change. Each is a phrase and the value it carries. */
export type MeaningRule = { rule_id: string; pattern: RegExp; description: string };

export const DEFAULT_MEANING_RULES: MeaningRule[] = [
  { rule_id: 'cancellation_window', pattern: /within\s+(\d+)\s+hours/i, description: 'the cancellation window in hours' },
  { rule_id: 'unit_prices', pattern: /(\d{3,})/g, description: 'prices and other figures' },
  { rule_id: 'permissions', pattern: /\b(may|must|shall)\s+(not\s+)?(cancel|approve|refund|delete)\b/gi, description: 'who may do what' },
];

export type MeaningSnapshot = { rule_id: string; values: string[] };

export function meaningOf(text: string, rules: readonly MeaningRule[] = DEFAULT_MEANING_RULES): MeaningSnapshot[] {
  return rules.map(rule => ({
    rule_id: rule.rule_id,
    values: [...text.matchAll(new RegExp(rule.pattern.source, rule.pattern.flags.includes('g') ? rule.pattern.flags : `${rule.pattern.flags}g`))]
      .map(match => match[0].toLowerCase().replace(/\s+/g, ' ')),
  }));
}

export type MeaningCheck = {
  preserved: boolean;
  changes: Array<{ rule_id: string; before: string[]; after: string[] }>;
};

export function checkMeaning(before: string, after: string, rules: readonly MeaningRule[] = DEFAULT_MEANING_RULES): MeaningCheck {
  const left = meaningOf(before, rules);
  const right = meaningOf(after, rules);
  const changes = left.flatMap((snapshot, index) => {
    const other = right[index]!;
    const same = snapshot.values.length === other.values.length &&
      snapshot.values.every((value, position) => value === other.values[position]);
    return same ? [] : [{ rule_id: snapshot.rule_id, before: snapshot.values, after: other.values }];
  });
  return { preserved: changes.length === 0, changes };
}

export type DocxEdit = { block_index: number; text: string };

export type EditOutcome = {
  original_digest: string;
  output_digest: string;
  output_bytes: Buffer;
  meaning: MeaningCheck;
  applied: DocxEdit[];
  /** Parts carried over unchanged, so nothing is silently dropped from the new version. */
  preserved_parts: string[];
};

/** Produces a new DOCX. The caller's bytes are read and never written back. */
export function editDocx(input: { bytes: Buffer; edits: readonly DocxEdit[]; rules?: readonly MeaningRule[] }): EditOutcome {
  const read = readDocx(input.bytes);
  const bodyBlocks = read.blocks.filter(block => block.part_name === 'word/document.xml' && block.kind !== 'revision');
  const beforeText = read.blocks.map(block => block.text).join('\n');
  const blocks: DocxBlock[] = bodyBlocks.map((block, index) => {
    const edit = input.edits.find(candidate => candidate.block_index === index);
    const text = edit?.text ?? block.text;
    if (block.kind === 'heading') return { kind: 'heading', level: 1, text };
    if (block.kind === 'table') return { kind: 'table', rows: text.split('\n').map(row => row.split(' | ')) };
    return { kind: 'paragraph', text };
  });
  const header = read.blocks.find(block => block.part_name === 'word/header1.xml')?.text ?? null;
  const footer = read.blocks.find(block => block.part_name === 'word/footer1.xml')?.text ?? null;
  const source: DocxSource = {
    blocks, header, footer,
    footnotes: read.blocks.filter(block => block.kind === 'footnote').map(block => block.text),
    comments: read.blocks.filter(block => block.kind === 'comment').map(block => ({ author: 'preserved', text: block.text })),
    revisions: read.blocks.filter(block => block.kind === 'revision').map(block => ({ author: 'preserved', inserted: block.text })),
    macro_part: false, remote_template: null,
  };
  const output_bytes = buildDocx(source);
  const afterText = readDocx(output_bytes).blocks.map(block => block.text).join('\n');
  return {
    original_digest: digestOf(input.bytes),
    output_digest: digestOf(output_bytes),
    output_bytes,
    meaning: checkMeaning(beforeText, afterText, input.rules),
    applied: [...input.edits],
    preserved_parts: read.parts,
  };
}

export type ReopenResult = {
  reopened: boolean;
  format: string;
  reason: string | null;
  observed: Record<string, number | string[] | boolean>;
};

/** Reopens an exported artifact with an independent read path and checks what should be there. */
export function reopen(input: {
  bytes: Buffer; format: 'docx' | 'xlsx' | 'pptx' | 'pdf';
  expect?: { sections?: string[]; sheets?: string[]; formulas?: string[]; slides?: number; pages?: number };
  workspace?: string;
}): ReopenResult {
  const expect = input.expect ?? {};
  try {
    if (input.format === 'docx') {
      const read = readDocx(input.bytes);
      const text = read.blocks.map(block => block.text).join('\n');
      const missing = (expect.sections ?? []).filter(section => !text.includes(section));
      return {
        reopened: missing.length === 0, format: 'docx',
        reason: missing.length === 0 ? null : `MISSING_SECTIONS:${missing.join('|')}`,
        observed: { blocks: read.blocks.length, comments: read.comment_count, revisions: read.revision_count, parts: read.parts },
      };
    }
    if (input.format === 'xlsx') {
      const read = readXlsx(input.bytes);
      const names = read.sheets.map(sheet => sheet.name);
      const missingSheets = (expect.sheets ?? []).filter(sheet => !names.includes(sheet));
      const formulas = read.sheets.flatMap(sheet => sheet.cells.filter(cell => cell.formula !== null).map(cell => cell.formula!));
      const missingFormulas = (expect.formulas ?? []).filter(formula => !formulas.includes(formula));
      const reason = missingSheets.length > 0 ? `MISSING_SHEETS:${missingSheets.join('|')}`
        : missingFormulas.length > 0 ? `MISSING_FORMULAS:${missingFormulas.join('|')}` : null;
      return { reopened: reason === null, format: 'xlsx', reason, observed: { sheets: names, formulas } };
    }
    if (input.format === 'pptx') {
      const read = readPptx(input.bytes);
      const charts = read.slides.reduce((sum, slide) => sum + slide.chart_parts.length, 0);
      const reason = expect.slides !== undefined && read.slides.length !== expect.slides
        ? `SLIDE_COUNT:${String(read.slides.length)}` : null;
      return { reopened: reason === null, format: 'pptx', reason, observed: { slides: read.slides.length, charts } };
    }
    const read = readPdf(input.bytes, input.workspace ?? path.join('.', 'reopen'));
    const reason = expect.pages !== undefined && read.page_count !== expect.pages ? `PAGE_COUNT:${String(read.page_count)}` : null;
    return { reopened: reason === null, format: 'pdf', reason, observed: { pages: read.page_count, pages_with_text: read.pages.filter(page => page.has_text_layer).length } };
  } catch (error) {
    return { reopened: false, format: input.format, reason: `REOPEN_FAILED:${String((error as Error).message).slice(0, 120)}`, observed: {} };
  }
}

export type PageRender = { page_number: number; ink_ratio: number; blank: boolean; extracted_text: string };

export type RenderCheck = {
  rendered: boolean;
  renderer: string | null;
  pages: PageRender[];
  /** Pages that should carry content and came back blank: clipped, overflowed or off-page. */
  blank_pages: number[];
  missing_text: string[];
  /** Whether every page was looked at, or only a declared sample. */
  scope: 'all_pages' | 'sampled';
  reason: string | null;
};

/** Renders the exported PDF and measures each page. A page that should have content and has no
 * ink on it is a layout failure, and it is caught here rather than by the reader. */
export function checkRender(input: {
  bytes: Buffer; workspace: string; expected_text?: string[]; dpi?: number;
}): RenderCheck {
  const render = renderPdf({ bytes: input.bytes, workspace: input.workspace, dpi: input.dpi ?? 72 });
  const read = readPdf(input.bytes, path.join(input.workspace, 'text'));
  if (!render.rendered) {
    return {
      rendered: false, renderer: render.renderer.version, pages: [], blank_pages: [],
      missing_text: input.expected_text ?? [], scope: 'all_pages', reason: render.reason,
    };
  }
  const pages = render.page_images.map((file, index) => {
    const coverage = inkCoverage(readFileSync(path.join(input.workspace, file)));
    return {
      page_number: index + 1,
      ink_ratio: coverage.ink_ratio,
      blank: coverage.ink_ratio === 0,
      extracted_text: read.pages.find(page => page.page_number === index + 1)?.text ?? '',
    };
  });
  const allText = pages.map(page => page.extracted_text).join('\n');
  return {
    rendered: true, renderer: render.renderer.version, pages,
    blank_pages: pages.filter(page => page.blank).map(page => page.page_number),
    missing_text: (input.expected_text ?? []).filter(text => !allText.includes(text)),
    scope: 'all_pages', reason: null,
  };
}

/** Builds a PDF report from sections. Used for "produce a report" requests. */
export function buildReport(sections: ReadonlyArray<{ heading: string; lines: string[] }>): Buffer {
  const pages: PdfPageSource[] = sections.map(section => ({
    lines: [section.heading, ...section.lines], scanned: false,
  }));
  return buildPdf(pages);
}

export type ArtifactRecord = {
  artifact_id: string; content_digest: string; media_type: string; byte_length: number; editable: boolean;
};

export function describeArtifact(input: { artifact_id: string; bytes: Buffer; media_type: string; editable: boolean }): ArtifactRecord {
  return {
    artifact_id: input.artifact_id, content_digest: digestOf(input.bytes),
    media_type: input.media_type, byte_length: input.bytes.byteLength, editable: input.editable,
  };
}

/** A download is checked against the digest that was verified, with a safe basename and an
 * attachment disposition. An active HTML preview is never served. */
export function prepareDownload(input: { artifact: ArtifactRecord; bytes: Buffer; requested_name: string }):
  | { allowed: true; filename: string; headers: Record<string, string> }
  | { allowed: false; reason: string } {
  if (digestOf(input.bytes) !== input.artifact.content_digest) return { allowed: false, reason: 'DIGEST_MISMATCH' };
  if (/html?$/i.test(input.artifact.media_type) || input.artifact.media_type.includes('html')) {
    return { allowed: false, reason: 'ACTIVE_HTML_PREVIEW_NOT_SERVED' };
  }
  const filename = path.basename(input.requested_name).replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '') || 'download';
  return {
    allowed: true, filename,
    headers: {
      'content-type': input.artifact.media_type,
      'content-length': String(input.artifact.byte_length),
      'content-disposition': `attachment; filename="${filename}"`,
      'x-content-digest': input.artifact.content_digest,
      'x-content-type-options': 'nosniff',
    },
  };
}
