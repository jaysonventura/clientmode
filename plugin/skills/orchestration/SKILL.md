---
name: orchestration
description: Use at the START of any software task - a feature, bug fix, refactor, review or release. Sizes the work (T0-T3), keeps one implementer by default, and runs the gates, the bounded repair loop and the completion mandate.
---

# Orchestration — how the lead works

You are the lead, and you do the work. Most tasks are one person's job: triage, build it test-first,
verify it, close it. Delegate only work that is bounded and independent — read-heavy research, an
independent review, a specialist lane on a multi-domain change — never to fill a roster.

- **Limits, every tier:** one active writer per project, at most two child jobs at once, one level
  deep. Your own edits count as writing. Wider fan-out (parallel worktrees, agent teams, workflows)
  only when the person asks (`FULL:`, "use a workflow", "run a council"), never nested.
- **Effort follows the task:** the model's default for ordinary UI, form and API work; higher for a
  hard-to-reproduce bug or unfamiliar integration; the top level deliberately, for architecture or a
  deep investigation. Fast mode buys speed with more spend; it is not a saving.
- **Test first, always** (`tdd`): every behaviour change goes red → green → refactor.
- **Host note:** on Codex, Gemini CLI or Cursor the named agents, hooks and `~/.claude/bin/cdt-*`
  helpers may be absent. Do the step inline and say which automation was missing.

## STEP 1 · TRIAGE

Score `files + domains + risk` and pick the smallest shape that fits:

| Tier | Shape | When |
|------|-------|------|
| **T0** | you alone | one file, one domain, no risk |
| **T1** | you + optional reviewer | small single-domain change |
| **T2** | you + ≤2 child jobs, one writer | multi-domain, or any risk |
| **T3** | T2's limits, in sequential waves | large or cross-cutting |

- **Risk floor:** auth, payments, infrastructure, migrations and secrets are T2+ with the full
  mandate and a security review, however small the diff.
- **Plan only when it pays:** if you could describe the diff in one sentence, skip the plan. Plan
  (plan mode where the host has it) when the approach is uncertain, several files change, or the
  code is unfamiliar. For a major feature, set the outcome as a goal (`/goal` where the host has it)
  and deliver it one slice at a time.
- **On T2+,** recall first: `~/.claude/bin/cdt-recall "<task>"`; `cdt-advise "<task>"` gives an
  advisory prior, never a rule.
- **Overrides:** `T0:` forces solo; `FULL:` raises model and gates for critical work.
- **Stuck, very large, or high-stakes work** has its own modes — DEPTH (Bug Council), BREADTH
  (workflow fan-out), quality-via-parallelism — with budget gates: read `references/modes.md`.

## STEP 2 · BRIEF, THEN CONTRACT

Every task starts from a short brief, written by you, not the person: **goal** (the outcome),
**context** (files, existing patterns to follow, sources), **constraints** (what must not change,
including every exclusion the person stated), **done when** (a check that returns pass or fail).

**One complete flow before breadth.** Finish one end-to-end slice — UI, API, data, permissions,
error handling — and verify it before starting the next. No unrelated refactor or redesign rides
along.

When you dispatch, each agent gets a contract: interfaces to produce or consume; **exclusive** write
paths (no two agents share a file in one wave); read-only paths; a verifiable **done when**;
**do not** guardrails; a report of ≤150 words plus fenced evidence. Add the machine-checkable line
the scope gate reads:

```
CDT-CONTRACT: exclusive=api/**,server/** ; read=types/**,shared/**
```

## STEP 3 · EXECUTE

- **T0/T1:** build it yourself. Skip the optional agents; the gates still run.
- **T2/T3:** waves, at most two jobs at a time, one writing. Wave 0 when needed: `product-manager`
  for a vague feature, `Explore` or `architect` for recon and design, `ui-ux-engineer` for UI.
  Wave 1: the builder(s) on disjoint paths. Wave 2: `code-reviewer`, `security-reviewer` (veto on
  risk ≥ medium), `ui-ux-engineer` for user-facing work. Context packs, fan-out sizing, worktrees,
  the phase board and telemetry: `references/operations.md`.
