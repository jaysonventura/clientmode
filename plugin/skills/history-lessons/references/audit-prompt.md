# Audit brief

These are the terms of a history-lessons audit. Hand them to a reviewer as written.

## Goal

Find the recurring mistakes, past corrections and project-specific lessons that would improve
future AI-assisted work in this repository. Look for:

- implementations that were incorrect or incomplete
- repeat fixes that missed the root cause
- unnecessary refactoring and overengineering
- UI that departed from the approved design
- missing validation, error states, permissions and tests
- agent instructions that cause unnecessary work

Do not assume any of these exist. Report only what the evidence supports.

## Evidence rules

- Read the patch, not just the message. Compare the code before and after the change.
- A later edit does not prove an earlier mistake. A revert does not prove poor work. Tell apart
  requirement changes, intended tradeoffs and defect corrections.
- Do not credit a change to AI or to a person without reliable evidence.
- Do not state an intent or a root cause as fact when the evidence only supports a hypothesis.
  Label it a hypothesis.
- Do not infer tokens spent or time taken from git history.
- Count distinct incidents. A backport or a follow-up commit for the same incident is one incident.
- Nothing was run, so nothing is claimed to pass. Say that a rendered UI was not seen.

## Report

Write in the person's language. Keep technical terms, paths and identifiers in English.

**A. Scope and limits**
- The repository, branch and HEAD.
- The working tree's state.
- How many commits were sampled and which ones were read in depth.
- What was not checked.
- A sampled audit is never presented as exhaustive.

**B. The project in brief**
The architecture, the conventions that matter, and the existing instructions, tests, CI and hooks.

**C. Findings (at most 8)**

Each finding has:
- **Title**
- **Status:** current, fixed in history, or uncertain
- **Impact and confidence,** given separately
- **Evidence:** the sha, path, lines or symbol
- **Before and after**
- **Root cause,** or a labelled hypothesis
- **Recurrence:** how often it appears in this sample
- **Suggested prevention:** described only, not implemented

**D. Candidate lessons (at most 5)**
The table in `lesson-format.md`, with every status `proposed`.

**E. Next priorities**
The three most useful follow-up checks, and the questions still open.

**F. Read-only proof**
The before and after values of `git status --porcelain`, HEAD and `git stash list`, and the result
of `git cat-file -e` for every cited sha.

If the evidence is thin, say so. A short, honest report beats a complete-sounding one.
