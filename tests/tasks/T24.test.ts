import test from 'node:test';
import assert from 'node:assert/strict';
import { exerciseScenario } from '../harness/registry.js';
import '../scenarios/T24.scenarios.js';
test('AT-024: Base software release rehearsal', { timeout: 1_800_000 }, async () => {
  const result = await exerciseScenario('AT-024');
  assert.equal(result.scenario_id, 'AT-024');
  const expected = {
  "fresh_install_and_rollback_passed": true,
  "artifact_inventory_complete": true,
  "both_adapters_qualified": true,
  "production_publication_requires_approval": true,
  "client_not_required_to_manage_markdown_or_agents": true,
  "remit_separate_from_measured_qualification": true,
  "toolkit_app_client_and_release_signoffs_separate": true,
  "base_software_requirements_have_evidence_or_explicit_no_go": true
};
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(result.observed[key], value, key);
  }
  assert.ok(result.artifact_paths.length > 0, 'retain actual evidence');
});
