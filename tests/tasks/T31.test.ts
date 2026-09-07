import test from 'node:test';
import assert from 'node:assert/strict';
import { exerciseScenario } from '../harness/registry.js';
import '../scenarios/T31.scenarios.js';
test('AT-031: Company responsibilities, discovery, and authority', { timeout: 600_000 }, async () => {
  const result = await exerciseScenario('AT-031');
  assert.equal(result.scenario_id, 'AT-031');
  const expected = {
  "small_task_does_not_spawn_company_swarm": true,
  "substantive_task_has_owner_and_review_outputs": true,
  "high_risk_gates_cannot_be_lowered_by_writer": true,
  "research_claims_have_actual_provenance": true,
  "client_not_given_management_homework": true,
  "role_titles_do_not_grant_authority": true,
  "unapproved_purchase_or_legal_signoff_rejected": true
};
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(result.observed[key], value, key);
  }
  assert.ok(result.artifact_paths.length > 0, 'retain actual evidence');
});
