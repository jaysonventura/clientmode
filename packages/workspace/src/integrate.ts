/** Integration and candidate sealing. One integrator seals the final combined snapshot;
 * a worker's own test result is not acceptance, and a candidate is never created with a
 * fabricated artifact digest to break the snapshot -> build -> candidate dependency.
 */
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import type { Candidate, Contract } from '../../../contracts/interfaces.js';
import { digest } from '../../contracts/src/canonical.js';
import { checkFence, type FenceRejection } from '../../state/src/leases.js';
import type { ControllerDatabase } from '../../state/src/database.js';
import { isWritable, activeClaims, overlaps } from './ownership.js';
import { snapshot, type SourceManifest, type SelectOptions } from './snapshot.js';

export class IntegrationError extends Error {
  constructor(public readonly code: string, subject: string) {
    super(`${code}: ${subject}`);
    this.name = 'IntegrationError';
  }
}

/** Produces the built artifact for a sealed source snapshot. T05 supplies the isolated
 * implementation; without one there is no candidate, because there is no artifact. */
export interface ArtifactBuilder {
  readonly builder_id: string;
  build(input: { workspace_root: string; source: SourceManifest }): { artifact_digest: string; artifact_manifest: unknown };
}

export function environmentDigest(extra: Record<string, string> = {}): string {
  return digest({ platform: os.platform(), arch: os.arch(), node: process.versions.node, ...extra });
}

export type IntegrationCheck = { accepted: boolean; reason?: FenceRejection | 'PATH_NOT_OWNED' | 'OVERLAPPING_WRITE_CLAIM' };

/** A result may integrate only from a current lease, within its own write scope. */
export function checkIntegration(db: ControllerDatabase, result: {
  project_id: string; attempt_id: string; lease_epoch: number;
  requirements_revision?: number; base_source_digest?: string; changed_paths: string[];
}): IntegrationCheck {
  const fence = checkFence(db, {
    attempt_id: result.attempt_id, lease_epoch: result.lease_epoch,
    ...(result.requirements_revision === undefined ? {} : { requirements_revision: result.requirements_revision }),
    ...(result.base_source_digest === undefined ? {} : { base_source_digest: result.base_source_digest }),
  });
  if (!fence.accepted) return fence.reason === undefined ? { accepted: false } : { accepted: false, reason: fence.reason };
  const attempt = db.get('SELECT allowed_write_paths_json FROM task_attempts WHERE attempt_id = ?', result.attempt_id)!;
  const allowed = JSON.parse(String(attempt['allowed_write_paths_json'])) as string[];
  for (const file of result.changed_paths) {
    if (!isWritable(allowed, file)) return { accepted: false, reason: 'PATH_NOT_OWNED' };
  }
  for (const other of activeClaims(db, result.project_id)) {
    if (other.attempt_id === result.attempt_id) continue;
    for (const held of other.paths) {
      for (const file of result.changed_paths) {
        if (overlaps(held, file)) return { accepted: false, reason: 'OVERLAPPING_WRITE_CLAIM' };
      }
    }
  }
  return { accepted: true };
}

export type SealedCandidate = { candidate: Candidate; source: SourceManifest; artifact_manifest: unknown };

/** snapshot -> build -> artifact manifest -> persisted candidate, bound to contract and policy. */
export function sealCandidate(db: ControllerDatabase, input: {
  project_id: string; run_id: string; workspace_root: string; workspace_ref: string;
  contract: Contract; policy_digest: string; builder: ArtifactBuilder; now: string;
  environment_extra?: Record<string, string>;
}, options: SelectOptions = {}): SealedCandidate {
  if (input.contract.revision < 1) throw new IntegrationError('INVALID_REQUIREMENTS_REVISION', String(input.contract.revision));
  const source = snapshot(input.workspace_root, input.workspace_ref, options);
  const built = input.builder.build({ workspace_root: input.workspace_root, source });
  if (!/^sha256:[0-9a-f]{64}$/.test(built.artifact_digest)) {
    throw new IntegrationError('ARTIFACT_DIGEST_UNAVAILABLE', input.builder.builder_id);
  }
  const candidate: Candidate = {
    kind: 'candidate', schema_version: 1,
    candidate_id: `candidate_${randomUUID().replace(/-/g, '')}`,
    project_id: input.project_id, run_id: input.run_id,
    source_digest: source.source_digest, artifact_digest: built.artifact_digest,
    requirements_revision: input.contract.revision, policy_digest: input.policy_digest,
    environment_digest: environmentDigest({ builder: input.builder.builder_id, ...input.environment_extra }),
    created_at: input.now,
  };
  db.transaction(() => {
    db.run(`INSERT INTO candidates (candidate_id, project_id, run_id, source_digest, artifact_digest,
      requirements_revision, policy_digest, environment_digest, created_at) VALUES (?,?,?,?,?,?,?,?,?)`,
      candidate.candidate_id, candidate.project_id, candidate.run_id, candidate.source_digest,
      candidate.artifact_digest, candidate.requirements_revision, candidate.policy_digest,
      candidate.environment_digest, candidate.created_at);
  });
  return { candidate, source, artifact_manifest: built.artifact_manifest };
}
