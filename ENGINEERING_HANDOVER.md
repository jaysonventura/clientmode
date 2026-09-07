# Client Mode — Full Engineering Handoff

**Edition:** 1.3 · **Date:** 7 September 2026  
**Audience:** Engineering lead, developers, QA, UX, security/release engineers, and coding agents.  
**Owner experience:** “I am the client. I explain my idea. AI handles the company underneath.”  
**Delivery status:** This is a complete build contract for the scoped v1 product, not a claim that the product exists or has passed qualification.

## 1. Executive decision

Build **Client Mode**, a local-first delivery layer around official Claude Code and Codex capabilities. It accepts ordinary client requests, manages the internal engineering lifecycle, and produces an identifiable candidate with independently checked evidence. It must handle UI/UX and real interaction testing, not merely generate backend code or attractive screenshots.

Use one common core, separate provider adapters, a quiet client console, a small original skill catalog, a durable task ledger, and a protected verification/release path. Native agents do the reasoning and coding; our controller manages authority, lifecycle, budgets, and truthfulness. Native goal mechanisms may sustain work but never decide production acceptance by themselves.

The product does not change model weights or guarantee perfect reasoning. “Smarter” means a measured improvement in accepted outcomes, fewer unsupported claims, lower client effort, and better total cost per accepted change. Do not advertise a reliability or savings claim before the qualification comparison supports it.

### Decisions already made

| Decision | Binding direction |
|---|---|
| Client involvement | Ordinary-language ideas, feedback, and material authorization only. |
| Reporting | Quiet by default; show necessary questions, real blockers, and final result. |
| Engineering ownership | AI maintains requirements, plans, tasks, documentation, tests, and fixes. |
| UI/UX | Required responsibility, including actual rendered inspection and interactions. |
| Dependencies | Official provider interfaces plus original code; no required community agent framework, skill pack, or unofficial MCP. Normal application/test libraries remain allowed. |
| Multi-agent | One lead; single writer by default; initial maximum two child jobs and depth one. |
| Safety | Autonomy inside enforced limits; no permission bypass to simulate reliability. |
| Readiness | Evidence for an exact scope/candidate, separate from client satisfaction and deployment. |
| Reuse | One installation with automatic per-project onboarding and isolated project state. |
| Adoption | Prove locally and in disposable fixtures, then controlled project rollout. |
| AI engineering scope | All technology families; learn and verify task-specific details; toolkit implementation language does not limit agent remit. |

## 2. Scope of the complete v1 product

**Owner correction — binding:** “All stacks” describes the **AI engineers' responsibilities**, not a requirement to implement the Client Mode controller in every language. The toolkit can use one implementation stack while its agents work in the client's appropriate stack. Read [AI engineer stack scope](docs/AI_ENGINEER_STACK_SCOPE.md) with this specification.

A full v1 delivery includes **all eight milestones**, not only a prototype or a plugin manifest. Both provider adapters must be installed and tested independently before advertising dual-provider support.

**AI engineering remit:** Technology-agnostic and open-ended: web, backend/API, native and cross-platform mobile, desktop/native systems, databases/data pipelines, infrastructure, AI/LLM/RAG and model work, including combinations. No language whitelist or JavaScript-only intake/routing restriction is allowed. Existing projects retain their languages and conventions unless a justified migration is separately authorized. The AI researches the applicable versions, selects the right tools, implements, reviews and verifies in the actual target technology.

**Reference fixture:** The React/Node/SQLite shop remains one convenient smoke-test application, not the AI team's supported-stack boundary. Full qualification additionally exercises representative non-JavaScript, native, systems, LLM and polyglot tasks under `docs/QUALIFICATION.md`. Qualification measures selected task/environment combinations; it cannot prove perfect knowledge of every language, framework or future release.

**Toolkit host environment:** macOS and Linux for the local controller/console remain the proposed initial deployment targets. This is separate from **client target environments**, which may include iOS, Android, Windows, Linux, macOS, servers and model/hardware runtimes. Place build/test work in an authorized suitable environment when the controller host cannot perform it. Test and report real OS/architecture/toolchain combinations; never imply that hosting the controller on Linux verifies an iOS device build.

The agents must handle unfamiliar stacks by investigating the repository and official versioned documentation, assembling concise specialist context, and configuring project-native checks within authorization. A missing prebuilt skill is not a reason to reject a language or demand a rewrite. The AI owns this adaptation, not the client. Real environment or knowledge gaps remain explicit: continue safe independent work, obtain essential access when required, and leave affected outcomes unverified until tested. Project profiles are reusable environment/check recipes, not a fixed list of what the AI is permitted to understand.

**Explicitly outside v1:** a public multi-tenant SaaS, unattended purchases, autonomous destructive production migrations, training a replacement foundation model for Client Mode itself, reverse engineering private model internals, arbitrary third-party tool installation, recursive cross-provider supervision, permanent large agent teams, and blanket zero-defect or zero-latency promises. Client-requested model integration, evaluation, local inference, fine-tuning or training pipelines are inside the AI engineering remit when data rights, compute and scope are authorized; that does not grant permission to perform expensive training or make unverified quality claims.

A hosted controller and reusable stack-specific recipes are extension points. Cross-stack AI reasoning, discovery, preservation and native verification behavior are requirements now, not deferred behind a TypeScript-only release. Do not build a separate agent engine for every language or secretly add new billing.

## 3. Personas and client journeys

### Client
A client may have strong technical experience but prefer not to manage the workflow. Limited English must never be treated as limited intelligence. Accept fragments, Taglish, screenshots, brand examples, and change requests. Do not require a formal specification, Figma file, or technical prompt.

### Engineering/release owner
Installs and qualifies the toolkit, controls protected policies and credentials, resolves technical security issues, and approves changes to release gates. This role may be fulfilled by the engineering organization; it is not delegated to the client by default.

### AI delivery lead
The only routine client-facing agent. Owns interpretation, internal coordination, safe defaults, evidence requests, and compact handoff. Its messages are not an acceptance authority.

