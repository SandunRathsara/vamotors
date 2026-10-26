# Local integration candidate — owner checks, 2026-10-26

Candidate branch **`t3/integrate-local-security-spine`**, final SHA is the commit containing this record (returned in handback). Parent must independently verify that exact final SHA before moving accepted integration. This record is integration-owner evidence, **not** independent combined acceptance.

## Inputs and preservation

- Historical accepted G0 / unchanged `integration/full-v1`: `ddd69fb617b4790b3cd64cbf09cb10112d19c281`.
- Shared PR5 source base: `24698af621cc29375598c12fdb6e0c9c0ae70bf4`.
- Accepted plan and preceding reconciliation lineage: `5ed7083fcede77f6218625b7930b717eb146597f`.
- Independently reviewed foundation: `d71def0217a17c66b7c5a2162ef06c440b5ea4da`.
- Local merge tree tested: `004585a799fd9ba6d9c6c88cd5caed993ac51216`; final changes after that tree are documentation only. Both input commits are ancestors. No integration conflicts or application edits.

The assigned checkout already had a pending plan merge when inspected (MERGE_HEAD=5ed7083); index was exactly the plan tree and worktree exactly index. Sole integration owner completed that merge (`ca7038c`) then locally merged d71 without conflict. No reset/discard or accepted-ref movement was performed by this worker. These task-authorized local candidate merges do not authorize PR merges, publication or deployment.

Byte comparison against `git show d71:<path>`: **all 394 non-document source/config/asset paths identical**, including app, components, hooks, lib, prisma, scripts, tests, package/lockfile/configuration. No tracked generated client/build output. Foundation files are unchanged except four runbook lines reconciling review/status (no command changes). All 15 plan-lineage delta paths relative to PR5 retained: ten byte-identical; only HANDOFF, ledger, evidence index, local-completion and files-runtime have explicit status/additive reconciliation. Orchestration, decisions, requirements matrix, contract README, historical evidence and hosted operational documents remain byte-identical to accepted plan. All 134 requirement IDs/owners/status rows unchanged, **134 U / 0 accepted**.

During checks, compatible concurrent documentation appeared in this same checkout: the runbook review/status reconciliation, local-completion security paragraph, HANDOFF/ledger status reconciliation and `T03-local-spine-review-attributed.md`. Integration owner inspected these against the supplied report, retained them without overwrite, and includes them as documentation provenance only; their unknown authorship is not another independent review. The fuller sanitized attribution in this candidate names the supplied reviewer explicitly.

Only contract additions: files-runtime local R02 binding to actually delivered private config/bootstrap/transport, and access-transactions final-graph callback validation/UUID ordering. Original hosted safeguards and plan local operational equivalents remain, no weaker runtime grants or feature waivers. Temporary verification DB directories are not accepted durable file roots. Historical reports were not rewritten.

## Fresh owner checks on combined code

| Command/check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile --offline` | PASS, no network install; lockfile/dependency pins unchanged |
| `pnpm db:generate` | PASS, installed Prisma6.19.0 client |
| `pnpm test:unit` | PASS, 70 tests / 4 files; existing pg TLS-alias warning remains |
| `node .planning/implementation/contracts/check.mjs` | PASS, 19 pure specification checks including 134 seams and 116029 rounding cases; not domain acceptance |
| `pnpm build` | PASS, production build / 53 generated static pages; existing unprotected page output is a T03b gap, not auth proof |
| `pnpm typecheck` | PASS after build |
| `pnpm local:setup`, `pnpm local:test` | PASS, fresh independent integration-only cluster; 10 real-DB groups |
| `pnpm local:test:http` | PASS against actual production Next server; login/currentActor/logout, anonymous/staff/origin/signup denial/no-store |
| `pnpm local:stop`, `pnpm local:start`, `pnpm local:setup`, `pnpm local:test`, `pnpm local:stop` | PASS, retained cluster/repeat initialization and all 10 DB groups after restart |
| Owned ESLint and Prettier commands exactly as foundation runbook | PASS |
| `pnpm lint` | FAIL, unchanged 3 errors / 27 warnings: `app/api/cash-flow/route.ts:20` prefer-const; two `react-hooks/use-memo` errors `lib/compose-refs.ts:59`. No repair authorized; final integrated/G6 debt remains |
| Source/plan blob checks, accepted-ref check, `git diff --check` | PASS |

Every local command used explicit `VAMOTORS_LOCAL_DIR` at an integration-owned new off-Git directory `integration-local-security-private` under the approved temporary parent. Own generated private configuration is consumed only by scripts; values not printed or copied. This is isolated synthetic verification, **not** a whole-app durable operations installation. PostgreSQL is stopped, data/config retained. HTTP child exited. No author/reviewer service or private state used. Reviewer-only 350-attack/eight-way HTTP fixture was **not** rerun by integration; [its exact d71 attribution](T03-local-independent-attributed.md) is separate.

## Acceptance / handback boundary

Bounded T03-local source+DB independently accepted per supplied parent authority and reviewer PASS at d71. Combined candidate still needs parent independent verification. G1/T03 NOT accepted: real login/admin UI, global auth/RSC/API/legacy mock surface boundary and remaining domain schema are incomplete. G2–G6 pending, 0/134 feature acceptance. Local storage/timer/backup/restore and full application journeys remain unproved. Hosted/provider/deployment safeguards **DEFERRED DEPLOYMENT / NOT PASSED**.

Next bounded continuation: [T03b login/admin UI and global protection](../T03b-next-slice.md), with inspected existing endpoints, exact ownership, delegated-admin decision boundary and acceptance tests. Dependency-ready for parent dispatch only after independent combined verification; no T04+ features unlocked. No delegation, cloud calls/secret reads, author services, pushes, PR mutations or accepted integration-ref update in this task.
