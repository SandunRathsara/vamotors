# T02b1 isolated verification — provisioned, quarantined at provider ACL boundary

2026-10-26. Infrastructure author evidence, **not independent acceptance**.
Resumes inventory/grant contract commit
`18aa0e01662e0f5aa4714a47464013f9a3dbbb32`; inspected reviewed PR5 head
`24698af621cc29375598c12fdb6e0c9c0ae70bf4`, its T03a runbook and actual
`config.ts`, `database-url.ts`, `private-environment.ts` validators.
Read `.planning/FULL-IMPLEMENTATION-ORCHESTRATION.md` and `CLAUDE.md`.
Parent explicitly authorized branch-local exact role names; no suffix-validator
change was needed or made. All work performed by this worker, without delegation.

## Outcome and actual blocker

Created the authorized schema-only isolated branch, dedicated empty database,
`vamotors` schema and exact SQL-created runtime/migrator roles with independently
generated 36-byte random passwords. Target-database least privilege and original
branch authentication isolation passed the bounded checks below.

**Not ready for foundation migration or credential delivery.** Actual runtime
connections to provider-owned `postgres` and `template1` succeeded. Runtime could
also create a temporary table in `postgres` (transaction rolled back). Those
databases are owned by `cloud_admin`; PUBLIC retains CONNECT, and `postgres`
retains TEMPORARY. A new-branch-only transaction attempting
`REVOKE CONNECT,TEMPORARY ON DATABASE postgres,template1 FROM PUBLIC` returned
`no privileges could be revoked`; catalog ACLs remained unchanged. It was rolled
back. The management API database inventory omits these system databases; SQL
catalog inventory exposed them. Names/API application-database lists alone are
not isolation proof.

This fails the source handoff's denial requirement for **every other database**
and prevents an unqualified runtime-cannot-DDL claim. No attempt was made to
assume `cloud_admin`, alter provider internals, delete databases, upgrade a plan,
or silently exempt system databases. Parent/provider must resolve the provider
ACL boundary, or parent must explicitly review a narrower system-database
exception and its TEMP risk before proceeding. Naming is resolved, not a blocker.

**Both new roles were changed to NOLOGIN after testing.** SQL catalog confirms
that state; fresh direct AND pooled connections were denied for both roles.
No normal runtime/migration/account delivery files were created. Do not run any
T03 migration, initialization, bootstrap or acceptance runner on this target yet.

## Resource identity and free-only configuration

| Resource | Actual ID/value |
| --- | --- |
| Organization / subscription | `org-fancy-mode-53675625`, `free` / `free_v3` |
| Project / actual name / region | `crimson-cherry-69611458`, VA Motors, `aws-us-east-2` |
| Original branch, unchanged | `br-autumn-rain-b56rxlj9` |
| Original endpoint, unchanged | `ep-mute-lab-b5d4mno7` |
| New verification branch | `br-sweet-tooth-b5p418na` |
| New branch name | `t02b1-verification-d5272bd3` |
| New branch created_at | `2026-10-25T23:59:08Z` |
| New endpoint | `ep-rapid-darkness-b5t8cypf` |
| Direct host | `ep-rapid-darkness-b5t8cypf.c-7.us-east-2.aws.neon.tech` |
| Pool host | `ep-rapid-darkness-b5t8cypf-pooler.c-7.us-east-2.aws.neon.tech` |
| Dedicated database / API database ID | `t03_disposable_1e760e0e` / `2384869` |
| Copied database IDs | `neondb`: `2384693`; `vamotors`: `2384694` |
| Proposed immutable Environment UUID | `082e708d-06a2-460a-bd6e-de03c1ce8d21` |
| Future APP_ENV / origin | `disposable-test` / `http://localhost:3000` |

Immediately before creation: one of ten branch slots used, Free subscription
reconfirmed. Current docs permit three Free root branches; only one existed.
POST create requested `init_source=schema-only` with the explicit original branch
ID, endpoint min=max **0.25 CU**, `suspend_timeout_seconds=0` (Free default:
five-minute automatic suspension). API returned a distinct ready root branch,
`parent_id=null`, normalized `init_source=parent-schema`. Endpoint list scoped to
that new branch independently confirmed endpoint ID, host and branch ID before
ANY SQL mutation. Minimum/max compute and suspension settings were read back.
No paid options, replicas, snapshots, protection or billing/default changes.
Two of ten branches now exist; the disposable branch is retained for resumption,
not auto-deleted. Do not keep it alive with background health checks.

Available project usage fields on the final scoped read:
`compute_time_seconds=813`, `active_time_seconds=3220`,
`data_transfer_bytes=17129`, `written_data_bytes=0`; consumption period
`2026-10-25T14:50:04Z`–`2026-11-01T00:00:00Z`; API size cap
`1073741824` bytes. These lagging informational fields are **not billing-grade
remaining CU-hours**. Exact remaining CU-hours remain unverified; no arithmetic
claim of remaining allowance is made. Earlier handoff's consumption-history403
is documented as a Free-plan API restriction, not new access needed. Free-plan
exhaustion must stop work, never trigger a paid fallback.

