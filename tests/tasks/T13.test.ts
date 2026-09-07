import test from 'node:test';
import assert from 'node:assert/strict';
import { exerciseScenario } from '../harness/registry.js';
import '../scenarios/T13.scenarios.js';
test('AT-013: Ordinary-language intake and AI-maintained project memory', async () => {
  const result = await exerciseScenario('AT-013');
  assert.equal(result.scenario_id, 'AT-013');
  const expected = {
  "excluded_business_rules_preserved": true,
  "technical_question_count": 0,
  "material_ambiguity_not_invented": true,
  "feedback_revision_incremented": true,
  "cross_project_memory_denied": true,
  "client_stack_intent_preserved": true,
  "no_client_stack_skill_homework": true,
  "material_question_before_candidate_answerable": true,
  "answer_replay_is_idempotent": true,
  "stale_or_cross_project_answer_rejected": true,
  "utf8_text_reference_ingested_inertly": true
};
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(result.observed[key], value, key);
  }
  assert.ok(result.artifact_paths.length > 0, 'retain actual evidence');
});
