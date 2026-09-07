/** `cm verify` and the one-command validation.
 *
 * `verify` takes a candidate id and nothing else. There is deliberately no parameter through
 * which a caller could pass a command string: the checks come from the protected policy.
 *
 * The validation command reports a missing prerequisite as blocked with a nonzero exit. An
 * absent tool is never converted into observed compatibility, and a mock-only run never
 * becomes a live one.
 */
import type { Candidate } from '../../../contracts/interfaces.js';
import type { VerificationCoordinator } from '../../../packages/verifier/src/coordinator.js';
import { EXIT_CODES, type ExitCode } from './main.js';

export type VerifyRequest = { candidate: Candidate; policy_digest: string; workspace_root: string; run_id: string; attempt_id: string; project_id: string; idempotency_key: string };

/** A caller-supplied command is refused here, before the coordinator is reached. */
export function rejectsCallerCommand(request: Record<string, unknown>): boolean {
  return ['argv', 'command', 'cmd', 'script', 'shell', 'exec'].some(key => key in request);
}

export async function verifyCandidate(input: {
  coordinator: VerificationCoordinator; request: VerifyRequest & Record<string, unknown>;
}): Promise<{ exit_code: ExitCode; verdict: 'accepted' | 'not_accepted'; reasons: string[] }> {
  if (rejectsCallerCommand(input.request)) {
    return { exit_code: EXIT_CODES.integrity_or_security, verdict: 'not_accepted', reasons: ['CALLER_SUPPLIED_COMMAND_REFUSED'] };
  }
  const outcome = await input.coordinator.verify({
    project_id: input.request.project_id, run_id: input.request.run_id, attempt_id: input.request.attempt_id,
    candidate: input.request.candidate, policy_digest: input.request.policy_digest,
    requested_check_ids: [], workspace_root: input.request.workspace_root,
    idempotency_key: input.request.idempotency_key,
  });
  return outcome.evidence.integrity_passed
    ? { exit_code: EXIT_CODES.ok, verdict: 'accepted', reasons: [] }
    : { exit_code: EXIT_CODES.verification_not_accepted, verdict: 'not_accepted', reasons: outcome.evidence.blocking_findings };
}

export type ValidationCheck = { name: string; required: boolean; available: boolean; detail: string };

export type ValidationOutcome = { exit_code: ExitCode; status: 'PASS' | 'BLOCKED'; blocked: string[]; checks: ValidationCheck[] };

/** One command, one honest answer. A missing required dependency is BLOCKED and nonzero. */
export function validate(checks: ValidationCheck[]): ValidationOutcome {
  const blocked = checks.filter(check => check.required && !check.available).map(check => `${check.name}: ${check.detail}`);
  return {
    exit_code: blocked.length === 0 ? EXIT_CODES.ok : EXIT_CODES.missing_capability,
    status: blocked.length === 0 ? 'PASS' : 'BLOCKED',
    blocked, checks,
  };
}
