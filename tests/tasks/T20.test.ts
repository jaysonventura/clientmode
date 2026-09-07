import test from 'node:test';
import assert from 'node:assert/strict';
import { exerciseScenario } from '../harness/registry.js';
import '../scenarios/T20.scenarios.js';
test('AT-020: Protected CI, deployment reconciliation, and operational runbooks', async () => {
  const result = await exerciseScenario('AT-020');
  assert.equal(result.scenario_id, 'AT-020');
  const expected = {
  "candidate_cannot_replace_protected_policy": true,
  "verified_artifact_promoted_unchanged": true,
  "deployment_reconciled_after_timeout": true,
  "migration_recovery_rehearsed": true,
  "runbooks_executed": true
};
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(result.observed[key], value, key);
  }
  assert.ok(result.artifact_paths.length > 0, 'retain actual evidence');
});