## Role/catalog isolation and executed changes

Current primary docs explicitly say roles belong to a branch and parent roles
are duplicated; resets are branch-scoped. Before mutation, original API roles
and both original SQL catalogs contained only the existing application owner,
not either exact new role. New-branch API inventory independently showed only
cloned `neondb_owner`, with the NEW branch ID on role/database records.

Only after endpoint binding, the **new branch's** cloned `neondb_owner` password
was reset using its branch-specific API path. This avoids using the original
shared password to administer the new branch. Original password was not reset.
Original owner credential still passed final read-only connections. API-created
privileged application roles were avoided: both exact roles were created by SQL.

Original `neondb` and `vamotors` each had zero user tables; their schema-only
copies also each had zero user tables. No copied business rows were read or used
for acceptance. Dedicated database has zero `vamotors` tables. This is empty
disposable scaffolding, **not synthetic workflow/test acceptance**.

Changes, all on the bound new endpoint:

- Dedicated database owned by `neondb_owner`, NOT either delivered role.
- Revoke PUBLIC CONNECT/TEMPORARY on copied `neondb` and `vamotors`; revoke
  PUBLIC schema privileges in both copied application databases.
- Dedicated database: revoke ALL from PUBLIC; CONNECT only to exact runtime and
  migrator. No TEMPORARY/CREATE or database ownership for either role.
- Dedicated database `public`: revoke PUBLIC privileges; no runtime grants.
- `vamotors` schema owned by migrator; runtime USAGE only, no grant option.
- Migrator default function EXECUTE revoked from PUBLIC. No blanket/default
  table grants; no future table access or default role settings.
- Temporary migrator membership used by the branch owner solely to create its
  schema/default ACL, then revoked in the same transaction. Neither exact role
  is a member of any other role; no runtime-to-migrator/owner membership.
- Both roles: NOSUPERUSER, NOINHERIT, NOCREATEDB, NOCREATEROLE, NOREPLICATION,
  NOBYPASSRLS; final state NOLOGIN. Only migrator owns the empty target schema.

An initial target-scaffold transaction failed because default privileges were
attempted after revoking the owner's temporary migrator membership. The entire
transaction rolled back; ordering was corrected and target scaffolding passed.
No partial table/schema migration was applied. A first source read failed for a
missing local libpq root CA file; explicit system CA fixed it without weakening
TLS. Raw SQL/API exception bodies were suppressed, not copied to artifacts.

## Bounded live checks

All SQL probes cleared inherited PG settings, used verify-full TLS with system
CA `/etc/ssl/cert.pem` and required channel binding, 8-second connection and
25-second subprocess deadlines. SQL probes used 5-second transaction-local
statement timeouts; no pooled startup GUCs. Connection URLs/passwords never
appeared in argv/logs/artifacts. No sleeps/polling/background checks.

| Check, while new roles temporarily LOGIN | Observed result |
| --- | --- |
| Runtime direct and pooled dedicated target | Both connected as exact runtime |
| Fresh runtime credentials vs ORIGINAL direct+pool, each `neondb`+`vamotors` | All four authentication denied |
| New branch runtime vs copied `neondb` and `vamotors` | Both CONNECT permission denied |
| New branch runtime vs `template0` | Connection denied (catalog disallows connections) |
| New branch runtime vs `postgres`, `template1` | **Both connected: isolation failure** |
| Target runtime CREATE SCHEMA, table in `vamotors`, table in `public`, TEMP table | All denied42501 |
| Target runtime CREATE ROLE, SET ROLE migrator, SET ROLE owner | All denied42501 |
| Target runtime SET ROLE neon_superuser | Denied by Neon guard, SQLSTATEXX000; no membership exists |
| Target runtime ALTER self CREATEROLE, ALTER DATABASE OWNER | Both denied42501 |
| Runtime TEMP table in `postgres` | **Allowed: isolation failure**, rolled back |
| Target catalog memberships / table count | None / zero |
| After NOLOGIN: fresh runtime+migrator direct+pool connections | All four denied |
| Original before/after role attributes, memberships, DB ACLs, schema ACLs, table counts | Exact equality across both application databases |
| Original endpoint ID/branch/host/min/max/suspension | Unchanged |
| Original branch API roles | Still only `neondb_owner`; exact new roles absent |

Each write-denial probe ran alone inside BEGIN/ROLLBACK; unexpected successful
GRANT could only be a no-op without grant options, and no such grant persisted.
No business/auth tables, migrations, seeds, Environment singleton, bootstrap,
hosted state, Netlify/Vercel settings or shared-branch ACLs were written. Source
read-only comparisons are scoped catalog preservation evidence, not a whole
service/change-history attestation. Existing connections were short-lived probes;
no worker-owned persistent runtime sessions remain.

