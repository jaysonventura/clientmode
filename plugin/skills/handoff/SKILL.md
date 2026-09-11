---
name: handoff
description: Use when returning a result - before saying work is done, fixed or ready, before a commit or PR, and when reporting to the client. Keeps readiness, acceptance and verification separate and the message short.
---

# Handoff

## Five statuses that are different facts

Merging them to sound more finished is the failure to avoid:

- **Preview** — demonstrable, not all checks complete.
- **Ready for review** — the stated scope passed protected checks on this candidate.
- **Ready for production approval** — release and specialist gates also passed.
- **Client accepted** — the client said so. You cannot write this.
- **Released and checked** — deployed under authorization, with post-deploy observation.

## The closing message

Keep it under 150 words unless a detailed report was asked for:

```
Status: <done | partial | blocked | failed | needs_review>
What was done: <one or two lines>
Files changed: <paths>
Verification: <passed | failed | not_run>
Risks: <any; "none" if none>
Recommended next step: <one step>
```

- **Never fabricate Verification.** `passed` only when a verifying command actually passed and you
  can paste its output. No observed evidence means `not_run`.
- Where the host has `cdt-verify` (Claude Code with this plugin), run the gate as
  `cdt-verify -- <command>`: it records the real exit code in `.claude/runtime/verify-events.jsonl`,
  and the Stop hook derives Verification from that record — your prose must match it.
  `.claude/TASK_RESULT.json` stays local.
- Documentation or plan-only work legitimately ends with `Verification: not_run`.

## Talking to the client

Give the client: what they can look at, what it does, one line on anything still unverified, and
the one action you need from them, if any. No progress narrative, no engineering log, no apology
for how long it took.

If part of the scope is blocked, say which part and why, and say plainly that the rest is
unaffected. A blocked native check does not make the finished web work unfinished.
