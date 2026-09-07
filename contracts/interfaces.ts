/** Client Mode custom boundary contracts, not provider configuration.
 * Types mirror domain.schema.json. Validate untrusted input against schema at runtime.
 * Hash/time/length constraints require runtime checks; TypeScript alone is insufficient.
 */
export type ClientRequest = {
  kind: "client_request";
  schema_version: 1;
  request_id: string;
  project_id: string;
  message: string;
  language_hint: "en" | "fil" | "mixed" | "unknown";
  attachment_ids: Array<string>;
  privacy_class: "public" | "internal" | "confidential" | "restricted";
  created_at: string;
};

export type Requirement = {
  id: string;
  description: string;
  source_message_ids: Array<string>;
  classification: "required" | "excluded" | "assumption" | "unresolved";
  material: boolean;
  document_citations?: Array<DocumentCitation>;
};

export type Project = {
  kind: "project";
  schema_version: 1;
  project_id: string;
  profile_id: string;
  registered_root_ref: string;
  data_class: "public" | "internal" | "confidential" | "restricted";
  created_at: string;
};

export type Contract = {
  kind: "contract";
  schema_version: 1;
  contract_id: string;
  project_id: string;
  revision: number;
  request_ids: Array<string>;
  requirements: Array<Requirement>;
  source_document_version_ids?: Array<string>;
  risk: "low" | "moderate" | "high";
  approved_development_scope: Array<string>;
  created_at: string;
};

export type Candidate = {
  kind: "candidate";
  schema_version: 1;
  candidate_id: string;
  project_id: string;
  run_id: string;
  source_digest: string;
  artifact_digest: string;
  requirements_revision: number;
  policy_digest: string;
  environment_digest: string;
  created_at: string;
};

export type CheckDefinition = {
  check_id: string;
  definition_digest: string;
  required: boolean;
  result_kind: "process" | "tests" | "browser" | "api" | "security";
  minimum_tests: number;
  required_assertion_ids: Array<string>;
  maximum_skipped: 0;
};

export type Policy = {
  kind: "policy";
  schema_version: 1;
  policy_id: string;
  project_id: string;
  policy_digest: string;
  requirements_revision: number;
  checks: Array<CheckDefinition>;
  maximum_age_seconds: number;
  trusted_issuer_ids: Array<string>;
  authority: "protected" | "advisory";
};

export type CheckResult = {
  check_id: string;
  definition_digest: string;
  status: "PASSED" | "FAILED" | "ERROR" | "TIMEOUT" | "SKIPPED" | "UNVERIFIED";
  executed: boolean;
  exit_code: number | null;
  tests_total: number;
  tests_passed: number;
  tests_skipped: number;
  assertion_ids: Array<string>;
  observer_id: string;
  log_digest: string;
};

export type Evidence = {
  kind: "evidence";
  schema_version: 1;
  evidence_id: string;
  candidate_id: string;
  project_id: string;
  run_id: string;
  attempt_id: string;
  source_digest: string;
  artifact_digest: string;
  requirements_revision: number;
  policy_digest: string;
  environment_digest: string;
  issuer_id: string;
  started_at: string;
  finished_at: string;
  integrity_passed: boolean;
  blocking_findings: Array<string>;
  results: Array<CheckResult>;
};

export type SignedEnvelope = {
  kind: "signed_envelope";
  schema_version: 1;
  issuer_id: string;
  algorithm: "Ed25519";
  payload_base64: string;
  signature_base64: string;
};

export type Approval = {
  kind: "approval";
  schema_version: 1;
  approval_id: string;
  project_id: string;
  actor_id: string;
  action: "api_spend" | "sensitive_data_share" | "install" | "deploy" | "destructive_operation" | "rollback";
  candidate_id: string | null;
  artifact_digest: string | null;
  target_environment: string;
  policy_digest: string;
  expires_at: string;
  nonce: string;
  maximum_spend_usd: number | null;
  consumed: boolean;
};

export type Run = {
  kind: "run";
  schema_version: 1;
  run_id: string;
  project_id: string;
  contract_id: string | null;
  requirements_revision: number;
  state: "RECEIVED" | "SCOPED" | "RUNNING" | "VERIFYING" | "NEEDS_REPAIR" | "READY_FOR_REVIEW" | "AWAITING_RELEASE_APPROVAL" | "DEPLOYING" | "RELEASED" | "BLOCKED" | "PAUSED" | "CANCELLED" | "FAILED" | "ROLLED_BACK";
  state_version: number;
  idempotency_key: string;
  candidate_id: string | null;
  provider: "claude" | "codex" | "mock";
  created_at: string;
  updated_at: string;
};

