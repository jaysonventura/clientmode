# Client Mode — Provider Orchestration Implementation Plan

> **For agentic workers:** Use Superpowers subagent-driven-development or executing-plans when installed; equivalent task-by-task rules are below. Do not require Superpowers as a shipped product dependency. Track checkbox steps and keep one integration owner.

**Goal:** Complete milestone M3, including its executable acceptance gate, as part of the full six-milestone product.

**Architecture:** Two provider-specific facades normalize documented native events into shared lifecycle contracts. Capability probing, constrained job ownership, and independent review avoid assumptions about host parity.

**Toolkit Implementation Stack (not the AI team's supported-stack boundary):** Strict TypeScript, maintained pinned Node LTS, npm workspaces; shared JSON Schema, SQLite, official provider interfaces, and a protected test/browser runtime as applicable.

**Spec:** `../../../ENGINEERING_HANDOVER.md`, `../../SECURITY_AND_RELEASE.md`, `../../QUALIFICATION.md`, and `../../../contracts/interfaces.ts`. Paths in task blocks are relative to the product repository root, not this document folder.

## Global constraints
AI engineers must handle the actual client stack across web/backend/mobile/native/systems/data/LLM domains. Follow `docs/AI_ENGINEER_STACK_SCOPE.md` (repository-root path); do not treat the toolkit implementation language or a missing prebuilt profile as a language restriction.

The binding values are: one writer/project; maximum two child jobs; depth one; three repair cycles; default task ceiling1800seconds; default check timeout300seconds. Native account usage and approved API billing are separate. No extra spending, public release, destructive changes, or policy weakening is authorized by this plan. Preserve client business behavior and dirty files. Missing/unsupported checks are UNVERIFIED. Full v1 requires both adapters, quiet console, protected verification, and all eight milestone gates (G1–G8). The client does not maintain Markdown, assign agents, or say continue.

## Execution and test conventions
Create a branch/workspace after inspecting existing changes. Read each task and its acceptance scenario in `contracts/acceptance-scenarios.json`. The product test harness from T01 lives in `tests/harness/registry.ts`. Each task owns `tests/scenarios/TNN.scenarios.ts`, which registers its scenario by exercising the actual production boundary described below; never return the expected dictionary as a substitute for executing it. Test observations are outputs of measured operations. Mock protocol tests must stay explicitly labeled and cannot satisfy live-provider, protected-isolation, or benchmark gates.

The supplied test blocks go in `tests/tasks/TNN.test.ts`. They are future product acceptance tests, **not tests claimed executed by this handoff**. Resolve the declared implementation dependencies before testing. A failing assertion or missing real implementation is a valid red state; missing credentials are a blocked live test, never a skipped green result. After minimal green implementation, refactor, run affected regression/type checks, review actual diff/evidence, and commit. Do not ask the client to approve ordinary task progression.

## T09: Capability detection and explicit authentication/billing modes

**Owner:** Provider integration  
**Dependencies:** T01, T04  
**Requirements:** FR-05, FR-21, FR-23, FR-27, FR-31, NFR-13, FR-39  
**Gate:** AT-009 (integration).

**Files to create or modify:**
- `packages/providers/src/interface.ts`
- `packages/providers/src/capabilities.ts`
- `apps/cli/src/doctor.ts`
- `tests/scenarios/T09.scenarios.ts`
- `tests/tasks/T09.test.ts`

**Consumes:** The root contract schema/interfaces, approved policy and relevant services delivered by T01, T04. See the named public interfaces in `contracts/interfaces.ts`; do not invent a second incompatible contract.

**Produces:** The file-owned component described in the implementation steps and a registered `AT-009` scenario returning `ScenarioObservation`. Later tasks consume the same versioned boundaries, not private provider runtime files.

- [ ] **1. Prepare the exact fixture.** Provide process fixtures for missing tools, known supported versions, unknown schema changes, expired account and unavailable browser. Separate observed probes from configured flags.

- [ ] **2. Write the failing acceptance test and real scenario executor.** Register the scenario in `tests/scenarios/T09.scenarios.ts` using the shared registry. Its executor must perform these actions and record observations:
  1. Run doctor on absent and supported fixtures; distinguish configured from observed capability.
  2. Deny account access and API spending; attempt a silently substituted provider.
  3. Advertise unsupported browser/MCP/goal mode and run the required disposable probe.

```ts
// tests/tasks/T09.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { exerciseScenario } from '../harness/registry.js';
import '../scenarios/T09.scenarios.js';
test('AT-009: Capability detection and explicit authentication/billing modes', async () => {
  const result = await exerciseScenario('AT-009');
  assert.equal(result.scenario_id, 'AT-009');
  const expected = {
  "unknown_capability_not_enabled": true,
  "configured_not_reported_as_tested": true,
  "billing_fallback_denied": true,
  "browser_gap_explicit": true,
  "unsupported_mcp_disabled": true,
  "toolkit_runtime_not_target_capability": true
};
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(result.observed[key], value, key);
  }
  assert.ok(result.artifact_paths.length > 0, 'retain actual evidence');
});
```


- [ ] **Edition 1.1 cross-stack acceptance.** Probe task-specific native/model prerequisites rather than inferring them from Node availability; distinguish configured from tested environment and authorized from unavailable resource. Execute the expanded observations in `contracts/acceptance-scenarios.json`; the test dictionary above includes them. Store actual results and native/model evidence, not a hard-coded expected object.

- [ ] **3. Run RED.** After T01 installs the approved test dependencies, run:

```bash
node --import tsx --test tests/tasks/T09.test.ts
```

Expected before implementation: FAIL on the named missing behavior, not a forged success report. Record the observed failure. T01 may begin with missing modules while bootstrapping; subsequently replace that with behavioral rejection tests.

- [ ] **4. Implement the smallest complete component.** Implement ProviderAdapter and CapabilityReport interfaces. Fingerprint OS/architecture/host/SDK/auth mode/model IDs without secrets. Supported official features require version plus runtime probe; record report ID. Verify docs during integration, do not import copied unstable flags blindly. Native-account entry and custom SDK console are different surfaces. Claude third-party product authentication must follow official terms; no unofficial consumer credential reuse. Unknown behavior narrows capabilities and preserves work.

```text
capability state = unavailable | configured | observed_working
provider job admission:
  required capability must be observed on supported host/surface
  billing_mode must match authorized mode
  missing credentials -> BLOCKED_ACCESS, not automatic API fallback
```
Store raw provider command paths only in trusted local configuration; never execute a binary path supplied by a web page or client message.

- [ ] **5. Run GREEN and affected regressions.** Repeat the command above, then run `npm run typecheck` and `npm run test:tasks`. All required discovered assertions must execute. When a prerequisite for an unrelated live gate is unavailable, record that task as blocked and report the affected subset accurately; do not make the global test command falsely green. Verify resources and secrets are cleaned up.

- [ ] **6. Review and commit.** Inspect the diff against the requirement IDs, ownership, negative tests, and actual retained evidence. Obtain independent review for security/acceptance policy changes. Stage only this task's intentional changes and commit with a message beginning `T09:`. No approval to deploy is implied. Mark the task complete only after its gate is met.

## T10: Claude official adapter and native entry integration

**Owner:** Claude integration  
**Dependencies:** T04, T09  
**Requirements:** FR-05, FR-06, FR-08, FR-20, FR-21, FR-23, FR-31, NFR-09, NFR-13  
**Gate:** AT-010 (live_provider).

**Files to create or modify:**
- `packages/providers/src/claude.ts`
- `packages/providers/src/normalize.ts`
- `adapters/claude/`
- `tests/scenarios/T10.scenarios.ts`
- `tests/tasks/T10.test.ts`

**Consumes:** The root contract schema/interfaces, approved policy and relevant services delivered by T04, T09. See the named public interfaces in `contracts/interfaces.ts`; do not invent a second incompatible contract.

**Produces:** The file-owned component described in the implementation steps and a registered `AT-010` scenario returning `ScenarioObservation`. Later tasks consume the same versioned boundaries, not private provider runtime files.

- [ ] **1. Prepare the exact fixture.** First use recorded protocol fixtures. Then an explicitly authorized installed Claude account/SDK environment and disposable project for live tests. Credentials remain out of candidate execution.

- [ ] **2. Write the failing acceptance test and real scenario executor.** Register the scenario in `tests/scenarios/T10.scenarios.ts` using the shared registry. Its executor must perform these actions and record observations:
  1. Start, receive tool-result/claim/usage events, pause/cancel, and resume a supported session.
  2. Use available native goal/subagent features with effective permission tests and no recursive orchestration.
  3. Fresh-session load generated native instructions and run a small real task without repeated continue prompts.

```ts
// tests/tasks/T10.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { exerciseScenario } from '../harness/registry.js';
import '../scenarios/T10.scenarios.js';
test('AT-010: Claude official adapter and native entry integration', async () => {
  const result = await exerciseScenario('AT-010');
  assert.equal(result.scenario_id, 'AT-010');
  const expected = {
  "protocol_events_normalized": true,
  "native_instructions_preserved": true,
  "fresh_session_load_observed": true,
  "worker_permission_escape_denied": true,
  "live_resume_verified": true
};
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(result.observed[key], value, key);
  }
  assert.ok(result.artifact_paths.length > 0, 'retain actual evidence');
});
```

- [ ] **3. Run RED.** After T01 installs the approved test dependencies, run:

```bash
node --import tsx --test tests/tasks/T10.test.ts
```

Expected before implementation: FAIL on the named missing behavior, not a forged success report. Record the observed failure. T01 may begin with missing modules while bootstrapping; subsequently replace that with behavioral rejection tests.

- [ ] **4. Implement the smallest complete component.** Use current documented Claude SDK/native extension contracts and pin actual versions. Normalize claims separately from evidence. Reuse native goal/workflow continuation if observed-working, but the controller remains ready/release authority. Propagate cancellation, permission requests, usage and account limits without exposing credentials. Plugin-only limitations and ignored frontmatter fields require tests. Chrome is optional development inspection; protected browser checks remain available separately. Live credentials absent means live tests NOT_RUN, not mocked pass.

```text
for each official streamed event:
  validate event shape and version
  persist session identity before dispatching follow-up
  emit normalized usage/claim/approval/blocker/end events
  never translate text "done" into evidence or ready state
on unsupported event requiring authority: pause safely, retain diagnostic
```
The implementation chooses supported SDK method names after official version inspection, not a fabricated shared SDK method. `ProviderAdapter.start/resume/cancel` are our own facade.

- [ ] **5. Run GREEN and affected regressions.** Repeat the command above, then run `npm run typecheck` and `npm run test:tasks`. All required discovered assertions must execute. When a prerequisite for an unrelated live gate is unavailable, record that task as blocked and report the affected subset accurately; do not make the global test command falsely green. Verify resources and secrets are cleaned up.

- [ ] **6. Review and commit.** Inspect the diff against the requirement IDs, ownership, negative tests, and actual retained evidence. Obtain independent review for security/acceptance policy changes. Stage only this task's intentional changes and commit with a message beginning `T10:`. No approval to deploy is implied. Mark the task complete only after its gate is met.

## T11: Codex official adapter and native entry integration

**Owner:** Codex integration  
**Dependencies:** T04, T09  
**Requirements:** FR-05, FR-06, FR-08, FR-20, FR-21, FR-23, FR-31, NFR-09, NFR-13  
**Gate:** AT-011 (live_provider).

**Files to create or modify:**
- `packages/providers/src/codex.ts`
- `packages/providers/src/normalize.ts`
- `adapters/codex/`
- `tests/scenarios/T11.scenarios.ts`
- `tests/tasks/T11.test.ts`

**Consumes:** The root contract schema/interfaces, approved policy and relevant services delivered by T04, T09. See the named public interfaces in `contracts/interfaces.ts`; do not invent a second incompatible contract.

**Produces:** The file-owned component described in the implementation steps and a registered `AT-011` scenario returning `ScenarioObservation`. Later tasks consume the same versioned boundaries, not private provider runtime files.

- [ ] **1. Prepare the exact fixture.** Use protocol fixtures plus an explicitly authorized installed Codex environment. Select SDK for task threads or a documented stable App Server interface when interactive auth/approval needs it; record exact transport.

- [ ] **2. Write the failing acceptance test and real scenario executor.** Register the scenario in `tests/scenarios/T11.scenarios.ts` using the shared registry. Its executor must perform these actions and record observations:
  1. Start/resume/cancel and normalize real session/thread/usage/error events without raw private state assumptions.
  2. Fresh-session load shared skills via native Codex packaging and test inherited effective permissions.
  3. Execute browser E2E through the configured test runner; prevent a terminal-only session claiming built-in browser vision.

```ts
// tests/tasks/T11.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { exerciseScenario } from '../harness/registry.js';
import '../scenarios/T11.scenarios.js';
test('AT-011: Codex official adapter and native entry integration', async () => {
  const result = await exerciseScenario('AT-011');
  assert.equal(result.scenario_id, 'AT-011');
  const expected = {
  "protocol_events_normalized": true,
  "fresh_session_load_observed": true,
  "inherited_permissions_tested": true,
  "browser_surface_truthful": true,
  "unapproved_provider_fallback_denied": true
};
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(result.observed[key], value, key);
  }
  assert.ok(result.artifact_paths.length > 0, 'retain actual evidence');
});
```

- [ ] **3. Run RED.** After T01 installs the approved test dependencies, run:

```bash
node --import tsx --test tests/tasks/T11.test.ts
```

Expected before implementation: FAIL on the named missing behavior, not a forged success report. Record the observed failure. T01 may begin with missing modules while bootstrapping; subsequently replace that with behavioral rejection tests.

- [ ] **4. Implement the smallest complete component.** Implement the same ProviderAdapter facade with Codex-specific native formats. Keep marketplace/package schemas and agent configuration surfaces separate from Claude. Do not build on internal repository handler names. App Server is not categorically forbidden; qualify the chosen transport/schema and auth scope. Normalize usage without double counting cache components. Native goal is optional capability; completion remains a worker claim until protected verdict. Test where native sandboxes do and do not cover external tools.

```text
Codex event -> normalize into ProviderEvent
thread/session ID -> protected attempt mapping
tool report -> diagnostic observation, not final attestation
account/limit/approval request -> controller policy or client action
terminal end -> candidate sealing/verification, never automatic release
```
Do not copy `.claude-plugin` fields into Codex or assume a plugin agents folder auto-loads arbitrary TOML. Validate the actual installed format.

- [ ] **5. Run GREEN and affected regressions.** Repeat the command above, then run `npm run typecheck` and `npm run test:tasks`. All required discovered assertions must execute. When a prerequisite for an unrelated live gate is unavailable, record that task as blocked and report the affected subset accurately; do not make the global test command falsely green. Verify resources and secrets are cleaned up.

- [ ] **6. Review and commit.** Inspect the diff against the requirement IDs, ownership, negative tests, and actual retained evidence. Obtain independent review for security/acceptance policy changes. Stage only this task's intentional changes and commit with a message beginning `T11:`. No approval to deploy is implied. Mark the task complete only after its gate is met.

## T12: Delivery orchestration, review independence, and context packets

**Owner:** Platform + QA  
**Dependencies:** T02, T03, T04, T07, T10, T11  
**Requirements:** FR-06, FR-07, FR-08, FR-15, FR-18, FR-28, FR-31, NFR-09, NFR-14, FR-37, FR-38, FR-39, FR-43, FR-45  
**Gate:** AT-012 (integration).

**Files to create or modify:**
- `packages/core/src/router.ts`
- `packages/core/src/context.ts`
- `packages/core/src/stack-grounding.ts`
- `packages/core/src/lifecycle.ts`
- `skills/delivery/SKILL.md`
- `skills/debug/SKILL.md`
- `skills/review/SKILL.md`
- `tests/scenarios/T12.scenarios.ts`
- `tests/tasks/T12.test.ts`

**Consumes:** The root contract schema/interfaces, approved policy and relevant services delivered by T02, T03, T04, T07, T10, T11. See the named public interfaces in `contracts/interfaces.ts`; do not invent a second incompatible contract.

**Produces:** The file-owned component described in the implementation steps and a registered `AT-012` scenario returning `ScenarioObservation`. Later tasks consume the same versioned boundaries, not private provider runtime files.

- [ ] **1. Prepare the exact fixture.** Use a controlled multi-module task with one shared API contract, disjoint optional edits, a planted defect, a long unrelated log, and a malicious instruction embedded in source.

- [ ] **2. Write the failing acceptance test and real scenario executor.** Register the scenario in `tests/scenarios/T12.scenarios.ts` using the shared registry. Its executor must perform these actions and record observations:
  1. Let the router choose single versus bounded child work; introduce overlapping edits and out-of-order results.
  2. Give reviewer contract/diff/relevant evidence, excluding author success narrative and unrelated chat; require a reproducible defect.
  3. Trigger repeated failure and context recovery; ensure cancellation prevents late integration.

```ts
// tests/tasks/T12.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { exerciseScenario } from '../harness/registry.js';
import '../scenarios/T12.scenarios.js';
test('AT-012: Delivery orchestration, review independence, and context packets', async () => {
  const result = await exerciseScenario('AT-012');
  assert.equal(result.scenario_id, 'AT-012');
  const expected = {
  "single_integration_owner": true,
  "overlap_and_stale_result_rejected": true,
  "review_finding_has_reproduction": true,
  "untrusted_instructions_not_authority": true,
  "no_recursive_delegation": true,
  "stack_specific_grounding_required": true,
  "unfamiliar_stack_research_not_rejection": true,
  "toolkit_stack_not_forced_on_client": true,
  "relevant_company_responsibilities_assigned": true,
  "manager_title_cannot_elevate_permissions": true,
  "stale_worker_after_new_client_message_rejected": true
};
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(result.observed[key], value, key);
  }
  assert.ok(result.artifact_paths.length > 0, 'retain actual evidence');
});
```


- [ ] **Edition 1.1 cross-stack acceptance.** Dispatch a Kotlin task and an unfamiliar-stack task with task-specific source/version context; require native implementation/review routing without JS conversion, blanket expertise claims or a client-authored skill. Execute the expanded observations in `contracts/acceptance-scenarios.json`; the test dictionary above includes them. Store actual results and native/model evidence, not a hard-coded expected object.

- [ ] **Edition 1.2 review closure.** Maintain the responsibility coverage map and dispatch scoped execution roles. Fence obsolete task attempts when client instructions change the contract; reject their late claims/patches even after a provider cancellation acknowledgement. Coordinator-produced messages cannot be marked as human-origin input. See `docs/DELIVERY_PROTOCOL.md`, `docs/AI_COMPANY_OPERATING_MODEL.md`, and `docs/RELEASE_ACCEPTANCE.md` (repository-root paths). The observations above must come from actual execution.

- [ ] **3. Run RED.** After T01 installs the approved test dependencies, run:

```bash
node --import tsx --test tests/tasks/T12.test.ts
```

Expected before implementation: FAIL on the named missing behavior, not a forged success report. Record the observed failure. T01 may begin with missing modules while bootstrapping; subsequently replace that with behavioral rejection tests.

- [ ] **4. Implement the smallest complete component.** Implement dependency graph execution and a single integration owner. Subagents are leaf jobs, not permanent departments. Handoffs contain source paths/versions, task contract, permitted changes, relevant evidence and bounds. Validate result schemas and observe actual patches. Fresh reviewer context reduces anchoring but does not prove statistical independence. Keep stored knowledge scoped to project/revision; budgets include reviewer calls. Respect native instruction hierarchy instead of replacing it with a giant persona.

```text
scope -> contract -> implement -> seal -> developer diagnostics
      -> independent review when risk warrants
      -> protected final acceptance -> preview
failure -> changed diagnosis -> bounded repair -> NEW seal + acceptance
```
Populate and validate `ProviderContext.engineering_context` for all task jobs. Resolve repository/source/version facts through T03 and T09, persist in the controller-owned fact ledger, and select only the task-relevant specialist context. Before tools execute, resolve each required check ID through T05 and reject missing authorization or target environment. A GROUNDED field is not acceptance authority. Preserve non-JS and unknown-language requests; use first-party evidence for uncertain APIs, never synthesize a version claim.

UI/API interface contract precedes parallel frontend/backend work. Final verification is always on the integrated candidate, not a collection of green branches.

- [ ] **5. Run GREEN and affected regressions.** Repeat the command above, then run `npm run typecheck` and `npm run test:tasks`. All required discovered assertions must execute. When a prerequisite for an unrelated live gate is unavailable, record that task as blocked and report the affected subset accurately; do not make the global test command falsely green. Verify resources and secrets are cleaned up.

- [ ] **6. Review and commit.** Inspect the diff against the requirement IDs, ownership, negative tests, and actual retained evidence. Obtain independent review for security/acceptance policy changes. Stage only this task's intentional changes and commit with a message beginning `T12:`. No approval to deploy is implied. Mark the task complete only after its gate is met.

## Milestone M3 exit
All four task gates must pass at their stated evidence level. Preserve source/contract/policy/version identities and unresolved scope limits. Report completion to the engineering ledger; the quiet client interface only needs a material blocker or working milestone preview. Proceed to the next dependency-ready milestone without asking the client to manage the plan.
