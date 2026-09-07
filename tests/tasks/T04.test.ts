import test from 'node:test';
import assert from 'node:assert/strict';
import { exerciseScenario } from '../harness/registry.js';
import '../scenarios/T04.scenarios.js';
test('AT-004: Policy routing, authority, budgets, and bounded repair', async () => {
  const result = await exerciseScenario('AT-004');
  assert.equal(result.scenario_id, 'AT-004');
  const expected = {
  "maximum_active_children": 2,
  "recursive_child_rejected": true,
  "duplicate_usage_counted_once": true,
  "new_calls_after_budget_stop": 0,
  "nonprogress_stopped": true,
  "unapproved_billing_or_tool_change_rejected": true,
  "responsibility_plan_not_agent_headcount": true,
  "new_scope_rechecks_authority_and_budget": true
};
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(result.observed[key], value, key);
  }
  assert.ok(result.artifact_paths.length > 0, 'retain actual evidence');
});