### Journey A — new project
Client selects a folder and says: “Simple ordering website. Customer no need account. Nice sa phone. No online payment.” The lead preserves the meaning, identifies any material business ambiguity, selects a suitable implementation, writes internal acceptance criteria, designs and builds, starts the app, exercises UI/API journeys, repairs defects, requests protected verification, and returns a working preview with the right readiness label.

### Journey B — existing repository
Client says: “Make mobile cleaner but do not change checkout rules.” Onboarding records the current toolchain, branch, dirty/untracked files, business invariants, real test commands, and available services. The change stays within scope. Test results from before the change cannot approve the new candidate.

### Journey C — feedback
Client says: “Still crowded. Make main action easier.” The lead turns this into a new requirement revision, reuses approved behavior, updates design and code, and re-verifies affected journeys plus mandatory final gates. Previously accepted evidence is retained as history, not reused for altered code.

### Journey D — interruption
A process crash, sleeping laptop, provider limit, or denied permission produces durable state. On the next authorized run, the controller reconciles the actual workspace and provider session, expires stale leases, invalidates affected evidence, and resumes without asking the client to reconstruct the task.

### Journey E — release
“Looks good” records client feedback, not blanket production authority. A separately authenticated action approves the exact artifact, policy, environment, and intended operation. Deployment is idempotent, observed, and followed by smoke checks. Missing approval or verification yields a blocked release, not a silent fallback.

## 4. Functional requirements

These IDs are normative and mapped to tasks and tests in `contracts/traceability.json`.

| ID | Requirement |
|---|---|
| FR-01 | Accept ordinary English, Tagalog, Taglish, text attachments, and screenshots; retain request provenance. |
| FR-02 | Ask only material business/access/privacy/cost/safety questions, one concise question with a recommendation where possible. |
| FR-03 | Generate and version measurable acceptance contracts, scope exclusions, assumptions, and business invariants. |
| FR-04 | Discover repositories, runtimes, dependency versions, real commands, dirty/untracked files, and project prerequisites. |
| FR-05 | Verify installed provider capabilities and effective permissions; unsupported features fail visibly rather than being invented. |
| FR-06 | Keep one client-facing lead and choose single-agent or bounded delegation based on dependency structure and risk. |
| FR-07 | Enforce exclusive write ownership, isolated workspaces, verified base snapshots, and a single integration owner. |
| FR-08 | Execute design → implement → run → verify → review → repair → final verification without routine “continue” prompts. |
| FR-09 | Produce coherent UI design tokens, responsive layouts, interaction states, accessible controls, and honest product copy. |
| FR-10 | Run real browser journeys, screenshots, console/network checks, keyboard checks, and reference-design review where relevant. |
| FR-11 | Exercise API validation, persistence, authorization, failure paths, duplicates, and concurrency where relevant. |
| FR-12 | Maintain durable tasks, leases, attempt IDs, provider sessions, cancellation, recovery, and idempotent integration. |
| FR-13 | Create deterministic candidate/source/artifact/environment identity and invalidate mismatched or stale evidence. |
| FR-14 | Execute protected check definitions and produce authenticated acceptance evidence outside writer authority. |
| FR-15 | Require independent, bounded review for significant changes; give reviewers contracts and code, not only success summaries. |
| FR-16 | Separate work completion, verified scope, client feedback, production approval, deployment, and post-deployment health. |
| FR-17 | Support scoped, expiring, authenticated approvals without asking the model to authenticate its own requests. |
| FR-18 | Account for all provider calls and retries, reserve verification budget, and stop non-progressing or over-budget work. |
| FR-19 | Keep routine reports hidden in the console while preserving internal audit trails and honest final status. |
| FR-20 | Build and fresh-session test separate Claude and Codex plugin distributions from shared original procedures. |
| FR-21 | Provide a local controller and quiet console through supported programmatic interfaces with explicit billing mode. |
| FR-22 | Install, upgrade, uninstall, and roll back safely; merge configuration with backups and preserve unrelated settings. |
| FR-23 | Publish a truthful capability/compatibility report and support matrix tied to exact versions and tested environments. |
| FR-24 | Qualify on disposable projects and held-out tasks against native baselines before quality/cost marketing claims. |
| FR-25 | Support preview delivery, controlled CI integration, approval-bound deployment, smoke checks, and recovery. |
| FR-26 | Keep secrets, private project context, browser state, and evidence isolated with retention/deletion controls. |
| FR-27 | Offer optional narrow MCP access only when a shared structured capability is justified and tested. |
| FR-28 | Store concise internal project memory with provenance and freshness; never copy private facts between projects. |
| FR-29 | Process client feedback into a new requirement/candidate revision without weakening existing approved behavior. |
| FR-30 | Ship operator runbooks, service health, metrics, versioned contracts, and release/recovery documentation. |
| FR-31 | Preserve native engineering instructions and honor instruction priority; retrieved content is untrusted data. |
| FR-32 | Prevent implementation workers from changing evaluator code, protected policy, approval records, or release credentials. |
| FR-33 | Label external integrations as mocked, sandbox-tested, or production-tested; never conflate them. |
| FR-34 | Preserve audit evidence of attempted policy weakening, forged reports, unauthorized actions, and canceled work. |
| FR-35 | Provide an accessible, compact client experience with visible cancel/pause and a clear action when blocked. |
| FR-36 | Package a reproducible release with checksums, dependency inventory, support scope, qualification results, and tested rollback. |
| FR-37 | The AI engineering team is technology-agnostic: accept web, backend, mobile, native/desktop, data, infrastructure, and AI/LLM work without a TypeScript/JavaScript-only gate or a closed language whitelist. |
| FR-38 | Discover and preserve every affected component in polyglot projects; use installed versions, project conventions, actual manifests, and version-appropriate first-party evidence instead of silently rewriting into the toolkit stack. |
| FR-39 | Agents autonomously acquire task-relevant stack knowledge, inspect unfamiliar frameworks, select native tools and specialist procedures, and maintain source-grounded context without requiring the client to supply technical prompts. |
| FR-40 | Design, implement, debug and verify using the target platform: browser, native application/device, service, data pipeline or model-evaluation environment as appropriate; a web demo cannot substitute for a requested native or model deliverable. |
| FR-41 | Bind composite candidate evidence to all required application/service/model/data components and interfaces; an unavailable toolchain, device, GPU, credential or failed component prevents readiness for the affected scope, not safe work elsewhere. |
| FR-42 | Qualify AI engineering behavior across representative non-JavaScript and polyglot tasks, including unfamiliar-stack grounding, native UI, backend, systems and LLM evaluation; publish observed evidence per task family without claiming universal mastery. |
| FR-43 | Cover CTO/architecture, PM/PO support, delivery/Scrum coordination, UI/UX, stack-appropriate engineering, QA, security and reliability responsibilities with accountable task assignments and review outputs; titles confer no authority and do not require permanent agents. |
| FR-44 | Persist material client questions and authenticated answers before or after a candidate exists; ask at most one visible question per run, reject stale/cross-project/model-authored answers, and never treat an answer as a financial or release approval. |
| FR-45 | Accept client instructions during active work; version material requirement changes, fence affected attempts, invalidate stale evidence/approvals, and reconcile in-flight releases before applying subsequent work. |
| FR-46 | Ingest PDF, DOCX, XLSX, CSV/TSV, PPTX, images and inert text through typed, bounded, quarantined processing; preserve originals and reject unsafe/unsupported content honestly. |
| FR-47 | Execute document-only read/analyze/review/edit/create jobs without a software run, Git repository or deployment approval; preserve questions, feedback, cancellation and recovery. |
| FR-48 | Create source-version-bound extraction inventories, coverage and exact page/section/sheet-cell/slide/image citations, including relevant visual inspection and targeted OCR for unreadable text. |
| FR-49 | Verify numerical work with actual computation and formula/dependency checks; distinguish cached values, recalculated outputs, partial sheets, unsupported functions and unresolved external links. |
| FR-50 | Compare sources and separate facts, inferences, suggestions, unreadable content and conflicts; resolve material business contradictions through authenticated client answers. |
| FR-51 | Produce versioned editable or viewing artifacts as requested, preserve source meaning and declared complex features, and verify exported content and rendered layout before ready claims. |
| FR-52 | Maintain technical documentation, user/admin guides, API examples and runbooks against actual code/release behavior with executable examples where appropriate. |
| FR-53 | Track document-to-requirement/context/result dependencies; source revision, deletion or access changes invalidate affected retrieval, conclusions and current readiness without erasing authorized history. |
| FR-54 | Route document/business analysis, research, editing, spreadsheet analysis and technical-writing responsibilities automatically under bounded execution roles; no title grants privileges. |
| FR-55 | Probe format operations and compatible tools separately; use supported official provider interfaces and approved ordinary format libraries, without automatic external upload or billing substitution. |
| FR-56 | Ground product discovery and outcome measures in client needs and actual evidence; label hypotheses and never invent research participants, metrics or stakeholder approval. |
| FR-57 | Assign accountable owners, risk tiers and review outputs across the product lifecycle, with security/accessibility/reliability review proportional to risk rather than simulated management ceremonies. |
| FR-58 | Handle on-demand support and incident cases through reproduction, linked repair/documentation, regression, resolution evidence and preventive knowledge updates. |
| FR-59 | Keep legal, finance, licensing, privacy, public communication and procurement advice separate from human authority; no automatic corporate commitments or unconfigured service promises. |
| FR-60 | Qualify actual document workflows and mature-company responsibilities alongside multi-stack delivery, including safe ingestion, real exports, client feedback and post-release support evidence. |