export type TaskAttempt = {
  kind: "task_attempt";
  schema_version: 1;
  task_id: string;
  attempt_id: string;
  run_id: string;
  project_id: string;
  attempt_number: number;
  role: "lead" | "writer" | "explorer" | "reviewer";
  parent_attempt_id: string | null;
  depth: number;
  workspace_id: string;
  base_source_digest: string;
  allowed_write_paths: Array<string>;
  dependency_task_ids: Array<string>;
  lease_epoch: number;
  deadline: string;
  provider_session_id: string | null;
  status: "QUEUED" | "LEASED" | "RUNNING" | "CLAIMED_COMPLETE" | "REVOKED" | "FAILED";
};

export type UsageEvent = {
  kind: "usage_event";
  schema_version: 1;
  usage_event_id: string;
  provider_event_id: string;
  run_id: string;
  attempt_id: string;
  provider: "claude" | "codex" | "mock";
  billing_mode: "native_account" | "approved_api";
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  reasoning_tokens: number | null;
  cost_usd: number | null;
  coverage: "complete" | "partial" | "unavailable";
  occurred_at: string;
};

export type AuditEvent = {
  kind: "audit_event";
  schema_version: 1;
  event_id: string;
  run_id: string;
  sequence: number;
  actor_id: string;
  event_type: "request_received" | "contract_revised" | "job_admitted" | "job_revoked" | "candidate_sealed" | "verification_requested" | "evidence_rejected" | "readiness_changed" | "approval_requested" | "approval_recorded" | "deployment_intent" | "deployment_observed" | "budget_paused" | "security_denial" | "question_asked" | "question_answered" | "message_received" | "attempt_fenced" | "responsibility_assigned";
  payload: Record<string, unknown>;
  occurred_at: string;
};

export type Capability = {
  name: string;
  documented: boolean;
  configured: boolean;
  observed_working: boolean;
  evidence_refs: Array<string>;
  limitation: string | null;
};

export type CapabilityReport = {
  kind: "capability_report";
  schema_version: 1;
  report_id: string;
  provider: "claude" | "codex" | "mock";
  host_surface: "native_cli" | "sdk" | "app_server" | "mock";
  host_version: string;
  sdk_version: string | null;
  os: string;
  billing_mode: "native_account" | "approved_api" | "unknown";
  capabilities: Array<Capability>;
  observed_at: string;
};

export type Feedback = {
  kind: "feedback";
  schema_version: 1;
  feedback_id: string;
  project_id: string;
  run_id: string;
  candidate_id: string;
  actor_id: string;
  message: string;
  satisfaction: "not_recorded" | "needs_changes" | "accepted";
  created_at: string;
};

export type ApprovalRequest = {
  kind: "approval_request";
  schema_version: 1;
  approval_id: string;
  project_id: string;
  requested_by: string;
  state_version: number;
  action: "api_spend" | "sensitive_data_share" | "install" | "deploy" | "destructive_operation" | "rollback";
  candidate_id: string | null;
  artifact_digest: string | null;
  target_environment: string;
  policy_digest: string;
  displayed_action_digest: string;
  description: string;
  status: "PENDING" | "APPROVED" | "DENIED" | "EXPIRED";
  expires_at: string;
  created_at: string;
};

export type ApprovalDecision = {
  kind: "approval_decision";
  schema_version: 1;
  decision_id: string;
  approval_id: string;
  actor_id: string;
  decision: "approve" | "deny";
  approval: Approval | null;
  created_at: string;
};

export type Deployment = {
  kind: "deployment";
  schema_version: 1;
  deployment_id: string;
  project_id: string;
  approval_id: string;
  candidate_id: string;
  artifact_digest: string;
  target_environment: string;
  status: "DEPLOYING" | "RELEASED" | "FAILED" | "ROLLED_BACK";
  smoke_evidence_ids: Array<string>;
  created_at: string;
  updated_at: string;
};

