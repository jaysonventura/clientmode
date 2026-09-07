# What established technology companies do — and what Client Mode should adopt

**Research date:** 7 September 2026. **Audience:** Implementing engineers. **Edition:** 1.3.

## Executive finding

Adopt the responsibilities and evidence-producing mechanisms of mature product teams, not a large fictional org chart. Client Mode needs product discovery, architecture, design, implementation, QA, security, document operations, technical writing, delivery, and post-release learning. One client-facing lead owns the outcome; most specialist responsibilities are invoked only when needed. This mapping is our design recommendation, not a claim that a model has acquired the expertise or accountability of these companies.

The prior v1.2 package covered engineering-company responsibilities but its attachment boundary accepted only images and inert text. It did not define a complete PDF/Word/Excel analysis/edit/export lifecycle. Research also exposed useful missing detail around documentation-as-delivery, source changes, document-only work, and support-to-product feedback. Edition 1.3 closes these as build requirements, contracts and tests of those contracts—not as finished live features.

## 1. Findings from public first-party sources

| Public practice | Evidence | Application to Client Mode |
|---|---|---|
| Start from a customer problem and measure the resulting outcome | AWS describes working backwards, a product owner spanning the lifecycle, and iterative customer feedback. [S01] | Lead writes a compact internal outcome brief and acceptance contract. Owner supplies vision, not a large requirements document. |
| Cross-functional product flow | GitLab describes validation, design, implementation, review and verification, with relevant disciplines involved. [S02] | Work has an owner, inputs, outputs and gates. Keep lightweight paths for small tasks. |
| Documentation with implementation | GitLab assigns technical-writing collaboration to product documentation, UI copy and release information. [S03] | Deliver user/admin/API/runbook documentation that matches actual code, including tested examples. |
| Specific code review rather than symbolic approval | Google reviews design, function, tests, maintainability and documentation, and asks reviewers to state their boundaries. [S04, S17] | Review findings identify paths, expected behavior and reproduction. Style preferences do not become infinite blocking loops. |
| Security in design | Microsoft SDL ties asset/data-flow analysis and threat mitigation to engineering work and tests. [S05] | Build hostile-file, prompt-injection, authorization and release threat cases before shipping, not as a late security label. |
| Design beyond attractive screens | Microsoft accessibility guidance and GitLab's design workflow connect product design with accessibility, research and writing. [S06, S16] | Check native/browser interaction, content, accessibility and references. Separate model critique from actual user research. |
| Reliability and incident learning | Google's published SRE material covers error-budget policies and postmortems. [S07, S08] | Define explicit operational health, incident ownership and regression follow-up. Do not copy a sample SLO as a promise. |
| Support feeds product and knowledge | GitLab's support responsibilities include issue creation, documentation improvement and coordination with development. [S09] | A support report becomes a reproducible issue and, after verification, a knowledge update. |

These public sources describe particular company practices, not one universal organization followed by every large company. Some are living handbooks, others older engineering guidance; source dates and access notes are preserved in `sources.json`. They establish sensible mechanisms, not a causal proof that copying them makes AI output production-ready.

## 2. Responsibility coverage and limits

**Core product delivery:** client lead; PM/PO support; business/document analyst; architecture/CTO responsibility; engineering/delivery coordination; UX research/design/content; stack-appropriate implementation; QA; security/privacy; release/reliability; technical writer/editor.

**Triggered services:** spreadsheet/data analysis, integration research, accessibility/localization review, model evaluation, performance work, customer onboarding/support, incident analysis, dependency/license inventory, and cost estimation. A simple edit must not invoke all of these roles. The role catalogue in the operating model states triggers, output and authority.

**Owner or qualified-human decisions:** legal interpretation and signatures, accounting certification, employment decisions, spending, data-sharing authorization, destructive operations, and release authority. AI may prepare drafts or evidence within scope; it does not impersonate a lawyer, accountant, executive signatory or staffed support organization.

