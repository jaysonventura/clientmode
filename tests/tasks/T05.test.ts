import test from 'node:test';
import assert from 'node:assert/strict';
import { exerciseScenario } from '../harness/registry.js';
import '../scenarios/T05.scenarios.js';
test('AT-005: Protected check registry and untrusted execution sandbox', async () => {
  const result = await exerciseScenario('AT-005');
  assert.equal(result.scenario_id, 'AT-005');
  const expected = {
  "unknown_check_rejected": true,
  "arbitrary_command_rejected": true,
  "secret_and_socket_access_denied": true,
  "timeout_tree_terminated_or_quarantined": true,
  "malformed_report_unverified": true,
  "missing_target_environment_not_passed": true
};
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(result.observed[key], value, key);
  }
  assert.ok(result.artifact_paths.length > 0, 'retain actual evidence');
});
