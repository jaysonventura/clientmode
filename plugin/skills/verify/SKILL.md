---
name: verify
description: Use before claiming anything works - separates what you ran from what a protected check observed.
---

# Verify

1. Run the project's own checks, in the project's own tooling. A check you invented because the
   real one was inconvenient proves nothing about this project.
2. Your local run is diagnostic. Readiness comes from the protected checks, which run under a
   different authority against the sealed candidate.
3. Say what you did not verify. A missing device, an absent credential, an unavailable model
   environment: name it, leave that scope unverified, and continue safe work elsewhere.
4. Never present a mocked integration as a live one. Label it: mocked, sandbox-tested, or
   production-tested.
5. Exit zero is not a pass. Zero discovered tests, unexpected skips, a stale candidate or an
   unparseable report are all rejections.

6. A project with no pre-deploy test gate (CI that only deploys, or none) is a gap to report,
   not a pass. Configuration is checked per stage: a value that works on staging says
   nothing about production.

Paste the command and its real output. A summary of a run nobody can reproduce is not evidence.
