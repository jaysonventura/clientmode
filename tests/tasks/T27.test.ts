import test from 'node:test';
import assert from 'node:assert/strict';
import { exerciseScenario } from '../harness/registry.js';
import '../scenarios/T27.scenarios.js';
test('AT-027: Cross-document reasoning, questions, and source changes', { timeout: 900_000 }, async () => {
  const result = await exerciseScenario('AT-027');
  assert.equal(result.scenario_id, 'AT-027');
  const expected = {
  "conflicts_have_both_source_locations": true,
  "facts_and_suggestions_distinguished": true,
  "client_answer_not_invented": true,
  "changed_sources_invalidate_derived_results": true,
  "access_revocation_applies_to_cache": true,
  "document_text_cannot_grant_authority": true
};
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(result.observed[key], value, key);
  }
  assert.ok(result.artifact_paths.length > 0, 'retain actual evidence');
});
