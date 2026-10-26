# T03-local: persistent local security spine

Implementation-owner evidence, **not independent verification or T03/G1 acceptance**. Base: reviewed PR5 head `24698af621cc29375598c12fdb6e0c9c0ae70bf4` (source `ee1555a`), accepted contracts `ddd69fb617b4790b3cd64cbf09cb10112d19c281`. New user direction makes local delivery authoritative; cloud provisioning/deployment is not a prerequisite. No global plan, ledger, contracts, hosting configuration, or quarantined roles changed. No push/PR/cloud action.

## Reproduce

Prerequisites: Node 22.16+ (Node `24.16.0` tested), pnpm, PostgreSQL 18 binaries. Application/library pins and lockfile are unchanged. On this machine only libpq client tools were initially installed; `brew install postgresql@18` installed PostgreSQL `18.6` (`18.6_1` bottle). Homebrew also updated its required openssl/libunistring dependencies and initialized an unused default cluster; **no brew service was started**. This application does not use that default cluster or an existing database service.

```sh
pnpm install --frozen-lockfile
pnpm db:generate
pnpm local:setup
pnpm local:test
pnpm build
pnpm local:test:http
pnpm local:dev
```

`local:dev` runs Next on `http://127.0.0.1:8000` with **runtime-only** credentials. Stop Next with Ctrl-C. `pnpm local:stop` stops only this checkout's project cluster; `pnpm local:start` restarts it without removing data. `local:setup` is repeatable: deploy pending committed migrations, skip an already committed seed, reapply explicit grants. Neither build nor normal application startup migrates or seeds.

The default private directory is `~/.config/vamotors/local-<first-12-hex-of-SHA256(real-checkout-path)>`. For an independent isolated review or another checkout, explicitly select a **new, off-Git** directory for every command:

```sh
export VAMOTORS_LOCAL_DIR="$HOME/.config/vamotors/local-independent-review"
pnpm local:setup
pnpm local:test
pnpm build
pnpm local:test:http
pnpm local:stop
```

No reset/delete command is supplied. An existing unrelated directory or different checkout marker fails closed. Setup failures preserve private files/data; do not delete or overwrite them to retry. A partial first-time bootstrap whose 30-minute token expired requires an operator-reviewed recovery on that isolated cluster, not automatic token renewal. Run setup and DB tests serially per directory: the DB test briefly adds/removes its own audit-failure constraint. Tests retain synthetic rows and restore revoked grants/deactivated seed accounts in `finally`; they do not reset the database.

## Private handoff (paths only)

Author checkout's directory: `/Users/alpha/.config/vamotors/local-b4deb6359acc`.

| File/directory              | Purpose                                                                                                                                       |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `runtime.env`               | `APP_ENV=local`, Environment UUID, restricted runtime URL, exact loopback origin, independent auth secret; no migrator/admin/bootstrap inputs |
| `migration.env`             | Migrator URL, same Environment UUID, explicit `LOCAL_DATABASE_AUTHORIZATION` matching UUID                                                    |
| `admin.env`                 | Separate cluster-admin URL, local cluster administration only                                                                                 |
| `accounts.env`              | Private random bootstrap token, two distinct administrator accounts and restricted multirole staff account; credentials never printed         |
| `cluster.env`               | Checkout ownership marker, PostgreSQL binary directory and isolated port                                                                      |
| `postgres/`, `postgres.log` | Persistent cluster and private diagnostic log                                                                                                 |

Directory mode is `0700`; generated environment files are `0600`, owned by the current OS user. Operational readers enforce private-file ownership/modes. Human credential handoff is `accounts.env`, read privately on this computer, **not pasted into chat**. Seed IDs, role names/rules and synthetic display names are deterministic; emails, passwords, database passwords, Environment UUID and auth/bootstrap secrets are random per isolated installation. No public default password. The test-created extra accounts use random in-memory passwords and remain synthetic test artifacts.

