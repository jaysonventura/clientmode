# Client Mode vs Claude Code best practices

Source: <https://code.claude.com/docs/en/best-practices.md> and the pages it links to, indexed by
<https://code.claude.com/docs/llms.txt>. Checked 2026-09-23 against Claude Code 2.1.280.

**These pages win.** Where any other source (a course, a roadmap, a blog, Client Mode's own older
rules) disagrees, the first-party docs decide; the only exception is a practice that would weaken an
approval before money, data leaving the project or an irreversible action, which goes to the user.

Re-check on every change to the rules template (`adapters/global/`), the plugin skills, hooks or
defaults. `node scripts/check-best-practices.mjs` reports whether best-practices or any linked page it
watches (hooks, sub-agents, memory, skills, permission modes, costs, headless, MCP and more) changed,
and whether every file this table cites still exists.

Status: **aligned**, **gap** (with the change that closes it), or **diverges** (on purpose, with the reason).

| Section of the page | Practice | Client Mode | Status |
|---|---|---|---|
| Give Claude a way to verify its work | A runnable check, not "looks done"; show evidence | `tdd`, `verify`, `cdt-verify`, the Stop-hook gate `completion-guard.sh` | aligned |
| | Visual changes: screenshot the result, compare with the design, list and fix the differences | `ui-ux` "Reproducing a reference": capture the running page with `plugin/skills/ui-ux/scripts/visual-check.mjs`, compare, fix the three largest differences, two passes per batch | aligned |
| | Stop-hook gate; Claude Code ends the turn after 8 consecutive blocks (`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`); `stop_hook_active` is input for the hook | `completion-guard.sh` re-blocks a red verdict up to `CDT_MAX_ITERATIONS` = 3, below the host's 8, including when `stop_hook_active` is set (fixed 2026-09-23: it used to exit, giving one block per turn); other gates stay once per session | aligned |
| | Filter noisy test output before it reaches context (costs page example pipes the command through `grep \| head`) | not adopted: the pipe reports `head`'s exit code, which would blind `cdt-verify` and the Stop gate. Client Mode keeps the real exit code and delegates verbose runs to subagents instead | diverges: evidence over tokens |
| | A hook that blocks writes where the agent must not write (the page's example: the migrations folder) | not yet for tests: blocking edits to existing tests while a fix is red also blocks correcting a wrong test. The rule stays in `tdd` and the review checks weakened tests | gap: needs a design that tells a weakened test from a corrected one |
| | `/goal` as a session-level check (the person types it) | lead rules suggest `/goal <check>` for a major feature | aligned |
| | Second opinion from a fresh subagent that tries to refute | `code-reviewer`, `cm:adversarial` | aligned |
| Explore first, then plan, then code | Plan mode for uncertain or multi-file work; skip the plan if the diff fits in one sentence; the person approves the plan | T2/T3: explore read-only, then Claude calls `EnterPlanMode` itself and presents the plan with `ExitPlanMode` for the person's approval (user decision 2026-09-23); T0/T1 skip it. No setting forces plan mode per task, so the skill drives it. Codex: `/plan` in a read-only sandbox | aligned |
| Provide specific context in your prompts | Scope the task, point to sources and existing patterns, describe the symptom and what "fixed" looks like | `intake`; orchestration brief: goal / context / constraints / done when | aligned |
| Provide rich content | `@` files, pasted screenshots, URLs, piped data | host feature; nothing to add | aligned |
| Write an effective CLAUDE.md | Short; per line ask "would removing this cause mistakes?"; sometimes-relevant material goes in skills; emphasis on one line only | lead rules held at ≤ 1,209 words by a test; one routing table; one bold phrase; descriptions ≤ 40 words. The session-start `cm handoff` step stays a rule rather than a hook: running it from a hook records a project in every folder, and Codex reads the same rules | aligned |
| | The same rules applied to a client repository's CLAUDE.md / AGENTS.md (memory docs, read 2026-09-23: under 200 lines, `paths:` rules, imports load at launch, AGENTS.md read only when no CLAUDE.md) | `agent-instructions` skill. Where the aihero.dev AGENTS.md guide disagrees, the first-party docs win: Claude Code does read AGENTS.md, so share it with a `@AGENTS.md` import rather than a symlink; a stable checked path is allowed, a file map is not; `/init` output is a draft to cut down, not forbidden | aligned |
| Configure permissions | Allowlists, sandbox, auto mode | `cm install` turns on auto mode; `CM_NO_AUTONOMY=1` opts out; README points to `/sandbox` as the opt-in fence for Bash | aligned |
| | Headless `-p` runs load a project's hooks, env and `.mcp.json` without asking (permissions, mcp) | worker adapter and prompt enhancer pass `--strict-mcp-config` and `--setting-sources user`; verified live on 2.1.280 that a repo's MCP canary and SessionStart canary no longer run while its CLAUDE.md still loads | aligned |
| Use CLI tools | `gh`, `aws` and similar are the most context-efficient way to reach services | `cm:deps` checks `gh` | aligned |
| Connect MCP servers | Connect trackers, databases, designs | companion plugins via `cm:plugins`; the `tooling` skill adds a proven server at local scope after asking once, says a restart is needed, and never edits protected paths to skip a prompt | aligned |
| Set up hooks | Anything that must happen every time is a hook, not a rule | Claude: verify/claim/Stop hooks; the subagent hook matches `Agent\|Task` and accepts `tool_name` Agent (renamed in 2.1.63; observed on 2.1.280). Codex: `cm install` adds a Stop hook that runs the project's checks | aligned |
| Create skills | Workflows as on-demand skills; `disable-model-invocation: true` for workflows with side effects | 25 skills; descriptions capped at 40 words by `validate.sh`; the commands that write settings, the vault, worktrees or a PR, or install software (`autopilot`, `config`, `worktree`, `obsidian`, `deps`, `auto`, `learn`) run only when the person types them | aligned |
| Create custom subagents | Isolated contexts for read-heavy or specialist work; match the model to the job (costs, sub-agents) | 19 agents; one implementer by default; builders inherit the session model, the two retrieval-style Bug Council members run on sonnet, judgment roles on opus, `fast-ops` on haiku | aligned |
| Install plugins | Bundle skills, hooks, agents, MCP | Client Mode ships as the `cm` plugin | aligned |
| Ask codebase questions | Ask what you would ask a senior engineer | host behaviour | aligned |
| Let Claude interview you | For larger features, interview, write a self-contained spec, start a fresh session | `intake`: before a major feature, a short AskUserQuestion interview about the behaviour and edge cases only the person can decide; Client Mode writes the spec from the answers; never questions about internals | aligned |
| Course-correct early and often | After two failed corrections, `/clear` and restart with a better prompt | one stop rule in every rule set and skill: the second failed fix is the last, then a handoff | aligned |
| Manage context aggressively | `/clear` between tasks, `/compact <focus>`, `/btw`, say what compaction must keep | lead rules: one task per thread, `/btw` or `/side`, `/compact`, and what compaction keeps | aligned |
| Use subagents for investigation | Research in a separate context | orchestration: read-heavy investigation goes to an Explore subagent at any tier; archaeologist and pattern-matcher for bugs | aligned |
| Rewind with checkpoints | `/rewind`; checkpoints do not replace git and do not undo remote side effects | `handoff`: commit what you hand over; checkpoints are a local undo and do not undo a push, a message or a deploy | aligned |
| Resume conversations | `--continue`, named sessions | `cm handoff` spans hosts | aligned (cross-host handoff goes further) |
| Run non-interactive mode | `claude -p` in CI and scripts; `--bare` is recommended for scripts and will become the `-p` default | `cm run --request-file`; the prompt enhancer and workers use `claude -p` without `--bare`, because bare mode skips the login | gap: when `-p` defaults to bare (no date announced), the enhancer needs `--settings` with an `apiKeyHelper` or is skipped |
| Run multiple Claude sessions | Worktrees; writer/reviewer in fresh contexts | `cm:worktree`; parallel writers only when asked | aligned |
| Fan out across files | `/batch` or a `claude -p` loop, tried on 2–3 files first | BREADTH workflow mode, on request | aligned |
| Run autonomously with auto mode | Classifier-reviewed autonomy | installed by default | aligned |
| Add an adversarial review step | Fresh-context reviewer; flag only gaps that affect correctness or the stated requirements, because chasing every finding over-engineers | `review` skill and `code-reviewer`: report correctness and requirement gaps; the rest is optional | aligned |
| Avoid common failure patterns | Kitchen-sink session, correcting over and over, over-specified CLAUDE.md, trust-then-verify gap, infinite exploration | stop rule, short rules, verification gates, bounded delegation | aligned |
| Effort (from `model-config`, not this page) | Model default effort unless the task needs more | effort and model unpinned by default; effort follows the task | aligned |
| Plugin evals (from `plugin-evals`, not this page) | `claude plugin eval` against a no-plugin baseline whenever rules, skills or hooks change | `plugin/evals/`: four cases with free graders only (tooling skill fires and names the Xcode bridge; no pipe-to-shell install; plan mode on a T2 auth change; no plan mode on a one-line fix). `claude plugin validate` passes | gap: not run yet; a run is 4 cases x 3 runs x 2 arms of agent usage and waits for the user's go |
