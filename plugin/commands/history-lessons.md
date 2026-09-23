---
description: Read-only audit of a repository's git history - finds past corrections and proposes evidence-backed lessons for you to approve. Nothing is persisted without your yes.
argument-hint: <repository path>
---

Run the `history-lessons` skill on this repository: $ARGUMENTS

Stay read-only in that repository. Write only `mine.json` and `report.md` under
`~/.client-mode/lessons/<repo-name>/`. Return the report, then stop and wait for an approve or
reject on each candidate lesson.
