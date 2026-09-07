# Runbook: a deployment stuck in DEPLOYING

A deployment row in `DEPLOYING` with no `provider_operation_id` means the intent committed and
the destination call did not return. **Do not retry blindly** and do not mark it CANCELLED: the
destination may have accepted the operation.

## Step 1 — read the deployment intent

```sh step:read-intent
echo "deployment_id=${CM_DEPLOYMENT_ID:?set CM_DEPLOYMENT_ID}"
echo "idempotency_key=${CM_IDEMPOTENCY_KEY:?set CM_IDEMPOTENCY_KEY}"
```

## Step 2 — ask the destination what exists

```sh step:reconcile
echo "reconciling ${CM_IDEMPOTENCY_KEY} with the destination"
test -n "${CM_DESTINATION_STATE:?set CM_DESTINATION_STATE to the reconciled state}"
echo "destination_state=${CM_DESTINATION_STATE}"
```

## Step 3 — decide from what the destination said

```sh step:decide
case "${CM_DESTINATION_STATE}" in
  COMPLETE) echo "adopt the existing operation; do not promote again" ;;
  IN_PROGRESS) echo "wait and re-reconcile; do not promote again" ;;
  ABSENT) echo "safe to retry with the same idempotency key" ;;
  *) echo "unknown state; escalate" ; exit 1 ;;
esac
```

Never change `DEPLOYING` to `CANCELLED` because the local process stopped. The local process is
not the deployment.
