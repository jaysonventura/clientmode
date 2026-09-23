# Client Mode

[![install](https://github.com/jaysonventura/clientmode/actions/workflows/install.yml/badge.svg)](https://github.com/jaysonventura/clientmode/actions/workflows/install.yml)
[![plugin](https://github.com/jaysonventura/clientmode/actions/workflows/plugin-ci.yml/badge.svg)](https://github.com/jaysonventura/clientmode/actions/workflows/plugin-ci.yml)

One operating model for **Claude Code, Codex, Gemini CLI and Cursor**, and the controller that keeps
it honest. Client Mode and the claude-dev-team orchestrator are merged into a single plugin, `cm`.

It does not write your app — your host does that. Client Mode is what makes every host work **test
first**, stop calling something ready without a check that ran, preserve what you said you *don't*
want as carefully as what you asked for, and keep the record straight when one host stops and another
picks up.

## Install

**macOS or Linux** — in Terminal:

```sh
curl -fsSL https://raw.githubusercontent.com/jaysonventura/clientmode/main/install.sh | sh
```

**Windows** — in PowerShell:

```powershell
irm https://raw.githubusercontent.com/jaysonventura/clientmode/main/install.ps1 | iex
```

That is the whole install. It needs no administrator rights and no Node: if Node ≥ 22.17 is missing, a
checksum-verified copy is downloaded into `~/.client-mode/runtime`. Then open a new terminal and run
`cm doctor`.

The hosts themselves are yours to install (Claude Code, Codex, Gemini CLI, Cursor); Client Mode
configures all four either way, so a host you add later picks it up. After adding Claude Code later,
run `cm install --host claude` (or just start it with `cm`) to finish its plugin install.

### Other ways to install

| Channel | Command | Gets you |
|---|---|---|
| One-liner (above) | `install.sh` / `install.ps1` | Everything below, for all four hosts |
| npm | `npm install -g github:jaysonventura/clientmode` then `cm install` | Same as the one-liner, using your own Node |
| Claude Code marketplace | `claude plugin marketplace add jaysonventura/clientmode` then `claude plugin install cm@clientmode` | The `cm` plugin in Claude Code only (no permission changes) |
| Codex marketplace | `codex plugin marketplace add jaysonventura/clientmode` then `codex plugin add cm@clientmode` | The `cm` skills in Codex only (no permission changes) |

Use one route per host: the one-liner already installs the plugin into Claude Code, and adding the
marketplace plugin on top of it in Codex would show every skill twice.

Options for the one-liner, set as environment variables first:

| Variable | Effect |
|---|---|
| `CM_HOSTS=claude,codex` | Configure only these hosts (default: all four) |
| `CM_NO_AUTONOMY=1` | Leave every host's approval / permission settings exactly as they are |
| `CM_REF=v2.0.0` | Install a tag or branch instead of `main` |

## What the install changes

Everything is recorded in `~/.client-mode/install-<host>.json`, including every value it replaced.
Existing content is kept; `cm uninstall` puts the replaced values back and leaves anything you changed
since then alone.

| Host | Rules loaded every session | Skills | Runs without prompts via |
|---|---|---|---|
| Claude Code | Client Mode section first in `~/.claude/CLAUDE.md` | `cm` plugin (`/cm:*` commands, agents, hooks, skills) | `permissions.defaultMode: "auto"` |
| Codex | Client Mode section in `~/.codex/AGENTS.md` | `~/.agents/skills/cm-*` | `approval_policy = "never"`, `sandbox_mode = "danger-full-access"` |
| Gemini CLI | Client Mode section in `~/.gemini/GEMINI.md` | `~/.agents/skills/cm-*` | allow-all user policy in `~/.gemini/policies/` |
| Cursor | `~/.cursor/rules/client-mode.mdc` (always applied) | `~/.agents/skills/cm-*` | CLI `approvalMode: "unrestricted"` |

Codex also gets a Stop hook (`~/.codex/hooks.json` → `~/.codex/cm/stop-gate.mjs`): when a turn ends
with changes, it runs the project's checks — the commands in `.cm/checks` if the project has that
file, otherwise its `typecheck` / `lint` / `test` scripts, otherwise `make test` — and hands a
failure back to the agent, for at most three repair cycles. Codex runs a new hook only after you
approve it once with `/hooks`. With `--no-autonomy` the hook is not installed: Codex keeps asking
before commands, and nothing runs a repository's checks unasked.

If the old `cdt@claude-dev-team` plugin is enabled it is switched off (it is part of `cm` now), and the
claude-dev-team section pasted into `~/.claude/CLAUDE.md` is moved into the install record.

**About running without prompts.** It removes the approval prompt, not the rules: Client Mode still
tells every host to ask in the conversation before money leaves an account, data leaves the project, or
anything irreversible happens. Codex in `danger-full-access` and Claude in auto mode can change files
anywhere your user account can. If you want the prompts, install with `CM_NO_AUTONOMY=1`.

## Use

Work in the app's own folder. Client Mode keeps one state directory per project under
`~/.client-mode/projects/`, so nothing is copied into the repo and projects never mix.

```sh
cd ~/path/to/your-app     # a new folder or an existing codebase; git not required
cm                        # opens your preferred host here, already briefed
```

| Command | What it does |
|---|---|
| `cm` | Start the preferred host in this folder with the handoff briefing |
| `cm use claude` / `codex` / `gemini` / `cursor` | Set which host a bare `cm` starts |
| `cm handoff` | What the last session left — whichever host it was |
| `cm run --request-file brief.txt` | Record a client request and start a tracked run |
| `cm status <run>` | State, readiness, and whether the client has accepted |
| `cm open` | Serve the console for a run in the browser |
| `cm doctor` | Install health, host capabilities, and what is *not* working |
| `cm install [--host …] [--no-autonomy] [--dry-run]` | Install or update; `--dry-run` writes nothing |
| `cm uninstall [--host …]` | Take it back out |

Write the brief in whatever language you'd use with a developer — English, Tagalog, mixed. What you
exclude matters as much as what you ask for: *"walang delivery fee"* and *"wag galawin ang presyo"* are
requirements.

## What every host follows

- **Test first, always.** Every behaviour change starts with a failing test, watched failing for the
  expected reason, then the smallest change that passes, then refactor. A bug fix starts with a test
  that reproduces it. The `tdd` skill carries the procedure for any stack.
- **Triage, bounded.** T0–T3 tiers and specialist roles from claude-dev-team, inside Client Mode's
  limits: one active writer, at most two child jobs at a time, one level deep. Wider fan-out only when
  you ask (`FULL:`, "use a workflow").
- **Done means observed.** Readiness comes from checks that ran, pasted with their output; a skipped
  or unavailable check is reported as a gap, never as a pass.
- **Grounded.** Library and API specifics come from the installed version's documentation, and builds
  go through the repository's own automation (Makefile first).
- **The client decides acceptance.** Verified is not accepted, and neither is written for them.

The skills, in every host: `orchestration`, `intake`, `requirement-intelligence`, `grounding`, `tdd`,
`delivery`, `debug`, `verify`, `review`, `handoff`, `ui-ux`, `automation-first`, `web-qa`, `mobile-qa`,
`qa-shared`, `clean-code-typescript`, `karpathy-guidelines`, `code-splitting`, `gauge-improvements`,
`technical-writing`, `database-change`, `ai-eval`. In Claude Code they are `cm:<name>`; elsewhere `cm-<name>`. The Claude plugin also
brings the specialist agents, the Bug Council, the Task Loop and cost analytics — see
[plugin/README.md](plugin/README.md).

## Uninstall

```sh
cm uninstall
```

Removes the rules, skills, plugin and toolkit, restores every setting it replaced, and removes the
downloaded Node and source. It leaves `~/.local/bin` on your PATH (other installers use it too) and
never touches client work under `~/.client-mode/projects/`.

## Known limits

- **What is checked, and where.** On every push, CI runs the one-liner on fresh macOS, Ubuntu and
  Windows (PowerShell 5.1) machines with no Node on PATH, checks every host's configuration, runs
  `cm doctor`, `cm handoff` and a failing command's exit code, and uninstalls. The Claude Code and
  Codex marketplace installs were run by hand from GitHub. Gemini CLI and Cursor settings follow their
  documentation but were not observed in a running session.
- **The 33 acceptance gates** are qualified on macOS with signed-in Claude Code and Codex
  (`scripts/verify-local.sh`). On Linux 16 of them need the macOS sandbox, live hosts or macOS document
  rendering; they fail there identically before and after the merge.
- **Cursor IDE:** "Run Everything" has no settings file — turn it on in Settings → Agents → Approvals &
  Execution. The Cursor CLI is configured.
- **Codex and Gemini CLI** still ask once per new folder whether to trust it. That is kept on purpose: an
  untrusted folder's own settings and MCP servers do not load until you say so.
- **Third-party Claude plugins** (ponytail, claude-mem) are no longer installed automatically at session
  start; turn that on with `cdt-config bootstrap-community on`. Official companions still install.
- **Claude auto mode** needs a Pro, Max or Team plan (or a supported cloud provider); elsewhere Claude
  starts in Manual mode.
- **Windows:** the plugin's Claude Code hooks run under Git Bash (`winget install --id Git.Git -e`); six
  of them were run under Git Bash on the Windows CI machine, where Python 3 was present — several hooks
  use it. The menu bar app is macOS-only.
- The sandbox for untrusted checks is macOS Seatbelt; on Linux and Windows isolation is `none` and says
  so.
- Nothing is deployed through it, and no paid service is used by it.

## Develop

```sh
git clone https://github.com/jaysonventura/clientmode.git && cd clientmode
npm ci
npm test                          # typecheck, reference tests, install tests, 33 acceptance gates
bash plugin/scripts/validate.sh   # the cm plugin: manifests, hooks, agents, skills
```

Running the gates rewrites the evidence artifacts under `qa/product/`, so the working tree goes dirty
after a verify run. That is normal churn.

| Path | What it is |
|---|---|
| `plugin/` | The `cm` Claude Code plugin: agents, commands, hooks, skills, toolkit, menu bar |
| `.claude-plugin/marketplace.json` | The `clientmode` marketplace (read by Claude Code and Codex) |
| `apps/cli`, `packages/` | The `cm` controller and installer |
| `adapters/global/` | The operating model every host loads |
| `install.sh`, `install.ps1` | The one-line installers |

The specification this was built from is still here: [START_HERE.md](START_HERE.md),
[ENGINEERING_HANDOVER.md](ENGINEERING_HANDOVER.md), [task index](docs/TASK_INDEX.md). Historical logs
under `qa/history/` are not current evidence.
