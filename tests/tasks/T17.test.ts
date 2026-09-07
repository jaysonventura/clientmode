import test from 'node:test';
import assert from 'node:assert/strict';
import { exerciseScenario } from '../harness/registry.js';
import '../scenarios/T17.scenarios.js';
test('AT-017: Dual native plugin distributions and safe installation', async () => {
  const result = await exerciseScenario('AT-017');
  assert.equal(result.scenario_id, 'AT-017');
  const expected = {
  "both_distributions_self_contained": true,
  "native_formats_validated": true,
  "fresh_sessions_load_both": true,
  "unrelated_configuration_preserved": true,
  "uninstall_restores_owned_changes": true
};
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(result.observed[key], value, key);
  }
  assert.ok(result.artifact_paths.length > 0, 'retain actual evidence');
});
