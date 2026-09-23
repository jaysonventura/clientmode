---
name: debug
description: Use when a check fails, a bug is reported or behaviour is unexplained - drives to a reproduction and a proven root cause before any fix, then fixes it test-first.
---

# Debug

Fix the cause, not the symptom. A fix you cannot explain is a guess.

## Process

1. **Reproduce it first.** A failure you cannot trigger on demand is not diagnosed, and a fix for
   it cannot be verified. Build the minimal reproduction.
2. **Gather evidence.** The real error, stack, logs, inputs and the actual code path. Read the
   code — do not theorise from a function name.
3. **Write down hypotheses and what would falsify each.** Test that with a targeted probe, not the
   fix. Keep only the hypotheses that explain *all* the observations.
4. **Ask why until you reach the mechanism.** "Null here" → why null → which caller → why that
   path → the actual defect.
5. **Confirm before fixing.** A probe that toggles the behaviour proves the cause.
6. **Fix where all the callers route through.** The smallest correct change is usually one guard
   in the shared path, not a guard in each caller.
7. **Fix it test-first** (`tdd`): a regression test that fails before the fix and passes after.
   Then look for siblings: every call site, parallel path, copied block and sibling target with
   the same mistake. Fix them or say why not, and list them in the commit. A fix that reaches one
   of several sites is not done.

## Anti-patterns

Shotgun changes hoping something works. Suppressing the error (`try/catch`, `?.`, `!`) without
understanding it. Declaring victory without re-running the reproduction. Fixing the symptom one
layer above the real cause.

## When stuck

Repeating the same diagnosis without new evidence is not another attempt; it is a blocker.
The second failed fix for the same failure is the last one: stop editing and report the
reproduction, the evidence, the suspected cause, what you tried and what is still unknown, then
convene the Bug Council; it ranks causes, and the reproduction still decides. At most three repair
cycles per task, then a BLOCKER. Before starting a fresh session, record a handoff: state, files,
the exact error, the failed attempts and what remains.
Without the council command (other hosts), work its five lenses one after another: root cause,
history, known patterns, system interactions, adversarial inputs.

Loosening a gate or adding workers to make a failure disappear is not a repair.
