import test from 'node:test';
import assert from 'node:assert/strict';
import { exerciseScenario } from '../harness/registry.js';
import '../scenarios/T30.scenarios.js';
test('AT-030: Document jobs, quiet client experience, and the shared budget', { timeout: 900_000 }, async () => {
  const result = await exerciseScenario('AT-030');
  assert.equal(result.scenario_id, 'AT-030');
  const expected = {
  "document_only_needs_no_git_or_software_run": true,
  "create_without_input_documents_works": true,
  "questions_and_feedback_survive_restart": true,
  "stale_attempts_cannot_deliver": true,
  "software_and_document_budget_shared": true,
  "no_routine_role_reports": true,
  "partial_limitations_still_visible": true,
  "replayed_download_cannot_cross_projects": true
};
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(result.observed[key], value, key);
  }
  assert.ok(result.artifact_paths.length > 0, 'retain actual evidence');
});
