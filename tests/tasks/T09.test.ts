import test from 'node:test';
import assert from 'node:assert/strict';
import { exerciseScenario } from '../harness/registry.js';
import '../scenarios/T09.scenarios.js';
test('AT-009: Capability detection and explicit authentication/billing modes', async () => {
  const result = await exerciseScenario('AT-009');
  assert.equal(result.scenario_id, 'AT-009');
  const expected = {
  "unknown_capability_not_enabled": true,
  "configured_not_reported_as_tested": true,
  "billing_fallback_denied": true,
  "browser_gap_explicit": true,
  "unsupported_mcp_disabled": true,
  "toolkit_runtime_not_target_capability": true
};
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(result.observed[key], value, key);
  }
  assert.ok(result.artifact_paths.length > 0, 'retain actual evidence');
});
