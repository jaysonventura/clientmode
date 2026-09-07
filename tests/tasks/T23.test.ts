import test from 'node:test';
import assert from 'node:assert/strict';
import { exerciseScenario } from '../harness/registry.js';
import '../scenarios/T23.scenarios.js';
test('AT-023: Unseen holdout and live host qualification', { timeout: 3_600_000 }, async () => {
  const result = await exerciseScenario('AT-023');
  assert.equal(result.scenario_id, 'AT-023');
  const expected = {
  "holdout_not_used_for_prompt_tuning": true,
  "verified_success_at_least_90pct": true,
  "observed_false_ready_count": 0,
  "critical_high_escaped_defects": 0,
  "unnecessary_client_continue_prompts_median": 0,
  "supported_hosts_live_tested": true,
  "js_only_qualification_rejected": true,
  "cross_stack_holdouts_executed": true,
  "company_responsibility_coverage_observed_without_swarms": true
};
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(result.observed[key], value, key);
  }
  assert.ok(result.artifact_paths.length > 0, 'retain actual evidence');
});
