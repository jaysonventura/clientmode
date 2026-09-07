# Official Capabilities and Evidence Boundaries

**Reviewed:** 7 September 2026 · **Handoff edition:** 1.3. The original vendor table was reviewed in v1.2; v1.3 refreshed selected skill/plugin/file-input and evaluation sources in the research ledger. Original official pages were fetched during that prior handoff review; several retrieved snapshots were indexed roughly three weeks earlier. Installed CLI/SDK behavior was **not** tested here. Engineers must run capability/permission probes and pin their observed versions before relying on any optional behavior.

This document is deliberately an integration contract, not another broad research campaign. Provider facts use official Anthropic/OpenAI documentation. Playwright and W3C are primary sources for their own testing/accessibility capabilities, not community orchestration dependencies.

## Capability decisions

| Capability | Evidence classification | Build instruction |
|---|---|---|
| Claude plugin packaging and local loading | Documented, not host-tested here | Generate a self-contained distribution; validate installed/cached loading. [S01] |
| Claude subagents | Documented, not host-tested here | Narrow tools and task contexts; do not assume plugin frontmatter supports every field. [S02] |
| Claude `/goal` | Documented/version-dependent | Continuation aid only; its evaluator reads surfaced conversation rather than independently executing checks. [S03] |
| Claude dynamic workflows | Documented, optional | Evaluate for genuinely independent orchestration; not required by the safety core. [S04] |
| Claude Agent Teams | Explicitly experimental in reviewed docs | Off in baseline; do not require it for durability or release. [S05] |
| Claude browser integration | Documented beta with prerequisites | Test account/platform/browser availability and isolate login state. [S06] |
| Claude Agent SDK | Documented | Supported programmatic loop; verify authentication/billing and permission setup. [S07] |
| Codex goals | Documented/version-dependent | Capability-probe the installed host; never make a goal-completed event a release verdict. [S08] |
| Codex subagents | Documented | Bound delegation and account for child usage; verify effective inherited permissions. [S09] |
| Codex plugins | Documented | Separate native distribution and fresh-session discovery test. [S10] |
| Codex SDK | Documented | Suitable for coding-thread integration; test supported session/event/cancel behavior. [S11] |
| Codex App Server | Documented integration surface | Assess for interactive auth/approval client; distinguish transport-specific maturity, not a blanket rejection. [S12] |
| Codex sandbox/security | Documented controls | Observe actual behavior, especially read access and external tools; never infer a complete boundary from a role name. [S13] |
| Autonomous production correctness | Not guaranteed | Must come from project-specific acceptance, independent evaluation, and monitoring. |
| Quiet client-company experience | Custom product | Build console, contracts, workflow, state, evidence, and permissions; not a native magic setting. |

## Specific cautions verified or carried into integration tests

Claude documents local plugin packaging and a local development loader. Plugin subagents ignore certain security-related frontmatter fields; use the correct configuration surface and test actual privileges. An independent-looking reviewer role is not a separate security principal. [S01, S02]

Claude's goal mode starts further turns, but the evaluator does not call tools to independently inspect files or execute tests. Therefore it is suitable for persistence, not the sole acceptance authority. [S03]

Claude browser integration shares browser login state and can pause for manual authentication. Do not assume a third-party-provider account, API key, unsupported OS, or generic browser is compatible. Its beta status and effective capability belong in the compatibility report. [S06]

Anthropic's Agent SDK documentation explicitly restricts offering claude.ai login/rate limits in third-party products without approval and directs developers to API authentication. Native plugin use and a separately built embedded/hosted product are different deployment modes. [S07]

Codex's current documentation supports native subagents and notes additional token work. SDK and App Server are distinct programmatic integration choices. Avoid copying unsupported internal handlers or treating an experimental transport restriction as a prohibition on the whole documented App Server. [S09, S11, S12]

Do not assert Codex CLI has a browser simply because another OpenAI product surface has one. Discover the available browser interface. The baseline cross-host release gate uses actual project-owned browser tests; interactive vendor browser capability is optional. [S14]

## Source register

