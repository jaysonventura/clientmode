-- Separate authenticated approval/release authority, not agent-readable local state.
PRAGMA foreign_keys = ON;
CREATE TABLE approvals (
 approval_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, actor_id TEXT NOT NULL,
 action TEXT NOT NULL, candidate_id TEXT, artifact_digest TEXT,
 target_environment TEXT NOT NULL, policy_digest TEXT NOT NULL,
 expires_at TEXT NOT NULL, nonce TEXT NOT NULL UNIQUE,
 maximum_spend_microusd INTEGER CHECK(maximum_spend_microusd >= 0),
 consumed_by_release_id TEXT UNIQUE, approved_at TEXT NOT NULL
);
CREATE TABLE deployments (
 deployment_id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
 approval_id TEXT NOT NULL UNIQUE REFERENCES approvals(approval_id),
 candidate_id TEXT NOT NULL, artifact_digest TEXT NOT NULL,
 target_environment TEXT NOT NULL, idempotency_key TEXT NOT NULL,
 provider_operation_id TEXT, status TEXT NOT NULL,
 recovery_plan_ref TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(project_id, idempotency_key)
);
CREATE TABLE deployment_observations (
 observation_id TEXT PRIMARY KEY, deployment_id TEXT NOT NULL REFERENCES deployments(deployment_id),
 observer_id TEXT NOT NULL, evidence_digest TEXT NOT NULL, result_json TEXT NOT NULL,
 observed_at TEXT NOT NULL
);
CREATE TABLE authority_audit (
 audit_id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, operation TEXT NOT NULL,
 target_ref TEXT NOT NULL, decision TEXT NOT NULL, created_at TEXT NOT NULL
);

CREATE TABLE approval_requests (
 approval_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, requested_by TEXT NOT NULL,
 state_version INTEGER NOT NULL CHECK(state_version >= 0), action TEXT NOT NULL,
 candidate_id TEXT, artifact_digest TEXT, target_environment TEXT NOT NULL,
 policy_digest TEXT NOT NULL, displayed_action_digest TEXT NOT NULL,
 description TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN('PENDING','APPROVED','DENIED','EXPIRED')),
 expires_at TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE approval_decisions (
 decision_id TEXT PRIMARY KEY, approval_id TEXT NOT NULL UNIQUE REFERENCES approval_requests(approval_id),
 actor_id TEXT NOT NULL, decision TEXT NOT NULL CHECK(decision IN('approve','deny')),
 granted_approval_id TEXT REFERENCES approvals(approval_id), created_at TEXT NOT NULL,
 CHECK((decision='approve' AND granted_approval_id IS NOT NULL) OR (decision='deny' AND granted_approval_id IS NULL))
);
