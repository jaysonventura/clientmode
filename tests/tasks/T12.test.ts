import test from 'node:test';
import assert from 'node:assert/strict';
import { exerciseScenario } from '../harness/registry.js';
import '../scenarios/T12.scenarios.js';
test('AT-012: Delivery orchestration, review independence, and context packets', async () => {
  const result = await exerciseScenario('AT-012');
  assert.equal(result.scenario_id, 'AT-012');
  const expected = {
  "single_integration_owner": true,
  "overlap_and_stale_result_rejected": true,
  "review_finding_has_reproduction": true,
  "untrusted_instructions_not_authority": true,
  "no_recursive_delegation": true,
  "stack_specific_grounding_required": true,
  "unfamiliar_stack_research_not_rejection": true,
  "toolkit_stack_not_forced_on_client": true,
  "relevant_company_responsibilities_assigned": true,
  "manager_title_cannot_elevate_permissions": true,
  "stale_worker_after_new_client_message_rejected": true
};
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(result.observed[key], value, key);
  }
  assert.ok(result.artifact_paths.length > 0, 'retain actual evidence');
});
