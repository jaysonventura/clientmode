---
name: debug
description: Use when a check fails or behaviour is unexplained - drives to a reproduction and a cause before any fix.
---

# Debug

1. Reproduce it first. A failure you cannot trigger on demand is not diagnosed, and a fix for
   it cannot be verified.
2. Write down the hypothesis and what would falsify it. Then test that, not the fix.
3. Find where all the callers route through. The smallest correct change is usually one guard
   in the shared path, not a guard in each caller.
4. Repeating the same diagnosis without new evidence is not another attempt; it is a blocker.
   Record what you tried and stop.

Three repair cycles per task. Loosening a gate or adding workers to make a failure disappear
is not a repair.