export type Attachment = {
  kind: "attachment";
  schema_version: 1;
  attachment_id: string;
  project_id: string;
  media_type: "image/png" | "image/jpeg" | "image/webp" | "text/plain" | "text/markdown" | "application/json" | "application/pdf" | "application/vnd.openxmlformats-officedocument.wordprocessingml.document" | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" | "application/vnd.openxmlformats-officedocument.presentationml.presentation" | "text/csv" | "text/tab-separated-values";
  byte_length: number;
  content_digest: string;
  privacy_class: "public" | "internal" | "confidential" | "restricted";
  created_at: string;
};



/** Task-local engineering knowledge, not a provider setting or an acceptance verdict. */
export type EngineeringComponent = {
  component_id: string;
  root_ref: string;
  domain: string;
  languages: string[];
  frameworks: string[];
  target_platforms: string[];
  environment_ref: string | null;
  grounding_status: 'NEEDS_GROUNDING' | 'GROUNDED' | 'BLOCKED';
  source_refs: string[];
  required_check_ids: string[];
  capability_gaps: string[];
};
export type EngineeringContext = {
  kind: 'engineering_context';
  schema_version: 1;
  context_id: string;
  project_id: string;
  task_id: string;
  source_digest: string;
  requirements_revision: number;
  components: EngineeringComponent[];
  observed_at: string;
};

export type Actor = 'client' | 'controller' | 'worker' | 'verifier' | 'release' | 'maintainer';
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type ProviderName = 'claude' | 'codex';
export type BillingMode = 'native_account' | 'approved_api';
export interface ProviderContext {
  project_id: string; run_id: string; attempt_id: string; workspace_id: string;
  contract: Contract; task: TaskAttempt; evidence_ids: string[];
  engineering_context: EngineeringContext;
  billing_mode: BillingMode; capability_report_id: string;
}
export type ProviderEvent =
  | { type: 'session'; session_id: string; attempt_id: string }
  | { type: 'claim'; attempt_id: string; text: string }
  | { type: 'usage'; event: UsageEvent }
  | { type: 'approval_required'; attempt_id: string; action: string; description: string }
  | { type: 'blocked'; attempt_id: string; code: string; message: string }
  | { type: 'ended'; attempt_id: string; reason: 'completed_turn' | 'cancelled' | 'limit' | 'error' };
export interface ProviderAdapter {
  name: ProviderName;
  discover(signal: AbortSignal): Promise<CapabilityReport>;
  start(context: ProviderContext, signal: AbortSignal): AsyncIterable<ProviderEvent>;
  resume(session_id: string, context: ProviderContext, signal: AbortSignal): AsyncIterable<ProviderEvent>;
  cancel(attempt_id: string): Promise<{ acknowledged: boolean; requires_reconciliation: boolean }>;
}
export interface TransitionRequest {
  run_id: string; expected_version: number; target: Run['state'];
  actor: Actor; reason: string; guard_evidence_ids: string[]; idempotency_key: string;
}
export interface StateStore {
  createRun(request: ClientRequest, idempotency_key: string): Promise<Run>;
  getRun(run_id: string): Promise<Run>;
  transition(request: TransitionRequest): Promise<Run>;
  claimTask(task_id: string, owner_id: string, deadline: string): Promise<TaskAttempt>;
  recordUsage(event: UsageEvent): Promise<'inserted' | 'duplicate'>;
}
export interface CandidateStore {
  seal(project_id: string, run_id: string, workspace_id: string, contract: Contract): Promise<Candidate>;
  get(candidate_id: string): Promise<Candidate>;
}
export interface VerificationRequest {
  project_id: string; run_id: string; attempt_id: string; candidate_id: string;
  policy_id: string; check_ids: string[]; idempotency_key: string;
}
export interface ProtectedExecutionDefinition {
  check: CheckDefinition; argv: string[]; cwd_relative: string;
  parser_id: string; timeout_seconds: number; maximum_output_bytes: number;
  environment_profile_id: string; network_profile_id: string;
}
export interface VerificationService {
  request(request: VerificationRequest, signal: AbortSignal): Promise<SignedEnvelope>;
  read(evidence_id: string): Promise<SignedEnvelope>;
}
export interface Verdict {
  verdict: 'UNVERIFIED' | 'VERIFIED_FOR_SCOPE'; reasons: string[];
  candidate_id?: string; evidence_id?: string;
}
export interface ReleaseRequest {
  approval_id: string; candidate_id: string; target_environment: string;
  idempotency_key: string;
}
export interface ReleaseResult {
  deployment_id: string; candidate_id: string; artifact_digest: string;
  status: 'DEPLOYING' | 'RELEASED' | 'FAILED' | 'ROLLED_BACK'; smoke_evidence_ids: string[];
}
export interface ReleaseService {
  deploy(request: ReleaseRequest, signal: AbortSignal): Promise<ReleaseResult>;
  reconcile(deployment_id: string): Promise<ReleaseResult>;
}
export interface ScenarioObservation {
  scenario_id: string;
  observed: Record<string, Json>;
  artifact_paths: string[];
  mode: 'unit' | 'integration' | 'live_provider' | 'benchmark' | 'manual_review';
}
export type ScenarioExecutor = () => Promise<ScenarioObservation>;

