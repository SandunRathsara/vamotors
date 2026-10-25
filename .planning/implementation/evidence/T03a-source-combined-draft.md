# T03a source/local PASS — combined draft, acceptance BLOCKED

Recorded 2026-10-26 by the sole integration/ledger implementation worker. No recursive delegation. **G0 accepted; G1–G6 pending; 0/134 implemented requirements accepted.** Neither source/local PASS nor this combined branch accepts T03a/parent T03 or releases downstream work. Independent combined-head review **and authorized real-DB evidence** remain required. **DRAFT ONLY; DO NOT MERGE even if CI passes.**

## Provenance and preservation

- Accepted base: `ddd69fb617b4790b3cd64cbf09cb10112d19c281`, accepted T01/G0 from PR #4. This task does not update `main` or `integration/full-v1` refs.
- Source: `fix/t03-auth-failure-sink` at **`ee1555abfd52d41d9bd4711a97246b1aaaa996d9`**, comprising `d314cdb` + `7ea6064` + `ae372a7` + sink fix. Carried without conflicts as `2e4b352`, `a215f2b`, `e6b9562`, `69926ba`.
- Pending ledger: `t3/record-review-ledger` through **`6b5e63497f6b00fef12b575c1b1384f0020a75e6`**. All five commits carried as `5bfa5e9`, `2e6dbce`, `87adfba`, `3f9c7a9`, `513e508`; all prior G0/access/rejection evidence retained unchanged. Earlier running/rejected statements are historical, not the current source verdict.
- Infrastructure: only [`docs/operations/T02b1-disposable-access.md`](../../../docs/operations/T02b1-disposable-access.md) carried **byte-for-byte from `bd316be80b73e25837a423d9be5ddf0513c6856a`**. No infrastructure script/identity JSON carry or execution. Its `disposable-test-identity.json` and isolation-preflight references describe the source artifact; those files are not present on this combined branch. Do not execute the historical reproduction block as part of this task.
- Combined branch: `t3/combine-t03-auth-ledger`; checkout `/Users/alpha/.t3/worktrees/vamotors/t3-97d1fae3`. DRAFT PR target `integration/full-v1`; exact PR/head supplied in handback. Integration-authored changes are documentation only. All application/tests/scripts/schema/migrations/package/lock/workspace/tsconfig bytes match the exact source; matrix, contracts, decisions, user-preserved files and Netlify block unchanged.
- GSD command unavailable as documented by D24 and preceding workers; explicit bounded dispatch applies. No simulated GSD execution, package-manager invocation, install/download, cloud/config/Vercel mutation, private file access, SQL, migration, seed, bootstrap, credential generation, merge, force push, watcher or polling.

## Independent final source review (attributed, not a combined acceptance)

Orchestrator supplied reviewer **`e965e6bd-74ff-4a02-8b3c-7b3a0a637a77`** source/local **PASS** at exact `ee1555a`:

- External **13/13**, full unit **69/69** including **45 boundary** checks; typecheck, changed lint/format and diff PASS.
- Throwing log sink preserves prepared503 Response **identity/body/headers**, and actual public POST still returns the prepared sanitized response. Server session remains safe500; swallowed sign-out remains200 with cookie clearing. Secret redaction, per-call deduplication/concurrent server-generated UUIDs and healthy flows remain intact.
- Previous red reproduction **2 failed / 1 passed** is historical. Shared emitter now contains sink exceptions with no raw fallback/retry; prior SQLSTATE retry, URL authority and own-property state fixes remain intact. Pins/migrations unchanged.
- Prior build69 candidate-author PASS and previous-review build PASS are attributed history. **Final source reviewer did not repeat build or contracts.** Fresh combined results below are this integration worker's execution, not an independent combined review.
- **No real-DB proof**: synthetic wire responses exercise installed pg/PrismaPg/generated client/Better Auth, not real database rollback, grants, isolation, transport, identity or race outcomes. Earlier rejection reports remain unchanged in this evidence directory.

## Fresh combined local execution

