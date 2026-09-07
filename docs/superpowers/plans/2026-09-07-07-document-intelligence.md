# Document Intelligence Implementation Plan

> **For agentic workers:** Use Superpowers subagent-driven-development or executing-plans when installed. Written red–green–refactor, review and verification steps below remain binding without a community dependency.

**Goal:** Deliver accurate document analysis and editable artifacts from ordinary client requests.

**Architecture:** Extend the existing controller, protected verifier and quiet UI; do not create an independent agent framework. Document jobs are distinct from software runs, and all work shares controlled authority, state and budgets.

**Tech Stack:** Existing TypeScript product and target-native test harness, SQLite draft storage and qualified isolated file-processing engines. These choices do not restrict client engineering languages.

**Spec:** `ENGINEERING_HANDOVER.md`, `docs/DOCUMENT_WORKFLOW.md`, `docs/AI_COMPANY_OPERATING_MODEL.md`, `docs/QUALIFICATION.md`. Paths are relative to the product repository root.

## Global Constraints

One active writer per project, at most two children per lead, depth one. Quiet client operation. No community orchestration dependency. No unapproved external upload, API billing, legal commitment, production change or public communication. Source/model/worker text cannot grant authority. Required missing or stale checks block readiness. Every task test exercises actual services, not a dictionary of anticipated results.

The registry and ScenarioObservation contract are established by T01. Each task registers its actual executor in `tests/scenarios/TNN.scenarios.ts`. The test blocks below are instructions for future product tests, not tests executed by this handoff. Preserve all earlier requirements and invoke only documented provider surfaces verified on the installed version.

## T25: Safe document ingestion and immutable source versions

**Owner:** Platform + Security  
**Dependencies:** T01, T02, T05, T15  
**Requirements:** FR-46, FR-55, NFR-18  
**Gate:** AT-025, actual product execution.

**Files to create or modify:**
- `packages/documents/src/ingest.ts`
- `packages/documents/src/safety.ts`
- `packages/documents/src/storage.ts`
- `migrations/003_documents.sql`
- `fixtures/documents/ingestion/`
- `tests/scenarios/T25.scenarios.ts`
- `tests/tasks/T25.test.ts`

**Interfaces:** Consumes Attachment, Project/ClientRequest authorization and workspace/sandbox facilities. Produces DocumentVersion through DocumentService.ingest and the additive document storage migration. Exact common shapes are in `contracts/domain.schema.json` and `contracts/interfaces.ts`; no undocumented second schema.

- [ ] **1. Prepare the fixture.** A disposable project, all seven approved format families, a mismatched MIME file, a safe macro-canary OOXML, path/size/ratio canaries, and a second unauthorized project.

- [ ] **2. Write the failing test and actual executor.** The executor must perform:
  1. Upload/register valid files through the actual authenticated API and verify immutable bytes/metadata.
  2. Attempt macro/remote-template activation, forged type, cross-project version binding and oversized expansion in restricted workers.
  3. Interrupt parsing and retry the same idempotency key; verify one source identity and bounded cleanup.

```ts
// tests/tasks/T25.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { exerciseScenario } from '../harness/registry.js';
import '../scenarios/T25.scenarios.js';
test('AT-025: Safe document ingestion and immutable source versions', async () => {
  const result = await exerciseScenario('AT-025');
  assert.equal(result.scenario_id, 'AT-025');
  const expected = {
  "valid_files_stored_with_exact_digest": true,
  "upload_not_misreported_as_analyzed": true,
  "macro_and_network_canaries_not_executed": true,
  "size_and_expansion_limits_enforced": true,
  "cross_project_access_denied": true,
  "retry_preserves_one_source_identity": true
};
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(result.observed[key], value, key);
  }
  assert.ok(result.artifact_paths.length > 0, 'retain actual execution evidence');
});
```

- [ ] **3. Run RED and record the observed failure.**

```bash
node --import tsx --test tests/tasks/T25.test.ts
```

A missing boundary during initial development is not a pass. Once executable, demonstrate the failed behavior or known defect; unavailable credentials/tooling mean blocked, never skipped-green.

