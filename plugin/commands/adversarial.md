---
description: Adversarially verify a risky change or high-impact finding — independent Opus reviewers, two at a time, each try to REFUTE it; a refutation with a reproduction sends it back. Bounded, production-grade, gated for high-stakes work.
argument-hint: <the change / claim / finding to stress-test>
---

Run the **adversarial verify** pattern (STEP 3f of the `orchestration` skill) on:

Target: $ARGUMENTS

1. Confirm this is worth it — adversarial verify is for **risk-flagged or high-impact** work (auth /
   payments / infra / migrations / security, or a finding you're about to act on). For routine changes the
   normal Wave-2 review is enough; say so and stop.
2. Gather the concrete artifact first: the diff/change, the claim, and the real evidence (command output,
   the relevant `file:line`s). No hand-waving.
3. Dispatch **2-3 independent reviewers, two at a time** (**Opus**, never Haiku — bounded Agent calls; a
   dynamic workflow only when the person asks for one), each with a tight contract to **REFUTE**:
   - "Try to prove this change is wrong / unsafe / incomplete. Find the failing case, the missed edge, the
     security hole. Default to **NOT PROVEN** if you can't be sure. Ground every point in a real
     `file:line` or command output."
   - Give each a **distinct lens** where it helps: correctness · security · does-it-actually-reproduce.
4. Weigh the verdicts: a refutation that comes with a reproduction (or security flagging risk ≥ medium)
   means **rework before ship**; one without a reproduction is recorded as a minor finding. Reproductions
   decide, not a majority vote. Otherwise record that it survived adversarial review. This **deepens** the Wave-2 review and the
   security veto — it never replaces them.
5. Keep it bounded — dissolve the reviewers after the verdict; persist anything durable via `cdt-learn`.
