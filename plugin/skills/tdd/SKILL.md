---
name: tdd
description: Use when implementing any feature, bug fix or behaviour change, in any language - test first, watch it fail for the right reason, make it pass with the smallest change, then refactor.
---

# Test-driven development

Client Mode always works test first. The order is the point: a test written after the code
mostly proves that the code does what the code does.

## The loop

1. **Red.** Write one test for the next piece of behaviour, in the project's own runner. Run it.
   It must fail, and fail *for the reason you expect* — an assertion about the missing
   behaviour, not a syntax error, a bad import or a missing fixture. Keep the failing output.
2. **Green.** Write the smallest code that makes that test pass. Run it, then run the suite that
   covers the area you touched.
3. **Refactor.** Improve names and structure with everything green. Run again.
4. Repeat one behaviour at a time. Commit at green.

A bug fix starts the same way: the first test reproduces the bug. If you cannot make a test fail,
you have not reproduced it yet — go to `debug`.

## Use the project's own tooling

Find the runner the project already uses before writing anything: its manifest scripts,
Makefile targets, CI config. Common defaults when there is a harness to follow:

| Stack | Runner |
|---|---|
| TypeScript / JavaScript | the project's vitest, jest, mocha or `node --test` |
| Python | pytest, else unittest |
| Go / Rust | `go test ./...` / `cargo test` |
| Java / Kotlin | JUnit through the Gradle or Maven wrapper |
| Swift / iOS | `swift test` or XCTest through `xcodebuild test` |
| PHP / Ruby / C# | PHPUnit or Pest / RSpec or minitest / `dotnet test` |
| Dart / Flutter | `dart test` / `flutter test` |
| Shell | bats, or a plain assert script that exits non-zero |

No harness at all: add the smallest one the stack supports, and say that you added it. Never
convert a component to another language to make it easier to test.

## Pick the right level

- **Unit** for logic: branches, parsing, calculations, state transitions.
- **Integration** for boundaries you own: the database, HTTP handlers, the filesystem. Do not
  mock the boundary you are testing. SQL, enum values, collation and locking are tested on
  the same engine as production: sqlite or a fake connection accepts what MySQL rejects.
- **End-to-end** for user journeys: `web-qa` for browsers, `mobile-qa` for devices.

## Prove the test is load-bearing

A test that has never been seen failing measures nothing. When you add a test to existing code,
or change a check, break the code it guards — revert the fix, flip the condition — confirm the
test goes red, then restore it.

- Fixtures must tell right from wrong. Ids 9 and 10 sort the same wrong way as text, a quantity of
  1 hides a multiplier, and a missing field satisfies `!== 'other'`.
- A test that asserts what a stub received needs at least one test through the real callee: the
  stub cannot show that the callee honours the value.
- Keep the real timing and environment. An async boundary gets an async fake, the spec passes on
  its own, and a CI check is tried under the same shell options (`set -euo pipefail`) and
  deployed configuration as CI.

## When test-first does not apply

Say which exception applies, and still run whatever check exists:

- documentation-only or formatting-only changes;
- a configuration value with no logic behind it, or a generated file;
- a throwaway spike the person explicitly asked for (it does not ship);
- visual taste — observe the rendered result instead (`ui-ux`).

## Anti-patterns

- Writing the implementation first, then a test that mirrors it.
- Asserting that mocks were called the way the code happens to call them.
- Weakening, deleting or skipping a failing test (`.skip`, `xit`, `@Ignore`, `-k 'not …'`) to
  get to green.
- Accepting a snapshot update without reading the diff.

## Report

The red output, the green output, and the exact suite command you ran. Where the host has
`cdt-verify`, run the gate through it so the exit code is recorded.
