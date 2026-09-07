# Observed Handoff Validation — Edition 1.3

**Prepared:** 7 September 2026. **Scope:** Package/reference contracts only. Client Mode is NOT built, installed, document-runtime-qualified or production-proven. G0 does not satisfy G1–G8.

## Checks actually executed

| Check | Observed result |
|---|---|
| Existing Node evidence/signature/state reference tests | 67 passed, zero failed/skipped |
| Python schema/storage/API regression tests | 109 passed, zero failed |
| Combined reference test methods | 176 passed; not product acceptance tests |
| JSON Schema Draft2020-12 and synthetic examples | Schema valid; 32 examples validated with format checks |
| Strict TypeScript boundary definitions | No-emit compilation passed |
| Traceability | 60 functional + 20 non-functional requirements mapped to 33 tasks and 33 scenario groups |
| Plan consistency | Eight plans; acyclic declared dependencies; literal test expectations match scenarios |
| API contract checks | 39 operations structurally checked, with targeted request-schema/auth/revision regressions |
| Research linkage | 20 primary source records and mechanism/requirement/task pointers checked structurally |
| Markdown and package source inspection | Local links, balanced code fences, unresolved-marker check and PEM private-key marker check passed |

The 57 new document-related Python methods test synthetic metadata, schema/API constraints and reference SQL; they do not open actual PDF/Word/Excel/PowerPoint files. The remaining 52 Python tests and all 67 Node tests preserve the prior reference coverage. Test counts describe discovered unittest/Node methods; some have multiple subcases.

Run `python3 scripts/validate_all.py` from the package root. It needs Node, Python/jsonschema and TypeScript; it installs nothing and calls no model. Missing required tools fail. The final machine report and exact commands/exit codes are [validation.json](current/validation.json). Logs are in the same directory. A successful empty TypeScript log contains no compiler diagnostics.

## What was NOT executed

No Client Mode service/quiet console, live API endpoint, authenticated Claude/Codex session, plugin installation, real PDF/Office extraction, OCR, rendered output review, workbook recalculation, file editing/export, browser/native-device/LLM application, hostile-file process sandbox, protected CI authority, document signature acceptance service, live budget test, customer study, model improvement comparison, held-out trial, client acceptance or production deployment.

The API package received structural checks and selected request-schema tests, not a full OpenAPI validator or runtime conformance suite. New document source/evidence JSON examples are deliberately synthetic; hashes, observer names and PASSED fields in examples are test data, not real execution evidence. Reference SQL constraints do not authenticate a caller or implement an upgrade migration.

The 33 planned product scenarios remain `NOT_EXECUTED_PRODUCT_TEST`. Known-answer real files, primary journeys, fault injection and qualification must be implemented and run by the engineering team. Document read/edit/export, arithmetic, layout and safety claims need separate actual evidence.

## Archive verification

After the last validation run, the packager removes Python bytecode, writes SHA256SUMS for every included file except the manifest itself, creates the complete ZIP and verifies its CRC, path safety and every listed SHA-256 against the ZIP bytes. This verifies package integrity, not independent signature authenticity or product quality. Re-running the handoff tests changes QA log timestamps; regenerate distribution checksums before repackaging a modified copy.

## Baseline and history

The actual original v1.2 tests were run before changes. Prior QA reports are preserved as history under `qa/history/v1.2/`, not current proof. Additional red/green logs record new contract gaps and corrections under `qa/review-evidence-v1.3/`. The original source archive was not overwritten. [Review report](REVIEW_REPORT.md) records dispositions and remaining obligations.