- **Gate chain:** fmt · lint · typecheck · unit · integration · e2e · build · smoke · review · close.
  Run what the project supports and name what it lacks. e2e is required for a user-facing flow
  when a harness exists or should.
- **Automation first:** before any build, deploy, run or release command, use the repo's own
  automation — Makefile, then package scripts, `scripts/`, docs/CI (`automation-first`). If a
  Makefile target fails, stop and report.

## STEP 3b · TASK LOOP (enforced by the Stop hook)

1. Run the gates **through `cdt-verify -- <cmd>`** — the only evidence the Stop gate accepts. A bare
   `npm test` is denied with the wrapped command to re-issue. Evidence from before your last edit is
   stale.
2. On failure, find the cause (`debug`), fix it, and re-run the **same** command through `cdt-verify`.
3. **Stuck rule:** the second failed fix for the same failure is the last one — the Stop hook says
   so. Stop editing, report reproduction / evidence / suspected cause / what was tried / what is
   unknown, and escalate to the Bug Council (`references/modes.md`).
4. **Hard cap:** the loop stops blocking after `CDT_MAX_ITERATIONS` (default 3). That is not
   permission to claim success: report `BLOCKER` with what is still red.

Never soften a gate to get past it (`cdt-config verify off`, `claim off`, `verify-wrap off`) unless the
person asks. Turning off the instrument does not make the tests pass.

## STEP 4 · COMPLETION MANDATE

- **T0/T1:** run the check and paste its output, self-review the diff, simplify what you touched.
- **T2/T3 and the risk floor:** simplify · code-review · reuse audit · dead-code scan · lesson → ship
  (`/cm:ship`; `/cm:autopilot` for a PR — `references/autopilot.md`).
- **Reviewers report gaps that affect correctness or the stated requirements.** Treat the rest as
  optional; chasing every finding over-engineers.
- **Persist:** a reusable lesson via `cdt-learn "<lesson>"`; log the task with
  `~/.claude/bin/cdt-task <tier> shipped <iterations> "<task>"` (omit tokens you did not measure).

Report milestones as they happen — **DELIVERED**, **DEFERRED**, **BLOCKER** (root cause + what is
needed) — and a **SHIP** digest at the end: `<N delivered / M deferred / K blockers>`.

## SKILL ROUTING (apply without being asked)

| When the work is… | Use |
|---|---|
| A client request in ordinary language (any language, Taglish included) | `intake` — exclusions first, one material question at a time |
| A vague or user-facing feature | `product-manager`, then `superpowers:brainstorming` |
| Unfamiliar or version-sensitive code; any library/API specifics | `grounding` + `context7` |
| Any behaviour change | `tdd` |
| A bug or failing check | `debug` (+ `superpowers:systematic-debugging`) |
| Web or mobile UI; copying a reference screenshot | `ui-ux` (+ `frontend-design`); `frontend-engineer` / `mobile-engineer` build |
| Testing in a browser / on a device | `web-qa` / `mobile-qa`, with `qa-shared` |
| Build, deploy, run or release commands | `automation-first` |
| A migration, schema change or backfill | `database-change` + `security-reviewer` |
| A feature that calls a model (extraction, RAG, tools) | `ai-eval` |
| A worker executing a contract | `delivery` |
| Reviewing a change | `review` |
| TypeScript; refactors; "this is better" claims | `clean-code-typescript`; `karpathy-guidelines` + `code-splitting`; `gauge-improvements` |
| Docs, release notes, ADRs, PR descriptions | `technical-writing` + `technical-writer` |
| Before claiming done | `verify`, then `handoff` |

Name the skills a specialist must apply in its contract.

## ANTI-HALLUCINATION

1. Ground every claim in a real file, line or command output. No invented APIs, files or results.
2. Library, framework and API specifics come from `context7` / first-party docs, never memory.
3. Before "done / fixed / passing", run the check through `cdt-verify -- <cmd>` and paste the output.
   The claim gate blocks a success claim while the recorded verdict is red or absent.
4. Unsure? Say so and stop. Red evidence is reported plainly: `BLOCKER` with real output beats `done`
   without it.
