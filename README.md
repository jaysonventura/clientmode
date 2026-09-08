# Client Mode

An operating model for Claude Code and Codex CLI, plus the controller that keeps it honest.

It does not write your app — your host does that. Client Mode is what stops a session calling
something ready without a check that ran, preserves what you said you *don't* want as carefully
as what you asked for, and keeps the record straight when one host stops and the other picks up.

Built and verified: 33 acceptance gates, 67 tests. Every gate retains the artifacts it observed
and a write-up of the failure it was watched to produce before it was allowed to pass. What the
gates do **not** cover is written down beside them, in each task's `red-evidence.md`.

## Install on a Mac

Needs **Node ≥ 22.17.0**. Installing works with or without the host CLIs present; you need
`claude` or `codex` on the machine to actually run sessions, and `cm doctor` reports which of
them it found.

```sh
git clone git@github.com:jaysonventura/clientmode.git
cd clientmode
npm install

npx tsx apps/cli/src/cm.ts install --host claude --lead
npx tsx apps/cli/src/cm.ts install --host codex  --lead     # if you use both
```

That builds a self-contained toolkit into `~/.client-mode/toolkit`, writes a launcher to
`~/.local/bin/cm`, installs eight skills into each host, and puts the Client Mode rules at the
top of `~/.claude/CLAUDE.md` and `~/.codex/AGENTS.md` inside a marked block. Anything already in
those files is kept and backed up.

If `~/.local/bin` is not on your `PATH`, add it:

```sh
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc && exec zsh
```

Check it:

```sh
cm doctor        # exits 0 when the install is healthy; names what is wrong when it is not
```

After this the checkout is only needed to rebuild. `cm` runs from `~/.client-mode/toolkit`.

### Options

| Flag | Effect |
|---|---|
| `--lead` | Client Mode leads; whatever was in the instructions file becomes reference material below it |
| `--install-root <dir>` | Install into a host directory other than `~/.claude` / `~/.codex` |
| `--bin-dir <dir>` | Put the launcher somewhere other than `~/.local/bin` |
| `--dry-run` | Print the exact change set and write nothing |

Remove it again with `cm uninstall --host claude`, which takes back exactly the marked block and
the files the install record names, and nothing else.

## Use

Work in the app's own folder. Client Mode keeps one state directory per project under
`~/.client-mode/projects/`, so nothing is copied into this repo and projects never mix.

```sh
cd ~/path/to/your-app     # new folder or an existing codebase; git not required
cm                        # opens your preferred host here, already briefed
```

| Command | What it does |
|---|---|
| `cm` | Launch the preferred host in this folder with the handoff briefing |
| `cm use claude` / `cm use codex` | Set which host bare `cm` opens |
| `cm handoff` | What the last session left — whichever host it was |
| `cm run --request-file brief.txt` | Record a client request and start a tracked run |
| `cm status <run>` | State, readiness, and whether the client has accepted |
| `cm open` | Serve the console for a run in the browser |
| `cm doctor` | Install health, host capabilities, and what is *not* working |

**Start every session in a project folder with `cm handoff`.** If Claude stopped halfway through
a task, Codex resumes *that* task rather than the next one; a task counts as done only when
evidence was recorded, so a session cannot simply declare it.

Write the brief in whatever language you'd use with a developer — English, Tagalog, mixed. What
you exclude matters as much as what you ask for: *"walang delivery fee"* and *"wag galawin ang
presyo"* are requirements, and dropping one is work you have to undo.

## Verify a checkout

```sh
./scripts/verify-local.sh      # typecheck, 33 gates, reference tests, handoff validation
```

The last section of that output is scoped `HANDOFF_REFERENCE_ONLY` — it validates the handoff
*documents* and predates the built system. Its `not_executed` list is not the system's coverage
statement; the gates are.

Running the gates rewrites the evidence artifacts under `qa/product/`, so the working tree goes
dirty after a verify run. That is normal churn.

## Known limits

- The sandbox is macOS Seatbelt. On Linux or Windows isolation degrades to `none` — reported
  honestly rather than assumed, but untrusted checks would not be contained there.
- Provider cost comparison arms are simulated. No metered budget has been spent.
- Nothing has ever been deployed through it. No paid service, no public surface.
- Document gates use synthetic files: real PDF and OOXML byte structures, generated so the
  right answer is known in advance.
- The verifier runs as the same OS user as the controller. On a single-user machine that is the
  accepted residual; a compromised controller can read the signing key off the disk.

## The handoff package

The specification this was built from is still here: [START_HERE.md](START_HERE.md),
[ENGINEERING_HANDOVER.md](ENGINEERING_HANDOVER.md), [task index](docs/TASK_INDEX.md),
[document workflow](docs/DOCUMENT_WORKFLOW.md), [research](research/COMPANY_PRACTICES.md).
Historical logs under `qa/history/` are not current evidence.
