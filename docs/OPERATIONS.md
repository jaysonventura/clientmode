# Installation, Operations, API, and Release Runbooks

All `cm` commands in this file are **product interfaces to implement**. They are not supplied executables in the handoff archive.

## 1. Runtime configuration

| Variable | Default | Meaning |
|---|---|---|
| `CM_STATE_DIR` | OS application data directory / client-mode | Private local operational DB and caches; never shared across OS users |
| `CM_BIND_HOST` | `127.0.0.1` | Reject non-loopback binding in v1 unless a separately secured deployment profile is implemented |
| `CM_PORT` | `4317` | Controller port; choose a free port when occupied and report actual URL |
| `CM_LOG_LEVEL` | `warn` for client output, structured internal events | Never suppress mandatory audit events |
| `CM_QUIET` | `true` | No routine narrative reporting |
| `CM_PROVIDER` | detected active host | `claude` or `codex`; no silent cross-provider fallback |
| `CM_BILLING_MODE` | `native_account` for native entry | `native_account` or `approved_api`; API mode needs an approved budget |
| `CM_MAX_CHILDREN` | `2` | Upper bound, not a requirement to spawn children |
| `CM_MAX_DEPTH` | `1` | Prevent nested delegated admission |
| `CM_MAX_REPAIRS` | `3` | Per-task repair bound |
| `CM_TASK_TIMEOUT_SECONDS` | `1800` | Initial bounded task ceiling; larger work is decomposed or explicitly budgeted |
| `CM_CHECK_TIMEOUT_SECONDS` | `300` | Protected profile may set check-specific bounds |
| `CM_API_BUDGET_USD` | unset | No API spending authorized until configured by an approved actor |
| `CM_VERIFIER_ENDPOINT` | unset | Protected service/IPC; unset means no protected production verdict |
| `CM_VERIFIER_TRUST_BUNDLE` | controlled path | Public verification keys and issuer IDs, never candidate-defined |
| `CM_RELEASE_ENABLED` | `false` | Production action path disabled until configured and tested |
| `CM_TELEMETRY_EXPORT` | `false` | Optional external metrics export |
| `CM_LOG_RETENTION_DAYS` | `30` | Raw diagnostic retention unless policy overrides |
| `CM_EVIDENCE_RETENTION_DAYS` | `90` | Structured evidence retention unless policy overrides |

Store provider credentials only through documented secure authorization mechanisms. Configuration contains secret references, not raw keys committed to Git. A hosted SDK mode may have different permitted authentication and billing from native CLI mode; setup must make that distinction visible.

## 2. Commands and exit status

| Interface | Behavior |
|---|---|
| `cm doctor --json` | Discover versions, auth mode, sandbox, browser/test runner, trusted verifier, and effective probes; report configured versus tested |
| `cm install --host claude|codex --dry-run` | Produce proposed config/plugin change set without applying |
| `cm install --host ...` | Apply approved changes with backup and installed-path smoke test |
| `cm uninstall --host ...` | Remove only owned artifacts/settings; retain project work and explain retained evidence |
| `cm upgrade --version VERSION` | Verify integrity, snapshot config/state, migrate with compatibility checks, and stage activation |
| `cm open [PROJECT]` | Open authenticated quiet console and register only explicitly chosen project roots |
| `cm run --project ID --request-file PATH` | Create idempotent run from authorized local file; stdin input supported |
| `cm pause RUN` / `cm resume RUN` / `cm cancel RUN` | Mutate state and reconcile worker lifecycle; never invent resumed progress |
| `cm status RUN --json` | Structured status, pending authority, readiness tier, and usage availability |
| `cm verify --candidate ID` | Request protected checks; cannot submit arbitrary command strings |
| `cm export-evidence --candidate ID` | Export signed records/log references with secrets redacted and retention checks |
| `cm rollback --toolkit-version VERSION` | Restore a compatible, verified toolkit version with state/configuration safeguards |
| `cm rollback --deployment ID --approval ID` | Execute only the scoped, previously authorized compatible deployment recovery plan |

