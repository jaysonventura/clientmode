/** Protected check registry. This store belongs to the verification authority, not to the
 * controller and never to a worker. A requester names a check ID; the definition — argv,
 * working directory, parser, timeouts and environment — comes from here and only from here.
 * A requester may ask for extra diagnostic checks but can never shrink the required set.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import type { CheckDefinition, Policy, ProtectedExecutionDefinition } from '../../../contracts/interfaces.js';
import { digest } from '../../contracts/src/canonical.js';
import { validateEntity } from '../../contracts/src/validate.js';

const VERIFIER_SQL = path.resolve(fileURLToPath(import.meta.url), '../../../../contracts/storage/verifier.sql');

/** Product extension of the reference verifier schema: the execution definitions and the
 * environment/network profiles they name. Added by migration, not by editing the reference. */
const VERIFIER_MIGRATION = `
CREATE TABLE execution_definitions (
 definition_digest TEXT PRIMARY KEY REFERENCES check_definitions(definition_digest),
 check_id TEXT NOT NULL UNIQUE, argv_json TEXT NOT NULL, cwd_relative TEXT NOT NULL,
 parser_id TEXT NOT NULL, parser_version TEXT NOT NULL,
 timeout_seconds INTEGER NOT NULL CHECK(timeout_seconds > 0),
 maximum_output_bytes INTEGER NOT NULL CHECK(maximum_output_bytes > 0),
 environment_profile_id TEXT NOT NULL, network_profile_id TEXT NOT NULL,
 approved_by TEXT NOT NULL, approved_at TEXT NOT NULL
);
CREATE TABLE environment_profiles (
 profile_id TEXT PRIMARY KEY, required_platform TEXT,
 required_executables_json TEXT NOT NULL, denied_read_paths_json TEXT NOT NULL,
 allowed_write_paths_json TEXT NOT NULL, allow_home_read INTEGER NOT NULL CHECK(allow_home_read IN (0,1)),
 toolchain_paths_json TEXT NOT NULL,
 description TEXT NOT NULL, approved_by TEXT NOT NULL, approved_at TEXT NOT NULL
);
CREATE TABLE policy_check_membership (
 policy_digest TEXT NOT NULL REFERENCES policy_versions(policy_digest),
 check_id TEXT NOT NULL, required INTEGER NOT NULL CHECK(required IN (0,1)),
 PRIMARY KEY(policy_digest, check_id)
);
CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
`;

export class PolicyError extends Error {
  constructor(public readonly code: string, subject: string) {
    super(`${code}: ${subject}`);
    this.name = 'PolicyError';
  }
}

export type EnvironmentProfile = {
  profile_id: string;
  /** A check that names a platform it cannot get is unverified, never substituted. */
  required_platform: string | null;
  required_executables: string[];
  denied_read_paths: string[];
  allowed_write_paths: string[];
  allow_home_read: boolean;
  /** Declared read exceptions that survive a home denial, and the child's search path.
   * A toolchain living under the user's home is a fact of most developer machines; naming
   * it is honest, silently allowing the whole home is not. */
  toolchain_paths: string[];
  description: string;
};

export type NetworkProfileId = 'deny' | 'loopback' | 'approved';

export type ResolvedCheck = {
  definition: ProtectedExecutionDefinition;
  parser_version: string;
  environment: EnvironmentProfile;
  network_profile_id: NetworkProfileId;
};

