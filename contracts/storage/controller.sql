-- Reference schema v1: single-user controller; NOT a privilege boundary.
-- Product must add controlled migrations and tested encrypted-storage policy as needed.
PRAGMA foreign_keys = ON;
CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE projects (
 project_id TEXT PRIMARY KEY, registered_root_ref TEXT NOT NULL UNIQUE,
 profile_id TEXT NOT NULL, data_class TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE client_requests (
 request_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(project_id),
 message TEXT NOT NULL, attachment_ids_json TEXT NOT NULL,
 language_hint TEXT NOT NULL, privacy_class TEXT NOT NULL, created_at TEXT NOT NULL,
 UNIQUE(project_id, request_id)
);
CREATE TABLE contracts (
 contract_id TEXT NOT NULL, project_id TEXT NOT NULL REFERENCES projects(project_id),
 revision INTEGER NOT NULL CHECK(revision >= 1), contract_json TEXT NOT NULL,
 digest TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(contract_id, revision), UNIQUE(project_id, contract_id, revision)
);
CREATE TABLE runs (
 run_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(project_id),
 contract_id TEXT, requirements_revision INTEGER NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('RECEIVED','SCOPED','RUNNING','VERIFYING','NEEDS_REPAIR',
 'READY_FOR_REVIEW','AWAITING_RELEASE_APPROVAL','DEPLOYING','RELEASED','BLOCKED','PAUSED',
 'CANCELLED','FAILED','ROLLED_BACK')),
 state_version INTEGER NOT NULL DEFAULT 0 CHECK(state_version >= 0),
 idempotency_key TEXT NOT NULL, request_digest TEXT NOT NULL,
 candidate_id TEXT, provider TEXT NOT NULL CHECK(provider IN ('claude','codex','mock')),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 FOREIGN KEY(project_id, contract_id, requirements_revision) REFERENCES contracts(project_id, contract_id, revision),
 FOREIGN KEY(project_id, run_id, candidate_id) REFERENCES candidates(project_id, run_id, candidate_id),
 CHECK(state NOT IN ('READY_FOR_REVIEW','AWAITING_RELEASE_APPROVAL','DEPLOYING','RELEASED','ROLLED_BACK') OR candidate_id IS NOT NULL),
 UNIQUE(project_id, idempotency_key), UNIQUE(project_id, run_id),
 CHECK((contract_id IS NULL AND requirements_revision=0 AND state IN ('RECEIVED','BLOCKED','PAUSED','CANCELLED','FAILED')) OR
       (contract_id IS NOT NULL AND requirements_revision>=1))
);
CREATE TABLE task_attempts (
 attempt_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, run_id TEXT NOT NULL,
 task_id TEXT NOT NULL, attempt_number INTEGER NOT NULL CHECK(attempt_number >= 1),
 role TEXT NOT NULL, parent_attempt_id TEXT, depth INTEGER NOT NULL CHECK(depth BETWEEN 0 AND 1),
 workspace_id TEXT NOT NULL, allowed_write_paths_json TEXT NOT NULL,
 dependency_task_ids_json TEXT NOT NULL, base_source_digest TEXT NOT NULL,
 lease_epoch INTEGER NOT NULL CHECK(lease_epoch >= 1), deadline TEXT NOT NULL,
 provider_session_id TEXT, status TEXT NOT NULL,
 FOREIGN KEY(project_id, run_id) REFERENCES runs(project_id, run_id),
 UNIQUE(run_id, task_id, attempt_number), UNIQUE(project_id, attempt_id),
 UNIQUE(run_id, attempt_id), UNIQUE(project_id, run_id, attempt_id)
);
CREATE TABLE workspace_leases (
 lease_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, attempt_id TEXT NOT NULL,
 workspace_id TEXT NOT NULL, owner_id TEXT NOT NULL,
 is_writer INTEGER NOT NULL CHECK(is_writer IN (0,1)),
 active INTEGER NOT NULL CHECK(active IN (0,1)),
 epoch INTEGER NOT NULL CHECK(epoch >= 1), expires_at TEXT NOT NULL,
 FOREIGN KEY(project_id, attempt_id) REFERENCES task_attempts(project_id, attempt_id)
);
CREATE UNIQUE INDEX one_active_writer_per_project ON workspace_leases(project_id)
 WHERE active = 1 AND is_writer = 1;
