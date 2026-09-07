# Implementation Task Index — Edition 1.3

Eight workstreams, 33 tasks. All product scenarios are unexecuted specifications. Follow each task's dependency IDs; owners may work on independent plans concurrently under the single-writer rule. T24 proves the base software release path; T33 closes the full product.

## M1

| Task | Deliverable | Dependencies | Plan |
|---|---|---|---|
| T01 | Contracts, repository bootstrap, and test harness | None | [2026-09-07-01-foundation](../docs/superpowers/plans/2026-09-07-01-foundation.md) |
| T02 | Durable lifecycle, transactions, leases, and outbox | T01 | [2026-09-07-01-foundation](../docs/superpowers/plans/2026-09-07-01-foundation.md) |
| T03 | Repository discovery, workspace ownership, and immutable candidates | T01, T02 | [2026-09-07-01-foundation](../docs/superpowers/plans/2026-09-07-01-foundation.md) |
| T04 | Policy routing, authority, budgets, and bounded repair | T01, T02, T03 | [2026-09-07-01-foundation](../docs/superpowers/plans/2026-09-07-01-foundation.md) |

## M2

| Task | Deliverable | Dependencies | Plan |
|---|---|---|---|
| T05 | Protected check registry and untrusted execution sandbox | T01, T03, T04 | [2026-09-07-02-protected-verification](../docs/superpowers/plans/2026-09-07-02-protected-verification.md) |
| T06 | External browser/API probes and real qualification application | T03, T05 | [2026-09-07-02-protected-verification](../docs/superpowers/plans/2026-09-07-02-protected-verification.md) |
| T07 | Authenticated evidence and candidate-bound readiness | T01, T02, T05, T06 | [2026-09-07-02-protected-verification](../docs/superpowers/plans/2026-09-07-02-protected-verification.md) |
| T08 | Client authentication, scoped approvals, and release consumption | T02, T04, T07 | [2026-09-07-02-protected-verification](../docs/superpowers/plans/2026-09-07-02-protected-verification.md) |

## M3

| Task | Deliverable | Dependencies | Plan |
|---|---|---|---|
| T09 | Capability detection and explicit authentication/billing modes | T01, T04 | [2026-09-07-03-provider-orchestration](../docs/superpowers/plans/2026-09-07-03-provider-orchestration.md) |
| T10 | Claude official adapter and native entry integration | T04, T09 | [2026-09-07-03-provider-orchestration](../docs/superpowers/plans/2026-09-07-03-provider-orchestration.md) |
| T11 | Codex official adapter and native entry integration | T04, T09 | [2026-09-07-03-provider-orchestration](../docs/superpowers/plans/2026-09-07-03-provider-orchestration.md) |
| T12 | Delivery orchestration, review independence, and context packets | T02, T03, T04, T07, T10, T11 | [2026-09-07-03-provider-orchestration](../docs/superpowers/plans/2026-09-07-03-provider-orchestration.md) |

## M4

| Task | Deliverable | Dependencies | Plan |
|---|---|---|---|
| T13 | Ordinary-language intake and AI-maintained project memory | T01, T02, T09, T12 | [2026-09-07-04-client-and-ui-ux](../docs/superpowers/plans/2026-09-07-04-client-and-ui-ux.md) |
| T14 | Design workflow, assets, accessibility, and independent UX review | T06, T13 | [2026-09-07-04-client-and-ui-ux](../docs/superpowers/plans/2026-09-07-04-client-and-ui-ux.md) |
| T15 | Quiet client console, local API, event replay, and accessibility | T02, T08, T13, T14 | [2026-09-07-04-client-and-ui-ux](../docs/superpowers/plans/2026-09-07-04-client-and-ui-ux.md) |
| T16 | Complete delivery loop, preview handoff, feedback, and resumption | T07, T08, T12, T13, T14, T15 | [2026-09-07-04-client-and-ui-ux](../docs/superpowers/plans/2026-09-07-04-client-and-ui-ux.md) |

## M5