An additional fresh-install reproduction was created at `/Users/alpha/.config/vamotors/local-t03-b4deb6359acc-repro`; its data is retained and its server is stopped. The default author cluster was restarted and remains available; the HTTP smoke starts/stops its own temporary Next process, not any existing server.

## Isolation and initialization order

`scripts/local-postgres.ts` uses installed native `initdb`/`pg_ctl`, not Docker, a system service or a cloud provider. `PG_BIN` may explicitly select another installation containing `postgres`; detected defaults include Homebrew PostgreSQL 18 and Linux `/usr/lib/postgresql/18/bin`. Setup selects an available TCP port and persists it; collision on a later restart fails rather than stopping another listener.

1. Create owner-only private state and independent admin/migrator/runtime credentials. Initialize a new SCRAM-authenticated cluster as the current OS user; password-file input is deleted afterward.
2. Listen on numeric `127.0.0.1` only; no Unix socket listener, no remote HBA entry, no trust authentication, no TLS for this explicitly local cluster. Bound connections to 32, buffers to 64MiB, work memory to 4MiB and WAL target to 128MiB. Each existing Prisma pool remains bounded to four clients. This is not a hard disk quota; retained test rows/logs require operator disk monitoring, never silent pruning.
3. Admin owns `vamotors_local`; migrator owns only `vamotors` schema/objects. Revoke PUBLIC database CONNECT/TEMP and public-schema privileges on the application database. Grant runtime/migrator CONNECT. No runtime membership in migrator/admin, superuser, CREATEDB, CREATEROLE, replication or BYPASSRLS.
4. Temporarily grant migrator database CREATE while `prisma migrate deploy` executes the committed `CREATE SCHEMA IF NOT EXISTS`; revoke in `finally`. The Prisma 6 migration-engine URL gets an internally added `schema=vamotors`, so `_prisma_migrations` is in the owned schema. This custom option never reaches pg or runtime URL validation.
5. Initialize Environment **after migrations**, using `name=local`, `disposableTest=false`, allowed writes, UUID and a hashed bootstrap token expiring within 30 minutes. Seed under AdminGuard before enabling runtime access: zero users, exact Environment, unused valid token, real Better Auth password hashes/credential rows, roles, audit and receipt atomically; token is consumed. Bootstrap replay fails closed.
6. Install `scripts/local-runtime-grants.sql`: explicit current tables/columns/functions only, no default future-table grants. Environment bootstrap columns and AdminGuard table are inaccessible; only fixed-search-path `lock_admin_guard()` is callable. Audit/receipts/versions/status/permissions are append-only. No business-table grants until real domain commands exist. No account UPDATE/DELETE or verification grant was needed for the tested credential/session lifecycle.

No every-system-database or large-object hardening is a prerequisite for this isolated local spine. No claim of tamper-proofness against the cluster admin, migration owner or current OS user is made. Private files are local plaintext, not production secret storage.

## Transport and transaction changes

- Existing hosted TLS and URL-query restrictions stay intact. Cleartext `sslmode=disable` is accepted **only** with `APP_ENV=local` and numeric database host `127.0.0.1`; local mode refuses remote DB hosts even with TLS. Host/role/password/port overrides, duplicate TLS keys and startup GUCs remain rejected. Migration local mode additionally requires the exact local database name and matching authorization/Environment UUID. Local origins are loopback-only; non-HTTPS exceptions explicitly require HTTP, not arbitrary URL schemes.
- Existing transaction retries, current-session/grant reload, auth-failure logging sanitization, idempotency, CASL, money and state code are reused. Shared command transactions now `SET CONSTRAINTS ALL IMMEDIATE` after the callback constructs its final graph, before COMMIT. A real minimal test with pinned Prisma 6.19.0 proved deferred-COMMIT failure retained a checked-out pg connection (`total=1,idle=0`) and prevented `$disconnect` completing within two seconds. Callback-time constraint failure follows the working rollback/release path; six consecutive real last-admin failures now pass against a four-client pool and cleanly disconnect. Future domain commands must use this shared transaction owner, not implicit Prisma writes for deferred graph validation. This does not certify every possible driver/COMMIT failure mode.
- Real-DB fixture fixes: cast `current_user` to PostgreSQL text for Prisma raw decoding; assign the Vehicle UUID explicitly before constructing its deferred circular graph. The pinned client otherwise supplied a null shared PK on implicit Vehicle creation. Future T05 graph creation must allocate IDs before linking; this slice does not claim a working purchase command.

