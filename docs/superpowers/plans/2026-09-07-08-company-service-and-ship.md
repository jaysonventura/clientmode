# Company Service and Complete Release Implementation Plan

> **For agentic workers:** Use Superpowers subagent-driven-development or executing-plans when installed. Written red–green–refactor, review and verification steps below remain binding without a community dependency.

**Goal:** Deliver accountable product/support responsibilities and qualify the complete v1.3 product.

**Architecture:** Extend the existing controller, protected verifier and quiet UI; do not create an independent agent framework. Document jobs are distinct from software runs, and all work shares controlled authority, state and budgets.

**Tech Stack:** Existing TypeScript product and target-native test harness, SQLite draft storage and qualified isolated file-processing engines. These choices do not restrict client engineering languages.

**Spec:** `ENGINEERING_HANDOVER.md`, `docs/DOCUMENT_WORKFLOW.md`, `docs/AI_COMPANY_OPERATING_MODEL.md`, `docs/QUALIFICATION.md`. Paths are relative to the product repository root.

## Global Constraints

One active writer per project, at most two children per lead, depth one. Quiet client operation. No community orchestration dependency. No unapproved external upload, API billing, legal commitment, production change or public communication. Source/model/worker text cannot grant authority. Required missing or stale checks block readiness. Every task test exercises actual services, not a dictionary of anticipated results.

The registry and ScenarioObservation contract are established by T01. Each task registers its actual executor in `tests/scenarios/TNN.scenarios.ts`. The test blocks below are instructions for future product tests, not tests executed by this handoff. Preserve all earlier requirements and invoke only documented provider surfaces verified on the installed version.

## T31: Risk-based company responsibility and evidence-based discovery

**Owner:** Product + Architecture + Security lead  
**Dependencies:** T12, T13, T14  
**Requirements:** FR-43, FR-54, FR-56, FR-57, FR-59, NFR-20  
**Gate:** AT-031, actual product execution.

**Files to create or modify:**
- `packages/core/src/responsibilities.ts`
- `packages/core/src/discovery.ts`
- `packages/core/src/risk-tier.ts`
- `skills/research/SKILL.md`
- `skills/technical-writing/SKILL.md`
- `skills/document-analysis/SKILL.md`
- `tests/scenarios/T31.scenarios.ts`
- `tests/tasks/T31.test.ts`

**Interfaces:** Consumes TaskAssignment, EngineeringContext and existing router/approval/context facilities. Produces controller-owned responsibility coverage metadata and narrow shared skills; no new security role is introduced. Exact common shapes are in `contracts/domain.schema.json` and `contracts/interfaces.ts`; no undocumented second schema.

- [ ] **1. Prepare the fixture.** Three comparable client requests: a small button wording change, a multi-stack document-derived booking feature, and a payment/auth change. No real user study exists; a vendor quote asks for an unapproved paid service.

- [ ] **2. Write the failing test and actual executor.** The executor must perform:
  1. Route the required responsibilities and evidence gates without spawning every department.
  2. Produce bounded outcome briefs linked to real requests/sources, label assumptions and stop fake user-research claims.
  3. Challenge a risk downgrade, an invented business signoff, a role-based privilege escalation and purchase without authorization.

```ts
// tests/tasks/T31.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { exerciseScenario } from '../harness/registry.js';
import '../scenarios/T31.scenarios.js';
test('AT-031: Risk-based company responsibility and evidence-based discovery', async () => {
  const result = await exerciseScenario('AT-031');
  assert.equal(result.scenario_id, 'AT-031');
  const expected = {
  "small_task_does_not_spawn_company_swarm": true,
  "substantive_task_has_owner_and_review_outputs": true,
  "high_risk_gates_cannot_be_lowered_by_writer": true,
  "research_claims_have_actual_provenance": true,
  "client_not_given_management_homework": true,
  "role_titles_do_not_grant_authority": true,
  "unapproved_purchase_or_legal_signoff_rejected": true
};
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(result.observed[key], value, key);
  }
  assert.ok(result.artifact_paths.length > 0, 'retain actual execution evidence');
});
```

- [ ] **3. Run RED and record the observed failure.**

```bash
node --import tsx --test tests/tasks/T31.test.ts
```

A missing boundary during initial development is not a pass. Once executable, demonstrate the failed behavior or known defect; unavailable credentials/tooling mean blocked, never skipped-green.

- [ ] **4. Implement this component.** Extend the existing coverage map, not the host role permission enum. Use lead/writer/explorer/reviewer execution roles plus task-specific responsibilities. The internal discovery brief includes the problem, outcome, constraints, evidence and risks; reuse it for small changes. Review security/privacy/accessibility and operations when triggered. Add narrow original skills with current-source retrieval and uncertainty requirements. Escalate consequential legal/finance decisions; no separate paid vendor or analytics telemetry is introduced by a role description.

