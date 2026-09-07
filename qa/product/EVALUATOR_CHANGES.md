# Changes to handoff validation scripts — pending separate technical review

Per `AGENTS.md`, changes to evaluator code are recorded here rather than applied silently.
Neither change removes or relaxes an assertion; both restore the checks' original scope after
T01 installed the toolkit's own dependencies into the same repository root.

## 1. `scripts/check_handoff.py` — exclude installed dependency trees

`ROOT.rglob('*.md')` and `ROOT.rglob('*')` scanned third-party files once `node_modules/`
existed, failing on vendor READMEs (`node_modules/fast-uri/README.md` "TODO" marker,
`node_modules/ajv/README.md` relative links to files npm does not publish). The scans now skip
`node_modules`, `.venv`, `.git`, `dist`, `.mypy_cache`, `__pycache__`. Every assertion over
authored handoff content is unchanged.

## 2. `scripts/validate_all.py` — type-check through the project configuration

Was: `tsc --noEmit --strict --target ES2022 --lib ES2022,DOM contracts/interfaces.ts`.
With files on the command line `tsc` ignores `tsconfig.json` and falls back to Classic module
resolution, which cannot resolve `undici-types` from the auto-included `@types/node` package.
The failure was entirely inside `node_modules/@types/node/*.d.ts`; `contracts/interfaces.ts`
itself compiled cleanly.

Now: `npm run --silent typecheck` (`tsc --noEmit` over `tsconfig.json`). This is strictly
broader — it still covers `contracts/interfaces.ts` and adds every `packages/`, `apps/` and
`tests/` TypeScript file under the same `--strict` settings plus
`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride` and
`noFallthroughCasesInSwitch`.

## Checksums

`SHA256SUMS` is left at its as-received values so the handoff attestation stays verifiable.
`shasum -a 256 -c SHA256SUMS` therefore reports the two scripts above plus the regenerated
`qa/current/*` run logs as changed. No other file in the attestation differs.
