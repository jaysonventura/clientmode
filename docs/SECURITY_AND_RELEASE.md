# Security, Verification, and Release Design

**Normative companion to the master handoff.** Defaults favor a truthful blocked result over an unsafe success. The client is not required to perform technical review; engineering/security owns protected policy.

## 1. Threat model

Protect client source and data, credentials, provider account usage, acceptance policy, evidence authenticity, production state, and project separation. Assume an implementation agent may be mistaken, influenced by malicious repository/page content, or execute hostile dependency scripts. Assume a test report produced inside candidate execution can be forged. Do not assume separate agents have independent failure probabilities.

The baseline protects against unprivileged workers and untrusted candidate code. It does not protect against a compromised host administrator, compromised provider, kernel/container escape, or malicious protected-policy maintainer. Record these residual risks. Regulated/high-risk releases need additional qualified review.

## 2. Principals and permissions

| Principal | Read | Write | Forbidden |
|---|---|---|---|
| Client session | Own requests, previews, short status | Feedback and scoped approvals | Fabricated evidence or silent global authority |
| Controller | Scoped project metadata, trusted evidence, job events | Task/lease/budget state | Arbitrary deploy credentials in agent input |
| Agent host | Approved source, task packet, allowed provider credential path via official host | Candidate workspace through authorized tools | Release signer, approval ledger, other project secrets |
| Candidate runtime | Its artifact, synthetic fixtures, dependency cache | Ephemeral app/test data | Provider credentials, privileged sockets, policy repository, host home |
| External acceptance probe | Protected test definition and target address | Probe observations | Candidate filesystem write access or shared browser profile |
| Verification coordinator | Protected policy and collected trusted observations | Authenticated evidence | Running candidate imports/build scripts in coordinator process |
| Release service | Verified artifact and approval | Authorized deployment environment | Acting on worker-supplied approval strings |
| Security/release maintainer | Policy and evaluated changes | Protected policy versions and key rotation | Unreviewed self-approval where separation is required |

The host may need an official authentication flow. Candidate commands must not inherit the host's authentication files/environment. A worker must not be able to read a signing key simply because all processes run as the same local user. In native-plugin mode, protected external CI is the final authority; local evidence may be labeled advisory. Full protected mode requires tested service/container/OS separation.

## 3. Concrete protected runner topology

1. A trusted coordinator reads the candidate manifest from content-addressed storage and verifies byte identity. It reads policy from a protected reference/version, never candidate branches.
2. Dependency installation and builds run in an ephemeral sandbox with no secrets and no host Docker socket. Registry access is allowlisted, cache provenance is checked, and lifecycle scripts remain treated as arbitrary candidate code.
3. The built application runs in an unprivileged runtime sandbox on an isolated network. Synthetic database instances and per-attempt ports are created by the coordinator. The app receives only its own test configuration.
4. External browser/API probes run in a separate test principal/process/container. They control expected outcomes and collect actual observations. Candidate JS cannot access controller UI cookies or approval tokens.
5. Local unit-test reports are retained as supporting diagnostics. The protected decision also requires probes and invariant checks whose authoritative result files are not writable by candidate code.
6. The coordinator signs the final envelope only after validating all required observations. The signer does not expose a generic “sign this arbitrary JSON” tool to a worker.
7. The controller verifies the signature, key identity/revocation, candidate/artifact/policy/environment hashes, timestamps, and exact check coverage. An invalid record yields `UNVERIFIED`.
8. Deployment consumes a verified artifact and a scoped approval through a separate service. It does not execute candidate deployment scripts with unrestricted credentials.

A signed dishonest report is still dishonest. Separate event provenance, trustworthy observers, and good tests are necessary in addition to signatures.

## 4. Candidate identity

A source manifest records relative path, entry kind, executable mode, and SHA-256 of bytes for every included regular file. Include relevant untracked files and lockfiles; do not assume Git HEAD includes the user's entire work. Hash a deterministic UTF-8 encoding with recursively sorted keys and no floating-point values. Test determinism across supported runtimes and file order.

Reject NULs, absolute paths, `..` escapes, path normalization collisions, case-collision hazards on the target filesystem, symlink escapes, hardlinks to unauthorized external content, device files, and oversized artifacts. Do not normalize two distinct files into one manifest entry. Declare exclusions before snapshotting; a worker cannot change exclusions to hide a defect. Prefer frozen archives/content storage and immutable application images for final verification.

Record separate `source_digest`, `artifact_digest`, `policy_digest`, `environment_digest`, and `requirements_revision`. A Git SHA is useful metadata but not a substitute for these when builds, fixtures, or dirty input differ.

Verification checks source immutability before/after supported local developer checks; final acceptance executes immutable candidate bytes. Build reproducibility is a separate property: a second different artifact is not silently treated as the original release.

