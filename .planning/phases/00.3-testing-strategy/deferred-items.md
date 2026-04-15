# Deferred Items — Phase 00.3 Testing Strategy

Items discovered during plan execution that are OUT OF SCOPE for the current plan.
Do not fix in 00.3; track here for a future quick task or phase.

## Pre-existing lint errors (discovered during Plan 01 `just check`)

- **Count:** 287 errors + 140 warnings as of `just lint` at commit `1965793`
- **Source:** Pre-existing codebase from Phases 00.1 and 00.2
- **Examples:**
  - `lib/compose-refs.ts:59` — `react-hooks/use-memo` violation (useCallback dep list)
  - `lib/format.ts:14` — unused `_err` binding
  - `types/data-table.ts:7,12` — unused type parameters `TData`/`TValue`
- **Impact on 00.3:** `just check` recipe chains `lint`, so the recipe FAILS on clean checkouts until these are fixed. This does NOT block Plan 01's deliverables (all 00.3-01 test infra, configs, and helpers are in place and individually pass).
- **Recommended fix window:** Quick task before Phase 1 begins — ESLint autofix plus manual cleanup of 287 errors. Alternatively, scope lint to only new files via CI path filters.
- **Not in scope for Plan 01** per GSD execution Rule: "Only auto-fix issues DIRECTLY caused by the current task's changes. Pre-existing warnings, linting errors, or failures in unrelated files are out of scope."

## Notes on `/api/__test__/reset` → `/api/test/reset` rename

Documented as Task 3 deviation in 00.3-01-SUMMARY.md. Not deferred; already fixed inline.
