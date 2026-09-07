import test from 'node:test';
import assert from 'node:assert/strict';
import { exerciseScenario } from '../harness/registry.js';
import '../scenarios/T25.scenarios.js';
test('AT-025: Document ingestion, immutable sources, and container safety', { timeout: 600_000 }, async () => {
  const result = await exerciseScenario('AT-025');
  assert.equal(result.scenario_id, 'AT-025');
  const expected = {
  "valid_files_stored_with_exact_digest": true,
  "upload_not_misreported_as_analyzed": true,
  "macro_and_network_canaries_not_executed": true,
  "size_and_expansion_limits_enforced": true,
  "cross_project_access_denied": true,
  "retry_preserves_one_source_identity": true
};
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(result.observed[key], value, key);
  }
  assert.ok(result.artifact_paths.length > 0, 'retain actual evidence');
});
