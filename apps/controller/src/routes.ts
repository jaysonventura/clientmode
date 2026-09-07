/** Local controller routes.
 *
 * These are the client-facing operations from `contracts/api.openapi.json`. Two boundaries are
 * enforced here rather than left to convention:
 *
 *   - answering a question and deciding an approval are different operations on different
 *     paths, and a business answer never reaches the approval path;
 *   - identity comes from the authenticated session, never from the request body, so no
 *     payload can name an actor.
 *
 * Handlers take an already-authenticated session. Authentication itself is `auth.ts`.
 */
import type { ClientAnswer, ClientQuestion, ClientRequest, RunMessage } from '../../../contracts/interfaces.js';
import type { LifecycleService } from '../../../packages/core/src/lifecycle.js';
import type { Session } from './auth.js';

export type RouteError = { status: 400 | 403 | 404 | 409 | 413 | 422; code: string; message: string; retryable: boolean; request_id: string };
export type RouteResult<T> = { status: 200 | 201; body: T } | { status: RouteError['status']; error: RouteError };

const failure = (status: RouteError['status'], code: string, message: string, request_id: string, retryable = false): RouteResult<never> =>
  ({ status, error: { status, code, message, retryable, request_id } });

export type RouteContext = {
  service: LifecycleService;
  session: Session;
  request_id: string;
  idempotency_key?: string | undefined;
  if_match?: number | undefined;
};

/** GET /v1/runs/{run_id}/questions — one open question is visible at a time. */
export function listQuestions(context: RouteContext, run_id: string, rows: ClientQuestion[]): RouteResult<{ questions: ClientQuestion[]; queued: number }> {
  if (context.session.actor !== 'client' && context.session.actor !== 'maintainer') {
    return failure(403, 'ACTOR_CANNOT_READ_QUESTIONS', `${context.session.actor} is not a client session`, context.request_id);
  }
  const open = rows.filter(question => question.status === 'OPEN' && question.run_id === run_id);
  const queued = rows.filter(question => question.status === 'SUPERSEDED' && question.run_id === run_id).length;
  return { status: 200, body: { questions: open.slice(0, 1), queued } };
}

/** POST /v1/questions/{question_id}/answer — a business answer, and nothing else. */
export function answerQuestion(context: RouteContext, input: {
  question_id: string; message: string; attachment_ids: string[]; project_id: string; language_hint: ClientRequest['language_hint'];
}): RouteResult<ClientAnswer> {
  if (context.session.actor !== 'client') {
    return failure(403, 'ACTOR_CANNOT_ANSWER', 'only an authenticated client session answers a client question', context.request_id);
  }
  if (context.if_match === undefined) {
    return failure(409, 'IF_MATCH_REQUIRED', 'answering requires the question version', context.request_id);
  }
  if (context.idempotency_key === undefined) {
    return failure(400, 'IDEMPOTENCY_KEY_REQUIRED', 'a mutation requires an idempotency key', context.request_id);
  }
  if (input.message.trim() === '') {
    return failure(422, 'EMPTY_ANSWER', 'an answer needs content', context.request_id);
  }
  const request: ClientRequest = {
    kind: 'client_request', schema_version: 1,
    request_id: `request_${context.idempotency_key}`, project_id: input.project_id,
    message: input.message, language_hint: input.language_hint,
    attachment_ids: input.attachment_ids, privacy_class: 'internal',
    created_at: new Date().toISOString(),
  };
  try {
    const answer = context.service.answerQuestion({
      question_id: input.question_id, expected_version: context.if_match, request,
      authenticated_actor_id: context.session.actor_id, actor: 'client',
      idempotency_key: context.idempotency_key,
    });
    return { status: 201, body: answer };
  } catch (error) {
    const failed = error as { code?: string; message: string };
    const status = failed.code === 'STATE_VERSION_CONFLICT' || failed.code === 'QUESTION_NOT_OPEN' ? 409
      : failed.code === 'CROSS_PROJECT_ANSWER' ? 403
      : failed.code === 'UNKNOWN_QUESTION' ? 404 : 422;
    return failure(status, failed.code ?? 'ANSWER_REJECTED', failed.message, context.request_id);
  }
}

/** POST /v1/runs/{run_id}/messages — new instructions while work is active. Receipt is
 * recorded; it is not an acceptance verdict and it needs no candidate. */
export function submitMessage(context: RouteContext, input: {
  run_id: string; message: string; attachment_ids: string[]; project_id: string; language_hint: ClientRequest['language_hint'];
}): RouteResult<RunMessage> {
  if (context.session.actor !== 'client') {
    return failure(403, 'ACTOR_CANNOT_MESSAGE', 'only an authenticated client session sends a run message', context.request_id);
  }
  if (context.if_match === undefined) return failure(409, 'IF_MATCH_REQUIRED', 'a run message requires the run version', context.request_id);
  if (context.idempotency_key === undefined) return failure(400, 'IDEMPOTENCY_KEY_REQUIRED', 'a mutation requires an idempotency key', context.request_id);
  const request: ClientRequest = {
    kind: 'client_request', schema_version: 1,
    request_id: `request_${context.idempotency_key}`, project_id: input.project_id,
    message: input.message, language_hint: input.language_hint,
    attachment_ids: input.attachment_ids, privacy_class: 'internal',
    created_at: new Date().toISOString(),
  };
  try {
    return { status: 201, body: context.service.submitMessage({
      run_id: input.run_id, expected_version: context.if_match, request,
      authenticated_actor_id: context.session.actor_id, idempotency_key: context.idempotency_key,
    }) };
  } catch (error) {
    const failed = error as { code?: string; message: string };
    const status = failed.code === 'STATE_VERSION_CONFLICT' ? 409 : failed.code === 'UNKNOWN_RUN' ? 404 : 422;
    return failure(status, failed.code ?? 'MESSAGE_REJECTED', failed.message, context.request_id);
  }
}

/** The separation the protocol requires, made explicit for anyone wiring a client. */
export const CLIENT_ROUTES = {
  questions: { method: 'GET', path: '/v1/runs/{run_id}/questions', grants: 'nothing' },
  answer: { method: 'POST', path: '/v1/questions/{question_id}/answer', grants: 'nothing; a business answer is not a permission' },
  message: { method: 'POST', path: '/v1/runs/{run_id}/messages', grants: 'nothing; receipt is not acceptance' },
  approval_decision: { method: 'POST', path: '/v1/approvals/{approval_id}/decision', grants: 'exactly the approved scope, once' },
} as const;
