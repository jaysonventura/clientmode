/** Inventories and scopes.
 *
 * The inventory is built before any model is asked anything, and it is built from the file.
 * Hidden sheets are in it because they are in the workbook; row 1,501 is in it because the
 * workbook has 1,501 rows. A first-N cut is never called complete: a bounded range is recorded
 * as a bounded range, with the full row count beside it.
 */
import { randomUUID } from 'node:crypto';
import type { DocumentScope, DocumentScopeUnit, DocumentVersion, DocumentLocator } from '../../../contracts/interfaces.js';
import { digest } from '../../contracts/src/canonical.js';
import { readDocx, readPptx, readXlsx, rowOf } from './ooxml.js';
import { pdfPageCount } from './pdf.js';
import { readPng } from './image.js';

export class InventoryError extends Error {
  constructor(public readonly code: string, subject = '') {
    super(subject === '' ? code : `${code}: ${subject}`);
    this.name = 'InventoryError';
  }
}

/** Rows per bounded range. Ranges do not overlap and together cover every row. */
export const ROWS_PER_RANGE = 500;

export type InventoryUnit = DocumentScopeUnit & {
  /** Why the unit is here, so a reader can check the inventory rather than trust it. */
  reason: string;
  /** Rows covered, for a sheet range. The full sheet count travels with it. */
  row_span?: { first: number; last: number; sheet_rows: number };
};

export type VersionInventory = {
  version_id: string;
  format: DocumentVersion['format'];
  units: InventoryUnit[];
  /** Counted from the file, not from what the extractor managed to read. */
  totals: Record<string, number>;
  /** Parts the reader does not handle, exposed rather than dropped. */
  unhandled: string[];
  empty: boolean;
};

const unit = (version_id: string, locator: DocumentLocator, reason: string, options: {
  visual?: boolean; numeric?: boolean; row_span?: InventoryUnit['row_span'];
} = {}): InventoryUnit => ({
  unit_id: `unit_${digest({ version_id, locator }).slice(7, 23)}`,
  version_id, locator, visual_required: options.visual === true, numeric_required: options.numeric === true,
  reason, ...(options.row_span === undefined ? {} : { row_span: options.row_span }),
});

export function inventoryVersion(input: { version: DocumentVersion; bytes: Buffer }): VersionInventory {
  const { version, bytes } = input;
  const units: InventoryUnit[] = [];
  const totals: Record<string, number> = {};
  let unhandled: string[] = [];

  if (version.format === 'pdf') {
    const pages = pdfPageCount(bytes);
    totals['pages'] = pages;
    for (let page = 1; page <= pages; page += 1) {
      units.push(unit(version.version_id, { type: 'page', page_number: page }, 'pdf page', { visual: true }));
    }
  } else if (version.format === 'docx') {
    const read = readDocx(bytes);
    unhandled = read.unhandled_parts;
    totals['blocks'] = read.blocks.length;
    totals['comments'] = read.comment_count;
    totals['revisions'] = read.revision_count;
    for (const block of read.blocks) {
      units.push(unit(version.version_id, { type: 'paragraph', part_name: block.part_name, block_path: block.block_path },
        `docx ${block.kind}`));
    }
  } else if (version.format === 'xlsx') {
    const read = readXlsx(bytes);
    totals['sheets'] = read.sheets.length;
    totals['hidden_sheets'] = read.sheets.filter(sheet => sheet.hidden).length;
    totals['named_ranges'] = read.named_ranges.length;
    totals['external_links'] = read.external_link_targets.length;
    for (const sheet of read.sheets) {
      totals[`rows:${sheet.name}`] = sheet.max_row;
      // Non-overlapping bounded ranges that together cover every row, including the last one.
      for (let first = 1; first <= Math.max(1, sheet.max_row); first += ROWS_PER_RANGE) {
        const last = Math.min(first + ROWS_PER_RANGE - 1, Math.max(1, sheet.max_row));
        units.push(unit(version.version_id,
          { type: 'sheet', sheet_name: sheet.name, cell_range: `A${first}:Z${last}` },
          sheet.hidden ? 'hidden sheet range' : 'sheet range',
          { numeric: true, row_span: { first, last, sheet_rows: sheet.max_row } }));
      }
    }
  } else if (version.format === 'pptx') {
    const read = readPptx(bytes);
    totals['slides'] = read.slides.length;
    totals['charts'] = read.slides.reduce((sum, slide) => sum + slide.chart_parts.length, 0);
    for (const slide of read.slides) {
      for (const shape of slide.shapes) {
        units.push(unit(version.version_id, { type: 'slide', slide_number: slide.slide_number, shape_id: shape.shape_id },
          `pptx ${shape.kind} shape`, { visual: shape.kind === 'chart' || shape.kind === 'image' }));
      }
      if (slide.notes !== null) {
        units.push(unit(version.version_id, { type: 'slide', slide_number: slide.slide_number, shape_id: 'notes' }, 'pptx notes'));
      }
      if (slide.shapes.some(shape => shape.kind === 'unsupported')) unhandled.push(`slide${String(slide.slide_number)}:unsupported-shape`);
    }
  } else if (version.format === 'image') {
    const read = readPng(bytes);
    totals['images'] = 1;
    totals['pixel_width'] = read.width;
    totals['pixel_height'] = read.height;
    // The box is normalised, as the locator contract requires: pixel sizes live in the totals.
    units.push(unit(version.version_id,
      { type: 'image', box: [0, 0, 1, 1] },
      'whole image; text in the image is uncertain without OCR', { visual: true }));
  } else {
    const text = bytes.toString('utf8');
    const lines = text.split('\n');
    totals['lines'] = lines.length;
    units.push(unit(version.version_id, { type: 'text', start_line: 1, end_line: Math.max(1, lines.length) }, 'text file'));
  }

  return { version_id: version.version_id, format: version.format, units, totals, unhandled, empty: units.length === 0 };
}

