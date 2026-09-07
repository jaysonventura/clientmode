/** Extraction and citation resolution.
 *
 * Two rules do the work here. A unit that could not be read is reported as unreadable, and it
 * keeps its place in the coverage arithmetic — a review that skipped a page is not a review of
 * a document with one fewer page. And a citation is resolved against the stored bytes of the
 * version it names: an agent's quotation is a claim, and the service checks it.
 */
import type { DocumentCitation, DocumentVersion } from '../../../contracts/interfaces.js';
import { readDocx, readPptx, readXlsx, rowOf } from './ooxml.js';
import { readPdf, type ToolStatus } from './pdf.js';
import { readPng } from './image.js';
import type { InventoryUnit } from './inventory.js';

export type ExtractedUnit = {
  unit_id: string;
  version_id: string;
  text: string;
  /** Set when the unit has no readable text layer and needs looking at. */
  readable: boolean;
  unreadable_reason: string | null;
  visual_inspected: boolean;
  numeric_inspected: boolean;
};

export type ExtractionCapabilities = {
  /** Turn extraction off for a required unit to see what a full-review request does. */
  pdf_text: boolean;
  rendering: boolean;
  ocr: boolean;
};

export const DEFAULT_CAPABILITIES: ExtractionCapabilities = { pdf_text: true, rendering: true, ocr: false };

export type ExtractionResult = {
  units: ExtractedUnit[];
  tools: Record<string, ToolStatus | { name: string; available: boolean; version: string | null; detail: string }>;
  unreadable: ExtractedUnit[];
  coverage: 'COMPLETE' | 'PARTIAL';
  limitations: string[];
};

