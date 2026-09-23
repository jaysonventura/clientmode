---
description: Enable/disable claude-dev-team, or pin/unpin effort and model (unpinned by default, so Claude Code's own defaults apply). Writes Claude Code settings safely (applies next session).
argument-hint: "[show | on | off | effort <default|low|medium|high|xhigh> | model <default|m> | reset]"
allowed-tools: Bash
---

Run the config CLI with the user's arguments and report the result:

```
~/.claude/bin/cdt-config $ARGUMENTS
```

Notes to convey:
- **on / off** toggles the whole orchestration layer (off → behaves as stock Claude Code next session).
- **effort** / **model** are written to `~/.claude/settings.json` (a safe merge — other settings are
  preserved) and apply on the **next session** (restart Claude Code). By default neither is pinned:
  the model's own effort default and the account's default model apply. `default` unpins either.
- `effort max` is session-only and can't be persisted (use `/effort max`). Match effort to the task:
  the default for ordinary work, higher for hard bugs, unfamiliar code or architecture.
- With no arguments, show the current config.