Dependencies were cloned locally with `cp -cR ../t3-5c40fd8d/node_modules ./node_modules`, avoiding the earlier pnpm auto-install/lifecycle exception and Turbopack's out-of-root symlink problem. No dependency pin/lock changes. No environment file other than tracked `.env.local.example` is present in this checkout. All local commands ran with `env -i`, retaining only PATH/HOME/TMPDIR; build/test also set `NEXT_TELEMETRY_DISABLED=1`. No inherited DB/auth/bootstrap/cloud credentials enter the build; no secret file was read. No generation/migration/seed/DB runner was executed.

| Direct local command | Result |
| --- | --- |
| `./node_modules/.bin/vitest run` | **PASS 69/69**, 4 files; 45 actual-library boundary, 8 security primitives, 11 money, 5 vehicle columns. |
| `./node_modules/.bin/tsc --noEmit` | **PASS**. |
| `./node_modules/.bin/next build` | **PASS**, compiled/typechecked/prerendered53 pages without service credentials. This bypasses no deployment interlock: it is an authorized local build, not Netlify publication. |
| `node .planning/implementation/contracts/check.mjs` | **PASS 19/19**, including116029 rounding regressions; pure specification, not persistent acceptance. |
| Direct `tsc --noEmit --strict --skipLibCheck --target ES2020 --module ESNext --moduleResolution bundler` on contract `api.ts`, `api-check.ts`, `roundtrip-check.ts` | **PASS**; separate strict CommonJS emit to approved private temp and `node roundtrip-check.js` also **PASS 5/5** typed round trips. |
| `./node_modules/.bin/eslint <30 changed source TS paths>` | **PASS**, zero diagnostics. Path set is `git diff --name-only ddd69fb ee1555a` filtered to `.ts`/`.tsx`. |
| `./node_modules/.bin/prettier --check <same30 paths>` | **PASS**. No repository-wide format acceptance claimed. |
| `./node_modules/.bin/eslint .` | **FAIL**, known **3 errors / 27 warnings**: cash-flow `prefer-const`, two compose-refs compiler errors; unrelated files unchanged. |

The synthetic URL-config test emits the known pg future-SSL-semantics warning. Current pinned effective config is tested; operational proposal prefers `sslmode=verify-full`. No dependency upgrade or transport certification is inferred.

Preservation checks **PASS**: all **40 source-changed files** byte-identical (including both source runbooks); exact infrastructure-doc bytes; every prior evidence report byte-identical to pending ledger; contracts/matrix/decisions/Netlify/infrastructure implementation unchanged from accepted base. Matrix has **134 rows**, unchanged zero accepted; **57 local Markdown link paths** exist (fragments not checked). `git diff --check` **PASS**. No external reviewer fixture was edited or represented as freshly rerun here. No API/E2E/browser/hosted tests run; legacy unauthenticated mock UI/API remains uncertified and must not be published as G1/G2.

## Exact remaining access/isolation handshake — not executed

**Owner: infrastructure / user access.** Both the worker's private project-scoped management-key card and orchestrator `request_secret` (`delivery: file`, clientRequestId `vamotors-neon-isolated-branch-management-02`) **timed out; no key received**. No new request was made here. Supply key via private card, never chat; then explicitly authorize a separate Neon branch within inventoried/verified approved free capacity. No paid/provider/project fallback.

Owner CREATEDB/CREATEROLE is not sufficient: same-branch roles inherit retained shared-dev **PUBLIC CONNECT/TEMPORARY**. NOINHERIT/per-role REVOKE/separate same-branch DB/Environment flags do not subtract PUBLIC rights. Shared ACL mutation is prohibited. **No isolated resources, schemas, roles, credentials or EnvironmentID exist/delivered per the blocked infrastructure report**; direct/pooled read-only verified-TLS success is connectivity only, not least privilege. No owner/shared-dev credentials may be used as fallback.

Before execution, infrastructure and foundation must reconcile two unfulfilled proposals (neither is delivered access):

