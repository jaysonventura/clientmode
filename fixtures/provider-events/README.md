# Recorded provider protocol fixtures

Captured from the hosts installed on the build machine on 2026-09-08:
Claude Code 2.1.263 (`claude -p --output-format stream-json --verbose`) and
codex-cli 0.153.4 (`codex exec --json --skip-git-repo-check --sandbox read-only`).

They are recordings, not a specification. Normalisation is written against these observed
shapes and must tolerate shapes it has never seen: an unrecognised event is counted and
ignored, never interpreted. Session and thread identifiers are local to this machine and
carry no credential.

`claude-stream.jsonl` has this repository's SessionStart hook events removed; they are local
configuration noise, not part of the provider protocol.
