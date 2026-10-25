# T00 current check evidence

Date: 2026-10-25. Tested application revision: preservation commit `8203d2a1dbd9b98c13d3188abf53286f393d98c7`. Subsequent T00 changes are documentation only. Independent review must bind its conclusions to the final handoff SHA; these are **author-run baseline checks**, not acceptance.

Environment: macOS, Node `v24.16.0`, pnpm `12.4.1`, installed Next.js `16.1.7`, React `19.2.5`. Used existing node_modules; offline installation failed. No live database, R2 object operations, or hosted checks were performed.

| Command | Exit/result | Meaning |
| --- | --- | --- |
| `pnpm install --frozen-lockfile --offline` | 1; `ERR_PNPM_META_FETCH_FAIL` / `ERR_PNPM_NO_OFFLINE_META` for `@babel/helper-annotate-as-pure` | Local package metadata absent; not a successful reproducible installation. No online retry or lockfile update in T00. |
| `pnpm typecheck` | 0 | Existing checkout compiles with installed dependencies. |
| `pnpm lint` | 1; 3 errors, 17 warnings | Existing errors listed below; no fix applied. |
| `pnpm test:unit` | 0; 2 files, 16 tests | Money helper and vehicle-column tests only; not business feature acceptance. |
| `pnpm exec prettier --check "**/*.{ts,tsx,md,json}"` | 1; 272 files with style issues | Existing whole-repo gate fails, including preserved planning material. No blanket formatting applied. |
| `CI=1 pnpm exec playwright test --project=api --project=e2e` | 1; setup failed, 4 dependent tests skipped | Missing `chromium_headless_shell-1217` executable. No setup bypass, browser download, or auth-state JSON tracked. Does not prove API or E2E success. |
| `pnpm build` | 0; optimized build and 53 static pages generated | Mock-backed local build; not a hosted authenticated environment. |
| Application/test diff against supplied main SHA | 0 / unchanged | T00 did not implement fixes. |

## Exact lint blockers

- `app/api/cash-flow/route.ts:20`: `prefer-const`.
- `lib/compose-refs.ts:59`: `react-hooks/use-memo` requires inline callback.
- `lib/compose-refs.ts:59`: `react-hooks/use-memo` requires literal dependency array.
- Warnings: unused variables/types, hook dependencies, and TanStack Table compiler incompatibility. Future owners must triage, not suppress without explanation.

## Workflow/model evidence

- Read the full orchestration contract, `CLAUDE.md`, `.planning/REQUIREMENTS.md`, and all 14 C4 decisions before mutation. Existing research is preserved as leads only.
- Live `opencode.models` resolved active `openai/gpt-6.1-sol` under OpenAI. Harness `orchestrator_capabilities` independently returned inherited provider instance `opencode`, inherited model `openai/gpt-6.1-sol`, full-access/default mode, no inherited option overrides. Provider lists supported variants low/medium/high/xhigh/max (default medium). No worker was spawned.
- GSD availability: tool discovery for `gsd` returned zero tools; searches for installed GSD commands under `~/.config/opencode` and `~/.claude` returned none. The `CLAUDE.md` entry points are not executable session tools here. Proceeded with the user's explicit T00 plan execution and durable planning artifacts under the dispatch's “if available” condition. No claimed GSD command execution or unrelated phase counters changed.
- Shared checkout is only used for this initial preservation and ledger. No isolated implementation branch exists yet; do not dispatch downstream work from dirty parent files.

## Not run / blockers

- Clean online install, real-DB API tests, authenticated browser acceptance, security/concurrency tests, deployment, scheduler, and restore proof remain future work. Missing browser setup blocks the default API/E2E run before scenarios execute.
- Baseline lint/style failures do not invalidate preservation, but block a release gate. Fixes must be assigned to their actual file owners, after T00 review.
- Cloud facts in the contract are historical handoff claims; no current account permissions, plan entitlement, secret existence, region, connectivity, or least privilege was verified by T00.
