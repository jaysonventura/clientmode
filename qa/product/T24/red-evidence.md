# AT-024 — red evidence

Gate: `tests/tasks/T24.test.ts`, executor `tests/scenarios/T24.scenarios.ts`.
Command: `node --import tsx --test tests/tasks/T24.test.ts` (about 40 s, two live host turns).

This is a **rehearsal of the release path, not a release**. Nothing was published, and nothing was
deployed to a real destination.

## What was executed

1. **Frozen artifacts.** Both distributions built from this tree at `1.3.0-rc1`, each `tar`-archived
   and checksummed; `SHA256SUMS` written beside them.
2. **Fresh-machine install from the archive.** Each archive unpacked, every unpacked file's digest
   compared against the distribution's declared digests, then installed into
   `…/fresh-machine/Client Mode ñ` — a path with a space and a non-ASCII character. An
   `existing-settings.json` already on the machine survived both installs unchanged.
3. **Both adapters, live.** `claude` 2.1.263 and `codex` 0.153.4 each loaded their own adapter
   instructions in a fresh disposable project and printed `CLIENT_MODE_INSTRUCTIONS_LOADED`.
4. **A supported client request, end to end.** "i want customers to be able to order rice from
   their phone" → run created, contract bound, candidate sealed, protected verification executed
   in the sandbox, verdict `VERIFIED_FOR_SCOPE`.
5. **Staged rollout, then rollback.** Staging promoted under a release-owner approval. Production
   attempted twice without authority and refused both times: with no approval
   (`UNKNOWN_APPROVAL`) and by reusing the staging grant (`ENVIRONMENT_MISMATCH`,
   `ALREADY_CONSUMED`). The destination recorded exactly one promotion, to staging. Both
   distributions then uninstalled, and the install tree fingerprinted byte for byte back to its
   pre-install state.
6. **Inventory.** Generated from this tree: archive and distribution checksums, all 27 declared
   dependencies with installed version and licence, supported versions observed on this machine,
   24 gates against 24 evidence directories, 4 runbooks, retention periods, and a named support
   owner with a response target. No gaps.
7. **Publication.** `RELEASE_REMIT.md` and `QUALIFICATION_MEASURED.md` ship separately, with
   `CLIENT_GUIDE.md` and `SUPPORT.md`. All four pass the publication linter. A marketing paragraph
   was put through the same linter and refused on four counts.
8. **Four signoffs, four stores.** Toolkit qualification (verifier authority), deliverable technical
   readiness (verifier evidence), client acceptance (controller state), production release (release
   authority). A worker's attempt to record client satisfaction was refused
   (`SATISFACTION_IS_CLIENT_AUTHORED_ONLY`); client acceptance did not authorise a production
   deploy; a worker could not seal evidence.
9. **Traceability.** 61 of 80 requirements evidenced by executed base-task gates, 19 explicitly
   deferred to T25–T33, 0 no-go.

## Mutations proving the assertions are load-bearing

| # | Mutation | Result | Observation that flipped |
|---|----------|--------|--------------------------|
| C1 | `install.ts` — uninstall leaves its files behind | **RED** | `fresh_install_and_rollback_passed` |
| C2 | `inventory.ts` — dependency and licence inventory omitted | **RED** | `artifact_inventory_complete` |
| C3 | `adapters/claude/CLAUDE.md` — the delivery marker removed | **RED** | `both_adapters_qualified` — the live host answered, but not with the marker |
| C4a | `approvals.ts` — approval environment no longer has to match | green | `ALREADY_CONSUMED` still refused the reused grant |
| C4b | `approvals.ts` — environment **and** consumption checks removed | green | `checkPromotable` still refused; production was never promoted |
| C4c | `approvals.ts` — an unknown approval is accepted | **RED** | `FOREIGN KEY constraint failed` on `deployments.approval_id`; the promotion never reached the destination and the gate went red on the raised error |
| C5 | `docs/CLIENT_GUIDE.md` — the list of things the client never does removed | **RED** | `client_not_required_to_manage_markdown_or_agents` |
| C6 | `publication.ts` — linter stops recognising universal claims | **RED** | `remit_separate_from_measured_qualification` |
| C7 | `lifecycle.ts` — a worker may record client satisfaction | **RED** | `toolkit_app_client_and_release_signoffs_separate` |
| C8 | `tests/tasks/T05.test.ts` removed from the suite | **RED** | `base_software_requirements_have_evidence_or_explicit_no_go` |

Production promotion is guarded four deep: the approval's environment, its consumption state,
`checkPromotable`, and a foreign key on `deployments.approval_id`. Three separate mutations were
needed before the gate turned red, and even then nothing reached the destination.

## A retention bug this task exposed

`Evidence.open()` removed the whole `qa/product/<task>/` directory at the start of every run. That
deleted the hand-written `red-evidence.md` beside the generated JSON **every time the suite ran**,
so the failure artifacts for T01–T19 were destroyed before they were ever committed. Only T11 and
T20 survive in git history, from commits made before the next suite run.

`Evidence.open()` now clears only the `.json` files it generates. The rehearsal records
`red_evidence_retained` so the gap is visible rather than assumed, and the missing write-ups are
being regenerated by re-running each task's mutations. The gates themselves were unaffected: they
executed and their generated artifacts are current.

## Scope

Base software release rehearsal only. Edition 1.3 also requires T25–T33 and gates G7 and G8. No
public deployment, paid service or production action was performed.
