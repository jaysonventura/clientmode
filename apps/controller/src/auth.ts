/** Local client authentication for the controller's loopback API.
 *
 * Client identity comes from an authenticated session, never from model text and never from a
 * worker token. A worker token is a different credential class: it can submit work, and it can
 * never answer a client question or decide an approval.
 *
 * Loopback constraint, stated rather than glossed: on `http://127.0.0.1` the `Secure` cookie
 * attribute would prevent the cookie being sent at all, so it is not set. The session is
 * therefore protected by HttpOnly, SameSite=Strict, an origin check, a CSRF token bound to the
 * session, and a short TTL — not by transport encryption.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Actor } from '../../../contracts/interfaces.js';

export const SESSION_TTL_SECONDS = 900;
export const ALLOWED_ORIGINS = ['http://127.0.0.1', 'http://localhost'] as const;

export type Session = {
  session_id: string;
  actor: Actor;
  actor_id: string;
  csrf_token: string;
  expires_at: string;
  origin: string;
};

export type IncomingRequest = {
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
  cookies: Record<string, string | undefined>;
};

export type AuthOutcome =
  | { authenticated: true; session: Session }
  | { authenticated: false; status: 401 | 403; reason: string };

function constantTimeEquals(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** State-changing methods require the CSRF token; safe methods do not. */
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export class SessionStore {
  readonly #sessions = new Map<string, Session>();
  readonly #bootstrapSecret: string;
  readonly #now: () => string;

  constructor(options: { bootstrap_secret?: string; clock?: () => string } = {}) {
    this.#bootstrapSecret = options.bootstrap_secret ?? randomBytes(32).toString('base64url');
    this.#now = options.clock ?? (() => new Date().toISOString());
  }

  get bootstrapSecret(): string { return this.#bootstrapSecret; }

  /** The one-time bootstrap secret is exchanged for a short-lived session. */
  exchange(input: { bootstrap_secret: string; actor: Actor; actor_id: string; origin: string }): Session | { rejected: string } {
    if (!constantTimeEquals(input.bootstrap_secret, this.#bootstrapSecret)) return { rejected: 'BAD_BOOTSTRAP_SECRET' };
    if (!ALLOWED_ORIGINS.some(allowed => input.origin.startsWith(allowed))) return { rejected: 'ORIGIN_NOT_ALLOWED' };
    if (input.actor !== 'client' && input.actor !== 'maintainer') return { rejected: 'ACTOR_NOT_A_CLIENT_SESSION' };
    const session: Session = {
      session_id: randomBytes(24).toString('base64url'),
      actor: input.actor, actor_id: input.actor_id,
      csrf_token: randomBytes(24).toString('base64url'),
      expires_at: new Date(Date.parse(this.#now()) + SESSION_TTL_SECONDS * 1000).toISOString(),
      origin: input.origin,
    };
    this.#sessions.set(session.session_id, session);
    return session;
  }

  /** Cookie attributes for a loopback origin, with the Secure omission made explicit. */
  cookieHeader(session: Session): string {
    return [
      `cm_session=${session.session_id}`,
      'HttpOnly',
      'SameSite=Strict',
      'Path=/',
      `Max-Age=${SESSION_TTL_SECONDS}`,
    ].join('; ');
  }

  readonly cookie_notes = [
    'Secure is intentionally absent: the controller listens on loopback HTTP and a Secure cookie would never be sent.',
    'Protection is HttpOnly + SameSite=Strict + origin check + per-session CSRF token + 900s TTL.',
    'This is a single-user local controller, not a public multi-tenant service.',
  ];

  authenticate(request: IncomingRequest): AuthOutcome {
    // A worker credential is never upgraded into a client session, whatever it presents.
    if (request.headers['authorization']?.startsWith('Worker ') === true) {
      return { authenticated: false, status: 403, reason: 'WORKER_TOKEN_CANNOT_ACT_AS_CLIENT' };
    }
    const session_id = request.cookies['cm_session'];
    if (session_id === undefined) return { authenticated: false, status: 401, reason: 'NO_SESSION' };
    const session = this.#sessions.get(session_id);
    if (session === undefined) return { authenticated: false, status: 401, reason: 'UNKNOWN_SESSION' };
    if (Date.parse(session.expires_at) <= Date.parse(this.#now())) {
      this.#sessions.delete(session_id);
      return { authenticated: false, status: 401, reason: 'SESSION_EXPIRED' };
    }
    const origin = request.headers['origin'];
    if (origin !== undefined && !ALLOWED_ORIGINS.some(allowed => origin.startsWith(allowed))) {
      return { authenticated: false, status: 403, reason: 'ORIGIN_NOT_ALLOWED' };
    }
    if (MUTATING.has(request.method.toUpperCase())) {
      if (origin === undefined) return { authenticated: false, status: 403, reason: 'ORIGIN_HEADER_REQUIRED' };
      const csrf = request.headers['x-csrf-token'];
      if (csrf === undefined || !constantTimeEquals(csrf, session.csrf_token)) {
        return { authenticated: false, status: 403, reason: 'CSRF_TOKEN_INVALID' };
      }
    }
    return { authenticated: true, session };
  }

  expire(session_id: string): void { this.#sessions.delete(session_id); }
}
