# AT-026 — red evidence

Gate: `tests/tasks/T26.test.ts`, executor `tests/scenarios/T26.scenarios.ts`.
Command: `node --import tsx --test tests/tasks/T26.test.ts`.
Task: Document inventory, extraction, and citation integrity.

## What was executed

Inventories are built from the files before extraction: 3 PDF pages, 12 DOCX blocks with the comment and the revision, 2 sheets of which one is hidden, 1,501 rows covered by non-overlapping ranges with no gaps, 2 slides with a chart. Five citations resolve against the stored bytes and six do not, each for its own recorded reason. `pdftotext 26.03.0` extracted the text; the scanned page has no text layer and says so.

## Mutations proving the assertions are load-bearing

Each mutation removes one named production control, the gate is run, and the mutation is
reverted.

| # | Mutation | Result | Observation that flipped |
|---|----------|--------|--------------------------|
| `N5` | hidden sheets left out of the inventory (`packages/documents/src/inventory.ts`) | **RED** | hidden_and_late_rows_not_dropped |
| `N6` | sheet ranges capped at the first thousand rows (`packages/documents/src/inventory.ts`) | **RED** | hidden_and_late_rows_not_dropped |
| `N7` | a cited excerpt is taken on trust (`packages/documents/src/extract.ts`) | **RED** | citations_resolve_to_exact_source_version |
| `N8` | coverage reports complete despite unreadable units (`packages/documents/src/extract.ts`) | **RED** | unreadable_units_reported |

## Scope

All fixtures are synthetic and generated from `fixtures/documents/corpus.ts`, where the expected
answers are declared before any reader runs. No client content, no licensed assets, no network
access, and no external document service.
