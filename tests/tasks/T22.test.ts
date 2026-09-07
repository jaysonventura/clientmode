import test from 'node:test';
import assert from 'node:assert/strict';
import { exerciseScenario } from '../harness/registry.js';
import '../scenarios/T22.scenarios.js';
test('AT-022: Baseline benchmark and cost accounting', { timeout: 1_800_000 }, async () => {
  const result = await exerciseScenario('AT-022');
  assert.equal(result.scenario_id, 'AT-022');
  const expected = {
  "failures_retained_in_denominator": true,
  "unknown_cost_explicit": true,
  "all_worker_usage_accounted_or_flagged": true,
  "comparison_protocol_followed": true,
  "unsupported_superiority_claims_absent": true,
  "per_engineering_family_results_retained": true
};
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(result.observed[key], value, key);
  }
  assert.ok(result.artifact_paths.length > 0, 'retain actual evidence');
});
