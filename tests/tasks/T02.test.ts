import test from 'node:test';
import assert from 'node:assert/strict';
import { exerciseScenario } from '../harness/registry.js';
import '../scenarios/T02.scenarios.js';
test('AT-002: Durable lifecycle, transactions, leases, and outbox', async () => {
  const result = await exerciseScenario('AT-002');
  assert.equal(result.scenario_id, 'AT-002');
  const expected = {
  "created_run_count": 1,
  "changed_payload_conflict": true,
  "race_winner_count": 1,
  "acknowledged_run_survived_restart": true,
  "expired_result_rejected": true,
  "precontract_pause_block_cancel_persist": true,
  "cross_run_usage_budget_and_candidate_rejected": true,
  "late_revision_fences_stale_attempt": true
};
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(result.observed[key], value, key);
  }
  assert.ok(result.artifact_paths.length > 0, 'retain actual evidence');
});