export class ProtectedPolicyStore {
  readonly #db: DatabaseSync;
  private constructor(db: DatabaseSync) { this.#db = db; }

  /** Separate database and separate schema. Co-locating the file is a v1 deployment
   * convenience; it is not the OS-principal separation the release path requires. */
  static open(storeDir: string): ProtectedPolicyStore {
    mkdirSync(storeDir, { recursive: true });
    const db = new DatabaseSync(path.join(storeDir, 'verifier.sqlite'));
    db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
    const present = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='policy_versions'").get();
    if (present === undefined) {
      db.exec(readFileSync(VERIFIER_SQL, 'utf8'));
      db.exec(VERIFIER_MIGRATION);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (1, ?)').run(new Date().toISOString());
    }
    return new ProtectedPolicyStore(db);
  }

  registerEnvironmentProfile(profile: EnvironmentProfile, approved_by: string, at: string): void {
    this.#db.prepare(`INSERT OR REPLACE INTO environment_profiles (profile_id, required_platform,
      required_executables_json, denied_read_paths_json, allowed_write_paths_json, allow_home_read,
      toolchain_paths_json, description, approved_by, approved_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(profile.profile_id, profile.required_platform, JSON.stringify(profile.required_executables),
        JSON.stringify(profile.denied_read_paths), JSON.stringify(profile.allowed_write_paths),
        profile.allow_home_read ? 1 : 0, JSON.stringify(profile.toolchain_paths),
        profile.description, approved_by, at);
  }

  environmentProfile(profile_id: string): EnvironmentProfile {
    const row = this.#db.prepare('SELECT * FROM environment_profiles WHERE profile_id = ?').get(profile_id) as Record<string, unknown> | undefined;
    if (!row) throw new PolicyError('UNKNOWN_ENVIRONMENT_PROFILE', profile_id);
    return {
      profile_id, required_platform: row['required_platform'] === null ? null : String(row['required_platform']),
      required_executables: JSON.parse(String(row['required_executables_json'])) as string[],
      denied_read_paths: JSON.parse(String(row['denied_read_paths_json'])) as string[],
      allowed_write_paths: JSON.parse(String(row['allowed_write_paths_json'])) as string[],
      allow_home_read: Number(row['allow_home_read']) === 1,
      toolchain_paths: JSON.parse(String(row['toolchain_paths_json'])) as string[],
      description: String(row['description']),
    };
  }

  /** The definition digest covers the whole definition, so a changed argv, timeout, parser
   * or parser version produces a different check identity and invalidates earlier results. */
  registerDefinition(input: {
    definition: Omit<ProtectedExecutionDefinition, 'check'> & { check: Omit<CheckDefinition, 'definition_digest'> };
    parser_version: string; approved_by: string; at: string;
  }): ProtectedExecutionDefinition {
    const body = {
      check_id: input.definition.check.check_id, argv: input.definition.argv,
      cwd_relative: input.definition.cwd_relative, parser_id: input.definition.parser_id,
      parser_version: input.parser_version, timeout_seconds: input.definition.timeout_seconds,
      maximum_output_bytes: input.definition.maximum_output_bytes,
      environment_profile_id: input.definition.environment_profile_id,
      network_profile_id: input.definition.network_profile_id,
      result_kind: input.definition.check.result_kind,
      minimum_tests: input.definition.check.minimum_tests,
      required_assertion_ids: input.definition.check.required_assertion_ids,
    };
    const definition_digest = digest(body);
    const parser_digest = `sha256:${createHash('sha256').update(`${input.definition.parser_id}@${input.parser_version}`, 'utf8').digest('hex')}`;
    this.#db.prepare('INSERT OR REPLACE INTO check_definitions (definition_digest, check_id, definition_json, parser_digest, approved_by, approved_at) VALUES (?,?,?,?,?,?)')
      .run(definition_digest, body.check_id, JSON.stringify(body), parser_digest, input.approved_by, input.at);
    this.#db.prepare(`INSERT OR REPLACE INTO execution_definitions (definition_digest, check_id, argv_json, cwd_relative,
      parser_id, parser_version, timeout_seconds, maximum_output_bytes, environment_profile_id, network_profile_id,
      approved_by, approved_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(definition_digest, body.check_id, JSON.stringify(body.argv), body.cwd_relative, body.parser_id,
        input.parser_version, body.timeout_seconds, body.maximum_output_bytes,
        body.environment_profile_id, body.network_profile_id, input.approved_by, input.at);
    return {
      check: { ...input.definition.check, definition_digest },
      argv: input.definition.argv, cwd_relative: input.definition.cwd_relative,
      parser_id: input.definition.parser_id, timeout_seconds: input.definition.timeout_seconds,
      maximum_output_bytes: input.definition.maximum_output_bytes,
      environment_profile_id: input.definition.environment_profile_id,
      network_profile_id: input.definition.network_profile_id,
    };
  }

  /** A policy is frozen under its digest before any candidate is evaluated against it. */
  registerPolicy(policy: Policy, approved_by: string, at: string): string {
    const validation = validateEntity(policy);
    if (!validation.valid) throw new PolicyError('INVALID_POLICY', validation.errors.join('; '));
    const computed = digest(policy, 'policy_digest');
    if (policy.policy_digest !== computed) throw new PolicyError('POLICY_DIGEST_MISMATCH', `${policy.policy_digest} vs ${computed}`);
    // A frozen policy version is immutable. Re-registering different content under the same
    // (project, policy_id, revision) would replace the row a candidate's evidence points at,
    // so it is refused: a changed policy is a new version, reviewed separately.
    const existing = this.#db.prepare('SELECT policy_digest FROM policy_versions WHERE project_id = ? AND policy_id = ? AND revision = ?')
      .get(policy.project_id, policy.policy_id, policy.requirements_revision) as Record<string, unknown> | undefined;
    if (existing !== undefined && String(existing['policy_digest']) !== policy.policy_digest) {
      throw new PolicyError('POLICY_VERSION_IMMUTABLE', `${policy.policy_id}@${policy.requirements_revision} already frozen as ${String(existing['policy_digest'])}`);
    }
    this.#db.prepare('INSERT OR REPLACE INTO policy_versions (policy_digest, policy_id, project_id, revision, policy_json, approved_by, approved_at) VALUES (?,?,?,?,?,?,?)')
      .run(policy.policy_digest, policy.policy_id, policy.project_id, policy.requirements_revision,
        JSON.stringify(policy), approved_by, at);
    for (const check of policy.checks) {
      this.#db.prepare('INSERT OR REPLACE INTO policy_check_membership (policy_digest, check_id, required) VALUES (?,?,?)')
        .run(policy.policy_digest, check.check_id, check.required ? 1 : 0);
    }
    return policy.policy_digest;
  }

  policy(policy_digest: string): Policy {
    const row = this.#db.prepare('SELECT policy_json FROM policy_versions WHERE policy_digest = ?').get(policy_digest) as Record<string, unknown> | undefined;
    if (!row) throw new PolicyError('UNKNOWN_POLICY', policy_digest);
    return JSON.parse(String(row['policy_json'])) as Policy;
  }

  /** The acceptance set is the policy's required checks. A requester's list can add
   * diagnostics; it cannot remove a required check. */
  selectChecks(policy_digest: string, requested_check_ids: string[]): string[] {
    const policy = this.policy(policy_digest);
    const required = policy.checks.filter(check => check.required).map(check => check.check_id);
    const optional = requested_check_ids.filter(id => policy.checks.some(check => check.check_id === id && !check.required));
    return [...new Set([...required, ...optional])];
  }

  /** Resolve a check ID to its approved definition. An unknown ID is refused, and there is
   * no parameter through which a caller could supply its own argv. */
  resolve(policy_digest: string, check_id: string): ResolvedCheck {
    const policy = this.policy(policy_digest);
    const member = policy.checks.find(check => check.check_id === check_id);
    if (!member) throw new PolicyError('UNKNOWN_CHECK_ID', `${check_id} is not in policy ${policy_digest}`);
    const row = this.#db.prepare('SELECT * FROM execution_definitions WHERE check_id = ?').get(check_id) as Record<string, unknown> | undefined;
    if (!row) throw new PolicyError('NO_APPROVED_EXECUTION_DEFINITION', check_id);
    if (String(row['definition_digest']) !== member.definition_digest) {
      throw new PolicyError('DEFINITION_DIGEST_MISMATCH', `${check_id}: policy expects ${member.definition_digest}`);
    }
    return {
      definition: {
        check: member, argv: JSON.parse(String(row['argv_json'])) as string[],
        cwd_relative: String(row['cwd_relative']), parser_id: String(row['parser_id']),
        timeout_seconds: Number(row['timeout_seconds']),
        maximum_output_bytes: Number(row['maximum_output_bytes']),
        environment_profile_id: String(row['environment_profile_id']),
        network_profile_id: String(row['network_profile_id']),
      },
      parser_version: String(row['parser_version']),
      environment: this.environmentProfile(String(row['environment_profile_id'])),
      network_profile_id: String(row['network_profile_id']) as NetworkProfileId,
    };
  }

  recordJob(input: {
    project_id: string; candidate_id: string; attempt_id: string; policy_digest: string;
    source_digest: string; artifact_digest: string; environment_digest: string;
    idempotency_key: string; request_digest: string; at: string;
  }): { verification_id: string; replayed: boolean } {
    const existing = this.#db.prepare('SELECT * FROM verification_jobs WHERE project_id = ? AND idempotency_key = ?')
      .get(input.project_id, input.idempotency_key) as Record<string, unknown> | undefined;
    if (existing) {
      if (String(existing['request_digest']) !== input.request_digest) throw new PolicyError('IDEMPOTENCY_KEY_CONFLICT', input.idempotency_key);
      return { verification_id: String(existing['verification_id']), replayed: true };
    }
    const verification_id = `ver_${randomUUID()}`;
    this.#db.prepare(`INSERT INTO verification_jobs (verification_id, project_id, candidate_id, attempt_id, policy_digest,
      source_digest, artifact_digest, environment_digest, idempotency_key, request_digest, status, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,'RUNNING',?)`)
      .run(verification_id, input.project_id, input.candidate_id, input.attempt_id, input.policy_digest,
        input.source_digest, input.artifact_digest, input.environment_digest,
        input.idempotency_key, input.request_digest, input.at);
    return { verification_id, replayed: false };
  }

  recordExecution(input: {
    verification_id: string; definition_digest: string; observer_id: string;
    result: unknown; observation_digest: string; started_at: string; finished_at: string;
  }): void {
    this.#db.prepare(`INSERT OR REPLACE INTO check_executions (execution_id, verification_id, definition_digest,
      observer_id, result_json, observation_digest, started_at, finished_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run(`exe_${randomUUID()}`, input.verification_id, input.definition_digest, input.observer_id,
        JSON.stringify(input.result), input.observation_digest, input.started_at, input.finished_at);
  }

  finishJob(verification_id: string, status: string): void {
    this.#db.prepare('UPDATE verification_jobs SET status = ? WHERE verification_id = ?').run(status, verification_id);
  }

  raw(): DatabaseSync { return this.#db; }
  close(): void { this.#db.close(); }
}
