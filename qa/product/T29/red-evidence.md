# AT-029 — red evidence

Gate: `tests/tasks/T29.test.ts`, executor `tests/scenarios/T29.scenarios.ts`.
Command: `node --import tsx --test tests/tasks/T29.test.ts`.
Task: Document editing, technical writing, export, and protected document QA.

## What was executed

The original DOCX is byte-identical on disk and in storage after the edit; the new version reopens with its sections, comments and revisions. An edit that would have changed the cancellation window from 48 to 72 hours fails the meaning check. The exported report renders through Ghostscript 10.05.1 and every page is measured for ink; a clipped variant comes back blank and is caught. The documented API example fails against the running service, the documentation is corrected from what the implementation accepted, and the corrected example passes against version 2.4.0. Seven forged evidence variants are refused, the software evaluator refuses to open document evidence at all, and only the document authority can award READY.

## Mutations proving the assertions are load-bearing

Each mutation removes one named production control, the gate is run, and the mutation is
reverted.

| # | Mutation | Result | Observation that flipped |
|---|----------|--------|--------------------------|
| `N17` | the meaning check always passes (`packages/documents/src/edit.ts`) | **RED** | business_meaning_preserved |
| `N18` | blank rendered pages are not reported (`packages/documents/src/edit.ts`) | **RED** | rendered_layout_failures_caught |
| `N19` | any actor may sign document evidence (`packages/verifier/src/evidence.ts`) | **RED** | worker_cannot_forge_document_ready |
| `N20` | a download is served without checking its digest (`packages/documents/src/edit.ts`) | **RED** | artifact_download_matches_verified_digest |

## Scope

All fixtures are synthetic and generated from `fixtures/documents/corpus.ts`, where the expected
answers are declared before any reader runs. No client content, no licensed assets, no network
access, and no external document service.
