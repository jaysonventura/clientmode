# AT-028 — red evidence

Gate: `tests/tasks/T28.test.ts`, executor `tests/scenarios/T28.scenarios.ts`.
Command: `node --import tsx --test tests/tasks/T28.test.ts`.
Task: Spreadsheet computation and quantitative correctness.

## What was executed

The workbook's answers were known before the engine ran: 1,500 rows at 100 centavos plus row 1,501 at 250 is 150,250, and the hidden -5,000 adjustment makes 145,250. The file's cached values say 150,000 and 145,000, and both are reported as differing from the recalculation. XLOOKUP is reported unsupported rather than approximated, the external link stays disabled, the CSV canary is exported as literal text and reopens as literal text, and 00742 stays a string.

## Mutations proving the assertions are load-bearing

Each mutation removes one named production control, the gate is run, and the mutation is
reverted.

| # | Mutation | Result | Observation that flipped |
|---|----------|--------|--------------------------|
| `N13` | a cached value is used instead of recalculating (`packages/documents/src/calc.ts`) | **RED** | cached_values_not_called_recalculated |
| `N14` | an unsupported function returns zero (`packages/documents/src/calc.ts`) | **RED** | the scenario raised before the assertions |
| `N15` | CSV export stops escaping formula characters (`packages/documents/src/calc.ts`) | **RED** | csv_canary_not_executed |
| `N16b` | numeric readiness ignores both the missing engine and the calculation's own reasons (`several files`) | **RED** | missing_calculation_engine_blocks_numeric_ready |

## Mutations a second control caught

- `N16` — numeric readiness ignores a missing engine — the gate stayed green because another control still refused it. The paired mutation that removes both is in the table above.

## Scope

All fixtures are synthetic and generated from `fixtures/documents/corpus.ts`, where the expected
answers are declared before any reader runs. No client content, no licensed assets, no network
access, and no external document service.