- [ ] **4. Implement this component.** Implement Attachment validation and DocumentService.ingest. Server resolves opaque IDs, examines bytes and OOXML parts, enforces quotas before conversion, stores originals outside worker write access and queues safe parsing. Production migration must preserve existing software rows. Use per-job process isolation and an environment allowlist; do not trust the file extension or shell command supplied by a model. Bind pipeline versions and observed safety status. Test interruption with a dummy parser in early integration, then a real pinned parser to satisfy the gate.

```text
upload -> content/size/container inspection -> immutable source identity
       -> quarantined isolated parse -> INGESTED or BLOCKED
HTTP 201 = retained record; never complete analysis
```

- [ ] **5. Run GREEN and affected regressions.**

```bash
node --import tsx --test tests/tasks/T25.test.ts
npm run typecheck
npm run test:tasks
```

Commands belong to the product harness established in T01, not this handoff ZIP. No red result, unexecuted output or missing required prerequisite can be recast as green. Preserve failure artifacts and successful final identities.

- [ ] **6. Review and commit.** Inspect the actual diff and evidence against this task and its requirement IDs. Use separate technical review for protected policy/authority changes, check resource cleanup and source privacy, stage only intentional changes and commit with a message beginning `T25:`. Task completion does not itself authorize production release.

## T26: Extraction, visual inventory and version-specific references

**Owner:** Document processing + QA  
**Dependencies:** T25, T09, T10  
**Requirements:** FR-48, FR-55, NFR-17, NFR-18  
**Gate:** AT-026, actual product execution.

**Files to create or modify:**
- `packages/documents/src/extract.ts`
- `packages/documents/src/inventory.ts`
- `packages/documents/src/locators.ts`
- `packages/documents/src/pipeline.ts`
- `fixtures/documents/coverage/`
- `tests/scenarios/T26.scenarios.ts`
- `tests/tasks/T26.test.ts`

**Interfaces:** Consumes ingested DocumentVersion and permitted provider tool capabilities. Produces DocumentScope/DocumentCitation and extracted unit references; later analysis consumes opaque versioned artifacts. Exact common shapes are in `contracts/domain.schema.json` and `contracts/interfaces.ts`; no undocumented second schema.

- [ ] **1. Prepare the fixture.** Synthetic PDF with native text and one scanned page; DOCX with body/table/header/footnote/revision; XLSX with hidden sheet and 1,501 rows; PPTX with chart; image with unclear small text.

- [ ] **2. Write the failing test and actual executor.** The executor must perform:
  1. Build actual complete inventories before model selection; extract text and relevant visual artifacts using qualified tools.
  2. Seek known clauses in notes, page two, a hidden sheet and row 1,501; validate every cited locator against immutable content.
  3. Disable OCR/rendering for a required unit and request full review; verify partial status and explicit limitations.

```ts
// tests/tasks/T26.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { exerciseScenario } from '../harness/registry.js';
import '../scenarios/T26.scenarios.js';
test('AT-026: Extraction, visual inventory and version-specific references', async () => {
  const result = await exerciseScenario('AT-026');
  assert.equal(result.scenario_id, 'AT-026');
  const expected = {
  "all_required_units_inventoried": true,
  "hidden_and_late_rows_not_dropped": true,
  "citations_resolve_to_exact_source_version": true,
  "relevant_visuals_actually_inspected": true,
  "unreadable_units_reported": true,
  "truncation_cannot_become_complete": true
};
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(result.observed[key], value, key);
  }
  assert.ok(result.artifact_paths.length > 0, 'retain actual execution evidence');
});
```

- [ ] **3. Run RED and record the observed failure.**

```bash
node --import tsx --test tests/tasks/T26.test.ts
```

A missing boundary during initial development is not a pass. Once executable, demonstrate the failed behavior or known defect; unavailable credentials/tooling mean blocked, never skipped-green.

- [ ] **4. Implement this component.** Implement DocumentService.defineScope with typed DocumentScope units. Track inventory/source/pipeline digests, deterministic locator mapping and completed stage coverage. Use extraction first and targeted visual/OCR fallback for required unreadable regions. Store page/shape/part and sheet/cell provenance before summarization. Chunking may limit model context but not scope accounting. Test real bounds/order and duplicate IDs in service validation. Create-from-brief uses generated_output scope, not invented source pages.

