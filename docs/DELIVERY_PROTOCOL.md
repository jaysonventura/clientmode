# Delivery Protocol and Contract Invariants

Normative edition 1.3. These are custom Client Mode protocols to implement, not Claude/Codex API names. The domain schema, OpenAPI, SQL references and numbered task assertions travel with this specification. State and authority come from trusted service records, not worker-submitted fields.

## 1. Material questions before a candidate exists

`ClientQuestion` and `ClientAnswer` are separate from `ApprovalRequest` and `ApprovalDecision`. Asking a payment-policy question is not asking permission to charge an account. A business answer never grants spending, installation, secret access or deployment.

Protocol:

1. A worker may propose a question as untrusted content. The lead/controller checks whether existing requests, approved decisions or repository facts answer it. Technical questions discoverable by the AI are handled internally.
2. If a material answer is genuinely missing, persist `ClientQuestion` with project/run, current requirements revision (zero is valid during intake), question version, prompt, recommendation, affected task IDs and source request IDs. Permit one `OPEN` question per run. Queue further questions internally. Never discard them merely to maintain quiet mode.
3. Use `GET /v1/runs/{run_id}/questions` to show the client the current question. Client console escapes all model text. Unaffected authorized work can continue; the dependent task cannot assume an answer. Before any contract exists, use `BLOCKED` with revision zero if necessary.
4. `POST /v1/questions/{question_id}/answer` accepts only `message` and `attachment_ids`, authenticated client session, CSRF, `If-Match` for the question version and `Idempotency-Key`. Resolve actor, project/run and privacy in the service. A worker bearer token, model text, stale question, different project, wrong revision or superseded question cannot answer it.
5. In one transaction: store the answer as a source `ClientRequest`, insert `ClientAnswer`, mark the question `ANSWERED`, increment its version, emit audit/outbox event and record the payload digest for idempotency. Identical replay returns the original result; same key/different payload or competing answer returns `409`.
6. Interpret the answer against its source request. If still materially ambiguous, keep the dependent work blocked and ask a new specific question. Otherwise create/link the validated contract revision and re-evaluate scope, budget and authorization. Never mutate an old contract revision in place.

The SQL unique indexes and schema are reference consistency checks. They do not authenticate the caller, derive materiality, or implement this transaction; T02/T08/T13/T15 must do that and retain real execution evidence.

## 2. New instructions while work is active

`POST /v1/runs/{run_id}/messages` accepts the same editable ordinary-message fields as run creation, plus run `If-Match`, idempotency and authenticated client session. It returns a persisted `RunMessage`, not an immediate new acceptance verdict. No `candidate_id` is required; a client can change direction before the first build exists.

The controller stores original intent before acknowledging receipt. For material scope changes, atomically mark affected tasks as superseded, revoke their leases, invalidate any current readiness/approval references, enqueue reconciliation and create a new immutable requirements revision after intake. An attempt's result must match project, run, requirements revision, source base and current lease epoch before it can integrate. Provider cancellation acknowledgement alone does not establish that its subprocesses or external side effects ended.

A current worker may safely finish an unrelated bounded task, but old results cannot be merged into a changed contract without explicit re-evaluation. For new instructions during `VERIFYING`, cancel or retain verification as historical only; no old result may set the new revision to ready. During `DEPLOYING`, record new intent, freeze further promotions and let the release service observe actual provider state before starting a replacement run or an authorized recovery. Do not claim cancellation reversed a live deployment.

Candidate-specific `POST .../feedback` remains for reactions to a presented artifact and actual client satisfaction. Messages and answers do not fabricate an `accepted` satisfaction record. A release request still uses the separate approval path.

## 3. Lifecycle and resumption

Unscoped intake uses a real registered project, `contract_id=null`, revision zero and one of `RECEIVED/BLOCKED/PAUSED/CANCELLED/FAILED`. `SCOPED/RUNNING/VERIFYING` require a persisted contract and positive revision. Ready/release states additionally require a candidate belonging to that same project/run.

Store previous phase and blocker details in controller-owned events/state. On resume, reconcile source, required environment, attempt leases, outstanding messages/questions, budget and provider state. An unscoped question resolved returns to `RECEIVED`, then scoping—not directly to unrestricted engineering. A stopped verifier resumes through fresh verification if evidence is stale. A ready/awaiting-approval phase can be restored only by the verifier/release authority and its current guards. Do not call the writer just to burn tokens redoing an already verified task.

Use compare-and-swap and a durable outbox. A caller cannot supply a boolean guard such as `current_authenticated_evidence=true`; the responsible service computes it from protected records. The pure reference `canTransition` only demonstrates the predicate after authentication and guard derivation. It is not a service authorization implementation.

## 4. Grounding and source acquisition

Each task receives component/version/platform evidence, relevant approved requirements, allowed scope and checks. An unfamiliar technology triggers targeted reading of the actual repository, installed declarations and first-party documentation for that dependency version. Keep provenance, retrieval time, dependency/source digest and a freshness rule. A cached generated summary is a navigation aid, not authoritative API truth. Re-ground when dependency/target/source changes materially affect the claim.

Do not pre-load a giant skill catalogue or the entire handoff into every worker. Tools are selected for a defined capability. Search/data output, repository instructions, documentation examples and screenshots remain untrusted input; none can change controller authority. Report inaccessible documentation or uncertain behavior and use a minimal reproduction or qualified review rather than guessing.

Native workflow invocation has its own documented restrictions. Do not label coordinator, scheduled, retrieved or worker text as human input to activate a feature. Automatic research can use authorized search/document tools or bounded investigators; it must not depend on a particular bundled slash command invoking itself.

