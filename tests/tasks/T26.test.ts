import test from 'node:test';
import assert from 'node:assert/strict';
import { exerciseScenario } from '../harness/registry.js';
import '../scenarios/T26.scenarios.js';
test('AT-026: Document inventory, extraction, and citation integrity', { timeout: 900_000 }, async () => {
  const result = await exerciseScenario('AT-026');
  assert.equal(result.scenario_id, 'AT-026');
  const expected = {
  "all_required_units_inventoried": true,
  "hidden_and_late_rows_not_dropped": true,
  "citations_resolve_to_exact_source_version": true,
  "relevant_visuals_actually_inspected": true,
  "unreadable_units_reported": true,
  "truncation_cannot_become_complete": true
};
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(result.observed[key], value, key);
  }
  assert.ok(result.artifact_paths.length > 0, 'retain actual evidence');
});
