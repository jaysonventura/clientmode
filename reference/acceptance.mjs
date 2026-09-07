/**
 * Executable reference contract, NOT a production verifier or sandbox.
 * The caller owns trusted candidate/policy/attempt selection and public keys.
 * It must not accept those inputs from a worker as authoritative.
 * Signature validity does not prove observation quality or test adequacy.
 */
import { verify as verifySignature } from 'node:crypto';

const HASH = /^sha256:[0-9a-f]{64}$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.length > 0;
const count = value => Number.isSafeInteger(value) && value >= 0;
const reject = (...reasons) => ({ verdict: 'UNVERIFIED', reasons });
// Require a timezone-bearing ISO/RFC3339 shape; Date.parse alone accepts date-only input.
const time = value => typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  ? Date.parse(value) : NaN;
function base64(value) {
  if (!text(value) || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return null;
  const bytes = Buffer.from(value, 'base64');
  return bytes.toString('base64') === value ? bytes : null;
}

/** All trust/candidate/policy inputs must be obtained through protected state. */
export function evaluateEnvelope(input) {
  try {
    if (!object(input)) return reject('INVALID_INPUT');
    const {candidate, policy, envelope, trust, now, expectedAttemptId} = input;
    if (!object(candidate) || !object(policy) || !object(envelope) || !object(trust)) return reject('INVALID_INPUT');
    if (candidate.kind !== 'candidate' || candidate.schema_version !== 1 ||
        policy.kind !== 'policy' || policy.schema_version !== 1) return reject('UNSUPPORTED_SCHEMA');
    if (envelope.kind !== 'signed_envelope' || envelope.schema_version !== 1 || envelope.algorithm !== 'Ed25519') return reject('INVALID_ENVELOPE');
    if (!text(expectedAttemptId) || !Number.isFinite(time(now))) return reject('MISSING_TRUSTED_CONTEXT');
    if (policy.authority !== 'protected') return reject('ADVISORY_POLICY');
    if (!Array.isArray(policy.trusted_issuer_ids) || !policy.trusted_issuer_ids.includes(envelope.issuer_id)) return reject('UNTRUSTED_ISSUER');
    const issuer = Object.hasOwn(trust, envelope.issuer_id) ? trust[envelope.issuer_id] : null;
    if (!object(issuer) || issuer.revoked !== false || !issuer.publicKey) return reject('UNTRUSTED_KEY');
    if (issuer.publicKey.asymmetricKeyType !== 'ed25519') return reject('WRONG_KEY_TYPE');
    if (!text(envelope.payload_base64) || envelope.payload_base64.length > 1_400_000) return reject('PAYLOAD_LIMIT');
    const payload = base64(envelope.payload_base64);
    const signature = base64(envelope.signature_base64);
    if (!payload || payload.length > 1_048_576 || !signature || signature.length !== 64) return reject('MALFORMED_ENCODING');
    if (!verifySignature(null, payload, issuer.publicKey, signature)) return reject('INVALID_SIGNATURE');
    const evidence = JSON.parse(payload.toString('utf8'));
    return evaluateAuthenticatedEvidence({candidate, policy, evidence, now, expectedAttemptId, issuerId: envelope.issuer_id});
  } catch {
    return reject('MALFORMED_INPUT');
  }
}

// Internal only: callers must use evaluateEnvelope, not skip authentication.
function evaluateAuthenticatedEvidence({candidate, policy, evidence, now, expectedAttemptId, issuerId}) {
  if (!object(evidence) || evidence.kind !== 'evidence' || evidence.schema_version !== 1 || !text(evidence.evidence_id)) return reject('INVALID_EVIDENCE');
  const reasons = [];
  for (const key of ['candidate_id', 'project_id', 'run_id']) {
    if (!text(candidate[key]) || evidence[key] !== candidate[key]) reasons.push(`IDENTITY_${key}`);
  }
  for (const key of ['source_digest', 'artifact_digest', 'policy_digest', 'environment_digest']) {
    if (!HASH.test(candidate[key] ?? '') || evidence[key] !== candidate[key]) reasons.push(`IDENTITY_${key}`);
  }
  if (!Number.isSafeInteger(candidate.requirements_revision) || candidate.requirements_revision < 1 ||
      evidence.requirements_revision !== candidate.requirements_revision ||
      policy.requirements_revision !== candidate.requirements_revision) reasons.push('REQUIREMENTS_REVISION');
  if (policy.project_id !== candidate.project_id || policy.policy_digest !== candidate.policy_digest) reasons.push('POLICY_IDENTITY');
  if (evidence.attempt_id !== expectedAttemptId) reasons.push('STALE_ATTEMPT');
  if (evidence.issuer_id !== issuerId) reasons.push('ISSUER_IDENTITY');
  if (evidence.integrity_passed !== true) reasons.push('INTEGRITY_FAILED');
  if (!Array.isArray(evidence.blocking_findings) || evidence.blocking_findings.length !== 0) reasons.push('BLOCKING_FINDINGS');
  const start = time(evidence.started_at), finish = time(evidence.finished_at), current = time(now), created = time(candidate.created_at);
  if (![start, finish, current, created].every(Number.isFinite) || start < created || finish < start || finish > current ||
      !Number.isSafeInteger(policy.maximum_age_seconds) || policy.maximum_age_seconds <= 0 ||
      current - finish > policy.maximum_age_seconds * 1000) reasons.push('EVIDENCE_TIME');
  if (!Array.isArray(policy.checks) || policy.checks.length === 0 || !policy.checks.some(check => check?.required === true)) reasons.push('EMPTY_REQUIRED_POLICY');
  if (!Array.isArray(evidence.results)) return reject(...reasons, 'MISSING_RESULTS');
  const checks = new Map();
  for (const definition of policy.checks ?? []) {
    if (!object(definition) || !text(definition.check_id) || checks.has(definition.check_id) ||
        !HASH.test(definition.definition_digest ?? '') || typeof definition.required !== 'boolean' ||
        !['process','tests','browser','api','security'].includes(definition.result_kind) ||
        !count(definition.minimum_tests) || definition.maximum_skipped !== 0 ||
        !Array.isArray(definition.required_assertion_ids) || !definition.required_assertion_ids.every(text) ||
        new Set(definition.required_assertion_ids).size !== definition.required_assertion_ids.length ||
        (definition.result_kind !== 'process' && definition.minimum_tests === 0)) {
      reasons.push('INVALID_CHECK_POLICY'); continue;
    }
    checks.set(definition.check_id, definition);
  }
  const results = new Map();
  for (const result of evidence.results) {
    if (!object(result) || !text(result.check_id) || results.has(result.check_id) || !checks.has(result.check_id)) {
      reasons.push('DUPLICATE_OR_UNKNOWN_RESULT'); continue;
    }
    results.set(result.check_id, result);
  }
  for (const [id, definition] of checks) {
    const result = results.get(id);
    if (!result) { if (definition.required) reasons.push(`MISSING_${id}`); continue; }
    if (result.definition_digest !== definition.definition_digest || !text(result.observer_id) || !HASH.test(result.log_digest ?? '')) reasons.push(`PROVENANCE_${id}`);
    if (!definition.required) continue; // Optional failures are separately captured by review findings.
    if (result.status !== 'PASSED' || result.executed !== true || result.exit_code !== 0) reasons.push(`FAILED_${id}`);
    if (!count(result.tests_total) || !count(result.tests_passed) || !count(result.tests_skipped) ||
        result.tests_total < definition.minimum_tests || result.tests_skipped !== 0 ||
        result.tests_passed !== result.tests_total) reasons.push(`TEST_COUNTS_${id}`);
    if (!Array.isArray(result.assertion_ids) || !result.assertion_ids.every(text) ||
        new Set(result.assertion_ids).size !== result.assertion_ids.length ||
        !definition.required_assertion_ids.every(assertion => result.assertion_ids.includes(assertion))) reasons.push(`ASSERTIONS_${id}`);
  }
  if (reasons.length) return reject(...new Set(reasons));
  return {verdict: 'VERIFIED_FOR_SCOPE', reasons: [], candidate_id: candidate.candidate_id, evidence_id: evidence.evidence_id};
}

/** Pure state predicate. Authenticated caller roles/guards cannot come from model text. */
export function canTransition(machine, request) {
  if (!object(request)) return false;
  const {from, to, actor, guards, expectedVersion, actualVersion} = request;
  if (!object(machine) || !Array.isArray(machine.transitions) || !object(guards) ||
      !count(expectedVersion) || expectedVersion !== actualVersion) return false;
  return machine.transitions.some(rule => object(rule) && rule.from === from &&
    rule.to === to && rule.actor === actor && Object.hasOwn(guards, rule.guard) &&
    guards[rule.guard] === true);
}
