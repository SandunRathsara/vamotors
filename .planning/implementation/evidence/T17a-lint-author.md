# T17a bounded lint cleanup — author evidence

2026-10-30. **Bounded author implementation complete: full lint PASS, 0 errors / 39 pre-existing warnings.** No requirement or gate acceptance. Independent review remains parent-owned.

- Base: `db2580dd7fa722489c591f3f9ed8ed0ea4d26a72`.
- Branch: `fix/t17a-bounded-lint`.
- Worktree: `/private/var/folders/gb/j8pkyq8j0rd50dzkps44xgh40000gn/T/opencode/t17a-bounded-lint`.
- Initial ref implementation/test commit: `ea6fb434adfced5556ddeb2689746a4d9465bb62`; final authorized correction/report commit is supplied in the author handoff.
- Exact changed paths: `lib/compose-refs.ts`, `lib/compose-refs.test.tsx`, `app/api/cash-flow/prototype.ts`, and this report.

## Fix and boundary

Read the orchestration/local-completion contract, both named files, full `components/ui/sortable.tsx` (the only hook callers, both with two refs), and the retired cash-flow prototype/page, route inventory and unavailable guard. The actual `prefer-const` error was **`app/api/cash-flow/prototype.ts:20`**, not `route.ts`. After explicit parent ownership expansion, changed only `let result` → `const result` in the prototype; no behavior changes. `app/api/cash-flow/route.ts` remains byte-identical to base and still re-exports the guarded unavailable handler for all seven methods; no prototype is made reachable and authentication/current-actor/origin/no-store behavior is untouched.

The hook now explicitly accepts the two refs its callers use and memoizes `composeRefs(ref1, ref2)` with an inline `useMemo` factory and literal dependency array. This removes two compiler errors and the adjacent unknown-dependencies warning without suppressions. Intentional API narrowing: the hook is two-argument rather than variadic; the underlying exported `composeRefs` remains variadic and its cleanup implementation is byte-unchanged. Equal refs keep callback identity; either changed ref causes React to detach the old composition and attach the new one. No mutable latest-ref workaround or per-render identity churn.

Current React documentation was resolved with `npx ctx7@latest library React ...`, then fetched with `npx ctx7@latest docs /reactjs/react.dev ...` (two calls). [Official callback-ref documentation](https://react.dev/reference/react-dom/components/common#ref-callback): React 19 invokes returned cleanup instead of calling that callback with null; callbacks without cleanup receive null; replacing a callback cleans the old one; Strict Mode runs an extra setup/cleanup cycle. Regression tests exercise these behaviors against installed React DOM, not a mocked hook.

## Executed checks

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile --offline` | PASS; no package/lockfile changes |
| `pnpm db:generate` | PASS; local generated Prisma client only, no database connection |
| Baseline `pnpm lint` | FAIL: 3 errors / 40 warnings, exactly reproduced |
| Final `pnpm lint` after authorized const correction | PASS: 0 errors / 39 pre-existing warnings (down from intermediate 1 error / 39 warnings) |
| `pnpm exec eslint lib/compose-refs.ts lib/compose-refs.test.tsx app/api/cash-flow/route.ts` | PASS, zero warnings |
| `pnpm typecheck` | PASS after correcting a new test mock's inferred zero-argument type; not repeated after the behavior-neutral const correction, as authorized |
| `pnpm exec vitest run lib/compose-refs.test.tsx tests/security/application-boundaries.test.ts` | PASS: 11 tests |
| `pnpm test:unit` | PASS: 12 files / 121 tests, including four new ref tests and the entry-point inventory; not repeated after the behavior-neutral const correction, as authorized |
| `pnpm exec vitest run tests/security/application-boundaries.test.ts` after const correction | PASS: 7 tests, including private retired-route method/import inventory |
| `pnpm exec prettier --check lib/compose-refs.test.tsx` | PASS |
| `git diff --check` | PASS |

Ref coverage: legacy callback/object/null/undefined refs attach and clear; mixed compositions execute each supplied cleanup and null only refs without cleanup; actual DOM rerenders do not detach unchanged refs; replacing either input clears old refs; unmount clears new refs; normal and Strict Mode lifecycles both pass. The existing route inventory test verifies every retired API method still maps to the guard. No real-DB/API/browser acceptance is inferred from these unit/source checks; none was needed for this pure hook/lint change. Unit tests emit the pre-existing pinned pg SSL-mode compatibility warning; no socket/database is opened by that synthetic library test.

Initial Prettier checking of both ref files also found the existing semicolon/trailing-comma style in `lib/compose-refs.ts`; checking its exact base blob through `prettier --check --stdin-filepath lib/compose-refs.ts` also exits 1. That existing file's style was preserved to avoid unrelated cleanup-logic formatting. No full-repository formatting pass is claimed.

## Remaining 39 warnings: triage, not waiver

| Count | Paths / rule | Follow-up |
| --- | --- | --- |
| 23 | `.planning/implementation/contracts/api-check.ts` (12), `party-detail-settings.proposal-check.ts` (8), `roundtrip-check.ts` (3): unused declarations | Contract-owner maintenance; preserve compile-time assertions/proof intent, no broad deletion or suppression. Outside ownership. |
| 9 | `app/api/lease-comparison/prototype.ts` (1), `app/api/lease-dispatch/prototype.ts` (1), `app/error.tsx` (1), `components/settings/settings-form.tsx` (1), `components/vehicles/vehicle-detail-tabs.tsx` (1), `lib/format.ts` (1), `types/data-table.ts` (3): unused declarations | Bounded owner cleanup; distinguish genuinely unused imports/locals from deliberate callback/type parameters. No behavior change established here. |
| 5 | `design/app.js`: unused declarations | Static design/reference cleanup; verify HTML/global entry points before removing functions. |
| 1 | `components/data-table/data-table-faceted-filter.tsx:43`: exhaustive dependencies | UX/table follow-up: newly allocated selection set invalidates callback memoization each render; verify filtering and selection stability when repairing. |
| 1 | `hooks/use-data-table.ts:268`: incompatible library | UX/table compiler-compatibility follow-up; compiler currently skips unsafe memoization of TanStack Table functions. Do not silence or force memoization; review downstream memoized consumers for stale UI. |

All remaining diagnostics predate this change. No shared ledger, matrix, contracts, packages, schema, grants, registry, other worktree, cloud, deployment, push, PR or merge was changed. Parent next action: independent review and integrated checks. T17/full v1/local G6 is **not complete**.
