# Runbook: an upgrade failed during a migration

## Step 1 — confirm the snapshot exists

```sh step:confirm-snapshot
test -f "${CM_STATE_BACKUP:?set CM_STATE_BACKUP}" && echo "snapshot present: ${CM_STATE_BACKUP}"
```

## Step 2 — check whether rollback is actually possible

```sh step:assess-rollback
if [ "${CM_IRREVERSIBLE:-no}" = "yes" ]; then
  echo "irreversible migration applied: restore the snapshot and roll forward"
  echo "a binary rollback alone would leave the schema ahead of the code"
else
  echo "reversible: restoring the snapshot returns to the previous version"
fi
```

## Step 3 — restore and verify the row counts

```sh step:restore-and-verify
cp "${CM_STATE_BACKUP}" "${CM_STATE_PATH:?set CM_STATE_PATH}"
echo "restored ${CM_STATE_PATH}"
```

Verify the counts against what was recorded before the upgrade. A restore that loses rows is
a second incident, not a recovery.
