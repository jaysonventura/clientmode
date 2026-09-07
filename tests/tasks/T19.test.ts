import test from 'node:test';
import assert from 'node:assert/strict';
import { exerciseScenario } from '../harness/registry.js';
import '../scenarios/T19.scenarios.js';
test('AT-019: Audit, metrics, redaction, retention, and operator health', async () => {
  const result = await exerciseScenario('AT-019');
  assert.equal(result.scenario_id, 'AT-019');
  const expected = {
  "secret_canaries_redacted": true,
  "cross_project_read_denied": true,
  "retention_policy_enforced": true,
  "telemetry_default_off": true,
  "unknown_usage_not_zero": true,
  "failed_attempt_cost_included": true
};
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(result.observed[key], value, key);
  }
  assert.ok(result.artifact_paths.length > 0, 'retain actual evidence');
});