**Not automatic product scope:** HR/payroll, a CRM, sales outreach, procurement execution, full legal practice, a corporate ERP, and staffed 24/7 operations. These may be future client projects, but are not prerequisites for an AI engineering service. Publishing documents, sending proposals/emails, buying services and contacting customers are external actions requiring separately scoped authorization.

## 3. What the document capability must really include

File reading is not the same as document review; review is not editing; editing is not a faithful, usable export. The new workstream distinguishes all four.

Reading must cover native text and relevant visuals, with a version-specific page, sheet/cell, paragraph, slide or image-region reference. Whole-document claims require an inventory and coverage record. Scans need targeted OCR/visual inspection where native extraction fails. Unreadable values remain unknown. Spreadsheet calculations use a real, compatible calculation path, not model arithmetic or cached cell values presented as recomputed.

Review reconciles contradictions across sources and preserves original business meaning. Editing writes a new version, logs semantic changes, protects original bytes and reopens the result. Export QA inspects output content and rendering, identifies fidelity limits and produces an artifact that really exists. A document-only request must not create a software project or deploy anything.

For technical writing, code/API/reference documents are inputs; executable examples are tested in a sandbox against the stated implementation version. New summaries, support articles or AI-generated notes do not silently become authoritative business rules.

## 4. Feasible provider building blocks versus custom work

Anthropic documents prebuilt Office/PDF skills on specific platform surfaces, but distinguishes these from custom skills in Claude Code. [S10] We therefore require host capability probes; engineers must not assume claude.ai behavior is already installed in Claude Code.

OpenAI's file-input guide describes PDF text plus page-image input, text extraction for non-PDF documents, and a reduced spreadsheet representation limited to the first 1,000 rows per sheet. [S11] That path cannot establish full workbook inspection or preserve unseen embedded charts. A tested parser/renderer/calculator is needed for the required full scope. Microsoft Open XML provides an official structural-tooling example. [S13]

Official Claude plugins and Codex skills are distribution surfaces for reusable procedures. [S14, S15] They do not implement Client Mode's access controls, source lineage, semantic fidelity, document QA or artifact authority. Local-first original tools are the default recommendation. A provider document API may be an optional backend only with explicit billing/privacy approval and runtime tests. No community plugin or unofficial MCP server is required.

## 5. Evidence plan

Add known-answer file fixtures with mixed text/tables/visuals; a scanned ambiguous number; a workbook with more than 1,000 rows, hidden sheets, formulas and stale caches; Word revisions and tables; a presentation with content only in a chart; conflicting cancellation/pricing rules; malicious macros/links; changed and deleted sources; and a reviewer asked to invent a missing fact.

Track extraction/coverage failures, citation correctness, material semantic changes, exact numerical results, output fidelity, unauthorized actions and cost per accepted result. Use repeated held-out comparisons as recommended by OpenAI's evaluation guidance. [S12] Document evidence and software evidence remain separate, and neither can prove client satisfaction without client feedback.

Zero observed critical failures is a release gate for these tests, not proof of zero risk everywhere. All-stack AI remit stays broad; measured qualification must identify exact task, toolchain and environment.

## 6. Build decisions

Keep the current controller, quiet console, protected verifier and provider adapters. Add a document service and document jobs alongside—not disguised as—software runs. Reuse the budget, permissions and evidence authority. Add two workstreams: document/knowledge operations (T25–T30), and company service/qualification closure (T31–T33). T24 now proves the base engineering release path; T33 is the full edition 1.3 shipping decision.

Do not install dozens of new services, preload whole manuals into every worker, or run one permanent agent per title. Store compact source-linked facts, retrieve only task-relevant material, and measure the overhead. Quiet reporting does not suppress blockers or incidents.

## 7. Research boundaries

This was a first-party desk review and a local handoff/reference-contract update. No company was interviewed, no private internal system was inspected, and no evidence establishes that this custom AI team matches Google, Microsoft, Amazon or GitLab performance. We did not run document parsing/rendering engines, live coding agents, user studies, native-device tests or production operations here. All such work remains in the engineering acceptance plans.

## Sources

