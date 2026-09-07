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

## Milestone M3 — provider integration: COMPLETE

| Task | Gate | Mode | Status | Evidence |
|---|---|---|---|---|
| T09 | AT-009 | integration | PASS | `qa/product/T09/` |
| T10 | AT-010 | live_provider | PASS | `qa/product/T10/` |
| T11 | AT-011 | live_provider | PASS | `qa/product/T11/` |
| T12 | AT-012 | integration | PASS | `qa/product/T12/` |

Both provider gates ran **live** against the hosts installed on this machine — Claude Code
2.1.263 and codex-cli 0.153.4 — on the existing authorized native account, in throwaway
projects outside this repository. No metered API billing was configured.

- a fresh Claude session loaded the generated `CLAUDE.md` and returned its marker; a resumed
  session recovered a codeword stored in the previous turn under the same session id
- a fresh Codex session loaded the generated `AGENTS.md`; asked to write a file under
  `--sandbox read-only` it refused, and the filesystem confirms nothing was created
- argv for both adapters comes from each host's own `--help` on this machine, and every
  permission-escape flag is refused before a process is spawned

## Milestone M4 — client experience: COMPLETE

| Task | Gate | Mode | Status | Evidence |
|---|---|---|---|---|
| T13 | AT-013 | integration | PASS | `qa/product/T13/` |
| T14 | AT-014 | integration | PASS | `qa/product/T14/` |
| T15 | AT-015 | integration | PASS | `qa/product/T15/` |
| T16 | AT-016 | live_provider | PASS | `qa/product/T16/` |

- three equivalent briefs (English, rough English, Taglish) produce one approved scope, and a
  brief that asks technical questions gets zero questions back
- the real React console, served by the real controller and driven by Chromium: 17 events
  recorded, 2 narrated, a markup reference rendered inert, cross-origin and worker mutations
  refused with 403
- the whole loop end to end on one brief with one live provider turn and **zero** continue
  prompts: verified candidate → bound preview → client feedback → second verified candidate →
  interruption → resume at the correct phase

## Milestone M5 — install and operations: COMPLETE

| Task | Gate | Mode | Status | Evidence |
|---|---|---|---|---|
| T17 | AT-017 | live_provider | PASS | `qa/product/T17/` |
| T18 | AT-018 | integration | PASS | `qa/product/T18/` |
| T19 | AT-019 | integration | PASS | `qa/product/T19/` |
| T20 | AT-020 | integration | PASS | `qa/product/T20/` |

- both distributions built from one source tree, installed under a path with a space and a
  non-ASCII character beside existing configuration, loaded by both live hosts, and uninstalled
  back to a byte-identical tree
- measured on darwin-arm64 / Node 22.17.0: 1000 tasks recovered in 16 ms, cancel recorded in
  3.2 ms, a forked grandchild stopped after writing 13 bytes
- six secret canaries pushed through worker, tool and provider paths and then searched for in
  the whole stored log: none found
- a candidate's attempts to overwrite the verifier database, read the signing-key directory and
  rewrite the CI workflow all refused with EPERM, and its planted policy and `pass.json` never
  consulted

## Milestone M6 — qualification and release: COMPLETE

| Task | Gate | Mode | Status | Evidence |
|---|---|---|---|---|
| T21 | AT-021 | integration | PASS | `qa/product/T21/` |
| T22 | AT-022 | benchmark | PASS | `qa/product/T22/` |
| T23 | AT-023 | benchmark | PASS | `qa/product/T23/` |
| T24 | AT-024 | manual_review | PASS | `qa/product/T24/` |

- 38 adversarial attacks executed against the real services; every one rejected, with the
  production reason recorded per attack in `qa/product/T21/attacks.json`
- three controls proved redundant rather than single-point: approval replay (consume +
  UNIQUE index), late worker results (attempt status + lease epoch + lease activity) and
  referential integrity (connection pragma + schema file). Each needed every layer removed
  before the gate went red
- these are the **public** mutation fixtures from `docs/QUALIFICATION.md` section 3, which are
  engineering regressions, not held-out proof; the unseen holdout belongs to AT-023
- 180 pilot trials executed (20 predeclared specs x 3 arms x 3 repeats) in a seeded interleaved
  order against frozen snapshots, each a real verification through the protected authority:
  accepted rates 0.600 / 0.650 / 0.800 with **overlapping** 95% intervals, so no arm is claimed
  better than another and the claim linter refuses the sentences that would say otherwise
- **the live provider pilot is blocked**: AT-022 requires an approved metered evaluation budget
  and none is configured. The arm is retained as blocked; no live comparison is reported
- 150 holdout trials on 50 unseen specs, frozen configuration digest recorded before the holdout
  was opened and a leak scan over 78 shipped files finding nothing: 150/150 verified success,
  0 false-ready, 0 escaped defects, 36/36 paired English/Taglish briefs equivalent, both live
  hosts answered. A JavaScript-only subset of the same trials is refused qualification
