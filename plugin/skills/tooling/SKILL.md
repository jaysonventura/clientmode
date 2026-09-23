---
name: tooling
description: Use when a task would go better with a tool you lack - an MCP server, CLI, linter, test runner or plugin. Finds one with evidence, tries it narrowly, keeps it only if it measurably helps.
---

# Picking up a tool

A senior engineer installs the tool the job needs without being told, and does not install one
because it looks nice. Same here: name the need, check the evidence, try it small, measure, then
keep or remove it.

## 1. Need

Name the failure or cost the tool addresses in this task: "no way to run the iOS tests from the
terminal", "reading raw build logs costs thousands of tokens per run". No named need, no install.

## 2. Proof bar

All of these, recorded with where you read them:

- Publisher: the vendor, the stack's own toolchain, Anthropic's official or community plugin
  marketplace, or the Anthropic Directory for MCP servers. Otherwise clear adoption and upkeep: a
  release in the last 12 months, an open-source license, issues answered.
- A pinned version or commit. Never `curl | bash` or another pipe-to-shell install.
- Its risks checked against the OWASP MCP Top 10 (beta) for an MCP server: tool poisoning, supply
  chain, over-broad scopes and tokens, command injection, shadow servers. Anthropic reviews
  directory listings but does not security-audit any MCP server (code.claude.com/docs/en/security).
- Official docs for the version you install, read before you configure it (`grounding`).

## 3. Who decides

- **Decide and do, then report:** project dev tooling from the stack's official registry that clears
  the proof bar: the exact package name checked (typosquats look alike), pinned, the lockfile
  committed on the working branch - a linter, a test runner, `@types`. Prefer `--ignore-scripts`
  where the tool works without its install scripts. Git reverts the files, not what an install
  script ran, so a package that runs install scripts or downloads binaries (the Playwright npm
  package fetches browsers) is ask-once unless the project already uses it.
- **Ask once per tool and per scope, naming the tool, the scope and what it can reach:** MCP servers,
  Claude Code plugins,
  global or system installs (`brew`, `npm -g`), anything that needs a login, a key or money, and
  anything that sends project data off the machine. An MCP server runs code with the person's
  privileges and sees the conversation.
- **Never:** an unverifiable source, a pipe-to-shell install, typing a credential, or switching off
  a check so a tool works.

## 4. Try it narrowly

- MCP: install at local scope first (`claude mcp add --scope local`: private to this project, in
  `~/.claude.json`);
  project scope (`.mcp.json`, shared through git) only when the team should get it, and only after
  asking again: it reaches everyone who clones the repository. A new server
  connects at the next session: tell the person a restart is needed. In Codex the same step is
  `codex mcp add <name> -- <command>`.
- `.mcp.json`, `.claude.json` and `.claude/` are protected paths. Editing them to skip a prompt is
  out: never work around a host approval prompt.
- Read-only tools or a sandbox first; widen only when the task needs it.

## 5. Measure, then keep or remove

Run the same task with and without the tool and compare pass rate, tokens and time
(`gauge-improvements`). A benefit you did not measure is unknown, not a win. Keep it only if it
helped; otherwise remove it (`claude mcp remove`, uninstall, revert the lockfile).

Record what you installed, where, the version, the evidence and how to remove it:
`cdt-learn "<tool>: <why kept or removed>" tooling`.

## Examples

- Apple platforms: Xcode's MCP bridge gives build, test, issues, previews and Apple documentation
  search to any terminal agent. Turn on Xcode > Settings > Intelligence > "Allow external agents to
  use Xcode tools", then `claude mcp add --transport stdio xcode -- xcrun mcpbridge` (ask once).
  Xcode must be running with the project open. Apple publishes no tool list, so read the tool
  names on first use.
- A web project with no end-to-end runner: propose the Playwright npm package as a pinned dev
  dependency (ask once: it downloads browser binaries), then run the journey through `web-qa`.
