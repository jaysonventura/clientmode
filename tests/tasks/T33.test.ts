import test from 'node:test';
import assert from 'node:assert/strict';
import { exerciseScenario } from '../harness/registry.js';
import '../scenarios/T33.scenarios.js';
test('AT-033: Complete v1.3 qualification and closure', { timeout: 1_800_000 }, async () => {
  const result = await exerciseScenario('AT-033');
  assert.equal(result.scenario_id, 'AT-033');
  const expected = {
  "real_document_formats_and_exports_qualified": true,
  "known_numeric_and_citation_defects_caught": true,
  "partial_or_forged_results_never_full_ready": true,
  "all_33_task_gates_have_evidence_or_no_go": true,
  "cross_stack_qualification_not_replaced_by_docs": true,
  "comparison_counts_all_attempts_and_costs": true,
  "new_document_state_survives_upgrade_restore": true,
  "client_acceptance_distinct_from_technical_ready": true,
  "only_verified_authorized_artifacts_released": true
};
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(result.observed[key], value, key);
  }
  assert.ok(result.artifact_paths.length > 0, 'retain actual evidence');
});