- the holdout found two real defects: `interpret()` matched `order` but not `orders`, and the
  reviewer's findings were reported from the last repair cycle only. Both fixed
- release path rehearsed end to end: both distributions archived and checksummed, installed from
  the archive into a path with a space and a non-ASCII character, both adapters loaded live, a
  client request carried to `VERIFIED_FOR_SCOPE`, staging promoted under approval, production
  refused twice, and both distributions uninstalled back to a byte-identical tree
- production promotion is guarded four deep; three separate mutations were needed before the gate
  turned red, and nothing reached the destination even then
- 61 of 80 requirements evidenced by executed base-task gates, 19 explicitly deferred to T25-T33,
  0 no-go. Nothing was published and nothing was deployed to a real destination

### Retention bug found and fixed in T24

`Evidence.open()` removed the whole `qa/product/<task>/` directory at the start of every run,
which deleted the hand-written `red-evidence.md` beside the generated JSON every time the suite
ran. The failure write-ups for T01-T19 were destroyed before they were ever committed; only T11
and T20 survive in git history. The writer now clears only the `.json` files it generates, and
`qa/product/T24/rehearsal.json` records `red_evidence_retained` so the gap stays visible. The
gates themselves were unaffected.

The write-ups have since been **regenerated by re-running the mutations**, not reconstructed from
memory. `qa/product/MUTATION-MATRIX.md` is the whole record: 34 mutations that a gate caught, the
gate coverage they give (all twenty base gates covered), and the eleven mutations no gate detected
with the reason for each. Running the catalogue also found three security-relevant controls that
no gate exercised — the dispatch depth ceiling, and approval expiry and candidate scope in
`ApprovalAuthority.authorize`. All three scenarios were strengthened and the mutations re-run to
confirm the gates now go red. Two narrow gaps remain open and are named in the matrix.

## Milestone M7 — document intelligence: COMPLETE

| Task | Gate | Mode | Status | Evidence |
|---|---|---|---|---|
| T25 | AT-025 | integration | PASS | `qa/product/T25/` |
| T26 | AT-026 | integration | PASS | `qa/product/T26/` |
| T27 | AT-027 | integration | PASS | `qa/product/T27/` |
| T28 | AT-028 | integration | PASS | `qa/product/T28/` |
| T29 | AT-029 | integration | PASS | `qa/product/T29/` |
| T30 | AT-030 | integration | PASS | `qa/product/T30/` |

- PDF, DOCX, XLSX, PPTX, CSV/TSV, PNG and text are read and written by first-party format code:
  a ZIP reader that enforces the container limits before decompressing anything, an OOXML
  reader that reaches hidden sheets, comments, revisions and slide notes, and a PDF builder
  whose output is extracted by `pdftotext 26.03.0` and rendered by Ghostscript 10.05.1
- the calculation engine is first-party with a declared capability set. `XLOOKUP` is reported
  unsupported rather than approximated, external links stay disabled, and money is integer
  minor units throughout. The workbook's cached totals (150,000 and 145,000) are both reported
  as differing from the recalculation (150,250 and 145,250)
- **no OCR engine and no office suite are installed.** Text inside an image is reported
  uncertain, a scanned page is reported as having no text layer, and neither is guessed at
- the document verification authority is separate from the software one in every sense that
  matters: its own database, its own policy records, its own evidence kind, and a software
  evaluator that refuses to open a `document_evidence` payload at all
- 26 mutations executed across the six gates; two needed a second layer removed before the
  gate went red, and both pairs are recorded

## Milestone M8 — company service and ship: COMPLETE

| Task | Gate | Mode | Status | Evidence |
|---|---|---|---|---|
| T31 | AT-031 | integration | PASS | `qa/product/T31/` |
| T32 | AT-032 | integration | PASS | `qa/product/T32/` |
| T33 | AT-033 | qualification | PASS | `qa/product/T33/` |

- a button wording change engages two responsibilities and one worker; a refund-and-permissions
  change engages seven, four of them requiring review. The risk tier has three independent
  inputs and a writer cannot lower it
- support cases start from the client's actual words and resolve only on evidence that was
  produced: the defect reproduced against the running fixture, the fix observed, a regression
  linked and the runbook revised. Monitoring is not configured, and the coverage statement says
  so; 24/7 and SLA language is refused
- **all 33 gates swept: 33 evidenced, 0 no-go.** Each has a test file, an executor, retained
  JSON artifacts and a red-evidence write-up
- document state survives a schema upgrade and the restore that undoes it; the job is READY
  before, during and after
- the job is technically READY and the client records `needs_changes` on the same work. Neither
  changes the other, which is the whole point of four separate signoffs

## Explicitly not proven yet

- Provider integration is proved on **one machine at one version each**. That is not a
  compatibility matrix; T23 owns that. The SDK and App Server transports are described and
  reported `configured` at most, never observed.
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
