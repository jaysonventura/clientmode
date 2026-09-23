---
description: Inspect & control CDT's Autonomous Agent Orchestration — the mode router (BOUNDED / DEPTH agent-team / BREADTH workflow) and its cost governor. status · gate <team|scale> · explain "<task>" · off|assist|auto.
allowed-tools: Bash
disable-model-invocation: true
---

Run the autonomous-orchestration controller with the user's arguments (default `status`):

```
~/.claude/bin/cdt-auto $ARGUMENTS
```

- **`status`** — show the autonomy mode (off/assist/auto), the DEPTH (teams) + BREADTH (scale) engines, the caps, and live weekly-budget headroom.
- **`gate <team|scale>`** — the governor decision the orchestrator consults before escalating: `ALLOW` / `ASK` / `DENY`.
- **`explain "<task>"`** — advisory preview of which mode the live router would lean to for a task.
- **`off | assist | auto`** — set the autonomy leash (delegates to `cdt-config autonomy`).

Present the output plainly. BOUNDED is the default. The engines are available (teams + scale enabled) but autonomy is **assist**: DEPTH/BREADTH run only when the person asks (`FULL:`, "use a workflow") or has opted in with `cdt-config autonomy auto`. **agent teams** need the experimental flag (`cdt-config teams on` sets it) and **scale mode** needs Claude Code ≥ 2.1.154; if either is missing, escalation falls back to bounded dispatch. On top of that, a **weekly-budget safety valve** ASKs (never silently DENYs) as you near the rate-limit ceiling.
