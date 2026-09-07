/** Protected verification coordinator.
 *
 * It resolves an immutable candidate and a frozen policy, runs each required check's approved
 * definition in a disposable sandbox, and records what it observed. It never executes caller
 * argv, never runs a substitute for a check whose environment is missing, and never imports
 * anything from the candidate into its own process.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Candidate, CheckResult, Evidence, Policy } from '../../../contracts/interfaces.js';
import { digest } from '../../contracts/src/canonical.js';
import { environmentReadiness, execute, type Isolation } from './executor.js';
import { parseReport } from './parsers.js';
import { PolicyError, type ProtectedPolicyStore } from './policy.js';

export class CoordinatorError extends Error {
  constructor(public readonly code: string, subject: string) {
    super(`${code}: ${subject}`);
    this.name = 'CoordinatorError';
  }
}

export type CheckObservation = {
  result: CheckResult;
  reasons: string[];
  isolation: Isolation | null;
  timed_out: boolean;
  quarantined: boolean;
  output_truncated: boolean;
  environment_ready: boolean;
  parser_version: string | null;
};

export type VerificationOutcome = {
  verification_id: string;
  evidence: Evidence;
  observations: CheckObservation[];
  blocked_checks: string[];
};

export type CoordinatorRequest = {
  project_id: string; run_id: string; attempt_id: string;
  candidate: Candidate; policy_digest: string;
  /** Requested extras only. Required checks come from the policy and cannot be removed. */
  requested_check_ids: string[];
  workspace_root: string;
  idempotency_key: string;
};

export class VerificationCoordinator {
  readonly #store: ProtectedPolicyStore;
  readonly #issuer_id: string;
  readonly #now: () => string;
  readonly #sandbox_parent: string;

  constructor(input: { store: ProtectedPolicyStore; issuer_id: string; clock?: () => string; sandbox_parent?: string }) {
    this.#store = input.store;
    this.#issuer_id = input.issuer_id;
    this.#now = input.clock ?? (() => new Date().toISOString());
    this.#sandbox_parent = input.sandbox_parent ?? os.tmpdir();
  }

  /** A worker asking for its own command is refused here, before anything is resolved. */
  static rejectCallerArgv(request: unknown): { rejected: boolean; reason: string } {
    if (request !== null && typeof request === 'object') {
      for (const key of ['argv', 'command', 'cmd', 'script', 'shell', 'exec']) {
        if (key in (request as Record<string, unknown>)) {
          return { rejected: true, reason: `CALLER_SUPPLIED_COMMAND_REFUSED:${key}` };
        }
      }
    }
    return { rejected: false, reason: 'NO_CALLER_COMMAND' };
  }