## Private recovery, withheld delivery, exact next handshake

Checked all three planned paths with existence/symlink checks; all were absent,
and none was written or overwritten:

- `/Users/alpha/.config/vamotors/t03-disposable-runtime.env`
- `/Users/alpha/.config/vamotors/t03-disposable-migration.env`
- `/Users/alpha/.config/vamotors/t03-disposable-accounts.env`

Private **quarantined recovery records**, regular files owned by current OS user,
mode0600, outside Git, are retained under:
`/private/var/folders/gb/j8pkyq8j0rd50dzkps44xgh40000gn/T/opencode/`:

- `t02b1-private-target.json`: generated runtime/migrator credentials, independent
  32-byte auth secret, Environment UUID/target metadata; no copied source password
  retained. Not a runnable dotenv file or authorization to enable roles.
- `t02b1-new-admin-private.json`: **new-branch-only** owner recovery credential,
  branch ID and host. Never substitute this owner credential for runtime/migrator.

The original management-key delivery file and original private dev file were not
changed. Recovery records may need secure relocation before temp cleanup; do not
print them. Normal delivery remains withheld until the isolation boundary is
resolved and checks rerun. After authorization, exclusive owner-only mode0600
delivery must preserve exact PR5 contracts:

- Runtime: **pooled DATABASE_URL only**, exact `vamotors_runtime`, sole URL query
  `sslmode=verify-full`; APP_ENV, Environment UUID above,
  APP_ORIGIN=BETTER_AUTH_URL=`http://localhost:3000`, independent auth secret.
  NO DIRECT_URL, owner credentials, startup options or bootstrap material.
- Migration: direct DIRECT_URL exact `vamotors_migrator`, same APP_ENV/UUID,
  `T03_DISPOSABLE_AUTHORIZATION` equal to UUID,
  `T03_DISPOSABLE_HOST` equal to the direct host above and
  `T03_DISPOSABLE_DATABASE=t03_disposable_1e760e0e`.
- Account/bootstrap file was not created: it is not needed for infrastructure
  scaffolding, and no token expiry/Environment initialization was performed.

Foundation alone runs the reviewed **migration-only** runner after parent clears
the blocker. Foundation then returns migration-ready confirmation plus exact
table/column/function identities. Infrastructure applies ONLY this reviewed
proposal; **none of these table/function grants has run**:

| Object in `vamotors` | Exact runtime grant after foundation confirmation |
| --- | --- |
| `user` | SELECT, INSERT; UPDATE(name,active,authzRevision,updatedAt); no DELETE |
| `session` | SELECT, INSERT, UPDATE, DELETE |
| `account` | SELECT, INSERT only |
| `verification` | None |
| `Environment` | SELECT(singleton,id,name,allowBusinessWrites,disposableTest,bootstrappedAt) only |
| `AdminGuard` | No direct grants; EXECUTE `vamotors.lock_admin_guard()` only, after fixed-search-path definer review |
| `Role` | SELECT, INSERT; UPDATE(name,active,revision) only |
| `Permission` | SELECT, INSERT only |
| `UserRole`, `RolePermission` | SELECT, INSERT, DELETE only |
| `CommandReceipt`, `AuditEntry`, `EntityReadVersion`, `StatusEvent` | SELECT, INSERT only |
| `BusinessSequence` | SELECT; UPDATE(value) only |
| `Notification` | SELECT, INSERT; UPDATE(readAt,revision) only |
| `Customer`, `Supplier`, `SupplierContact`, `Vehicle`, `PurchaseRecord` | None |
| `_prisma_migrations`, other schemas, future tables | None |

No auth adapter requirement silently broadens this matrix. Only after grants are
confirmed does foundation initialize the matching singleton, prepare the separate
private account material/short-lived token, bootstrap and execute real DB tests.
Parent retains acceptance decisions; integration alone owns ledger updates.
T02b1 access and T03/G1 remain blocked/unaccepted. No push/PR/merge/main/integration
change by this worker.

## Current primary sources

Fetched 2026-10-26; Context7 resolved Neon then fetched
`/neondatabase/website` documentation for branch-scoped roles/schema-only API:

- https://neon.com/docs/manage/roles — branch role cloning; branch-scoped resets;
  SQL-created roles avoid automatic neon_superuser membership.
- https://neon.com/docs/manage/databases — database cloning, reserved system DBs,
  Neon owner is not a full Postgres superuser.
- https://neon.com/docs/guides/branching-schema-only — schema-only root isolation,
  Free root allowance3 and shared1GB cap.
- https://neon.com/docs/introduction/plans — Free10 branches,100CU-hours/month,
  five-minute suspension, no extra-branch paid fallback, exhaustion suspension.
- https://neon.com/api_spec/release/v2.json — actual branch-scoped resource API,
  create request fields, 0.25CU minimum, `0` means plan-default suspension,
  informational usage-field limitations.