export type ScopeMode = DocumentScope['scope_mode'];

export function buildScope(input: {
  job_id: string; project_id: string; scope_mode: ScopeMode;
  inventories: readonly VersionInventory[]; created_at: string;
  /** For a create-from-brief job, the trusted job record that stands in for a source inventory. */
  generated_output_binding?: { request_id: string; instruction_revision: number; output_requirements: string[] };
  /** When only part of the input is requested, the units chosen — explicitly, never implicitly. */
  selected_unit_ids?: string[];
}): { scope: DocumentScope; units: InventoryUnit[] } {
  if (input.scope_mode === 'generated_output') {
    if (input.generated_output_binding === undefined) throw new InventoryError('GENERATED_OUTPUT_NEEDS_JOB_BINDING');
    if (input.inventories.length > 0) throw new InventoryError('GENERATED_OUTPUT_HAS_NO_SOURCE_VERSIONS');
    const inventory_digest = digest(input.generated_output_binding);
    const scope: DocumentScope = {
      kind: 'document_scope', schema_version: 1, scope_id: `scope_${randomUUID()}`,
      job_id: input.job_id, project_id: input.project_id, scope_mode: 'generated_output',
      source_version_ids: [], units: [],
      scope_digest: digest({ job_id: input.job_id, mode: 'generated_output', inventory_digest }),
      inventory_digest, created_at: input.created_at,
    };
    return { scope, units: [] };
  }
  const all = input.inventories.flatMap(inventory => inventory.units);
  const units = input.scope_mode === 'selected_units'
    ? all.filter(candidate => (input.selected_unit_ids ?? []).includes(candidate.unit_id))
    : all;
  if (input.scope_mode === 'selected_units' && units.length !== (input.selected_unit_ids ?? []).length) {
    throw new InventoryError('SELECTED_UNIT_NOT_IN_INVENTORY');
  }
  const inventory_digest = digest(input.inventories.map(inventory => ({
    version_id: inventory.version_id, totals: inventory.totals, unit_ids: inventory.units.map(entry => entry.unit_id),
  })));
  const scope: DocumentScope = {
    kind: 'document_scope', schema_version: 1, scope_id: `scope_${randomUUID()}`,
    job_id: input.job_id, project_id: input.project_id, scope_mode: input.scope_mode,
    source_version_ids: input.inventories.map(inventory => inventory.version_id),
    units: units.map(({ unit_id, version_id, locator, visual_required, numeric_required }) =>
      ({ unit_id, version_id, locator, visual_required, numeric_required })),
    scope_digest: digest({ job_id: input.job_id, mode: input.scope_mode, unit_ids: units.map(entry => entry.unit_id), inventory_digest }),
    inventory_digest, created_at: input.created_at,
  };
  return { scope, units };
}

/** Which rows a set of sheet units actually covers, so a claim of completeness can be checked
 * against the workbook rather than against the number of ranges that were processed. */
export function rowCoverage(units: readonly InventoryUnit[], sheet_name: string): {
  covered_rows: number; sheet_rows: number; complete: boolean; gaps: Array<[number, number]>;
} {
  const mine = units.filter(candidate => candidate.locator.type === 'sheet' && candidate.locator.sheet_name === sheet_name)
    .map(candidate => candidate.row_span)
    .filter((span): span is NonNullable<InventoryUnit['row_span']> => span !== undefined)
    .sort((left, right) => left.first - right.first);
  const sheet_rows = mine[0]?.sheet_rows ?? 0;
  const gaps: Array<[number, number]> = [];
  let cursor = 1;
  let covered = 0;
  for (const span of mine) {
    if (span.first > cursor) gaps.push([cursor, span.first - 1]);
    covered += span.last - span.first + 1;
    cursor = Math.max(cursor, span.last + 1);
  }
  if (cursor <= sheet_rows) gaps.push([cursor, sheet_rows]);
  return { covered_rows: covered, sheet_rows, complete: gaps.length === 0 && covered >= sheet_rows, gaps };
}

export { rowOf };
