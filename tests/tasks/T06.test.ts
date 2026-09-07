import test from 'node:test';
import assert from 'node:assert/strict';
import { exerciseScenario } from '../harness/registry.js';
import '../scenarios/T06.scenarios.js';
test('AT-006: External browser/API probes and real qualification application', async () => {
  const result = await exerciseScenario('AT-006');
  assert.equal(result.scenario_id, 'AT-006');
  const expected = {
  "total_centavos": 13500,
  "persisted_orders_after_retry": 1,
  "invalid_requests_rejected": true,
  "guest_checkout_completed": true,
  "ui_mutations_detected": true,
  "external_probe_results_not_candidate_writable": true,
  "target_native_checks_executed": true,
  "native_and_model_defects_rejected": true
};
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(result.observed[key], value, key);
  }
  assert.ok(result.artifact_paths.length > 0, 'retain actual evidence');
});