## 5. Non-functional requirements and initial targets

The values below are **proposed engineering acceptance targets**, not vendor performance guarantees. Measure on a declared reference machine; report p50/p95 and sample count.

| ID | Target |
|---|---|
| NFR-01 | A ready verdict requires every mandatory gate on the exact current candidate; no skipped/missing/forged evidence is accepted. |
| NFR-02 | Zero unauthorized production operations or escaped critical security defects in qualification. |
| NFR-03 | Durably acknowledge client mutations only after transaction commit; duplicate delivery must not duplicate side effects. |
| NFR-04 | Controller local API p95 <250 ms for metadata operations under 10 concurrent clients, excluding model/test work. |
| NFR-05 | Client input and cancel controls remain responsive; no model/test work blocks the UI thread. |
| NFR-06 | A cancel request is recorded within 1 second; controlled subprocess trees terminate within 10 seconds or are quarantined. External in-flight effects are reconciled, not claimed reversed. |
| NFR-07 | Recover acknowledged task state after a crash; reconcile 1,000 stored tasks within 30 seconds on the reference machine. |
| NFR-08 | No routine unsolicited narrative progress messages in quiet mode; material questions/blockers and final delivery remain visible. |
| NFR-09 | Default maximum two child jobs, depth one, one active writing task per project; effective limits must be tested. |
| NFR-10 | No production credentials in worker environment; no raw secret values in stored logs or client responses. |
| NFR-11 | Console and reference journeys target WCAG 2.2 AA; automated checks alone do not prove full conformance. |
| NFR-12 | Release binaries/distributions and contract versions are identifiable; upgrades are staged and reversible within stated migration constraints. |
| NFR-13 | Provider/account/rate limits produce controlled pause with preserved state, not silent provider or billing substitution. |
| NFR-14 | Cost comparison measures the whole task set, including failures, cached usage when exposed, repairs, and reviewer calls. |
| NFR-15 | Every required requirement ID maps to an implementation task and a concrete acceptance scenario. |
| NFR-16 | Required handoff/schema validation fails with a nonzero exit when prerequisites or checks are missing; structural checks, mock tests, live tests and production qualification must have separate truthful status. |
| NFR-17 | No partial extraction, unreadable required unit, unknown required calculation or stale source can be presented as complete verified document work. |
| NFR-18 | Enforce document parser/render/calculation resource and network limits outside agent control; overruns and missing tools produce bounded partial/blocked outcomes, not silent success. |
| NFR-19 | Declare format-operation fidelity and accessibility targets and retain original bytes; visual/semantic/numeric validation scope is explicit and not inferred from successful serialization. |
| NFR-20 | Keep management/document/support orchestration quiet and budgeted; never imply continuous support, guaranteed response times or authorized external effects from an agent role or prompt. |

