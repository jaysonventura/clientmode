# Orchestration modes: DEPTH, BREADTH and quality-via-parallelism

Read this when a task is stuck, very large, or high-stakes. Ordinary work stays in the bounded
shape described in `../SKILL.md`.

## STEP 1.5 · AUTONOMOUS MODE ROUTER (pick the orchestration shape)

After scoring the tier, also read the **work shape** and pick the execution mode. BOUNDED is the
default. Recommend DEPTH or BREADTH when the shape clearly benefits, and run it when the person asks
(or when stuck-loop detection convenes the Bug Council). Effort stays at the session level in every mode (never
`max` by default); judgment runs on **Opus**, never Haiku.

| Mode | Use it when | Engine |
|------|-------------|--------|
| **BOUNDED** | ordinary, contained work — a handful of files/domains | tiered dispatch (T0–T3) |
| **DEPTH** | a hard / ambiguous / adversarial judgment (stuck bug, risky design call) — convene the debating team | agent-team Bug Council (debate) → STEP 3c |
| **BREADTH** | a *large or homogeneous set* (many files / call-sites / endpoints) — repo-wide audit, migration, exhaustive review | dynamic workflow (fan-out) → STEP 3e |

**Budget safety valve — a quick check before a big escalation:**
```
~/.claude/bin/cdt-auto gate team      # before convening an agent-team
~/.claude/bin/cdt-auto gate scale     # before summoning a workflow
```
The engines ship **on** (`autonomy=auto`, teams + scale enabled), so the gate normally returns **ALLOW** —
escalate. It returns **ASK** only as you near the **weekly-budget ceiling** (so a big fan-out doesn't lock
you out of Max) or before the first un-measured fan-out (slice-first); **DENY** only if you've explicitly
turned autonomy off (`cdt-config autonomy off`). Treat ASK as "confirm the spend with the user, then
proceed." The per-agent token telemetry (`/cm:stats`) records what each escalation spent.

**Fail-soft:** if an engine is genuinely unavailable (cdt-doctor flags a missing experimental flag or an
old CLI), fall back to bounded dispatch so the task never blocks — then tell the user how to enable it
(`cdt-config teams on` / `cdt-config scale on`).

## STEP 3c · BUG COUNCIL — DEPTH mode (gated — stuck/complex bugs only)

Do **not** convene on routine bugs. When stuck-loop detection fires or the user runs `/cm:bug-council`,
first run `cdt-auto gate team`:

- **Default (and DENY)** → dispatch the five read-only diagnostic lenses **two at a time** —
  `root-cause-analyst` + `code-archaeologist`, then `pattern-matcher` + `systems-thinker`, then
  `adversarial-tester` — feeding each pair what the previous pair found; **you** synthesize.
- **When the person asks for a debating team and the gate says ALLOW** → convene a real **agent team**
  (shared task list + mailbox) so the lenses challenge each other. **Time-box to 1–2 rounds**, then
  **dissolve the team** (sustained parallel contexts are the cost).
- **ASK** → tell the user a team would help + the rough cost, and proceed only on a yes; else use the
  default.

Either way: synthesize a **single ranked root cause + fix plan**, dispatch an engineer to implement, and
report the verdict to the user. Judgment agents run **Opus** (hard diagnosis), never Haiku.

## STEP 3e · BREADTH mode (dynamic-workflow Scale mode — gated, summoned)

For a **large or homogeneous set** (audit every route, migrate every call-site, review N changed files),
**recommend a dynamic workflow** with a rough cost, and run it once the person opts in ("use a
workflow"). Run `cdt-auto gate scale` as a budget check:

- **ALLOW** (the normal case) → summon a dynamic workflow now.
- **ASK** (near the weekly ceiling, or the first un-measured fan-out) → confirm the slice-first estimate
  with the user, then summon it.
- **DENY** (only if autonomy was turned off) → stay bounded; re-enable with `cdt-config autonomy auto`.

Whichever path, keep the **discipline (non-negotiable):**
  - **Slice-first** — run on ~5 items, read the per-agent token cost from `/cm:stats`, extrapolate to the
    full set; **stop if it would exceed** `CDT_SCALE_TOKEN_CAP`.
  - Every workflow agent gets a **contract**; mandatory **adversarial-verify + completeness-critic** stages.
  - **Log what's dropped** — never silently cap to top-N.
  - Compose with **worktree isolation** (STEP 3 note) for migrations — each agent in its own checkout.
  - Session effort; Opus for judgment, **never Haiku**. Stop at the cap and report real spend.

Workflows are a first-class tool here — summoned freely, but always **capped, measured, and logged**.

## STEP 3f · QUALITY-VIA-PARALLELISM (bounded, budget-gated — high-stakes work only)

When quality matters more than the cheapest path — risk-flagged changes, ambiguous design, a finding you
must trust — spend a few *extra* parallel agents on **production models** (bounded Agent calls, or a
dynamic workflow when the verification set is large). It **deepens** the Wave-2 review + security veto,
never replaces them:

- **Adversarial verify** (`/cm:adversarial`) — for a risk-flagged change or a high-impact finding,
  dispatch **independent reviewers (two at a time)**, each prompted to **REFUTE** it (default to "not
  proven" when uncertain), on **Opus**. A refutation that comes with a reproduction sends it back for
  rework; one without is recorded as a minor finding. Reproductions decide, not a majority vote.
- **Diverse-lens review (Wave 2)** — give each reviewer a **distinct lens** — correctness · security ·
  performance · a11y/UX — instead of overlapping coverage, so redundancy can't hide a failure mode.
- **Design judge-panel (Wave 0, genuinely ambiguous design only)** — generate **2–3 independent
  `architect` variants** (e.g. MVP-first / risk-first / simplest), score them with a judge, and synthesize
  from the winner (grafting the best of the runners-up). Use only when the design space is wide **and**
  budget allows; otherwise a single architect pass.

All bounded (a handful of agents, then dissolve), all above the production-grade floor (Opus/Sonnet,
never Haiku).
