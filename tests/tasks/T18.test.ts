import test from 'node:test';
import assert from 'node:assert/strict';
import { exerciseScenario } from '../harness/registry.js';
import '../scenarios/T18.scenarios.js';
test('AT-018: CLI launcher, versioned upgrades, migrations, and recovery', async () => {
  const result = await exerciseScenario('AT-018');
  assert.equal(result.scenario_id, 'AT-018');
  const expected = {
  "commands_match_operations_contract": true,
  "failed_upgrade_preserves_state": true,
  "concurrent_user_edit_not_overwritten": true,
  "recovery_1000_tasks_within_30s": true,
  "cancel_ack_within_1s": true,
  "owned_tree_stopped_within_10s_or_quarantined": true,
  "unavailable_validation_dependency_not_green": true
};
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(result.observed[key], value, key);
  }
  assert.ok(result.artifact_paths.length > 0, 'retain actual evidence');
});