- Infrastructure proposed `~/.config/vamotors/disposable-test-runtime.env` and `disposable-test-migration.env`, SQL-only **suffixed** roles. Foundation runbook proposes `t03-disposable-runtime.env` / `t03-disposable-migration.env` and currently **requires exact** `vamotors_runtime` / `vamotors_migrator` usernames. Coordinate approved mapping/file paths through orchestrator; do not invent suffixed identities or change source code here. Operational runners take explicit approved file arguments.
- Actual isolated branch/project/host/database, immutable Environment UUID and schema `vamotors` must be agreed; runtime pooled URL only, exact APP_ENV=`disposable-test`, APP_ORIGIN/BETTER_AUTH_URL and independent >=32-byte auth secret. Direct migration file must carry matching identity and explicit disposable authorization/host/database. No direct/bootstrap authority in runtime/build/preview.
- Separate owner-only private bootstrap/account file: random token, <=30min expiry, distinct private admin/second-admin/staff credentials; never public defaults. No credentials generated prematurely.
- Neither runtime/migrator may have superuser/CREATEROLE/CREATEDB/BYPASSRLS/replication; runtime cannot inherit/SET ROLE migrator, create/alter/drop/truncate, write Environment/AdminGuard directly, or connect to retained shared-dev direct/pooled endpoints. Migrator owns only isolated schema/history. Audit PUBLIC/default function EXECUTE and grants on disposable resources only; no shared ACL changes or blanket ALL/future-table grants.
- Exact initial runtime grants are in [foundation runbook](../../../docs/operations/T03a-security-spine.md#t02b-exact-access-proposal--not-executed-grants): allowlisted user columns, session lifecycle CRUD, account SELECT/INSERT, no verification grants initially, Environment safe-column SELECT, `lock_admin_guard()` EXECUTE only, immutable history SELECT/INSERT, narrow Role/Permission/link/sequence/notification grants, no initial business-table or migration-history grants. Real auth lifecycle must establish sufficiency; do not loosen preemptively.

## Required real-DB evidence and blocked handoff

Only after explicit isolation authorization, approved private delivery and grant handshake, foundation/infrastructure execute the committed runbook serially: both migrations on a clean isolated DB, initialize exact Environment, guarded one-use bootstrap/two suitable admins/restricted multirole staff, then `scripts/security-db-check.ts` with all three approved private files. **None ran here.** Required proof includes:

1. Actual pinned pg/PrismaPg pooled interactive SERIALIZABLE transactions, per-transaction SET LOCAL timeouts, bounded retry/lock mapping and host-budget behavior; startup statement_timeout remains unsupported.
2. Actual credential hashing/sign-in/session cookies/sign-out and minimal grants; public signup/reset/bootstrap/raw token paths unavailable; exact Environment mismatch denies writes.
3. Current multirole/record/field authority, safe projections and immediate next-request deactivation/revocation; replay authorization and exactly-once concurrent idempotency.
4. Forced essential audit/notification failure rolls back business+receipt+audit/notifications; final-admin concurrent changes and direct SQL protections hold.
5. Runtime audit/status/receipt immutability, DDL/temp/public/Environment/AdminGuard/SET ROLE denial, original shared-dev direct+pooled authentication denial and role/default-privilege audit.
6. Normalized physical identity, unique open cycle/active pointer and bounded initial lifecycle/constraint negatives; retain synthetic evidence, never reset shared dev.

Fresh independent combined-head review must also verify code blob equality, all prior fixes, retained rejection/acceptance history, ledger/matrix/defaults and the no-publication boundary. Broader parent-T03 residuals remain in the source runbook: administrative/login UI, cache invalidation, full query controls/registry/projections, full E6/domain constraints/workflows and ordinary shared-dev guarded bootstrap are not accepted by this initial slice. Hosted auth/API/RSC/browser/security and persistence/recovery remain unproven.

**Netlify `netlify.toml` and fail-closed build script remain unchanged; no service credentials in build/preview. No merge, main/integration ref update, cloud configuration or Vercel change. Return draft PR/head and local evidence; orchestrator must obtain independent combined review and authorized real-DB gate before any acceptance.**