## 6. Architecture and trust boundaries

```text
Client (ordinary chat / screenshot / feedback)
                 |
       Local quiet console / native host entry
                 |
  Controller: request -> contract -> policy -> task lifecycle
       |               |                 |
       |         durable task store      | approvals service
       |                                 | (client/authorized role only)
       v                                 v
 Provider adapter -> native lead / bounded child jobs
       |                    |
       |          isolated candidate workspace
       |                    |
       +--- claims / patches / useful diagnostic results
                            |
                  immutable candidate artifact
                            |
         PROTECTED verification coordinator (different authority)
              |                         |
      unprivileged build sandbox    external browser/API probes
              |                         |
              +------ authenticated evidence ------+
                                                   |
                                  readiness decision + preview
                                                   |
                           explicit artifact/environment approval
                                                   |
                              protected deployer -> smoke checks
```

### Component responsibilities

| Component | Owns | Must not own |
|---|---|---|
| Client console | Input, feedback, approvals, short status, preview links | Worker credentials or authority inferred from model text |
| Controller | Task graph, leases, budgets, routing, project IDs, event state | Self-asserted evidence authenticity |
| Provider adapters | Official host interaction, normalized events, model/session IDs | Native settings guessed from another provider |
| Workspace service | Candidate bases, write claims, artifact sealing, cleanup | Unrestricted access to client home directories |
| Verification coordinator | Protected policy lookup, sandbox scheduling, external observations | Executing candidate code in its privileged process |
| Build/test sandbox | Candidate dependencies, app runtime, local developer checks | Signing keys, release credentials, host socket, hidden expected outcomes |
| Acceptance probes | Controller-owned browser/API journeys against candidate service | Trusting candidate-written “pass.json” as proof |
| Evidence store | Signed manifests, retained logs, candidate/policy/artifact identity | Writer-writable authoritative verdicts |
| Release service | Approval consumption, exact artifact promotion, health checks | Rebuilding a different artifact after approval without new evidence |

**Critical boundary:** Different folders or different model roles are not a security boundary. Same-user unrestricted shell access can modify both. The protected verifier and release signer must be controlled by separate CI/service credentials or a tested distinct OS principal/sandbox. Candidate build scripts and tests are untrusted code; merely placing the verifier outside the Git repo is insufficient.

## 7. Implementation stack and repository layout

**This section specifies the toolkit implementation only, not the AI engineers' supported languages.** Use a TypeScript-strict monorepo with npm workspaces for the product, a maintained Node LTS compatible with both selected official interfaces, SQLite for single-user durable state, and a React web console served by the local controller. Pin exact runtimes, packages, SDKs, CLI compatibility ranges, and test browser builds at implementation time; do not hard-code unverified model aliases from this conversation.

Use JSON Schema for boundary validation and generate shared types. Use a maintained HTTP framework and schema validator rather than writing a web framework or cryptographic primitive. Reference `.mjs` code included here is an executable specification, not the product stack.

**Target product repository (to implement):**

```text
client-mode/
  apps/
    controller/src/{server,routes,auth,events}.ts
    console/src/{app,components,features,styles}/
    cli/src/{main,doctor,install,run,verify}.ts
  packages/
    contracts/src/
    core/src/{lifecycle,router,budget,approvals,context,stack-grounding,notification}.ts
    state/src/{database,events,leases,outbox,recovery}.ts
    workspace/src/{onboard,stack-inventory,ownership,snapshot,integrate,cleanup}.ts
    providers/src/{interface,claude,codex,capabilities,normalize}.ts
    verifier/src/{policy,coordinator,executor,parsers,evidence,verdict}.ts
    browser/src/{journeys,visual,accessibility,artifacts}.ts
    verification-targets/src/{resolve,native-ui,model-evals,composite}.ts
    release/src/{attestation,approvals,deploy,smoke,rollback}.ts
    packaging/src/{build,install,upgrade,uninstall}.ts
    observability/src/{logging,metrics,redaction}.ts
    documents/src/{ingest,extract,inventory,analyze,spreadsheet,author,render,qa,jobs,recovery}.ts
    support/src/{cases,triage,resolution,knowledge}.ts
  skills/{intake,grounding,delivery,ui-ux,debug,verify,review,handoff}/SKILL.md
  adapters/{claude,codex}/
  profiles/                             # open-ended project check/environment recipes
    web-typescript/                      # one fixture recipe, not an intake whitelist
  fixtures/{shop,mutations,provider-events}/
  tests/{unit,integration,e2e,security,chaos,compatibility}/
  evals/{pilot,results}/
  docs/{operations,security,compatibility,releases}/
  scripts/
  package.json
  package-lock.json
```

Keep hidden qualification tests and protected release policy in a separate evaluation/security-controlled repository or service, not in the writable product checkout used for evaluated trials. Public mutation fixtures are developer self-tests, never described as hidden holdouts.

## 8. Native capabilities versus custom product work

See `docs/OFFICIAL_CAPABILITIES.md` for rechecked official sources and specific caveats. The implementation must run capability probes against the **installed** host and not rely on a retrieved documentation page alone.

Native: provider coding tools, supported subagent/skill/plugin mechanisms, sessions and documented programmatic entry points, sandbox/approval surfaces, and supported goal/continuation features.

Custom: Client Mode's delivery contract, minimal-interruption policy, project onboarding, task/lease ledger, evidence binding, protected evaluator/deployer, approval identity, total-tree budget ledger, quiet console, fixture qualification, and cross-provider normalization.

Optional/version-dependent: Claude browser integration and dynamic workflows, native agent-team experiments, specific hook behavior, precise billing counters, and host-specific plugin configuration. Unsupported optional capabilities must not prevent the deterministic safety core from functioning.

Choose the documented Codex SDK for coding-thread automation and assess the documented App Server for a full interactive approval/authentication client. Do not treat all App Server use as unsupported because a particular transport or beta endpoint is experimental. For Claude's separately built SDK product, verify the documented API authentication requirements; do not offer consumer login/rate-limit reuse without required approval.

