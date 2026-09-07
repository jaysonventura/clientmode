# Client Mode — Engineer Handoff 1.3

**Date:** 7 September 2026. **Status:** Consolidated build specification and executable reference checks, not an installed or qualified AI company.

## Assignment

Build the complete local-first Client Mode product. The owner describes an outcome in ordinary English, Tagalog, Taglish, screenshots or documents. One AI lead manages product interpretation, research, UI/UX, all-stack engineering, testing, review, repair, technical writing and authorized release preparation. The owner does not operate agents, create Markdown, translate office files into prompts or repeatedly say “continue.” Quiet operation still shows important questions, blockers and truthful results.

Document-only work is first-class: PDF, Word, spreadsheets, presentations and images can be reviewed/analyzed without starting a software project. Editing/export, formulas, source references and real document QA are separate implemented capabilities. Company responsibilities are triggered outputs, not permanent employees or an unapproved HR/CRM/24-hour support business.

## Begin here

Read the [master specification](ENGINEERING_HANDOVER.md), [document workflow](docs/DOCUMENT_WORKFLOW.md), [company operating model](docs/AI_COMPANY_OPERATING_MODEL.md), [all-stack remit](docs/AI_ENGINEER_STACK_SCOPE.md), [delivery protocol](docs/DELIVERY_PROTOCOL.md), [security boundaries](docs/SECURITY_AND_RELEASE.md) and [qualification](docs/QUALIFICATION.md). Public company research and its limits are in [Company practices](research/COMPANY_PRACTICES.md). Use [release acceptance](docs/RELEASE_ACCEPTANCE.md) before shipping.

Execute eight plans and 33 tasks in the [task index](docs/TASK_INDEX.md), following dependency IDs. T24 is the previous software release-path rehearsal; T33 closes the full v1.3 assignment after document and service gates. The complete scope must not stop at a plugin manifest or green web demo.

The [build prompt](BUILD_PROMPT.md) can be given to Claude Code/Codex or human engineers. Use Superpowers execution/TDD/debugging/review methods if already installed. This is an authoring method, not a dependency of the shipped system; equivalent steps are written into the plans. No community orchestration framework, skill pack or unofficial MCP is required. Maintained ordinary application/test/document libraries remain allowed.

## What is included

80 traced requirements; 33 concrete unexecuted product scenarios; eight implementation plans; architecture, domain/TypeScript/OpenAPI designs, source/document/support records and reference SQL; documented provider capability boundaries; company-source research; software/document QA and release guidance; narrowly executable reference/schema tests. No live Client Mode application, document processor, installed plugin or production deployment is included.

## Reproduce handoff checks

An engineer can run from this directory:

```bash
python3 scripts/validate_all.py
```

Required local tools: Node.js, Python 3.9+, jsonschema and TypeScript compiler. The script performs no installs, provider calls or production operations; missing required tools fail. Full OpenAPI validation and live service conformance are additional implementation gates. Proposed `cm` commands are interfaces to build, not provided executables.

## Authority and version status

This full package supersedes v1.2 and earlier ZIPs. Originals were preserved. [Review findings](qa/REVIEW_REPORT.md) and [actual validation](qa/HANDOFF_VALIDATION.md) distinguish checked reference contracts from unexecuted product requirements. Draft schemas require tested migrations for any existing prototype; do not overwrite its database with reference DDL.

The AI engineers handle any appropriate client stack; the toolkit may remain TypeScript. Missing hardware, account, toolchain or parser capability is an explicit verification gap, not a reason to force JavaScript or fabricate success. Access, extra spending, public communication, destructive operations and release remain scoped approvals. Continue ordinary engineering without turning the client into the project manager.
