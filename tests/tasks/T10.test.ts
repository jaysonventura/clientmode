import test from 'node:test';
import assert from 'node:assert/strict';
import { exerciseScenario } from '../harness/registry.js';
import '../scenarios/T10.scenarios.js';
test('AT-010: Claude official adapter and native entry integration', async () => {
  const result = await exerciseScenario('AT-010');
  assert.equal(result.scenario_id, 'AT-010');
  const expected = {
  "protocol_events_normalized": true,
  "native_instructions_preserved": true,
  "fresh_session_load_observed": true,
  "worker_permission_escape_denied": true,
  "live_resume_verified": true
};
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(result.observed[key], value, key);
  }
  assert.ok(result.artifact_paths.length > 0, 'retain actual evidence');
});
