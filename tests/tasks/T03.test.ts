import test from 'node:test';
import assert from 'node:assert/strict';
import { exerciseScenario } from '../harness/registry.js';
import '../scenarios/T03.scenarios.js';
test('AT-003: Repository discovery, workspace ownership, and immutable candidates', async () => {
  const result = await exerciseScenario('AT-003');
  assert.equal(result.scenario_id, 'AT-003');
  const expected = {
  "original_changes_preserved": true,
  "order_independent_digest": true,
  "untracked_edit_changes_digest": true,
  "path_escape_rejected": true,
  "overlapping_writer_rejected": true,
  "polyglot_components_preserved": true,
  "non_js_source_edit_changes_digest": true,
  "no_typescript_intake_whitelist": true
};
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(result.observed[key], value, key);
  }
  assert.ok(result.artifact_paths.length > 0, 'retain actual evidence');
});