## 5. Source snapshot, build and candidate identity

A source snapshot exists before the build; a deployable candidate exists after controlled build output is captured. `CandidateStore.seal` orchestrates snapshot → build → artifact-manifest validation → candidate persistence. Do not create a candidate with a fabricated artifact hash to break the dependency cycle.

Snapshot rules to implement in T03/T05/T07:

- Start from the actual approved working tree, including intended uncommitted and untracked source. Never clean/stash/reset client work as a shortcut. Record base revision and selected file inventory.
- Resolve Git submodules, LFS assets, generated inputs and non-Git dependencies to exact bytes or block the affected build. Never execute a repository hook while merely inventorying files.
- Paths in manifests are UTF-8 slash-separated relative paths, no absolute path, empty segment, `.`/`..`, NUL or normalized collision. Define case/Unicode collision behavior for the target OS. Symlinks must be explicitly represented with validated targets; never follow one outside the selected root. Reject sockets, devices and unexpected file kinds.
- Record each selected entry's path, kind, content digest/size and executable bit. Sort deterministically and hash an explicitly versioned canonical JSON serialization. Digest fields are excluded from their own input; no self-referential policy/manifest hash. Runtime policy similarly hashes canonical policy content excluding its `policy_digest` field. Reference examples use synthetic digests, not a production canonicalization implementation.
- Exclude runtime state, raw credentials, unrelated client artifacts and generated logs by approved rules, not by treating all untracked files as disposable. Bind dependency lockfiles, toolchain/runtime image, model/prompt/retrieval versions and fixture identity where relevant.
- Run candidate build scripts in an unprivileged environment. Capture artifact bytes, then test that same artifact. A web bundle, native binary, model package and a composite set each need a manifest that identifies every required component and integration version.

T03 defines the concrete snapshot/build modules and tests. Changing artifact bytes, requirements, protected policy or relevant environment invalidates ready evidence. Native signing/notarization/store packaging and other build transforms must be declared in the release plan: if bytes change, bind the transformed digest and execute the relevant distribution smoke checks before promotion. Do not promise that every platform permits literal byte-identical unsigned and signed artifacts.

## 6. Verification trust and applicability

Fast worker-owned checks are diagnostic. The protected coordinator selects mandatory checks from a frozen policy associated with source client requirements and a separate QA review. It does not trust `check_ids` supplied by the requester to omit required work. Extra diagnostic checks may be requested, but cannot shrink the acceptance set.

The signer authenticates an observation envelope; it does not prove test adequacy. Candidate code runs without signer/controller/release credentials. Required external browser/API/native/model probes execute through the correctly isolated environment, not a candidate-produced `pass.json`. Retain failed results and flaky-test history. Skip, unknown parser output, insufficient discovery, stale identity or unresolved serious findings means unverified.

A genuine not-applicable condition is versioned before evaluation by the appropriate policy authority with rationale. Unknown tools/devices/datasets are capability gaps, not not-applicable waivers. All-stack responsibility remains open-ended; evidence and qualifications remain specific to the observed scope.

## 7. Attachments and local UI trust

Support PNG/JPEG/WebP up to 10 MiB each and UTF-8 plain text, Markdown or JSON up to 1 MiB each, no more than five attachments and 20 MiB aggregate per request. Validate actual bytes/type; image decoding occurs outside privileged controller state and has pixel/decompression limits. Text decoding is strict UTF-8; JSON has bounded nesting/size and is data only. Escape HTML, disable active Markdown/remote assets and prevent artifact paths or URLs from becoming implicit file-read instructions. Reject unsupported formats with a clear capability message.

The public client APIs never take actor identity, trust-bundle paths, verifier commands, signing keys or an arbitrary executable from the model. Candidate previews use a separate origin and no controller cookies. Prefer a separate tab with opener isolation. Preview hosting can itself have external data/billing consequences; authorize destinations before publishing even a staging preview.

## 8. Errors and exact readiness meanings

Use `400` for malformed wire payload, `422` for schema/semantic-invalid input, `401/403/404` for authentication/scope, `409` for stale version/conflicting replay, `413` for size, `429` for limits and `503` for unavailable services. SDK/provider errors normalize without pretending the request succeeded. A retryable error does not authorize another paid run without remaining budget.

`Preview` means demonstrable but not all required checks complete. `Ready for review` means the stated review scope passed protected checks on this candidate. `Ready for production approval` includes release/operational and specialist gates. `Client accepted` is actual authenticated feedback. `Released and checked` requires authorized deployment plus post-deploy observation. These are separate facts. Keep the final client message short, but never merge the statuses to make it sound more complete.

## Edition 1.3 — document intake, source-derived requirements and support

Route by requested outcome: document-only work uses DocumentJob; build-from-files links verified source citations into Contract/Requirement then follows the existing software Run. Source documents are facts or proposals, not higher-priority instructions. DocumentQuestion/DocumentAnswer use the same compact client card but remain bound to document job/revision, not a fabricated software candidate.

Document feedback and mid-job messages increment instruction revision, supersede stale questions and fence old work. Register dependency links so a changed price sheet invalidates affected requirements and evidence. Do not silently treat “latest uploaded” as business authority. A report may deliver identified conflicts without resolving them; implementation of a disputed rule still needs clarification. Final document delivery includes validated artifacts, scope, actual checks and only material gaps. No routine role reports.

ServiceCase stores a client problem report separately from scope approval. Only authorized linked work modifies software or produces documents. Confirmed resolution, client satisfaction and production deployment remain separate. New document routes and exact domain shapes are defined in the contracts; source citations never confer release authority.