```text
responsibility != process != permission
small change -> existing lead + relevant checks
substantive/high-risk -> bounded assignments + protected gates
```

- [ ] **5. Run GREEN and affected regressions.**

```bash
node --import tsx --test tests/tasks/T31.test.ts
npm run typecheck
npm run test:tasks
```

Commands belong to the product harness established in T01, not this handoff ZIP. No red result, unexecuted output or missing required prerequisite can be recast as green. Preserve failure artifacts and successful final identities.

- [ ] **6. Review and commit.** Inspect the actual diff and evidence against this task and its requirement IDs. Use separate technical review for protected policy/authority changes, check resource cleanup and source privacy, stage only intentional changes and commit with a message beginning `T31:`. Task completion does not itself authorize production release.

## T32: On-demand support, incident learning and product feedback

**Owner:** Support/SRE + Product analyst  
**Dependencies:** T19, T20, T31  
**Requirements:** FR-52, FR-56, FR-58, FR-59, NFR-20  
**Gate:** AT-032, actual product execution.

**Files to create or modify:**
- `packages/support/src/cases.ts`
- `packages/support/src/triage.ts`
- `packages/support/src/resolution.ts`
- `packages/support/src/knowledge.ts`
- `apps/controller/src/service-case-routes.ts`
- `skills/support/SKILL.md`
- `tests/scenarios/T32.scenarios.ts`
- `tests/tasks/T32.test.ts`

**Interfaces:** Consumes ServiceCase, ClientRequest, Run/DocumentJob and release evidence. Produces ServiceCaseService, case APIs, verified resolution records and linked documentation; existing execution and approval boundaries remain authoritative. Exact common shapes are in `contracts/domain.schema.json` and `contracts/interfaces.ts`; no undocumented second schema.

- [ ] **1. Prepare the fixture.** A released disposable application has a client-reported calculation failure and a documentation question; monitoring is not configured. Include a duplicate report and an attempted unauthorized outbound customer email.

- [ ] **2. Write the failing test and actual executor.** The executor must perform:
  1. Create ServiceCase from real request, reproduce and link an authorized regression/repair or document job; preserve evidence and history.
  2. Resolve after actual checks, update the versioned knowledge/runbook and record a factual incident timeline when warranted.
  3. Stop the controller and verify no claim of continued coverage; deny outbound communication and fake client satisfaction without appropriate authority.

```ts
// tests/tasks/T32.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { exerciseScenario } from '../harness/registry.js';
import '../scenarios/T32.scenarios.js';
test('AT-032: On-demand support, incident learning and product feedback', async () => {
  const result = await exerciseScenario('AT-032');
  assert.equal(result.scenario_id, 'AT-032');
  const expected = {
  "case_links_real_client_request_and_work": true,
  "resolution_requires_actual_evidence": true,
  "regression_and_documentation_updated": true,
  "duplicate_reports_preserve_history": true,
  "no_fake_24x7_or_sla_claim": true,
  "outbound_actions_require_authorization": true,
  "client_satisfaction_not_written_by_agent": true
};
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(result.observed[key], value, key);
  }
  assert.ok(result.artifact_paths.length > 0, 'retain actual execution evidence');
});
```

- [ ] **3. Run RED and record the observed failure.**

```bash
node --import tsx --test tests/tasks/T32.test.ts
```

A missing boundary during initial development is not a pass. Once executable, demonstrate the failed behavior or known defect; unavailable credentials/tooling mean blocked, never skipped-green.

- [ ] **4. Implement this component.** Implement ServiceCaseService.open/triage plus internal resolution policy. Persist case-to-work relationships in controller-owned storage; normalize severity from observed impact and uncertainty. Default on_demand. configured_service requires real supervisor/alerts/operator authorization and tested coverage. Turn observed lessons into scoped reviewed documentation or regression tasks; never automatically rewrite unrelated projects or global acceptance policy. Distinguish mitigation, verified fix, closure and client satisfaction. Cost/license review is advisory; spending/signing remain controlled.

```text
client report -> case -> reproduction -> linked scoped work
verified repair/answer -> resolution evidence -> knowledge update
closure = actual client confirmation or explicit closure policy
```

- [ ] **5. Run GREEN and affected regressions.**

```bash
node --import tsx --test tests/tasks/T32.test.ts
npm run typecheck
npm run test:tasks
```

Commands belong to the product harness established in T01, not this handoff ZIP. No red result, unexecuted output or missing required prerequisite can be recast as green. Preserve failure artifacts and successful final identities.