## 9. Client intake and internal memory

The precise question/answer, active-message, readiness and artifact protocols are in `docs/DELIVERY_PROTOCOL.md`; implement them in T01/T02/T08/T12/T13/T15/T16. `docs/AI_COMPANY_OPERATING_MODEL.md` defines responsibility coverage without a permanent company-sized agent swarm. These are normative specifications, not extra client homework.


Persist the original request with a message ID, timestamp, language hint, attachment IDs, and privacy class. The interpreted contract references source message IDs and explicitly distinguishes approved requirements, reversible implementation assumptions, and unresolved business decisions.

A request is not rejected for poor grammar. Ask only when an unresolved decision changes payment behavior, data sharing, irreversible operations, ownership/authorization, material spending, or the promised user outcome. The lead chooses implementation details within the authorized scope. Reuse existing brand assets and design references when provided; do not require them.

Canonical state is transactional data, not a directory full of independent Markdown truth sources. Generate human-readable summaries only when useful:

```text
PROJECT_ROOT/.client-mode/project.json     # nonsecret project identity / pointers
PROJECT_ROOT/.client-mode/DECISIONS.md     # concise generated view, not policy authority
CLIENT_MODE_STATE_DIR/state.sqlite        # controller-owned local operational state
VERIFIER_STORE/{project}/{candidate}/      # authority-separated signed evidence
```

Store facts with source path/symbol or official URL, dependency version/revision, observed time, and freshness rule. Summaries are hints; re-read authoritative sources before consequential changes. Do not inject the full handoff or previous sessions into every worker context.

## 10. Lifecycle, state machine, and cancellation

Canonical run states:
`RECEIVED`, `SCOPED`, `RUNNING`, `VERIFYING`, `NEEDS_REPAIR`, `READY_FOR_REVIEW`, `AWAITING_RELEASE_APPROVAL`, `DEPLOYING`, `RELEASED`, `BLOCKED`, `PAUSED`, `CANCELLED`, `FAILED`, `ROLLED_BACK`.

Transitions use compare-and-swap on `(run_id, state_version)` with authenticated actors and durable events. The full transition rules are specified in `contracts/state-machine.json`. A worker can submit a claim or artifact, but cannot invoke an authoritative ready/deploy transition.

A requirement revision or integrated code change creates a new candidate. Existing evidence remains historical. `READY_FOR_REVIEW` requires a current verified candidate; `AWAITING_RELEASE_APPROVAL` additionally requires release checks and any required specialist review. `RELEASED` requires successful authorized deployment plus post-deploy evidence. Client satisfaction is a separate feedback record; the AI cannot write it on the client's behalf.

Pause and cancel are different. Pause stops new work and attempts controlled interruption. Cancel revokes attempt leases and prevents integration/release from those attempts. On restart, reconcile in-flight provider runs and side effects before deciding whether resumption is safe. No exactly-once promise across an unreliable external provider: use idempotency keys and reconciliation, and quarantine uncertain effects.

## 11. Orchestration and agents

The controller schedules task dependencies and enforces project-level ownership. Task routing includes engineering domain, actual languages/frameworks, platform, component boundaries, risk and available execution environment; it is never inferred from the TypeScript implementation language of the controller. Native host mechanisms execute bounded work. Use one authority for global child admission: either the controller directly starts child sessions or a tested native delegation path reports/limits them. Never allow both to create unaccounted recursive jobs.

Initial policy: one active writer per project, at most two children per lead, depth one; readers may run concurrently on immutable snapshots. Parallel writers require explicit non-overlapping ownership and a single integrator. Lockfiles, migrations, shared configuration, and common interfaces always have one owner. Worktrees isolate edits, not secrets or network access.

Workers receive a task contract containing IDs, exact base, relevant request and invariants, allowed scope, dependencies, evidence references, tool profile, deadline, budget reservation, and stop conditions. They return candidate/patch references, diagnostic findings, and unverified gaps. Their result is parsed but not automatically trusted.

The shared skill catalog covers intake, grounding, delivery, UI/UX, debugging, verification, review and handoff, with narrowly triggered document analysis, technical writing, research and support procedures. Each must adapt to the task stack. Load bounded, provenance-backed specialist knowledge on demand; do not load a giant all-language handbook or permanently spawn a specialist for every stack. A skill is a procedure, not necessarily another process. A reviewer reads requirements, diff, relevant execution paths, and evidence. It returns reproducible findings with severity and scope, not an unqualified certification.

On repeated failure: capture a reproduction, compare hypotheses, change the diagnosis, and retry within limits. Default maximum three repair cycles per task; the second repeat of the same diagnostic without material progress triggers `BLOCKED`. Do not loosen gates or add more agents to conceal failure.

## 12. UI/UX responsibilities and acceptance

The lead determines user journeys and visual hierarchy before full implementation, but does not force a client approval ceremony for every wireframe. Maintain consistent design tokens, semantic component states, clear copy, responsive layouts, focus behavior, and touch-friendly controls. No placeholder buttons, fake metrics, hidden demo-only paths, or invented integration status in a client-ready deliverable.

For the **Client Mode console itself**, provide: project selection, ordinary-language composer, attachment input, compact current status, pause/cancel, one-question approval cards, preview/result card, feedback, and an optional expandable engineering drawer. Default view must not be an agent dashboard. No agent roster or token allocation form is required for normal use. Long content may scroll naturally; do not force inaccessible “no scroll” layouts.

For **delivered web apps**, run declared primary journeys at 360, 390, 768, and 1440 CSS-pixel widths in the web fixture. Use content-driven layout and test large text/zoom. Viewport simulation is not proof of actual iPhone/Android hardware behavior. Add physical-device/simulator tests for claims that require them.

Checks include real state changes and persistence, keyboard reachability/focus, labels, error/loading/empty states, meaningful ordering, no unintended overflow, expected navigation, console exceptions, failed network requests, and accessible dialogs. Comparison against approved visual references uses pinned browser/fonts/test data and masks only volatile regions. A screenshot diff or model score alone cannot establish usability or client satisfaction.

