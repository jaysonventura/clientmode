# AI Engineering Scope — All Technology Stacks

**Normative revision:** 1.1, 7 September 2026. This corrects the owner's intended **AI engineer capability**, not the implementation language of Client Mode. Read with the master specification. No live agent or stack capability is certified by this document.

## 1. The distinction that must remain explicit

| Layer | Requirement |
|---|---|
| Client Mode application | May use one maintainable implementation stack. The proposed TypeScript controller does not need a rewrite. |
| AI engineering team | Technology-agnostic: understand, investigate, design, implement, review, debug and test the actual client technology. |
| Execution environment | Must contain or be authorized to access the real tools, operating system, dependencies and hardware needed to verify the stated outcome. |
| Production claim | Evidence for an identified candidate and target environment, never an assertion that the agent already knows every framework perfectly. |

The business request is not “make Client Mode support only web apps.” It is “give me AI engineers who handle whichever stack my project needs, including UI/UX and QA, without making me manage them.”

## 2. Open-ended engineering responsibilities

The following examples define breadth, not a closed language/framework whitelist and not a certification list.

| Family | Illustrative work the AI team must accept | Evidence appropriate to the requested outcome |
|---|---|---|
| Web and ecommerce | Existing or new sites, frontend, SSR, commerce extensions, PHP/Python/Ruby/.NET/Java/Go/JS services | Actual user journeys, API contracts, persistence, authorization, performance and accessibility checks. |
| Native mobile | Swift/Objective-C iOS, Kotlin/Java Android, native modules and SDK integration | Native build, platform tests, simulator/emulator/device interactions, lifecycle and permission cases relevant to the change. |
| Cross-platform mobile | Flutter/Dart, React Native, shared Kotlin or other suitable technology | Tests on each promised target platform; shared-source tests alone do not verify both platforms. |
| Desktop and native systems | Windows/macOS/Linux software, C/C++/Rust/.NET and suitable native UI frameworks | Target build, installation/runtime behavior, applicable UI/OS integration and memory/concurrency checks. |
| Services, databases and infrastructure | API/backend, storage, migrations, queues, containers, deployment, observability | Contract and negative tests, transactions/idempotency, representative migrations, controlled infrastructure plans and authorized smoke checks. |
| Data and ML | ETL, analytics, classical ML, inference, fine-tuning and training pipelines within approved scope | Data schema/quality and lineage, leakage controls, held-out metrics, reproducibility, resource and data-rights checks. |
| AI/LLM/RAG | LLM APIs, tools/agents, retrieval, ranking, local inference, model serving, evaluation | Task accuracy, retrieval/grounding, tool-use safety, injection/adversarial cases, abstention, privacy, latency, memory and cost under declared test conditions. |
| Polyglot products | Native app + Go API + Python model service + SQL database, or another justified combination | Each component plus versioned inter-component integration; one component's green test does not approve the product. |
| Other or unfamiliar stacks | Legacy systems, emerging frameworks, domain-specific languages, hardware-backed software | Discover authoritative source and toolchain, bound uncertainty, implement safely, and obtain the necessary environment before claiming verification. |

Regulated, safety-critical and high-consequence work requires proportionate specialist review. Broad remit does not bypass authorization, licensing, safety, hardware availability or computational cost.

## 3. Task-specific expertise rather than persona claims

Every writer and reviewer must ground their assignment in the actual project. Role titles such as “senior iOS engineer” are descriptions of responsibility, not evidence of competence. The required behavior is:

1. Identify each affected component, language, framework/runtime version, platform, build system, dependency lock and deployment boundary.
2. Preserve working conventions and client business rules. For new projects, select a suitable maintained stack based on constraints, not the toolkit's language or the agent's favorite template.
3. Resolve uncertain APIs using repository source, installed declarations, official version-appropriate documentation, changelogs or local experiments. Record provenance. Do not claim a search result or generated summary is authoritative by itself.
4. Assemble only the relevant specialist context and native check requirements. The agent owns this work; the client is not asked to author a stack skill, select a library, or supply a test command discoverable in the repository.
5. Implement and reproduce failures in the target technology. Invoke native tools only after discovering valid commands and authorizing their execution environment.
6. Review against stack-specific failure modes and execute final protected acceptance on the integrated candidate. Missing evidence stays unverified.

An unfamiliar stack is a trigger for investigation, not automatic rejection or a silent conversion to React/Node. When essential knowledge cannot be verified, the AI records the uncertainty and seeks an appropriate technical review instead of bluffing. When a task truly cannot run with the available environment, it explains only the minimum access/decision needed and continues unrelated safe work.