export function extractUnits(input: {
  version: DocumentVersion; bytes: Buffer; units: readonly InventoryUnit[];
  workspace: string; capabilities?: ExtractionCapabilities;
}): ExtractionResult {
  const capabilities = input.capabilities ?? DEFAULT_CAPABILITIES;
  const tools: ExtractionResult['tools'] = {};
  const limitations: string[] = [];
  const out: ExtractedUnit[] = [];
  const base = (unit: InventoryUnit): Omit<ExtractedUnit, 'text' | 'readable' | 'unreadable_reason'> => ({
    unit_id: unit.unit_id, version_id: unit.version_id,
    visual_inspected: false, numeric_inspected: false,
  });

  if (input.version.format === 'pdf') {
    if (!capabilities.pdf_text) {
      limitations.push('PDF text extraction was disabled for this run; no page text was read.');
      for (const unit of input.units) {
        out.push({ ...base(unit), text: '', readable: false, unreadable_reason: 'PDF_TEXT_EXTRACTION_DISABLED' });
      }
    } else {
      const read = readPdf(input.bytes, input.workspace);
      tools['pdf_text'] = read.extractor;
      if (read.extraction_blocked !== null) limitations.push(read.extraction_blocked);
      for (const unit of input.units) {
        const page = unit.locator.type === 'page' ? unit.locator.page_number : 0;
        const found = read.pages.find(candidate => candidate.page_number === page);
        const readable = found !== undefined && found.has_text_layer;
        out.push({
          ...base(unit),
          text: found?.text ?? '',
          readable,
          unreadable_reason: readable ? null : found === undefined ? 'PAGE_NOT_FOUND' : 'NO_TEXT_LAYER',
          // A page with no text layer needs a look. Without OCR it stays uncertain, and that
          // is recorded rather than resolved by guessing.
          visual_inspected: !readable && capabilities.rendering,
        });
      }
      if (out.some(unit => unit.unreadable_reason === 'NO_TEXT_LAYER')) {
        limitations.push(capabilities.ocr
          ? 'Scanned pages were read with OCR; text from them is lower confidence.'
          : 'One or more pages have no text layer. No OCR engine is installed, so their text is not established.');
      }
    }
  } else if (input.version.format === 'docx') {
    const read = readDocx(input.bytes);
    tools['ooxml'] = { name: 'first-party OOXML reader', available: true, version: '1.0.0', detail: 'structural read of the document parts' };
    for (const unit of input.units) {
      const locator = unit.locator;
      const block = locator.type === 'paragraph'
        ? read.blocks.find(candidate => candidate.part_name === locator.part_name && candidate.block_path === locator.block_path)
        : undefined;
      out.push({
        ...base(unit), text: block?.text ?? '', readable: block !== undefined,
        unreadable_reason: block === undefined ? 'BLOCK_NOT_FOUND' : null,
      });
    }
    for (const part of read.unhandled_parts) limitations.push(`Unhandled document part: ${part}`);
  } else if (input.version.format === 'xlsx') {
    const read = readXlsx(input.bytes);
    tools['ooxml'] = { name: 'first-party OOXML reader', available: true, version: '1.0.0', detail: 'structural read of sheets, formulas and cached values' };
    for (const unit of input.units) {
      const locator = unit.locator;
      if (locator.type !== 'sheet') { out.push({ ...base(unit), text: '', readable: false, unreadable_reason: 'WRONG_LOCATOR_TYPE' }); continue; }
      const sheet = read.sheets.find(candidate => candidate.name === locator.sheet_name);
      const span = unit.row_span;
      const cells = sheet === undefined ? [] : sheet.cells.filter(cell =>
        span === undefined || (cell.row >= span.first && cell.row <= span.last));
      out.push({
        ...base(unit),
        text: cells.map(cell => `${cell.ref}=${cell.formula === null ? String(cell.value ?? '') : `${cell.formula}[cached:${String(cell.cached ?? '')}]`}`).join('\n'),
        readable: sheet !== undefined,
        unreadable_reason: sheet === undefined ? 'SHEET_NOT_FOUND' : null,
        numeric_inspected: sheet !== undefined,
      });
    }
  } else if (input.version.format === 'pptx') {
    const read = readPptx(input.bytes);
    tools['ooxml'] = { name: 'first-party OOXML reader', available: true, version: '1.0.0', detail: 'structural read of slides, shapes and notes' };
    for (const unit of input.units) {
      const locator = unit.locator;
      if (locator.type !== 'slide') { out.push({ ...base(unit), text: '', readable: false, unreadable_reason: 'WRONG_LOCATOR_TYPE' }); continue; }
      const slide = read.slides.find(candidate => candidate.slide_number === locator.slide_number);
      const shapeId = locator.shape_id;
      const text = shapeId === 'notes' ? slide?.notes ?? '' : slide?.shapes.find(shape => shape.shape_id === shapeId)?.text ?? '';
      const shape = slide?.shapes.find(candidate => candidate.shape_id === shapeId);
      out.push({
        ...base(unit), text, readable: slide !== undefined && (shapeId === 'notes' ? slide.notes !== null : shape !== undefined),
        unreadable_reason: slide === undefined ? 'SLIDE_NOT_FOUND' : shape === undefined && shapeId !== 'notes' ? 'SHAPE_NOT_FOUND' : null,
        visual_inspected: unit.visual_required && capabilities.rendering,
      });
    }
  } else if (input.version.format === 'image') {
    const read = readPng(input.bytes);
    tools['image'] = { name: 'first-party PNG reader', available: true, version: '1.0.0', detail: `${String(read.width)}x${String(read.height)}` };
    for (const unit of input.units) {
      out.push({
        ...base(unit), text: '', readable: false,
        unreadable_reason: capabilities.ocr ? 'OCR_LOW_CONFIDENCE' : 'NO_OCR_ENGINE_INSTALLED',
        visual_inspected: capabilities.rendering,
      });
    }
    limitations.push('Text inside the image is not established: no OCR engine is installed.');
  } else {
    const text = input.bytes.toString('utf8');
    tools['text'] = { name: 'utf-8 decode', available: true, version: '1.0.0', detail: 'inert text, never executed' };
    for (const unit of input.units) out.push({ ...base(unit), text, readable: true, unreadable_reason: null });
  }

  const unreadable = out.filter(unit => !unit.readable);
  return {
    units: out, tools, unreadable,
    coverage: unreadable.length === 0 ? 'COMPLETE' : 'PARTIAL',
    limitations: [...new Set(limitations)],
  };
}

/** Coverage over the whole scope. Units that were never attempted count against it, which is
 * what stops a truncated run from being reported as complete. */
export function coverageOf(input: {
  scope_unit_ids: readonly string[];
  extracted: readonly ExtractedUnit[];
}): { coverage: 'COMPLETE' | 'PARTIAL'; attempted: number; readable: number; missing: string[]; unreadable: string[] } {
  const byId = new Map(input.extracted.map(unit => [unit.unit_id, unit]));
  const missing = input.scope_unit_ids.filter(id => !byId.has(id));
  const unreadable = input.extracted.filter(unit => !unit.readable).map(unit => unit.unit_id);
  return {
    coverage: missing.length === 0 && unreadable.length === 0 ? 'COMPLETE' : 'PARTIAL',
    attempted: byId.size, readable: input.extracted.filter(unit => unit.readable).length,
    missing, unreadable,
  };
}

export type CitationCheck =
  | { resolves: true; citation: DocumentCitation; observed: string }
  | { resolves: false; citation: DocumentCitation; reason: string; observed: string | null };

