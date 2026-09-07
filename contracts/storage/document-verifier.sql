-- Separate protected verifier DB; load after verifier.sql, never the writer DB.
PRAGMA foreign_keys=ON;
CREATE TABLE document_policy_versions (
 policy_digest TEXT PRIMARY KEY, project_id TEXT NOT NULL, job_id TEXT NOT NULL,
 instruction_revision INTEGER NOT NULL CHECK(instruction_revision>=1),
 record_json TEXT NOT NULL, approved_by TEXT NOT NULL, approved_at TEXT NOT NULL
);
CREATE TABLE document_verification_jobs (
 verification_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, job_id TEXT NOT NULL,
 attempt_id TEXT NOT NULL, instruction_revision INTEGER NOT NULL CHECK(instruction_revision>=1),
 policy_digest TEXT NOT NULL REFERENCES document_policy_versions(policy_digest),
 scope_digest TEXT NOT NULL, source_manifest_digest TEXT NOT NULL, output_manifest_digest TEXT NOT NULL,
 pipeline_digest TEXT NOT NULL, idempotency_key TEXT NOT NULL, request_digest TEXT NOT NULL,
 status TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(project_id,idempotency_key)
);
CREATE TABLE document_check_executions (
 execution_id TEXT PRIMARY KEY, verification_id TEXT NOT NULL REFERENCES document_verification_jobs(verification_id),
 definition_digest TEXT NOT NULL REFERENCES check_definitions(definition_digest),
 observer_id TEXT NOT NULL, result_json TEXT NOT NULL, observation_digest TEXT NOT NULL,
 started_at TEXT NOT NULL, finished_at TEXT NOT NULL, UNIQUE(verification_id,definition_digest)
);
CREATE TABLE document_evidence_envelopes (
 evidence_id TEXT PRIMARY KEY, verification_id TEXT NOT NULL UNIQUE REFERENCES document_verification_jobs(verification_id),
 issuer_id TEXT NOT NULL, payload_digest TEXT NOT NULL, envelope_json TEXT NOT NULL, envelope_digest TEXT NOT NULL, issued_at TEXT NOT NULL
);
-- No private signing material; source/job access checked by authenticated service protocol.
