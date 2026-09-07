import test from 'node:test';
import assert from 'node:assert/strict';
import { exerciseScenario } from '../harness/registry.js';
import '../scenarios/T16.scenarios.js';
test('AT-016: Complete delivery loop, preview handoff, feedback, and resumption', async () => {
  const result = await exerciseScenario('AT-016');
  assert.equal(result.scenario_id, 'AT-016');
  const expected = {
  "routine_continue_prompts": 0,
  "preview_bound_to_verified_candidate": true,
  "feedback_new_candidate_verified": true,
  "resume_without_repeating_brief": true,
  "missing_integration_not_reported_live": true,
  "cross_stack_integrated_verification_required": true,
  "affected_gap_visible_without_blanket_stop": true,
  "client_feedback_not_self_certified": true,
  "new_requirement_during_verify_invalidates_ready": true,
  "recovery_returns_to_correct_phase": true
};
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(result.observed[key], value, key);
  }
  assert.ok(result.artifact_paths.length > 0, 'retain actual evidence');
});
