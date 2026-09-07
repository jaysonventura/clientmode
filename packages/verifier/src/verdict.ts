/** The readiness predicate.
 *
 *   ready = valid signature AND trusted current issuer
 *           AND current project/run/attempt/candidate
 *           AND matching source, artifact, policy, environment and requirements revision
 *           AND every required check executed and passed
 *           AND expected assertions and test discovery
 *           AND no skips or blocking findings
 *           AND, for a composite candidate, every required component observed on its own target
 *
 * The reference evaluator in `reference/acceptance.mjs` states the same rules as an executable
 * specification. This is the product implementation: it additionally validates the decoded
 * payload against the domain schema and covers composite polyglot candidates.
 */
import type { Candidate, Evidence, Policy, Verdict } from '../../../contracts/interfaces.js';
import { openEnvelope, type TrustStore } from './evidence.js';
import { evaluateComposite, type ComponentObservation } from '../../verification-targets/src/composite.js';
import type { TargetResolution } from '../../verification-targets/src/resolve.js';

const HASH = /^sha256:[0-9a-f]{64}$/;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/** Date.parse alone accepts date-only input; a timezone-bearing timestamp is required. */
function instant(value: unknown): number {
  return typeof value === 'string' && RFC3339.test(value) ? Date.parse(value) : Number.NaN;
}

const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

export type ReadinessInput = {
  candidate: Candidate;
  policy: Policy;
  envelope: unknown;
  trust: TrustStore;
  now: string;
  expectedAttemptId: string;
  /** Present when the candidate spans more than one component. */
  composite?: {
    requirements: TargetResolution[];
    observations: ComponentObservation[];
    manifest_digest: string;
    /** The manifest digest the evidence was produced against. */
    evidence_manifest_digest: string;
  };
};

/** Malformed top-level input is a rejection, not an exception. A predicate that throws on
 * junk gives a caller somewhere to lose the answer. */
export function decideReadiness(input: ReadinessInput): Verdict {
  try {
    return decide(input);
  } catch (error) {
    return { verdict: 'UNVERIFIED', reasons: ['MALFORMED_INPUT', String((error as Error).message).slice(0, 120)] };
  }
}