## Author validation, 2026-10-26

Exact normal commands and results (no secret env values passed on command lines):

| Command                                                                                                                                                      | Result                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                                                                                                             | PASS; dependency pins/lockfile unchanged                                                                                                                                                          |
| `pnpm db:generate`                                                                                                                                           | PASS; Prisma client 6.19.0                                                                                                                                                                        |
| `pnpm local:setup` (fresh, then repeated)                                                                                                                    | PASS; both committed migrations, local Environment, deterministic-ID seed and grants                                                                                                              |
| `pnpm local:test`                                                                                                                                            | PASS, 10 real-DB groups; real engine/adapter/Better Auth/CASL, no socket mocks or SQLite                                                                                                          |
| `pnpm build`                                                                                                                                                 | PASS, production Next build without runtime credentials                                                                                                                                           |
| `pnpm local:test:http`                                                                                                                                       | PASS; actual production Next TCP HTTP server, administrator/staff login/session/logout, unauthenticated401, signup404, foreign-Origin403, no-store/minimized actor response and revoked-cookie401 |
| `pnpm local:stop` then `pnpm local:start` then `pnpm local:test`                                                                                             | PASS; retained seed accounts/data still usable after real server restart                                                                                                                          |
| `VAMOTORS_LOCAL_DIR="$HOME/.config/vamotors/local-t03-b4deb6359acc-repro" pnpm local:setup` / `pnpm local:test` / `pnpm local:stop` (same variable for each) | PASS; separate fresh cluster, then stopped with data retained                                                                                                                                     |
| `pnpm typecheck`                                                                                                                                             | PASS                                                                                                                                                                                              |
| `pnpm test:unit`                                                                                                                                             | PASS, 70 tests / 4 files; one new explicit-local configuration boundary test                                                                                                                      |
| `node .planning/implementation/contracts/check.mjs`                                                                                                          | PASS, 19 checks including 116029 rounding regressions; pure spec only                                                                                                                             |
| Owned-file ESLint / Prettier check; `git diff --check`                                                                                                       | PASS (commands below)                                                                                                                                                                             |
| `pnpm lint`                                                                                                                                                  | FAIL, unchanged 3 pre-existing errors and 27 warnings: cash-flow `prefer-const`, two compose-refs React compiler errors. Not repaired in this slice                                               |

DB groups assert: role/serializable/local timeout and Environment mismatch; three real seeded credential/cookie sessions, public signup/bootstrap/reset disabled, restricted staff HTTP denial; concurrent same-key replay/exactly-one audit and changed-input denial; runtime-authorized account creation, hash verification and no credential in response/audit; stored multirole/record/field projection and next-request revocation/fingerprint; real audit-constraint rollback of business+receipt; real required-notification FK rollback of business+audit+receipt; concurrent administrator deactivation preserving one, immediate account/replay denial, repeated direct-write backstop failure with rollback/release; DDL/schema/temp/role/environment/guard/audit/escalation denial and owner-side append-only trigger; actual logout deletes sessions and invalidates retained cookies/identities. The purchase records used for constraints/projection are **migrator-created test fixtures**, not runtime feature acceptance.

Additional executed one-off checks loaded private files without printing them: all five env files have current-user ownership and no group/other access; `node --conditions=react-server --import tsx scripts/bootstrap-security.ts <migration.env> <accounts.env>` returned exit1 on the already-used token. The first author install exposed PostgreSQL's database-CREATE check on `CREATE SCHEMA IF NOT EXISTS`; the initial migration failed at its first statement with42501. That known-empty attempt was marked rolled back with pinned `prisma migrate resolve --rolled-back 202610250001_security_spine`; the bounded temporary grant fixed setup. The separate fresh reproduction required **no** manual resolution. A fourth immediate sign-in in one test process correctly hit Better Auth429; credential creation now verifies the stored hash directly without weakening the real rate limiter. No failed intermediate run is counted as a pass.