```text
inventory(source bytes) -> required unit set
extract/inspect(unit) -> observed coverage + source locator
missing required unit -> PARTIAL, never full-file completion
```

- [ ] **5. Run GREEN and affected regressions.**

```bash
node --import tsx --test tests/tasks/T26.test.ts
npm run typecheck
npm run test:tasks
```

Commands belong to the product harness established in T01, not this handoff ZIP. No red result, unexecuted output or missing required prerequisite can be recast as green. Preserve failure artifacts and successful final identities.

- [ ] **6. Review and commit.** Inspect the actual diff and evidence against this task and its requirement IDs. Use separate technical review for protected policy/authority changes, check resource cleanup and source privacy, stage only intentional changes and commit with a message beginning `T26:`. Task completion does not itself authorize production release.

## T27: Cross-document reasoning, questions and source-change invalidation

**Owner:** Product analyst + Document reviewer  
**Dependencies:** T26, T13  
**Requirements:** FR-50, FR-53, FR-54, NFR-17  
**Gate:** AT-027, actual product execution.

**Files to create or modify:**
- `packages/documents/src/analyze.ts`
- `packages/documents/src/conflicts.ts`
- `packages/documents/src/dependencies.ts`
- `packages/documents/src/questions.ts`
- `fixtures/documents/conflicts/`
- `tests/scenarios/T27.scenarios.ts`
- `tests/tasks/T27.test.ts`

**Interfaces:** Consumes DocumentScope, DocumentCitation and ClientRequest. Produces DocumentFinding, DocumentQuestion/Answer and source links in Contract/Requirement; DocumentService.analyze/answer are the public methods. Exact common shapes are in `contracts/domain.schema.json` and `contracts/interfaces.ts`; no undocumented second schema.

- [ ] **1. Prepare the fixture.** PDF says cancellation is allowed within 24 hours; DOCX says 48 hours; a price workbook differs from both. A subsequent upload changes one material rule. Source content includes an instruction to ignore access controls.

- [ ] **2. Write the failing test and actual executor.** The executor must perform:
  1. Run DocumentService.analyze against the scope and retain two precise citations for a conflict.
  2. Ask the authentic client one material question; apply the answer only to its job/revision and record derived software requirements when requested.
  3. Change source bytes, revoke access, and replay the old answer/result; verify dependency invalidation and deny stale or cross-project reads.

```ts
// tests/tasks/T27.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { exerciseScenario } from '../harness/registry.js';
import '../scenarios/T27.scenarios.js';
test('AT-027: Cross-document reasoning, questions and source-change invalidation', async () => {
  const result = await exerciseScenario('AT-027');
  assert.equal(result.scenario_id, 'AT-027');
  const expected = {
  "conflicts_have_both_source_locations": true,
  "facts_and_suggestions_distinguished": true,
  "client_answer_not_invented": true,
  "changed_sources_invalidate_derived_results": true,
  "access_revocation_applies_to_cache": true,
  "document_text_cannot_grant_authority": true
};
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(result.observed[key], value, key);
  }
  assert.ok(result.artifact_paths.length > 0, 'retain actual execution evidence');
});
```

- [ ] **3. Run RED and record the observed failure.**

```bash
node --import tsx --test tests/tasks/T27.test.ts
```

A missing boundary during initial development is not a pass. Once executable, demonstrate the failed behavior or known defect; unavailable credentials/tooling mean blocked, never skipped-green.

- [ ] **4. Implement this component.** Use original client requests plus extracted evidence. Classify assertions, tie requirements to DocumentCitation and source_document_version_ids, persist unresolved conflicts and job questions transactionally. Do not silently prefer newer filenames or aggregate model votes. The controller processes authenticated answers and fences outdated instruction revisions. Dependency invalidation covers current contracts, contexts, result delivery and affected release evidence, while retaining permitted historical hashes. Existing code work is not started by an analysis-only request.

```text
source revision -> dependency lookup -> fence active attempts
               -> current outputs STALE -> bounded reanalysis
client answer -> exact open question + revision -> resolve or conflict
```

- [ ] **5. Run GREEN and affected regressions.**

```bash
node --import tsx --test tests/tasks/T27.test.ts
npm run typecheck
npm run test:tasks
```

