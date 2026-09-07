# Client Mode — Protected Verification Implementation Plan

> **For agentic workers:** Use Superpowers subagent-driven-development or executing-plans when installed; equivalent task-by-task rules are below. Do not require Superpowers as a shipped product dependency. Track checkbox steps and keep one integration owner.

**Goal:** Complete milestone M2, including its executable acceptance gate, as part of the full six-milestone product.

**Architecture:** A separate protected acceptance coordinator runs untrusted builds in sandboxes and external browser/API probes under separate authority. Authenticated evidence and artifact-bound approvals control readiness and release.

**Toolkit Implementation Stack (not the AI team's supported-stack boundary):** Strict TypeScript, maintained pinned Node LTS, npm workspaces; shared JSON Schema, SQLite, official provider interfaces, and a protected test/browser runtime as applicable.

**Spec:** `../../../ENGINEERING_HANDOVER.md`, `../../SECURITY_AND_RELEASE.md`, `../../QUALIFICATION.md`, and `../../../contracts/interfaces.ts`. Paths in task blocks are relative to the product repository root, not this document folder.

## Global constraints
AI engineers must handle the actual client stack across web/backend/mobile/native/systems/data/LLM domains. Follow `docs/AI_ENGINEER_STACK_SCOPE.md` (repository-root path); do not treat the toolkit implementation language or a missing prebuilt profile as a language restriction.

The binding values are: one writer/project; maximum two child jobs; depth one; three repair cycles; default task ceiling1800seconds; default check timeout300seconds. Native account usage and approved API billing are separate. No extra spending, public release, destructive changes, or policy weakening is authorized by this plan. Preserve client business behavior and dirty files. Missing/unsupported checks are UNVERIFIED. Full v1 requires both adapters, quiet console, protected verification, and all eight milestone gates (G1–G8). The client does not maintain Markdown, assign agents, or say continue.

## Execution and test conventions
Create a branch/workspace after inspecting existing changes. Read each task and its acceptance scenario in `contracts/acceptance-scenarios.json`. The product test harness from T01 lives in `tests/harness/registry.ts`. Each task owns `tests/scenarios/TNN.scenarios.ts`, which registers its scenario by exercising the actual production boundary described below; never return the expected dictionary as a substitute for executing it. Test observations are outputs of measured operations. Mock protocol tests must stay explicitly labeled and cannot satisfy live-provider, protected-isolation, or benchmark gates.

The supplied test blocks go in `tests/tasks/TNN.test.ts`. They are future product acceptance tests, **not tests claimed executed by this handoff**. Resolve the declared implementation dependencies before testing. A failing assertion or missing real implementation is a valid red state; missing credentials are a blocked live test, never a skipped green result. After minimal green implementation, refactor, run affected regression/type checks, review actual diff/evidence, and commit. Do not ask the client to approve ordinary task progression.

## T05: Protected check registry and untrusted execution sandbox

**Owner:** Security + QA  
**Dependencies:** T01, T03, T04  
**Requirements:** FR-11, FR-14, FR-26, FR-32, NFR-01, NFR-02, NFR-10, FR-40  
**Gate:** AT-005 (integration).

**Files to create or modify:**
- `packages/verifier/src/policy.ts`
- `packages/verifier/src/executor.ts`
- `packages/verifier/src/parsers.ts`
- `packages/verifier/src/coordinator.ts`
- `tests/scenarios/T05.scenarios.ts`
- `tests/tasks/T05.test.ts`

**Consumes:** The root contract schema/interfaces, approved policy and relevant services delivered by T01, T03, T04. See the named public interfaces in `contracts/interfaces.ts`; do not invent a second incompatible contract.

**Produces:** The file-owned component described in the implementation steps and a registered `AT-005` scenario returning `ScenarioObservation`. Later tasks consume the same versioned boundaries, not private provider runtime files.

- [ ] **1. Prepare the exact fixture.** Use a Linux isolated acceptance service with separate principals, a disposable runtime, a secret canary outside the worker, and a controller-owned approved command registry.

- [ ] **2. Write the failing acceptance test and real scenario executor.** Register the scenario in `tests/scenarios/T05.scenarios.ts` using the shared registry. Its executor must perform these actions and record observations:
  1. Request a known check ID then an unknown ID and a worker-supplied arbitrary argv.
  2. Execute a malicious fixture attempting host-home/secret/signing-key/socket access and another that hangs/forks or floods output.
  3. Run an exit-zero process with a missing/malformed test report and a changed parser version.

```ts
// tests/tasks/T05.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { exerciseScenario } from '../harness/registry.js';
import '../scenarios/T05.scenarios.js';
test('AT-005: Protected check registry and untrusted execution sandbox', async () => {
  const result = await exerciseScenario('AT-005');
  assert.equal(result.scenario_id, 'AT-005');
  const expected = {
  "unknown_check_rejected": true,
  "arbitrary_command_rejected": true,
  "secret_and_socket_access_denied": true,
  "timeout_tree_terminated_or_quarantined": true,
  "malformed_report_unverified": true,
  "missing_target_environment_not_passed": true
};
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(result.observed[key], value, key);
  }
  assert.ok(result.artifact_paths.length > 0, 'retain actual evidence');
});
```


- [ ] **Edition 1.1 cross-stack acceptance.** Request a native check without its required environment and a model evaluation without authorized model/data access; they must remain unverified, not execute a substitute web test. Execute the expanded observations in `contracts/acceptance-scenarios.json`; the test dictionary above includes them. Store actual results and native/model evidence, not a hard-coded expected object.

- [ ] **3. Run RED.** After T01 installs the approved test dependencies, run:

```bash
node --import tsx --test tests/tasks/T05.test.ts
```

Expected before implementation: FAIL on the named missing behavior, not a forged success report. Record the observed failure. T01 may begin with missing modules while bootstrapping; subsequently replace that with behavioral rejection tests.

- [ ] **4. Implement the smallest complete component.** VerificationService resolves check IDs to ProtectedExecutionDefinition under a protected policy version. Run argv with shell:false inside tested process/network/filesystem limits; argv safety alone is insufficient. Separate coordinator from candidate installation/build/runtime. Never mount host sockets, provider credentials, or signing keys. Cap output and process resources; kill process tree on deadline or quarantine with failed status. Record real exit, parser version, fixture/image digest and report provenance. No untrusted imports in the coordinator process.

```text
request(check_id, candidate_id):
  resolve immutable candidate and protected definition
  create disposable sandbox with explicit network/environment profile
  execute definition.argv in definition.cwd_relative, never caller argv
  enforce deadline/resource/output limits and retain observed termination
  parse schema-valid evidence; fail closed on absent/invalid report
```
Tests must attempt effective forbidden operations. A different directory or a role called read-only cannot satisfy this task.

- [ ] **5. Run GREEN and affected regressions.** Repeat the command above, then run `npm run typecheck` and `npm run test:tasks`. All required discovered assertions must execute. When a prerequisite for an unrelated live gate is unavailable, record that task as blocked and report the affected subset accurately; do not make the global test command falsely green. Verify resources and secrets are cleaned up.

- [ ] **6. Review and commit.** Inspect the diff against the requirement IDs, ownership, negative tests, and actual retained evidence. Obtain independent review for security/acceptance policy changes. Stage only this task's intentional changes and commit with a message beginning `T05:`. No approval to deploy is implied. Mark the task complete only after its gate is met.

## T06: External browser/API probes and real qualification application

**Owner:** QA + Full-stack  
**Dependencies:** T03, T05  
**Requirements:** FR-09, FR-10, FR-11, FR-33, NFR-01, NFR-11, FR-40  
**Gate:** AT-006 (integration).

**Files to create or modify:**
- `packages/browser/src/journeys.ts`
- `packages/browser/src/visual.ts`
- `packages/browser/src/accessibility.ts`
- `packages/browser/src/artifacts.ts`
- `profiles/web-typescript/checks.json`
- `packages/verification-targets/src/resolve.ts`
- `packages/verification-targets/src/native-ui.ts`
- `packages/verification-targets/src/model-evals.ts`
- `packages/verification-targets/src/composite.ts`
- `fixtures/shop/`
- `tests/scenarios/T06.scenarios.ts`
- `tests/tasks/T06.test.ts`

**Consumes:** The root contract schema/interfaces, approved policy and relevant services delivered by T03, T05. See the named public interfaces in `contracts/interfaces.ts`; do not invent a second incompatible contract.

**Produces:** The file-owned component described in the implementation steps and a registered `AT-006` scenario returning `ScenarioObservation`. Later tasks consume the same versioned boundaries, not private provider runtime files.

- [ ] **1. Prepare the exact fixture.** Build the disposable real shop specified in QUALIFICATION.md with persistent synthetic data and server-side prices. Install locked browser binaries. Probes run outside candidate authority.

- [ ] **2. Write the failing acceptance test and real scenario executor.** Register the scenario in `tests/scenarios/T06.scenarios.ts` using the shared registry. Its executor must perform these actions and record observations:
  1. Complete guest checkout with 2 rice at5500 and1 soap at2500; restart API and inspect persisted order.
  2. Send negative quantity, quantity100, unknown product and attacker-selected price; retry same idempotency key.
  3. Run mobile/desktop/keyboard journeys, remove label or hide submit, and introduce horizontal overflow.

```ts
// tests/tasks/T06.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { exerciseScenario } from '../harness/registry.js';
import '../scenarios/T06.scenarios.js';
test('AT-006: External browser/API probes and real qualification application', async () => {
  const result = await exerciseScenario('AT-006');
  assert.equal(result.scenario_id, 'AT-006');
  const expected = {
  "total_centavos": 13500,
  "persisted_orders_after_retry": 1,
  "invalid_requests_rejected": true,
  "guest_checkout_completed": true,
  "ui_mutations_detected": true,
  "external_probe_results_not_candidate_writable": true,
  "target_native_checks_executed": true,
  "native_and_model_defects_rejected": true
};
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(result.observed[key], value, key);
  }
  assert.ok(result.artifact_paths.length > 0, 'retain actual evidence');
});
```


- [ ] **Edition 1.1 cross-stack acceptance.** In the qualification matrix, run a real non-JS service check, native app interaction and model evaluation using their target tooling; inject a platform defect and an ungrounded model answer and require rejection. Execute the expanded observations in `contracts/acceptance-scenarios.json`; the test dictionary above includes them. Store actual results and native/model evidence, not a hard-coded expected object.

- [ ] **3. Run RED.** After T01 installs the approved test dependencies, run:

```bash
node --import tsx --test tests/tasks/T06.test.ts
```

Expected before implementation: FAIL on the named missing behavior, not a forged success report. Record the observed failure. T01 may begin with missing modules while bootstrapping; subsequently replace that with behavioral rejection tests.

- [ ] **4. Implement the smallest complete component.** Use real browser/API interactions under the protected runner. Adopt project test tools where present; qualify the web profile through Playwright and a maintained accessibility checker. Check viewports360,390,768,1440 CSS px, focus order, zoom, loading/error/empty and console exceptions. Visual thresholds need stable fonts/browser/viewport plus independent UX review; screenshot existence is not success. Staging fixtures must distinguish mocked/sandbox/live integration. Do not claim native mobile device or real user research from browser emulation.

```ts
// Example protected browser assertion in the product probe suite.
import { test, expect } from '@playwright/test';
test('mobile layout fits', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible();
  const fits = await page.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
  expect(fits).toBe(true);
});
```
Configure `baseURL` to the exact candidate sandbox address. A browser setup failure is UNVERIFIED, never an inferred pass.

- [ ] **5. Run GREEN and affected regressions.** Repeat the command above, then run `npm run typecheck` and `npm run test:tasks`. All required discovered assertions must execute. When a prerequisite for an unrelated live gate is unavailable, record that task as blocked and report the affected subset accurately; do not make the global test command falsely green. Verify resources and secrets are cleaned up.

- [ ] **6. Review and commit.** Inspect the diff against the requirement IDs, ownership, negative tests, and actual retained evidence. Obtain independent review for security/acceptance policy changes. Stage only this task's intentional changes and commit with a message beginning `T06:`. No approval to deploy is implied. Mark the task complete only after its gate is met.

## T07: Authenticated evidence and candidate-bound readiness

**Owner:** Security + QA  
**Dependencies:** T01, T02, T05, T06  
**Requirements:** FR-13, FR-14, FR-15, FR-16, FR-32, FR-34, NFR-01, NFR-02, FR-41  
**Gate:** AT-007 (integration).

**Files to create or modify:**
- `packages/verifier/src/evidence.ts`
- `packages/verifier/src/verdict.ts`
- `packages/release/src/attestation.ts`
- `tests/scenarios/T07.scenarios.ts`
- `tests/tasks/T07.test.ts`

**Consumes:** The root contract schema/interfaces, approved policy and relevant services delivered by T01, T02, T05, T06. See the named public interfaces in `contracts/interfaces.ts`; do not invent a second incompatible contract.

**Produces:** The file-owned component described in the implementation steps and a registered `AT-007` scenario returning `ScenarioObservation`. Later tasks consume the same versioned boundaries, not private provider runtime files.

- [ ] **1. Prepare the exact fixture.** Use ephemeral test keys in separate verifier authority and immutable candidate artifacts. Port the reference rules into the product after runtime schema validation. Never deploy the reference as the whole verifier.

- [ ] **2. Write the failing acceptance test and real scenario executor.** Register the scenario in `tests/scenarios/T07.scenarios.ts` using the shared registry. Its executor must perform these actions and record observations:
  1. Verify clean candidate, then alter source/artifact/policy/revision/environment or replay old attempt evidence.
  2. Tamper signed payload, use an untrusted/revoked key, duplicate a result, skip or remove tests, and submit fake PASS text.
  3. Ask an implementation token to write ready state or sign arbitrary JSON.

```ts
// tests/tasks/T07.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { exerciseScenario } from '../harness/registry.js';
import '../scenarios/T07.scenarios.js';
test('AT-007: Authenticated evidence and candidate-bound readiness', async () => {
  const result = await exerciseScenario('AT-007');
  assert.equal(result.scenario_id, 'AT-007');
  const expected = {
  "clean_candidate_verified": true,
  "stale_or_forged_evidence_rejected": true,
  "missing_or_skipped_checks_rejected": true,
  "worker_ready_write_denied": true,
  "worker_signing_denied": true,
  "partial_polyglot_evidence_rejected": true,
  "changed_native_or_model_artifact_invalidates_evidence": true
};
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(result.observed[key], value, key);
  }
  assert.ok(result.artifact_paths.length > 0, 'retain actual evidence');
});
```


- [ ] **Edition 1.1 cross-stack acceptance.** Submit evidence for the web component only against a contract also requiring native and model components; then alter a model revision or native binary in the composite manifest. Execute the expanded observations in `contracts/acceptance-scenarios.json`; the test dictionary above includes them. Store actual results and native/model evidence, not a hard-coded expected object.

- [ ] **3. Run RED.** After T01 installs the approved test dependencies, run:

```bash
node --import tsx --test tests/tasks/T07.test.ts
```

Expected before implementation: FAIL on the named missing behavior, not a forged success report. Record the observed failure. T01 may begin with missing modules while bootstrapping; subsequently replace that with behavioral rejection tests.

- [ ] **4. Implement the smallest complete component.** Validate SignedEnvelope and exact payload bytes; trust public keys only from protected configuration with rotation/revocation. Sign after collecting trusted observer output, not through a generic worker signing tool. Match candidate/run/project/attempt, all digests, requirement revision, check definition coverage, timestamps and blocking findings. Use the lifecycle state transaction to accept only the current lease/candidate. No policy waiver after failure; separate reviewed policy revision and rerun.

```text
ready = valid_signature AND trusted_current_issuer
        AND current_project_run_attempt_candidate
        AND matching_source_artifact_policy_environment_revision
        AND every_required_check_executed_and_passed
        AND expected_assertions_and_test_discovery
        AND no_skips_or_blocking_findings
```
Execute every case in `tests/reference.test.mjs` against product boundary tests too. Then add actual sandbox attacks; pure predicate tests do not prove isolation or truth of observations.

- [ ] **5. Run GREEN and affected regressions.** Repeat the command above, then run `npm run typecheck` and `npm run test:tasks`. All required discovered assertions must execute. When a prerequisite for an unrelated live gate is unavailable, record that task as blocked and report the affected subset accurately; do not make the global test command falsely green. Verify resources and secrets are cleaned up.

- [ ] **6. Review and commit.** Inspect the diff against the requirement IDs, ownership, negative tests, and actual retained evidence. Obtain independent review for security/acceptance policy changes. Stage only this task's intentional changes and commit with a message beginning `T07:`. No approval to deploy is implied. Mark the task complete only after its gate is met.

## T08: Client authentication, scoped approvals, and release consumption

**Owner:** Security + Release  
**Dependencies:** T02, T04, T07  
**Requirements:** FR-17, FR-25, FR-26, FR-32, NFR-02, NFR-03, NFR-10, FR-44  
**Gate:** AT-008 (integration).

**Files to create or modify:**
- `apps/controller/src/auth.ts`
- `packages/release/src/approvals.ts`
- `packages/release/src/deploy.ts`
- `packages/release/src/smoke.ts`
- `packages/release/src/rollback.ts`
- `tests/scenarios/T08.scenarios.ts`
- `tests/tasks/T08.test.ts`

**Consumes:** The root contract schema/interfaces, approved policy and relevant services delivered by T02, T04, T07. See the named public interfaces in `contracts/interfaces.ts`; do not invent a second incompatible contract.

**Produces:** The file-owned component described in the implementation steps and a registered `AT-008` scenario returning `ScenarioObservation`. Later tasks consume the same versioned boundaries, not private provider runtime files.

- [ ] **1. Prepare the exact fixture.** Use a local authenticated client session, separate worker token, fixed clock, and mock deployment destination that records calls. No production credentials.

- [ ] **2. Write the failing acceptance test and real scenario executor.** Register the scenario in `tests/scenarios/T08.scenarios.ts` using the shared registry. Its executor must perform these actions and record observations:
  1. Attempt approval from a worker, invalid origin, and stale/absent CSRF token.
  2. Approve exact candidate/environment once; replay, expire or substitute artifact before deployment.
  3. Crash after deployment request, then reconcile destination before retry; simulate failed smoke and an authorized rollback.

```ts
// tests/tasks/T08.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { exerciseScenario } from '../harness/registry.js';
import '../scenarios/T08.scenarios.js';
test('AT-008: Client authentication, scoped approvals, and release consumption', async () => {
  const result = await exerciseScenario('AT-008');
  assert.equal(result.scenario_id, 'AT-008');
  const expected = {
  "worker_and_cross_origin_approval_denied": true,
  "replayed_or_wrong_artifact_approval_denied": true,
  "deployment_side_effect_count": 1,
  "failed_smoke_not_released": true,
  "rollback_requires_and_records_authority": true,
  "question_answer_never_grants_release_authority": true
};
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(result.observed[key], value, key);
  }
  assert.ok(result.artifact_paths.length > 0, 'retain actual evidence');
});
```

- [ ] **Edition 1.2 review closure.** Keep ClientAnswer and ApprovalDecision in separate endpoints and service methods. Bind a question answer to authenticated client, run/project, question revision and idempotency key. A business answer must never create a release/spending grant. See `docs/DELIVERY_PROTOCOL.md`, `docs/AI_COMPANY_OPERATING_MODEL.md`, and `docs/RELEASE_ACCEPTANCE.md` (repository-root paths). The observations above must come from actual execution.

- [ ] **3. Run RED.** After T01 installs the approved test dependencies, run:

```bash
node --import tsx --test tests/tasks/T08.test.ts
```

Expected before implementation: FAIL on the named missing behavior, not a forged success report. Record the observed failure. T01 may begin with missing modules while bootstrapping; subsequently replace that with behavioral rejection tests.

- [ ] **4. Implement the smallest complete component.** Client identity comes from authenticated browser/IPC session. Bind approval to action, project, artifact, environment, policy, expiry, nonce, and optional spend. Consume once in transaction and use provider-side idempotency/reconciliation; do not promise network exactly-once. Issue HttpOnly SameSite session cookies, origin checks, CSRF and short TTL. Loopback HTTP constraints must be tested; do not claim a Secure cookie works on arbitrary HTTP. V1 is not public multi-tenant service. Release service owns keys; no arbitrary candidate deploy script under credentials.

```text
deploy(approval_id, candidate_id, target):
  authenticate client-approved authority from protected store
  match scope/expiry/artifact/policy and final verified evidence
  atomically reserve/consume nonce with idempotent release intent
  promote the already verified artifact; record destination operation ID
  reconcile destination and execute post-deploy probes
  only then RELEASED; failure enters authorized recovery or FAILED
```
Never change `DEPLOYING` to `CANCELLED` merely because the local process stopped; reconcile external state.

- [ ] **5. Run GREEN and affected regressions.** Repeat the command above, then run `npm run typecheck` and `npm run test:tasks`. All required discovered assertions must execute. When a prerequisite for an unrelated live gate is unavailable, record that task as blocked and report the affected subset accurately; do not make the global test command falsely green. Verify resources and secrets are cleaned up.

- [ ] **6. Review and commit.** Inspect the diff against the requirement IDs, ownership, negative tests, and actual retained evidence. Obtain independent review for security/acceptance policy changes. Stage only this task's intentional changes and commit with a message beginning `T08:`. No approval to deploy is implied. Mark the task complete only after its gate is met.

## Milestone M2 exit
All four task gates must pass at their stated evidence level. Preserve source/contract/policy/version identities and unresolved scope limits. Report completion to the engineering ledger; the quiet client interface only needs a material blocker or working milestone preview. Proceed to the next dependency-ready milestone without asking the client to manage the plan.
