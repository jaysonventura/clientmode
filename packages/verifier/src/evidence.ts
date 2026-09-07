/** Evidence signing and envelope authentication.
 *
 * The signing key belongs to the verification authority and to nothing else. There is no
 * generic "sign this JSON" entry point a worker could reach: sealing takes an Evidence record
 * the coordinator produced, and the private key never leaves this module or its 0600 file in
 * the authority's own directory.
 *
 * A signature proves who observed and that the bytes are unaltered. It does not prove the
 * checks were well designed, and nothing here claims that.
 */
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign as signBytes, verify as verifyBytes, type KeyObject } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Actor, Evidence, SignedEnvelope } from '../../../contracts/interfaces.js';
import { validateEntity } from '../../contracts/src/validate.js';
import type { ProtectedPolicyStore } from './policy.js';

export const MAXIMUM_PAYLOAD_BASE64 = 1_400_000;
export const MAXIMUM_PAYLOAD_BYTES = 1_048_576;

export class EvidenceError extends Error {
  constructor(public readonly code: string, subject = '') {
    super(subject === '' ? code : `${code}: ${subject}`);
    this.name = 'EvidenceError';
  }
}

/** Public keys come from protected configuration, with a validity window and revocation. */
export class TrustStore {
  readonly #store: ProtectedPolicyStore;
  constructor(store: ProtectedPolicyStore) { this.#store = store; }

  register(input: { issuer_id: string; public_key_pem: string; not_before: string }): void {
    this.#store.raw().prepare('INSERT OR REPLACE INTO issuer_public_keys (issuer_id, public_key_pem, not_before, revoked_at) VALUES (?,?,?,NULL)')
      .run(input.issuer_id, input.public_key_pem, input.not_before);
  }

  revoke(issuer_id: string, at: string): void {
    this.#store.raw().prepare('UPDATE issuer_public_keys SET revoked_at = ? WHERE issuer_id = ?').run(at, issuer_id);
  }

  resolve(issuer_id: string, now: string): { key: KeyObject } | { rejected: 'UNKNOWN_ISSUER' | 'ISSUER_REVOKED' | 'ISSUER_NOT_YET_VALID' | 'WRONG_KEY_TYPE' } {
    const row = this.#store.raw().prepare('SELECT * FROM issuer_public_keys WHERE issuer_id = ?').get(issuer_id) as Record<string, unknown> | undefined;
    if (!row) return { rejected: 'UNKNOWN_ISSUER' };
    if (row['revoked_at'] !== null && Date.parse(String(row['revoked_at'])) <= Date.parse(now)) return { rejected: 'ISSUER_REVOKED' };
    if (Date.parse(String(row['not_before'])) > Date.parse(now)) return { rejected: 'ISSUER_NOT_YET_VALID' };
    const key = createPublicKey(String(row['public_key_pem']));
    if (key.asymmetricKeyType !== 'ed25519') return { rejected: 'WRONG_KEY_TYPE' };
    return { key };
  }
}

/** Held by the verification authority. Constructing it requires the authority's key file. */
export class EvidenceSigner {
  readonly issuer_id: string;
  readonly #private: KeyObject;

  private constructor(issuer_id: string, key: KeyObject) {
    this.issuer_id = issuer_id;
    this.#private = key;
  }

  /** The key material lives beside the protected policy store, at 0600, and is never copied
   * into a candidate workspace or handed to a provider context. */
  static open(input: { authority_dir: string; issuer_id: string; trust: TrustStore; now: string }): EvidenceSigner {
    const keyFile = path.join(input.authority_dir, `${input.issuer_id}.ed25519.key`);
    if (!existsSync(keyFile)) {
      const pair = generateKeyPairSync('ed25519');
      writeFileSync(keyFile, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), { mode: 0o600 });
      chmodSync(keyFile, 0o600);
      input.trust.register({
        issuer_id: input.issuer_id,
        public_key_pem: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
        not_before: input.now,
      });
    }
    return new EvidenceSigner(input.issuer_id, createPrivateKey(readFileSync(keyFile, 'utf8')));
  }