Target WCAG 2.2 AA for the console and fixture. Include automated checks plus manual keyboard/assistive-technology checks on key flows. Report remaining accessibility scope honestly. Asset sources and licenses must be recorded; do not use a competitor's logo or copyrighted design asset without authorization. New image-generation services require available tools, allowed data transfer, and approved cost.

For native/mobile/desktop deliverables, inspect and interact with the actual target application in authorized simulator/emulator/device/desktop environments as required by the claim. Use platform conventions, platform accessibility checks, lifecycle/background behavior and performance appropriate to the task. HTML screenshots are not native-app evidence. Headless services, data pipelines and LLM/model work require their own observable behavioral and evaluation outcomes rather than a mandatory visual web UI. `docs/AI_ENGINEER_STACK_SCOPE.md` defines these responsibilities.

## 13. Verification and evidence contract

Use two evidence tiers:

**Developer checks:** Fast local tests inside the candidate environment. Valuable for repair but potentially controlled by the implementation. They may not independently authorize release.

**Protected acceptance:** A separately controlled coordinator obtains immutable candidate bytes, loads protected check definitions, starts unprivileged build/runtime sandboxes, and executes externally controlled probes. It records direct process status and interpreted results, then signs the observed evidence. Candidate-provided test counts and “PASS” text alone are not trusted.

Bind every record to project/run/attempt, source manifest, integrated artifact digest, requirements revision, policy digest, check definitions, runner image/version, relevant dependency lockfiles, fixture/environment identity, and timestamps. For polyglot/native/model tasks, the artifact digest covers a canonical manifest of all required binaries/packages/services/model weights/adapters, prompt/configuration, dataset or retrieval-index revisions, and inter-component contracts as applicable. Changing one required component invalidates the affected evidence and integrated acceptance; never let a green web subset approve an untested native or model component. Logs and screenshots are content-addressed. Sign the evidence envelope with a key unavailable to candidate/worker processes. A hash establishes identity, not authenticity; signing still does not prove the tests were well designed.

Readiness rejects: missing required checks; unexpected skipped tests; zero or reduced expected test discovery; duplicate records; wrong candidate/policy/environment; unsigned or untrusted evidence; timeout; invalid parser output; relevant source mutation during verification; expired evidence; missing auth test; unresolved blocking review findings; or an unapproved waiver.

Legitimate “not applicable” cases must be recorded in the protected policy before execution with a reason and reviewer authority. A worker cannot create a waiver after a failure. The reference evaluator in this package illustrates a subset of verdict rules; production execution, provenance, attestation, and isolation are separately required.

## 14. Storage and interfaces

The formal design is in `contracts/domain.schema.json`, `contracts/api.openapi.json`, `contracts/interfaces.ts`, and `contracts/storage/`. These are **Client Mode's own interfaces**, not settings automatically understood by a provider CLI.

The task-local `EngineeringContext` entity in the shared schema records affected components, evidence pointers, actual toolchain/target needs and unresolved gaps; it is passed as `ProviderContext.engineering_context`. Store each version in controller-owned `context_facts.value_json` with its source digest and invalidate on relevant changes. It is not a new provider configuration format, a trust grant, or a model-memory guarantee. `Project.profile_id` stays an opaque discovery/composite recipe reference, not a language enumeration.

Core entities include projects, source client requests, requirement-contract revisions, runs, attempts, workspace leases, candidates, policy/check versions, evidence envelopes, pending approval requests, authenticated decisions/grants, deployments, usage, audit and outbox events. Public entity names and persisted IDs follow the contracts; conceptual aliases are mapped in OPERATIONS.md.

SQLite tables use foreign keys, explicit schema version, WAL on a local filesystem, bounded busy timeout, transactions, and unique constraints for `(project_id, idempotency_key)` and active ownership. Single controller instance per state directory in v1. Do not place WAL storage on a shared network drive and assume it is a distributed scheduler.

HTTP interface is loopback-only by default, authenticated, and origin-checked. UI sessions use a random bootstrap secret exchanged for a short-lived secure local session; approval endpoints additionally require authenticated client intent and CSRF protection. Do not expose this controller publicly or allow arbitrary websites to drive localhost actions. IPC with OS access controls is preferred for trusted local services. A worker token cannot approve or deploy.

All mutations accept an idempotency key; versioned updates require `If-Match`. Reusing a key with a different payload returns conflict. Errors have stable code, readable message, retryable flag, request ID, and optional next client action. Event streams carry monotonic per-run sequence IDs with replay; dropped events never mean lost tasks.

## 15. Permissions, privacy, and authorization

Development permission grants identify project, action class, path/service scope, expiry, and actor. Reading a repository does not authorize production access. Installation approval does not authorize modifying every project or changing provider billing.

Use least-privilege service identities. No host Docker socket, administrator permission, SSH agent, browser production session, provider refresh token file, or deploy token inside candidate sandboxes. Where an official host needs authentication, keep that credential in its documented secure store and prevent candidate code from reading it. Revalidate that separation rather than assuming the host implements it.

Network policy is deny-by-default with approved package/documentation destinations and staging URLs. Validate redirects, resolved addresses, localhost/private endpoints, and actual destination. Tool output, repository instructions, screenshots, page text, and logs may contain prompt injection; they do not gain approval authority. The controller must enforce these boundaries independent of model compliance.

Store minimal raw client content and redact logs. Default configurable retention: operational raw logs and screenshots 30 days, structured audit/evidence 90 days, release manifests 365 days; organization policy may require different periods. Export/deletion must respect retention locks and explain them. Disable optional telemetry by default. Local installation is not local inference: hosted models may receive authorized project context. Privacy/legal signoff depends on actual provider terms, data class, region, and contracts; this handoff is not a compliance certification.

## 16. Cost and performance controls

Track billing mode explicitly: native subscription usage versus metered API. A new API mode requires approval. If provider counters are incomplete, display unknown/unavailable—not zero. Normalize input, output, cache-read/write where exposed, and reasoning tokens without double-counting provider totals. Deduplicate usage events using provider event IDs; unresolved usage reserves conservative remaining budget.

