/** AT-026 executor — inventory, extraction and citation integrity.
 *
 * The inventory is built from the files before anything is extracted, so the hidden sheet and
 * row 1,501 are in scope because the workbook has them, not because someone remembered to look.
 * Every citation is then resolved against the stored bytes, including the ones that should not
 * resolve.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DocumentCitation, DocumentVersion, Json, ScenarioObservation } from '../../contracts/interfaces.js';
import { validateEntity } from '../../packages/contracts/src/validate.js';
import { ControllerDatabase } from '../../packages/state/src/database.js';
import { LifecycleService } from '../../packages/core/src/lifecycle.js';
import { DocumentStore } from '../../packages/documents/src/ingest.js';
import { buildScope, inventoryVersion, rowCoverage, ROWS_PER_RANGE } from '../../packages/documents/src/inventory.js';
import { coverageOf, extractUnits, resolveCitation, DEFAULT_CAPABILITIES } from '../../packages/documents/src/extract.js';
import * as corpus from '../../fixtures/documents/corpus.js';
import { Evidence, fixedClock } from '../harness/evidence.js';
import { registerScenario } from '../harness/registry.js';

const PROJECT = 'project_t26';
const NOW = '2026-09-09T07:00:00.000Z';

registerScenario('AT-026', async (): Promise<ScenarioObservation> => {
  const writer = await Evidence.open('T26');
  const sandbox = mkdtempSync(path.join(tmpdir(), 'cm-t26-'));
  const db = ControllerDatabase.open(path.join(sandbox, 'state'));

  try {
    const service = new LifecycleService(db, { clock: fixedClock(NOW) });
    service.registerProject({ project_id: PROJECT, registered_root_ref: `file://${sandbox}`, profile_id: 'discover', data_class: 'internal' });
    const store = new DocumentStore(db, { blob_root: path.join(sandbox, 'blobs'), clock: fixedClock(NOW) });

    const sources: Array<[string, string, Buffer]> = [
      ['pdf', corpus.MEDIA_TYPES.pdf, corpus.pdfTerms()],
      ['docx', corpus.MEDIA_TYPES.docx, corpus.docxPolicy()],
      ['xlsx', corpus.MEDIA_TYPES.xlsx, corpus.xlsxPricing()],
      ['pptx', corpus.MEDIA_TYPES.pptx, corpus.pptxDeck()],
      ['png', corpus.MEDIA_TYPES.png, corpus.pngScreenshot()],
    ];
    const versions = new Map<string, { version: DocumentVersion; bytes: Buffer }>();
    const byLabel = new Map<string, DocumentVersion>();
    for (const [label, media_type, bytes] of sources) {
      const outcome = store.upload({ project_id: PROJECT, declared_media_type: media_type, bytes, privacy_class: 'internal', idempotency_key: `t26-${label}` });
      if (!outcome.stored) throw new Error(`FIXTURE_REJECTED:${label}:${outcome.safety.refusals.join(',')}`);
      versions.set(outcome.version.version_id, { version: outcome.version, bytes });
      byLabel.set(label, outcome.version);
    }

    // 1. Complete inventories, built before extraction.
    const inventories = [...versions.values()].map(entry => inventoryVersion({ version: entry.version, bytes: entry.bytes }));
    const { scope, units } = buildScope({
      job_id: 'job_t26', project_id: PROJECT, scope_mode: 'entire_inputs',
      inventories, created_at: NOW,
    });
    const scopeValid = validateEntity(scope).valid;
    const workbook = inventories.find(inventory => inventory.format === 'xlsx')!;
    const itemsCoverage = rowCoverage(workbook.units, 'Items');
    const hiddenCoverage = rowCoverage(workbook.units, 'Adjustments');
    const inventoried =
      inventories.find(inventory => inventory.format === 'pdf')!.totals['pages'] === 3 &&
      inventories.find(inventory => inventory.format === 'pptx')!.totals['slides'] === 2 &&
      (inventories.find(inventory => inventory.format === 'docx')!.totals['comments'] ?? 0) === 1 &&
      (inventories.find(inventory => inventory.format === 'docx')!.totals['revisions'] ?? 0) === 1 &&
      workbook.totals['sheets'] === 2 && workbook.totals['hidden_sheets'] === 1 &&
      scopeValid && scope.units.length === units.length;

    // 2. Hidden sheets and the row past the thousandth are in scope, and the ranges cover the
    //    whole sheet with no gaps.
    const lateRowUnit = workbook.units.find(unit =>
      unit.locator.type === 'sheet' && unit.locator.sheet_name === 'Items' &&
      unit.row_span !== undefined && unit.row_span.first <= corpus.KNOWN_ANSWERS.workbook_rows && unit.row_span.last >= corpus.KNOWN_ANSWERS.workbook_rows);
    const hiddenUnits = workbook.units.filter(unit => unit.locator.type === 'sheet' && unit.locator.sheet_name === 'Adjustments');
    const hiddenAndLateKept = lateRowUnit !== undefined && hiddenUnits.length > 0 &&
      itemsCoverage.complete && itemsCoverage.sheet_rows === corpus.KNOWN_ANSWERS.workbook_rows &&
      itemsCoverage.gaps.length === 0 && hiddenCoverage.complete;

    // 3. Extraction, and the units that cannot be read.
    const extractions = inventories.map(inventory => {
      const entry = versions.get(inventory.version_id)!;
      return {
        inventory,
        result: extractUnits({
          version: entry.version, bytes: entry.bytes, units: inventory.units,
          workspace: path.join(sandbox, 'extract', inventory.version_id),
        }),
      };
    });
    const extracted = extractions.flatMap(entry => entry.result.units);
    const coverage = coverageOf({ scope_unit_ids: scope.units.map(unit => unit.unit_id), extracted });
    const pdfExtraction = extractions.find(entry => entry.inventory.format === 'pdf')!;
    const scannedPage = pdfExtraction.result.units.find(unit => unit.unreadable_reason === 'NO_TEXT_LAYER');
    const imageExtraction = extractions.find(entry => entry.inventory.format === 'image')!;
    const unreadableReported = scannedPage !== undefined &&
      pdfExtraction.result.coverage === 'PARTIAL' &&
      pdfExtraction.result.limitations.some(limit => /no text layer/i.test(limit)) &&
      imageExtraction.result.units.every(unit => !unit.readable) &&
      imageExtraction.result.limitations.some(limit => /no OCR engine/i.test(limit)) &&
      coverage.coverage === 'PARTIAL' && coverage.unreadable.length > 0;

    // 4. The visuals that had to be looked at, were.
    const visualUnits = scope.units.filter(unit => unit.visual_required);
    const visualInspected = visualUnits.filter(unit =>
      extracted.find(candidate => candidate.unit_id === unit.unit_id)?.visual_inspected === true ||
      extracted.find(candidate => candidate.unit_id === unit.unit_id)?.readable === true);
    const chartUnit = scope.units.find(unit => unit.locator.type === 'slide' && unit.locator.shape_id === '3');
    const visualsInspected = visualUnits.length > 0 && visualInspected.length === visualUnits.length &&
      chartUnit !== undefined && extracted.some(unit => unit.unit_id === chartUnit.unit_id && unit.visual_inspected);

    // 5. Known clauses found where they are: in slide notes, on page two, on a hidden sheet
    //    and at row 1,501 — each with a citation resolved against the source bytes.
    const workspace = path.join(sandbox, 'cite');
    const pdfVersion = byLabel.get('pdf')!;
    const docxVersion = byLabel.get('docx')!;
    const xlsxVersion = byLabel.get('xlsx')!;
    const pptxVersion = byLabel.get('pptx')!;
    const good: DocumentCitation[] = [
      { version_id: pdfVersion.version_id, content_digest: pdfVersion.content_digest,
        locator: { type: 'page', page_number: 2 }, excerpt: `within ${String(corpus.KNOWN_ANSWERS.pdf_cancellation_hours)} hours of confirmation` },
      { version_id: docxVersion.version_id, content_digest: docxVersion.content_digest,
        locator: { type: 'paragraph', part_name: 'word/document.xml', block_path: '/paragraph[4]' },
        excerpt: `within ${String(corpus.KNOWN_ANSWERS.docx_cancellation_hours)} hours of confirmation` },
      { version_id: pptxVersion.version_id, content_digest: pptxVersion.content_digest,
        locator: { type: 'slide', slide_number: 1, shape_id: 'notes' },
        excerpt: `cancellation window is ${String(corpus.KNOWN_ANSWERS.pptx_notes_cancellation_hours)} hours` },
      { version_id: xlsxVersion.version_id, content_digest: xlsxVersion.content_digest,
        locator: { type: 'sheet', sheet_name: 'Adjustments', cell_range: 'A1:B1' }, excerpt: 'bulk discount' },
      { version_id: xlsxVersion.version_id, content_digest: xlsxVersion.content_digest,
        locator: { type: 'sheet', sheet_name: 'Items', cell_range: 'B1501:B1501' }, excerpt: 'B1501=250' },
    ];
    const bad: Array<[string, DocumentCitation]> = [
      ['stale digest', { version_id: pdfVersion.version_id, content_digest: `sha256:${'0'.repeat(64)}`, locator: { type: 'page', page_number: 2 } }],
      ['page beyond the document', { version_id: pdfVersion.version_id, content_digest: pdfVersion.content_digest, locator: { type: 'page', page_number: 99 } }],
      ['row beyond the sheet', { version_id: xlsxVersion.version_id, content_digest: xlsxVersion.content_digest, locator: { type: 'sheet', sheet_name: 'Items', cell_range: 'B9000:B9000' } }],
      ['excerpt not at the locator', { version_id: pdfVersion.version_id, content_digest: pdfVersion.content_digest, locator: { type: 'page', page_number: 1 }, excerpt: 'cancelled within 24 hours' }],
      ['unknown version', { version_id: 'ver_not_in_this_project', content_digest: pdfVersion.content_digest, locator: { type: 'page', page_number: 1 } }],
      ['sheet that does not exist', { version_id: xlsxVersion.version_id, content_digest: xlsxVersion.content_digest, locator: { type: 'sheet', sheet_name: 'Ghost', cell_range: 'A1:A1' } }],
    ];
    const goodChecks = good.map(citation => resolveCitation({ citation, versions, workspace }));
    const badChecks = bad.map(([label, citation]) => ({ label, check: resolveCitation({ citation, versions, workspace }) }));
    const citationsResolve = goodChecks.every(check => check.resolves) && badChecks.every(entry => !entry.check.resolves) &&
      goodChecks.length === 5 && badChecks.length === 6;

    // 6. Truncation cannot become complete. Extraction is disabled for a required unit and a
    //    full review is requested anyway.
    const degraded = extractUnits({
      version: pdfVersion, bytes: versions.get(pdfVersion.version_id)!.bytes,
      units: inventories.find(inventory => inventory.format === 'pdf')!.units,
      workspace: path.join(sandbox, 'degraded'),
      capabilities: { ...DEFAULT_CAPABILITIES, pdf_text: false },
    });
    const truncated = coverageOf({
      // The scope still names every unit; only the first was attempted.
      scope_unit_ids: scope.units.map(unit => unit.unit_id),
      extracted: extracted.slice(0, 1),
    });
    const truncationCannotBeComplete = degraded.coverage === 'PARTIAL' &&
      degraded.units.every(unit => !unit.readable) &&
      degraded.limitations.some(limit => /disabled/i.test(limit)) &&
      truncated.coverage === 'PARTIAL' && truncated.missing.length === scope.units.length - 1;

    await writer.write('inventory.json', {
      scope, inventories: inventories.map(inventory => ({
        version_id: inventory.version_id, format: inventory.format, totals: inventory.totals,
        unit_count: inventory.units.length, unhandled: inventory.unhandled,
      })),
      rows_per_range: ROWS_PER_RANGE,
      row_coverage: { Items: itemsCoverage, Adjustments: hiddenCoverage },
      late_row_unit: lateRowUnit ?? null, hidden_units: hiddenUnits.length,
    } as unknown as Json);
    await writer.write('extraction.json', {
      coverage, tools: Object.fromEntries(extractions.map(entry => [entry.inventory.format, entry.result.tools])),
      limitations: extractions.flatMap(entry => entry.result.limitations),
      unreadable: extractions.flatMap(entry => entry.result.unreadable.map(unit => ({ unit_id: unit.unit_id, reason: unit.unreadable_reason }))),
      visual_units: visualUnits.length, visual_inspected: visualInspected.length,
      degraded_run: { coverage: degraded.coverage, limitations: degraded.limitations },
      truncated_run: truncated,
    } as unknown as Json);
    await writer.write('citations.json', {
      resolved: goodChecks.map(check => ({ locator: check.citation.locator, resolves: check.resolves, observed: check.resolves ? check.observed.slice(0, 160) : null })),
      refused: badChecks.map(entry => ({ label: entry.label, resolves: entry.check.resolves, reason: entry.check.resolves ? null : entry.check.reason })),
    } as unknown as Json);

    return {
      scenario_id: 'AT-026',
      mode: 'integration',
      observed: {
        all_required_units_inventoried: inventoried,
        hidden_and_late_rows_not_dropped: hiddenAndLateKept,
        citations_resolve_to_exact_source_version: citationsResolve,
        relevant_visuals_actually_inspected: visualsInspected,
        unreadable_units_reported: unreadableReported,
        truncation_cannot_become_complete: truncationCannotBeComplete,
        scope_units: scope.units.length,
        workbook_rows_covered: itemsCoverage.covered_rows,
      } satisfies Record<string, Json>,
      artifact_paths: writer.paths,
    };
  } finally {
    db.close();
    rmSync(sandbox, { recursive: true, force: true });
  }
});
