# Mutation matrix

Every mutation below removes one named production control, runs the gates, and is then reverted.
This is the whole record, including the mutations that no gate detected — a mutation that changes
nothing is a coverage gap, and hiding it would defeat the point of running it.

## Mutations a gate caught

| # | Mutation | Gates that went red |
|---|----------|---------------------|
| `K01` | schema validation loosened: type coercion on, strict mode off (`packages/contracts/src/validate.ts`) | AT-007, AT-011, AT-016 |
| `K02` | manifest entries no longer sorted before digesting (`packages/workspace/src/snapshot.ts`) | AT-003 |
| `K03` | symlink targets no longer canonicalised before the escape check (`packages/workspace/src/snapshot.ts`) | AT-003 |
| `K04b` | dispatch depth limit removed (re-run after T04 was strengthened) | AT-004 |
| `K05` | recursive child check removed (`packages/core/src/router.ts`) | AT-004, AT-012 |
| `K06b` | approval expiry ignored when authorising (re-run after T08 was strengthened) | AT-008 |
| `K07b` | approval candidate scope ignored when authorising (re-run after T08 was strengthened) | AT-008 |
| `K08` | Seatbelt deny paths written without canonicalisation (`packages/verifier/src/executor.ts`) | AT-005, AT-007, AT-020 |
| `K09` | evidence attempt binding removed (`packages/verifier/src/verdict.ts`) | AT-007 |
| `K10` | test-count floor removed from the readiness verdict (`packages/verifier/src/verdict.ts`) | AT-007 |
| `K11` | lease epoch fencing removed (`packages/state/src/leases.ts`) | AT-002, AT-012 |
| `K13` | failed attempts excluded from the cost roll-up (`packages/observability/src/metrics.ts`) | AT-019 |
| `K14` | retention holds ignored (`packages/observability/src/metrics.ts`) | AT-019 |
| `K15` | telemetry on by default (`packages/observability/src/metrics.ts`) | AT-019 |
| `K16b` | secret redaction rules emptied | AT-019 |
| `K17` | a configured capability reported as observed working (`packages/providers/src/capabilities.ts`) | AT-009 |
| `K18` | deployment released regardless of the smoke result (`packages/release/src/smoke.ts`) | AT-008, AT-020 |
| `K19` | rollback no longer requires a rollback-scoped approval (`packages/release/src/rollback.ts`) | AT-008 |
| `K21b` | uninstall leaves its files behind (`packages/packaging/src/install.ts`) | AT-017 |
| `K22c` | project memory recall returns every project's facts | AT-013 |
| `K23` | compare-and-swap dropped from the state transition (`packages/core/src/lifecycle.ts`) | AT-002 |
| `K24` | client satisfaction may be recorded by a worker (`packages/core/src/lifecycle.ts`) | AT-016 |
| `K27` | the shop fixture stops injecting its negative-quantity defect (`fixtures/shop/server.mjs`) | AT-006 |
| `K28` | the shop fixture stops injecting its missing-label defect (`fixtures/shop/public/app.js`) | AT-006 |
| `K29` | client exclusions dropped from the interpreted requirements (`packages/core/src/intake.ts`) | AT-013 |
| `K31` | origin check removed from the controller (`apps/controller/src/auth.ts`) | AT-015 |
| `K32` | CSRF token no longer required on mutating requests (`apps/controller/src/auth.ts`) | AT-015 |
| `K34` | a worker credential may open a client session (`apps/controller/src/auth.ts`) | AT-015 |
| `K39` | provider usage coverage defaults to complete (`packages/providers/src/normalize.ts`) | AT-011 |
| `K40` | a shipped skill carries a path back into the build tree (`skills/handoff/SKILL.md`) | AT-017 |
| `K41` | irreversible migrations reported as safe to roll back | AT-018 |
| `K42` | a required design token removed from the fixture stylesheet | AT-014 |
| `K43` | both validator layers removed: per-kind result ignored and the union check dropped | AT-001 |
| `K44` | adapter marker removed from the shipped Claude instructions | AT-010 |

## Coverage by gate

| Gate | Mutations that turn it red |
|---|---|
| AT-001 | `K43` |
| AT-002 | `K11`, `K23` |
| AT-003 | `K02`, `K03` |
| AT-004 | `K04b`, `K05` |
| AT-005 | `K08` |
| AT-006 | `K27`, `K28` |
| AT-007 | `K01`, `K08`, `K09`, `K10` |
| AT-008 | `K06b`, `K07b`, `K18`, `K19` |
| AT-009 | `K17` |
| AT-010 | `K44` |
| AT-011 | `K01`, `K39` |
| AT-012 | `K05`, `K11` |
| AT-013 | `K22c`, `K29` |
| AT-014 | `K42` |
| AT-015 | `K31`, `K32`, `K34` |
| AT-016 | `K01`, `K24` |
| AT-017 | `K21b`, `K40` |
| AT-018 | `K41` |
| AT-019 | `K13`, `K14`, `K15`, `K16b` |
| AT-020 | `K08`, `K18` |

