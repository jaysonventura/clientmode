/** Deployment. Promote the artifact that was already verified, once, and observe what
 * actually happened at the destination.
 *
 * The intent row and its idempotency key are committed before the destination is contacted,
 * so a crash between the two leaves a record to reconcile against. Reconciliation asks the
 * destination whether the operation exists; it never assumes, and it never turns DEPLOYING
 * into CANCELLED just because the local process stopped.
 */
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Attestation } from './attestation.js';
import { checkPromotable } from './attestation.js';
import { consumeApproval, type ApprovalScope } from './approvals.js';

export class DeploymentError extends Error {
  constructor(public readonly code: string, subject = '') {
    super(subject === '' ? code : `${code}: ${subject}`);
    this.name = 'DeploymentError';
  }
}

/** The destination is an external system. It gets an idempotency key and returns an
 * operation id; it is never asked to rebuild anything. */
export interface Destination {
  readonly name: string;
  promote(input: { artifact_digest: string; target_environment: string; idempotency_key: string }): Promise<{ operation_id: string }>;
  /** Used by reconciliation after an interrupted release. */
  lookup(idempotency_key: string): Promise<{ operation_id: string; state: 'IN_PROGRESS' | 'COMPLETE' | 'ABSENT' }>;
}

export type DeploymentRecord = {
  deployment_id: string;
  status: 'DEPLOYING' | 'RELEASED' | 'FAILED' | 'ROLLED_BACK';
  provider_operation_id: string | null;
  artifact_digest: string;
  target_environment: string;
  idempotency_key: string;
};

function read(db: DatabaseSync, deployment_id: string): DeploymentRecord {
  const row = db.prepare('SELECT * FROM deployments WHERE deployment_id = ?').get(deployment_id) as Record<string, unknown> | undefined;
  if (!row) throw new DeploymentError('UNKNOWN_DEPLOYMENT', deployment_id);
  return {
    deployment_id, status: String(row['status']) as DeploymentRecord['status'],
    provider_operation_id: row['provider_operation_id'] === null ? null : String(row['provider_operation_id']),
    artifact_digest: String(row['artifact_digest']), target_environment: String(row['target_environment']),
    idempotency_key: String(row['idempotency_key']),
  };
}

export type DeployOutcome =
  | { started: true; deployment_id: string; operation_id: string; replayed: boolean }
  | { started: false; reasons: string[] };

export async function deploy(input: {
  db: DatabaseSync; destination: Destination; attestation: Attestation;
  approval_id: string; scope: ApprovalScope; target_environment: string;
  current_policy_digest: string; current_requirements_revision: number;
  current_composite_manifest_digest?: string | null;
  idempotency_key: string; now: string;
  /** Test hook: stop after the intent is committed, before the destination is contacted. */
  crashAfterIntent?: boolean;
}): Promise<DeployOutcome> {
  const { db } = input;

  const existing = db.prepare('SELECT * FROM deployments WHERE project_id = ? AND idempotency_key = ?')
    .get(input.attestation.project_id, input.idempotency_key) as Record<string, unknown> | undefined;
  if (existing !== undefined && existing['provider_operation_id'] !== null) {
    return { started: true, deployment_id: String(existing['deployment_id']), operation_id: String(existing['provider_operation_id']), replayed: true };
  }

  const promotion = checkPromotable({
    attestation: input.attestation,
    artifact_digest_to_promote: input.attestation.artifact_digest,
    current_policy_digest: input.current_policy_digest,
    current_requirements_revision: input.current_requirements_revision,
    current_composite_manifest_digest: input.current_composite_manifest_digest ?? null,
    target_environment: input.target_environment,
    approved_environment: input.scope.target_environment,
  });
  if (!promotion.promotable) return { started: false, reasons: promotion.reasons };

  const deployment_id = existing === undefined ? `dep_${randomUUID()}` : String(existing['deployment_id']);
  if (existing === undefined) {
    const consumption = consumeApproval(db, {
      approval_id: input.approval_id, release_id: deployment_id, scope: input.scope, now: input.now,
    });
    if (!consumption.consumed) return { started: false, reasons: consumption.reasons };

    // Intent first: if the process dies now, reconciliation has something to ask about.
    db.prepare(`INSERT INTO deployments (deployment_id, project_id, approval_id, candidate_id, artifact_digest,
      target_environment, idempotency_key, provider_operation_id, status, recovery_plan_ref, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,NULL,'DEPLOYING',?,?,?)`)
      .run(deployment_id, input.attestation.project_id, input.approval_id, input.attestation.candidate_id,
        input.attestation.artifact_digest, input.target_environment, input.idempotency_key,
        'docs/OPERATIONS.md#recovery', input.now, input.now);
  }

  if (input.crashAfterIntent === true) throw new DeploymentError('SIMULATED_CRASH_AFTER_INTENT', deployment_id);

  const operation = await input.destination.promote({
    artifact_digest: input.attestation.artifact_digest,
    target_environment: input.target_environment,
    idempotency_key: input.idempotency_key,
  });
  db.prepare('UPDATE deployments SET provider_operation_id = ?, updated_at = ? WHERE deployment_id = ?')
    .run(operation.operation_id, input.now, deployment_id);
  return { started: true, deployment_id, operation_id: operation.operation_id, replayed: false };
}

export type Reconciliation = {
  deployment_id: string;
  destination_state: 'IN_PROGRESS' | 'COMPLETE' | 'ABSENT';
  action: 'ADOPTED_EXISTING_OPERATION' | 'SAFE_TO_RETRY' | 'AWAITING_DESTINATION';
  status: DeploymentRecord['status'];
};

/** After an interrupted release, ask the destination what exists before doing anything. */
export async function reconcile(input: {
  db: DatabaseSync; destination: Destination; deployment_id: string; now: string;
}): Promise<Reconciliation> {
  const record = read(input.db, input.deployment_id);
  const found = await input.destination.lookup(record.idempotency_key);
  if (found.state === 'ABSENT') {
    return { deployment_id: record.deployment_id, destination_state: 'ABSENT', action: 'SAFE_TO_RETRY', status: record.status };
  }
  input.db.prepare('UPDATE deployments SET provider_operation_id = ?, updated_at = ? WHERE deployment_id = ?')
    .run(found.operation_id, input.now, record.deployment_id);
  return {
    deployment_id: record.deployment_id, destination_state: found.state,
    action: found.state === 'COMPLETE' ? 'ADOPTED_EXISTING_OPERATION' : 'AWAITING_DESTINATION',
    status: record.status,
  };
}

/** RELEASED only after post-deploy observation succeeds. */
export function markStatus(db: DatabaseSync, deployment_id: string, status: DeploymentRecord['status'], now: string): DeploymentRecord {
  db.prepare('UPDATE deployments SET status = ?, updated_at = ? WHERE deployment_id = ?').run(status, now, deployment_id);
  return read(db, deployment_id);
}

export { read as readDeployment };
