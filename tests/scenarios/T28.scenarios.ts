/** AT-028 executor — spreadsheet computation and quantitative correctness.
 *
 * The workbook's answers are known before the engine runs: 1,500 rows at 100 centavos plus one
 * row at 250 is 150,250, and the hidden adjustment of -5,000 makes 145,250. The cached totals in
 * the file say 150,000 and 145,000, which is what a review that trusts the displayed number
 * would report.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Json, ScenarioObservation } from '../../contracts/interfaces.js';
import { ControllerDatabase } from '../../packages/state/src/database.js';
import { LifecycleService } from '../../packages/core/src/lifecycle.js';
import { DocumentStore } from '../../packages/documents/src/ingest.js';
import { inventoryVersion, rowCoverage } from '../../packages/documents/src/inventory.js';
import {
  ENGINE, SUPPORTED_FUNCTIONS, calculate, exportCsv, loadWorkbook,
  numericReadiness, parseDelimited, parseFormula, roundMinorUnit,
} from '../../packages/documents/src/calc.js';
import { buildXlsx, readXlsx, type SheetCell } from '../../packages/documents/src/ooxml.js';
import * as corpus from '../../fixtures/documents/corpus.js';
import { Evidence, fixedClock } from '../harness/evidence.js';
import { registerScenario } from '../harness/registry.js';

const PROJECT = 'project_t28';
const NOW = '2026-09-09T09:00:00.000Z';

/** The expectation, derived here rather than read from the file. */
function independentTotal(rows: number, unit: number, lateRow: number): number {
  let total = 0;
  for (let row = 1; row < rows; row += 1) total += unit;
  return total + lateRow;
}

