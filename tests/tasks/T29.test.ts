import test from 'node:test';
import assert from 'node:assert/strict';
import { exerciseScenario } from '../harness/registry.js';
import '../scenarios/T29.scenarios.js';
test('AT-029: Document editing, technical writing, export, and protected document QA', { timeout: 900_000 }, async () => {
  const result = await exerciseScenario('AT-029');
  assert.equal(result.scenario_id, 'AT-029');
  const expected = {
  "original_bytes_unchanged": true,
  "requested_editable_outputs_reopen": true,
  "business_meaning_preserved": true,
  "api_examples_executed_against_target_version": true,
  "rendered_layout_failures_caught": true,
  "worker_cannot_forge_document_ready": true,
  "artifact_download_matches_verified_digest": true
};
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(result.observed[key], value, key);
  }
  assert.ok(result.artifact_paths.length > 0, 'retain actual evidence');
});
