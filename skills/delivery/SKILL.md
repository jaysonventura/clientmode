---
name: delivery
description: Use when executing a Client Mode task contract - keeps a worker inside its declared scope and separates a claim from acceptance.
---

# Delivery

1. Read the task contract first: requirements, allowed write paths, dependencies, budget and
   stop conditions. Anything outside it is out of scope, however obviously right it looks.
2. Ground the change in the component's own sources: its manifests, the versions actually
   installed, and first-party documentation for those versions. Do not convert a component to
   another language to make it easier to work with.
3. Make the smallest change that satisfies the requirement, and leave the project's existing
   conventions in place.
4. Report what changed, what you ran, what you could not verify, and what a reviewer should
   look at first.

Your result is parsed, not trusted. Protected verification decides readiness, and a summary
saying the tests passed is not evidence that they did.