function decide(input: ReadinessInput): Verdict {
  const reject = (...reasons: string[]): Verdict => ({ verdict: 'UNVERIFIED', reasons: [...new Set(reasons)] });
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return reject('INVALID_INPUT');
  const { candidate, policy } = input;

  if (candidate?.kind !== 'candidate' || candidate.schema_version !== 1) return reject('UNSUPPORTED_CANDIDATE_SCHEMA');
  if (policy?.kind !== 'policy' || policy.schema_version !== 1) return reject('UNSUPPORTED_POLICY_SCHEMA');
  if (!text(input.expectedAttemptId) || !Number.isFinite(instant(input.now))) return reject('MISSING_TRUSTED_CONTEXT');
  if (policy.authority !== 'protected') return reject('ADVISORY_POLICY');

  const opened = openEnvelope({ envelope: input.envelope, trust: input.trust, now: input.now });
  if (!opened.opened) return reject(...opened.reasons);
  if (!Array.isArray(policy.trusted_issuer_ids) || !policy.trusted_issuer_ids.includes(opened.issuer_id)) {
    return reject('UNTRUSTED_ISSUER');
  }
  const evidence: Evidence = opened.evidence;
  const reasons: string[] = [];

  for (const key of ['candidate_id', 'project_id', 'run_id'] as const) {
    if (!text(candidate[key]) || evidence[key] !== candidate[key]) reasons.push(`IDENTITY_${key}`);
  }
  for (const key of ['source_digest', 'artifact_digest', 'policy_digest', 'environment_digest'] as const) {
    if (!HASH.test(candidate[key] ?? '') || evidence[key] !== candidate[key]) reasons.push(`IDENTITY_${key}`);
  }
  if (!Number.isSafeInteger(candidate.requirements_revision) || candidate.requirements_revision < 1 ||
      evidence.requirements_revision !== candidate.requirements_revision ||
      policy.requirements_revision !== candidate.requirements_revision) reasons.push('REQUIREMENTS_REVISION');
  if (policy.project_id !== candidate.project_id || policy.policy_digest !== candidate.policy_digest) reasons.push('POLICY_IDENTITY');
  if (evidence.attempt_id !== input.expectedAttemptId) reasons.push('STALE_ATTEMPT');
  if (evidence.integrity_passed !== true) reasons.push('INTEGRITY_FAILED');
  if (!Array.isArray(evidence.blocking_findings) || evidence.blocking_findings.length !== 0) reasons.push('BLOCKING_FINDINGS');

  const start = instant(evidence.started_at);
  const finish = instant(evidence.finished_at);
  const current = instant(input.now);
  const created = instant(candidate.created_at);
  if (![start, finish, current, created].every(Number.isFinite) || start < created || finish < start || finish > current ||
      !Number.isSafeInteger(policy.maximum_age_seconds) || policy.maximum_age_seconds <= 0 ||
      current - finish > policy.maximum_age_seconds * 1000) reasons.push('EVIDENCE_TIME');

  if (!Array.isArray(policy.checks) || policy.checks.length === 0 || !policy.checks.some(check => check?.required === true)) {
    reasons.push('EMPTY_REQUIRED_POLICY');
  }
  if (!Array.isArray(evidence.results)) return reject(...reasons, 'MISSING_RESULTS');

  const checks = new Map<string, Policy['checks'][number]>();
  for (const definition of policy.checks ?? []) {
    if (definition === null || typeof definition !== 'object' || !text(definition.check_id) || checks.has(definition.check_id) ||
        !HASH.test(definition.definition_digest ?? '') || typeof definition.required !== 'boolean' ||
        !['process', 'tests', 'browser', 'api', 'security'].includes(definition.result_kind) ||
        !count(definition.minimum_tests) || definition.maximum_skipped !== 0 ||
        !Array.isArray(definition.required_assertion_ids) || !definition.required_assertion_ids.every(text) ||
        new Set(definition.required_assertion_ids).size !== definition.required_assertion_ids.length ||
        (definition.result_kind !== 'process' && definition.minimum_tests === 0)) {
      reasons.push('INVALID_CHECK_POLICY');
      continue;
    }
    checks.set(definition.check_id, definition);
  }

  const results = new Map<string, Evidence['results'][number]>();
  for (const result of evidence.results) {
    if (result === null || typeof result !== 'object' || !text(result.check_id) || results.has(result.check_id) || !checks.has(result.check_id)) {
      reasons.push('DUPLICATE_OR_UNKNOWN_RESULT');
      continue;
    }
    results.set(result.check_id, result);
  }

  for (const [id, definition] of checks) {
    const result = results.get(id);
    if (!result) {
      if (definition.required) reasons.push(`MISSING_${id}`);
      continue;
    }
    if (result.definition_digest !== definition.definition_digest || !text(result.observer_id) || !HASH.test(result.log_digest ?? '')) {
      reasons.push(`PROVENANCE_${id}`);
    }
    if (!definition.required) continue;
    if (result.status !== 'PASSED' || result.executed !== true || result.exit_code !== 0) reasons.push(`FAILED_${id}`);
    if (!count(result.tests_total) || !count(result.tests_passed) || !count(result.tests_skipped) ||
        result.tests_total < definition.minimum_tests || result.tests_skipped !== 0 ||
        result.tests_passed !== result.tests_total) reasons.push(`TEST_COUNTS_${id}`);
    if (!Array.isArray(result.assertion_ids) || !result.assertion_ids.every(text) ||
        new Set(result.assertion_ids).size !== result.assertion_ids.length ||
        !definition.required_assertion_ids.every(assertion => result.assertion_ids.includes(assertion))) {
      reasons.push(`ASSERTIONS_${id}`);
    }
  }

  // A composite candidate is ready only when every required component was observed on its own
  // target and the manifest the evidence covers is still the current one.
  if (input.composite !== undefined) {
    if (input.composite.manifest_digest !== input.composite.evidence_manifest_digest) {
      reasons.push('COMPOSITE_MANIFEST_CHANGED');
    }
    const composite = evaluateComposite({
      requirements: input.composite.requirements,
      observations: input.composite.observations,
      manifest_digest: input.composite.manifest_digest,
    });
    if (composite.verdict !== 'VERIFIED_FOR_SCOPE') reasons.push(...composite.reasons.map(reason => `COMPOSITE_${reason}`));
  }

  if (reasons.length > 0) return reject(...reasons);
  return {
    verdict: 'VERIFIED_FOR_SCOPE', reasons: [],
    candidate_id: candidate.candidate_id, evidence_id: evidence.evidence_id,
  };
}