  /** Seals an Evidence record. There is deliberately no method that signs arbitrary bytes. */
  seal(evidence: Evidence, actor: Actor): SignedEnvelope {
    if (actor !== 'verifier') throw new EvidenceError('ACTOR_CANNOT_SIGN_EVIDENCE', actor);
    if (evidence.issuer_id !== this.issuer_id) throw new EvidenceError('ISSUER_MISMATCH', evidence.issuer_id);
    const validation = validateEntity(evidence);
    if (!validation.valid) throw new EvidenceError('INVALID_EVIDENCE', validation.errors.join('; '));
    const payload = Buffer.from(JSON.stringify(evidence), 'utf8');
    if (payload.byteLength > MAXIMUM_PAYLOAD_BYTES) throw new EvidenceError('PAYLOAD_TOO_LARGE', String(payload.byteLength));
    return {
      kind: 'signed_envelope', schema_version: 1, issuer_id: this.issuer_id, algorithm: 'Ed25519',
      payload_base64: payload.toString('base64'),
      signature_base64: signBytes(null, payload, this.#private).toString('base64'),
    };
  }
}

function strictBase64(value: unknown): Buffer | null {
  if (typeof value !== 'string' || value.length === 0 || value.length % 4 !== 0) return null;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return null;
  const bytes = Buffer.from(value, 'base64');
  return bytes.toString('base64') === value ? bytes : null;
}

export type OpenedEnvelope =
  | { opened: true; evidence: Evidence; issuer_id: string }
  | { opened: false; reasons: string[] };

/** Authenticate the envelope and return the exact bytes that were signed, parsed and
 * schema-validated. Anything short of that is a rejection with a reason. */
export function openEnvelope(input: { envelope: unknown; trust: TrustStore; now: string }): OpenedEnvelope {
  const reasons: string[] = [];
  const envelope = input.envelope as Partial<SignedEnvelope> | null;
  if (envelope === null || typeof envelope !== 'object' || Array.isArray(envelope)) return { opened: false, reasons: ['INVALID_ENVELOPE'] };
  if (envelope.kind !== 'signed_envelope' || envelope.schema_version !== 1) reasons.push('UNSUPPORTED_ENVELOPE_SCHEMA');
  if (envelope.algorithm !== 'Ed25519') reasons.push('UNSUPPORTED_ALGORITHM');
  if (typeof envelope.issuer_id !== 'string' || envelope.issuer_id.length === 0) reasons.push('MISSING_ISSUER');
  if (typeof envelope.payload_base64 !== 'string' || envelope.payload_base64.length > MAXIMUM_PAYLOAD_BASE64) reasons.push('PAYLOAD_LIMIT');
  if (reasons.length > 0) return { opened: false, reasons };

  const resolved = input.trust.resolve(envelope.issuer_id!, input.now);
  if ('rejected' in resolved) return { opened: false, reasons: [resolved.rejected] };

  const payload = strictBase64(envelope.payload_base64);
  const signature = strictBase64(envelope.signature_base64);
  if (payload === null || signature === null || payload.byteLength > MAXIMUM_PAYLOAD_BYTES || signature.byteLength !== 64) {
    return { opened: false, reasons: ['MALFORMED_ENCODING'] };
  }
  if (!verifyBytes(null, payload, resolved.key, signature)) return { opened: false, reasons: ['INVALID_SIGNATURE'] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload.toString('utf8'));
  } catch {
    return { opened: false, reasons: ['MALFORMED_PAYLOAD'] };
  }
  const validation = validateEntity(parsed);
  if (!validation.valid) return { opened: false, reasons: ['INVALID_EVIDENCE', ...validation.errors.slice(0, 5)] };
  const evidence = parsed as Evidence;
  if (evidence.kind !== 'evidence') return { opened: false, reasons: ['NOT_EVIDENCE'] };
  if (evidence.issuer_id !== envelope.issuer_id) return { opened: false, reasons: ['ISSUER_IDENTITY'] };
  return { opened: true, evidence, issuer_id: envelope.issuer_id! };
}
