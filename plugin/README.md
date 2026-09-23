<p align="center"><img src="assets/logo.png" alt="Client Mode" width="96"></p>

# The `cm` plugin

The Claude Code half of [Client Mode](../README.md). Client Mode works the way a senior AI engineer
does: one person who owns the result and uses AI to do the work, keeping the judgement, the checking
and the accountability. This plugin gives Claude Code the pieces that make that enforceable rather
than hoped for — skills that load when the work calls for them, specialist agents under bounded
contracts, and hooks that run the checks every time.

Install, update and remove it with the `cm` CLI (see the [root README](../README.md#install)).
`cm install` registers this plugin; `cm uninstall` takes it back out with everything else.

## What runs by itself

Nothing here needs to be invoked. After install, every Claude Code session gets:

| When | Hook | What it does |
|---|---|---|
| Session start | `session-start-vault.sh` | Seeds the vault and state DB, installs the `cdt-*` CLIs into `~/.claude/bin`, injects the latest lessons |
| Session start | `plugins.sh bootstrap` | Builds the toolkit (`cdt-verify`, trusted verification), heals missing companion plugins |
| Every prompt | `prompt-enhance.sh` | Routes the task and, for unclear or risky prompts, writes a brief |
| Before a subagent | `contract-capture.sh` | Records the subagent's write contract so scope can be checked |
| Before and after Bash | `verify-wrap.sh`, `verify-track.sh` | Records which checks actually ran and their exit codes |
| After an edit | `format-on-write.sh` | Notes the edit; runs the project's prettier only when it is installed and configured locally |
| Subagent finishes | `agent-track.sh` | Logs the agent, its tier and its token cost |
| Turn ends | `completion-guard.sh` | Blocks a "done" when files changed and no check ran after them, or the evidence is red |

The hooks fail open: an error in one never breaks the session, and they read and write only under
`~/.claude/`.

## Skills

Claude Code loads a skill when its description matches the work, so they are used without being
named. Invoke one directly as `/cm:<name>` when you want it regardless.

| Work | Skill |
|---|---|
| Any software task | `orchestration` — sizes it (T0–T3) and routes it |
| A client request or spec document | `intake`, `requirement-intelligence` |
| Unfamiliar or version-sensitive code | `grounding` |
| Any behaviour change | `tdd` |
| A failure or unexplained behaviour | `debug` |
| A migration, schema or backfill | `database-change` |
| A feature that calls a model | `ai-eval` |
| A user interface | `ui-ux`, then `web-qa` / `mobile-qa` with `qa-shared` |
| Build, deploy, run or release | `automation-first` |
| Working a task contract; reviewing | `delivery`; `review` |
| Before claiming it works; returning it | `verify`, then `handoff` |
| Learning from a repository's history | `history-lessons` |
| Code quality and documentation | `clean-code-typescript`, `karpathy-guidelines`, `code-splitting`, `gauge-improvements`, `technical-writing` |

## Agents

Specialists the lead delegates to under a bounded contract: exclusive write paths, a verifiable
done-when and a short report. At most one writer at a time and two child jobs running at once, one
level deep; wider fan-out only when you ask (`FULL:`, "use a workflow").

- **Build:** `architect`, `product-manager`, `backend-engineer`, `frontend-engineer`,
  `mobile-engineer`, `data-engineer`, `devops-engineer`, `ui-ux-engineer`, `qa-engineer`,
  `technical-writer`, `diagrams`, `fast-ops`
- **Review (read-only):** `code-reviewer`, `security-reviewer` (can block a ship on medium risk or
  higher)
- **Bug Council (read-only, for a stuck bug):** `root-cause-analyst`, `code-archaeologist`,
  `pattern-matcher`, `systems-thinker`, `adversarial-tester`

A role's title grants nothing: deploying, spending, publishing or sending a message needs an approval
that names the action.

## Commands

| Command | What it does |
|---|---|
| `/cm:ship` | Run the completion mandate on the current work: simplify, review, reuse audit, dead code, lesson |
| `/cm:triage <task>` | Preview the tier and the proposed dispatch without running it |
| `/cm:bug-council <symptom>` | Convene the Bug Council for a ranked diagnosis |
| `/cm:adversarial <change>` | Have independent reviewers try to refute a risky change |
| `/cm:autopilot <PR#>` | Drive a GitHub PR toward green (dry run by default; never force-pushes or merges) |
| `/cm:web-qa`, `/cm:mobile-qa` | Run a user journey in a real browser or on a device and explain failures |
| `/cm:spec <file>` | Extract cited requirements from a spec document into `.claude/specs/` |
| `/cm:prompt <task>` | Run intake and routing by hand |
| `/cm:history-lessons <repo>` | Audit a repository's git history for lessons, for your approval |
| `/cm:recall <task>`, `/cm:learn <lesson>` | Read from and add to the lesson vault |
| `/cm:advise <task>` | An advisory tier prior from how similar tasks went |
| `/cm:stats` | Sessions, tasks, agents, follow-ups, time to green and estimated spend |
| `/cm:budget` | Session and weekly usage %, with the Eco recommendation |
| `/cm:auto` | The mode router and cost governor |
| `/cm:worktree` | Isolated git worktrees for parallel work |
| `/cm:plugins` | Companion plugin health and routing |
| `/cm:obsidian` | Sync the vault into Obsidian |
| `/cm:config`, `/cm:doctor`, `/cm:deps`, `/cm:version` | Settings, health check, prerequisites, version |

The settings, memory, analytics and health commands also run in a terminal as
`~/.claude/bin/cdt-<name>` (for example `cdt-config`, `cdt-doctor`, `cdt-stats`, `cdt-budget`).

## Settings

Everything has a safe default; `~/.claude/bin/cdt-config show` prints the current values.

```sh
cdt-config on | off                     # Client Mode's orchestration layer on or off
cdt-config claim block|warn|off         # block a "done" whose evidence is red or missing (default block)
cdt-config statusline on                # terminal status line: model, session %, weekly %
cdt-config eco off|on|auto              # conserve when weekly usage is high (default off)
cdt-config effort <level> / model <m>   # pin them; unpinned by default so Claude Code's defaults apply
cdt-config bootstrap-toolkit on|off     # build the verification toolkit at session start (default on)
```

Settings live in `~/.claude/claude-dev-team.env`; see [`claude-dev-team.env.example`](claude-dev-team.env.example)
for every key. A toolkit build that fails is retried after `CDT_TOOLKIT_RETRY_HOURS` (default 24),
and its output is kept in `toolkit/.cdt-build.log`.

## Usage and budget

The status line is the only thing that records your session and weekly usage. It reads the
`rate_limits` Claude Code already gives it (no network call, no credentials) and caches them in
`~/.claude/.cdt-usage.json` for `/cm:budget` and the cost governor. It runs only in a terminal, so if
you work in an editor's chat panel, run `claude` in its integrated terminal now and then.

## Privacy

No telemetry. The plugin sends nothing anywhere; its state is local under `~/.claude/`. Third-party
companion plugins are installed only after `cdt-config bootstrap-community on`.

## Troubleshooting

Start with `/cm:doctor`: it checks hooks, CLIs, the state DB, the toolkit and companion plugins, and
prints a fix for anything not green.

| Symptom | Fix |
|---|---|
| Commands or agents missing | Restart the session or run `/reload-plugins`; commands are namespaced `/cm:<name>` |
| `cdt-*: command not found` in a terminal | Use the full path, `~/.claude/bin/cdt-…` |
| "toolkit build failed" at session start | Read the log it names; it retries after 24 hours, or run the `npm` command it prints |
| Hooks not running on Windows | Install Git for Windows and Python 3; with WSL present, set `CLAUDE_CODE_GIT_BASH_PATH` |
| Usage % stale or missing | `cdt-config statusline on`, then run `claude` in a terminal once |

Earlier versions shipped a macOS menu bar app, "CDT Usage". It has been removed; the first session
after updating unregisters and deletes it.

## Layout

```
.claude-plugin/   plugin.json (manifest and companion dependencies)
agents/           the specialist, reviewer and Bug Council agents
skills/           the skills above, each with its SKILL.md and references
commands/         the /cm:* commands
hooks/            hooks.json, the hook scripts and the cdt-* CLIs
toolkit/          the TypeScript engine: cdt-verify, cdt-prompt, cdt-spec, hook finalisation
config/           the companion plugin registry
docs/             architecture, plugin routing, roadmap
scripts/          validate, lint-agents, e2e and plugin tests
```

## Develop

```sh
bash scripts/validate.sh     # manifests, frontmatter, hook wiring
bash scripts/lint-agents.sh  # agent least-privilege rules
bash scripts/e2e.sh          # the whole chain in a sandboxed HOME; never touches your ~/.claude
```

Changes to skills, hooks or defaults are compared against Claude Code's
[best practices](https://code.claude.com/docs/en/best-practices); see
[`docs/BEST_PRACTICES_ALIGNMENT.md`](../docs/BEST_PRACTICES_ALIGNMENT.md). Release history is in the
[CHANGELOG](CHANGELOG.md). MIT licensed.
