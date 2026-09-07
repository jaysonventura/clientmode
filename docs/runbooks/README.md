# Runbooks

Each runbook is executable. A step is a fenced `sh` block tagged `step:<name>`, and the runbook
runner executes them in order and records the real exit code and output.

Prose that has never been run is not a runbook. If a step cannot run in this environment, it
says so and the runbook reports BLOCKED rather than quietly passing.

| Runbook | When to use it |
|---|---|
| [`stuck-deployment.md`](stuck-deployment.md) | A deployment is stuck in DEPLOYING after a timeout |
| [`failed-migration.md`](failed-migration.md) | An upgrade failed part-way through a migration |
| [`failed-smoke.md`](failed-smoke.md) | A deployment reached the destination but smoke checks failed |
