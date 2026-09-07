# AT-022 — red evidence

Gate: `tests/tasks/T22.test.ts`, executor `tests/scenarios/T22.scenarios.ts`.
Command: `node --import tsx --test tests/tasks/T22.test.ts` (about 60 s).

## What was executed

**Trial tooling, on small synthetic observations first.** Three hand-written trials containing a
failure, a blocked run, a duplicate usage event, an unknown cost and an orphan usage event. The
denominators, the cost roll-up and the usage accounting are checked against them before any real
number is quoted.

**The pilot.** 20 predeclared task specs x 3 arms x 3 repeats = **180 trials**, each a real
verification through the protected authority: real Seatbelt execution, real TAP parsing, real
Ed25519-sealed evidence, real `decideReadiness`. Order drawn once from seed `20260909` and
interleaved; every spec runs every arm against one frozen snapshot; one external grader and one
budget policy for all arms.

The arms differ in exactly one thing — what the worker runs before it says the work is ready:

| Arm | Pre-claim checks the worker runs itself |
|---|---|
| `native_single` | none |
| `clientmode_single` | its own unit check |
| `clientmode_bounded_agents` | its own unit check plus an independent reviewer's semantic check |

The protected grader always runs both checks, for every arm. It cannot be narrowed — the
coordinator takes required checks from the policy and `requested_check_ids` can only add.

## Recorded result

| Arm | n | accepted | rejected | blocked | false-ready | accepted rate | 95% interval |
|---|---|---|---|---|---|---|---|
| `native_single` | 60 | 36 | 12 | 12 | 12 | 0.600 | 0.474 – 0.714 |
| `clientmode_single` | 60 | 39 | 9 | 12 | 9 | 0.650 | 0.524 – 0.758 |
| `clientmode_bounded_agents` | 60 | 48 | 0 | 12 | 0 | 0.800 | 0.682 – 0.882 |

Cost: 320,097 µUSD known, 56 events with no settled cost reserved at 50,000 µUSD each, total
3,120,097 µUSD, coverage **partial**. 11 duplicate usage events flagged, 67 events flagged in
total, 255 accounted; nothing dropped.

**The intervals overlap, so no arm is claimed better than another.** The report says so, and the
claim linter enforces it: the three sentences it would be tempting to write were put through the
same linter and all three were refused (`CONFIDENCE_INTERVALS_OVERLAP`, `BLOCKED_TRIALS_IN_SAMPLE`,
`SAMPLE_INCOMPLETE`, `COST_COVERAGE_PARTIAL`, `SIMULATED_ARM_NOT_A_LIVE_RESULT`).

## What was not executed

- **The live provider pilot is BLOCKED**, reason `NO_APPROVED_METERED_EVALUATION_BUDGET`. AT-022's
  preconditions require an approved metered evaluation budget; none is configured. The arm is
  retained in the report as blocked rather than dropped from the design, and no live comparison is
  reported.
- The pilot's worker is a **deterministic simulated worker**, declared as such in the report and
  named in the linter's `simulated_arms`, which is why every comparative sentence about these arms
  is refused as `SIMULATED_ARM_NOT_A_LIVE_RESULT`.
- 36 of the 180 trials are **blocked on missing environments** (`go`, `kotlinc`, and the iOS
  simulator toolchain for one spec). They stay in every denominator and each carries its reason.

## Mutations proving the assertions are load-bearing

| # | Mutation | Result | Observation that flipped |
|---|----------|--------|--------------------------|
| A1 | `aggregate.ts` — blocked trials dropped from the arm denominator | **RED** | `failures_retained_in_denominator` |
| A2 | `aggregate.ts` — unknown cost reserved at zero | **RED** | `unknown_cost_explicit` |
| A3 | `aggregate.ts` — duplicate usage events dropped without a flag | **RED** | `all_worker_usage_accounted_or_flagged` |
| A4 | `trial.ts` — snapshot digest allowed to differ per arm | **RED** | `comparison_protocol_followed` |
| A5 | `claims.ts` — linter stops recognising comparative language | **RED** | `unsupported_superiority_claims_absent` |
| A6 | `aggregate.ts` — family results collapsed to one row | **RED** | `per_engineering_family_results_retained` |
| A7 | `trial.ts` — no defects injected, so nothing is ever rejected | **RED** | `failures_retained_in_denominator` (the anti-vacuity guard) |

## A real bug this gate caught

The first pilot run reported **0 accepted trials in all three arms** and the gate was still green,
because the observations at that point only checked the shape of the aggregation. The cause was in
the harness, not the product: the trial graded evidence with a constant `now` while the
coordinator stamped it from an advancing clock, so every verdict failed on `EVIDENCE_TIME`.

Two changes followed. `TrialContext` now carries the clock and each trial takes its creation
instant before verification and its grading instant after, and the gate now refuses a run with no
accepted trials or no rejected trials — a benchmark where everything lands the same way measures
nothing. A7 is the mutation that proves that guard bites.