| Task | Deliverable | Dependencies | Plan |
|---|---|---|---|
| T17 | Dual native plugin distributions and safe installation | T09, T10, T11, T12, T13, T14, T16 | [2026-09-07-05-distribution-and-operations](../docs/superpowers/plans/2026-09-07-05-distribution-and-operations.md) |
| T18 | CLI launcher, versioned upgrades, migrations, and recovery | T02, T08, T15, T17 | [2026-09-07-05-distribution-and-operations](../docs/superpowers/plans/2026-09-07-05-distribution-and-operations.md) |
| T19 | Audit, metrics, redaction, retention, and operator health | T02, T04, T07, T15 | [2026-09-07-05-distribution-and-operations](../docs/superpowers/plans/2026-09-07-05-distribution-and-operations.md) |
| T20 | Protected CI, deployment reconciliation, and operational runbooks | T05, T07, T08, T18, T19 | [2026-09-07-05-distribution-and-operations](../docs/superpowers/plans/2026-09-07-05-distribution-and-operations.md) |

## M6

| Task | Deliverable | Dependencies | Plan |
|---|---|---|---|
| T21 | Adversarial proof and failure-injection qualification | T07, T08, T12, T16, T18, T20 | [2026-09-07-06-qualification-and-release](../docs/superpowers/plans/2026-09-07-06-qualification-and-release.md) |
| T22 | Comparable baseline benchmark and complete cost accounting | T16, T19, T21 | [2026-09-07-06-qualification-and-release](../docs/superpowers/plans/2026-09-07-06-qualification-and-release.md) |
| T23 | Unseen holdouts, live host qualification, and client acceptance | T17, T20, T21, T22 | [2026-09-07-06-qualification-and-release](../docs/superpowers/plans/2026-09-07-06-qualification-and-release.md) |
| T24 | Software release-path rehearsal and base operational signoff | T18, T19, T20, T21, T22, T23 | [2026-09-07-06-qualification-and-release](../docs/superpowers/plans/2026-09-07-06-qualification-and-release.md) |

## M7

| Task | Deliverable | Dependencies | Plan |
|---|---|---|---|
| T25 | Safe document ingestion and immutable source versions | T01, T02, T05, T15 | [2026-09-07-07-document-intelligence](../docs/superpowers/plans/2026-09-07-07-document-intelligence.md) |
| T26 | Extraction, visual inventory and version-specific references | T25, T09, T10 | [2026-09-07-07-document-intelligence](../docs/superpowers/plans/2026-09-07-07-document-intelligence.md) |
| T27 | Cross-document reasoning, questions and source-change invalidation | T26, T13 | [2026-09-07-07-document-intelligence](../docs/superpowers/plans/2026-09-07-07-document-intelligence.md) |
| T28 | Full-workbook computation and safe spreadsheet edits | T26 | [2026-09-07-07-document-intelligence](../docs/superpowers/plans/2026-09-07-07-document-intelligence.md) |
| T29 | Document editing, technical writing and verified exports | T27, T28, T06, T08 | [2026-09-07-07-document-intelligence](../docs/superpowers/plans/2026-09-07-07-document-intelligence.md) |
| T30 | Quiet document-job UI, durable lifecycle and mixed-work recovery | T29, T15, T16, T17 | [2026-09-07-07-document-intelligence](../docs/superpowers/plans/2026-09-07-07-document-intelligence.md) |

## M8

| Task | Deliverable | Dependencies | Plan |
|---|---|---|---|
| T31 | Risk-based company responsibility and evidence-based discovery | T12, T13, T14 | [2026-09-07-08-company-service-and-ship](../docs/superpowers/plans/2026-09-07-08-company-service-and-ship.md) |
| T32 | On-demand support, incident learning and product feedback | T19, T20, T31 | [2026-09-07-08-company-service-and-ship](../docs/superpowers/plans/2026-09-07-08-company-service-and-ship.md) |
| T33 | Document and company-workflow qualification and complete release | T24, T30, T31, T32 | [2026-09-07-08-company-service-and-ship](../docs/superpowers/plans/2026-09-07-08-company-service-and-ship.md) |

## Global scope

The [all-stack AI remit](AI_ENGINEER_STACK_SCOPE.md), [document workflow](DOCUMENT_WORKFLOW.md), [company operating model](AI_COMPANY_OPERATING_MODEL.md) and [release acceptance](RELEASE_ACCEPTANCE.md) travel with every plan. The client does not maintain this task list. All 80 requirements are mapped in the machine-readable traceability contract.