- [ ] **6. Review and commit.** Inspect the actual diff and evidence against this task and its requirement IDs. Use separate technical review for protected policy/authority changes, check resource cleanup and source privacy, stage only intentional changes and commit with a message beginning `T32:`. Task completion does not itself authorize production release.

## T33: Document and company-workflow qualification and complete release

**Owner:** Independent QA + Release owner  
**Dependencies:** T24, T30, T31, T32  
**Requirements:** FR-46, FR-47, FR-48, FR-49, FR-50, FR-51, FR-52, FR-53, FR-54, FR-55, FR-56, FR-57, FR-58, FR-59, FR-60, NFR-17, NFR-18, NFR-19, NFR-20  
**Gate:** AT-033, actual product execution.

**Files to create or modify:**
- `evals/documents/`
- `evals/company-service/`
- `qa/qualification/`
- `docs/releases/`
- `scripts/package-release.ts`
- `tests/scenarios/T33.scenarios.ts`
- `tests/tasks/T33.test.ts`

**Interfaces:** Consumes all completed service/adaptor/document outputs and existing qualification harness. Produces a versioned qualified release decision and shipping package, not a new undocumented execution framework. Exact common shapes are in `contracts/domain.schema.json` and `contracts/interfaces.ts`; no undocumented second schema.

- [ ] **1. Prepare the fixture.** Fresh installed Client Mode, both real provider adapters, approved evaluation budget, independently controlled known-answer/held-out documents, previous cross-stack results, and no production secrets in workers.

- [ ] **2. Write the failing test and actual executor.** The executor must perform:
  1. Run document fixtures and approved repeated A/B/C comparison; blind semantic/layout graders to variant where practical.
  2. Exercise client upload→analysis→question→edit→checked artifact→build-from-approved-rules→feedback→support case with real UI and target software tests.
  3. Run fresh-install and upgrade/restore scenarios including new document state; require G1–G8, distinct client signoff and exact artifact release authorization.

```ts
// tests/tasks/T33.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { exerciseScenario } from '../harness/registry.js';
import '../scenarios/T33.scenarios.js';
test('AT-033: Document and company-workflow qualification and complete release', async () => {
  const result = await exerciseScenario('AT-033');
  assert.equal(result.scenario_id, 'AT-033');
  const expected = {
  "real_document_formats_and_exports_qualified": true,
  "known_numeric_and_citation_defects_caught": true,
  "partial_or_forged_results_never_full_ready": true,
  "all_33_task_gates_have_evidence_or_no_go": true,
  "cross_stack_qualification_not_replaced_by_docs": true,
  "comparison_counts_all_attempts_and_costs": true,
  "new_document_state_survives_upgrade_restore": true,
  "client_acceptance_distinct_from_technical_ready": true,
  "only_verified_authorized_artifacts_released": true
};
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(result.observed[key], value, key);
  }
  assert.ok(result.artifact_paths.length > 0, 'retain actual execution evidence');
});
```

- [ ] **3. Run RED and record the observed failure.**

```bash
node --import tsx --test tests/tasks/T33.test.ts
```

A missing boundary during initial development is not a pass. Once executable, demonstrate the failed behavior or known defect; unavailable credentials/tooling mean blocked, never skipped-green.

- [ ] **4. Implement this component.** T24 proves the prior software release path; it is a prerequisite, not permission to ship v1.3. T33 integrates document/company gates with the unchanged software safety gates. Reuse earlier tests without treating old candidates as current proof. Run actual document tools and live host tests; metadata fixtures are not a substitute. The QA owner keeps held-out expected data separate. Ship the qualified operation/format and host/task-environment matrix, licenses, evidence, quiet onboarding and tested rollback. A blocker is a no-go for that scope, not a reason to fake a final pass.

```text
G1..G6 software and operations + G7 documents + G8 service closure
    -> independent technical qualification
    -> actual client acceptance -> scoped release authorization
    -> exact released artifact + post-release checks
```

- [ ] **5. Run GREEN and affected regressions.**

```bash
node --import tsx --test tests/tasks/T33.test.ts
npm run typecheck
npm run test:tasks
```

Commands belong to the product harness established in T01, not this handoff ZIP. No red result, unexecuted output or missing required prerequisite can be recast as green. Preserve failure artifacts and successful final identities.

- [ ] **6. Review and commit.** Inspect the actual diff and evidence against this task and its requirement IDs. Use separate technical review for protected policy/authority changes, check resource cleanup and source privacy, stage only intentional changes and commit with a message beginning `T33:`. Task completion does not itself authorize production release.

## Milestone exit

G8 is full v1.3 closure. Retain every prerequisite gate, observed qualification, actual client acceptance and artifact-scoped release decision. No product acceptance is pre-awarded by this document.
