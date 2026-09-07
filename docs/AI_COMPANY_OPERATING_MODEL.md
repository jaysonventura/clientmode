# AI Company Operating Model

Normative edition 1.3. This is responsibility coverage for the AI workers, not a requirement to implement the toolkit in every language, employ a permanent agent for each title, or simulate meetings. Read with the master specification and the all-stack scope.

## 1. Client service contract

One client-facing delivery lead accepts an idea, requirements, screenshots and feedback. It owns internal research, planning, staffing, UI/UX, implementation, tests, review, repair, integration and release preparation. Default notification classes are `QUESTION`, `AUTHORIZATION`, `BLOCKER`, and `DELIVERY`. Routine plans, status meetings, worker conversations and logs are internal. A passive status indicator and pause/cancel controls remain visible. Quiet mode never hides a security incident, missing verification or a blocked decision.

The client owns business priorities, material policy choices, approved spending/data access, acceptance of the experience and production authorization. The client is not required to become Scrum Master, write stack instructions, select test tools, or relay messages. Absence of a client response is never approval or satisfaction.

## 2. Responsibility catalogue

| Responsibility | Trigger | Required output | Execution role and authority |
|---|---|---|---|
| CTO / architecture | New architecture, major integration or material technical risk | Concise decision with constraints, alternatives, interfaces and failure/recovery tradeoffs | Lead or bounded investigator; no extra credentials |
| Product management | New outcome or changed scope | User problem, intended journey and bounded outcome linked to source request | Lead; cannot invent business policy |
| Product owner support | Requirements, priorities or acceptance change | Versioned backlog/acceptance criteria and unresolved decisions | Lead; client retains material business authority |
| Engineering / delivery manager | Every substantive task | Dependency graph, scoped assignments, integration owner, blockers and budget | Controller-assisted lead; no self-approval of release |
| Project / Scrum coordination | Work spans tasks or sessions | Durable task state, dependency/blocker tracking and concise next action | Same lead by default; no artificial daily meetings |
| UX design | User-facing flow | Journey, information hierarchy, error/loading/empty states and platform conventions | Designer responsibility in lead/writer; research claims require real research |
| UI / frontend | Web or visual interface | Coherent visual system and functional interaction, not screenshots alone | Scoped writer; actual rendered checks |
| Backend / database | Services, business rules, persistence | Contracts, server-side validation/auth, data migration and recovery behavior | Scoped writer; protect production data |
| Mobile / native / desktop / systems | Relevant native target | Native architecture, lifecycle/permissions, target builds and suitable tests | Stack-grounded writer/reviewer; no web substitute |
| AI / ML / data engineering | Models, RAG, agents, pipelines | Versioned datasets/model/prompt/retrieval configuration, task-quality evaluation and resource limits | Grounded writer; compute/data permission remains separate |
| QA / test automation | Every behavioral change | Independent acceptance design, reproduction and regression evidence | Reviewer plus protected verifier; writer tests remain developer evidence |
| Code review | Significant change or risk | Concrete findings with reproduction or explicit inspection gaps | Separate bounded review attempt on immutable candidate |
| Security / privacy | Trust boundary, auth, data, dependencies, external tools | Threat/risk-specific checks and blocking findings | Reviewer/security responsibility; protected policy review by distinct authority |
| DevOps / release / reliability | Deployment or operational change | Reproducible artifact, configuration, health, backup, migration and recovery evidence | Protected release service, never a more-privileged worker persona |

No fixed language list restricts these responsibilities. A role may use task-specific context for Swift, Kotlin, Python, Go, Rust, Java, .NET, PHP, embedded software or an unfamiliar stack. The model must investigate uncertain details and report inability to verify. A role title is neither a new trained model nor proof of expertise.

## 3. Assign responsibilities without an expensive swarm

At scoping, the lead creates a compact coverage map in the controller-owned task plan: `responsibility`, `task_id`, `assigned_attempt_id`, `expected_output`, `review_gate`, and `applicability_reason`. This map is working metadata, not an acceptance grant. Keep exact client priority and requirements revision alongside it.

Use the existing four execution roles (`lead`, `writer`, `explorer`, `reviewer`). Responsibility labels never change the permission role. A lead can cover PM/PO/architecture for a small feature. One writer can implement frontend and backend sequentially. Activate specialists only for a bounded, genuinely useful assignment. Default remains one active writer per project, at most two child jobs per lead, depth one. The lead's own edits count toward write ownership; it may not write concurrently merely because it is called the coordinator.

A small text/layout change need not create a CTO, PM or QA agent process. It still needs understood scope and appropriate regression checks. A polyglot native/model product needs component-specific knowledge and combined integration evidence; it does not require every component to be edited simultaneously.

When a responsibility is not applicable, record a brief technical reason. Risk-relevant correctness, authorization and readiness checks cannot be removed by an applicability label. Independent reviewers must receive the contract, source/candidate, relevant checks and findings—not just the writer's success narrative. Disagreement is resolved with reproductions or a technical decision, not majority voting.

## 4. Autonomy and stop rules

Within scoped permission and budget, the lead selects tools, checks authoritative documentation, plans, builds, executes, diagnoses, repairs and rechecks without routine client approval. It stores short source-grounded context for future active sessions. It does not install every SDK, subscribe to services, download large model weights or enable every MCP connector at startup.

On a material business ambiguity, use the durable question/answer protocol. On access/spending/destructive/production actions, use the separate authenticated authorization protocol. A manager agent cannot waive either. On non-progress, capture the smallest reproduction, revise the hypothesis once within the remaining repair budget, or report a blocker. Saved work does not continue after all authorized execution processes stop.