Commands belong to the product harness established in T01, not this handoff ZIP. No red result, unexecuted output or missing required prerequisite can be recast as green. Preserve failure artifacts and successful final identities.

- [ ] **6. Review and commit.** Inspect the actual diff and evidence against this task and its requirement IDs. Use separate technical review for protected policy/authority changes, check resource cleanup and source privacy, stage only intentional changes and commit with a message beginning `T27:`. Task completion does not itself authorize production release.

## T28: Full-workbook computation and safe spreadsheet edits

**Owner:** Data/Spreadsheet engineer + QA  
**Dependencies:** T26  
**Requirements:** FR-49, FR-51, NFR-17, NFR-19  
**Gate:** AT-028, actual product execution.

**Files to create or modify:**
- `packages/documents/src/spreadsheet.ts`
- `packages/documents/src/calculation.ts`
- `packages/documents/src/csv.ts`
- `fixtures/documents/workbooks/`
- `tests/scenarios/T28.scenarios.ts`
- `tests/tasks/T28.test.ts`

**Interfaces:** Consumes DocumentScope with numeric_required units. Produces computation evidence linked to DocumentResult.calculation_status and new DocumentArtifact bytes. Public access remains DocumentService; calculator transport is internal and restricted. Exact common shapes are in `contracts/domain.schema.json` and `contracts/interfaces.ts`; no undocumented second schema.

- [ ] **1. Prepare the fixture.** A synthetic workbook has 1,500 line items at 100 centavos and row 1,501 at 250 centavos: total 150250. Include a hidden adjustment sheet, stale cached total, unsupported function, blocked external link, zero-prefixed ID and CSV formula-injection canary.

- [ ] **2. Write the failing test and actual executor.** The executor must perform:
  1. Inventory and compute every requested row and dependency; compare actual engine output to independently calculated known expectations.
  2. Edit an input and recalculate using a qualified engine; reopen and inspect formulas, types and named ranges.
  3. Run unsupported/external-dependency cases and export untrusted CSV text without executing formulas.

```ts
// tests/tasks/T28.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { exerciseScenario } from '../harness/registry.js';
import '../scenarios/T28.scenarios.js';
test('AT-028: Full-workbook computation and safe spreadsheet edits', async () => {
  const result = await exerciseScenario('AT-028');
  assert.equal(result.scenario_id, 'AT-028');
  const expected = {
  "row_1501_affects_checked_total": true,
  "cached_values_not_called_recalculated": true,
  "hidden_dependencies_included": true,
  "missing_calculation_engine_blocks_numeric_ready": true,
  "unsupported_formulas_reported": true,
  "identifiers_and_money_rounding_preserved": true,
  "csv_canary_not_executed": true
};
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(result.observed[key], value, key);
  }
  assert.ok(result.artifact_paths.length > 0, 'retain actual execution evidence');
});
```

- [ ] **3. Run RED and record the observed failure.**

```bash
node --import tsx --test tests/tasks/T28.test.ts
```

A missing boundary during initial development is not a pass. Once executable, demonstrate the failed behavior or known defect; unavailable credentials/tooling mean blocked, never skipped-green.

- [ ] **4. Implement this component.** Do not use openpyxl as a calculator. Use a qualified calculation engine in an isolated profile, with disabled macros/external refresh, and record exact inputs, function support, engine version and resulting workbook hash. Arithmetic checks use explicit integer/decimal units. Compare independently derived expected totals against the engine; do not reuse the same erroneous formula as the sole oracle. Preserve formulas/types and make values-only export explicit. Different engine output or unsupported functions yield bounded limitations, not silent substitution.

```text
expected_total_centavos = 1500 * 100 + 250  # 150250
actual = isolated_calculation(workbook_version)
actual != expected OR unresolved required dependency -> UNVERIFIED
```

- [ ] **5. Run GREEN and affected regressions.**

```bash
node --import tsx --test tests/tasks/T28.test.ts
npm run typecheck
npm run test:tasks
```

Commands belong to the product harness established in T01, not this handoff ZIP. No red result, unexecuted output or missing required prerequisite can be recast as green. Preserve failure artifacts and successful final identities.