/** v1.2 draft additions. Runtime schema/service checks enforce relational constraints. */
export type ClientQuestion = {
  kind: 'client_question'; schema_version: 1; question_id: string;
  project_id: string; run_id: string; requirements_revision: number;
  state_version: number; prompt: string; recommendation: string | null;
  blocking_task_ids: string[]; source_request_ids: string[];
  status: 'OPEN' | 'ANSWERED' | 'SUPERSEDED' | 'CANCELLED';
  created_at: string; updated_at: string;
};
export type ClientAnswer = {
  kind: 'client_answer'; schema_version: 1; answer_id: string;
  question_id: string; project_id: string; run_id: string; request_id: string;
  actor_id: string; created_at: string;
};
export type RunMessage = {
  kind: 'run_message'; schema_version: 1; message_id: string;
  project_id: string; run_id: string; request_id: string; actor_id: string;
  applied_requirements_revision: number | null; created_at: string;
};
/** These services are custom boundaries to implement, not native provider APIs. */
export interface ClientInteractionService {
  listQuestions(run_id: string, actor: Actor): Promise<ClientQuestion[]>;
  answer(question_id: string, expected_version: number, request: ClientRequest,
    authenticated_actor_id: string, idempotency_key: string): Promise<ClientAnswer>;
  message(run_id: string, expected_version: number, request: ClientRequest,
    authenticated_actor_id: string, idempotency_key: string): Promise<RunMessage>;
}

export type DocumentLocator = ({ type: "page"; page_number: number }) | ({ type: "sheet"; sheet_name: string; cell_range: string }) | ({ type: "paragraph"; part_name: string; block_path: string }) | ({ type: "slide"; slide_number: number; shape_id: string }) | ({ type: "image"; box: Array<number> }) | ({ type: "text"; start_line: number; end_line: number });

export type DocumentCitation = { version_id: string; content_digest: string; locator: DocumentLocator; excerpt?: string };

export type DocumentVersion = { kind: "document_version"; schema_version: 1; version_id: string; document_id: string; project_id: string; attachment_id: string; content_digest: string; format: "pdf" | "docx" | "xlsx" | "csv" | "tsv" | "pptx" | "image" | "text"; ingestion_status: "QUARANTINED" | "INGESTED" | "BLOCKED" | "UNSUPPORTED"; safety_status: "PASSED" | "FAILED" | "UNVERIFIED"; pipeline_digest: string; created_at: string };

export type DocumentJob = { kind: "document_job"; schema_version: 1; job_id: string; project_id: string; request_id: string; operation: "read" | "analyze" | "review" | "edit" | "create" | "extract_requirements"; input_version_ids: Array<string>; software_run_id: (string) | (null); state: "RECEIVED" | "PROCESSING" | "NEEDS_CLARIFICATION" | "VERIFYING" | "READY" | "PARTIAL" | "BLOCKED" | "PAUSED" | "CANCELLED" | "FAILED" | "STALE"; state_version: number; instruction_revision: number; result_id: (string) | (null); created_at: string; updated_at: string };

export type DocumentScopeUnit = { unit_id: string; version_id: string; locator: DocumentLocator; visual_required: boolean; numeric_required: boolean };

export type DocumentScope = { kind: "document_scope"; schema_version: 1; scope_id: string; job_id: string; project_id: string; scope_mode: "entire_inputs" | "selected_units" | "generated_output"; source_version_ids: Array<string>; scope_digest: string; inventory_digest: string; units: Array<DocumentScopeUnit>; created_at: string };

