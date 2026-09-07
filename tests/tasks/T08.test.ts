import test from 'node:test';
import assert from 'node:assert/strict';
import { exerciseScenario } from '../harness/registry.js';
import '../scenarios/T08.scenarios.js';
test('AT-008: Client authentication, scoped approvals, and release consumption', async () => {
  const result = await exerciseScenario('AT-008');
  assert.equal(result.scenario_id, 'AT-008');
  const expected = {
  "worker_and_cross_origin_approval_denied": true,
  "replayed_or_wrong_artifact_approval_denied": true,
  "deployment_side_effect_count": 1,
  "failed_smoke_not_released": true,
  "rollback_requires_and_records_authority": true,
  "question_answer_never_grants_release_authority": true
};
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(result.observed[key], value, key);
  }
  assert.ok(result.artifact_paths.length > 0, 'retain actual evidence');
});
