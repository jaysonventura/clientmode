-- Separate protected service principal; storing this beside controller DB is not isolation.
PRAGMA foreign_keys = ON;
CREATE TABLE policy_versions (
 policy_digest TEXT PRIMARY KEY, policy_id TEXT NOT NULL, project_id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision >= 1), policy_json TEXT NOT NULL,
 approved_by TEXT NOT NULL, approved_at TEXT NOT NULL,
 UNIQUE(project_id, policy_id, revision)
);
CREATE TABLE check_definitions (
 definition_digest TEXT PRIMARY KEY, check_id TEXT NOT NULL,
 definition_json TEXT NOT NULL, parser_digest TEXT NOT NULL,
 approved_by TEXT NOT NULL, approved_at TEXT NOT NULL
);
CREATE TABLE verification_jobs (
 verification_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, candidate_id TEXT NOT NULL,
 attempt_id TEXT NOT NULL, policy_digest TEXT NOT NULL REFERENCES policy_versions(policy_digest),
 source_digest TEXT NOT NULL, artifact_digest TEXT NOT NULL, environment_digest TEXT NOT NULL,
 idempotency_key TEXT NOT NULL, request_digest TEXT NOT NULL,
 status TEXT NOT NULL, created_at TEXT NOT NULL,
 UNIQUE(project_id, idempotency_key)
);
CREATE TABLE check_executions (
 execution_id TEXT PRIMARY KEY, verification_id TEXT NOT NULL REFERENCES verification_jobs(verification_id),
 definition_digest TEXT NOT NULL REFERENCES check_definitions(definition_digest),
 observer_id TEXT NOT NULL, result_json TEXT NOT NULL, observation_digest TEXT NOT NULL,
 started_at TEXT NOT NULL, finished_at TEXT NOT NULL,
 UNIQUE(verification_id, definition_digest)
);
CREATE TABLE evidence_envelopes (
 evidence_id TEXT PRIMARY KEY, verification_id TEXT NOT NULL UNIQUE REFERENCES verification_jobs(verification_id),
 issuer_id TEXT NOT NULL, payload_digest TEXT NOT NULL, envelope_json TEXT NOT NULL,
 envelope_digest TEXT NOT NULL, issued_at TEXT NOT NULL
);
CREATE TABLE issuer_public_keys (
 issuer_id TEXT PRIMARY KEY, public_key_pem TEXT NOT NULL,
 not_before TEXT NOT NULL, revoked_at TEXT
);
-- Private signing material belongs in the protected service key store, not this DB export.
