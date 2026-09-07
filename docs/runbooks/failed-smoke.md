# Runbook: smoke checks failed after a deployment

A failed smoke check leaves the deployment `FAILED`. It is not RELEASED, and it does not become
RELEASED by re-running the check until it passes.

## Step 1 — read what actually failed

```sh step:read-failure
echo "failing probes: ${CM_FAILED_PROBES:?set CM_FAILED_PROBES}"
```

## Step 2 — decide between rollback and roll-forward

```sh step:decide-recovery
if [ "${CM_ROLLBACK_APPROVED:-no}" = "yes" ]; then
  echo "execute the rollback under its own scoped approval"
else
  echo "rollback needs its own approval; until then the deployment stays FAILED"
fi
```

## Step 3 — record the outcome

```sh step:record
echo "recorded recovery decision for ${CM_DEPLOYMENT_ID:?set CM_DEPLOYMENT_ID}"
```