## 5. Acceptance of this operating model

T04/T12 test responsibility assignment, concurrency accounting, stale-worker fencing and title-based privilege denial. T13/T15 test plain-language intake, quiet operation and material questions. T14/T16 require observable design/implementation/testing outputs. T23 evaluates the same experience across native/backend/model and unfamiliar-stack tasks.

Independent QA must demonstrate that no client-written Markdown, agent assignment, technical library choice or repeated “continue” is needed for clear authorized tasks. Test missing credentials and unanswered business questions too: a truthful bounded pause is correct behavior, not a reason to invent completion.

## 5. Additional mature-company responsibilities — mandatory routing, not permanent departments

The public company research is summarized in [Company practices](../research/COMPANY_PRACTICES.md). These adaptations are our product design, not proof of equivalence to any company's staff. Add these entries to the responsibility map when their trigger applies:

| Responsibility | Trigger | Required output | Authority boundary |
|---|---|---|---|
| Business/document analyst | Uploaded specifications, conflicting files or a document-only review | Version-cited findings, requirement links, scope coverage and material questions | Cannot silently choose a disputed business policy |
| Researcher/knowledge curator | Unfamiliar stack, product question, source conflict or stale knowledge | Bounded first-party evidence with version/date and uncertainty; reusable facts only with provenance | Retrieved instructions do not gain execution permission |
| Spreadsheet/data analyst | Workbook, CSV, pricing, metric or numerical rule | Sheet/cell references, formula/dependency inventory and actual calculation evidence | Cannot certify a cached value or partial file as complete |
| Technical writer | User/API/configuration/release behavior changes or a documentation request | Accurate versioned guides and tested examples linked to actual software | Cannot invent supported features or imply compliance |
| Editor/document QA | Important analysis, copy edits or exported documents | Meaning-preservation review, reopened artifact, actual numerical/layout checks and known fidelity limits | Separate reviewer for consequential edits; final acceptance remains protected |
| Accessibility/localization | User-facing product/documents and target-language changes | Platform-appropriate accessible controls, terminology/locale checks and declared manual-testing scope | Cannot invent user studies or full conformance |
| Product analyst/research support | New outcome or post-release improvement | User problem, assumptions, observable outcome measure and actual feedback source | Analytics/participant recruitment/data collection need authorization |
| Support/customer-success engineering | Client reports a problem or needs onboarding | Reproduction, severity, linked repair request, tested answer and a knowledge/runbook update | On-demand by default; cannot promise round-the-clock service from a stopped process |
| Incident/reliability coordination | Confirmed outage, integrity/security event or failed release | Impact/timeline, containment proposal, authorized recovery and preventive regression | No silent destructive remediation, external notification or SLA promise |
| Vendor/cost/license review support | New paid service, dependency, model, font, asset or distribution | Source license/usage constraints, measured cost assumptions and approval request where needed | Not a legal signoff or purchasing authority |

HR, payroll, fundraising, sales outreach, accounting, contract signing and legal representation are not automatically added to this engineering product. The AI may draft an explicitly requested artifact or surface a risk; qualified accountable humans retain consequential decisions. This avoids turning a research analogy into an unauthorized enterprise-management system.

## 6. Product discovery without client bureaucracy

For substantive work, maintain an internal outcome brief: source request, intended user, current problem, proposed observable improvement, exclusions, material unknowns, evidence references and risk tier. The client does not write a PRFAQ or attend invented Scrum ceremonies. Default UI shows the request, necessary question, current result and feedback—not this internal paperwork.

Customer testimony, observed research, product telemetry and agent inference are different evidence types. Preserve provenance and consent. Never invent interviews, market statistics, experiments or stakeholder approval. When no research is available, label the design as a hypothesis and validate the working journey. Routine changes can reuse the existing brief. Additional study requires real participants/data/tools and appropriate authorization.

Risk tiers: routine (reversible content/layout change with no sensitive behavior), substantive (new flow, integration, data model or document-derived business rule), high consequence (security/authorization, sensitive data, payments, irreversible changes or regulated claims). The lead may recommend a tier; the protected policy can raise it and workers cannot lower mandatory gates. Every tier has a single implementation owner and appropriate review evidence. High consequence requires separate qualified human/specialist signoff where policy calls for it. A minor style preference is not a reason for an endless repair loop.

## 7. After delivery

An on-demand ServiceCase links a genuine client request to a project and, when available, an existing run/deployment. Triage records facts, reproduction, impact and severity. A confirmed defect becomes a normal scoped repair run with regression checks; a documentation question may become a document job. Do not fabricate a second client message to start work. Keep the case and work IDs linked in controller-owned records.

Use OPEN→TRIAGED→INVESTIGATING→RESOLVED→CLOSED; a new report can reopen to TRIAGED with history. RESOLVED requires resolution evidence or a clearly bounded documented answer, not a reassuring sentence. CLOSED additionally requires actual client confirmation or a predeclared authorized closure policy with notification; client silence is not satisfaction. Duplicate reports are linked to the original rather than erasing history.

Default coverage is on_demand. A configured_service profile requires an actually running supervisor, health checks, alert destination, authorized response playbook, data/access policy and operator ownership. Publish observed coverage, not a universal uptime or response promise. Significant incidents yield a factual timeline and preventive test/runbook action; do not use blame or invent a postmortem from incomplete logs. A closed loop should improve future delivery, not silently alter other clients' projects or global policies.
