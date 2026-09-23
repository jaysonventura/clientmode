# Building a model-backed feature

Read this when designing or changing a feature that calls a model. It is engineering judgement,
not vendor specifics: model names, SDK calls, parameters, limits and prices come from the
provider's documentation for the version installed (`grounding`), never from memory. Every choice
below is settled by the measurement in `SKILL.md`, not by preference.

## Choose the simplest shape

1. One well-written call with good context.
2. A fixed chain of calls (extract, then check, then format), each step testable on its own.
3. Retrieval, when the answer depends on documents the model has not seen.
4. An agent loop (the model picks tools until done), only when the steps cannot be known in
   advance and a measurement shows the loop beats the chain.
5. Several agents, only when one context cannot hold the work, and each has a bounded job.

Fine-tuning changes style, format or a narrow skill; it is a poor way to add facts that change.
Try better context and retrieval first, and fine-tune only against an eval set that shows the gap.

Pick the smallest, cheapest model that passes the eval; route to a larger one only for the cases
that need it, and measure the router too.

## Context is the product

What the model sees decides what it does. Put in the instructions, the few examples that show the
hard cases, the retrieved sources and the user's input, clearly separated (headings or tags) and
nothing else. More context is not better: irrelevant or contradictory material pulls answers off
course, and facts buried in the middle of a long context are used less reliably.

- Keep stable content (instructions, examples, tool definitions) first and identical between calls
  so prompt caching can reuse it; put what changes per request last.
- Long conversations and agent runs need compaction: summarise or drop old turns on purpose, and
  test that the summary keeps what later steps need.
- Ask for structured output with a schema when code consumes the answer, and validate it. A valid
  shape still carries invented values; the eval checks content.
- Sampling settings are tuned by the eval, not by feel, and only where the model accepts them:
  on current Claude models a non-default `temperature` / `top_p`, an assistant prefill and a fixed
  thinking `budget_tokens` are rejected with a 400. Use structured outputs and the `effort`
  setting instead, and check the provider's docs for the model you call.

## Writing the prompt

Anthropic's prompting guidance (platform.claude.com, read 2026-09-23):

- Separate the parts - instructions, context, examples, documents, the user's input - and use one
  scheme consistently. XML tags parse unambiguously when a prompt mixes these; Markdown headings
  work too, and the docs state no preference beyond consistency.
- Give 3 to 5 examples of the hard cases, wrapped in `<example>` tags.
- Put long documents near the top, above the question; the question goes last.
- Keep templates in versioned files with named variables (`{{CONTRACT_TEXT}}`); insert untrusted
  values inside their own tags so they cannot read as instructions.
- Prefer a clear general instruction to a long list of steps; ask for reasoning in tags only when
  the model has no thinking mode to use.

## Retrieval

Measure retrieval before generation. If the right passage is not in what was retrieved, no prompt
change fixes the answer.

- Chunk along the document's own structure (sections, clauses, rows), keep the title and location
  with each chunk, and test chunk size rather than guessing it.
- Embedding search misses exact terms (codes, names, part numbers); hybrid search adds keyword
  matching for them. A reranker over the first results often helps more than a better embedding.
- Filter on metadata (tenant, date, document type) before ranking, never after, and enforce
  access control in the retrieval query itself so one user never retrieves another's documents.
- Cite sources in the answer so a person can check them, and let the feature say "not found".
- Record the embedding model and index version; changing either means re-indexing and re-running
  the eval.

## Tools and agents

- Each tool has a narrow purpose, validated arguments and a clear error the model can act on.
- Tools that change the world (send, pay, delete, publish) need a human confirmation or an
  allowlist, and a limit on how often they run.
- Cap the loop: a step budget, a time budget and a cost budget, with a defined stop state.
- Log every step so a failed run can be replayed.
- Check every tool call before it runs, not only the final answer: arguments, scope, and whether
  this step fits the user's request. A guardrail only at the end lets a hijacked step act first.
- A tool with side effects carries an idempotency key; retry it only with the same key, never in a
  generic retry loop.
- For MCP servers and clients, read `mcp.md`.

## Untrusted content is data

Anything the model reads that a user or a third party wrote (uploaded files, web pages, emails,
retrieved documents, tool results) can carry instructions. Prompt injection is not solved by a
sentence in the system prompt.

- Keep it apart from instructions, and never let it widen what the model may do.
- Give the model only the permissions the user already has; check authorisation in code, not in
  the prompt.
- Do not render model output as HTML or run it as code or SQL without the same validation any
  user input gets. Watch for data leaving through links or images the model writes.
- Add injection cases to the eval set: documents that say "ignore previous instructions", and
  tool results that ask for secrets.
- Keep secrets and other users' data out of the context entirely; what is in context can come out.

## Run it in production

- Keep a trace of every call: the prompt version, model, inputs (redacted), retrieved sources, tool calls,
  output, latency, tokens and cost, with an id that ties it to the user's request.
- Watch cost and latency per feature, set budgets and alerts, and set timeouts, retries with
  backoff, and a fallback (a smaller model, a cached answer or a plain error) for when the provider
  is slow or down.
- Stream long answers when a person is waiting.
- Version prompts like code. Any change to the prompt, model, retrieval or tool set re-runs the
  eval set as a regression check before release, because a provider's model update can change
  behaviour with no change on your side.
- Collect real failures (with consent, redacted) into the eval set so it grows with the product.
- Keep three sets: a golden set, an adversarial set (injection, abuse, edge cases) and a sample of
  real traffic. Compare each change with the last known good run, and gate merges on regressions
  in CI.
- Measure cost per resolved task, not per token. Cap spend in layers: a rate limit, then a daily
  budget, then a kill switch.
- Trace spans hold ids, timings, token counts and cost; prompt and output content only on purpose,
  redacted, because spans travel to more places than the database does.
- Release like any risky change: shadow traffic, then a staged rollout gated on quality, latency,
  cost and refusal rate, with rollback as a configuration switch.

## Responsible release

Map, Measure, Mitigate, Manage (the NIST AI RMF pattern used by Microsoft's AI-engineer path): map
the harms this feature can do, measure them on the eval sets, mitigate at each layer (model,
safety filters, system prompt and grounding, user experience), and manage in production. Before
release, have an incident plan, a rollback, a way to block a response or a user, and a way for users
to report a bad answer. A system prompt influences the model; it does not guarantee compliance.
Cloud guardrail services (for example, Azure's task-adherence check for agent tool calls, in
preview) are one layer, measured like the rest.
