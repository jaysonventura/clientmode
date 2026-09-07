/** Rollback.
 *
 * Reverting production is an authorized operation in its own right. It needs a rollback-scoped
 * approval from an authenticated deciding actor, it records who authorized it, and an
 * irreversible step in the deployment blocks it rather than being papered over.
 */
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { consumeApproval, type ApprovalScope } from './approvals.js';
import { markStatus, type Destination, type DeploymentRecord } from './deploy.js';

export type RollbackOutcome =
  | { rolled_back: true; deployment: DeploymentRecord; authorized_by: string; operation_id: string }
  | { rolled_back: false; reasons: string[] };

export async function rollback(input: {
  db: DatabaseSync; destination: Destination; deployment_id: string;
  approval_id: string; scope: ApprovalScope; now: string;
  /** Migrations or other one-way steps that make binary rollback insufficient. */
  irreversible_steps?: string[];
}): Promise<RollbackOutcome> {
  const row = input.db.prepare('SELECT * FROM deployments WHERE deployment_id = ?').get(input.deployment_id) as Record<string, unknown> | undefined;
  if (!row) return { rolled_back: false, reasons: ['UNKNOWN_DEPLOYMENT'] };
  if (input.scope.action !== 'rollback') return { rolled_back: false, reasons: ['APPROVAL_ACTION_NOT_ROLLBACK'] };
  if ((input.irreversible_steps ?? []).length > 0) {
    return { rolled_back: false, reasons: ['IRREVERSIBLE_STEP_BLOCKS_ROLLBACK', ...(input.irreversible_steps ?? [])] };
  }

  const release_id = `rbk_${randomUUID()}`;
  const consumption = consumeApproval(input.db, {
    approval_id: input.approval_id, release_id, scope: input.scope, now: input.now,
  });
  if (!consumption.consumed) return { rolled_back: false, reasons: consumption.reasons };

  const operation = await input.destination.promote({
    artifact_digest: String(row['artifact_digest']),
    target_environment: String(row['target_environment']),
    idempotency_key: `${String(row['idempotency_key'])}:rollback`,
  });
  const approval = input.db.prepare('SELECT actor_id FROM approvals WHERE approval_id = ?').get(input.approval_id) as Record<string, unknown>;
  input.db.prepare('INSERT INTO authority_audit (audit_id, actor_id, operation, target_ref, decision, created_at) VALUES (?,?,?,?,?,?)')
    .run(`aud_rollback_${release_id}`, String(approval['actor_id']), 'rollback', input.deployment_id, 'allow', input.now);
  return {
    rolled_back: true,
    deployment: markStatus(input.db, input.deployment_id, 'ROLLED_BACK', input.now),
    authorized_by: String(approval['actor_id']),
    operation_id: operation.operation_id,
  };
}
