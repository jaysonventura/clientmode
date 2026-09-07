# AT-030 — red evidence

Gate: `tests/tasks/T30.test.ts`, executor `tests/scenarios/T30.scenarios.ts`.
Command: `node --import tsx --test tests/tasks/T30.test.ts`.
Task: Document jobs, quiet client experience, and the shared budget.

## What was executed

An empty project with no Git repository carries a document review end to end: no repository is created, no candidate exists, no deployment is prompted. A create-from-brief job runs with no input documents and refuses a fabricated source inventory. The controller is restarted mid-job and the question, the answer, the client's message and the event log are all still there. A changed instruction fences the running attempt. One budget serves both kinds of work: a 600,000 software reservation leaves a 300,000 document reservation refused and a 100,000 one accepted. A partial result keeps its limitation visible in quiet mode, and a download link scoped to one project returns 404 in another.

## Mutations proving the assertions are load-bearing

Each mutation removes one named production control, the gate is run, and the mutation is
reverted.

| # | Mutation | Result | Observation that flipped |
|---|----------|--------|--------------------------|
| `N21` | the document budget ignores software reservations (`packages/documents/src/jobs.ts`) | **RED** | software_and_document_budget_shared |
| `N22` | a partial result shows no limitations (`apps/controller/src/document-routes.ts`) | **RED** | no_routine_role_reports |
| `N23` | a download link is not scoped to its project (`apps/controller/src/document-routes.ts`) | **RED** | replayed_download_cannot_cross_projects |
| `N24` | a create-from-brief scope may carry a fabricated source inventory (`packages/documents/src/inventory.ts`) | **RED** | create_without_input_documents_works |

## Scope

All fixtures are synthetic and generated from `fixtures/documents/corpus.ts`, where the expected
answers are declared before any reader runs. No client content, no licensed assets, no network
access, and no external document service.
