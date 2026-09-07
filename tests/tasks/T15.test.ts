import test from 'node:test';
import assert from 'node:assert/strict';
import { exerciseScenario } from '../harness/registry.js';
import '../scenarios/T15.scenarios.js';
test('AT-015: Quiet client console, local API, event replay, and accessibility', async () => {
  const result = await exerciseScenario('AT-015');
  assert.equal(result.scenario_id, 'AT-015');
  const expected = {
  "routine_narrative_messages": 0,
  "material_blocker_visible": true,
  "cancel_control_responsive": true,
  "event_replay_no_gaps_or_duplicates": true,
  "keyboard_primary_actions_operable": true,
  "cross_origin_mutations_denied": true,
  "answer_and_active_message_flow_without_candidate": true,
  "one_open_question_visible_per_run": true,
  "text_reference_html_is_not_executed": true
};
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(result.observed[key], value, key);
  }
  assert.ok(result.artifact_paths.length > 0, 'retain actual evidence');
});
