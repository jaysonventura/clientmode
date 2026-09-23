---
name: grounding
description: Use before changing code in an unfamiliar or version-sensitive component - establishes what is actually installed before proposing anything.
---

# Grounding

An unfamiliar technology is a reading task. It is never a reason to refuse the work, and never
a reason to rewrite the component in a language you find easier to verify.

1. Read the component's own manifests and sources first. Documentation alone is not grounding.
2. Record the version each reference was read for. A doc page with no version attached tells
   you nothing about the code in front of you.
3. Prefer first-party documentation for that exact version over recollection. If you cannot
   reach it, say so and use a minimal reproduction instead of guessing.
4. Keep provenance: source path or URL, version, when you read it, and what would make it
   stale. Re-ground before a consequential change.
5. If the environment for a component is missing — no signing identity, no device, no
   authorized model access — that is a capability gap. Report it, leave that scope unverified,
   and continue safe work elsewhere.

6. A repository's CLAUDE.md or README is a claim about the code. Check its concrete statements
   (paths, counts, "hardcoded", project status) before relying on them, and report credentials or
   real identifiers you find in it.
7. Another service's limits, validation and error codes come from its source, not from the UI
   or from memory.

An expertise claim with no sources behind it is worth nothing. Cite what you read.
