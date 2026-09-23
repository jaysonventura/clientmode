# Client Mode vs Claude Code best practices

Source: <https://code.claude.com/docs/en/best-practices>. Checked 2026-09-23.
Re-check on every change to the rules template (`adapters/global/`), the plugin skills, hooks or
defaults. Run `node scripts/check-best-practices.mjs` to see whether the page's sections changed
since this table was written.

Status: **aligned**, **gap** (with the change that closes it), or **diverges** (on purpose, with the reason).

| Section of the page | Practice | Client Mode | Status |
|---|---|---|---|
| Give Claude a way to verify its work | A runnable check, not "looks done"; show evidence | `tdd`, `verify`, `cdt-verify`, the Stop-hook gate `completion-guard.sh` | aligned |
| | Visual changes: screenshot the result, compare with the design, list and fix the differences | `ui-ux` had no compare loop | gap → W4 reference-reproduction mode + W10 `visual-check.mjs` |
| | Stop-hook gate; Claude Code ends the turn after 8 consecutive blocks | guard default was 5 iterations | gap → W3 default 3 (spec §11), below the host's 8 |
| | `/goal` as a session-level check | not mentioned | gap → W8 routing table names `/goal` for major features |
| | Second opinion from a fresh subagent that tries to refute | `code-reviewer`, `cm:adversarial` | aligned |
| Explore first, then plan, then code | Plan mode for uncertain or multi-file work; skip the plan if the diff fits in one sentence | orchestration ran the full workflow for every tier | gap → W2: T0/T1 skip planning and delegation |
| Provide specific context in your prompts | Scope the task, point to sources and existing patterns, describe the symptom and what "fixed" looks like | `intake` | gap → W2 task brief: goal / context / constraints / done-when |
| Provide rich content | `@` files, pasted screenshots, URLs, piped data | host feature; nothing to add | aligned |
| Write an effective CLAUDE.md | Short; per line ask "would removing this cause mistakes?"; sometimes-relevant material goes in skills; emphasis on one line only | lead template is 1,209 words, repeats the skills and bolds many lines | gap → W8 word ceiling, routing table, pruned emphasis |
| Configure permissions | Allowlists, sandbox, auto mode | `cm install` turns on auto mode; `CM_NO_AUTONOMY=1` opts out | aligned |
| Use CLI tools | `gh`, `aws` and similar are the most context-efficient way to reach services | `cm:deps` checks `gh` | aligned |
| Connect MCP servers | Connect trackers, databases, designs | companion plugins via `cm:plugins` | aligned |
| Set up hooks | Anything that must happen every time is a hook, not a rule | Claude: verify/claim/Stop hooks. Codex: `cm install` adds a Stop hook that runs the project's checks | aligned |
| Create skills | Workflows as on-demand skills | 20 skills | aligned; W11 trims descriptions that load every session |
| Create custom subagents | Isolated contexts for read-heavy or specialist work | 19 agents | aligned; W2 makes one implementer the default |
| Install plugins | Bundle skills, hooks, agents, MCP | Client Mode ships as the `cm` plugin | aligned |
| Ask codebase questions | Ask what you would ask a senior engineer | host behaviour | aligned |
| Let Claude interview you | For larger features, interview, write a self-contained spec, start a fresh session | `intake`; rules forbid asking the client to write Markdown | diverges: Client Mode writes the spec itself and asks only about money, data leaving and irreversible actions |
| Course-correct early and often | After two failed corrections, `/clear` and restart with a better prompt | three different stop limits (3, 3, 5) | gap → W3 one rule: stop after the second failed fix, hand off, start fresh |
| Manage context aggressively | `/clear` between tasks, `/compact <focus>`, `/btw`, say what compaction must keep | not covered | gap → W8 names them and keeps modified files and test commands through compaction |
| Use subagents for investigation | Research in a separate context | Explore and archaeologist agents | aligned |
| Rewind with checkpoints | `/rewind`; checkpoints do not replace git | small commits per task | aligned |
| Resume conversations | `--continue`, named sessions | `cm handoff` spans hosts | aligned (cross-host handoff goes further) |
| Run non-interactive mode | `claude -p` in CI and scripts | `cm run --request-file`; the prompt enhancer uses `claude -p` | aligned |
| Run multiple Claude sessions | Worktrees; writer/reviewer in fresh contexts | `cm:worktree`; parallel writers only when asked | aligned |
| Fan out across files | `/batch` or a `claude -p` loop, tried on 2–3 files first | BREADTH workflow mode, on request | aligned |
| Run autonomously with auto mode | Classifier-reviewed autonomy | installed by default | aligned |
| Add an adversarial review step | Fresh-context reviewer; flag only gaps that affect correctness or the stated requirements, because chasing every finding over-engineers | `review` skill does not limit findings | gap → W12 add the limit to `plugin/skills/review/SKILL.md` and `agents/code-reviewer.md` |
| Avoid common failure patterns | Kitchen-sink session, correcting over and over, over-specified CLAUDE.md, trust-then-verify gap, infinite exploration | the middle three were weak spots | gap → W3, W8; exploration scope → W2 |
| Effort (from `model-config`, not this page) | Model default effort unless the task needs more | flat xhigh | gap → W1 |