  async verify(request: CoordinatorRequest): Promise<VerificationOutcome> {
    const caller = VerificationCoordinator.rejectCallerArgv(request);
    if (caller.rejected) throw new CoordinatorError('CALLER_ARGV_REFUSED', caller.reason);

    const policy: Policy = this.#store.policy(request.policy_digest);
    if (policy.authority !== 'protected') throw new CoordinatorError('ADVISORY_POLICY', request.policy_digest);
    if (policy.project_id !== request.candidate.project_id) throw new CoordinatorError('POLICY_PROJECT_MISMATCH', policy.project_id);
    if (policy.policy_digest !== request.candidate.policy_digest) throw new CoordinatorError('CANDIDATE_POLICY_MISMATCH', request.candidate.policy_digest);
    if (policy.requirements_revision !== request.candidate.requirements_revision) {
      throw new CoordinatorError('REQUIREMENTS_REVISION_MISMATCH', String(request.candidate.requirements_revision));
    }

    const started_at = this.#now();
    const job = this.#store.recordJob({
      project_id: request.project_id, candidate_id: request.candidate.candidate_id,
      attempt_id: request.attempt_id, policy_digest: request.policy_digest,
      source_digest: request.candidate.source_digest, artifact_digest: request.candidate.artifact_digest,
      environment_digest: request.candidate.environment_digest, idempotency_key: request.idempotency_key,
      request_digest: digest({ candidate: request.candidate.candidate_id, policy: request.policy_digest }),
      at: started_at,
    });

    const check_ids = this.#store.selectChecks(request.policy_digest, request.requested_check_ids);
    const observations: CheckObservation[] = [];
    const blocked: string[] = [];

    for (const check_id of check_ids) {
      const observation = await this.#runCheck(request, check_id);
      observations.push(observation);
      if (!observation.environment_ready) blocked.push(check_id);
      this.#store.recordExecution({
        verification_id: job.verification_id, definition_digest: observation.result.definition_digest,
        observer_id: observation.result.observer_id, result: observation,
        observation_digest: digest(observation.result),
        started_at, finished_at: this.#now(),
      });
    }

    const finished_at = this.#now();
    const blocking = observations.flatMap(observation =>
      observation.result.status === 'PASSED' ? [] : [`${observation.result.check_id}:${observation.reasons.join(',')}`]);
    const evidence: Evidence = {
      kind: 'evidence', schema_version: 1,
      evidence_id: `evidence_${job.verification_id}`,
      candidate_id: request.candidate.candidate_id, project_id: request.project_id,
      run_id: request.run_id, attempt_id: request.attempt_id,
      source_digest: request.candidate.source_digest, artifact_digest: request.candidate.artifact_digest,
      requirements_revision: request.candidate.requirements_revision,
      policy_digest: request.candidate.policy_digest,
      environment_digest: request.candidate.environment_digest,
      issuer_id: this.#issuer_id, started_at, finished_at,
      integrity_passed: blocking.length === 0,
      blocking_findings: blocking,
      results: observations.map(observation => observation.result),
    };
    this.#store.finishJob(job.verification_id, blocking.length === 0 ? 'COMPLETE' : 'REJECTED');
    return { verification_id: job.verification_id, evidence, observations, blocked_checks: blocked };
  }

  async #runCheck(request: CoordinatorRequest, check_id: string): Promise<CheckObservation> {
    let resolved;
    try {
      resolved = this.#store.resolve(request.policy_digest, check_id);
    } catch (error) {
      if (error instanceof PolicyError) {
        return this.#unverified(check_id, `sha256:${'0'.repeat(64)}`, [error.code], { environment_ready: false });
      }
      throw error;
    }
    const { definition, parser_version, environment } = resolved;
    const searchPath = '/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin';

    // A check whose target environment is unavailable stays unverified. No substitute runs.
    const readiness = environmentReadiness(environment, searchPath);
    if (!readiness.ready) {
      return this.#unverified(check_id, definition.check.definition_digest,
        [readiness.reason, ...readiness.missing.map(item => `MISSING:${item}`)], { environment_ready: false });
    }

    const sandbox_root = mkdtempSync(path.join(this.#sandbox_parent, 'cm-sandbox-'));
    try {
      const observation = await execute({
        argv: definition.argv,
        cwd: path.resolve(request.workspace_root, definition.cwd_relative),
        sandbox_root,
        timeout_seconds: definition.timeout_seconds,
        maximum_output_bytes: definition.maximum_output_bytes,
        network_profile_id: resolved.network_profile_id,
        environment,
        observer_id: this.#issuer_id,
        now: this.#now,
        search_path: searchPath,
      });

      const reasons: string[] = [];
      if (observation.timed_out) reasons.push('TIMEOUT');
      if (observation.quarantined) reasons.push('PROCESS_TREE_SURVIVED');
      if (observation.output_truncated) reasons.push('OUTPUT_LIMIT_EXCEEDED');
      if (observation.isolation.kind === 'none') reasons.push('ISOLATION_UNAVAILABLE');

      const parsed = parseReport({
        parser_id: definition.parser_id, expected_version: parser_version,
        stdout: observation.stdout, stderr: observation.stderr, exit_code: observation.exit_code,
      });
      if (!parsed.version_matched) reasons.push('PARSER_VERSION_MISMATCH');
      if (!parsed.report.ok) reasons.push(parsed.report.reason);

      const counts = parsed.report.ok ? parsed.report : { tests_total: 0, tests_passed: 0, tests_skipped: 0, assertion_ids: [] as string[] };
      if (parsed.report.ok && counts.tests_total < definition.check.minimum_tests) reasons.push('INSUFFICIENT_TEST_DISCOVERY');
      if (counts.tests_skipped > definition.check.maximum_skipped) reasons.push('UNEXPECTED_SKIPPED_TESTS');
      for (const assertion of definition.check.required_assertion_ids) {
        if (!counts.assertion_ids.includes(assertion)) reasons.push(`MISSING_ASSERTION:${assertion}`);
      }
      if (observation.exit_code !== 0) reasons.push(`NONZERO_EXIT:${observation.exit_code ?? 'null'}`);

      const status: CheckResult['status'] = observation.timed_out ? 'TIMEOUT'
        : !observation.executed ? 'ERROR'
        : reasons.length > 0 ? (parsed.report.ok ? 'FAILED' : 'UNVERIFIED')
        : 'PASSED';

      return {
        result: {
          check_id, definition_digest: definition.check.definition_digest, status,
          executed: observation.executed, exit_code: observation.exit_code,
          tests_total: counts.tests_total, tests_passed: counts.tests_passed, tests_skipped: counts.tests_skipped,
          assertion_ids: counts.assertion_ids, observer_id: observation.observer_id,
          log_digest: observation.log_digest,
        },
        reasons: [...new Set(reasons)], isolation: observation.isolation, timed_out: observation.timed_out,
        quarantined: observation.quarantined, output_truncated: observation.output_truncated,
        environment_ready: true, parser_version: parsed.parser_version,
      };
    } finally {
      rmSync(sandbox_root, { recursive: true, force: true });
    }
  }

  #unverified(check_id: string, definition_digest: string, reasons: string[], extra: { environment_ready: boolean }): CheckObservation {
    return {
      result: {
        check_id, definition_digest, status: 'UNVERIFIED', executed: false, exit_code: null,
        tests_total: 0, tests_passed: 0, tests_skipped: 0, assertion_ids: [],
        observer_id: this.#issuer_id,
        log_digest: `sha256:${createHash('sha256').update(reasons.join('|'), 'utf8').digest('hex')}`,
      },
      reasons, isolation: null, timed_out: false, quarantined: false, output_truncated: false,
      environment_ready: extra.environment_ready, parser_version: null,
    };
  }
}