All twenty base gates are covered.

## Mutations no gate detected

| # | Mutation | Why |
|---|----------|-----|
| `K25` | unknown entity kinds accepted instead of refused (`packages/contracts/src/validate.ts`) | defence in depth — the union schema still refuses the entity |
| `K26` | the union check dropped, so a kind-level pass is enough | defence in depth — the per-kind subschema still refuses it. `K43` removes both layers and AT-001 goes red |
| `K36` | per-kind validation result ignored | the same pair, from the other side |
| `K30` | the smallest required viewport removed from the sweep | AT-014 counts observed tokens and journey steps, not the viewport list. `K42` removes a real token from the fixture stylesheet and AT-014 goes red |
| `K37` | missing design tokens reported as present | the assertion compares the count of tokens observed against the contract, so reporting *more* present tokens cannot lower it. `K42` covers the direction that matters |
| `K33` | a failed migration no longer restores the state snapshot | the fixture's failing migration writes nothing before it fails, so the state file is unchanged either way. `K41` covers rollback safety |
| `K38` | the new version is activated before its migrations run | AT-018 asserts state restoration and rollback safety, not activation ordering |
| `K35` | one normalised event kind dropped on the way out | AT-010 reads the adapter's normalised stream for the kinds it needs; a missing usage event is caught by AT-011's coverage assertion instead |
| `K20b` | distribution self-containment forced to `true` | forcing the flag to the value the gate wants cannot make the gate fail. `K40` plants a real path back into the build tree and AT-017 goes red |
| `K12b` | unknown provider cost counted as zero in the attempt split | **an open coverage gap.** AT-019 asserts the unknown reserve in the roll-up total and the failed-attempt cost separately, but its fixture's unknown-cost event does not belong to a failed attempt, so zeroing the reserve inside the split changes no asserted number. Closing it needs an AT-019 fixture where an unknown-cost event belongs to a revoked attempt |
| `K22b` | `ContextStore.current` returns every project's facts | AT-013 exercises `ProjectMemory.recall`, which is a different function. `K22c` mutates the one the gate actually uses and AT-013 goes red. `ContextStore.current` has no gate of its own — a second open gap |

## Superseded mutations

| # | Superseded by | Reason |
|---|---|---|
| `K04` | `K04b` | first run was inconclusive or targeted the wrong function |
| `K06` | `K06b` | first run was inconclusive or targeted the wrong function |
| `K07` | `K07b` | first run was inconclusive or targeted the wrong function |
| `K12` | `K12b` | first run was inconclusive or targeted the wrong function |
| `K16` | `K16b` | first run was inconclusive or targeted the wrong function |
| `K20` | `K40` | first run was inconclusive or targeted the wrong function |
| `K21` | `K21b` | first run was inconclusive or targeted the wrong function |
| `K22` | `K22c` | first run was inconclusive or targeted the wrong function |

## Three coverage gaps this exercise closed

Running the catalogue found three security-relevant controls that no gate exercised. Each was
closed by strengthening the scenario, and the mutation was then re-run to confirm the gate goes
red:

1. **Dispatch depth ceiling** (`Router.admit`). AT-004 tested recursion through a parent's depth
   but never a request that declares a deeper level directly. AT-004 now admits at
   `maximum_depth + 1` and expects `DEPTH_LIMIT`; `K04b` turns it red.
2. **Approval expiry in the authority's own lookup** (`ApprovalAuthority.authorize`). AT-008
   asserted `APPROVAL_EXPIRED` through `checkScope`, which is the release path — a different
   function. AT-008 now asks the authority directly with an expired grant; `K06b` turns it red.
3. **Approval candidate scope in the same lookup.** Same gap, same fix; `K07b` turns it red.

## A note on the first run

The first pass ran the whole 20-gate suite once per mutation, 24 times. That drove the two
live-provider gates, AT-010 and AT-017, over their host's limits, and both were reported red for
every mutation including ones that could not possibly affect them. Both pass on a clean tree.
Their columns from that pass are discarded rather than reported, and their coverage was
re-derived with targeted single-gate runs (`K44`, `K21b`, `K40`).