- **S01 — Anthropic, Create plugins / Plugins reference.** [Plugin guide](https://code.claude.com/docs/en/plugins) and [technical reference](https://code.claude.com/docs/en/plugins-reference). Accessed 7 September 2026.
- **S02 — Anthropic, Create custom subagents.** [Official subagent documentation](https://code.claude.com/docs/en/sub-agents). Accessed 7 September 2026.
- **S03 — Anthropic, Keep Claude working toward a goal.** [Official goal documentation](https://code.claude.com/docs/en/goal). Accessed 7 September 2026.
- **S04 — Anthropic, Orchestrate subagents at scale with dynamic workflows.** [Official workflow documentation](https://code.claude.com/docs/en/workflows). Accessed 7 September 2026.
- **S05 — Anthropic, Orchestrate teams of Claude Code sessions.** [Official agent-team documentation](https://code.claude.com/docs/en/agent-teams). Accessed 7 September 2026.
- **S06 — Anthropic, Use Claude Code with Chrome (beta).** [Official Chrome integration](https://code.claude.com/docs/en/chrome). Accessed 7 September 2026.
- **S07 — Anthropic, Agent SDK overview.** [Official SDK overview](https://code.claude.com/docs/en/agent-sdk/overview). Accessed 7 September 2026.
- **S08 — OpenAI, Long-running work.** [Official documentation entry](https://developers.openai.com/codex/long-running-work), redirected to ChatGPT Learn during review. Accessed 7 September 2026.
- **S09 — OpenAI, Subagents.** [Official documentation entry](https://developers.openai.com/codex/subagents), redirected to ChatGPT Learn during review. Accessed 7 September 2026.
- **S10 — OpenAI, Plugins.** [Official documentation entry](https://developers.openai.com/codex/plugins), redirected to ChatGPT Learn during review. Accessed 7 September 2026.
- **S11 — OpenAI, Codex SDK.** [Official documentation entry](https://developers.openai.com/codex/codex-sdk), redirected to ChatGPT Learn during review. Accessed 7 September 2026.
- **S12 — OpenAI, Unlocking the Codex harness / App Server.** [Engineering article](https://openai.com/index/unlocking-the-codex-harness/) and [App Server reference](https://learn.chatgpt.com/docs/app-server). Accessed 7 September 2026.
- **S13 — OpenAI, Codex Security / Building a safe Windows sandbox.** [Security documentation](https://developers.openai.com/codex/security) and [sandbox engineering](https://openai.com/index/building-codex-windows-sandbox/). Accessed 7 September 2026.
- **S14 — Microsoft Playwright, Assertions.** [Official test assertions](https://playwright.dev/docs/test-assertions). Accessed 7 September 2026. Supports executable browser assertions, not subjective satisfaction certification.
- **S15 — W3C, Web Content Accessibility Guidelines 2.2.** [Normative accessibility standard](https://www.w3.org/TR/WCAG22/). Accessed 7 September 2026. Full conformance needs assessment beyond automated checks.

## Prior project material reviewed

The earlier `AI_Company_Client_Mode_Blueprint.md` and retrieved research titled **Client Mode: Evidence, Architecture, and Buildable Handover for Production-Grade AI Software Delivery** and **Proving an Autonomous, Client-Ready AI Software Delivery Workflow with Claude Code and Codex** informed requirements reconciliation. Their historical test claims are not treated as newly reproduced evidence. The source archive described in one report was not present among mounted source attachments; no copied old prototype is represented as reviewed or shipped in this package.

The latest repeated research requests in the chat do not themselves establish that a finished report or implemented system exists. This handoff stands on its own approved requirements and explicit fresh-check results.

## Edition 1.2 targeted recheck

The goal/workflow/subagent/plugin/SDK/security and App Server documentation was rechecked during this audit. This was a targeted documentation review, not a new authenticated runtime test or complete vendor source-code audit. Historical links and claims elsewhere do not override capability probes.

Claude's reviewed workflow documentation has material boundaries: keyword activation distinguishes actual human input from automated messages; the bundled research workflow requires explicit invocation in the documented current behavior. Native workflow resumption is within the same session, and an exit starts a fresh workflow. Workflow size guidance is advisory, and workflows cannot collect ordinary mid-run user input. [S04]

**Our implementation rule:** preserve input provenance; use authorized search or investigators when a bundled workflow cannot be invoked. Stage work around business questions. Keep durable Client Mode state outside the conversation. Disable a delegation path unless its actual child admission, cancellation and budget behavior meet our tested bounds. This is our policy, not a claim that a vendor's advisory setting enforces it.

The provider SDK's implementation languages are integration choices, not a language whitelist for the AI engineers. Native plugin packaging, autonomous continuation, protected acceptance and the quiet client console must each be tested separately. Configuration parsing alone does not prove effective permissions. [S02, S07, S09, S11]

## Edition 1.3 — document capability is surface-specific

Source IDs S01–S15 in this document are local to this register; they are distinct from S01–S20 in the company research ledger. The company and provider source ledger is `research/sources.json`; its companion report distinguishes published mechanisms from our proposed adaptation. Do not infer universal CLI document skills from a consumer chat product. Anthropic prebuilt Word/Excel/PDF/PowerPoint skills have documented product/API requirements; Claude Code custom skills require their own configured tools. OpenAI API PDF/non-PDF/spreadsheet handling is not uniform or proof of exhaustive spreadsheet analysis.

Our DocumentService, file inventory/provenance, editable export, spreadsheet calculation, document-only jobs, protected document QA and support-case process are custom components. They are not native provider configuration keys. Installers must probe them on the actual host. Official API use does not inherit subscription billing by assumption. Existing official-only provider-interface policy remains; normal maintained format libraries are allowed after approval/security/licensing checks.
