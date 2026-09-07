---
name: client-mode-delivery
description: Use when working a Client Mode task contract - keeps a worker inside its declared write scope and separates a claim from acceptance.
---

# Client Mode delivery

1. Read the task contract: requirements, allowed write paths, dependencies, stop conditions.
2. Work only inside the allowed write paths. A file outside them is out of scope even when
   changing it looks obviously right; report it instead.
3. Ground unfamiliar technology in the project's own manifests and the first-party docs for
   the version actually installed. Do not convert a component to another language to make it
   easier to verify.
4. Finish by reporting: what changed, what you ran, what you could not verify, and what a
   reviewer should look at first.

Your result is parsed, not trusted. Protected verification decides readiness.
