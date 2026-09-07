/** The local controller HTTP server.
 *
 * Loopback only, authenticated, origin-checked. It serves the console and the client API from
 * one origin so the console needs no cross-origin permission, and it refuses every mutation
 * that arrives without a session, a matching origin and a CSRF token.
 *
 * Long-running work never blocks a request: the state store answers from SQLite and provider
 * work happens elsewhere, so cancel stays responsive while a run is busy.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import type { ClientQuestion } from '../../../contracts/interfaces.js';
import type { LifecycleService } from '../../../packages/core/src/lifecycle.js';
import type { ControllerDatabase } from '../../../packages/state/src/database.js';
import { SessionStore, ALLOWED_ORIGINS, type Session } from './auth.js';
import { answerQuestion, listQuestions, submitMessage } from './routes.js';
import { encodeServerSentEvent, replay, type StreamMode } from './events.js';

export type ControllerServerOptions = {
  db: ControllerDatabase;
  service: LifecycleService;
  sessions: SessionStore;
  console_dir: string;
  project_id: string;
};

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    cookies[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return cookies;
}

function send(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    // The console is same-origin; nothing else may read these responses.
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  response.end(payload);
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > 1_048_576) throw new Error('PAYLOAD_TOO_LARGE');
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text === '' ? {} : JSON.parse(text) as Record<string, unknown>;
}

export function createControllerServer(options: ControllerServerOptions): Server {
  let requestCounter = 0;

  return createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const request_id = `req_${++requestCounter}`;
      const cookies = parseCookies(request.headers['cookie']);
      const headers: Record<string, string | undefined> = {
        origin: Array.isArray(request.headers['origin']) ? request.headers['origin'][0] : request.headers['origin'],
        'x-csrf-token': Array.isArray(request.headers['x-csrf-token']) ? request.headers['x-csrf-token'][0] : request.headers['x-csrf-token'],
        authorization: Array.isArray(request.headers['authorization']) ? request.headers['authorization'][0] : request.headers['authorization'],
      };

      try {
        // The console itself is public on loopback; the API underneath is not.
        if (request.method === 'GET' && !url.pathname.startsWith('/v1/')) {
          const file = path.join(options.console_dir, url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\//, ''));
          if (!file.startsWith(options.console_dir) || !existsSync(file)) { send(response, 404, { error: 'NOT_FOUND' }); return; }
          response.writeHead(200, { 'content-type': CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream' });
          response.end(readFileSync(file));
          return;
        }

        // A bootstrap exchange is the only unauthenticated API call.
        if (request.method === 'POST' && url.pathname === '/v1/session') {
          const body = await readJson(request);
          const session = options.sessions.exchange({
            bootstrap_secret: String(body['bootstrap_secret'] ?? ''),
            actor: 'client', actor_id: String(body['actor_id'] ?? 'owner'),
            origin: headers.origin ?? ALLOWED_ORIGINS[0],
          });
          if ('rejected' in session) { send(response, 403, { error: session.rejected, request_id }); return; }
          send(response, 201, { csrf_token: session.csrf_token, expires_at: session.expires_at },
            { 'set-cookie': options.sessions.cookieHeader(session) });
          return;
        }

        const auth = options.sessions.authenticate({
          method: request.method ?? 'GET', path: url.pathname, headers, cookies,
        });
        if (!auth.authenticated) {
          send(response, auth.status, { error: auth.reason, request_id });
          return;
        }
        const session: Session = auth.session;
        const context = {
          service: options.service, session, request_id,
          idempotency_key: Array.isArray(request.headers['idempotency-key']) ? request.headers['idempotency-key'][0] : request.headers['idempotency-key'],
          if_match: request.headers['if-match'] === undefined ? undefined : Number.parseInt(String(request.headers['if-match']), 10),
        };

        const questions = url.pathname.match(/^\/v1\/runs\/([^/]+)\/questions$/);
        if (request.method === 'GET' && questions !== null) {
          const rows = options.db.all('SELECT * FROM client_questions WHERE run_id = ?', questions[1]!)
            .map(row => ({
              kind: 'client_question', schema_version: 1,
              question_id: String(row['question_id']), project_id: String(row['project_id']),
              run_id: String(row['run_id']), requirements_revision: Number(row['requirements_revision']),
              state_version: Number(row['state_version']), prompt: String(row['prompt']),
              recommendation: row['recommendation'] === null ? null : String(row['recommendation']),
              blocking_task_ids: JSON.parse(String(row['blocking_task_ids_json'])) as string[],
              source_request_ids: JSON.parse(String(row['source_request_ids_json'])) as string[],
              status: String(row['status']) as ClientQuestion['status'],
              created_at: String(row['created_at']), updated_at: String(row['updated_at']),
            } satisfies ClientQuestion));
          const result = listQuestions(context, questions[1]!, rows);
          send(response, result.status, 'body' in result ? result.body : result.error);
          return;
        }

        const answer = url.pathname.match(/^\/v1\/questions\/([^/]+)\/answer$/);
        if (request.method === 'POST' && answer !== null) {
          const body = await readJson(request);
          const result = answerQuestion(context, {
            question_id: answer[1]!, message: String(body['message'] ?? ''),
            attachment_ids: Array.isArray(body['attachment_ids']) ? body['attachment_ids'] as string[] : [],
            project_id: options.project_id, language_hint: 'mixed',
          });
          send(response, result.status, 'body' in result ? result.body : result.error);
          return;
        }

        const messages = url.pathname.match(/^\/v1\/runs\/([^/]+)\/messages$/);
        if (request.method === 'POST' && messages !== null) {
          const body = await readJson(request);
          const result = submitMessage(context, {
            run_id: messages[1]!, message: String(body['message'] ?? ''),
            attachment_ids: Array.isArray(body['attachment_ids']) ? body['attachment_ids'] as string[] : [],
            project_id: options.project_id, language_hint: 'mixed',
          });
          send(response, result.status, 'body' in result ? result.body : result.error);
          return;
        }

        const events = url.pathname.match(/^\/v1\/runs\/([^/]+)\/events$/);
        if (request.method === 'GET' && events !== null) {
          const after = Number.parseInt(String(request.headers['last-event-id'] ?? url.searchParams.get('after') ?? '0'), 10) || 0;
          const mode = (url.searchParams.get('mode') ?? 'quiet') as StreamMode;
          const pending = replay(options.db, { run_id: events[1]!, after, mode });
          response.writeHead(200, {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-store',
            connection: 'keep-alive',
          });
          for (const event of pending) response.write(encodeServerSentEvent(event));
          // The fixture stream closes after replay; a long-lived stream keeps the socket open.
          response.end();
          return;
        }

        // Cancel is a control intent, and it returns immediately: recording the intent is not
        // waiting for the work to stop.
        const cancel = url.pathname.match(/^\/v1\/runs\/([^/]+)\/cancel$/);
        if (request.method === 'POST' && cancel !== null) {
          const started = process.hrtime.bigint();
          const intent = options.service.requestControl({ run_id: cancel[1]!, action: 'cancel', actor: 'controller', reason: 'client pressed cancel' });
          send(response, 200, { ...intent, recorded_in_ms: Number(process.hrtime.bigint() - started) / 1e6 });
          return;
        }

        send(response, 404, { error: 'NOT_FOUND', request_id });
      } catch (error) {
        send(response, 400, { error: 'BAD_REQUEST', message: String((error as Error).message).slice(0, 200), request_id });
      }
    })();
  });
}

export function listenLoopback(server: Server): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>(done => { server.close(() => done()); }),
      });
    });
  });
}
