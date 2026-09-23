# Orchestration operations: waves, worktrees, telemetry, cost

Read this for T2/T3 work with specialists, parallel writers, or a question about spend.

## Waves in detail

- **Shared context pack (dedup — saves tokens + ramp time):** distill the shared files Wave 0 surfaced
    **once** into a manifest — `~/.claude/bin/cdt-context pack <files…>` (file list + key signatures) —
    and put `~/.claude/.cdt/context/<session>.md` in each Wave-1 agent's **READ list** so agents consume
    the distilled context instead of each re-reading the codebase. Keep the manifest the **stable prefix**
    across the wave's dispatches so it hits the prompt cache.

**Size the wave to the budget (fast + cost-effective).** Before dispatching Wave 1, consult
`~/.claude/bin/cdt-auto fanout <tier>` — it recommends how many agents the remaining weekly headroom
affords. The recommendation is capped by the delegation limits above (two at a time, one writer); near
the ceiling trim the *optional* agents, never the security-review + qa-verify floor.

**Worktree isolation (when the person asks for parallel writers).** Wave 1's *exclusive file scope* is
the logical collision guard; when parallel writers were requested, make it a *hard* filesystem
guarantee so writes truly can't collide — each writer in its own git worktree, merged back by the lead:
```
~/.claude/bin/cdt-worktree new <name>     # isolated checkout at .claude/worktrees/<name> (branch worktree-<name>)
claude --worktree <name>                  # …or open a parallel session in it (same checkout)
~/.claude/bin/cdt-worktree rm <name>      # after committing + merging back (refuses dirty without --force)
```
Set `CDT_WORKTREE_DEFAULT=0` to force in-place. Single-writer waves and T0/T1 stay **in-place** — worktree
setup has a small cost and only pays off when multiple agents write at once.

**Phase board (T2/T3 only).** At the start of each wave, run
`~/.claude/bin/cdt-phase "<Wave>" --agents <roles>` (e.g. `cdt-phase "Build" --agents
backend-engineer,frontend-engineer,qa-engineer`), and `cdt-phase done` at ship. It renders a per-wave board
+ a `phase i/N` status-line indicator for the user (per-phase token totals fill in automatically as agents
finish). Display-only, near-zero cost; **skip it on T0/T1 solo work** (nothing to board).

## STATE LOGGING (accurate analytics)

Mostly automatic: the SessionStart hook records sessions, and a
**SubagentStop hook records every agent dispatch by role *and its real token cost*** (summed from that
subagent's transcript) — so `/cm:stats` shows an accurate agent-run breakdown, ranked by tokens, with
zero effort. You never compute or pass those per-agent figures; the hook reads them from actual usage.

**One manual step at ship** — log the task's tier + Task Loop iteration count so `/cm:stats` reflects the
tier mix and average iterations:
```
~/.claude/bin/cdt-task <T0|T1|T2|T3> shipped <iterations> "<short task description>" [tokens]
```
Run it once per completed task (part of the completion mandate). `[tokens]` is **optional** — pass the
real `cdt-tokens` delta if you captured one; otherwise **omit it**
(stored 0). The real "cost" on Max is **token / rate-limit budget** (session + weekly limits), **not
money** — the logged activity is the proxy for it. Do **not** invent token figures; the per-agent numbers
come from transcripts and Claude Code's `/cost` / `/usage` is the authoritative live source.

## COST DISCIPLINE (cost-effective by default, high quality always)

- **Model routing (Opus is the recommended main model):** quality-critical work runs on a strong model;
  cost-effectiveness comes from **tiering + trivial-only Haiku**, never from downgrading important work.
  Per dispatch, you may consult **`~/.claude/bin/cdt-route "<subtask>"`** — it recommends Opus vs Sonnet by
  difficulty (risk/ambiguity/architecture → Opus; substantive throughput → Sonnet) and **never recommends
  Haiku for substantive work**. The production-grade floor is lint-enforced: every substantive agent is
  pinned **Opus**; only `fast-ops` may be Haiku.
  - **Opus — judgment, builders & main (pinned):** the judgment/review panel (`product-manager`,
    `architect`, `ui-ux-engineer`, `code-reviewer`, `security-reviewer`), the **engineering builders**
    (`backend`, `frontend`, `mobile`, `data`, `devops`, `qa`, `diagrams`), **`technical-writer`**, and the
    gated **Bug Council ×5** (`root-cause-analyst`, `code-archaeologist`, `pattern-matcher`,
    `systems-thinker`, `adversarial-tester`) are all **pinned Opus** for production-grade output (the
    earlier Sonnet throughput pin was reverted). The orchestrator runs on your session model — keep
    **Opus** for quality work. (`lint-agents.sh` enforces this Opus floor.)
  - **Haiku — `fast-ops` only, the LOW tier:** the cheap "hands" tier for **trivial, mechanical,
    fully-specified** ops (gather/grep/count; a literal find/replace, rename, typo, whitespace, template
    fill). **HARD RULE — never route the low model to anything complicated or quality-sensitive:** not
    orchestration, architecture, development, testing, review, security, or debugging. Use `fast-ops`
    only when a sub-task needs *zero* judgment; it escalates the instant it doesn't. **When in doubt,
    never Haiku** — use Opus/Sonnet.
- **Budget-aware Eco mode (opt-in; OFF by default):** eco is **off** unless the user enables it
  (`cdt-config eco on|auto`). When **off**, do nothing here — full quality. When **on**, always conserve;
  when **auto**, before a **T2+** dispatch run `~/.claude/bin/cdt-budget` and conserve only if it returns
  **CONSERVE**. Conserving = prefer Sonnet over Opus for builders, drop to the smallest *safe* tier, skip
  optional / non-critical agents — then **tell the user** why ("ECO: weekly 84% — Sonnet, T2 not T3").
  **Eco never weakens the risk floor** (auth/payments/infra/migrations/secrets keep the full mandate),
  **never skips the security review**, and never uses Haiku for real work.
- **Tier-gating is the default** — most tasks are T0/T1 and need no team.
- **Contracts cap tokens** — exclusive scope + read-list + ≤150-word reports keep agents from reading
  the whole repo or rambling.
- Prefer the read-only `Explore` agent for recon. Keep the main context lean (let subagents hold detail).

## GRACEFUL DEGRADATION

The skills this protocol needs ship in this plugin (`tdd`, `debug`, `verify`, `review`, `handoff`, …),
so it works without companions. Use companion skills/commands when present for extra depth:
`superpowers:systematic-debugging`, `superpowers:test-driven-development`,
`superpowers:verification-before-completion`, `/code-review`, `/security-review`, `/simplify`,
`frontend-design`, `figma`.
