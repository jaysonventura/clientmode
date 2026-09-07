# Measured qualification

This is what was actually observed, on this machine, at these versions. Whatever is missing from
this page was not measured.

## Environment observed

| Subject | Version |
|---|---|
| Node.js | 22.17.0 |
| macOS (darwin-arm64) | Darwin 25.5.0 |
| TypeScript | 5.9.3 |
| Chromium (Playwright) | 153 |
| claude | 2.1.263 |
| codex | 0.153.4 |
| pdftotext (poppler) | 26.03.0 |
| Ghostscript | 10.05.1 |

## Task families observed

| Family | Evidence |
|---|---|
| Web UI and browser journeys | AT-006, AT-014, AT-021 |
| Non-JavaScript backend (Python) | AT-023 |
| Native macOS (Swift) | AT-016, AT-021, AT-023 |
| Systems (Rust) | AT-023 |
| Model and retrieval evaluation | AT-016, AT-021 |
| Polyglot components | AT-003, AT-012 |
| Ordinary-language and mixed-language briefs | AT-013, AT-023 |
| PDF, DOCX, XLSX, PPTX, CSV/TSV, PNG and text ingestion | AT-025, AT-033 |
| Document inventory, extraction and citation resolution | AT-026, AT-033 |
| Cross-document conflict reporting and source invalidation | AT-027 |
| Spreadsheet recalculation in integer minor units | AT-028, AT-033 |
| Document editing, export, reopening and render inspection | AT-029, AT-033 |
| Document jobs, quiet client experience and the shared budget | AT-030 |
| Company responsibilities, support cases and closure | AT-031, AT-032, AT-033 |

150 unseen holdout trials across four toolchains, 150 verified, 0 false-ready, 0 high-severity
escaped defects. 180 pilot trials with overlapping confidence intervals between arms, so no arm
is reported as better than another.

## Explicitly not observed

- Windows and Linux: not observed. This build was exercised on macOS only.
- Android and iOS device or simulator runs: not observed; the iOS holdout spec is reported blocked.
- Go and Kotlin: not observed, the toolchains are not installed on this machine.
- A live provider comparison: blocked, no metered evaluation budget is approved.
- Production deployment to a real destination: not observed; the release path is rehearsed against
  a mock destination.
- Real-user research and WCAG conformance: not observed. Automated accessibility checks cover a
  rule subset only.
- OCR: not observed. No OCR engine is installed, so text inside an image and the text on a
  scanned page are reported as unestablished rather than read.
- An office suite: not observed. LibreOffice is not installed, so layout fidelity beyond the
  structural and render checks described above is not qualified.
- Legacy DOC, XLS and PPT, password-protected files and macro-enabled documents: refused, not
  supported.

## Residual limitations

Budget enforcement is a pre-dispatch reservation; a request already in flight can overshoot its
estimate. Automated design review does not establish taste. The benchmark's worker is simulated
and is named as such wherever its numbers appear.
