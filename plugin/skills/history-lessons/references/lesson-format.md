# Candidate lesson format

| Lesson | Evidence | Scope | Recurrence | Enforcement | Caveat | Status |
|---|---|---|---|---|---|---|
| Complex create/edit forms get a dedicated page | `repo@a1b2c3d` → `repo@d4e5f6a`, `src/forms/Order.tsx` | repository | 3 incidents | visual test + ui-ux checklist | short forms stay in modals | proposed |

- **Lesson.** One short rule that a future task can act on. No generic advice.
- **Evidence.** The commit where the problem was introduced and the commit that corrected it, with
  file paths. Use `repo@sha` so the lesson can still be traced from the vault.
- **Scope.** Where the lesson holds: `module`, `repository`, or `cross-repo`. It is only
  `cross-repo` after it has been seen in 2 or more audited repositories. Until then it is a
  candidate to check elsewhere.
- **Recurrence.** Distinct incidents in the sample, not commit count.
- **Enforcement.** Pick the strongest option that fits, in this order:
  1. regression test, hook, CI or static check
  2. schema constraint or reusable component
  3. focused skill
  4. documentation-only rule
- **Caveat.** Exceptions, tradeoffs and whatever is still uncertain.
- **Status.** One of:
  - `proposed` until the person answers.
  - `approved`: the person said yes, recorded with the date.
  - `rejected`: the person said no. Silence also counts as rejected.
