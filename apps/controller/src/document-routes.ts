/** The client's document routes.
 *
 * Same shape as the software routes, same authentication, and deliberately separate task
 * identities: a document question is answered on a document route, and a software question on
 * a software one. Sharing a card in the console is fine; sharing an identity is not.
 *
 * Nothing here is a narration surface. There is no route that reports what a role is doing,
 * because the client did not ask for a status meeting.
 */
import type { DocumentJob, DocumentQuestion } from '../../../contracts/interfaces.js';
import type { DocumentJobService } from '../../../packages/documents/src/jobs.js';
import type { DocumentStore } from '../../../packages/documents/src/ingest.js';
import { prepareDownload, type ArtifactRecord } from '../../../packages/documents/src/edit.js';
import type { RouteContext, RouteError, RouteResult } from './routes.js';

export const DOCUMENT_ROUTES = {
  upload: { method: 'POST', path: '/v1/projects/{project_id}/attachments', grants: 'an identity, not a safety verdict' },
  create_job: { method: 'POST', path: '/v1/document-jobs', grants: 'nothing; no software run is created' },
  job: { method: 'GET', path: '/v1/document-jobs/{job_id}', grants: 'nothing' },
  questions: { method: 'GET', path: '/v1/document-jobs/{job_id}/questions', grants: 'nothing' },
  answer: { method: 'POST', path: '/v1/document-questions/{question_id}/answer', grants: 'nothing; a business answer is not a permission' },
  message: { method: 'POST', path: '/v1/document-jobs/{job_id}/messages', grants: 'nothing; a new instruction fences the old attempt' },
  download: { method: 'GET', path: '/v1/document-artifacts/{artifact_id}', grants: 'read access to this project only' },
} as const;

const fail = (context: RouteContext, status: RouteError['status'], code: string, message: string, retryable = false): RouteResult<never> =>
  ({ status, error: { status, code, message, retryable, request_id: context.request_id } });

export function getJob(context: RouteContext, jobs: DocumentJobService, job_id: string, project_id: string): RouteResult<{ job: DocumentJob }> {
  const job = jobs.get(job_id);
  if (job.project_id !== project_id) return fail(context, 404, 'NOT_FOUND', 'no such document job in this project');
  return { status: 200, body: { job } };
}

export function listDocumentQuestions(context: RouteContext, jobs: DocumentJobService, job_id: string):
  RouteResult<{ questions: DocumentQuestion[]; open: number }> {
  const questions = jobs.openQuestions(job_id);
  // One open question at a time. The rest are queued, not shown.
  return { status: 200, body: { questions: questions.slice(0, 1), open: questions.length } };
}

export function answerDocumentQuestion(context: RouteContext, jobs: DocumentJobService, input: {
  question_id: string; project_id: string; request_id: string;
}): RouteResult<{ answer_id: string }> {
  if (context.session.actor !== 'client') {
    return fail(context, 403, 'ACTOR_CANNOT_ANSWER', 'only the authenticated client answers a document question');
  }
  const outcome = jobs.answerQuestion({
    question_id: input.question_id, project_id: input.project_id, request_id: input.request_id,
    actor: context.session.actor, authenticated_actor_id: context.session.actor_id,
  });
  return outcome.recorded
    ? { status: 201, body: { answer_id: outcome.answer.answer_id } }
    : fail(context, outcome.reason === 'UNKNOWN_QUESTION' ? 404 : 409, outcome.reason, 'the answer was not applied');
}

export function submitDocumentMessage(context: RouteContext, jobs: DocumentJobService, input: {
  job_id: string; project_id: string; expected_version: number; message: string;
}): RouteResult<{ instruction_revision: number; fenced_attempts: number }> {
  const job = jobs.get(input.job_id);
  if (job.project_id !== input.project_id) return fail(context, 404, 'NOT_FOUND', 'no such document job in this project');
  const revised = jobs.reviseInstructions({
    job_id: input.job_id, expected_version: input.expected_version,
    message: input.message, authenticated_actor_id: context.session.actor_id,
  });
  return { status: 201, body: { instruction_revision: revised.job.instruction_revision, fenced_attempts: revised.fenced_attempts.length } };
}

export type DownloadGrant = { filename: string; headers: Record<string, string> };

/** A download is checked against the project that owns the artifact, every time. A link that
 * worked yesterday for one project does not work today for another. */
export function downloadArtifact(context: RouteContext, input: {
  artifact: ArtifactRecord; bytes: Buffer; requested_name: string;
  artifact_project_id: string; session_project_id: string;
}): RouteResult<DownloadGrant> {
  if (input.artifact_project_id !== input.session_project_id) {
    return fail(context, 404, 'NOT_FOUND', 'no such artifact in this project');
  }
  const prepared = prepareDownload({ artifact: input.artifact, bytes: input.bytes, requested_name: input.requested_name });
  return prepared.allowed
    ? { status: 200, body: { filename: prepared.filename, headers: prepared.headers } }
    : fail(context, 409, prepared.reason, 'the artifact could not be served');
}

/** What the client is shown while a job runs. Progress is a state, not a narrative, and a
 * partial result keeps its limitations visible even in quiet mode. */
export type QuietView = {
  state: DocumentJob['state'];
  open_question: DocumentQuestion | null;
  /** Visible only when there is something the client has to decide or know. */
  notices: string[];
  role_reports: never[];
};

export function quietView(input: {
  job: DocumentJob; questions: DocumentQuestion[];
  limitations: string[]; coverage: 'COMPLETE' | 'PARTIAL' | null;
}): QuietView {
  const notices: string[] = [];
  if (input.coverage === 'PARTIAL') {
    // A partial result always says so, however quiet the mode.
    notices.push(...input.limitations.slice(0, 3));
    if (input.limitations.length === 0) notices.push('Some of the material could not be read; the result is partial.');
  }
  if (input.job.state === 'BLOCKED') notices.push('The job is blocked and needs something from you.');
  return {
    state: input.job.state,
    open_question: input.questions[0] ?? null,
    notices,
    role_reports: [],
  };
}

export { prepareDownload };
export type { DocumentStore };
