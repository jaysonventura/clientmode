# AT-020 red evidence — the release and CI assertions are load-bearing

| Mutation | Failing observation |
|---|---|
| `deploy.ts` — the attested artifact no longer compared against the approved one | `verified_artifact_promoted_unchanged` |
| `runbook.ts` — a failing step no longer blocks the runbook | `runbooks_executed` |

Both reverted; the gate is green again.

## Security defect this task found and fixed

`deploy` compared the attestation's artifact digest **against itself** — always equal — and
relied on the approval scope check for everything else. Since the approval's own artifact field
matched the scope, a tampered attestation naming a **different artifact** was promoted under an
approval that had never been given for it.

The fix compares the attested artifact and candidate against what the approval actually
authorized, before anything is promoted. The rebuilt-artifact case now returns:

```
ARTIFACT_MISMATCH
approved  sha256:aaaa…aaaa
attested  sha256:9999…9999
```

This was found by running the scenario, not by reading the code: the first attempt was refused
for the wrong reason (`ALREADY_CONSUMED`, because the single-use grant was already spent), and
giving the rebuild its own grant exposed the real gap.

## Candidate cannot replace protected policy

Three attacks from a sandboxed candidate process, all refused by the kernel:

| Attack | Result |
|---|---|
| overwrite the verifier database | `EPERM`, exit 1 |
| list the verification authority directory to find the signing key | `EPERM`, exit 1 |
| rewrite this repository's `.github/workflows/product-ci.yml` | `EPERM`, exit 1 |

The workflow file's digest is unchanged. The candidate also planted its own
`client-mode-policy.json` claiming there was nothing to check, and a `pass.json` claiming 999
passing tests. Both are still sitting in the workspace and neither was consulted: the
coordinator resolved `unit` from the protected store and ran it, observing 1 real test.

**The CI workflow holds no secrets.** Checked against the directives with comment lines
stripped, since the comments necessarily mention the words the rule forbids: no
`${{ secrets.* }}`, no `secrets:`, no `environment:`, and `permissions: contents: read`. Pull
request code therefore runs with a read-only token and no access to anything that could
approve a candidate. Protected acceptance is deliberately not in this file.

## Deployment reconciled after a timeout

The destination accepted the request and then the call timed out — the case where the caller
cannot tell acceptance from refusal:

1. `promote` threw; the row stayed `DEPLOYING` with `provider_operation_id: null`
2. reconciliation asked the destination: `COMPLETE`, `ADOPTED_EXISTING_OPERATION`
3. the retry returned the same `op_1` with `replayed: true`

**One** promote call for that deployment across the whole sequence. Nothing was marked
CANCELLED because a local call failed.

## Migration recovery rehearsed on synthetic data

250 synthetic rows, a migration that adds a column, backfills it, then fails on a missing
table. After restoring the snapshot: 250 rows, the columns back to `id, total_centavos, note`
with no `delivery_fee_centavos`, and row 42's payload intact. The runbook carries the guidance
that a binary rollback across a contract step leaves the schema ahead of the code.

## Runbooks executed

Three runbooks, nine steps, every step run with its real exit code recorded:

| Runbook | Steps | Status |
|---|---|---|
| `stuck-deployment.md` | 3 | EXECUTED |
| `failed-migration.md` | 3 | EXECUTED |
| `failed-smoke.md` | 3 | EXECUTED |

Run again with the required environment variables absent, the first runbook reports **BLOCKED**
at `read-intent` and does not run the remaining steps. A runbook that cannot run here says so;
it does not skip ahead and report success.

Around them: a failing smoke check left the deployment `FAILED` and not released, and the
rollback executed only under its own scoped grant, recorded as authorized by `release_owner`.
