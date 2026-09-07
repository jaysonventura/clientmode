import test from 'node:test';
import assert from 'node:assert/strict';
import { exerciseScenario } from '../harness/registry.js';
import '../scenarios/T21.scenarios.js';
test('AT-021: Adversarial proof and failure-injection qualification', async () => {
  const result = await exerciseScenario('AT-021');
  assert.equal(result.scenario_id, 'AT-021');
  const expected = {
  "every_mandatory_public_attack_rejected": true,
  "no_unauthorized_external_effects": true,
  "late_worker_results_quarantined": true,
  "semantic_defects_rejected_despite_green_unit_tests": true,
  "cross_stack_false_ready_mutations_rejected": true,
  "contract_sql_api_invariants_regression": true,
  "late_instruction_cannot_silently_reverse_deploy": true
};
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(result.observed[key], value, key);
  }
  assert.ok(result.artifact_paths.length > 0, 'retain actual evidence');
});
