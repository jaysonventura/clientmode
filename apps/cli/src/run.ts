/** `cm run` and the control commands.
 *
 * A request comes from an authorized local file. A path outside the authorized root is refused
 * before it is read, so a run cannot be created from somewhere the operator did not choose.
 */
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import type { ClientRequest, Run } from '../../../contracts/interfaces.js';
import type { LifecycleService } from '../../../packages/core/src/lifecycle.js';
import { EXIT_CODES, type ExitCode } from './main.js';

export type RunOutcome = { exit_code: ExitCode; run?: Run; error?: string };

export function readAuthorizedRequestFile(input: { file: string; authorized_root: string }): { text: string } | { error: string } {
  const root = realpathSync(path.resolve(input.authorized_root));
  const resolved = path.resolve(input.file);
  if (!existsSync(resolved)) return { error: `REQUEST_FILE_NOT_FOUND: ${resolved}` };
  const real = realpathSync(resolved);
  if (real !== root && !real.startsWith(root + path.sep)) return { error: `REQUEST_FILE_OUTSIDE_AUTHORIZED_ROOT: ${real}` };
  if (statSync(real).size > 1_048_576) return { error: 'REQUEST_FILE_TOO_LARGE' };
  return { text: readFileSync(real, 'utf8') };
}

export async function createRun(input: {
  service: LifecycleService; project_id: string; request_file: string;
  authorized_root: string; idempotency_key: string; now: string;
}): Promise<RunOutcome> {
  const read = readAuthorizedRequestFile({ file: input.request_file, authorized_root: input.authorized_root });
  if ('error' in read) return { exit_code: EXIT_CODES.input_or_contract_error, error: read.error };
  const request: ClientRequest = {
    kind: 'client_request', schema_version: 1,
    request_id: `request_${input.idempotency_key}`, project_id: input.project_id,
    message: read.text.trim(), language_hint: 'mixed', attachment_ids: [],
    privacy_class: 'internal', created_at: input.now,
  };
  try {
    return { exit_code: EXIT_CODES.ok, run: await input.service.createRun(request, input.idempotency_key) };
  } catch (error) {
    const failed = error as { code?: string; message: string };
    return {
      exit_code: failed.code === 'IDEMPOTENCY_KEY_CONFLICT' ? EXIT_CODES.input_or_contract_error : EXIT_CODES.internal,
      error: `${failed.code ?? 'RUN_REJECTED'}: ${failed.message}`,
    };
  }
}

export type CancelOutcome = {
  exit_code: ExitCode;
  acknowledged_in_ms: number;
  intent_id: string | null;
  leases_revoked: string[];
  /** Whether the controlled process tree actually stopped, checked rather than assumed. */
  tree: { terminated: boolean; quarantined: boolean; checked_after_ms: number } | null;
};

/** Cancel records intent immediately and reports the tree outcome separately. The two are
 * different facts: the first is ours, the second depends on processes we do not own. */
export function cancelRun(input: {
  service: LifecycleService; run_id: string;
  stopTree?: () => { terminated: boolean; quarantined: boolean; elapsed_ms: number };
}): CancelOutcome {
  const started = process.hrtime.bigint();
  const intent = input.service.requestControl({ run_id: input.run_id, action: 'cancel', actor: 'controller', reason: 'cm cancel' });
  const acknowledged_in_ms = Number(process.hrtime.bigint() - started) / 1e6;
  const stopped = input.stopTree?.();
  return {
    exit_code: EXIT_CODES.ok,
    acknowledged_in_ms,
    intent_id: intent.intent_id,
    leases_revoked: intent.leases_revoked,
    tree: stopped === undefined ? null : { terminated: stopped.terminated, quarantined: stopped.quarantined, checked_after_ms: stopped.elapsed_ms },
  };
}
