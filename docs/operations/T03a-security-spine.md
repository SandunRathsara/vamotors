# T03a initial transactional security spine

Author implementation candidate, **not T03/G1 acceptance**. Base `ddd69fb617b4790b3cd64cbf09cb10112d19c281`, isolated branch `t3/transactional-security-spine`. No recursive delegation, push, PR, merge, provisioning, credential consumption, database migration, seed, or hosted action by this worker. Integration alone updates ledger/matrix/decisions/HANDOFF/evidence.

## Implemented boundary

- Sole schema/dependency writer: `prisma/`, package/lock/workspace files; ES2020 compiler target for bigint. Existing Next/React/application Zod and frontend package versions retained. `bun.lock` untouched; pnpm remains authoritative.
- `lib/money.ts` adopts accepted M1 reference algorithms (A/C/B, bigint arithmetic, canonical strings, rational rounding, exact tiers). Legacy number wrappers remain for unmigrated UI, reject unsafe integers, and format without dividing a monetary value into floating point. `lib/state.ts` adopts S1/S2, not a second alternate state engine.
- Lazy server initialization: builds/prerender need no database/auth/bootstrap credentials. `lib/server/` is server-only at database/auth/command entry points. No owner/direct URL accepted by runtime configuration; exact origin, restricted runtime username, TLS, Environment identity/classification and write permission checked. No startup GUCs; transaction-local lock/statement timeouts only.
- Actual Better Auth Prisma adapter with `transaction:true`, credential hashing/accounts, sessions, cookie cache disabled, trusted origin, bounded public sign-in/sign-out transport. Public signup/reset/bootstrap and raw get-session token transport return404. Login success retains Set-Cookie but returns only `{ok:true}`. Session activation/grants reloaded separately, inside command transaction too.
- Four strict v1 commands: `createUser`, `updateUser`, `saveRole`, `archiveRole`; actual CASL positive-grant union; actual-subject/each-field checks; initial admin command surface additionally requires protected Administrator membership. Account hashes never appear in DTOs/audit/idempotency input storage. No public fixed passwords.
- Coherent `currentActor`, user/role detail/basic paginated lists, initial permission registry, and user/role audit queries. Same server query seam is usable by HTTP and RSC. List row scopes compiled before counts/page; arbitrary filter/sort inputs rejected rather than silently accepted. Compound/leaf projection is allowlisted; no raw entity spread into responses. Supported query DTO shapes follow accepted contracts; optional full list/search/sort/filter controls remain below.
- Serializable command owner; AdminGuard before current authority/revision checks, retained keyed input digest/receipt, replay authorization, business+receipt+field audit in caller transaction, max3 transient retries. Guard **updates a generation**, not merely `FOR UPDATE`: an older SERIALIZABLE snapshot must abort/retry rather than authorize on grants revoked by the prior guard holder. Sessions and account/role mutations use that guard. SQL last-admin/protected-role and append-only backstops included.
- Caller-tx safe notification insertion with recipient/event uniqueness, no free-form financial message; source version/complete-prefix primitives and tables. No domain notification routing claim until domain commands exist.
- Legacy `/api/test/reset` returns404 whenever persistent credentials are configured or APP_ENV is shared-dev/preview, regardless of old override flags.

## Exact pins and current documentation