Exit codes: `0` successful command within stated scope; `2` input/contract error; `3` missing capability/auth/environment; `4` verification not accepted; `5` authorization required/denied; `6` budget or no-progress pause; `7` integrity/security failure; `8` internal/service failure. Do not conflate CLI process success with a ready product verdict.

## 3. Bootstrap sequence — AI/engineer owned

Inspect OS and installed versions. Preserve existing settings and repository changes. Discover the current official extension/SDK contracts. Select and lock a compatible supported Node LTS and dependencies. Build deterministic core first using mock provider events. Register a disposable project, create protected fixture policy, and run the negative verifier tests.

Then validate the active provider on a minimal live task, with approved account usage. Install its adapter in a fresh session and prove discovery/permissions/cancellation. Repeat for the second provider before claiming parity. Establish real browser automation and protected CI/service isolation. Start the quiet console, complete the sample request, inject a defect, demonstrate rejection, repair, and produce new evidence. Finally run qualification, exercise rollback, and publish the observed support matrix.

The client may need to authorize a folder, complete an account/browser login, approve system installation, or grant a metered API budget. Those steps cannot be bypassed. The engineer should not give the client a long technical checklist.

## 4. Database design

Executable reference schemas are in `contracts/storage/controller.sql`, `contracts/storage/verifier.sql`, and `contracts/storage/release.sql`. They use the same `project_id`, `run_id`, and entity identifiers as the JSON contracts. The controller stores requests, contract revisions, runs, attempts, leases, candidates, references, usage, reservations, events/outbox, feedback, facts, and capability reports. The protected verifier owns policy/check versions, observed jobs/executions and signed envelopes. Separate release authority owns pending decisions, approved grants, deployments and audit records.

These are schema blueprints, not a running access-control system. Separate files or SQLite connections do not create separate OS principals. Candidate/worker processes must not read or write protected service storage. Private signing keys never belong in a DB export. `ClientMessage` maps to `client_requests`; `RequirementRevision` maps to `contracts`; `WorkspaceLease` maps to `workspace_leases`; evidence records are protected while the controller retains references.

State mutation and event/outbox insertion are one transaction. CAS uses `run_id` and `state_version`, requiring exactly one updated row. The runs table enforces unique `(project_id,idempotency_key)`; compare stored `request_digest` to reject the same key with changed input. Unique writer leases reject simultaneous writing tasks under the initial profile. Signed-service validation and runtime guards enforce constraints SQL alone cannot establish.

Reference SQL tests check parsing, selected uniqueness/foreign-key/state constraints, commit/reopen, CAS and rollback atomicity. They do not prove process-kill recovery, whole-service isolation, or durable external side effects. Add migrations with explicit version, backup and compatibility tests in M1/M5.

## 5. API behavior

The OpenAPI design covers projects, runs, client decisions/feedback, events, evidence requests, approval decisions, and deployment. All IDs are server-issued opaque identifiers resolved in the actor's scope. Do not accept arbitrary verifier URLs, filesystem paths, or signing keys from a worker.

Error envelope:

```json
{
  "error": {
    "code": "APPROVAL_REQUIRED",
    "message": "Publishing will update the live site. Approval is required.",
    "retryable": false,
    "request_id": "req_example_01",
    "next_action": "approve_release"
  }
}
```

Use HTTP `401` for unauthenticated, `403` for forbidden, `404` for inaccessible/nonexistent scoped resource, `409` for stale state/idempotency mismatch, `422` for invalid schema, `429` for rate limit, and `503` for unavailable provider/service. SSE uses `id: SEQUENCE`, stable event names, and resumable cursors. On retention gaps, return an explicit snapshot-required response.

## 6. Observability

Each event includes project/run/task/attempt, candidate when relevant, provider session, correlation ID, actor, timestamp, and monotonically increasing run sequence. Raw tool output is bounded, redacted, and stored separately. A compact per-task summary is a convenience view, not authoritative state.

Metrics: accepted-task count/rate; false-ready events; unverified candidates; policy/attestation rejections; approval attempts/denials/replays; stale leases; queue age; cancel latency; orphan workers; repairs by diagnosis signature; provider usage coverage; reserved/observed spend; time to verified result; client interruption count; and wrong-project access attempts.