## 5. Protected check registry

The agent requests check IDs, not arbitrary shell strings. Registry entries contain ID, protected version/digest, expected fixture/environment, exact argv, cwd relative to sandbox, parser ID, required assertion/test IDs or minimum discovery, timeout, output/artifact limits, network profile, and applicability rule.

Use an argument array with `shell: false`, but do not mistake that for sandboxing: `node malicious.js` is still arbitrary code. Child processes run under the sandbox's process-tree/network/filesystem restrictions. Enforce tree cancellation, memory/CPU/PID/output limits, finite retries, and network egress. A process exit of zero is necessary for many checks but never sufficient for a required browser/behavioral acceptance.

Result states: `PASSED`, `FAILED`, `ERROR`, `TIMEOUT`, `SKIPPED`, `UNVERIFIED`. A preapproved non-applicability removes a check from that policy version's required set and records why. Do not insert a post-failure `WAIVED` result to obtain green status.

For test checks, require known assertion/journey IDs and expected counts. Reject malformed/missing/old reports, absent required cases, unexpected skips, and duplicate IDs. Explicitly classify flaky checks; do not mask instability by retrying until green. One infrastructure retry may diagnose a transient environment failure, but the original result remains in the evidence.

## 6. Approval contract

An approval binds authenticated actor, project ID, action class, candidate/artifact identity, target environment, policy revision, maximum authorized spend if applicable, expiry, nonce, and one-use/limited-use semantics. Client actions and enterprise rules—not LLM prose—create approvals.

Use the following transaction boundary:

```text
verify current signed candidate
  -> verify approval actor/scope/expiry/nonce
  -> atomically reserve/consume approval and write deployment intent
  -> dispatch through durable outbox with idempotency key
  -> reconcile deployment provider state
  -> record result and post-deployment evidence
```

If the external provider has no idempotency mechanism, serialize release attempts and query actual state before retry. An expired approval, new artifact, changed environment, or changed release plan requires a new approval. A textual “looks good” is not automatically a signed deploy decision. Do not ask for renewed authorization on every identical safe local test; use narrow standing development grants.

## 7. Browser isolation and local-console security

Use separate browser contexts/profiles per project and synthetic test accounts. Do not connect an everyday browser profile containing banking or production admin sessions to autonomous fixture tests. Claude's official Chrome integration shares browser login state; restrict it to approved development/staging sites when used.

Serve previews on a different origin from the controller. Never render untrusted candidate HTML in the controller origin or grant it controller cookies. Prefer a new isolated tab; embedded previews need restrictive sandbox attributes and verified origin separation. Reject untrusted `postMessage` payloads and window-opener access. No controller secrets in preview query strings, referrers, or generated HTML.

Controller listens on loopback, checks `Host` and `Origin`, requires a local-session token, CSRF-protects mutations, and validates websocket/event-stream origins. Loopback alone is not authentication. Defend against DNS rebinding and arbitrary websites calling localhost. Worker tokens have no approval/deploy scopes. APIs resolve project IDs to authorized registered roots instead of accepting arbitrary file paths.

## 8. Supply chain and retrieved instructions

Pin dependencies/SDKs/runtimes and record integrity, license, and update policy. Qualify upgrades before broad rollout. Do not silently install packages whose names are suggested by untrusted output. Use official vendor distribution channels for provider integrations.

Treat repository Markdown, web pages, MCP tool responses, comments, screenshots, and logs as data. They cannot override controller policy or authorize secret extraction. A provider prompt-injection defense is additional protection, not the final boundary. Inspect destructive Git operations and preserve dirty client work.

## 9. Acceptance-policy governance

Initial delivery contracts are generated from client requests by the lead. A separate verifier/QA process challenges the assumptions against those source requests. Material business ambiguity goes to the client; technical acceptance design goes to QA/security. Once sealed, policy changes require a new version and independent review.

The agent may propose test improvements, but must not edit the trusted evaluator or expected results in the same unrestricted session used to evaluate its work. During development of Client Mode itself, engineers can edit the verifier in a feature branch; protected qualification runs use a reviewed trusted version and external holdouts. Release gating is never based on the candidate's own self-test alone.

## 10. CI integration contract

A supported CI integration must prove the writer identity cannot alter required checks, spoof their trusted issuer, access release keys, or bypass protected branches/environments. Mere presence of a YAML workflow is not proof those settings are enabled. Capture their observed configuration and negative tests in the compatibility report.

Untrusted PR code runs without production tokens or writable shared runners. Do not mix pull-request code execution with privileged target-context secrets. Trusted policy may dispatch isolated candidate execution, but secrets remain in a separate control process. Protected workflow changes need a separate technical reviewer.