- [ ] **6. Review and commit.** Inspect the actual diff and evidence against this task and its requirement IDs. Use separate technical review for protected policy/authority changes, check resource cleanup and source privacy, stage only intentional changes and commit with a message beginning `T28:`. Task completion does not itself authorize production release.

## T29: Document editing, technical writing and verified exports

**Owner:** Technical writer + Editor + Independent QA  
**Dependencies:** T27, T28, T06, T08  
**Requirements:** FR-51, FR-52, FR-54, NFR-19  
**Gate:** AT-029, actual product execution.

**Files to create or modify:**
- `packages/documents/src/author.ts`
- `packages/documents/src/render.ts`
- `packages/documents/src/qa.ts`
- `packages/documents/src/artifacts.ts`
- `fixtures/documents/exports/`
- `tests/scenarios/T29.scenarios.ts`
- `tests/tasks/T29.test.ts`

**Interfaces:** Consumes DocumentFinding, protected verification facilities and DocumentArtifact/Result. Produces validated editable/view artifacts and externally authenticated qa_evidence_ref; DocumentService.getResult never trusts a worker-owned result file. Exact common shapes are in `contracts/domain.schema.json` and `contracts/interfaces.ts`; no undocumented second schema.

- [ ] **1. Prepare the fixture.** A draft DOCX with a cancellation rule, tables, comments and special fonts; XLSX formulas; a PPTX chart; a generated PDF; and API documentation for a disposable service whose documented parameter differs from its implementation.

- [ ] **2. Write the failing test and actual executor.** The executor must perform:
  1. Improve wording without changing cancellation meaning and produce new editable bytes without altering originals.
  2. Execute actual API snippets, update incorrect docs from verified implementation, reopen outputs and render changed/high-risk pages.
  3. Inject clipped text, missing table content, flattened editable chart, altered rule and forged worker QA; verify rejection or explicit narrower fidelity before delivery.

```ts
// tests/tasks/T29.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { exerciseScenario } from '../harness/registry.js';
import '../scenarios/T29.scenarios.js';
test('AT-029: Document editing, technical writing and verified exports', async () => {
  const result = await exerciseScenario('AT-029');
  assert.equal(result.scenario_id, 'AT-029');
  const expected = {
  "original_bytes_unchanged": true,
  "requested_editable_outputs_reopen": true,
  "business_meaning_preserved": true,
  "api_examples_executed_against_target_version": true,
  "rendered_layout_failures_caught": true,
  "worker_cannot_forge_document_ready": true,
  "artifact_download_matches_verified_digest": true
};
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(result.observed[key], value, key);
  }
  assert.ok(result.artifact_paths.length > 0, 'retain actual execution evidence');
});
```

- [ ] **3. Run RED and record the observed failure.**

```bash
node --import tsx --test tests/tasks/T29.test.ts
```

A missing boundary during initial development is not a pass. Once executable, demonstrate the failed behavior or known defect; unavailable credentials/tooling mean blocked, never skipped-green.

- [ ] **4. Implement this component.** Use a versioned authoring plan and content-preservation inventory. An output artifact is accepted only after relevant semantic, numerical and visual checks by the protected verifier. Keep file-format engine and source versions in QA identity. Select editor versus technical writer procedures by requested outcome. No unsupplied statistics, fake features or silent flattening of required editable elements. Sampling of large documents is declared. Only authenticated project-scoped downloads expose artifacts. A hash or passing serialization is not layout or meaning proof.

```text
source + requested edits -> new artifact bytes
reopen -> semantic/numeric checks -> render + inspect
protected QA(source scope, revision, artifact digest) -> current result
```

- [ ] **5. Run GREEN and affected regressions.**

```bash
node --import tsx --test tests/tasks/T29.test.ts
npm run typecheck
npm run test:tasks
```

Commands belong to the product harness established in T01, not this handoff ZIP. No red result, unexecuted output or missing required prerequisite can be recast as green. Preserve failure artifacts and successful final identities.

- [ ] **6. Review and commit.** Inspect the actual diff and evidence against this task and its requirement IDs. Use separate technical review for protected policy/authority changes, check resource cleanup and source privacy, stage only intentional changes and commit with a message beginning `T29:`. Task completion does not itself authorize production release.

