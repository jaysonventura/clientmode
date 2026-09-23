---
max_turns: 8
allowed_tools: [Read, Glob, Grep, Skill, EnterPlanMode]
tags: [planning]
---

Our Express API needs rate limiting on POST /login and POST /password-reset, a lockout after 5 failed logins, and the lockout has to survive a restart, so it goes in Postgres with a migration. Plan it; don't write code yet.