## 4. Internal engineering context contract

`contracts/domain.schema.json` defines `EngineeringContext` and `EngineeringComponent`; `contracts/interfaces.ts` mirrors them. They are custom task context, not vendor SDK fields. The adapter translates the context into native instructions/tool inputs through verified host interfaces.

Required identity: project, task, source digest, requirements revision, and observation time. Components contain a stable ID, repository location reference, engineering domain, languages/frameworks, target platforms, environment reference, evidence pointers, required check IDs and unresolved capability gaps. Language/framework/platform entries are free nonempty strings; there is no supported-language enumeration.

`grounding_status` distinguishes `NEEDS_GROUNDING`, `GROUNDED` and `BLOCKED`. Grounded means evidence is available, not that the code is correct. It cannot create a ready verdict. Tool/environment versions come from the referenced observations; synthetic schema examples must not be presented as actual toolchain discovery.

Store versions in `context_facts.value_json` under project/task-scoped keys and pass the current entity in `ProviderContext.engineering_context`. Retain stale versions as history, but re-ground changed dependencies, source or target environments. The shared artifact digest must cover the composite manifest; the single `profile_id` on Project is only an opaque recipe pointer and can denote discovery or a composition.

## 5. Native QA and LLM QA are first-class responsibilities

A browser-only success is insufficient for an iOS/Android/desktop request. Evaluate the actual requested UI, supported device/OS targets, accessibility mechanisms, background/resume/permission states, distribution and signing requirements where applicable. Release signing and store submission require the same controlled identity and client authorization as other production actions. A simulator result is labeled as such, not converted into a physical-device claim.

LLM quality cannot be approved from an attractive chat UI or one successful sample. Define task-level expected outcomes before evaluating: held-out accuracy, citation/grounding behavior, retrieval coverage, unsupported-answer/abstention behavior, correct tool invocation, malicious-document handling, PII boundaries, latency and cost. Use multiple runs where stochastic behavior affects the outcome. Declare dataset provenance and evaluation thresholds, and separate deterministic integration tests from probabilistic model-quality evaluation. Agent opinion alone is not the grader.

For local/offline requirements, test the promised offline runtime on the target configuration. Hosted coding assistance used to develop the application is a separate concern and cannot be mislabeled as private offline inference. Training/fine-tuning, GPU use, large model downloads and external data transfer require appropriate data rights, resource limits and approval; the toolkit must not perform them merely to look capable.

## 6. Targeted work within existing milestones

Do not create a new engine, permanent agent department, or bespoke programming-language runtime for each stack. Extend the existing architecture through project discovery, contextual specialist procedures, native command/probe recipes, appropriate authorized workers, and task-family evaluation. Existing generic `process` and `tests` result types can carry native/model check outcomes interpreted by protected parsers. Add detailed metrics as retained evidence, not by pretending model evaluations are deterministic guarantees.

| Tasks | Required addition |
|---|---|
| T01/T03 | Validate open-ended engineering contexts; inventory polyglot components without erasing dirty files or ignoring non-JS sources. |
| T05/T06/T07 | Run platform-appropriate checks and bind composite outputs; missing emulator/GPU cannot produce a pass. |
| T09/T12/T13 | Detect actual environment, ground task expertise, preserve existing stack, route narrow specialists, keep client interaction simple. |
| T14/T16 | Native UI/UX and model/data/service outcomes participate in the same design/build/repair/recheck flow. |
| T21/T22/T23/T24 | Execute cross-stack/adversarial/unknown-stack trials, report per-family quality/cost, and ship accurate qualification limits. |

The numbered plans and `contracts/acceptance-scenarios.json` contain executable-test contracts for these additions. Their product tests remain unexecuted until the engineers build them.

## 7. Release interpretation

“All stacks” is an engineering remit and an open-ended adaptation requirement, not a guarantee that one model has complete knowledge or that every compiler and device exists on the client's machine. Broad engineering responsibility, available execution capabilities and observed qualification are three separate records.

The revised release cannot pass on JavaScript web trials alone. Qualification includes web/non-JS backend, native mobile, desktop/systems, LLM/model, polyglot and unfamiliar-stack work. If a necessary platform is unavailable, report the affected qualification gap; do not erase it, claim all-stack proof, or redefine the AI team as web-only. Continue safe development and keep client questions limited to genuinely necessary authority.
