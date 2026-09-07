import test from 'node:test';
import assert from 'node:assert/strict';
import { exerciseScenario } from '../harness/registry.js';
import '../scenarios/T14.scenarios.js';
test('AT-014: Design workflow, assets, accessibility, and independent UX review', async () => {
  const result = await exerciseScenario('AT-014');
  assert.equal(result.scenario_id, 'AT-014');
  const expected = {
  "design_system_applied": true,
  "primary_journey_operable": true,
  "error_empty_loading_states_present": true,
  "feedback_preserves_business_rules": true,
  "asset_provenance_recorded": true,
  "human_taste_not_auto_claimed": true,
  "native_ux_not_replaced_by_web": true,
  "ui_and_ux_responsibilities_have_observed_outputs": true
};
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(result.observed[key], value, key);
  }
  assert.ok(result.artifact_paths.length > 0, 'retain actual evidence');
});
