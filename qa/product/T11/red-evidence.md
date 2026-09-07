# AT-011 red evidence — the Codex adapter assertions are load-bearing

## 1. An unreported cost recorded as zero

`packages/providers/src/normalize.ts` — `cost_usd: null` replaced with `cost_usd: 0` for the
Codex turn, which also promoted coverage from `partial` to `complete`.

```
  error: |-
    protocol_events_normalized

    false !== true
```

Reverted; the gate is green again. This is the failure mode the rule exists for: this host
reports tokens and no monetary cost, and a zero would spend nothing on paper while spending
real capacity.

The shared permission-escape refusal is proved separately in `qa/product/T10/red-evidence.md`;
`packages/providers/src/host-session.ts` is the same code path for both adapters.

## Defect this task found and fixed

The live turn helper used `execFile`, which leaves the child's stdin open. `codex exec` reads
stdin for additional instructions, so it waited for input that never came and was killed by the
deadline — producing `exit_code: null` with no output, which is indistinguishable from an
unavailable account. Live turns now spawn with stdin closed.

## What actually ran — live

Two live turns against codex-cli 0.153.4 on the existing authorized native account, in a
throwaway project outside this repository.

| Observation | Evidence |
|---|---|
| fresh session loaded shared instructions | a fresh `codex exec` in a disposable project carrying the generated `AGENTS.md` returned `CLIENT_MODE_INSTRUCTIONS_LOADED`; the file was byte-identical afterwards |
| inherited permissions tested | under `--sandbox read-only` the session was asked to create `permission-probe.txt`; it replied `CANNOT_WRITE — the filesystem is read-only`, and **the filesystem confirms no file was created**. The verdict comes from the filesystem check, not the transcript |
| usage normalised | `coverage: partial`, `cost_usd: null`, tokens including `cached_input_tokens` and `reasoning_output_tokens`, schema-valid |

Transport is recorded on every report: `exec_json`. Argv comes from `codex exec --help` on this
machine — `exec`, `--json`, `--sandbox read-only`, `--skip-git-repo-check`.

## Browser surface, stated truthfully

`browser_vision` appears on the capability report as `documented: false, configured: false,
observed_working: false`, with the limitation naming where browser evidence actually comes
from: the controller-owned Playwright probes in `packages/browser`. Both transports —
`exec_json` and `app_server` — record `built_in_browser_vision: false`. A terminal thread
cannot claim a browser it does not have.

## No unapproved fallback

| Request | Outcome |
|---|---|
| Codex host capability never observed | `CAPABILITY_NOT_OBSERVED` — not rerouted to Claude |
| task requiring `browser_vision` | `CAPABILITY_NOT_OBSERVED` |
| account inaccessible | `BLOCKED_ACCESS` — no automatic API or provider substitution |
| `--dangerously-bypass-approvals-and-sandbox` in adapter options | `PermissionEscapeError` |

## Scope limits

- This gate covers the `exec_json` terminal transport. The App Server transport is described
  but not exercised; its facts are recorded, not observed.
- Normalisation is written against recorded shapes from one installed version. An unrecognised
  event — `thread.forked` in this run — is counted, never interpreted.
