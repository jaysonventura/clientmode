import test from 'node:test';
import assert from 'node:assert/strict';
import { exerciseScenario } from '../harness/registry.js';
import '../scenarios/T28.scenarios.js';
test('AT-028: Spreadsheet computation and quantitative correctness', { timeout: 900_000 }, async () => {
  const result = await exerciseScenario('AT-028');
  assert.equal(result.scenario_id, 'AT-028');
  const expected = {
  "row_1501_affects_checked_total": true,
  "cached_values_not_called_recalculated": true,
  "hidden_dependencies_included": true,
  "missing_calculation_engine_blocks_numeric_ready": true,
  "unsupported_formulas_reported": true,
  "identifiers_and_money_rounding_preserved": true,
  "csv_canary_not_executed": true
};
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(result.observed[key], value, key);
  }
  assert.ok(result.artifact_paths.length > 0, 'retain actual evidence');
});
