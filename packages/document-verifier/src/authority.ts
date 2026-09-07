/** The protected document-verification authority.
 *
 * It owns its own database, its own policy records and its own view of what a job currently
 * is. The caller hands it identifiers; every fact it reconciles against comes from its own
 * store or from the protected job state it reads for itself. A writer cannot create the
 * authoritative record, and cannot move a job to READY.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import type { CheckDefinition, CheckResult, DocumentEvidence, DocumentPolicy } from '../../../contracts/interfaces.js';
import { digest } from '../../contracts/src/canonical.js';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../../../..');
const VERIFIER_SQL = path.join(ROOT, 'contracts/storage/verifier.sql');
const DOCUMENT_SQL = path.join(ROOT, 'contracts/storage/document-verifier.sql');

export class DocumentAuthorityError extends Error {
  constructor(public readonly code: string, subject = '') {
    super(subject === '' ? code : `${code}: ${subject}`);
    this.name = 'DocumentAuthorityError';
  }
}

/** Only the authority issues document evidence. A worker asking for it is refused by role. */
export const ISSUING_ACTORS = new Set(['document_verifier']);

export class DocumentPolicyStore {
  readonly #db: DatabaseSync;
  private constructor(db: DatabaseSync) { this.#db = db; }

  static open(storeDir: string): DocumentPolicyStore {
    mkdirSync(storeDir, { recursive: true });
    const db = new DatabaseSync(path.join(storeDir, 'document-verifier.sqlite'));
    db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
    const present = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='document_policy_versions'").get();
    if (present === undefined) {
      // The document schema references check_definitions, which lives in the verifier schema.
      db.exec(readFileSync(VERIFIER_SQL, 'utf8'));
      db.exec(readFileSync(DOCUMENT_SQL, 'utf8').replace(/^PRAGMA.*$/gm, ''));
    }
    return new DocumentPolicyStore(db);
  }

  /** Approved outside writer authority, and immutable once registered. */
  registerPolicy(policy: DocumentPolicy, approved_by: string, at: string): void {
    if (approved_by === 'worker' || approved_by === 'writer') throw new DocumentAuthorityError('ACTOR_CANNOT_APPROVE_POLICY', approved_by);
    const existing = this.#db.prepare('SELECT record_json FROM document_policy_versions WHERE policy_digest = ?').get(policy.policy_digest);
    if (existing !== undefined) {
      if (String((existing as Record<string, unknown>)['record_json']) !== JSON.stringify(policy)) {
        throw new DocumentAuthorityError('DOCUMENT_POLICY_VERSION_IMMUTABLE', policy.policy_digest);
      }
      return;
    }
    this.#db.prepare(`INSERT INTO document_policy_versions (policy_digest, project_id, job_id,
      instruction_revision, record_json, approved_by, approved_at) VALUES (?,?,?,?,?,?,?)`)
      .run(policy.policy_digest, policy.project_id, policy.job_id, policy.instruction_revision,
        JSON.stringify(policy), approved_by, at);
  }

  policy(policy_digest: string): DocumentPolicy {
    const row = this.#db.prepare('SELECT record_json FROM document_policy_versions WHERE policy_digest = ?').get(policy_digest);
    if (row === undefined) throw new DocumentAuthorityError('UNKNOWN_DOCUMENT_POLICY', policy_digest);
    return JSON.parse(String((row as Record<string, unknown>)['record_json'])) as DocumentPolicy;
  }

  registerCheckDefinition(definition: CheckDefinition, approved_by: string, at: string): void {
    if (approved_by === 'worker' || approved_by === 'writer') throw new DocumentAuthorityError('ACTOR_CANNOT_APPROVE_CHECK', approved_by);
    this.#db.prepare(`INSERT OR IGNORE INTO check_definitions (definition_digest, check_id, definition_json,
      parser_digest, approved_by, approved_at) VALUES (?,?,?,?,?,?)`)
      .run(definition.definition_digest, definition.check_id, JSON.stringify(definition),
        digest({ parser: 'document', version: '1.0.0' }), approved_by, at);
  }

  recordVerification(input: {
    verification_id: string; project_id: string; job_id: string; attempt_id: string;
    instruction_revision: number; policy_digest: string; scope_digest: string;
    source_manifest_digest: string; output_manifest_digest: string; pipeline_digest: string;
    idempotency_key: string; request_digest: string; status: string; at: string;
  }): void {
    this.#db.prepare(`INSERT INTO document_verification_jobs (verification_id, project_id, job_id, attempt_id,
      instruction_revision, policy_digest, scope_digest, source_manifest_digest, output_manifest_digest,
      pipeline_digest, idempotency_key, request_digest, status, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(input.verification_id, input.project_id, input.job_id, input.attempt_id, input.instruction_revision,
        input.policy_digest, input.scope_digest, input.source_manifest_digest, input.output_manifest_digest,
        input.pipeline_digest, input.idempotency_key, input.request_digest, input.status, input.at);
  }

  recordEnvelope(input: { evidence_id: string; verification_id: string; issuer_id: string; envelope: unknown; at: string }): void {
    const envelope_json = JSON.stringify(input.envelope);
    this.#db.prepare(`INSERT INTO document_evidence_envelopes (evidence_id, verification_id, issuer_id,
      payload_digest, envelope_json, envelope_digest, issued_at) VALUES (?,?,?,?,?,?,?)`)
      .run(input.evidence_id, input.verification_id, input.issuer_id, digest(input.envelope),
        envelope_json, digest(envelope_json), input.at);
  }

  raw(): DatabaseSync { return this.#db; }
  close(): void { this.#db.close(); }
}

export type DocumentCheckObservation = {
  check_id: string;
  definition: CheckDefinition;
  observations: Array<{ assertion_id: string; passed: boolean; detail: string }>;
  observer_id: string;
};

/** Turns observations the authority made itself into a CheckResult. A worker's summary is not
 * accepted here: the coordinator calls the checks and records what they returned. */
export function resultOf(observation: DocumentCheckObservation): CheckResult {
  const passed = observation.observations.filter(entry => entry.passed).length;
  return {
    check_id: observation.check_id,
    definition_digest: observation.definition.definition_digest,
    status: passed === observation.observations.length && observation.observations.length > 0 ? 'PASSED' : 'FAILED',
    executed: true,
    exit_code: 0,
    tests_total: observation.observations.length,
    tests_passed: passed,
    tests_skipped: 0,
    assertion_ids: observation.observations.map(entry => entry.assertion_id),
    observer_id: observation.observer_id,
    log_digest: digest(observation.observations),
  };
}

export function buildDocumentEvidence(input: {
  project_id: string; job_id: string; attempt_id: string; instruction_revision: number;
  issuer_id: string; scope_digest: string; source_manifest_digest: string;
  output_manifest_digest: string; policy_digest: string; pipeline_digest: string;
  results: CheckResult[]; integrity_passed: boolean; blocking_findings: string[];
  started_at: string; finished_at: string;
}): DocumentEvidence {
  return {
    kind: 'document_evidence', schema_version: 1, evidence_id: `devidence_${randomUUID()}`,
    ...input,
  };
}

/** The manifests a document result is bound to: the exact source bytes it read and the exact
 * output bytes it produced. Doc-only work has no source-code digest and needs none. */
export function sourceManifestDigest(versions: ReadonlyArray<{ version_id: string; content_digest: string }>): string {
  return digest([...versions].sort((left, right) => left.version_id.localeCompare(right.version_id)));
}

export function outputManifestDigest(artifacts: ReadonlyArray<{ artifact_id: string; content_digest: string }>): string {
  return digest([...artifacts].sort((left, right) => left.artifact_id.localeCompare(right.artifact_id)));
}