Default controls: one writer, two-child ceiling, three repair cycles, 30-minute task wall-clock ceiling for the initial local profile, 5-minute per-check timeout unless the protected profile explicitly allows more for the actual native build, data task or model evaluation, and a verification reserve. Larger project work is decomposed into bounded tasks under a separately approved run budget. The 30-minute value is a control setting, not a promise about delivery duration.

Dollar budget is **not** granted by this document. Native-session bootstrap may use existing authorized account capacity; API calls require a configured approved cap. Enforce caps where the provider/runtime permits, stop launching before the cap, and allow for in-flight requests/cancellation latency. Prompt-only “spend less” is not a hard limit.

Use deterministic log reduction, short source-grounded handoffs, stable instructions, selective skills, and risk-based model effort. Do not force maximum effort onto every task. Measure total cost across unsuccessful tasks as well as successful ones. A quiet console may reduce client noise; do not market it as a large token optimization by itself.

## 17. Installation, operation, and distribution

Implement a `cm` executable with `doctor`, `install`, `uninstall`, `upgrade`, `open`, `run`, `pause`, `resume`, `cancel`, `status`, `verify`, `export-evidence`, and `rollback`. These commands do not exist in this package yet. Full definitions are in the operations document.

`doctor` discovers tools and permissions, distinguishes configured from observed-working, runs disposable probes, and stores a versioned capability report. Installation is a dry-run diff before authorized application, atomic where possible, backed up, and reversible. Never replace a user's entire native settings file. No automatic OS elevation or global model change.

Plugin output is self-contained in both distributions. Test from installed/cached locations and paths containing spaces/Unicode, not only the source checkout. Global procedures are reusable; per-project facts and private data remain isolated. Pin upgrades and run capability regressions before enabling new features. Unknown host behavior defaults to a narrower safe mode.

Native entry mode gives the existing CLI a reusable process and may still expose host tool activity. Full quiet console mode is custom code, using an officially supported programmatic surface and billing/authentication path. Do not claim a prompt can completely hide the native terminal UI.

## 18. CI, releases, migrations, and monitoring

Separate product CI (tests on proposed toolkit changes) from protected application acceptance and deployment. Candidate code runs on ephemeral unprivileged runners without secrets. Protected workflow policy must come from a trusted version and cannot be replaced by a pull request. A maintainer-controlled controller authorizes signature/check identity. Never run untrusted PR code in a secrets-bearing workflow merely because it is “CI.”

Build once, verify the same artifact digest, and promote it after approval. Record source and artifact identities; a rebuild creates new evidence requirements. Database migrations use expand/contract where practical, rehearsed on synthetic representative data, with backup/restore or roll-forward instructions. An irreversible migration may block binary rollback; report this and require specific authorization.

Toolkit releases include checksums, dependency/asset inventory, compatibility matrix, qualification summary, change log, upgrade/uninstall instructions, and evidence. Staged rollout: internal fixtures, one low-risk pilot project, limited adoption, then qualified release. Feature flags gate delegated execution, browser writes beyond staging, optional MCP, new provider transport, and automatic resumption. Production deployment defaults off.

Monitor controller health, queue age, stale leases, error rates, failed verification, attestation rejects, canceled jobs still running, blocked approvals, and budget accounting gaps. Operational details, targets, and runbooks are in `docs/OPERATIONS.md`.

## 19. Test strategy and proof requirements

Unit: contract validation, state transitions, authorization predicates, ownership rules, budget reservations, parser behavior, redaction, output filtering, snapshot identity.

Integration: real database transactions, crash recovery, mock provider protocol streams, workspace isolation, candidate sealing, detached signature verification, runner timeouts, artifact capture, install/uninstall and configuration merging.

E2E: ordinary-language request through the client console into a disposable real app, browser/API acceptance, feedback revision, and a safe staged release through the approval path. Live host tests are separate from mock protocol tests.

Security: evaluator tampering, malicious build script, fake report, stolen/replayed approval, path/symlink escape, credential access, localhost/SSRF attempts, cross-project data retrieval, forged events, hidden-test inspection, unauthorized deployment, and stale evidence.

Chaos: provider rate limit, server restart, duplicate callback, cancellation race, orphan worker, full disk, unavailable browser/database, interrupted install, partial migration, CI outage, and post-deploy smoke failure.

Performance: controller/console responsiveness, state recovery, queue fairness, bounded output/retention, and whole-tree cost. No made-up provider latency/price numbers.

Qualification: native baseline A, single-agent Client Mode B, bounded multi-agent C, repeated and matched task snapshots/budgets. Do not tune on holdouts. Include weak English/Taglish variants, UI issues, bugs, auth/tenant isolation, data changes, and integration uncertainty. `docs/QUALIFICATION.md` defines denominators, thresholds, confidence limits, and stop criteria.

## 20. Definition of Done — full v1

Release has four separate signoffs: toolkit implementation/qualification, each generated application’s technical readiness, actual client acceptance, and authorized deployment with post-release checks. `docs/RELEASE_ACCEPTANCE.md` is the engineer-owned acceptance checklist; one signoff cannot substitute for another.


Every item must have evidence, a responsible owner, exact candidate/version, and observed result:

