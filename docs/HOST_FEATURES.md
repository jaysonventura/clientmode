# Host features Client Mode relies on

Checked 2026-09-23 against the installed hosts: **Codex CLI 0.154.0** and **Claude Code 2.1.280**.
"0.154 ✓" means the local binary or its `--help` confirmed it; "docs" means the current first-party
page says so but the installed binary was not probed for it. Re-check this table whenever a host is
upgraded. A feature marked unavailable is not referenced by the rules or skills.

## Commands the person uses to steer

| Purpose | Codex | Claude Code |
|---|---|---|
| Durable goal the agent keeps working toward | `/goal` (+ `pause`, `resume`, `clear`) — 0.154 ✓ | `/goal` (`clear` removes it) — docs |
| Plan before editing | `/plan` — docs | `/plan`, or plan mode — docs |
| Side question without derailing the thread | `/side` — 0.154 ✓ | `/btw` — docs |
| Review the working tree | `/review`, `codex review` — 0.154 ✓ | `/code-review` (alias `/review`) — docs |
| Session state and token use | `/status` — 0.154 ✓ | `/status`, `/usage`, `/context` — docs |
| Summarise a long thread | `/compact` — 0.154 ✓ | `/compact` — docs |
| Branch the conversation | `/fork`, `codex fork` — 0.154 ✓ | `/rewind` to a checkpoint — docs |
| Fast tier (faster, costs more; not a saving) | `/fast` — docs | `/fast` — docs |

Sources: <https://learn.chatgpt.com/docs/cli/slash-commands>, <https://code.claude.com/docs/en/commands.md>.

## Effort and model defaults (Claude Code)

- `effortLevel` accepts `low`, `medium`, `high`, `xhigh`; `max` is session-only. With the key absent
  the model's own default applies (Opus 5.5: `medium`).
- With `model` absent the account default applies.
- Source: <https://code.claude.com/docs/en/model-config.md>.

Client Mode therefore writes neither key unless the person asks (`cdt-config effort <level>`).

## Hooks: deterministic checks outside the model

| | Codex | Claude Code |
|---|---|---|
| Supported | yes, `features.hooks` stable and on — 0.154 ✓ | yes — docs |
| Where | `~/.codex/hooks.json` or `config.toml` `[[hooks.<Event>]]`, repo `.codex/` — docs | `settings.json` `hooks`, plugin `hooks/hooks.json` — docs |
| Turn-end event | `Stop` (stdin has `stop_hook_active`, `last_assistant_message`) | `Stop` |
| Feed a failure back | `{"decision":"block","reason":…}` on stdout, or exit 2 + stderr | same |
| Trust | non-managed hooks are reviewed once through `/hooks` — docs | plugin hooks run when the plugin is enabled |

Sources: <https://learn.chatgpt.com/docs/hooks>, <https://code.claude.com/docs/en/hooks.md>.

## Skills: loaded only when relevant

Both hosts load only each skill's name and description at start and read the body when the skill is
picked, so a long skill costs nothing until it is used; a long description costs every session.
Codex caps the listing at roughly 2% of the context window. Both accept `scripts/` and `references/`
beside `SKILL.md`. Codex reads `~/.agents/skills` and the repo's `.agents/skills`.

Sources: <https://learn.chatgpt.com/docs/build-skills>, <https://code.claude.com/docs/en/skills.md>.

## Rules files

Both vendors advise a short, accurate rules file and moving repeated workflows into skills
(<https://learn.chatgpt.com/guides/best-practices>). Codex reads at most 32 KiB of `AGENTS.md` by default.

## Not confirmed

- Whether Codex 0.154 still reads `~/.codex/skills` (the binary mentions it; the docs do not).
- Whether the legacy `[features].codex_hooks` flag is still honoured (only `hooks` is listed).
- Claude Code rows marked "docs" were not probed in the installed binary.
