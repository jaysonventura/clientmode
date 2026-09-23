# Handoff execution contract

The user approved the Client Mode product direction and requested engineer handover. Execute the specification; do not turn routine engineering back into a client questionnaire.

Read `START_HERE.md` and `ENGINEERING_HANDOVER.md` first. Normative precedence is: actual user authorization and organizational policy; security/release constraints; master requirements; validated schemas and interface contract; numbered implementation plans. Vendor configuration must conform to official documentation for the installed version. Resolve contradictions before the affected change, not by silently weakening requirements.

Use installed Superpowers execution/TDD/debugging/review/verification skills where appropriate. These are authoring aids, not shipped dependencies. If unavailable, the plans contain the required red–green–refactor and evidence rules.

Preserve existing user changes. Inspect before editing. Make small tested commits. Delegate only bounded independent work. Do not ask the client to create Markdown, research APIs, choose internal libraries, approve every plan, or relay worker messages. Keep normal progress reporting minimal.

All proposed `cm` commands and `packages/` modules in this handoff are to be built. Do not pretend they exist now. Never use undocumented vendor commands copied from an older report without revalidation.

Required evidence cannot be authored by the implementation worker as a substitute for execution. Changes to protected policy, evaluator code, or approval rules need separate technical review. Stale, missing, skipped, forged, or uninterpretable results cannot authorize readiness.

No public deployment, paid service, credential harvesting, or destructive production action is authorized by this handoff. Use synthetic data for qualification. Stop on exhausted budget or persistent no-progress; preserve state and report the smallest real blocker.

AI engineering remit is open-ended across technology stacks. `docs/AI_ENGINEER_STACK_SCOPE.md` is normative. Toolkit implementation choices do not constrain client languages or platforms. Ground task-specific expertise, preserve polyglot components, use target-native checks, and report gaps without pretending perfect knowledge.

Read `docs/AI_COMPANY_OPERATING_MODEL.md`, `docs/DELIVERY_PROTOCOL.md` and `docs/RELEASE_ACCEPTANCE.md`. Role titles never grant permissions. Client questions are separate from approval requests. Preserve actor provenance; never mark coordinator/worker text as human input to trigger a vendor feature.

Edition 1.3 adds the normative DOCUMENT_WORKFLOW.md under docs and first-party COMPANY_PRACTICES.md under research. Complete all eight plans and 33 tasks; T24 is a base release rehearsal, T33 is full closure. Route document-only work separately, preserve original bytes, ground findings with source versions, calculate rather than guess, and verify exported content/layout. Company responsibilities remain bounded by actual authority. Read updated release/qualification gates G7/G8.

Every change to the rules template, plugin skills, hooks or defaults is compared against Claude Code's best practices (<https://code.claude.com/docs/en/best-practices>). Run `node scripts/check-best-practices.mjs`; if the page changed, re-read it and update `docs/BEST_PRACTICES_ALIGNMENT.md` before the change lands.