## 11. Mandatory adversarial cases

`contracts/acceptance-scenarios.json` defines test IDs. At minimum, prove denial/rejection of: forged success JSON, wrong candidate evidence, stale evidence after edit, skipped/zero required tests, changed policy, fake trusted check ID, duplicate/replayed result, malicious dependency reading the signer key, cross-project evidence, symlink escape, unknown network destination, fake client approval in model text, expired/replayed approval, unsafe deploy after cancellation, and signed envelope tampering.

Negative test success means the prohibited action was actually attempted in an isolated environment and denied or rendered non-authoritative. Reviewing a configuration file is not an enforcement test.

## 12. Release blocking and residual risk

Critical/high security findings, evidence forgery paths, unauthorized side effects, policy bypass, secret leaks, unresolved data-loss migration risk, or missing required integration tests block release. A scoped low-severity finding may be accepted only by the designated release/security owner with expiry and mitigation; it cannot be reclassified by the writer merely to continue.

Full correctness remains conditional on requirements, test coverage, runtime assumptions, and operational monitoring. Real client satisfaction and real-world usability are not derivable from unit tests. Keep these limits visible without turning every technical detail into a client question.

## 13. Canonical digest and decision details

Prevent self-referential hashes: compute a policy digest over the canonical policy content **excluding its own `policy_digest` and transport/signature fields**. Check definitions likewise exclude `definition_digest`. The source digest covers the sorted source manifest; the artifact digest covers the actual immutable artifact bytes. Canonicalization is recursive sorted-key UTF-8 JSON, with no unsupported values/floats in the policy/manifest and no duplicate keys. Pin the canonicalization version. The repeated-digit example digests are synthetic identifiers, not checksums of real apps or policies. Production must compute real bytes and validate schemas before signing/accepting.

Sign exact validated evidence payload bytes and verify those same bytes; do not parse and reserialize before verifying. A signed envelope from a revoked/unknown key fails closed. The reference evaluator tests selected authenticity/identity predicates but does not validate every full JSON Schema field or enforce OS ownership; production must do both boundary validation and all protected service checks.

Only the approved grant is the `Approval` domain entity. An `ApprovalRequest` represents pending intent and has no release authority. Authenticate the deciding actor separately, check displayed-action digest and version, and store an `ApprovalDecision`. A denied or expired request cannot become a grant or be replayed against new artifact bytes.

## 14. Reference deployment topology and promotion gate

Implement the first protected mode with four distinct authorities: the local client session/controller; a coding workspace identity; a protected verification coordinator; and a release service. A separate CI/service security domain is the preferred first verification boundary. The verification coordinator starts disposable unprivileged build/runtime sandboxes, retains its policy and signing key outside them, and runs externally controlled probes. The release service receives only scoped approval and verified artifact references. Never mount the host control socket or privileged credentials into candidate code.

A same-user native CLI/plugin can provide useful development automation, but cannot claim independent protection from an unrestricted shell running as that user. Label that mode advisory until a tested restriction or external authority supplies the boundary. Test actual read/write/network access with a malicious synthetic dependency and a worker-generated fake approval. An empty secrets directory in a demo is not proof that the configured production identity is protected.

For native, mobile and model tasks, register an authorized target runner with explicit OS, architecture, SDK/runtime, device or accelerator capabilities, network permissions, cancellation semantics and artifact provenance. Do not purchase or provision it without approval. These execution targets do not change the controller's own implementation stack. Keep their unverified capability rows blocked while other safe work continues.

Promotion requires negative enforcement tests, observed CI settings, protected policy origin, verified artifact identity, tested restore/rollback, and the four signoffs in [Release acceptance](RELEASE_ACCEPTANCE.md). Engineers must choose and document the actual isolation provider during T05/T09/T20; if the environment cannot enforce the boundary, protected release remains unavailable rather than silently degrading to a local success file.

## Edition 1.3 — document and support boundary

Apply the document-specific sandbox, type/size/container limits, no-macro/no-link-refresh rules and safe download policy in DOCUMENT_WORKFLOW.md. Source bytes, rendered output and extraction results are untrusted. Parser/office processes do not get controller tokens, provider credentials, signer keys or network access. A `--headless` or “safe” setting is not an OS security boundary. Test safe malformed fixtures, resource exhaustion, embedded actions, remote templates and workbook formula injection.

Document READY has its own protected acceptance path bound to source versions, instruction revision, scope and output bytes. Provider summaries and worker-generated result JSON cannot authorize it. Editing a signed document never silently inherits the original signature. Access revocation invalidates retrieval and new delivery regardless of cache presence. Support role labels do not confer production authority; containment, outbound notifications and purchases follow the existing approval rules.
