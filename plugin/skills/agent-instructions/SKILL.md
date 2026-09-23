---
name: agent-instructions
description: Use when writing, trimming or reviewing a repository's agent instruction files - CLAUDE.md, AGENTS.md, .claude/rules/, GEMINI.md or Cursor rules. Keeps them short, true and loaded only where they apply.
---

# Agent instruction files

Every line of a CLAUDE.md or AGENTS.md loads into every session, whether the task needs it or
not, and competes with the task for attention. A long file is followed less, not more. Treat the
file as code: it makes claims, it goes stale, and it needs review.

Before changing one, read the host's own documentation for the installed version (`grounding`).
Hosts change how they load these files; the points below were checked against Claude Code's
memory documentation on 2026-09-23.

## What belongs at the root

Keep each file under 200 lines, and far less when you can. For each line, ask:
would removing this cause a mistake? If not, cut it. What survives is usually:

- one sentence on what the project is;
- the commands that are not the obvious default: package manager, build, test, typecheck, lint;
- conventions that differ from the tool's defaults, and the pitfalls that already caused mistakes,
  each with its reason;
- domain terms the code does not explain (organisation vs workspace vs team).

Leave out what the agent can read from the code: the directory layout, dependency lists,
architecture overviews, generic advice ("write clean code"). A stable, checked path is fine when
it saves a search ("handlers live in `src/api/handlers/`"); a file map is not, because it goes
stale and the agent then looks in the wrong place with confidence.

Write rules concrete enough to check ("run `pnpm test` before committing", not "test your
changes"). Two rules that contradict each other get one picked at random; find and resolve them.
Keep emphasis rare so it still means something.

## Load the rest only where it applies

- `.claude/rules/*.md` with `paths:` frontmatter loads a rule only when the agent reads a matching
  file. Use it for language, directory or test-runner rules.
- A workflow that some tasks need (release steps, a migration checklist) is a skill, not a rule.
- A nested CLAUDE.md or AGENTS.md in a package covers that package only; keep the root for what
  every task needs.
- Imports do not save context. An `@path` import loads at launch like the file itself; it helps
  organisation, not size.
- Anything that must happen every time, whatever the model decides, is a hook, not an instruction.

## One source for several tools

Claude Code reads AGENTS.md when there is no CLAUDE.md, and reads only CLAUDE.md when both exist.
Keep the shared text in AGENTS.md and make CLAUDE.md a single `@AGENTS.md` line plus anything
specific to Claude Code. Do not maintain two copies that drift apart.

## A team knowledge base the agent reads

When a project keeps its decisions and design notes in Markdown for people and agents alike:

- Rank documents by authority: approved decisions first, then core design notes, then working
  notes and meeting records. Superseded files move to an archive with a one-line
  "not authoritative" banner and leave the map, so an agent never cites them as current.
- Keep one short map file that lists each document with a one-line purpose and groups related
  ones. The agent reads the map and follows only the links a task needs; it does not read a list
  of files at every session start, which loads context no task asked for.
- Ask for claims with `file:line` citations, so a person can check them.
- Keep one source for each agent prompt or workflow; slash commands and skills point at it rather
  than copying it.
- Update the map in the same change that adds, supersedes or archives a document.

## Generated drafts and upkeep

`/init` or another generator gives a starting draft. Cut it down to what the agent could not work
out alone before it is committed; a generated file favours completeness over restraint.

Add a rule when the same mistake happens twice, not after every surprise, and keep the reason
with it. When you change the code a rule describes, change the rule in the same commit. Now and
then read the whole file start to finish: remove what no longer holds, merge duplicates, and check
each concrete claim (paths, commands, counts) against the repository.

Never put credentials, real customer identifiers, production client ids or seed passwords in an
instruction file; they are committed and read by every tool.

## Before you finish

Report the line count before and after, every claim you checked and how, and anything moved to a
rule, skill or hook.