## T30: Quiet document-job UI, durable lifecycle and mixed-work recovery

**Owner:** Full-stack + Platform + UX  
**Dependencies:** T29, T15, T16, T17  
**Requirements:** FR-47, FR-53, FR-55, FR-60, NFR-18, NFR-20  
**Gate:** AT-030, actual product execution.

**Files to create or modify:**
- `apps/console/src/features/documents/`
- `apps/controller/src/document-routes.ts`
- `packages/documents/src/jobs.ts`
- `packages/documents/src/recovery.ts`
- `packages/core/src/work-admission.ts`
- `tests/scenarios/T30.scenarios.ts`
- `tests/tasks/T30.test.ts`

**Interfaces:** Consumes DocumentService and controller session/event/budget facilities. Produces implemented document HTTP routes, quiet console features, durable job/attempt/outbox behavior and authenticated artifact delivery. Exact common shapes are in `contracts/domain.schema.json` and `contracts/interfaces.ts`; no undocumented second schema.

- [ ] **1. Prepare the fixture.** An empty client project with no Git repo, a document-only request, create-from-brief request, a real quote-edit question, simultaneous software/document requests near their shared budget limit, and a restart during export.

- [ ] **2. Write the failing test and actual executor.** The executor must perform:
  1. Use real console/API routes to upload, analyze, answer and download; confirm no software run or deployment prompt is manufactured.
  2. Send changed direction mid-job, pause/cancel/restart and reconcile leases/results/questions without losing the user request.
  3. Start competing job types and reject any double-spend/duplicate side effect; examine default quiet UI and required partial-result notice.

```ts
// tests/tasks/T30.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { exerciseScenario } from '../harness/registry.js';
import '../scenarios/T30.scenarios.js';
test('AT-030: Quiet document-job UI, durable lifecycle and mixed-work recovery', async () => {
  const result = await exerciseScenario('AT-030');
  assert.equal(result.scenario_id, 'AT-030');
  const expected = {
  "document_only_needs_no_git_or_software_run": true,
  "create_without_input_documents_works": true,
  "questions_and_feedback_survive_restart": true,
  "stale_attempts_cannot_deliver": true,
  "software_and_document_budget_shared": true,
  "no_routine_role_reports": true,
  "partial_limitations_still_visible": true,
  "replayed_download_cannot_cross_projects": true
};
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(result.observed[key], value, key);
  }
  assert.ok(result.artifact_paths.length > 0, 'retain actual execution evidence');
});
```

- [ ] **3. Run RED and record the observed failure.**

```bash
node --import tsx --test tests/tasks/T30.test.ts
```

A missing boundary during initial development is not a pass. Once executable, demonstrate the failed behavior or known defect; unavailable credentials/tooling mean blocked, never skipped-green.

- [ ] **4. Implement this component.** Implement the new document API with authentication, CSRF, idempotency and state-version guards. Use separate document state/usage tables under the same trusted admission budget. Broker reserves document and software work transactionally, deduplicates usage, and holds final QA reserve. Use one compact client card for questions/results, with safe attachment previews; no mandatory department dashboard. Persist original messages and artifacts; source revisions invalidate appropriate outputs. Public endpoint semantics and authority must match the OpenAPI design; the absence of a code run is normal.

```text
client request -> document job -> PROCESSING -> VERIFYING
                                  | question           |
                                  v                    v
                             client answer        READY/PARTIAL
software run = absent unless the client requested implementation
```

- [ ] **5. Run GREEN and affected regressions.**

```bash
node --import tsx --test tests/tasks/T30.test.ts
npm run typecheck
npm run test:tasks
```

Commands belong to the product harness established in T01, not this handoff ZIP. No red result, unexecuted output or missing required prerequisite can be recast as green. Preserve failure artifacts and successful final identities.

- [ ] **6. Review and commit.** Inspect the actual diff and evidence against this task and its requirement IDs. Use separate technical review for protected policy/authority changes, check resource cleanup and source privacy, stage only intentional changes and commit with a message beginning `T30:`. Task completion does not itself authorize production release.

## Milestone exit

G7 requires real document fixtures, outputs and workflow evidence from T25–T30; source/schema checks alone are insufficient.
