import test from 'node:test';
import assert from 'node:assert/strict';
import { exerciseScenario } from '../harness/registry.js';
import '../scenarios/T11.scenarios.js';
test('AT-011: Codex official adapter and native entry integration', async () => {
  const result = await exerciseScenario('AT-011');
  assert.equal(result.scenario_id, 'AT-011');
  const expected = {
  "protocol_events_normalized": true,
  "fresh_session_load_observed": true,
  "inherited_permissions_tested": true,
  "browser_surface_truthful": true,
  "unapproved_provider_fallback_denied": true
};
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(result.observed[key], value, key);
  }
  assert.ok(result.artifact_paths.length > 0, 'retain actual evidence');
});
