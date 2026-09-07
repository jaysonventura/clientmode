# AT-032 — red evidence

Gate: `tests/tasks/T32.test.ts`, executor `tests/scenarios/T32.scenarios.ts`.
Command: `node --import tsx --test tests/tasks/T32.test.ts`.

## What was executed

A client reports that "the total is wrong when i order two rice". The case opens from that exact
request, and an attempt to open one from a request that never arrived is refused. The defect is
reproduced against a running shop fixture — `POST /api/orders` with `quantity: -1` returned 201
where 422 is required — and the fixed fixture returns 422, which is the evidence the resolution
rests on.

The documentation question in the same report becomes a document job. The published example
`GET /price?product=rice&qty=2` is executed against the running service and fails; the
documentation is corrected from what the implementation actually accepted (`quantity`), and the
corrected example is executed again and passes against service version 2.4.0.

The same problem is reported a second time. It joins the existing case; no second case row is
created and the first report's history is not overwritten.

Monitoring is not configured, so the coverage statement is "Nothing is being watched for you."
The controller is then stopped mid-case and restarted; the timeline survives intact.

## Mutations proving the assertions are load-bearing

| # | Mutation | Result | Observation that flipped |
|---|----------|--------|--------------------------|
| `P7` | a case may be opened without a client request (`service-cases.ts`) | green | the schema's foreign key from `service_cases` to `client_requests` still refused it |
| `P8` | a case resolves without verification evidence | **RED** | `resolution_requires_actual_evidence` |
| `P9` | coverage claims are no longer reviewed | **RED** | `no_fake_24x7_or_sla_claim` |
| `P10` | outbound actions need no authorization | **RED** | `outbound_actions_require_authorization` |
| `P11` | an agent may record client satisfaction | **RED** | `client_satisfaction_not_written_by_agent` |
| `P12` | a duplicate report replaces the history instead of joining it | **RED** | `duplicate_reports_preserve_history` |

## Defence in depth

`P7` is the interesting one. Removing the service-level check did not let a case be opened for a
request that does not exist, because `service_cases` carries a foreign key to `client_requests`
on `(project_id, request_id)`. The gate stayed green because the case still could not be opened —
which is the property being asserted — and the second control is the schema, not the code.

## Scope

The outbound email, SMS, webhook, publication and cloud write-back paths are all refused for want
of a named approval; the one that is allowed names both the capability and the recipient. No
message left this machine. The 24/7 and SLA language is refused against a coverage statement that
says, truthfully, that nothing is configured.
