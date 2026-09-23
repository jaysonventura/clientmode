---
name: ai-eval
description: Use when building or changing a feature that calls a model - extraction, classification, retrieval (RAG), assistants, tool-using workflows. Measures model behaviour on a held-out set instead of trusting one good sample.
---

# Evaluating a model-backed feature

A feature that calls a model has two kinds of behaviour. The service around it (it saves the
record, handles the timeout, checks permissions) is deterministic and gets ordinary tests. What the
model returns varies. It is measured on examples, over repeated runs, against a threshold agreed
before you look at the results (`docs/AI_ENGINEER_STACK_SCOPE.md` §5, `docs/QUALIFICATION.md`).

## Before changing the prompt or model

1. **Define correct per example.** Write the expected output for 30–50 representative inputs:
   synthetic or properly redacted, never live personal data without permission. Include the hard
   cases: missing fields, messy formatting, inputs the feature should refuse.
2. **Hold some back.** Keep a held-out slice you never look at while tuning. Record the dataset
   version.
3. **Take a baseline** with the current prompt and model before changing anything.

## What to measure

- Accuracy per field or per answer, not one overall "looks good".
- Missing values and **invented values** separately. An invented value is worse than a blank.
- Failures: timeouts, refusals, malformed output.
- Latency and cost per call. Unmeasured is unknown, not zero.
- For retrieval: whether the right source was found (retrieval) apart from whether the answer used
  it correctly (generation). "The model is weak" is not a diagnosis.
- For tools: the right tool with the right arguments, and nothing it should not have done.

Run each case more than once when the output varies. Structured output that validates against the
schema is not correct output; a well-formed JSON can carry an invented employer.

## Design

Start with the simplest thing that works: a fixed sequence of steps before an autonomous agent,
adding autonomy only when a measurement shows it helps. Consequential decisions (hiring, money,
health, access) keep a human review step; the model proposes, a person confirms.

## Report

Baseline → the most common failures → the change → the measured difference on the held-out set →
the cases a human must still review. Never claim zero hallucination or guaranteed accuracy.