Alert immediately on secret exposure, unexpected production action, accepted forged evidence, signing key misuse, and policy bypass. Alert on repeated unavailable verifier, stuck deployment, usage accounting gaps, and failing recovery. Do not send external telemetry or private transcripts unless explicitly configured.

## 7. Operational objectives

Use master NFR latency targets for controlled local services, excluding model/network/test execution. For a continuously running protected verification service, target 99.5% availability during agreed operating hours and report sample period. A sleeping laptop has no uptime promise. Recovery point for acknowledged local state is zero committed transactions lost in normal process crashes; disk loss requires backups and has a separately measured recovery window.

Back up state before upgrades and at configured intervals. Test restore of the operational database plus content-addressed artifacts and public-key trust data. Do not copy signing keys into ordinary client backups; manage them separately. An audit retention lock must survive restore.

## 8. Runbooks

### Provider outage / rate limit
Stop admitting jobs for the affected provider. Persist retry-after and remaining reservations. Use bounded backoff with jitter for transient errors; no busy polling and no silent billing/provider switch. Continue independent deterministic work. Resume after authenticated availability check. Notify the client only if their run needs action or cannot progress.

### Stalled or orphaned worker
Compare heartbeat, lease epoch, provider status, and actual process identity. Revoke the lease before retrying; quarantine late artifacts. Kill only owned process groups. Never use a broad `killall` or delete an unknown workspace. Record cancellation limits and reconcile external side effects.

### Verification unavailable
Keep the candidate `UNVERIFIED`; retain diagnostics but never substitute the writer's answer. Retry infrastructure at most once under the default policy. Escalate to the service owner, not the client, unless access authorization is required.

### Suspected evidence tampering
Freeze readiness/deployment for affected candidates. Preserve logs and manifests. Revoke suspect issuer keys or sessions as appropriate. Security reviews provenance and key access. Re-run from immutable source in a clean environment using trusted policy. Do not delete suspicious evidence to make the audit look clean.

### Budget exhaustion
Stop new model calls before the reserve is exhausted. Request controlled cancellation, persist actual usage and uncertainty, and preserve final diagnostic state. Continue cheap already-authorized deterministic checks only within their separate limits. Ask for additional budget once with a clear bound; do not repeatedly retry the same failure.

### Broken installation / upgrade
Restore only recorded owned configuration changes and the prior compatible binary/distribution. If external modifications occurred after backup, use a reviewed merge rather than overwrite. Restore the pre-upgrade database only when the migration/side-effect plan permits. Run doctor and a disposable smoke test before enabling new work.

### Disk full / corrupted local state
Stop admissions; never drop evidence to obtain a pass. Free only expired owned artifacts under retention rules or switch to approved storage. Validate DB integrity and restore from a tested backup when necessary. Reconcile provider sessions and externally recorded deployments before resuming.

### Post-deploy regression
Disable further promotions. Execute the preapproved compatible rollback or roll-forward strategy. For non-reversible migration, escalate with exact risk instead of reverting binaries blindly. Run post-recovery smoke checks, record affected artifact and timestamps, and create a regression task.

### Secret incident
Revoke/rotate through the responsible account owner. Remove live access from workers, isolate logs, and retain required audit data securely. Check whether exposures reached provider prompts, artifacts, telemetry, or backups. Do not claim deletion from external providers without confirming their supported process.

## 9. Release artifacts and support

The toolkit release must include installer/launcher, separate provider plugin distributions, controller/console binaries or reproducible build instructions, version lockfiles, checksums, dependency/license inventory, schemas, compatibility results, test/qualification summary, release notes, supported project profiles, known limitations, and upgrade/uninstall/rollback runbooks.

Every client-app handoff separately includes source/artifact identity, runnable preview or package, verified flows, integration environment labels, remaining limits, and release status. A one-sentence client result may link to detailed evidence; the client need not read engineering logs.

## 10. API and trust details

`ClientRequest`, `Feedback` and `Approval` in the domain schema are persisted records. Client HTTP input contains only editable message/attachment/feedback fields; the server issues IDs, timestamps, revisions and actor identity. An `ApprovalRequest` is pending intent; only authenticated decision service can create an approved `Approval` grant. Denial returns `ApprovalDecision` with no grant. Pending intent and grants are not interchangeable.

