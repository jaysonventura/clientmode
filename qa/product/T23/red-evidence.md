# AT-023 — red evidence

Gate: `tests/tasks/T23.test.ts`, executor `tests/scenarios/T23.scenarios.ts`.
Command: `node --import tsx --test tests/tasks/T23.test.ts` (about 55 s).

## Holdout discipline

The configuration is frozen and its digest computed **before** the holdout module is imported;
both instants are recorded (`frozen_at` 02:00:00, `holdout_opened_at` 02:00:01). A leak scan then
reads 78 files across `skills/`, `adapters/`, `profiles/`, `packages/` and `fixtures/` looking for
any holdout spec id or brief verbatim. Zero hits.

The tokens are spec ids and whole briefs, not single words. An earlier version used every word of
nine characters or more and reported eleven "leaks" — `submission`, `place-order`, `something`.
That is noise, not evidence, and it was replaced.

## What was executed

50 unseen specs x 3 repeats = **150 trials**, none blocked.

- **Categories**: 12 UI, 12 auth/data/integration, 12 paired rough-English/Taglish, 14 cross-stack.
- **Stacks**: TypeScript 51, Python 72, Swift 15, Rust 12 trials. Each trial writes the program in
  that language and **builds and runs it with that language's own toolchain** (`node`, `python3`,
  `swiftc`, `rustc`). No result is inferred from another platform.
- **Defect classes**: `none`, `unit`, `semantic`, `boundary`. The `boundary` defect passes every
  check in the protected policy and is only visible to a reviewer reading the change — it is what
  the independent reviewer exists for.
- **Hosts, live**: `claude` 2.1.263 and `codex` 0.153.4 each ran one real turn and answered.

## Recorded result

| Observation | Value |
|---|---|
| executed / declared | 150 / 150, 0 blocked |
| verified success | 150 / 150 = 1.000 (95% interval 0.975 – 1.000) |
| false-ready | 0 |
| high-severity escaped defects | 0 |
| median unnecessary continue prompts | 0 (classifier separately probed: detects 3 of 4 samples, and correctly leaves the material question alone) |
| paired-language pairs equivalent | 36 / 36 |
| broad remit | qualified; executed stacks TypeScript, Python, Swift, Rust |
| JavaScript-only subset | **not** qualified — `JAVASCRIPT_ONLY_RESULT_SET` |
| responsibility coverage | 15 high-risk tasks, all covered, fan-out 2 children / depth 1, within `DISPATCH_LIMITS` |

The pipeline was not idle: 111 trials had a defect injected, the protected checks caught 75 of
them, the reviewer's source review caught 72, and 111 were repaired within the cycle budget.

**A success rate of 1.000 is not a claim about arbitrary real-world work.** The holdout is
first-party, and what it qualifies is the toolkit's pipeline — defect injection, independent
review, bounded repair, protected verification, post-hoc audit — on work the configuration had
never seen. It is not a provider benchmark: no metered evaluation budget is approved, and the live
host run is two turns, one per advertised host.

## Mutations proving the assertions are load-bearing

| # | Mutation | Result | Observation that flipped |
|---|----------|--------|--------------------------|
| B1 | `execute.ts` — reviewer stops reading the change | **RED** | `critical_high_escaped_defects` 0 → **36**, and `verified_success_at_least_90pct` fails its non-vacuity guard (`reviewer_caught` 72 → 0) |
| B2 | `router.ts` — repair budget cut to zero cycles | **RED** | `verified_success_at_least_90pct` |
| B3 | `skills/verify/SKILL.md` — a holdout brief planted in a shipped skill | **RED** | `holdout_not_used_for_prompt_tuning` |
| B4 | `coverage.ts` — TypeScript counted as a non-JavaScript stack | **RED** | `js_only_qualification_rejected` |
| B5 | `coverage.ts` — every assigned responsibility treated as risk-relevant | **RED** | `company_responsibility_coverage_observed_without_swarms` |
| B6 | `execute.ts` — the configuration asks the client to confirm before carrying on | **RED** | `unnecessary_client_continue_prompts_median` 0 → 1 |
| B7 | `execute.ts` — work claimed ready without the reviewer agreeing | green | the repair loop had already closed the findings before the claim was evaluated; the flag alone is not the control |
| B8 | `execute.ts` — reviewer findings no longer trigger a repair | **RED** | `verified_success_at_least_90pct` — success 1.000 → **0.760** |

`supported_hosts_live_tested` was observed red for real during construction: `--disallowedTools`
is variadic and swallowed the prompt that followed it, so `claude` exited 1 with no output and the
observation was `false`. Moving the prompt ahead of the flag fixed it. The gate reads the host's
actual answer, so a host that does not run cannot be recorded as tested.

## Two product defects the holdout found

1. **`interpret()` missed a plural.** `hx_lang_double_order` — "it made two orders when i clicked
   twice" produced no requirement, while its Taglish pair did, because the ordering pattern matched
   `order` but not `orders`. The pattern beside it already handled `products?`; this one did not.
   Fixed in `packages/core/src/intake.ts`; paired equivalence went from 11/12 to 12/12.
2. **The reviewer's findings were being reported only from the last cycle**, so a run the reviewer
   had actually fixed was recorded as "reviewer found nothing". Findings are now accumulated across
   cycles (`findings_raised`), together with the protected checks that were red at least once
   (`check_failures_seen`). Both feed the non-vacuity guard, which is what B1 trips.
