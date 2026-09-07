import test from 'node:test';
import assert from 'node:assert/strict';
import { exerciseScenario } from '../harness/registry.js';
import '../scenarios/T01.scenarios.js';
test('AT-001: Contracts, repository bootstrap, and test harness', async () => {
  const result = await exerciseScenario('AT-001');
  assert.equal(result.scenario_id, 'AT-001');
  const expected = {
  "valid_examples_accepted": true,
  "malformed_candidates_rejected": 3,
  "unknown_scenario_rejected": true,
  "open_ended_engineering_context_accepted": true,
  "unsupported_grounding_claim_rejected": true,
  "conditional_contracts_reject_inconsistent_entities": true,
  "required_validator_absence_fails_closed": true
};
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(result.observed[key], value, key);
  }
  assert.ok(result.artifact_paths.length > 0, 'retain actual evidence');
});
