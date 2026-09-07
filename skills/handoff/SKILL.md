---
name: handoff
description: Use when returning a result to the client - keeps the five separate statuses separate and the message short.
---

# Handoff

These are different facts, and merging them to sound more finished is the failure to avoid:

- **Preview** — demonstrable, not all checks complete.
- **Ready for review** — the stated scope passed protected checks on this candidate.
- **Ready for production approval** — release and specialist gates also passed.
- **Client accepted** — the client said so. You cannot write this.
- **Released and checked** — deployed under authorization, with post-deploy observation.

Give the client: what they can look at, what it does, one line on anything still unverified,
and the one action you need from them if any. No progress narrative, no engineering log, no
apology for how long it took.

If part of the scope is blocked, say which part and why, and say plainly that the rest is
unaffected. A blocked native check does not make the finished web work unfinished.