1. Both provider adapters load in fresh native sessions and their supported controller transports are authenticated and tested; unsupported capability is explicitly scoped.
2. Quiet client console and native entry handle a realistic ordinary-language request without client-written engineering artifacts or repeated “continue.”
3. Onboarding preserves existing work, languages and business rules, discovers every affected polyglot component, validates project prerequisites, and creates actual stack-appropriate runnable checks. It does not reject a task solely because it lacks a prewritten stack skill.
4. UI/UX deliverables include functional target-platform interactions and identified accessibility/manual-review scope: web rendering for web, native/simulator/device checks for native, and model/data/service evaluations for non-visual work. No web substitute is accepted for a requested native deliverable.
5. Durable state, ownership, bounded delegation, cancellation, non-progress stop, and recovery pass adversarial tests.
6. Protected verification rejects all mandatory tampering/false-ready fixtures and binds evidence to the final integrated artifact.
7. Approval and release tests reject replay, wrong candidate/environment, expired authorization, and unauthorized model-originated approval.
8. Mandatory unit/integration/e2e/security/chaos tests pass; cross-stack and unfamiliar-stack qualification meets the predeclared task-family thresholds with real environments. Results in JavaScript alone do not satisfy the revised AI-engineering remit; missing environments block only the affected qualification claim, not safe development in other domains.
9. Install, upgrade, uninstall, rollback, compatibility checks, and operations runbooks are exercised on the published matrix.
10. No unresolved critical/high release-blocking defect, secret exposure, unapproved spending, or unsupported claim is present.
11. Release package, provenance, dependency inventory, retention controls, usage metrics, and client instructions are delivered.
12. A live authorized pilot produces a client-review candidate and handles feedback. Client satisfaction is recorded only from actual client feedback.
13. Real document ingestion, coverage/citations, numerical analysis, semantic-preserving edits, output rendering and original-byte preservation pass their format/operation gates; metadata-only tests do not qualify them.
14. Document-only create/review and combined file-to-software workflows support authentic questions, revisions, cancellation, shared budgets and restore without fake code runs.
15. Mature-company responsibility routing and on-demand support resolve actual fixture issues and update knowledge; human authority and configured operational coverage remain explicit.
16. G7/G8 and all new tasks are complete before advertising the full v1.3 product. Source/version invalidation and private document isolation are tested adversarially.

The toolkit being released and an app generated by it each need their own release evidence. Passing toolkit tests does not approve every future client project.

## 21. Build order and ownership

| Milestone | Plans | Owner | Exit evidence |
|---|---|---|---|
| M1: deterministic core | 01 | Platform lead + QA | Contracts, state, ownership, budget/approval predicates, executable core tests |
| M2: protected acceptance | 02 | Security + QA | Real isolated runner, negative tests, authenticated evidence, approval boundary |
| M3: provider integration | 03 | Integration engineers | Claude/Codex live compatibility and bounded jobs, no guessed flags |
| M4: client experience | 04 | UX/frontend + full-stack | Quiet console, real app journeys, feedback and browser evidence |
| M5: install and operations | 05 | Platform/release | Self-contained distributions, rollback, runbooks, secure local service |
| M6: software release-path qualification | 06 | Independent QA + release owner | A/B/C results, held-out safety suite, staged release rehearsal; prerequisite to complete v1.3 |
| M7: document intelligence and artifacts | 07 | Document/data engineers + writer/editor + security/QA | Real format handling, source evidence, calculations, editable exports and durable quiet jobs |
| M8: company-service qualification and full ship | 08 | Product/support + independent QA + release owner | Responsibility routing, support loop, document holdouts, integrated client acceptance and release |

Implement each milestone as working software. M1/M2 are intentionally provider-independent; missing provider credentials do not block their offline tests. Live qualification can block full release without blocking unrelated implementation.

## 22. Prior-work reconciliation and remaining inputs

Edition 1.3 is the consolidated researched handoff and supersedes earlier archives for implementation. Edition 1.2 remains its preserved starting point. It preserves the all-stack AI remit and adds the complete question/answer path, company-responsibility coverage, active change protocol, stronger contract/storage invariants, and a fail-closed package validation command. Review findings and bounded verification are in `qa/REVIEW_REPORT.md` and `qa/HANDOFF_VALIDATION.md`. These revisions do not claim a running product.


Edition 1.1 supersedes the prior JavaScript/TypeScript-only qualification scope and the blanket exclusion of client model work. The change is to AI engineering remit, not a request to rewrite the toolkit in many languages. Prior provider documentation is retained as dated research and was not re-researched during this scope correction.

Earlier research and the Client Mode blueprint establish the product direction. Some reports describe prototype archives and passing checks. Those claims are not inherited as current proof: the described archive was not part of the mounted source available for this handoff, and its host tests were explicitly unfinished. The package here is newly assembled and checked; its exact validation scope is in `qa/HANDOFF_VALIDATION.md`.

Do not depend on a particular `/goal` flag, plugin table name, browser surface, or internal source path until capability discovery verifies it. Do not certify a verifier solely because it parses a success string. Do not treat a hash, a different reviewer persona, a worktree, or a private folder as an independent release boundary. Do not assume a consumer subscription pays for an embedded/hosted SDK service.

Only unavoidable owner inputs are: authorize the selected workspace and account connection; approve any additional API/service budget; resolve genuinely material business ambiguity; and approve production publication when requested. Engineers choose the architecture details within this contract. No production credentials are needed for initial qualification.

## 23. Company practices and document intelligence — controlling v1.3 extension

The researched source ledger and its limited applicability are in `research/COMPANY_PRACTICES.md` and `research/sources.json`. Adopt customer-outcome ownership, cross-disciplinary reviews, documentation with product changes, security by design, actual user evidence and operational learning. Do not copy an org chart into an expensive always-on swarm or claim this design is endorsed by those companies.

`docs/DOCUMENT_WORKFLOW.md` is normative for PDF, Office, spreadsheet, presentation and image operations. It adds a document pipeline and independent DocumentJob lifecycle alongside software Run. Each document result binds immutable source versions, requested scope, real calculation/visual work when relevant, instruction revision and exact output bytes. Findings link to pages/parts/sheets/cells/slides/regions. Original files are preserved, incomplete extraction is visible, and unsafe active content is not executed.

The same one-lead client experience owns analyst, researcher, technical writer, editor, spreadsheet expert, support and product-analysis responsibilities when useful. A document-only request does not create a code project. A build-from-documents request turns grounded, resolved requirements into normal stack-appropriate software work. A support case does not grant production permissions. Document tools are separately capability-tested; title labels and provider attachments do not implement them.

New schemas/API/storage are custom interfaces in this package, not native provider options. Sources and an index are evidence/context, not higher-priority instructions. G7 proves real document workflows; G8 joins those with company-service behavior, existing multi-stack qualification and final release. T24 is a software release rehearsal; T33 owns complete v1.3 shipment. Old tests and older output artifacts cannot substitute for current qualification.