| Package                                          | Pin                                           | Verification                                                                                                                                                                                                    |
| ------------------------------------------------ | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prisma`, `@prisma/client`, `@prisma/adapter-pg` | `6.19.0` each                                 | Current Prisma v6 docs confirm callback transactions/isolation/maxWait/timeout and PrismaPg pooled connection configuration. Generated client succeeds with `engineType="client"` and `vamotors` schema.        |
| `pg` / `@types/pg`                               | `8.16.3` / `8.15.6`                           | Installed adapter signature accepts pg config/Pool and `{schema}`; pg TCP chosen for real interactive transactions, not Neon HTTP's noninteractive path. Actual pooled backend behavior still UNTESTED.         |
| `better-auth`                                    | `1.6.23`                                      | Current tag docs and installed adapter/types. Published peers accept Next14/15/16, React18/19, Prisma5/6/7. Internal Zod4 is its own dependency; root Zod remains `3.25.76`.                                    |
| `@casl/ability`                                  | `6.8.0`                                       | Installed real createMongoAbility/subject APIs exercised by tests; current CASL docs confirm instance vs type/field semantics. No `cannot`, expressions, arbitrary operators or missing fields arrays accepted. |
| `server-only`, `tsx`                             | `0.0.1`, `4.20.6`                             | Server import boundary and private operational TypeScript runners.                                                                                                                                              |
| Framework/application validation                 | Next`16.1.7`, React/DOM`19.2.5`, Zod`3.25.76` | Preserved. No framework upgrade.                                                                                                                                                                                |

Fresh ctx7 resolutions: Prisma → `/websites/prisma_io`; Better Auth → `/better-auth/better-auth/v1.6.23`; CASL → `/stalniy/casl`. Queries covered selected driver/serializable callbacks, auth Prisma transactions/disableSignUp/schema generation/session cache/disabledPaths, CASL actual record/field positive rules. Primary references:

- https://www.prisma.io/docs/orm/v6/prisma-client/queries/transactions
- https://www.prisma.io/docs/orm/v6/overview/databases/supabase (adapter-pg pooled client syntax, not authorization to use Supabase)
- https://github.com/better-auth/better-auth/tree/v1.6.23/docs/content/docs
- https://github.com/stalniy/casl/blob/main/docs-src/src/content/pages/guide/restricting-fields/en.md

Offline **pinned** `auth@1.6.23 generate --config scripts/auth-schema.config.ts --output <private-temp>/t03-auth-generated.prisma --y` succeeded without any DB URL/client/secret. Inspected generated User/Session/Account/Verification in full before migrations: UUID IDs, all credential/token/expiry fields, email uniqueness, session/account user indexes, active/authzRevision additional fields. The maintained schema preserves those exact library scalar fields; deliberate additions: `vamotors` schema, business relations, `(providerId,accountId)` uniqueness. Actor User and Account FK deletion becomes RESTRICT rather than generated Cascade to retain business actors; sessions remain explicitly deletable. Offline generation emitted a missing-baseURL warning only (production config requires exact baseURL). `@better-auth/cli@1.6.23` does not exist; current executable package is **`auth@1.6.23`**, not an invented CLI pin.

## Schema capability / ordering handshake

Migrations:

1. `202610250001_security_spine`: offline Prisma-generated schema for auth, Environment/AdminGuard, roles/permissions, command/audit/notification, BusinessSequence/EntityReadVersion, Customer/Supplier/contact, Vehicle/PurchaseRecord/StatusEvent.
2. `202610250002_security_constraints`: explicit SQL deferred circular FKs/open-cycle pointer, identity normalization, bounds, partial uniqueness, fail-closed initial lifecycle, protected role/last-admin locking, append-only/source-sequence enforcement and actor FKs.

Capability is **INITIAL_SECURITY / INITIAL_PURCHASE_ONLY**, not full E6. No business purchase HTTP command yet. Database permits only PURCHASED→IN_STOCK; other eight enum states retained but blocked by `initial_cycle_capability` until their evidence tables ship. LEASE_SETTLEMENT and TRADE_IN blocked too. No manufactured completion, imported-disposal bypass, fake supplier/payment, partial historical graph or export-ready baseline. Physical identifiers preserve punctuation while removing ASCII whitespace and uppercasing; one open cycle and correct composite active pointer are deferred final-graph constraints.

Next sole-schema extensions must add real payment/basis/repair/sale/completion/disposal evidence BEFORE broadening that constraint/transition trigger. Add reciprocal deferred completion/reservation/cycle/trade-in FKs and current-vs-imported disposal discriminant/provenance as E2/E5 specify; add ImportBatch/Row/SourceClaim/many-to-many target provenance before import is grantable. No business-row upsert to repair ordering. ExportJob/parts and full allowlisted entity versions/initial backfill remain disabled; existing BusinessSequence is a complete-prefix guard, not an export implementation. Existing source versions/receipts are append-only; future source cash facts bind to receipt sequence. New registry subjects/system-admin grants require a deliberate migration upgrade under the guard, never runtime edits to protected grants.

## T02b exact access proposal — NOT executed grants

Infrastructure is sole actual role/ACL writer. Parent reported T02b1 blocked: shared branch PUBLIC CONNECT/TEMPORARY prevents safe same-branch isolation; `bd316be80b73e25837a423d9be5ddf0513c6856a` / `docs/operations/T02b1-disposable-access.md` supplied by parent, not altered here. Need isolated Neon branch/management authorization first. **No files or Environment ID assumed to exist.** Never fall back to `~/.config/vamotors/dev-neon.env` or shared/owner URLs.

Required role/schema ownership: `vamotors_migrator` owns ONLY isolated schema/tables/functions/migration history; `vamotors_runtime` neither owner/member nor superuser/CREATEROLE/BYPASSRLS; cannot SET ROLE migrator, CREATE/ALTER/DROP/TRUNCATE, create public/temp objects or connect to retained shared-dev database. Pool URL actual runtime username must be exactly `vamotors_runtime`; direct migration username exactly `vamotors_migrator`. Sole supported application schema is `vamotors`.

Explicit runtime grant proposal (no broad ALL/default/future-table grants):

| Table/function                                                     | Runtime scope                                                                                                                                                                      |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema `vamotors`                                                  | USAGE only                                                                                                                                                                         |
| `user`                                                             | SELECT, INSERT; UPDATE(`name`,`active`,`authzRevision`,`updatedAt`); no DELETE                                                                                                     |
| `session`                                                          | SELECT/INSERT/UPDATE/DELETE (real session lifecycle; guard trigger covers mutations)                                                                                               |
| `account`                                                          | SELECT/INSERT only for selected credential path; no UPDATE/DELETE currently needed                                                                                                 |
| `verification`                                                     | No grants initially; no enabled verification/reset flow. Any newly observed adapter requirement must be reviewed/tested, not blanket-granted.                                      |
| `Environment`                                                      | SELECT(`singleton`,`id`,`name`,`allowBusinessWrites`,`disposableTest`,`bootstrappedAt`) only; no bootstrap hash/expiry reads or writes                                             |
| `AdminGuard`                                                       | NO direct table grants; EXECUTE `vamotors.lock_admin_guard()` only (fixed-search-path definer)                                                                                     |
| `Role`                                                             | SELECT/INSERT; UPDATE(`name`,`active`,`revision`); no DELETE/systemKey UPDATE                                                                                                      |
| `Permission`                                                       | SELECT/INSERT only (immutable rules)                                                                                                                                               |
| `UserRole`,`RolePermission`                                        | SELECT/INSERT/DELETE only; guard/last-admin/protected permission triggers apply                                                                                                    |
| `CommandReceipt`,`AuditEntry`,`EntityReadVersion`,`StatusEvent`    | SELECT/INSERT only; no UPDATE/DELETE/TRUNCATE; immutable triggers also reject accidental extra grants                                                                              |
| `BusinessSequence`                                                 | SELECT; UPDATE(`value`) only                                                                                                                                                       |
| `Notification`                                                     | SELECT/INSERT; UPDATE(`readAt`,`revision`) only; recipient authorization remains caller responsibility                                                                             |
| `Customer`,`Supplier`,`SupplierContact`,`Vehicle`,`PurchaseRecord` | **No runtime grants yet**: no initial business command/query uses them. Constraint fixtures use migrator on disposable DB only. T04/T05 request exact grants when commands arrive. |
| `_prisma_migrations` / other schemas / future tables               | None                                                                                                                                                                               |

Do not preemptively loosen account/verification grants. Real sign-in/session/delete tests decide actual minimum. Never revoke auth lifecycle then claim login works. Runtime test includes denied DDL/environment/guard/audit/SET ROLE checks. Migration owner remains operationally privileged; not a tamper-proof-against-owner claim.

## Private delivery and authorized run sequence

Infrastructure/parent provides owner-only files outside Git (names below are **proposals**, not existing files):

- `~/.config/vamotors/t03-disposable-runtime.env`: pooled DATABASE_URL, APP_ENV=`disposable-test`, immutable ENVIRONMENT_ID, exact APP_ORIGIN/BETTER_AUTH_URL, independent random>=32-byte BETTER_AUTH_SECRET. **No DIRECT_URL/bootstrap secrets.**
- `~/.config/vamotors/t03-disposable-migration.env`: DIRECT_URL, APP_ENV, same ENVIRONMENT_ID, explicit `T03_DISPOSABLE_AUTHORIZATION=<Environment UUID>`, approved `T03_DISPOSABLE_HOST`, `T03_DISPOSABLE_DATABASE`. Host/DB names attest infrastructure's isolated target, not proof of isolation by themselves.
- Separate owner-only private bootstrap/test-account file delivered through approved private mechanism: random32-byte hex BOOTSTRAP_TOKEN; distinct private BOOTSTRAP_ADMIN_EMAIL/PASSWORD, BOOTSTRAP_SECOND_EMAIL/PASSWORD, BOOTSTRAP_STAFF_EMAIL/PASSWORD (passwords12..128, distinct; no public defaults). Files must be owned by current OS user and have no group/other access. None go into normal runtime/build/preview.

After explicit infrastructure/parent authorization ONLY, from candidate checkout (do not substitute file paths):

```sh
node --import tsx scripts/migrate-disposable.ts "$PRIVATE_MIGRATION_FILE"
node --conditions=react-server --import tsx scripts/initialize-test-environment.ts "$PRIVATE_MIGRATION_FILE" "$PRIVATE_ACCOUNT_FILE"
node --conditions=react-server --import tsx scripts/bootstrap-security.ts "$PRIVATE_MIGRATION_FILE" "$PRIVATE_ACCOUNT_FILE"
node --conditions=react-server --import tsx scripts/security-db-check.ts "$PRIVATE_RUNTIME_FILE" "$PRIVATE_MIGRATION_FILE" "$PRIVATE_ACCOUNT_FILE"
```

No inline connection URLs/passwords; no shell source/echo of secrets. Initialization stores hash+<=30min token expiry; bootstrap separate transaction locks guard, requires exact disposable Environment, no existing users/admins, unused unexpired matching token, hashes with selected Better Auth implementation, atomically creates deterministic IDs/two suitable distinct administrators+restricted multirole staff/credentials/roles/audit/receipt, consumes token and marks bootstrapped. Replays fail closed. This initial operator path deliberately **does not authorize shared-dev bootstrap**. A reviewed shared-dev operator extension is parent-T03 work; no public endpoint exists.

The DB runner has NO mock/fallback/reset/migration/seed. It requires all three approved files; runs real adapter+serializable/SET LOCAL checks, actual credential login/cookies, denial, persistent rule changes/current fingerprint/field checks, concurrent idempotency, constraint-injected audit rollback, required-notification FK rollback, two-admin race/next-request/replay revocation, direct SQL last-admin/DDL/audit/env/guard denials, normalized identity/open cycle/pointer/initial illegal-state negatives. It retains synthetic records on the disposable target; temporary failure constraint removed in finally. No real-DB result is claimed until this actually runs on authorized access.

## Local evidence and outstanding parent T03

Executed without credentials: offline auth schema generation/inspection; Prisma format/generate/offline migration diff; full TypeScript; full Vitest (24 tests, including8 new actual CASL/pure security/money/state tests); accepted contract runner19 checks including116029 rounding cases; production build without DB secrets. Fresh final command results are returned with head; earlier compilation failures during authoring were corrected, not hidden as acceptance.

Full-repo lint still has the **three pre-existing errors**: `app/api/cash-flow/route.ts` prefer-const and two `lib/compose-refs.ts` React compiler errors; 27 warnings. Owned-path lint is checked separately. Those unrelated files were not repaired. No browser/hosted tests run.

**DB evidence: BLOCKED, zero migrations/seeds/logins/SQL/race/grant checks executed.** T02b access is the single next external action. Local pure tests are not substitutes for these invariants.

All parent FNDN01–08/USER01–05/AUDT01–04 remain unaccepted pending independent integration review and real DB evidence. Remaining implementation includes: full accepted query search/filter/sort/registry filtering and administrative UI/login UI wiring/client private-cache invalidation; permission-only delegated administrators beyond protected initial surface; complete enabled-subject registry and financial/nested/audit projections across all lanes; protected business commands/revision resolvers, real source-owned payments/status/notification routing; full E6 constraints, policies/history/provenance/import/exports and schema capability upgrades; ordinary shared-dev guarded operator bootstrap; complete real DB and API/RSC/browser denial/revocation/concurrency/double-buyer proofs; actual selected pooled transport/minimum auth grants and operational host-budget verification.

Legacy mock-backed APIs/frontend remain in the repo and are **not certified as an authenticated app**. Do not publish this partial slice as G1/G2 or broaden schema grants to make mocks appear persistent. No existing frontend/user work was discarded. Parent should ledger T03a as review/DB-blocked, link this technical runbook and both migrations, preserve0 implemented requirement acceptance until independent verification, and request the isolated access handoff above.
