/** Post-deployment observation.
 *
 * A deployment that reached the destination is not a release. RELEASED requires smoke probes
 * that actually ran against the deployed environment and passed. A failed probe leaves the
 * deployment FAILED and hands it to the recovery path.
 */
import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { markStatus, type DeploymentRecord } from './deploy.js';

export type SmokeProbe = {
  probe_id: string;
  run: () => Promise<{ passed: boolean; detail: string }>;
};

export type SmokeResult = {
  probe_id: string;
  passed: boolean;
  detail: string;
  observed_at: string;
};

export type SmokeOutcome = {
  deployment: DeploymentRecord;
  results: SmokeResult[];
  released: boolean;
  blocking: string[];
};

export async function runSmoke(input: {
  db: DatabaseSync; deployment_id: string; probes: SmokeProbe[]; observer_id: string; now: () => string;
}): Promise<SmokeOutcome> {
  if (input.probes.length === 0) {
    // No probe is not a pass. A release with nothing observed stays unreleased.
    return { deployment: markStatus(input.db, input.deployment_id, 'FAILED', input.now()), results: [], released: false, blocking: ['NO_SMOKE_PROBES'] };
  }
  const results: SmokeResult[] = [];
  for (const probe of input.probes) {
    const outcome = await probe.run().catch(error => ({ passed: false, detail: String((error as Error).message).slice(0, 300) }));
    const result = { probe_id: probe.probe_id, passed: outcome.passed, detail: outcome.detail, observed_at: input.now() };
    results.push(result);
    // The identity is the observation, not the probe: the same probe run again on the same
    // deployment is a second observation and must not overwrite the first.
    const evidence_digest = `sha256:${createHash('sha256').update(`${input.deployment_id}|${JSON.stringify(result)}`).digest('hex')}`;
    input.db.prepare('INSERT INTO deployment_observations (observation_id, deployment_id, observer_id, evidence_digest, result_json, observed_at) VALUES (?,?,?,?,?,?)')
      .run(`obs_${evidence_digest.slice(7, 39)}`, input.deployment_id, input.observer_id,
        evidence_digest, JSON.stringify(result), result.observed_at);
  }
  const blocking = results.filter(result => !result.passed).map(result => `${result.probe_id}:${result.detail}`);
  const released = blocking.length === 0;
  return {
    deployment: markStatus(input.db, input.deployment_id, released ? 'RELEASED' : 'FAILED', input.now()),
    results, released, blocking,
  };
}
