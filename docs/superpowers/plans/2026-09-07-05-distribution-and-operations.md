# Client Mode — Distribution And Operations Implementation Plan

> **For agentic workers:** Use Superpowers subagent-driven-development or executing-plans when installed; equivalent task-by-task rules are below. Do not require Superpowers as a shipped product dependency. Track checkbox steps and keep one integration owner.

**Goal:** Complete milestone M5, including its executable acceptance gate, as part of the full six-milestone product.

**Architecture:** Native distributions and a local launcher share one tested core. Installation, upgrade, retention, protected CI and recovery maintain authority and evidence across real operation.

**Toolkit Implementation Stack (not the AI team's supported-stack boundary):** Strict TypeScript, maintained pinned Node LTS, npm workspaces; shared JSON Schema, SQLite, official provider interfaces, and a protected test/browser runtime as applicable.

**Spec:** `../../../ENGINEERING_HANDOVER.md`, `../../SECURITY_AND_RELEASE.md`, `../../QUALIFICATION.md`, and `../../../contracts/interfaces.ts`. Paths in task blocks are relative to the product repository root, not this document folder.

## Global constraints
AI engineers must handle the actual client stack across web/backend/mobile/native/systems/data/LLM domains. Follow `docs/AI_ENGINEER_STACK_SCOPE.md` (repository-root path); do not treat the toolkit implementation language or a missing prebuilt profile as a language restriction.

The binding values are: one writer/project; maximum two child jobs; depth one; three repair cycles; default task ceiling1800seconds; default check timeout300seconds. Native account usage and approved API billing are separate. No extra spending, public release, destructive changes, or policy weakening is authorized by this plan. Preserve client business behavior and dirty files. Missing/unsupported checks are UNVERIFIED. Full v1 requires both adapters, quiet console, protected verification, and all eight milestone gates (G1–G8). The client does not maintain Markdown, assign agents, or say continue.

## Execution and test conventions
Create a branch/workspace after inspecting existing changes. Read each task and its acceptance scenario in `contracts/acceptance-scenarios.json`. The product test harness from T01 lives in `tests/harness/registry.ts`. Each task owns `tests/scenarios/TNN.scenarios.ts`, which registers its scenario by exercising the actual production boundary described below; never return the expected dictionary as a substitute for executing it. Test observations are outputs of measured operations. Mock protocol tests must stay explicitly labeled and cannot satisfy live-provider, protected-isolation, or benchmark gates.

The supplied test blocks go in `tests/tasks/TNN.test.ts`. They are future product acceptance tests, **not tests claimed executed by this handoff**. Resolve the declared implementation dependencies before testing. A failing assertion or missing real implementation is a valid red state; missing credentials are a blocked live test, never a skipped green result. After minimal green implementation, refactor, run affected regression/type checks, review actual diff/evidence, and commit. Do not ask the client to approve ordinary task progression.

## T17: Dual native plugin distributions and safe installation

**Owner:** Release + Provider integration  
**Dependencies:** T09, T10, T11, T12, T13, T14, T16  
**Requirements:** FR-20, FR-22, FR-23, FR-31, NFR-12  
**Gate:** AT-017 (live_provider).

**Files to create or modify:**
- `packages/packaging/src/build.ts`
- `packages/packaging/src/install.ts`
- `apps/cli/src/install.ts`
- `adapters/claude/`
- `adapters/codex/`
- `tests/scenarios/T17.scenarios.ts`
- `tests/tasks/T17.test.ts`

**Consumes:** The root contract schema/interfaces, approved policy and relevant services delivered by T09, T10, T11, T12, T13, T14, T16. See the named public interfaces in `contracts/interfaces.ts`; do not invent a second incompatible contract.

**Produces:** The file-owned component described in the implementation steps and a registered `AT-017` scenario returning `ScenarioObservation`. Later tasks consume the same versioned boundaries, not private provider runtime files.

- [ ] **1. Prepare the exact fixture.** Build from one source tree with eight original skills. Use installed/cached paths containing spaces/Unicode and existing unrelated global/project configuration.

- [ ] **2. Write the failing acceptance test and real scenario executor.** Register the scenario in `tests/scenarios/T17.scenarios.ts` using the shared registry. Its executor must perform these actions and record observations:
  1. Generate separate self-contained Claude and Codex distributions with validated native manifests.
  2. Dry-run install, approve it, load in fresh sessions, and verify effective discovery/permissions.
  3. Uninstall and compare unrelated configuration/files with original bytes.

```ts
// tests/tasks/T17.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { exerciseScenario } from '../harness/registry.js';
import '../scenarios/T17.scenarios.js';
test('AT-017: Dual native plugin distributions and safe installation', async () => {
  const result = await exerciseScenario('AT-017');
  assert.equal(result.scenario_id, 'AT-017');
  const expected = {
  "both_distributions_self_contained": true,
  "native_formats_validated": true,
  "fresh_sessions_load_both": true,
  "unrelated_configuration_preserved": true,
  "uninstall_restores_owned_changes": true
};
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(result.observed[key], value, key);
  }
  assert.ok(result.artifact_paths.length > 0, 'retain actual evidence');
});
```

- [ ] **3. Run RED.** After T01 installs the approved test dependencies, run:

```bash
node --import tsx --test tests/tasks/T17.test.ts
```

Expected before implementation: FAIL on the named missing behavior, not a forged success report. Record the observed failure. T01 may begin with missing modules while bootstrapping; subsequently replace that with behavioral rejection tests.

- [ ] **4. Implement the smallest complete component.** Copy shared procedures into each native package; do not rely on external relative paths surviving caching. Generate manifest fields from verified native docs for installed versions. Keep custom agent configuration at supported surfaces. Installer computes merge/diff, backs up with hash, applies atomically and verifies fresh session before claiming installed. No global model/permission changes without scoped authorization; no downloaded shell script automatically executed.

```text
build -> validate distributions -> dry-run proposed configuration diff
     -> authorized apply -> fresh-session smoke -> record install receipt
failure -> restore only owned prior changes; preserve concurrent user edits
```
The finished product must not require Superpowers installation. The requested Superpowers methodology is an engineering workflow for this handoff.

- [ ] **5. Run GREEN and affected regressions.** Repeat the command above, then run `npm run typecheck` and `npm run test:tasks`. All required discovered assertions must execute. When a prerequisite for an unrelated live gate is unavailable, record that task as blocked and report the affected subset accurately; do not make the global test command falsely green. Verify resources and secrets are cleaned up.

- [ ] **6. Review and commit.** Inspect the diff against the requirement IDs, ownership, negative tests, and actual retained evidence. Obtain independent review for security/acceptance policy changes. Stage only this task's intentional changes and commit with a message beginning `T17:`. No approval to deploy is implied. Mark the task complete only after its gate is met.

## T18: CLI launcher, versioned upgrades, migrations, and recovery

**Owner:** Release + Platform  
**Dependencies:** T02, T08, T15, T17  
**Requirements:** FR-12, FR-22, FR-23, FR-30, FR-36, NFR-06, NFR-07, NFR-12, NFR-16  
**Gate:** AT-018 (integration).

**Files to create or modify:**
- `apps/cli/src/main.ts`
- `apps/cli/src/run.ts`
- `apps/cli/src/verify.ts`
- `packages/packaging/src/upgrade.ts`
- `packages/packaging/src/uninstall.ts`
- `tests/scenarios/T18.scenarios.ts`
- `tests/tasks/T18.test.ts`

**Consumes:** The root contract schema/interfaces, approved policy and relevant services delivered by T02, T08, T15, T17. See the named public interfaces in `contracts/interfaces.ts`; do not invent a second incompatible contract.

**Produces:** The file-owned component described in the implementation steps and a registered `AT-018` scenario returning `ScenarioObservation`. Later tasks consume the same versioned boundaries, not private provider runtime files.

- [ ] **1. Prepare the exact fixture.** Use releaseA/B local fixtures,1000durable tasks, a clean install and a concurrent user configuration edit. Include database migration failure and power-loss simulation.

- [ ] **2. Write the failing acceptance test and real scenario executor.** Register the scenario in `tests/scenarios/T18.scenarios.ts` using the shared registry. Its executor must perform these actions and record observations:
  1. Run the specified cm command surface, then upgrade with backup and injected failure.
  2. Restore compatible state/binary or declare irreversible migration instead of unsafe rollback.
  3. Resume1000tasks and cancel a controlled process tree; verify unowned files untouched.

```ts
// tests/tasks/T18.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { exerciseScenario } from '../harness/registry.js';
import '../scenarios/T18.scenarios.js';
test('AT-018: CLI launcher, versioned upgrades, migrations, and recovery', async () => {
  const result = await exerciseScenario('AT-018');
  assert.equal(result.scenario_id, 'AT-018');
  const expected = {
  "commands_match_operations_contract": true,
  "failed_upgrade_preserves_state": true,
  "concurrent_user_edit_not_overwritten": true,
  "recovery_1000_tasks_within_30s": true,
  "cancel_ack_within_1s": true,
  "owned_tree_stopped_within_10s_or_quarantined": true,
  "unavailable_validation_dependency_not_green": true
};
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(result.observed[key], value, key);
  }
  assert.ok(result.artifact_paths.length > 0, 'retain actual evidence');
});
```

- [ ] **Edition 1.2 review closure.** Ship a one-command validation/doctor outcome that reports missing requirements as blocked/nonzero; do not convert absent tooling or mock-only execution into observed compatibility. See `docs/DELIVERY_PROTOCOL.md`, `docs/AI_COMPANY_OPERATING_MODEL.md`, and `docs/RELEASE_ACCEPTANCE.md` (repository-root paths). The observations above must come from actual execution.

- [ ] **3. Run RED.** After T01 installs the approved test dependencies, run:

```bash
node --import tsx --test tests/tasks/T18.test.ts
```

Expected before implementation: FAIL on the named missing behavior, not a forged success report. Record the observed failure. T01 may begin with missing modules while bootstrapping; subsequently replace that with behavioral rejection tests.

- [ ] **4. Implement the smallest complete component.** Implement exact CLI definitions in OPERATIONS.md as controller clients, not separate business rules. doctor/install/open/run/status/pause/resume/cancel/verify/export-evidence/upgrade/uninstall/rollback share auth/state. Package binaries and migrations with identifiable versions; integrity-check distributions, backup state safely, test restore on copy. Resume checks actual leases/candidate evidence; no automatic run on changed billing or unsupported host. Timings are tested reference-machine targets.

```text
upgrade transaction:
  acquire installer lock -> validate release/checksum/compatibility
  safe state/config backup -> stage migration and binary -> smoke check
  promote only after successful checks; otherwise restore compatible version
  never overwrite edits made after backup without a conflict decision
```
`cm rollback` is toolkit rollback unless an explicit deployment ID and separately authorized recovery scope is supplied; avoid ambiguous destructive commands.

- [ ] **5. Run GREEN and affected regressions.** Repeat the command above, then run `npm run typecheck` and `npm run test:tasks`. All required discovered assertions must execute. When a prerequisite for an unrelated live gate is unavailable, record that task as blocked and report the affected subset accurately; do not make the global test command falsely green. Verify resources and secrets are cleaned up.

- [ ] **6. Review and commit.** Inspect the diff against the requirement IDs, ownership, negative tests, and actual retained evidence. Obtain independent review for security/acceptance policy changes. Stage only this task's intentional changes and commit with a message beginning `T18:`. No approval to deploy is implied. Mark the task complete only after its gate is met.

## T19: Audit, metrics, redaction, retention, and operator health

**Owner:** Platform + Security  
**Dependencies:** T02, T04, T07, T15  
**Requirements:** FR-18, FR-19, FR-26, FR-28, FR-30, FR-34, NFR-04, NFR-08, NFR-10, NFR-14  
**Gate:** AT-019 (integration).

**Files to create or modify:**
- `packages/observability/src/logging.ts`
- `packages/observability/src/metrics.ts`
- `packages/observability/src/redaction.ts`
- `apps/controller/src/events.ts`
- `tests/scenarios/T19.scenarios.ts`
- `tests/tasks/T19.test.ts`

**Consumes:** The root contract schema/interfaces, approved policy and relevant services delivered by T02, T04, T07, T15. See the named public interfaces in `contracts/interfaces.ts`; do not invent a second incompatible contract.

**Produces:** The file-owned component described in the implementation steps and a registered `AT-019` scenario returning `ScenarioObservation`. Later tasks consume the same versioned boundaries, not private provider runtime files.

- [ ] **1. Prepare the exact fixture.** Seed synthetic secret canaries, two projects, usage gaps/duplicates, old logs/screenshots and a retained release manifest. Use fake clock for retention.

- [ ] **2. Write the failing acceptance test and real scenario executor.** Register the scenario in `tests/scenarios/T19.scenarios.ts` using the shared registry. Its executor must perform these actions and record observations:
  1. Emit worker/tool/provider errors containing secrets and attempt cross-project log/context retrieval.
  2. Exercise30/90/365-day retention rules, legal/organization locks, export/deletion and telemetry default.
  3. Report metrics for failures/retries/cache/unknown costs, stale leases, invalid attestations and queue health.

```ts
// tests/tasks/T19.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { exerciseScenario } from '../harness/registry.js';
import '../scenarios/T19.scenarios.js';
test('AT-019: Audit, metrics, redaction, retention, and operator health', async () => {
  const result = await exerciseScenario('AT-019');
  assert.equal(result.scenario_id, 'AT-019');
  const expected = {
  "secret_canaries_redacted": true,
  "cross_project_read_denied": true,
  "retention_policy_enforced": true,
  "telemetry_default_off": true,
  "unknown_usage_not_zero": true,
  "failed_attempt_cost_included": true
};
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(result.observed[key], value, key);
  }
  assert.ok(result.artifact_paths.length > 0, 'retain actual evidence');
});
```

- [ ] **3. Run RED.** After T01 installs the approved test dependencies, run:

```bash
node --import tsx --test tests/tasks/T19.test.ts
```

Expected before implementation: FAIL on the named missing behavior, not a forged success report. Record the observed failure. T01 may begin with missing modules while bootstrapping; subsequently replace that with behavioral rejection tests.

- [ ] **4. Implement the smallest complete component.** Structured audit IDs bind project/run/attempt/candidate/policy. Keep full logs with bounded storage and redaction before persistence; sampled previews cannot erase failure evidence. Secrets are accessed through references and never echoed. Apply data class retention rules and explicit export authorization. Metrics include whole-tree usage, failures, stale jobs, rejected attestations, controller health; keep model transcript details out of default client UI. Review prompt-injection strings as data not new permissions.

```text
cost_per_accepted = total_measured_cost(all_attempts) / accepted_count
if accepted_count == 0: value = null; report total incurred cost separately
if coverage incomplete: report measured partial cost plus unknown coverage
```
Test redaction beyond known key names: headers, URI credentials, environment output and screenshots requiring restricted retention. Redaction cannot guarantee removal of every unknown secret; prevention and data minimization remain required.

- [ ] **5. Run GREEN and affected regressions.** Repeat the command above, then run `npm run typecheck` and `npm run test:tasks`. All required discovered assertions must execute. When a prerequisite for an unrelated live gate is unavailable, record that task as blocked and report the affected subset accurately; do not make the global test command falsely green. Verify resources and secrets are cleaned up.

- [ ] **6. Review and commit.** Inspect the diff against the requirement IDs, ownership, negative tests, and actual retained evidence. Obtain independent review for security/acceptance policy changes. Stage only this task's intentional changes and commit with a message beginning `T19:`. No approval to deploy is implied. Mark the task complete only after its gate is met.

## T20: Protected CI, deployment reconciliation, and operational runbooks

**Owner:** Release + Security  
**Dependencies:** T05, T07, T08, T18, T19  
**Requirements:** FR-14, FR-25, FR-30, FR-32, FR-36, NFR-01, NFR-02, NFR-12  
**Gate:** AT-020 (integration).

**Files to create or modify:**
- `.github/workflows/product-ci.yml`
- `packages/release/src/deploy.ts`
- `packages/release/src/smoke.ts`
- `packages/release/src/rollback.ts`
- `docs/runbooks/`
- `tests/scenarios/T20.scenarios.ts`
- `tests/tasks/T20.test.ts`

**Consumes:** The root contract schema/interfaces, approved policy and relevant services delivered by T05, T07, T08, T18, T19. See the named public interfaces in `contracts/interfaces.ts`; do not invent a second incompatible contract.

**Produces:** The file-owned component described in the implementation steps and a registered `AT-020` scenario returning `ScenarioObservation`. Later tasks consume the same versioned boundaries, not private provider runtime files.

- [ ] **1. Prepare the exact fixture.** Use separate CI/service authority, non-production deploy target and synthetic database. No secret-bearing workflow executes untrusted pull-request code.

- [ ] **2. Write the failing acceptance test and real scenario executor.** Register the scenario in `tests/scenarios/T20.scenarios.ts` using the shared registry. Its executor must perform these actions and record observations:
  1. Attempt candidate change to workflow/policy/test parser and attempt fake green check context.
  2. Promote the exact verified artifact; simulate deployment timeout and reconcile without duplicate deployment.
  3. Rehearse migration backup/restore or roll-forward and failed smoke recovery; execute runbooks from fresh operator session.

```ts
// tests/tasks/T20.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { exerciseScenario } from '../harness/registry.js';
import '../scenarios/T20.scenarios.js';
test('AT-020: Protected CI, deployment reconciliation, and operational runbooks', async () => {
  const result = await exerciseScenario('AT-020');
  assert.equal(result.scenario_id, 'AT-020');
  const expected = {
  "candidate_cannot_replace_protected_policy": true,
  "verified_artifact_promoted_unchanged": true,
  "deployment_reconciled_after_timeout": true,
  "migration_recovery_rehearsed": true,
  "runbooks_executed": true
};
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(result.observed[key], value, key);
  }
  assert.ok(result.artifact_paths.length > 0, 'retain actual evidence');
});
```

- [ ] **3. Run RED.** After T01 installs the approved test dependencies, run:

```bash
node --import tsx --test tests/tasks/T20.test.ts
```

Expected before implementation: FAIL on the named missing behavior, not a forged success report. Record the observed failure. T01 may begin with missing modules while bootstrapping; subsequently replace that with behavioral rejection tests.

- [ ] **4. Implement the smallest complete component.** Separate ordinary product CI from protected application acceptance and release. Pin workflow/action versions after official verification, require protected review, use ephemeral no-secret candidate jobs and exact check identities. Acceptance emits signed artifacts from service authority. Deploy known image/package, not a rebuild or arbitrary candidate shell under credentials. Migrations carry explicit reversibility and backup proof. Configure canary/health/rollback policy from OPERATIONS, not a universal auto-rollback guess.

```text
untrusted candidate build job: no secrets, no privileged runner access
protected acceptance: trusted policy + external probes + attestation
release job: authenticated approval + verified artifact digest
post-release: smoke/health evidence -> RELEASED or authorized recovery
```
Documentation gate includes an operator actually following install, stop/resume, budget failure, credential rotation, restore and uninstall instructions.

- [ ] **5. Run GREEN and affected regressions.** Repeat the command above, then run `npm run typecheck` and `npm run test:tasks`. All required discovered assertions must execute. When a prerequisite for an unrelated live gate is unavailable, record that task as blocked and report the affected subset accurately; do not make the global test command falsely green. Verify resources and secrets are cleaned up.

- [ ] **6. Review and commit.** Inspect the diff against the requirement IDs, ownership, negative tests, and actual retained evidence. Obtain independent review for security/acceptance policy changes. Stage only this task's intentional changes and commit with a message beginning `T20:`. No approval to deploy is implied. Mark the task complete only after its gate is met.

## Milestone M5 exit
All four task gates must pass at their stated evidence level. Preserve source/contract/policy/version identities and unresolved scope limits. Report completion to the engineering ledger; the quiet client interface only needs a material blocker or working milestone preview. Proceed to the next dependency-ready milestone without asking the client to manage the plan.