/** Resolves a citation against the bytes of the version it names. The excerpt, when present,
 * must actually appear at that locator — a quotation is not proof of itself. */
export function resolveCitation(input: {
  citation: DocumentCitation;
  versions: ReadonlyMap<string, { version: DocumentVersion; bytes: Buffer }>;
  workspace: string;
}): CitationCheck {
  const entry = input.versions.get(input.citation.version_id);
  if (entry === undefined) return { resolves: false, citation: input.citation, reason: 'UNKNOWN_VERSION', observed: null };
  if (entry.version.content_digest !== input.citation.content_digest) {
    return { resolves: false, citation: input.citation, reason: 'SOURCE_DIGEST_MISMATCH', observed: entry.version.content_digest };
  }
  const locator = input.citation.locator;
  let observed: string | null = null;
  if (locator.type === 'page') {
    const read = readPdf(entry.bytes, input.workspace);
    if (locator.page_number < 1 || locator.page_number > read.page_count) {
      return { resolves: false, citation: input.citation, reason: 'PAGE_OUT_OF_BOUNDS', observed: String(read.page_count) };
    }
    observed = read.pages.find(page => page.page_number === locator.page_number)?.text ?? '';
  } else if (locator.type === 'paragraph') {
    const read = readDocx(entry.bytes);
    const block = read.blocks.find(candidate => candidate.part_name === locator.part_name && candidate.block_path === locator.block_path);
    if (block === undefined) return { resolves: false, citation: input.citation, reason: 'BLOCK_NOT_FOUND', observed: null };
    observed = block.text;
  } else if (locator.type === 'sheet') {
    const read = readXlsx(entry.bytes);
    const sheet = read.sheets.find(candidate => candidate.name === locator.sheet_name);
    if (sheet === undefined) return { resolves: false, citation: input.citation, reason: 'SHEET_NOT_FOUND', observed: null };
    const [from, to] = locator.cell_range.split(':');
    const first = rowOf(from!.replace(/\$/g, ''));
    const last = to === undefined ? first : rowOf(to.replace(/\$/g, ''));
    if (last > sheet.max_row) {
      return { resolves: false, citation: input.citation, reason: 'RANGE_BEYOND_SHEET', observed: `max_row=${String(sheet.max_row)}` };
    }
    const cells = sheet.cells.filter(cell => cell.row >= first && cell.row <= last);
    if (cells.length === 0) return { resolves: false, citation: input.citation, reason: 'RANGE_HAS_NO_CELLS', observed: null };
    observed = cells.map(cell => `${cell.ref}=${cell.formula ?? String(cell.value ?? '')}`).join('\n');
  } else if (locator.type === 'slide') {
    const read = readPptx(entry.bytes);
    const slide = read.slides.find(candidate => candidate.slide_number === locator.slide_number);
    if (slide === undefined) return { resolves: false, citation: input.citation, reason: 'SLIDE_NOT_FOUND', observed: null };
    observed = locator.shape_id === 'notes'
      ? slide.notes ?? ''
      : slide.shapes.find(shape => shape.shape_id === locator.shape_id)?.text ?? null;
    if (observed === null) return { resolves: false, citation: input.citation, reason: 'SHAPE_NOT_FOUND', observed: null };
  } else if (locator.type === 'image') {
    const read = readPng(entry.bytes);
    // A normalised box: every coordinate lies in [0,1] and the region has to be inside it.
    const [x, y, width, height] = locator.box as [number, number, number, number];
    if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1 || y + height > 1) {
      return { resolves: false, citation: input.citation, reason: 'BOX_OUT_OF_BOUNDS', observed: `${String(read.width)}x${String(read.height)} pixels` };
    }
    observed = '';
  } else {
    const lines = entry.bytes.toString('utf8').split('\n');
    if (locator.start_line < 1 || locator.end_line < locator.start_line || locator.end_line > lines.length) {
      return { resolves: false, citation: input.citation, reason: 'INTERVAL_OUT_OF_BOUNDS', observed: String(lines.length) };
    }
    observed = lines.slice(locator.start_line - 1, locator.end_line).join('\n');
  }
  if (input.citation.excerpt !== undefined && !normalise(observed).includes(normalise(input.citation.excerpt))) {
    return { resolves: false, citation: input.citation, reason: 'EXCERPT_NOT_FOUND_AT_LOCATOR', observed };
  }
  return { resolves: true, citation: input.citation, observed };
}

const normalise = (text: string): string => text.replace(/\s+/g, ' ').trim().toLowerCase();