The launcher issues a random one-time bootstrap token via a local trusted channel, consumes it at session creation and sets an HttpOnly SameSite session plus CSRF token. Never embed a reusable admin secret into an app preview or URL query. Expire bootstrap tokens after60seconds and sessions after30minutes idle; require fresh confirmation for sensitive approval as the policy dictates. Validate Host and Origin, disable broad CORS, and rate limit mutations. Worker bearer tokens cannot approve, bootstrap, deploy, install, or read another project.

References: allow PNG/JPEG/WebP up to 10 MiB each, plus UTF-8 text/plain, text/markdown and application/json up to 1 MiB each; maximum 5 attachments and 20 MiB total per request; verify decoded type and limit pixel dimensions/decompression, strip metadata in a sandbox, and keep original provenance with restricted retention. Never execute uploaded content. Reject path names/URLs pretending to be local files. Render text and JSON inertly; Markdown does not execute embedded HTML or fetch remote assets. PDF/Office/voice extraction requires a separately tested sandboxed parser and remains an explicit capability gap until available.

Serve generated candidate apps on an isolated origin, not the controller origin. Do not attach controller authentication to preview requests. External preview links are allowed only for authorized staging destinations and receive an expiry. A sandboxed embed must not grant access to parent approvals. A byte-identical artifact on the wrong origin/environment still needs correct preview evidence.

A newly acknowledged run may be `RECEIVED` with `contract_id: null` and `requirements_revision: 0` while intake runs asynchronously. Before `SCOPED`, persist the first validated immutable contract revision and link it transactionally. Candidate sealing requires a non-null contract and revision at least1. Do not block the request HTTP handler on model inference merely to populate contract fields.

## Cross-stack AI engineering operations (edition 1.1)
Toolkit host runtime and target-project toolchains are separate inventories. `cm doctor` must inspect the task-specific environment as well as the provider host; a working Node runtime does not establish Swift/Android/.NET/model execution. Keep required toolchain/device/model resources and check IDs in the task EngineeringContext. The AI discovers/configures authorized prerequisites, chooses target-native tests, and reports a missing prerequisite only when it needs client authority or blocks verification.

Use authenticated, allowlisted execution environments for remote/native/GPU work; do not install every SDK or download large model weights globally at bootstrap. Check-specific resource/time budgets may differ from the toolkit defaults, require controlled configuration, and do not authorize extra spending automatically. For signed native packages or model artifacts, bind the tested artifact manifest and distribution target to the existing release approval path. Only advertise environments actually exercised.

## Edition 1.3 — document operations and service cases

Operator preflight separately probes extraction, visual rendering, spreadsheet recalculation, editable export and output reopening. Pin tool/font/licensing metadata. Start with document jobs feature-flagged off until G7. New authoritative SQL is `contracts/storage/documents.sql`; apply a tested additive migration after the existing controller schema, not an overwrite. Back up and test restore including attachment blobs, source dependency records, results and existing software runs. Old software-only clients may omit document fields; older clients must not be exposed to unreadable new operations without capability negotiation.

Track quarantine queue age, parser timeouts, blocked formats, missing inventory units, unresolved source conflicts, calculation-unknown results, stale outputs, failed renderer checks, citation/access rejects, orphan document jobs and total document/software budget reservations. Alert only on actionable operator failures under configured coverage. Quiet clients still see material partial-result limitations.

Runbooks: parser crash→kill isolated process tree and quarantine input; missing recalculation engine→block numeric-ready result and offer the smallest authorized setup; source access revoked→deny reads/downloads and invalidate caches; stale source→fence attempts and reanalyze affected scope; repeated document failure→stop within budget and retain diagnostics; suspected malicious file→retain minimal restricted incident record, never open in an operator's everyday Office/browser profile. On uninstall preserve/export/delete retained client files according to explicit policy, not a blanket recursive cleanup.

Service cases are on-demand unless an operator actually configures a persistent monitored service. A laptop that is asleep provides no monitoring guarantee. Case triage generates linked software or document work, with facts and permission checks; it does not run unrestricted remediation scripts. Rehearse restore and revision handling in T30/T32/T33.
