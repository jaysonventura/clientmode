---
name: database-change
description: Use when changing a database schema, writing a migration or backfill, or altering how existing records are stored - keeps existing data safe and the change reversible. Always risk-floor work (T2+ with a security review).
---

# Changing a database

Existing data is the client's, and a bad migration is the change hardest to undo. Migrations sit
on the risk floor: T2 or higher, a security review and the full close, however small the diff.

## Before writing the migration

1. **Ground it.** Read the ORM or migration tool's documentation for the installed version
   (`grounding`). Note the database engine and version.
2. **Measure the table.** Row counts and existing indexes decide whether an `ALTER` locks a busy
   table, and for how long. Run the counts against a development or staging copy, never production
   without approval.
3. **Name what happens to every existing row:** new columns get a default or a backfill, renamed
   columns keep their data, and anything dropped is either intended or kept.
4. **Name every other reader of the column** and every record already in flight. A backfill that
   changes who owns or approves a record strands the ones under way; clearing a column can cut off
   another feature. Enum values, uniqueness and collation come from the live schema, not a comment.

## Writing it

- Test first. A test that runs the migration up on representative data, checks the rows, runs it
  down, and checks again. Seed data is synthetic.
- Prefer additive steps: add, backfill, switch readers, then remove in a later release. A rename is
  add + copy + switch + drop.
- Backfills run in batches, can resume, and are safe to run twice.
- An invariant guard reads its inputs inside the transaction and must fail closed on an empty set:
  `if (rows.length && …)` passes exactly when the guard is needed.
- Unique constraints and foreign keys are validated against the existing data before they are
  added, not discovered when the migration fails.

## Before calling it done

- Run up, down and up again on a copy with realistic volume. Record the time taken.
- Audit the data afterwards: counts before and after, no duplicates, no orphaned rows, totals that
  must not change did not change.
- Say what you could not check, such as production volume or replication lag.
- Running it against production is an irreversible action: it needs an approval that names it.