CREATE TABLE candidates (
 candidate_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, run_id TEXT NOT NULL,
 source_digest TEXT NOT NULL, artifact_digest TEXT NOT NULL,
 requirements_revision INTEGER NOT NULL, policy_digest TEXT NOT NULL,
 environment_digest TEXT NOT NULL, created_at TEXT NOT NULL,
 FOREIGN KEY(project_id, run_id) REFERENCES runs(project_id, run_id),
 UNIQUE(project_id, candidate_id), UNIQUE(project_id, run_id, candidate_id)
);
CREATE TABLE evidence_references (
 evidence_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, candidate_id TEXT NOT NULL,
 envelope_digest TEXT NOT NULL, protected_store_ref TEXT NOT NULL,
 received_at TEXT NOT NULL,
 FOREIGN KEY(project_id, candidate_id) REFERENCES candidates(project_id, candidate_id)
);
CREATE TABLE usage_events (
 usage_event_id TEXT PRIMARY KEY, provider_event_id TEXT NOT NULL,
 provider TEXT NOT NULL, billing_mode TEXT NOT NULL,
 project_id TEXT NOT NULL, run_id TEXT NOT NULL, attempt_id TEXT NOT NULL,
 input_tokens INTEGER CHECK(input_tokens >= 0), output_tokens INTEGER CHECK(output_tokens >= 0),
 cache_read_tokens INTEGER CHECK(cache_read_tokens >= 0), cache_write_tokens INTEGER CHECK(cache_write_tokens >= 0),
 cost_microusd INTEGER CHECK(cost_microusd >= 0), usage_complete INTEGER NOT NULL CHECK(usage_complete IN(0,1)),
 created_at TEXT NOT NULL,
 FOREIGN KEY(project_id, run_id) REFERENCES runs(project_id, run_id),
 FOREIGN KEY(project_id, run_id, attempt_id) REFERENCES task_attempts(project_id, run_id, attempt_id),
 UNIQUE(provider, provider_event_id)
);
CREATE TABLE budget_reservations (
 reservation_id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(run_id),
 attempt_id TEXT NOT NULL REFERENCES task_attempts(attempt_id),
 reserved_microusd INTEGER CHECK(reserved_microusd >= 0),
 reserved_tokens INTEGER CHECK(reserved_tokens >= 0),
 verification_reserve INTEGER NOT NULL CHECK(verification_reserve IN(0,1)),
 status TEXT NOT NULL CHECK(status IN('RESERVED','SETTLED','RELEASED','UNKNOWN')),
 created_at TEXT NOT NULL,
 FOREIGN KEY(run_id, attempt_id) REFERENCES task_attempts(run_id, attempt_id)
);
CREATE TABLE events (
 run_id TEXT NOT NULL REFERENCES runs(run_id), sequence INTEGER NOT NULL CHECK(sequence >= 1),
 event_id TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, payload_json TEXT NOT NULL,
 created_at TEXT NOT NULL, PRIMARY KEY(run_id, sequence)
);
CREATE TABLE outbox (
 outbox_id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(run_id),
 operation TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE,
 payload_json TEXT NOT NULL, status TEXT NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0), created_at TEXT NOT NULL
);
CREATE TABLE feedback (
 feedback_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, candidate_id TEXT NOT NULL,
 client_request_id TEXT NOT NULL, satisfaction TEXT NOT NULL,
 next_contract_revision INTEGER, created_at TEXT NOT NULL,
 FOREIGN KEY(project_id, candidate_id) REFERENCES candidates(project_id, candidate_id),
 FOREIGN KEY(project_id, client_request_id) REFERENCES client_requests(project_id, request_id)
);
CREATE TABLE context_facts (
 fact_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(project_id),
 source_ref TEXT NOT NULL, source_digest TEXT NOT NULL,
 value_json TEXT NOT NULL, freshness_rule TEXT NOT NULL,
 observed_at TEXT NOT NULL, invalidated_at TEXT
);
CREATE TABLE capability_reports (
 report_id TEXT PRIMARY KEY, host TEXT NOT NULL, version TEXT NOT NULL,
 report_json TEXT NOT NULL, report_digest TEXT NOT NULL, observed_at TEXT NOT NULL
);
CREATE TABLE audit_events (
 audit_id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(project_id),
 run_id TEXT REFERENCES runs(run_id), actor_id TEXT NOT NULL, kind TEXT NOT NULL,
 payload_json TEXT NOT NULL, created_at TEXT NOT NULL
);

-- v1.2 draft additions. Authorization remains in the separately controlled service.
CREATE TABLE client_questions (
 question_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, run_id TEXT NOT NULL,
 requirements_revision INTEGER NOT NULL CHECK(requirements_revision>=0),
 state_version INTEGER NOT NULL CHECK(state_version>=0), prompt TEXT NOT NULL,
 recommendation TEXT, blocking_task_ids_json TEXT NOT NULL, source_request_ids_json TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('OPEN','ANSWERED','SUPERSEDED','CANCELLED')),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 FOREIGN KEY(project_id,run_id) REFERENCES runs(project_id,run_id),
 UNIQUE(project_id,run_id,question_id)
);
CREATE UNIQUE INDEX one_visible_question_per_run ON client_questions(run_id) WHERE status='OPEN';
CREATE TABLE client_answers (
 answer_id TEXT PRIMARY KEY, question_id TEXT NOT NULL UNIQUE,
 project_id TEXT NOT NULL, run_id TEXT NOT NULL, request_id TEXT NOT NULL,
 actor_id TEXT NOT NULL, created_at TEXT NOT NULL,
 FOREIGN KEY(project_id,run_id,question_id) REFERENCES client_questions(project_id,run_id,question_id),
 FOREIGN KEY(project_id,request_id) REFERENCES client_requests(project_id,request_id)
);
CREATE TABLE run_messages (
 message_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, run_id TEXT NOT NULL,
 request_id TEXT NOT NULL, actor_id TEXT NOT NULL,
 applied_requirements_revision INTEGER CHECK(applied_requirements_revision>=1),
 created_at TEXT NOT NULL,
 FOREIGN KEY(project_id,run_id) REFERENCES runs(project_id,run_id),
 FOREIGN KEY(project_id,request_id) REFERENCES client_requests(project_id,request_id),
 UNIQUE(run_id,request_id)
);