- **S01 — Amazon / AWS: [The Secrets to AWS Product Management](https://aws.amazon.com/executive-insights/content/product-management-at-amazon/).** Undated page; retrieved 2026-09-07. Supports: Customer-backward problem definition, product ownership, iteration and outcome metrics.
- **S02 — GitLab: [Product Development Flow](https://handbook.gitlab.com/handbook/product-development/how-we-work/product-development-flow/).** Living handbook; retrieved 2026-09-07. Supports: Cross-functional flow through validation, implementation, review and verification.
- **S03 — GitLab: [Documentation workflows](https://docs.gitlab.com/development/documentation/workflow/).** Living documentation; retrieved 2026-09-07. Supports: Technical writers collaborate on documentation, UI text and release communications.
- **S04 — Google: [What to look for in a code review](https://google.github.io/eng-practices/review/reviewer/looking-for.html).** Undated engineering guidance; retrieved 2026-09-07. Supports: Review design, function, tests, maintainability and documentation; declare review boundaries.
- **S05 — Microsoft: [Secure by Design / SDL](https://www.microsoft.com/en-us/securityengineering/sdl/practices/secure-by-design).** Living guidance; retrieved 2026-09-07. Supports: Identify assets, data flows and trust boundaries; track threat mitigations and test them.
- **S06 — Microsoft: [Fluent 2 accessibility](https://fluent2.microsoft.design/accessibility).** Living design documentation; retrieved 2026-09-07. Supports: Accessibility is a design and implementation concern.
- **S07 — Google: [Example Error Budget Policy](https://sre.google/workbook/error-budget-policy/).** Example policy dated 2018-02-19; retrieved 2026-09-07. Supports: Reliability objectives and error budgets can govern feature release versus repair priority.
- **S08 — Google: [Postmortem Culture: Learning from Failure](https://sre.google/sre-book/postmortem-culture/).** SRE book chapter; retrieved 2026-09-07. Supports: Use incident analysis and preventive follow-up to improve reliability.
- **S09 — GitLab: [Support Engineer Responsibilities](https://handbook.gitlab.com/handbook/support/support-engineer-responsibilities/).** Living handbook; retrieved 2026-09-07. Supports: Support connects customer problems to debugging, product issues and documentation improvements.
- **S10 — Anthropic: [Agent Skills overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview).** Living platform documentation; retrieved 2026-09-07. Supports: Prebuilt document skills are available on named platform surfaces; Claude Code custom skills are distinct.
- **S11 — OpenAI: [File inputs](https://developers.openai.com/api/docs/guides/file-inputs).** Living API guide; retrieved 2026-09-07. Supports: PDF processing includes text/page images; non-PDF input is text-only; spreadsheet augmentation samples up to 1,000 rows per sheet.
- **S12 — OpenAI: [Evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices).** Living API guide; retrieved 2026-09-07. Supports: Evaluate task-specific outcomes systematically rather than relying on subjective success impressions.
- **S13 — Microsoft: [Welcome to the Open XML SDK for Office](https://learn.microsoft.com/en-us/office/open-xml/open-xml-sdk).** Living reference; retrieved 2026-09-07. Supports: Official libraries support programmatic work with Office Open XML document structures.
- **S14 — OpenAI: [Build skills](https://learn.chatgpt.com/docs/build-skills).** Living documentation; retrieved 2026-09-07. Supports: Reusable skills package task instructions/resources.
- **S15 — Anthropic: [Create plugins](https://code.claude.com/docs/en/plugins).** Living documentation; retrieved 2026-09-07. Supports: Official plugin packaging supports reusable Claude Code extensions.
- **S16 — GitLab: [Product Designer Workflow](https://handbook.gitlab.com/handbook/upstream-studios/product-design/workflow/).** Living handbook; retrieved 2026-09-07. Supports: Product designers work with UX researchers, PMs and technical writers.
- **S17 — Google: [The standard of code review](https://google.github.io/eng-practices/review/reviewer/standard.html).** Undated engineering guidance; retrieved 2026-09-07. Supports: Balance improved code health with forward progress; distinguish nonblocking polish from required corrections.
