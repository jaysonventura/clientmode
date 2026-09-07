# Client Mode build ledger

Engineering record of what has actually been executed. Evidence for each task is under
`qa/product/<task>/` and is produced by running the gate, not written by hand.

Reproduce everything:

```bash
npm install
npm run typecheck && npm run test:tasks && npm run test:reference
.venv/bin/python scripts/validate_all.py     # handoff package checks
```

## Milestone M1 — deterministic core: COMPLETE

| Task | Gate | Mode | Status | Evidence |
|---|---|---|---|---|
| T01 | AT-001 | unit | PASS | `qa/product/T01/` |
| T02 | AT-002 | integration | PASS | `qa/product/T02/` |
| T03 | AT-003 | integration | PASS | `qa/product/T03/` |
| T04 | AT-004 | unit | PASS | `qa/product/T04/` |

Handoff package validation: PASS on all five checks, including full Draft 2020-12 validation
of the schema and all 32 example instances, which the received package could not run.

Each gate carries `red-evidence.md` (T02–T04): the implementation was mutated, the gate went
red on the exact observation the mutation targets, and the mutation was reverted. T01's
fail-closed observation is proved by a control run in `validator-absence-probe.json`.

## Explicitly not proven yet

- No provider is integrated. `tests/harness/fake-provider.ts` is an offline mock protocol
  adapter and satisfies no live-provider gate (M3/T09–T11).
- No protected verification exists. `sealCandidate` takes an injected builder and runs it in
  this process; the isolated unprivileged runner, signed evidence and the separate verifier
  principal are M2 (T05–T07).
- No console, installer, document pipeline, qualification or release path exists
  (M4–M8, T13–T33).
- Budget figures are fixture microdollars. Cap enforcement is `pre_dispatch_reservation`
  with `in_flight_overrun_possible: true`; it is not a hard spend guarantee.
- The approval store is a separate database with a separate schema, but it currently lives
  under the same OS principal. That is a deployment convenience, not the isolation the
  handoff requires; T08 and T20 own the real separation.

## Environment findings

- **PyPI is unreachable from this machine** (`pypi.org` and `files.pythonhosted.org` both
  time out; `registry.npmjs.org` is reachable). `jsonschema` 4.26.0 was installed into a
  local `.venv` from the existing `uv` cache. The handoff's Python checks therefore run as
  `.venv/bin/python scripts/validate_all.py`. A machine without that cache cannot currently
  install the dependency.
- Go is not installed, so the polyglot fixture's Go component is reported `BLOCKED` with a
  capability gap. That is the intended honest behaviour, not a test failure.

## Pending separate technical review

`qa/product/EVALUATOR_CHANGES.md` records two scoping changes to the handoff validation
scripts, made because T01 installs the toolkit's dependencies into the same repository root
the scripts scan. Neither removes an assertion; both need a reviewer's sign-off.
