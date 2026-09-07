# AT-031 — red evidence

Gate: `tests/tasks/T31.test.ts`, executor `tests/scenarios/T31.scenarios.ts`.
Command: `node --import tsx --test tests/tasks/T31.test.ts`.

## What was executed

Three real requests of very different weight go through the same routing, and the difference is
decided by the work rather than by who asked:

| Request | Tier | Responsibilities engaged | Workers |
|---|---|---|---|
| "change the order button to say Place order" | low | 2 (`engineering`, `quality`) | 1 |
| "build the booking rules from these documents" (Swift, Python, TypeScript) | moderate | 4 | 2 |
| "let staff refund an order, supervisors approve" | high | 7, of which 4 need review | 2 |

Every responsibility not engaged carries a written reason. Nobody is summoned to review a button.

An outcome brief is built with a document citation resolved against the stored bytes, one
assumption labelled as an assumption and one proposal labelled as a proposal. Three briefs are
refused: a claim that "users said they prefer a 48 hour window" with provenance but the wrong
classification, the same claim dressed up as an assumption, and a plain fact with no source. The
client is asked which cancellation window applies and whether a refund needs a supervisor, and is
not asked to write a Markdown file, approve an implementation plan or pick a library.

## Mutations proving the assertions are load-bearing

| # | Mutation | Result | Observation that flipped |
|---|----------|--------|--------------------------|
| `P1` | every responsibility engaged on low-risk work (`company.ts`) | **RED** | `small_task_does_not_spawn_company_swarm` |
| `P2` | risk assessment ignores money and access | green | the high-risk surface set still made it high |
| `P2b` | risk assessment ignores money, access **and** the high-risk surfaces | green | `reversible: false` still made it high — the tier has three independent inputs |
| `P2c` | all three risk inputs removed | **RED** | `high_risk_gates_cannot_be_lowered_by_writer` |
| `P3` | research language no longer needs a study | **RED** | `research_claims_have_actual_provenance` |
| `P4` | management homework is handed to the client | **RED** | `client_not_given_management_homework` |
| `P5` | anyone may sign off a business decision | **RED** | `role_titles_do_not_grant_authority` |
| `P6b` | a purchase is allowed with no approval | **RED** | `unapproved_purchase_or_legal_signoff_rejected` |

## Defence in depth

The risk tier is decided by three independent inputs — the surfaces the change touches, whether
it moves money or access, and whether it can be undone. Removing any one of them, or any two,
still produced a high tier for the refund change. All three had to go before a writer's downgrade
took effect, and even then `decideAuthority` refuses `lower_risk_tier` outright.

## Scope

No real user study exists and none is claimed; that is precisely what the research-provenance rule
enforces. The vendor quote is refused because no budget approval names it, and a legal signoff is
refused because it is not an engineering action at all.
