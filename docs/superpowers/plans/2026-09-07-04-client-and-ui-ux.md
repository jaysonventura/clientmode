# Client Mode — Client And Ui Ux Implementation Plan

> **For agentic workers:** Use Superpowers subagent-driven-development or executing-plans when installed; equivalent task-by-task rules are below. Do not require Superpowers as a shipped product dependency. Track checkbox steps and keep one integration owner.

**Goal:** Complete milestone M4, including its executable acceptance gate, as part of the full six-milestone product.

**Architecture:** A local authenticated console exposes ordinary chat, references, feedback, necessary decisions and verified previews. AI-managed requirements and real rendered UI checks drive the complete delivery loop.

**Toolkit Implementation Stack (not the AI team's supported-stack boundary):** Strict TypeScript, maintained pinned Node LTS, npm workspaces; shared JSON Schema, SQLite, official provider interfaces, and a protected test/browser runtime as applicable.

**Spec:** `../../../ENGINEERING_HANDOVER.md`, `../../SECURITY_AND_RELEASE.md`, `../../QUALIFICATION.md`, and `../../../contracts/interfaces.ts`. Paths in task blocks are relative to the product repository root, not this document folder.

## Global constraints
AI engineers must handle the actual client stack across web/backend/mobile/native/systems/data/LLM domains. Follow `docs/AI_ENGINEER_STACK_SCOPE.md` (repository-root path); do not treat the toolkit implementation language or a missing prebuilt profile as a language restriction.

The binding values are: one writer/project; maximum two child jobs; depth one; three repair cycles; default task ceiling1800seconds; default check timeout300seconds. Native account usage and approved API billing are separate. No extra spending, public release, destructive changes, or policy weakening is authorized by this plan. Preserve client business behavior and dirty files. Missing/unsupported checks are UNVERIFIED. Full v1 requires both adapters, quiet console, protected verification, and all eight milestone gates (G1–G8). The client does not maintain Markdown, assign agents, or say continue.

## Execution and test conventions
Create a branch/workspace after inspecting existing changes. Read each task and its acceptance scenario in `contracts/acceptance-scenarios.json`. The product test harness from T01 lives in `tests/harness/registry.ts`. Each task owns `tests/scenarios/TNN.scenarios.ts`, which registers its scenario by exercising the actual production boundary described below; never return the expected dictionary as a substitute for executing it. Test observations are outputs of measured operations. Mock protocol tests must stay explicitly labeled and cannot satisfy live-provider, protected-isolation, or benchmark gates.

The supplied test blocks go in `tests/tasks/TNN.test.ts`. They are future product acceptance tests, **not tests claimed executed by this handoff**. Resolve the declared implementation dependencies before testing. A failing assertion or missing real implementation is a valid red state; missing credentials are a blocked live test, never a skipped green result. After minimal green implementation, refactor, run affected regression/type checks, review actual diff/evidence, and commit. Do not ask the client to approve ordinary task progression.

## T13: Ordinary-language intake and AI-maintained project memory

**Owner:** Product + AI integration  
**Dependencies:** T01, T02, T09, T12  
**Requirements:** FR-01, FR-02, FR-03, FR-04, FR-28, FR-29, FR-31, NFR-08, FR-37, FR-39, FR-44, FR-45  
**Gate:** AT-013 (integration).

**Files to create or modify:**
- `skills/intake/SKILL.md`
- `skills/grounding/SKILL.md`
- `packages/core/src/context.ts`
- `apps/controller/src/routes.ts`
- `tests/scenarios/T13.scenarios.ts`
- `tests/tasks/T13.test.ts`

**Consumes:** The root contract schema/interfaces, approved policy and relevant services delivered by T01, T02, T09, T12. See the named public interfaces in `contracts/interfaces.ts`; do not invent a second incompatible contract.

**Produces:** The file-owned component described in the implementation steps and a registered `AT-013` scenario returning `ScenarioObservation`. Later tasks consume the same versioned boundaries, not private provider runtime files.

- [ ] **1. Prepare the exact fixture.** Use equivalent English/rough-English/Taglish shop briefs, screenshot references with provenance, and an ambiguous payment/stock rule. No client authored Markdown.

- [ ] **2. Write the failing acceptance test and real scenario executor.** Register the scenario in `tests/scenarios/T13.scenarios.ts` using the shared registry. Its executor must perform these actions and record observations:
  1. Create equivalent requirement contracts preserving no-account/no-online-payment exclusions.
  2. Ask exactly the material unresolved business question, but choose reversible technical details internally.
  3. Record client feedback and reopen session with source-linked project facts; attempt cross-project memory retrieval.

```ts
// tests/tasks/T13.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { exerciseScenario } from '../harness/registry.js';
import '../scenarios/T13.scenarios.js';
test('AT-013: Ordinary-language intake and AI-maintained project memory', async () => {
  const result = await exerciseScenario('AT-013');
  assert.equal(result.scenario_id, 'AT-013');
  const expected = {
  "excluded_business_rules_preserved": true,
  "technical_question_count": 0,
  "material_ambiguity_not_invented": true,
  "feedback_revision_incremented": true,
  "cross_project_memory_denied": true,
  "client_stack_intent_preserved": true,
  "no_client_stack_skill_homework": true,
  "material_question_before_candidate_answerable": true,
  "answer_replay_is_idempotent": true,
  "stale_or_cross_project_answer_rejected": true,
  "utf8_text_reference_ingested_inertly": true
};
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(result.observed[key], value, key);
  }
  assert.ok(result.artifact_paths.length > 0, 'retain actual evidence');
});
```


- [ ] **Edition 1.1 cross-stack acceptance.** Interpret rough-English requests for native iOS, Python model service and Java backend, preserving target and business intent; keep missing technical facts as AI investigation work. Execute the expanded observations in `contracts/acceptance-scenarios.json`; the test dictionary above includes them. Store actual results and native/model evidence, not a hard-coded expected object.

- [ ] **Edition 1.2 review closure.** Implement ClientInteractionService with run messages and question answers before a candidate exists. Serve one material question at a time and continue independent safe work. Validate UTF-8 text/Markdown/JSON references, cap size and render inert text. Follow DELIVERY_PROTOCOL for supersession, immutable provenance, and atomic contract revision. See `docs/DELIVERY_PROTOCOL.md`, `docs/AI_COMPANY_OPERATING_MODEL.md`, and `docs/RELEASE_ACCEPTANCE.md` (repository-root paths). The observations above must come from actual execution.

- [ ] **3. Run RED.** After T01 installs the approved test dependencies, run:

```bash
node --import tsx --test tests/tasks/T13.test.ts
```

Expected before implementation: FAIL on the named missing behavior, not a forged success report. Record the observed failure. T01 may begin with missing modules while bootstrapping; subsequently replace that with behavioral rejection tests.

- [ ] **4. Implement the smallest complete component.** Persist original client meaning and attachment IDs, then emit validated Contract with source_message_ids and explicit assumptions. Do not silently turn usability inference into a new business feature. Questions explain consequence and a recommendation in plain language. Generate/update minimal project records automatically; cached facts need version/provenance and invalidation. Do not ingest full transcript/repo every turn. No grammar correction prerequisite and no judgment of client intelligence.

```text
new request -> retained original message
required/excluded outcomes -> source_message_ids
reversible detail -> recorded default, continue
material unresolved rule -> one understandable question or safe deferral
feedback -> new requirement revision -> invalidate impacted acceptance
```
For intent tests use independently authored expected invariants, not the same model's generated self-grading criteria.

- [ ] **5. Run GREEN and affected regressions.** Repeat the command above, then run `npm run typecheck` and `npm run test:tasks`. All required discovered assertions must execute. When a prerequisite for an unrelated live gate is unavailable, record that task as blocked and report the affected subset accurately; do not make the global test command falsely green. Verify resources and secrets are cleaned up.

- [ ] **6. Review and commit.** Inspect the diff against the requirement IDs, ownership, negative tests, and actual retained evidence. Obtain independent review for security/acceptance policy changes. Stage only this task's intentional changes and commit with a message beginning `T13:`. No approval to deploy is implied. Mark the task complete only after its gate is met.

## T14: Design workflow, assets, accessibility, and independent UX review

**Owner:** UX + Frontend + QA  
**Dependencies:** T06, T13  
**Requirements:** FR-09, FR-10, FR-29, FR-33, FR-35, NFR-05, NFR-11, FR-40, FR-43  
**Gate:** AT-014 (integration).

**Files to create or modify:**
- `skills/ui-ux/SKILL.md`
- `packages/browser/src/visual.ts`
- `packages/browser/src/accessibility.ts`
- `profiles/web-typescript/design-contract.json`
- `tests/scenarios/T14.scenarios.ts`
- `tests/tasks/T14.test.ts`

**Consumes:** The root contract schema/interfaces, approved policy and relevant services delivered by T06, T13. See the named public interfaces in `contracts/interfaces.ts`; do not invent a second incompatible contract.

**Produces:** The file-owned component described in the implementation steps and a registered `AT-014` scenario returning `ScenarioObservation`. Later tasks consume the same versioned boundaries, not private provider runtime files.

- [ ] **1. Prepare the exact fixture.** Use a reference screenshot or choose a coherent original direction for the disposable shop. Provide narrow viewport, long labels, empty state, API error and reduced-motion fixtures.

- [ ] **2. Write the failing acceptance test and real scenario executor.** Register the scenario in `tests/scenarios/T14.scenarios.ts` using the shared registry. Its executor must perform these actions and record observations:
  1. Create a shared typography/spacing/color/component system and implement real navigation and forms.
  2. Inspect actual screenshots and keyboard/touch-equivalent interactions at declared viewports, 200%zoom and error/loading/empty states.
  3. Give feedback "too crowded" and check hierarchy improves without changing checkout rules; document real asset licenses.

```ts
// tests/tasks/T14.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { exerciseScenario } from '../harness/registry.js';
import '../scenarios/T14.scenarios.js';
test('AT-014: Design workflow, assets, accessibility, and independent UX review', async () => {
  const result = await exerciseScenario('AT-014');
  assert.equal(result.scenario_id, 'AT-014');
  const expected = {
  "design_system_applied": true,
  "primary_journey_operable": true,
  "error_empty_loading_states_present": true,
  "feedback_preserves_business_rules": true,
  "asset_provenance_recorded": true,
  "human_taste_not_auto_claimed": true,
  "native_ux_not_replaced_by_web": true,
  "ui_and_ux_responsibilities_have_observed_outputs": true
};
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(result.observed[key], value, key);
  }
  assert.ok(result.artifact_paths.length > 0, 'retain actual evidence');
});
```


- [ ] **Edition 1.1 cross-stack acceptance.** Use native mobile UX and platform accessibility/lifecycle scenarios for a requested native application; do not return a responsive webpage as the native deliverable. Execute the expanded observations in `contracts/acceptance-scenarios.json`; the test dictionary above includes them. Store actual results and native/model evidence, not a hard-coded expected object.

- [ ] **Edition 1.2 review closure.** Record UX journeys/design decisions and actual platform-specific UI observations; these may share a worker for small tasks, but significant designs receive an independent scoped review. No invented user-research or satisfaction record. See `docs/DELIVERY_PROTOCOL.md`, `docs/AI_COMPANY_OPERATING_MODEL.md`, and `docs/RELEASE_ACCEPTANCE.md` (repository-root paths). The observations above must come from actual execution.

- [ ] **3. Run RED.** After T01 installs the approved test dependencies, run:

```bash
node --import tsx --test tests/tasks/T14.test.ts
```

Expected before implementation: FAIL on the named missing behavior, not a forged success report. Record the observed failure. T01 may begin with missing modules while bootstrapping; subsequently replace that with behavioral rejection tests.

- [ ] **4. Implement the smallest complete component.** Treat UI/UX as full delivery responsibility, not CSS decoration. Define hierarchy, primary action, mobile layout, focus, contrast, error copy and assistive labels. Use genuine assets with provenance or authored placeholders clearly disclosed; do not copy protected designs or claim generated previews are production photos. Pair external automated probes with independent UX checklist/manual keyboard/screen-reader scope. Subjective client satisfaction requires actual feedback; never let model vote certify it.

```text
design contract:
  audience, journey, visual direction, tokens, components
  responsive boundaries, interaction states, accessibility expectations
verification:
  rendered candidate + screenshots + journey observations + UX findings
client feedback:
  revise presentation; preserve approved behavior; rerun affected gates
```
Visual regression baselines must be reviewed and keyed by environment. Automatically updating the baseline after every failed comparison defeats the gate.

- [ ] **5. Run GREEN and affected regressions.** Repeat the command above, then run `npm run typecheck` and `npm run test:tasks`. All required discovered assertions must execute. When a prerequisite for an unrelated live gate is unavailable, record that task as blocked and report the affected subset accurately; do not make the global test command falsely green. Verify resources and secrets are cleaned up.

- [ ] **6. Review and commit.** Inspect the diff against the requirement IDs, ownership, negative tests, and actual retained evidence. Obtain independent review for security/acceptance policy changes. Stage only this task's intentional changes and commit with a message beginning `T14:`. No approval to deploy is implied. Mark the task complete only after its gate is met.

## T15: Quiet client console, local API, event replay, and accessibility

**Owner:** Frontend + Platform  
**Dependencies:** T02, T08, T13, T14  
**Requirements:** FR-19, FR-21, FR-35, NFR-04, NFR-05, NFR-08, NFR-11, FR-44, FR-45  
**Gate:** AT-015 (integration).

**Files to create or modify:**
- `apps/controller/src/server.ts`
- `apps/controller/src/routes.ts`
- `apps/controller/src/events.ts`
- `apps/console/src/app/App.tsx`
- `apps/console/src/features/RunView.tsx`
- `apps/console/src/styles/tokens.css`
- `tests/scenarios/T15.scenarios.ts`
- `tests/tasks/T15.test.ts`

**Consumes:** The root contract schema/interfaces, approved policy and relevant services delivered by T02, T08, T13, T14. See the named public interfaces in `contracts/interfaces.ts`; do not invent a second incompatible contract.

**Produces:** The file-owned component described in the implementation steps and a registered `AT-015` scenario returning `ScenarioObservation`. Later tasks consume the same versioned boundaries, not private provider runtime files.

- [ ] **1. Prepare the exact fixture.** Start the loopback controller and React client with authenticated test session. Use long-running fake provider and disconnected/reconnected event stream. No paid model call needed for console tests.

- [ ] **2. Write the failing acceptance test and real scenario executor.** Register the scenario in `tests/scenarios/T15.scenarios.ts` using the shared registry. Its executor must perform these actions and record observations:
  1. Submit an ordinary request and attach reference; keep input/cancel controls responsive while jobs run.
  2. Stream internal steps and one material blocker; inspect normal client-visible message list and optional diagnostic drawer.
  3. Reconnect SSE from a known event sequence, verify ordering and test invalid origin/worker approval attempt.

```ts
// tests/tasks/T15.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { exerciseScenario } from '../harness/registry.js';
import '../scenarios/T15.scenarios.js';
test('AT-015: Quiet client console, local API, event replay, and accessibility', async () => {
  const result = await exerciseScenario('AT-015');
  assert.equal(result.scenario_id, 'AT-015');
  const expected = {
  "routine_narrative_messages": 0,
  "material_blocker_visible": true,
  "cancel_control_responsive": true,
  "event_replay_no_gaps_or_duplicates": true,
  "keyboard_primary_actions_operable": true,
  "cross_origin_mutations_denied": true,
  "answer_and_active_message_flow_without_candidate": true,
  "one_open_question_visible_per_run": true,
  "text_reference_html_is_not_executed": true
};
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(result.observed[key], value, key);
  }
  assert.ok(result.artifact_paths.length > 0, 'retain actual evidence');
});
```

- [ ] **Edition 1.2 review closure.** Implement GET questions, POST answer, and POST active message from the OpenAPI contract. Distinguish answer requests from permission/release cards. New input stays responsive during model work; render untrusted text as text and reject cross-origin/model-origin decisions. See `docs/DELIVERY_PROTOCOL.md`, `docs/AI_COMPANY_OPERATING_MODEL.md`, and `docs/RELEASE_ACCEPTANCE.md` (repository-root paths). The observations above must come from actual execution.

- [ ] **3. Run RED.** After T01 installs the approved test dependencies, run:

```bash
node --import tsx --test tests/tasks/T15.test.ts
```

Expected before implementation: FAIL on the named missing behavior, not a forged success report. Record the observed failure. T01 may begin with missing modules while bootstrapping; subsequently replace that with behavioral rejection tests.

- [ ] **4. Implement the smallest complete component.** Implement contracts/api.openapi.json with runtime validation, structured errors, request IDs, idempotency and If-Match concurrency. Console shows chat/input, compact run status, pause/cancel, verified preview, feedback and necessary approvals. Detailed events live in a collapsed engineering view. Do not stream model rationale or secrets into normal UI. Use nonblocking jobs and accessible focus/announcements. Default origin whitelist, authenticated loopback session, strict cookies/CSRF; no public hosting.

```text
visible event kinds = material_question | approval_required | blocked | final_result
internal event kinds = trace | tool | worker | plan | intermediate_check | usage
pause/cancel are always client controls, independent of provider text stream
SSE reconnect sends last event ID; server replays durable outbox in sequence
```
Load-test metadata API separately from model latency. Publish declared reference hardware and sample counts rather than claiming universal response times.

- [ ] **5. Run GREEN and affected regressions.** Repeat the command above, then run `npm run typecheck` and `npm run test:tasks`. All required discovered assertions must execute. When a prerequisite for an unrelated live gate is unavailable, record that task as blocked and report the affected subset accurately; do not make the global test command falsely green. Verify resources and secrets are cleaned up.

- [ ] **6. Review and commit.** Inspect the diff against the requirement IDs, ownership, negative tests, and actual retained evidence. Obtain independent review for security/acceptance policy changes. Stage only this task's intentional changes and commit with a message beginning `T15:`. No approval to deploy is implied. Mark the task complete only after its gate is met.

## T16: Complete delivery loop, preview handoff, feedback, and resumption

**Owner:** Full-stack + QA  
**Dependencies:** T07, T08, T12, T13, T14, T15  
**Requirements:** FR-08, FR-10, FR-12, FR-16, FR-19, FR-25, FR-29, FR-33, NFR-01, NFR-06, NFR-08, FR-40, FR-41, FR-43, FR-44, FR-45  
**Gate:** AT-016 (live_provider).

**Files to create or modify:**
- `packages/core/src/lifecycle.ts`
- `skills/verify/SKILL.md`
- `skills/handoff/SKILL.md`
- `apps/console/src/features/Preview.tsx`
- `tests/scenarios/T16.scenarios.ts`
- `tests/tasks/T16.test.ts`

**Consumes:** The root contract schema/interfaces, approved policy and relevant services delivered by T07, T08, T12, T13, T14, T15. See the named public interfaces in `contracts/interfaces.ts`; do not invent a second incompatible contract.

**Produces:** The file-owned component described in the implementation steps and a registered `AT-016` scenario returning `ScenarioObservation`. Later tasks consume the same versioned boundaries, not private provider runtime files.

- [ ] **1. Prepare the exact fixture.** Use a qualified provider against the disposable shop, a protected runner, actual browser, and controller console. No production deployment. This is an end-to-end live qualification gate.

- [ ] **2. Write the failing acceptance test and real scenario executor.** Register the scenario in `tests/scenarios/T16.scenarios.ts` using the shared registry. Its executor must perform these actions and record observations:
  1. Submit rough-English brief once; run design→build→real tests→review→repair→final acceptance with no manual engineering prompts.
  2. Interrupt during work and resume from durable state; submit simple design feedback after first verified preview.
  3. Remove required integration credentials and test honest blocked status rather than a mock labeled live.

```ts
// tests/tasks/T16.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { exerciseScenario } from '../harness/registry.js';
import '../scenarios/T16.scenarios.js';
test('AT-016: Complete delivery loop, preview handoff, feedback, and resumption', async () => {
  const result = await exerciseScenario('AT-016');
  assert.equal(result.scenario_id, 'AT-016');
  const expected = {
  "routine_continue_prompts": 0,
  "preview_bound_to_verified_candidate": true,
  "feedback_new_candidate_verified": true,
  "resume_without_repeating_brief": true,
  "missing_integration_not_reported_live": true,
  "cross_stack_integrated_verification_required": true,
  "affected_gap_visible_without_blanket_stop": true,
  "client_feedback_not_self_certified": true,
  "new_requirement_during_verify_invalidates_ready": true,
  "recovery_returns_to_correct_phase": true
};
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(result.observed[key], value, key);
  }
  assert.ok(result.artifact_paths.length > 0, 'retain actual evidence');
});
```


- [ ] **Edition 1.1 cross-stack acceptance.** Complete cross-stack delivery with component-level and integrated evidence; withhold one required native/model check and ensure the entire requested scope is not marked ready while independent safe work can continue. Execute the expanded observations in `contracts/acceptance-scenarios.json`; the test dictionary above includes them. Store actual results and native/model evidence, not a hard-coded expected object.

- [ ] **Edition 1.2 review closure.** Exercise precontract questions, new instructions while running/verifying, and feedback after preview. Restore the correct phase after interruption, invalidate obsolete candidates and approvals, and keep satisfaction exclusively client-authored. See `docs/DELIVERY_PROTOCOL.md`, `docs/AI_COMPANY_OPERATING_MODEL.md`, and `docs/RELEASE_ACCEPTANCE.md` (repository-root paths). The observations above must come from actual execution.

- [ ] **3. Run RED.** After T01 installs the approved test dependencies, run:

```bash
node --import tsx --test tests/tasks/T16.test.ts
```

Expected before implementation: FAIL on the named missing behavior, not a forged success report. Record the observed failure. T01 may begin with missing modules while bootstrapping; subsequently replace that with behavioral rejection tests.

- [ ] **4. Implement the smallest complete component.** Wire completed services end-to-end. Request acceptance automatically after coherent candidates; successful worker turns do not end delivery. A verification failure enters bounded diagnosis/repair with fresh snapshot. Return only working preview/artifact, scope and material limits; do not fabricate URL. Persist client satisfaction separately, awaiting real feedback. A stopped host is not working in the background. Deployment remains separately approved.

```text
ready message (populated from protected state, not arbitrary model fields):
  Ready for your review: verified preview
  Built: completed agreed outcomes
  Not verified: actual material gaps
  Decision: only a required client action
```
Suppress empty routine sections. The console must not hide a missing required check merely because the client asked for fewer reports.

- [ ] **5. Run GREEN and affected regressions.** Repeat the command above, then run `npm run typecheck` and `npm run test:tasks`. All required discovered assertions must execute. When a prerequisite for an unrelated live gate is unavailable, record that task as blocked and report the affected subset accurately; do not make the global test command falsely green. Verify resources and secrets are cleaned up.

- [ ] **6. Review and commit.** Inspect the diff against the requirement IDs, ownership, negative tests, and actual retained evidence. Obtain independent review for security/acceptance policy changes. Stage only this task's intentional changes and commit with a message beginning `T16:`. No approval to deploy is implied. Mark the task complete only after its gate is met.

## Milestone M4 exit
All four task gates must pass at their stated evidence level. Preserve source/contract/policy/version identities and unresolved scope limits. Report completion to the engineering ledger; the quiet client interface only needs a material blocker or working milestone preview. Proceed to the next dependency-ready milestone without asking the client to manage the plan.
