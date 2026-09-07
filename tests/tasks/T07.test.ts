import test from 'node:test';
import assert from 'node:assert/strict';
import { exerciseScenario } from '../harness/registry.js';
import '../scenarios/T07.scenarios.js';
test('AT-007: Authenticated evidence and candidate-bound readiness', async () => {
  const result = await exerciseScenario('AT-007');
  assert.equal(result.scenario_id, 'AT-007');
  const expected = {
  "clean_candidate_verified": true,
  "stale_or_forged_evidence_rejected": true,
  "missing_or_skipped_checks_rejected": true,
  "worker_ready_write_denied": true,
  "worker_signing_denied": true,
  "partial_polyglot_evidence_rejected": true,
  "changed_native_or_model_artifact_invalidates_evidence": true
};
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(result.observed[key], value, key);
  }
  assert.ok(result.artifact_paths.length > 0, 'retain actual evidence');
});
