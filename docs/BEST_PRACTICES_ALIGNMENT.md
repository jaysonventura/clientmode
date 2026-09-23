# Client Mode vs Claude Code best practices

Source: <https://code.claude.com/docs/en/best-practices>. Checked 2026-09-23.
Re-check on every change to the rules template (`adapters/global/`), the plugin skills, hooks or
defaults. Run `node scripts/check-best-practices.mjs` to see whether the page's sections changed
since this table was written.

Status: **aligned**, **gap** (with the change that closes it), or **diverges** (on purpose, with the reason).

| Section of the page | Practice | Client Mode | Status |
|---|---|---|---|
| Give Claude a way to verify its work | A runnable check, not "looks done"; show evidence | `tdd`, `verify`, `cdt-verify`, the Stop-hook gate `completion-guard.sh` | aligned |
| | Visual changes: screenshot the result, compare with the design, list and fix the differences | `ui-ux` "Reproducing a reference": capture the running page with `scripts/visual-check.mjs`, compare, fix the three largest differences, two passes per batch | aligned |
| | Stop-hook gate; Claude Code ends the turn after 8 consecutive blocks | `completion-guard.sh` blocks up to `CDT_MAX_ITERATIONS` = 3 (spec §11), below the host's 8 | aligned |
| | `/goal` as a session-level check | lead rules route a major feature through `/goal` and `/plan` | aligned |
| | Second opinion from a fresh subagent that tries to refute | `code-reviewer`, `cm:adversarial` | aligned |
| Explore first, then plan, then code | Plan mode for uncertain or multi-file work; skip the plan if the diff fits in one sentence | orchestration: skip the plan when the diff fits in a sentence; T0/T1 built by the lead | aligned |
| Provide specific context in your prompts | Scope the task, point to sources and existing patterns, describe the symptom and what "fixed" looks like | `intake`; orchestration brief: goal / context / constraints / done when | aligned |
| Provide rich content | `@` files, pasted screenshots, URLs, piped data | host feature; nothing to add | aligned |
| Write an effective CLAUDE.md | Short; per line ask "would removing this cause mistakes?"; sometimes-relevant material goes in skills; emphasis on one line only | lead rules held at ≤ 1,209 words by a test; one routing table; one bold phrase; descriptions ≤ 40 words | aligned |
| Configure permissions | Allowlists, sandbox, auto mode | `cm install` turns on auto mode; `CM_NO_AUTONOMY=1` opts out | aligned |
| Use CLI tools | `gh`, `aws` and similar are the most context-efficient way to reach services | `cm:deps` checks `gh` | aligned |
| Connect MCP servers | Connect trackers, databases, designs | companion plugins via `cm:plugins` | aligned |
| Set up hooks | Anything that must happen every time is a hook, not a rule | Claude: verify/claim/Stop hooks. Codex: `cm install` adds a Stop hook that runs the project's checks | aligned |
| Create skills | Workflows as on-demand skills | 22 skills; descriptions capped at 40 words by `validate.sh` | aligned |
| Create custom subagents | Isolated contexts for read-heavy or specialist work | 19 agents; one implementer by default | aligned |
| Install plugins | Bundle skills, hooks, agents, MCP | Client Mode ships as the `cm` plugin | aligned |
| Ask codebase questions | Ask what you would ask a senior engineer | host behaviour | aligned |
| Let Claude interview you | For larger features, interview, write a self-contained spec, start a fresh session | `intake`; rules forbid asking the client to write Markdown | diverges: Client Mode writes the spec itself and asks only about money, data leaving and irreversible actions |
| Course-correct early and often | After two failed corrections, `/clear` and restart with a better prompt | one stop rule in every rule set and skill: the second failed fix is the last, then a handoff | aligned |
| Manage context aggressively | `/clear` between tasks, `/compact <focus>`, `/btw`, say what compaction must keep | lead rules: one task per thread, `/btw` or `/side`, `/compact`, and what compaction keeps | aligned |
| Use subagents for investigation | Research in a separate context | Explore and archaeologist agents | aligned |
| Rewind with checkpoints | `/rewind`; checkpoints do not replace git | small commits per task | aligned |
| Resume conversations | `--continue`, named sessions | `cm handoff` spans hosts | aligned (cross-host handoff goes further) |
| Run non-interactive mode | `claude -p` in CI and scripts | `cm run --request-file`; the prompt enhancer uses `claude -p` | aligned |
| Run multiple Claude sessions | Worktrees; writer/reviewer in fresh contexts | `cm:worktree`; parallel writers only when asked | aligned |
| Fan out across files | `/batch` or a `claude -p` loop, tried on 2–3 files first | BREADTH workflow mode, on request | aligned |
| Run autonomously with auto mode | Classifier-reviewed autonomy | installed by default | aligned |
| Add an adversarial review step | Fresh-context reviewer; flag only gaps that affect correctness or the stated requirements, because chasing every finding over-engineers | `review` skill and `code-reviewer`: report correctness and requirement gaps; the rest is optional | aligned |
| Avoid common failure patterns | Kitchen-sink session, correcting over and over, over-specified CLAUDE.md, trust-then-verify gap, infinite exploration | stop rule, short rules, verification gates, bounded delegation | aligned |
| Effort (from `model-config`, not this page) | Model default effort unless the task needs more | effort and model unpinned by default; effort follows the task | aligned |
