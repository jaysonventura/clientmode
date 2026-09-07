# AT-021 — red evidence

Gate: `tests/tasks/T21.test.ts`, executor `tests/scenarios/T21.scenarios.ts`.
Command: `node --import tsx --test tests/tasks/T21.test.ts`.

The suite executes **38 attacks** against the real services (protected policy store, verification
coordinator, Seatbelt executor, lifecycle service, budget ledger, approval authority, release
deployer, live browser, native binary, model-evaluation grounder) and records each rejection with
the reason the production code actually produced. Evidence: `adversarial.json`, `attacks.json`.

These are the **public** mutation fixtures from `docs/QUALIFICATION.md` section 3. They are
engineering regressions, not held-out proof. The unseen holdout set belongs to AT-023 and is
authored separately.

## Mutations proving the assertions are load-bearing

Each mutation was applied to the implementation (or, where stated, the fixture), the gate was run,
and the mutation was reverted.

| # | Mutation | Result | Observation that flipped |
|---|----------|--------|--------------------------|
| M1 | `verdict.ts` — removed the test-count floor (`tests_total < minimum_tests \|\| tests_skipped !== 0`) | **RED** | `every_mandatory_public_attack_rejected` — `zero-tests-discovered` was accepted |
| M2 | `deploy.ts` — stopped enforcing `consumeApproval` | **RED** | the replayed approval reached the insert and was stopped by `UNIQUE(deployments.approval_id)`; see "defence in depth" below |
| M3a | `leases.ts` — removed the `ATTEMPT_REVOKED` check | green | second control (`STALE_LEASE_EPOCH`) still rejected the late result |
| M3b | `leases.ts` — removed `ATTEMPT_REVOKED` **and** `STALE_LEASE_EPOCH` | green | third control (`LEASE_NOT_ACTIVE`) still rejected it |
| M3c | `leases.ts` — removed all three fence controls | **RED** | `late_worker_results_quarantined` — both `orphan-cancellation-late-result` and `late-patch-integration` were accepted |
| M4 | `composite.ts` — removed the target-substitution check | **RED** | `cross_stack_false_ready_mutations_rejected` — a browser observation was accepted for an iOS component |
| M5a | `database.ts` — `PRAGMA foreign_keys = OFF` | green | `contracts/storage/controller.sql` sets the pragma again on the same connection |
| M5b | `database.ts` **and** `controller.sql` — `PRAGMA foreign_keys = OFF` | **RED** | `contract_sql_api_invariants_regression` — a candidate inserted against a run that does not exist (`sql_cross_run.ok = true`) |
| M6 | `deploy.ts` — `reconcile` returns `ABSENT` without asking the destination | **RED** | `late_instruction_cannot_silently_reverse_deploy` |
| M7 | fixture `shop/server.mjs` — removed the injected `negative-quantity` defect | **RED** | `semantic_defects_rejected_despite_green_unit_tests` — the probe no longer observed the defect it is there to catch |

## Defence in depth found while mutating

Three mutations did not turn the gate red on their own, because a second independent control
caught the attack. This is recorded rather than smoothed over, because it is the finding:

- **Approval replay (M2)** is guarded twice: `consumeApproval` refuses with `ALREADY_CONSUMED`, and
  `deployments.approval_id` carries a UNIQUE constraint. With the first removed the second still
  prevented a second promotion, so `promote` was still called exactly once. The gate went red on
  the raised `ERR_SQLITE_ERROR`, not on an accepted attack.
- **Late worker results (M3)** are guarded three times: attempt status, lease epoch, and lease
  activity. All three had to be removed before a cancelled worker's result was integrated.
- **Referential integrity (M5)** is enabled in two places: the connection pragma in `database.ts`
  and the schema file `controller.sql`. Both had to be disabled.

## Scope statement

`no_unauthorized_external_effects` is observed against the in-process mock destination and counts
its `promote` calls (exactly 1 for 2 deploy attempts). No public deployment, paid service or
production action was performed; all fixtures are synthetic.