registerScenario('AT-028', async (): Promise<ScenarioObservation> => {
  const writer = await Evidence.open('T28');
  const sandbox = mkdtempSync(path.join(tmpdir(), 'cm-t28-'));
  const db = ControllerDatabase.open(path.join(sandbox, 'state'));

  try {
    const service = new LifecycleService(db, { clock: fixedClock(NOW) });
    service.registerProject({ project_id: PROJECT, registered_root_ref: `file://${sandbox}`, profile_id: 'discover', data_class: 'internal' });
    const store = new DocumentStore(db, { blob_root: path.join(sandbox, 'blobs'), clock: fixedClock(NOW) });
    const bytes = corpus.xlsxPricing();
    const uploaded = store.upload({ project_id: PROJECT, declared_media_type: corpus.MEDIA_TYPES.xlsx, bytes, privacy_class: 'internal', idempotency_key: 't28-xlsx' });
    if (!uploaded.stored) throw new Error('FIXTURE_REJECTED');

    // 1. Inventory first, then compute every requested row and dependency.
    const inventory = inventoryVersion({ version: uploaded.version, bytes });
    const coverage = rowCoverage(inventory.units, 'Items');
    const workbook = loadWorkbook(bytes);
    const expectedTotal = independentTotal(corpus.KNOWN_ANSWERS.workbook_rows, 100, corpus.KNOWN_ANSWERS.workbook_late_row_value_centavos);
    const outcome = calculate({
      workbook, engine: ENGINE,
      targets: [
        { sheet: 'Items', ref: 'E1' }, { sheet: 'Items', ref: 'E2' },
        { sheet: 'Items', ref: 'E3' }, { sheet: 'Items', ref: 'E4' }, { sheet: 'Items', ref: 'E5' },
      ],
    });
    const cellOf = (ref: string) => outcome.cells.find(cell => cell.address.ref === ref)!;
    const total = cellOf('E1');
    const grand = cellOf('E3');

    // 2. Row 1,501 affects the total. The same workbook without it totals 150,000.
    const truncatedCells: SheetCell[] = [];
    for (let row = 1; row <= 1500; row += 1) truncatedCells.push({ ref: `B${row}`, value: 100 });
    truncatedCells.push({ ref: 'E1', formula: 'SUM(B1:B1501)', cached: '150000' });
    const truncated = calculate({
      workbook: loadWorkbook(buildXlsx({ sheets: [{ name: 'Items', hidden: false, cells: truncatedCells }] })),
      engine: ENGINE, targets: [{ sheet: 'Items', ref: 'E1' }],
    });
    const lateRowMatters =
      total.computed?.kind === 'number' && total.computed.value === expectedTotal &&
      expectedTotal === corpus.KNOWN_ANSWERS.workbook_total_centavos &&
      truncated.cells[0]!.computed?.kind === 'number' &&
      truncated.cells[0]!.computed.value === expectedTotal - corpus.KNOWN_ANSWERS.workbook_late_row_value_centavos &&
      coverage.complete && coverage.sheet_rows === corpus.KNOWN_ANSWERS.workbook_rows;

    // 3. The cached totals are stale, and saying so is the whole job.
    const cachedNotRecalculated =
      total.cached_value === '150000' && total.cached_matches_computed === false &&
      grand.cached_value === '145000' && grand.cached_matches_computed === false &&
      grand.computed?.kind === 'number' && grand.computed.value === corpus.KNOWN_ANSWERS.workbook_total_with_adjustment_centavos;

    // 4. The hidden sheet is a dependency of the grand total, and it was followed.
    const hiddenIncluded =
      grand.dependencies.some(dependency => dependency.sheet === 'Adjustments') &&
      readXlsx(bytes).sheets.some(sheet => sheet.hidden && sheet.name === 'Adjustments') &&
      (() => { const adjustment = cellOf('E2').computed; return adjustment?.kind === 'number' && adjustment.value === corpus.KNOWN_ANSWERS.hidden_adjustment_centavos; })();

    // 5. Without an engine, nothing numeric may be called ready.
    const withoutEngine = calculate({ workbook, targets: [{ sheet: 'Items', ref: 'E1' }] });
    const blockedWithoutEngine = numericReadiness({
      request_depends_on_numbers: true, calculation: withoutEngine, declared_calculation_status: 'VERIFIED',
    });
    const waiverAttempt = numericReadiness({
      request_depends_on_numbers: true, calculation: withoutEngine, declared_calculation_status: 'NOT_APPLICABLE',
    });
    const withEngineOnClean = calculate({
      workbook: loadWorkbook(buildXlsx({ sheets: [{ name: 'Items', hidden: false, cells: [
        { ref: 'B1', value: 100 }, { ref: 'B2', value: 250 }, { ref: 'E1', formula: 'SUM(B1:B2)', cached: '350' },
      ] }] })),
      engine: ENGINE, targets: [{ sheet: 'Items', ref: 'E1' }],
    });
    const cleanReady = numericReadiness({
      request_depends_on_numbers: true, calculation: withEngineOnClean, declared_calculation_status: 'VERIFIED',
    });
    const engineBlocks = !blockedWithoutEngine.numeric_ready &&
      blockedWithoutEngine.reasons.includes('NO_CALCULATION_ENGINE_AVAILABLE') &&
      !waiverAttempt.numeric_ready &&
      waiverAttempt.reasons.includes('NOT_APPLICABLE_IS_NOT_A_WAIVER_FOR_A_NUMERIC_REQUEST') &&
      cleanReady.numeric_ready && withEngineOnClean.status === 'VERIFIED';

    // 6. Unsupported functions and blocked external links are reported, not guessed.
    const unsupportedReported =
      outcome.unsupported.some(entry => entry.reason === 'UNSUPPORTED_FUNCTION:XLOOKUP') &&
      outcome.external_dependencies.some(entry => entry.address.ref === 'E5') &&
      outcome.status === 'UNVERIFIED' &&
      cellOf('E4').status === 'UNSUPPORTED' && cellOf('E5').status === 'EXTERNAL_DEPENDENCY' &&
      // No number was invented for either of them.
      cellOf('E4').computed?.kind === 'error' && cellOf('E5').computed?.kind === 'error' &&
      parseFormula('XLOOKUP(A1,B:B,C:C)', 'Items').type === 'unsupported';

    // 7. Identifiers and money rounding.
    const parsed = parseDelimited(corpus.csvOrders().toString('utf8'));
    const identifierCell = readXlsx(bytes).sheets[0]!.cells.find(cell => cell.ref === 'C1');
    const roundings = [
      { input: 0.5, expected: 1 }, { input: 1.5, expected: 2 }, { input: -0.5, expected: -1 },
      { input: 2.4, expected: 2 }, { input: 2.5, expected: 3 },
    ].map(entry => ({ ...entry, observed: roundMinorUnit(entry.input) }));
    const identifiersPreserved =
      parsed.preserved_identifiers.includes(corpus.KNOWN_ANSWERS.customer_id_with_leading_zero) &&
      identifierCell?.inline_text === true && identifierCell.value === corpus.KNOWN_ANSWERS.customer_id_with_leading_zero &&
      roundings.every(entry => entry.observed === entry.expected) &&
      total.computed?.kind === 'number' && Number.isInteger(total.computed.value);

    // 8. The CSV canary travels as text.
    const exported = exportCsv([
      ['order_id', 'customer_id', 'note'],
      ['1001', corpus.KNOWN_ANSWERS.customer_id_with_leading_zero, corpus.CSV_INJECTION_CANARY],
    ]);
    const reopened = parseDelimited(exported.text);
    const canaryCell = reopened.rows[1]?.[2] ?? '';
    const csvSafe = exported.escaped_cells === 1 && canaryCell.startsWith("'=") &&
      canaryCell.slice(1) === corpus.CSV_INJECTION_CANARY &&
      reopened.preserved_identifiers.includes(corpus.KNOWN_ANSWERS.customer_id_with_leading_zero) &&
      // Nothing in the export path ever evaluates a cell.
      !exported.text.includes('calc.exe');

    await writer.write('calculation.json', {
      engine: ENGINE, supported_functions: SUPPORTED_FUNCTIONS,
      independent_expectation: { rows: corpus.KNOWN_ANSWERS.workbook_rows, total_centavos: expectedTotal },
      outcome, truncated_without_row_1501: truncated.cells[0]!.computed,
      row_coverage: coverage,
      without_engine: { status: withoutEngine.status, readiness: blockedWithoutEngine, waiver_attempt: waiverAttempt },
      clean_workbook_ready: cleanReady,
    } as unknown as Json);
    await writer.write('csv.json', {
      exported, reopened_rows: reopened.rows, canary: corpus.CSV_INJECTION_CANARY,
      canary_cell: canaryCell, rounding: roundings,
      identifiers: parsed.preserved_identifiers,
    } as unknown as Json);

    return {
      scenario_id: 'AT-028',
      mode: 'integration',
      observed: {
        row_1501_affects_checked_total: lateRowMatters,
        cached_values_not_called_recalculated: cachedNotRecalculated,
        hidden_dependencies_included: hiddenIncluded,
        missing_calculation_engine_blocks_numeric_ready: engineBlocks,
        unsupported_formulas_reported: unsupportedReported,
        identifiers_and_money_rounding_preserved: identifiersPreserved,
        csv_canary_not_executed: csvSafe,
        computed_total_centavos: total.computed?.kind === 'number' ? total.computed.value : null,
        cached_total_centavos: total.cached_value,
        dependencies_followed: grand.dependencies.length,
      } satisfies Record<string, Json>,
      artifact_paths: writer.paths,
    };
  } finally {
    db.close();
    rmSync(sandbox, { recursive: true, force: true });
  }
});
