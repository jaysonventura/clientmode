# AT-027 — red evidence

Gate: `tests/tasks/T27.test.ts`, executor `tests/scenarios/T27.scenarios.ts`.
Command: `node --import tsx --test tests/tasks/T27.test.ts`.
Task: Cross-document reasoning, questions, and source changes.

## What was executed

Three sources state the cancellation rule differently. The conflict carries all three locations, every one resolved against the bytes. One question goes to the client; a worker's answer is refused; the derived requirement exists only because the client answered. A new instruction supersedes the open question, a re-uploaded source marks the derived result stale without touching the old version, and a revoked attachment stops serving bytes even for a citation that resolved a moment earlier. The instruction planted inside the DOCX is recorded as an observation and grants nothing.

## Mutations proving the assertions are load-bearing

Each mutation removes one named production control, the gate is run, and the mutation is
reverted.

| # | Mutation | Result | Observation that flipped |
|---|----------|--------|--------------------------|
| `N10` | any actor may answer a document question (`packages/documents/src/jobs.ts`) | **RED** | client_answer_not_invented |
| `N11` | a changed source invalidates nothing (`packages/documents/src/jobs.ts`) | **RED** | changed_sources_invalidate_derived_results |
| `N12` | revoked access still serves the bytes (`packages/documents/src/ingest.ts`) | **RED** | access_revocation_applies_to_cache, cross_project_access_denied |
| `N9b` | both conflict-location checks removed (`several files`) | **RED** | conflicts_have_both_source_locations |

## Mutations a second control caught

- `N9` — a conflict may cite one location — the gate stayed green because another control still refused it. The paired mutation that removes both is in the table above.

## Scope

All fixtures are synthetic and generated from `fixtures/documents/corpus.ts`, where the expected
answers are declared before any reader runs. No client content, no licensed assets, no network
access, and no external document service.