export type DocumentFinding = { kind: "document_finding"; schema_version: 1; finding_id: string; job_id: string; project_id: string; classification: "observed" | "conflict" | "inference" | "suggestion" | "unreadable"; material: boolean; statement: string; citations: Array<DocumentCitation>; resolution: "unresolved" | "source_confirmed" | "client_answered" | "not_applicable"; created_at: string };

export type DocumentArtifact = { artifact_id: string; content_digest: string; media_type: string; byte_length: number; editable: boolean };

export type DocumentResult = { kind: "document_result"; schema_version: 1; result_id: string; job_id: string; project_id: string; instruction_revision: number; source_scope_digest: string; source_version_ids: Array<string>; coverage: "COMPLETE" | "PARTIAL"; limitations: Array<string>; calculation_status: "VERIFIED" | "UNVERIFIED" | "NOT_APPLICABLE"; qa_evidence_ref: string; artifacts: Array<DocumentArtifact>; created_at: string };

export type DocumentQuestion = { kind: "document_question"; schema_version: 1; question_id: string; job_id: string; project_id: string; instruction_revision: number; prompt: string; recommendation: (string) | (null); citations: Array<DocumentCitation>; status: "OPEN" | "ANSWERED" | "SUPERSEDED" | "CANCELLED"; created_at: string };

export type DocumentAnswer = { kind: "document_answer"; schema_version: 1; answer_id: string; question_id: string; job_id: string; project_id: string; request_id: string; actor_id: string; created_at: string };

export type ServiceCase = { kind: "service_case"; schema_version: 1; case_id: string; project_id: string; request_id: string; severity: "critical" | "high" | "normal" | "low"; status: "OPEN" | "TRIAGED" | "INVESTIGATING" | "RESOLVED" | "CLOSED"; coverage_mode: "on_demand" | "configured_service"; related_run_id: (string) | (null); related_deployment_id: (string) | (null); created_at: string };

/** All input/output values require runtime validation and project/actor checks. */
export interface DocumentService {
  ingest(projectId: string, attachmentId: string, idempotencyKey: string): Promise<DocumentVersion>;
  createJob(projectId: string, requestId: string, operation: DocumentJob['operation'], versionIds: string[], idempotencyKey: string): Promise<DocumentJob>;
  defineScope(jobId: string, expectedVersion: number): Promise<DocumentScope>;
  analyze(jobId: string, scopeId: string): Promise<Array<DocumentFinding>>;
  answer(questionId: string, clientRequestId: string, expectedRevision: number): Promise<DocumentAnswer>;
  revise(jobId: string, clientRequestId: string, expectedVersion: number): Promise<DocumentJob>;
  control(jobId: string, action: 'pause' | 'resume' | 'cancel', expectedVersion: number): Promise<DocumentJob>;
  getResult(resultId: string): Promise<DocumentResult>;
}
export interface ServiceCaseService {
  open(projectId: string, clientRequestId: string, idempotencyKey: string): Promise<ServiceCase>;
  triage(caseId: string): Promise<ServiceCase>;
}

/** Draft document acceptance boundaries, separate from software Candidate. */
export type DocumentPolicy = {
 kind: 'document_policy'; schema_version: 1; policy_id: string; project_id: string;
 job_id: string; instruction_revision: number; authority: 'protected';
 scope_digest: string; policy_digest: string; maximum_age_seconds: number;
 trusted_issuer_ids: string[]; checks: CheckDefinition[];
};
export type DocumentEvidence = {
 kind: 'document_evidence'; schema_version: 1; evidence_id: string; project_id: string;
 job_id: string; attempt_id: string; instruction_revision: number; issuer_id: string;
 scope_digest: string; source_manifest_digest: string; output_manifest_digest: string;
 policy_digest: string; pipeline_digest: string; results: CheckResult[];
 integrity_passed: boolean; blocking_findings: string[]; started_at: string; finished_at: string;
};
export interface DocumentVerificationRequest {
 project_id: string; job_id: string; attempt_id: string; instruction_revision: number;
 scope_id: string; policy_id: string; draft_artifact_ids: string[]; idempotency_key: string;
}
export interface DocumentVerificationService {
 request(request: DocumentVerificationRequest, signal: AbortSignal): Promise<SignedEnvelope>;
 evaluate(jobId: string, envelope: SignedEnvelope): Promise<{
   verdict: 'VERIFIED_FOR_SCOPE' | 'UNVERIFIED'; evidence_id: string | null; reasons: string[];
 }>;
}
