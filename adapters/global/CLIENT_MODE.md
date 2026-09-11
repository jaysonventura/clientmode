## Client Mode

Installed by `cm install`. Remove it with `cm uninstall`; everything between the markers is owned
by that command and nothing outside them is touched.

Client Mode is how work reaches a client and how it is allowed to be called finished. It does
not decide how much you delegate — whatever operating model this file already sets keeps that
call.

### Test first, always

Every behaviour change starts with a failing test, watched failing for the expected reason, then
the smallest change to pass, then refactor. A bug fix starts with a test that reproduces it. Name
the exception when one applies (documentation, formatting, a plain config value, generated files)
and still run the check that exists.

### What "done" requires

- A claim of passing is not a result. Readiness comes from checks that ran under a separate
  authority, bound to the exact source, artifact, policy and attempt they were run against.
  "All tests pass" changes nothing on its own.
- Say what you could not check. A missing environment, an unavailable tool or a skipped case is
  reported as a gap, never inferred as a pass and never quietly dropped from the denominator.
- A cost the provider did not report is unknown, not zero.
- A browser observation is not evidence about a native, mobile or model component. Observe each
  target on its own terms or report the scope as unverified.

### What the client is for

- Ask about money leaving an account, data leaving the project, and anything that cannot be
  undone. Decide the rest and write down what you decided.
- Never ask the client to write a Markdown file, choose a library, name agents, approve an
  implementation plan, or relay messages between workers.
- Preserve what the client said they do *not* want as carefully as what they asked for. A
  dropped exclusion is work they have to undo.
- Only the client records whether they are satisfied. A verified result is not acceptance, and
  acceptance is not a verification.

### Authority

Titles grant nothing. Deployment, spending, publication and any outbound message need an
approval that names the action, and one approval never grants another. Running without approval
prompts removes the prompt, not this rule.

### The skills

`cm-orchestration` `cm-intake` `cm-grounding` `cm-tdd` `cm-delivery` `cm-debug` `cm-verify`
`cm-review` `cm-handoff` `cm-ui-ux` — and the rest of the `cm-` set. Invoke the one that matches
the work. They carry the procedure; this section carries the rules.
