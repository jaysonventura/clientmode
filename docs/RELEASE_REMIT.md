# AI engineering remit

This document says what the engineering side will take on. It is not a statement of what has
been measured — that is `QUALIFICATION_MEASURED.md`, and the two are deliberately separate.

## What we take on

Client requests written in ordinary language, in English or mixed English and Filipino. Work on
the technology the client already has, in the language it is already written in. Where a stack is
unfamiliar to the toolkit, the work begins by reading the project's own source and installed
manifests, not by rewriting it into something more convenient.

## How the work is bounded

- A candidate reaches the client only with sealed evidence from the protected verifier.
- A component is observed on its own target. A browser observation is not offered for a native
  or model component.
- An environment that is missing is reported as a capability gap. It is not inferred, and it is
  not quietly substituted.
- Cost is accounted whole-tree, and a counter the provider did not settle is unknown, not zero.

## What is out of scope for this build

Public deployment, paid third-party services, credential handling on the client's behalf, and
destructive production actions. None of them are authorised by this release.
