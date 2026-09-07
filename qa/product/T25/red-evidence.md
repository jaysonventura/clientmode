# AT-025 — red evidence

Gate: `tests/tasks/T25.test.ts`, executor `tests/scenarios/T25.scenarios.ts`.
Command: `node --import tsx --test tests/tasks/T25.test.ts`.
Task: Document ingestion, immutable sources, and container safety.

## What was executed

Nine format families uploaded through the real store into a real database, each round-tripped byte-for-byte from storage; nine canaries inspected and refused. The macro part and the remote template are recorded as findings — nothing was executed and no external target was fetched. A workbook's external data link does **not** refuse the upload: the link is disabled and any calculation depending on it is UNVERIFIED, which is a different thing from an activation vector.

## Mutations proving the assertions are load-bearing

Each mutation removes one named production control, the gate is run, and the mutation is
reverted.

| # | Mutation | Result | Observation that flipped |
|---|----------|--------|--------------------------|
| `N1` | macro parts no longer refuse the upload (`packages/documents/src/ingest.ts`) | **RED** | macro_and_network_canaries_not_executed |
| `N12` | revoked access still serves the bytes (`packages/documents/src/ingest.ts`) | **RED** | access_revocation_applies_to_cache, cross_project_access_denied |
| `N2` | container compression ratio not checked (`packages/documents/src/zip.ts`) | **RED** | size_and_expansion_limits_enforced |
| `N3` | stored bytes readable from any project (`packages/documents/src/ingest.ts`) | **RED** | cross_project_access_denied |
| `N4` | a replayed upload creates a second source identity (`packages/documents/src/ingest.ts`) | **RED** | the scenario raised before the assertions |

## Scope

All fixtures are synthetic and generated from `fixtures/documents/corpus.ts`, where the expected
answers are declared before any reader runs. No client content, no licensed assets, no network
access, and no external document service.
