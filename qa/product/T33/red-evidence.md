# AT-033 — red evidence

Gate: `tests/tasks/T33.test.ts`, executor `tests/scenarios/T33.scenarios.ts`.
Command: `node --import tsx --test tests/tasks/T33.test.ts`.

This is the closing gate. It is a sweep, not a new feature.

## What was executed

**Every format, read and exported.** Seven files uploaded through the real store, inventoried,
extracted and exported: an edited DOCX, a workbook, a deck and a two-page PDF report, each
reopened by an independent read path. The report was rendered through Ghostscript and every page
measured for ink — no page came back blank and no expected string was missing.

**Known defects, planted and caught.** The workbook's two cached totals (150,000 and 145,000) are
both reported as differing from the recalculation (150,250 and 145,250). A second workbook that
silently drops row 1,501 sums to 150,000 while its cached value claims 150,250, and that
disagreement is reported rather than smoothed over. Three bad citations are refused — a page that
does not exist, an excerpt that is not at the locator, and a digest from a different version —
and the good one resolves.

**Partial and forged results.** A complete evidence set is `READY_FOR_SCOPE`. The same evidence
with one required check removed is `UNVERIFIED` with `MISSING_CHECK_outputs_reopen`; with
`integrity_passed: false` it is `UNVERIFIED` with `INTEGRITY_FAILED`; and a numeric request with
no calculation engine is refused readiness outright.

**All 33 gates.** Each of `T01`–`T33` is checked for a test file, an executor, retained JSON
artifacts and a red-evidence write-up. 33 evidenced, 0 no-go.

**Cross-stack is not replaced by document work.** A result set drawn only from the document
fixtures is refused broad-remit qualification as `JAVASCRIPT_ONLY_RESULT_SET`; the four-stack set
qualifies; and AT-023's retained holdout still shows four toolchains executed.

**The comparison counts everything.** Three trials — one accepted, one rejected, one blocked —
give an accepted rate of 1/3 with the blocked trial still in the denominator, two unknown-cost
events reserved at their upper bound, one duplicate flagged, and a confidence interval wider than
0.3. The document usage table shows the same discipline: a duplicate provider event is refused by
the unique constraint and an unsettled cost is stored as unknown, not zero.

**Document state through an upgrade and a restore.** The workbook, the job, the result and the
usage rows all survive a schema upgrade that adds a column, and all survive the restore that takes
it away again. The job is `READY` before, after the upgrade, and after the restore.

**Four signoffs are four.** The job is technically `READY` and the client records
`needs_changes` on the same work; the job stays `READY`, because a client's view is not a
technical verdict and a technical verdict is not acceptance. An agent's attempt to record
satisfaction is refused.

**Only verified, authorised artifacts.** Production is refused with no approval; staging is
allowed with one; the same approval does not authorise a different artifact digest; and a
download whose bytes no longer match the verified digest is refused.

## Mutations proving the assertions are load-bearing

| # | Mutation | Result | Observation that flipped |
|---|----------|--------|--------------------------|
| `P20` | an exported report collapses its sections onto one page (`edit.ts`) | **RED** | `real_document_formats_and_exports_qualified` |
| `P14` | a cached spreadsheet value is reported as matching (`calc.ts`) | **RED** | `known_numeric_and_citation_defects_caught` |
| `P13` | a missing required check no longer refuses the document verdict (`document-verifier/verdict.ts`) | **RED** | `partial_or_forged_results_never_full_ready` |
| `P16` | a document-only result set counts as broad-remit (`coverage.ts`) | **RED** | `cross_stack_qualification_not_replaced_by_docs` |
| `P17` | blocked trials dropped from the comparison (`aggregate.ts`) | **RED** | `comparison_counts_all_attempts_and_costs` |
| `P15` | restore does not restore the state (`upgrade.ts`) | **RED** | `new_document_state_survives_upgrade_restore` |
| `P11b` | an agent may record client satisfaction (`service-cases.ts`) | **RED** | `client_acceptance_distinct_from_technical_ready` |
| `P18` | release authorization ignores which artifact was approved (`approvals.ts`) | **RED** | `only_verified_authorized_artifacts_released` |
| `P19` | a blank rendered page passes the export check | green | the report has no blank page to hide, so forcing the flag changes nothing. `P20` breaks the export itself and the gate goes red |

`all_33_task_gates_have_evidence_or_no_go` was observed red for real during construction: the
sweep reported `AT-031` and `AT-032` as `NO_GO` because their red-evidence write-ups did not exist
yet. Writing them turned it green, which is the behaviour the observation is there to produce.

## What this gate does not claim

The provider comparison arms remain simulated and are named as such wherever their numbers appear;
no metered evaluation budget is approved and no live A/B/C pilot was run. Nothing was deployed to
a real destination, no paid service was used, and the release path was rehearsed against a mock
destination in AT-024. OCR and an office suite are not installed, so text inside an image and a
scanned page's text remain unestablished rather than guessed.
