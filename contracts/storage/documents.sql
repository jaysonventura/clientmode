-- v1.3 additive reference schema. Load after controller.sql.
-- Schema constraints are not authority enforcement, OCR, rendering, or a production migration.
PRAGMA foreign_keys=ON;
CREATE TABLE document_versions (
 version_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(project_id),
 document_id TEXT NOT NULL, attachment_id TEXT NOT NULL, content_digest TEXT NOT NULL,
 format TEXT NOT NULL, ingestion_status TEXT NOT NULL CHECK(ingestion_status IN('QUARANTINED','INGESTED','BLOCKED','UNSUPPORTED')),
 safety_status TEXT NOT NULL CHECK(safety_status IN('PASSED','FAILED','UNVERIFIED')),
 record_json TEXT NOT NULL, created_at TEXT NOT NULL,
 CHECK(ingestion_status!='INGESTED' OR safety_status='PASSED'),
 UNIQUE(project_id,version_id), UNIQUE(project_id,document_id,content_digest)
);
CREATE TRIGGER document_source_identity_immutable BEFORE UPDATE OF project_id,document_id,attachment_id,content_digest ON document_versions
 BEGIN SELECT RAISE(ABORT,'Source identity immutable; register a new version'); END;
CREATE TABLE document_jobs (
 job_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, request_id TEXT NOT NULL,
 operation TEXT NOT NULL CHECK(operation IN('read','analyze','review','edit','create','extract_requirements')),
 state TEXT NOT NULL CHECK(state IN('RECEIVED','PROCESSING','NEEDS_CLARIFICATION','VERIFYING','READY','PARTIAL','BLOCKED','PAUSED','CANCELLED','FAILED','STALE')),
 state_version INTEGER NOT NULL CHECK(state_version>=0), instruction_revision INTEGER NOT NULL CHECK(instruction_revision>=1),
 software_run_id TEXT, result_id TEXT, record_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 CHECK(state!='READY' OR result_id IS NOT NULL),
 FOREIGN KEY(project_id,request_id) REFERENCES client_requests(project_id,request_id),
 FOREIGN KEY(project_id,software_run_id) REFERENCES runs(project_id,run_id),
 FOREIGN KEY(project_id,job_id,result_id) REFERENCES document_results(project_id,job_id,result_id),
 UNIQUE(project_id,job_id)
);
CREATE TABLE document_job_sources (
 project_id TEXT NOT NULL, job_id TEXT NOT NULL, version_id TEXT NOT NULL,
 PRIMARY KEY(job_id,version_id),
 FOREIGN KEY(project_id,job_id) REFERENCES document_jobs(project_id,job_id),
 FOREIGN KEY(project_id,version_id) REFERENCES document_versions(project_id,version_id)
);
CREATE TABLE document_scopes (
 scope_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, job_id TEXT NOT NULL,
 scope_digest TEXT NOT NULL, inventory_digest TEXT NOT NULL, record_json TEXT NOT NULL,
 created_at TEXT NOT NULL,
 FOREIGN KEY(project_id,job_id) REFERENCES document_jobs(project_id,job_id),
 UNIQUE(project_id,job_id,scope_id)
);
CREATE TABLE document_results (
 result_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, job_id TEXT NOT NULL,
 instruction_revision INTEGER NOT NULL CHECK(instruction_revision>=1), source_scope_digest TEXT NOT NULL,
 qa_evidence_ref TEXT NOT NULL, record_json TEXT NOT NULL, created_at TEXT NOT NULL,
 FOREIGN KEY(project_id,job_id) REFERENCES document_jobs(project_id,job_id),
 UNIQUE(project_id,job_id,result_id)
);
CREATE TABLE document_questions (
 question_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, job_id TEXT NOT NULL,
 instruction_revision INTEGER NOT NULL CHECK(instruction_revision>=1),
 status TEXT NOT NULL CHECK(status IN('OPEN','ANSWERED','SUPERSEDED','CANCELLED')),
 record_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 FOREIGN KEY(project_id,job_id) REFERENCES document_jobs(project_id,job_id),
 UNIQUE(project_id,job_id,question_id)
);
CREATE UNIQUE INDEX one_document_question ON document_questions(job_id) WHERE status='OPEN';
CREATE TABLE document_answers (
 answer_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, job_id TEXT NOT NULL,
 question_id TEXT NOT NULL UNIQUE, request_id TEXT NOT NULL, actor_id TEXT NOT NULL, created_at TEXT NOT NULL,
 FOREIGN KEY(project_id,job_id,question_id) REFERENCES document_questions(project_id,job_id,question_id),
 FOREIGN KEY(project_id,request_id) REFERENCES client_requests(project_id,request_id)
);
CREATE TABLE document_dependencies (
 project_id TEXT NOT NULL, version_id TEXT NOT NULL, target_type TEXT NOT NULL CHECK(target_type IN('contract','context','document_result')),
 target_id TEXT NOT NULL, target_revision INTEGER NOT NULL CHECK(target_revision>=1), invalidated_at TEXT,
 PRIMARY KEY(project_id,version_id,target_type,target_id,target_revision),
 FOREIGN KEY(project_id,version_id) REFERENCES document_versions(project_id,version_id)
);
CREATE TABLE service_cases (
 case_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, request_id TEXT NOT NULL,
 severity TEXT NOT NULL CHECK(severity IN('critical','high','normal','low')),
 status TEXT NOT NULL CHECK(status IN('OPEN','TRIAGED','INVESTIGATING','RESOLVED','CLOSED')),
 record_json TEXT NOT NULL, created_at TEXT NOT NULL,
 FOREIGN KEY(project_id,request_id) REFERENCES client_requests(project_id,request_id)
);
-- All document/control/analysis attempts need one shared budget authority: production must
-- migrate usage/reservations to generic work ownership or add equivalent document tables.
-- The additive draft below records document attempts/costs without faking a software run.
CREATE TABLE document_attempts (
 attempt_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, job_id TEXT NOT NULL, lease_epoch INTEGER NOT NULL CHECK(lease_epoch>=1),
 status TEXT NOT NULL, record_json TEXT NOT NULL, created_at TEXT NOT NULL,
 FOREIGN KEY(project_id,job_id) REFERENCES document_jobs(project_id,job_id),
 UNIQUE(project_id,job_id,attempt_id)
);
CREATE TABLE document_usage (
 usage_id TEXT PRIMARY KEY, provider TEXT NOT NULL, provider_event_id TEXT NOT NULL,
 project_id TEXT NOT NULL, job_id TEXT NOT NULL, attempt_id TEXT NOT NULL,
 measured_cost_microusd INTEGER CHECK(measured_cost_microusd>=0), usage_complete INTEGER NOT NULL CHECK(usage_complete IN(0,1)),
 record_json TEXT NOT NULL, created_at TEXT NOT NULL,
 FOREIGN KEY(project_id,job_id,attempt_id) REFERENCES document_attempts(project_id,job_id,attempt_id),
 UNIQUE(provider,provider_event_id)
);
CREATE TABLE document_budget_reservations (
 reservation_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, job_id TEXT NOT NULL, attempt_id TEXT NOT NULL,
 reserved_microusd INTEGER CHECK(reserved_microusd>=0), reserved_tokens INTEGER CHECK(reserved_tokens>=0),
 status TEXT NOT NULL CHECK(status IN('RESERVED','SETTLED','RELEASED','UNKNOWN')),
 record_json TEXT NOT NULL, created_at TEXT NOT NULL,
 FOREIGN KEY(project_id,job_id,attempt_id) REFERENCES document_attempts(project_id,job_id,attempt_id)
);
CREATE TABLE document_events (
 job_id TEXT NOT NULL REFERENCES document_jobs(job_id), sequence INTEGER NOT NULL CHECK(sequence>=1),
 event_id TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(job_id,sequence)
);
CREATE TABLE document_outbox (
 outbox_id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES document_jobs(job_id),
 operation TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE, payload_json TEXT NOT NULL,
 status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0), created_at TEXT NOT NULL
);