```sh
pnpm exec eslint lib/server/config.ts lib/server/database-url.ts lib/server/transactions.ts scripts/private-environment.ts scripts/initialize-test-environment.ts scripts/bootstrap-security.ts scripts/migrate-disposable.ts scripts/security-db-check.ts scripts/local-postgres.ts scripts/local-http-check.ts tests/security/library-boundaries.test.ts
pnpm exec prettier --check lib/server/config.ts lib/server/database-url.ts lib/server/transactions.ts scripts/private-environment.ts scripts/initialize-test-environment.ts scripts/bootstrap-security.ts scripts/migrate-disposable.ts scripts/security-db-check.ts scripts/local-postgres.ts scripts/local-http-check.ts tests/security/library-boundaries.test.ts package.json docs/operations/T03-local-postgres.md
git diff --check
```

Current docs were fetched through ctx7: PostgreSQL18 cluster creation/SCRAM/schema ACLs `/websites/postgresql_18`; Prisma6 migration URL/schema/history `/websites/prisma_io`; effective pg `sslmode=disable`/URL override precedence `/brianc/node-postgres`; Better Auth password verification `/better-auth/better-auth/v1.6.23`, with installed crypto exports checked. The unit suite's existing pg TLS-alias future-version warning remains; installed versions are unchanged and hosted URLs should continue preferring `verify-full`.

## Reconciled contract deltas

1. R02: loopback-only local PostgreSQL without TLS/Neon is allowed only for numeric `127.0.0.1`; hosted TLS, URL safeguards and remote-host rejection remain. Private local role files and local Environment bootstrap are documented; runtime/migrator/admin separation and `LOCAL_DATABASE_AUTHORIZATION` remain operator-target constraints, not production authority.
2. A2/schema ordering: deferred final-graph checks run before leaving the shared transaction callback; allocate circular-graph UUIDs before linking. Current schema/migration content is unchanged.
3. Evidence/gates: independent bounded review is attributed in [T03 local spine review](../../.planning/implementation/evidence/T03-local-spine-review-attributed.md). It supersedes the unavailable-local-DB blocker only for the tested security spine, pending fresh verification of the combined SHA. It does not accept full T03/G1, login/admin UI, global RSC/legacy API boundaries or hosted behavior, and does not change requirement acceptance counts.

## Remaining T03 / next slice: T03b

No cloud access blocker remains for local spine review. Independent reviewer must reproduce on its own directory and bind results to the committed candidate before integration/acceptance.

The application is **not yet a complete authenticated local product**: existing login/admin UI and legacy mock-backed APIs/pages are not wired to this spine, and this task did not certify/protect those old mock surfaces. Next bounded T03 slice: wire real login/logout/currentActor and private cache invalidation, protect page/API access, replace user/role mock UI with the four existing commands and safe queries, and complete administrative query/filter/sort/permission-registry behavior and delegated admin policy. Add browser-runner UI acceptance without preview tools.

Schema capability remains `INITIAL_SECURITY / INITIAL_PURCHASE_ONLY`, not full E6: auth/RBAC/audit/notification/receipt primitives plus partial parties/vehicle/cycle tables. No runtime purchase commands/grants, source-owned payments, repair/sale/reservation/disposal/approval/rate/brokerage/reconciliation/import/export/full settings evidence exists yet. Future sole-schema-owner slices must add actual reciprocal evidence/constraints before broadening the current fail-closed lifecycle restriction. Full registry/field/audit projections, notifications and business concurrency proofs arrive with those domains. Local file storage/scheduler/recovery and whole-application feature delivery remain later slices; deployment is the user's later responsibility. This handoff claims neither independent verification nor whole-app/G1/G2 acceptance.
