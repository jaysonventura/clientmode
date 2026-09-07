/** The document readiness predicate.
 *
 * This is deliberately a separate evaluator from the software one. A document result binds
 * different things — a scope, a source manifest, an output manifest, a processing pipeline —
 * and the software evaluator has no business accepting a `document_evidence` payload. Feeding
 * one to the other is exactly the confusion this separation prevents.
 *
 * A valid signature proves who wrote the evidence. It does not prove the checks were
 * sufficient, so the required checks are reconciled against the policy every time.
 */
import type { DocumentEvidence, DocumentPolicy } from '../../../contracts/interfaces.js';
import { openDocumentEnvelope, type TrustStore } from '../../verifier/src/evidence.js';

export type DocumentVerdict =
  | { verdict: 'READY_FOR_SCOPE'; reasons: []; job_id: string; evidence_id: string }
  | { verdict: 'UNVERIFIED'; reasons: string[] };

export type DocumentReadinessInput = {
  policy: DocumentPolicy;
  envelope: unknown;
  trust: TrustStore;
  now: string;
  /** Everything the coordinator resolved from protected job state, not from the caller. */
  expected: {
    project_id: string;
    job_id: string;
    attempt_id: string;
    instruction_revision: number;
    scope_digest: string;
    source_manifest_digest: string;
    output_manifest_digest: string;
    pipeline_digest: string;
  };
};

const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const instant = (value: unknown): number => (typeof value === 'string' ? Date.parse(value) : Number.NaN);

export function decideDocumentReadiness(input: DocumentReadinessInput): DocumentVerdict {
  const reject = (...reasons: string[]): DocumentVerdict => ({ verdict: 'UNVERIFIED', reasons: [...new Set(reasons)] });
  try {
    return decide(input);
  } catch (error) {
    return reject('MALFORMED_INPUT', String((error as Error).message).slice(0, 120));
  }
}

function decide(input: DocumentReadinessInput): DocumentVerdict {
  const reject = (...reasons: string[]): DocumentVerdict => ({ verdict: 'UNVERIFIED', reasons: [...new Set(reasons)] });
  const { policy, expected } = input;
  if (policy?.kind !== 'document_policy' || policy.schema_version !== 1) return reject('UNSUPPORTED_POLICY_SCHEMA');
  if (policy.authority !== 'protected') return reject('ADVISORY_POLICY');

  const opened = openDocumentEnvelope({ envelope: input.envelope, trust: input.trust, now: input.now });
  if (!opened.opened) return reject(...opened.reasons);
  const evidence: DocumentEvidence = opened.evidence;
  if (evidence.schema_version !== 1) return reject('UNSUPPORTED_EVIDENCE_SCHEMA');
  if (!policy.trusted_issuer_ids.includes(opened.issuer_id)) return reject('UNTRUSTED_ISSUER');

  const reasons: string[] = [];
  for (const field of ['project_id', 'job_id', 'attempt_id'] as const) {
    if (!text(evidence[field]) || evidence[field] !== expected[field]) reasons.push(`IDENTITY_${field}`);
  }
  for (const field of ['scope_digest', 'source_manifest_digest', 'output_manifest_digest', 'pipeline_digest'] as const) {
    if (!text(evidence[field]) || evidence[field] !== expected[field]) reasons.push(`IDENTITY_${field}`);
  }
  if (evidence.policy_digest !== policy.policy_digest) reasons.push('IDENTITY_policy_digest');
  if (policy.project_id !== expected.project_id || policy.job_id !== expected.job_id) reasons.push('POLICY_IDENTITY');
  if (evidence.instruction_revision !== expected.instruction_revision ||
      policy.instruction_revision !== expected.instruction_revision) reasons.push('INSTRUCTION_REVISION');
  if (policy.scope_digest !== expected.scope_digest) reasons.push('POLICY_SCOPE_DIGEST');
  if (evidence.integrity_passed !== true) reasons.push('INTEGRITY_FAILED');
  if (!Array.isArray(evidence.blocking_findings) || evidence.blocking_findings.length !== 0) reasons.push('BLOCKING_FINDINGS');

  const started = instant(evidence.started_at);
  const finished = instant(evidence.finished_at);
  const current = instant(input.now);
  if (![started, finished, current].every(Number.isFinite) || finished < started || finished > current ||
      !count(policy.maximum_age_seconds) || policy.maximum_age_seconds <= 0 ||
      current - finished > policy.maximum_age_seconds * 1000) reasons.push('EVIDENCE_TIME');

  if (!Array.isArray(policy.checks) || policy.checks.length === 0 || !policy.checks.some(check => check?.required === true)) {
    reasons.push('EMPTY_REQUIRED_POLICY');
  }
  if (!Array.isArray(evidence.results)) return reject(...reasons, 'MISSING_RESULTS');

  const required = new Map((policy.checks ?? []).filter(check => check?.required === true).map(check => [check.check_id, check]));
  const seen = new Map<string, DocumentEvidence['results'][number]>();
  for (const result of evidence.results) {
    if (result === null || typeof result !== 'object' || !text(result.check_id)) { reasons.push('MALFORMED_RESULT'); continue; }
    if (seen.has(result.check_id)) { reasons.push(`DUPLICATE_RESULT_${result.check_id}`); continue; }
    if (!required.has(result.check_id) && !(policy.checks ?? []).some(check => check.check_id === result.check_id)) {
      reasons.push(`UNKNOWN_CHECK_${result.check_id}`);
      continue;
    }
    seen.set(result.check_id, result);
  }
  for (const [check_id, definition] of required) {
    const result = seen.get(check_id);
    if (result === undefined) { reasons.push(`MISSING_CHECK_${check_id}`); continue; }
    if (result.status !== 'PASSED') { reasons.push(`CHECK_${result.status}_${check_id}`); continue; }
    if (result.executed !== true) { reasons.push(`NOT_EXECUTED_${check_id}`); continue; }
    // Document checks count observations the same way software checks count tests: every one
    // that was declared has to have been made, and none may be skipped.
    if (!count(result.tests_total) || !count(result.tests_passed) || !count(result.tests_skipped) ||
        result.tests_total < definition.minimum_tests || result.tests_skipped !== 0 ||
        result.tests_passed !== result.tests_total) {
      reasons.push(`OBSERVATION_COUNTS_${check_id}`);
      continue;
    }
    const requiredAssertions = definition.required_assertion_ids ?? [];
    if (!Array.isArray(result.assertion_ids) || !requiredAssertions.every(id => result.assertion_ids.includes(id))) {
      reasons.push(`MISSING_ASSERTIONS_${check_id}`);
    }
  }

  return reasons.length === 0
    ? { verdict: 'READY_FOR_SCOPE', reasons: [], job_id: evidence.job_id, evidence_id: evidence.evidence_id }
    : reject(...reasons);
}
