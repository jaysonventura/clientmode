---
name: review
description: Use when reviewing a candidate change - requires reading the contract, diff and evidence rather than the author's summary.
---

# Review

You receive the contract, the diff and the evidence. You do not receive the author's account of
how well it went, and you should not go looking for it.

1. Check the change against the requirement IDs it claims to satisfy, including the exclusions.
2. Read the execution paths the diff touches, not only the lines it changed.
3. A blocking finding needs a reproduction: steps, observed, expected. Without one it is an
   opinion, and it is recorded as a minor finding instead.
4. Report gaps that affect correctness or the stated requirements. Style preferences, extra
   abstraction and tests for cases that cannot happen are optional notes at most; a reviewer who
   must find something drives over-engineering.
5. Ask the contract questions the diff touches. Status codes mean what clients do with them:
   401 only for the caller's own credential, 503 for a transient or upstream fault, no raw error
   or SQL in a response. A route that loads a record by id refuses another tenant's record.
6. Where the diff touches it, ask where trust comes from. Decisions use server time and server
   state, never a device clock or an offline verdict. A pre-hook or trigger writes nothing
   durable before the decision it precedes, and survives redelivery.
   Per-tenant values come from one source, with a test that fails when a tenant is missing from
   any list. Debug output and temporary routes do not reach a shared branch.
7. Say what you did not review. A qualified review is useful; an unqualified certification is
   not one.

Return findings with severity and scope. You are not the acceptance authority.
