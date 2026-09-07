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

Each gate carries `red-evidence.md` (T02–T08): the implementation was mutated, the gate went
red on the exact observation the mutation targets, and the mutation was reverted. T01's
fail-closed observation is proved by a control run in `validator-absence-probe.json`.

## Milestone M2 — protected acceptance: COMPLETE

| Task | Gate | Mode | Status | Evidence |
|---|---|---|---|---|
| T05 | AT-005 | integration | PASS | `qa/product/T05/` |
| T06 | AT-006 | integration | PASS | `qa/product/T06/` |
| T07 | AT-007 | integration | PASS | `qa/product/T07/` |
| T08 | AT-008 | integration | PASS | `qa/product/T08/` |

What these gates actually executed, rather than modelled:

- a hostile candidate fixture denied a secret file, a signing-key environment canary, the host
  home directory, a direct-IP connection and a real unix socket, under a generated macOS
  Seatbelt profile; a forked grandchild stopped writing after the process-group kill
- a real shop service with SQLite persistence, driven through Chromium 153 at 360/390/768/1440
  CSS px with axe-core 4.11.0, plus API probes for pricing, idempotency and validation
- a Swift 6.3.1 binary compiled and interacted with on this host, a CPython 3.14 service, and a
  deterministic grounding evaluation — each observed with its own tooling
- 58 evidence forgery and staleness cases against the product readiness predicate with real
  Ed25519 keys, all UNVERIFIED
- one deployment side effect across a crash, a reconciliation and two replays, counted at a
  destination that records every call

## Explicitly not proven yet

- No provider is integrated. `tests/harness/fake-provider.ts` is an offline mock protocol
  adapter and satisfies no live-provider gate (M3/T09–T11).
- No console, installer, document pipeline, qualification or live release path exists
  (M4–M8, T13–T33). The release path is exercised against a mock destination only.
- Execution isolation is a macOS Seatbelt sandbox under the **same OS user** as the
  coordinator. It is a kernel boundary, not the separate principal or container the handoff
  requires for release; `isolation.limitations` says so in every evidence record. T20 owns it.
- 38 iOS simulators are present on this host but no iOS app was built or driven. The composite
  evaluator refuses a browser observation offered for a native component, so that scope stays
  UNVERIFIED rather than quietly covered.
- Automated accessibility checking covers a rule subset. It does not establish WCAG 2.2 AA
  conformance; manual keyboard and assistive-technology review of key flows is outstanding.
- Budget figures are fixture microdollars. Cap enforcement is `pre_dispatch_reservation`
  with `in_flight_overrun_possible: true`; it is not a hard spend guarantee.
- The approval store is a separate database with a separate schema, but it currently lives
  under the same OS principal. That is a deployment convenience, not the isolation the
  handoff requires; T20 owns the real separation.

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
