# T02b1: supported Neon boundary resolution

2026-10-26. Research only; no delegation. **Recommendation: retain NOLOGIN and
withheld delivery; request a supported, Free, branch-local provider resolution.**
Neither a TEMP exception nor another branch/project by itself closes large-object
writes. Provider remediation availability is **unconfirmed**, not promised.
G0 accepted; G1–G6 pending, 0/134 accepted implementation requirements. PR5 remains
draft/unmerged. This document grants no migration, LOGIN, cloud-change or G1 approval.

## Authority and evidence, not new requirements

Repository base: `ddd69fb617b4790b3cd64cbf09cb10112d19c281`.
Read accepted contracts, orchestration plan, requirements and CLAUDE.md, plus:

- `91c6e1b07185a04198b2e36b8a4befff8e67f9c1:docs/operations/T02b1-isolated-verification.md`,
  especially lines 13–38, 134–158, 182–223 (quarantine, original endpoint preservation,
  grants withheld and migration/grant/bootstrap ordering).
- `18aa0e01662e0f5aa4714a47464013f9a3dbbb32:docs/operations/T02b1-management-resume.md`,
  lines 49–60 and 113–124 (Free history limitation; stronger other-database denial).
- PR5 head `24698af621cc29375598c12fdb6e0c9c0ae70bf4`:
  `docs/operations/T03a-security-spine.md`, “T02b exact access proposal” and
  “Private delivery”; actual `lib/server/{config,database-url}.ts`,
  `scripts/private-environment.ts`, and both `prisma/migrations/*/migration.sql`.
  Validators require exact runtime/migrator usernames, separated secrets and
  explicit disposable host/database/Environment authorization; they do **not**
  enforce server-side database selection. Migration 001 creates only application
  schema objects; 002 has no system-database or large-object ACL remedy.
- Reviewer `df933444-c628-416d-b1fb-b93ef0c0e747` findings supplied in this dispatch
  are attributed evidence, not independently rerun here: both roles NOLOGIN,
  no memberships/zero sessions; target CONNECT/schema USAGE only; copied app DBs
  denied; system CONNECT and postgres TEMP allowed; no private-row bridge/escalation.

| Original/accepted obligation | Residual capability and exact interpretation |
| --- | --- |
| Plan §G1; accepted `contracts/access-transactions.md` A1/A2 (lines 5–15, 31–35): current record/field authorization, rollback, append-only audit | System CONNECT/catalog names are not evidence of financial/private-row access or audit mutation. No FDW/dblink/definer bridge was found. These application proofs still require future real DB tests. |
| Accepted `contracts/files-runtime.md` R02, lines 29–44: restricted runtime, USAGE/explicit table grants, no CREATE/ALTER/DROP/TRUNCATE, no owner/migrator escalation, preview isolation | Target schema/table/TEMP DDL was denied. postgres TEMP is outside the intended runtime scope, but is session-local, not retained business modification. Qualified application relations and fixed `pg_catalog` search paths in migration 002 do not allow a TEMP object in **another database/session** to hijack its definers. This is source inspection, not executed migration proof. |
| R02 allowlisted runtime access; no explicit original large-object requirement | PUBLIC LO creators/writers offer **persistent database storage outside the application schema/grant design**. This disproves any blanket “no arbitrary persistent object creation” claim, but does not itself prove protected-row access, audit deletion or privilege escalation. Closing it is a least-privilege/quota remedy, not an invented requirement to hide all catalogs or audit every PostgreSQL internal action. |
| Plan lines 71, 189, 193; R02 line 46: retention, verified Free quota monitoring/stop; unknown usage requires operator review | LO growth, ordinary expensive SELECTs and continued connections consume shared project resources. NOLOGIN is containment, not a quota reservation; 0.25 CU/autosuspend is not a finite execution budget. No pruning/paid fallback permitted. |
| Worker handoff `18aa0e0`, lines 121–124: runtime denied from **every** other disposable-branch DB | Stronger than the original requirement to protect retained shared-dev/private data. System CONNECT fails that handoff even without a data leak. Do not silently redefine the handoff, claim the original demanded invisible system metadata, or waive actual R02 restrictions. TEMP-only exception is already rejected. |

`USER-01–05`, `AUDT-01–04`, `NFNL-03–04` in `.planning/REQUIREMENTS.md`
concern application authority/audit/TLS/retention, not elimination of normal
`pg_database`/`pg_roles` visibility. Metadata visibility is harmless **for the
observed names/attributes**, not a blanket assertion that every catalog value is
nonsensitive. Never query password hashes, secret settings or private business rows.

## Current primary documentation: supported versus unavailable

Fetched 2026-10-26; Context7 resolved Neon → `/websites/neon`, PostgreSQL →
`/websites/postgresql_18`, then queried each. Live target is PostgreSQL 18.6.

1. [Neon roles](https://neon.com/docs/manage/roles#the-neonsuperuser-role):
   roles are branch-scoped; SQL roles avoid automatic neon_superuser membership.
   That admin role is **not** a PostgreSQL superuser; provider roles are not for
   customers to use/modify. [Database access, Public schema privileges](https://neon.com/docs/manage/database-access#public-schema-privileges)
   documents `REVOKE ALL ON DATABASE … FROM PUBLIC`, applicable when authorized.
   It is supported on customer-owned copied DBs, not proof of authority over
   cloud_admin-owned system DBs.
2. [PostgreSQL 18 REVOKE, Description/Notes](https://www.postgresql.org/docs/18/sql-revoke.html):
   privileges are additive; revoking a named role does not subtract PUBLIC.
   Nonowners without grant options cannot revoke another owner's grant.
   Database/schema ownership is not ownership of built-in functions.
3. [PostgreSQL 18 privileges](https://www.postgresql.org/docs/18/ddl-priv.html):
   PUBLIC gets database CONNECT/TEMP and function EXECUTE by default.
   [LO server functions](https://www.postgresql.org/docs/18/lo-funcs.html#LO-FUNCS-TABLE)
   documents persistent creation via lo_from_bytea, lo_creat, lo_create and writes
   via lo_put/lowrite; no schema CREATE/TEMP requirement substitutes for their
   function ACLs. [LO implementation](https://www.postgresql.org/docs/18/lo-implementation.html)
   requires object SELECT/UPDATE for existing LO reads/writes: ability to create
   one's own LO does **not** imply arbitrary access to someone else's LO.
4. [Database separation](https://www.postgresql.org/docs/18/manage-ag-overview.html):
   one DB per connection, shared cluster metadata, explicit FDW/dblink needed for
   bridges. [Safe definers](https://www.postgresql.org/docs/18/sql-createfunction.html#SQL-CREATEFUNCTION-SECURITY)
   requires trusted resolution and selective EXECUTE. Do not weaken those rules.
5. [Neon compatibility, parameter settings](https://neon.com/docs/reference/compatibility#postgres-parameter-settings):
   customer parameter changes limited to session/database/role contexts; instance
   settings require provider involvement (documented Scale support route).
   No documented Free customer-managed `pg_hba.conf`/per-role-per-database proxy
   deny facility was found. The current [OpenAPI](https://neon.com/api_spec/release/v2.json),
   `ProjectSettingsData`, `EndpointUpdateRequest`, `PgSettingsData`, exposes
   project/network and endpoint controls, **not a documented database/role deny
   policy**. A generic settings map does not authorize arbitrary server settings.

Unavailable substitutes: named-role REVOKE while PUBLIC remains; revoking public
schema access (does not remove pg_catalog function execution); default privileges
for future migrator functions (does not alter existing built-ins); caller-side URL
validators; `default_transaction_read_only`/timeouts (defaults are not a hostile
role security boundary); read replicas (cannot run required transactional writes).
IP Allow/private networking are not database ACLs and are Scale features, not a
Free fix. New schema-only roots/separate Free projects isolate data/quota domains
but retain the same managed-system boundary unless provider confirms otherwise.

## Additional bounded, read-only live evidence

Management GETs at **2026-10-26T00:15:58Z**: project, branches, endpoints,
organization only. No history request repeated: prior403 and current OpenAPI
`getConsumptionHistoryPerProjectV2` explicitly exclude Free. No response bodies,
credentials, URLs or raw errors retained. Private files consumed inside commands.

| Observation | Result / limitation |
| --- | --- |
| Project / org / plan | `crimson-cherry-69611458` (VA Motors), `org-fancy-mode-53675625`, `free` / `free_v3`; Ohio, PG18 |
| Isolated root / endpoint / DB | `br-sweet-tooth-b5p418na` / `ep-rapid-darkness-b5t8cypf` / `t03_disposable_1e760e0e` (API ID2384869) |
| Original branch | `br-autumn-rain-b56rxlj9`, untouched; endpoint idle at GET; isolated endpoint active, min=max0.25 CU, suspend timeout0 (plan default), not disabled |
| Branch headroom | Two branches against documented Free allowance10; two roots against Free root allowance3 ([root branches](https://neon.com/docs/manage/branches#root-branch)). Slots are not compute/storage reservations. |
| Project counters | compute_time_seconds813, active_time_seconds3220, transfer17129 bytes, written_data_bytes0; period `2026-10-25T14:50:04Z`–`2026-11-01T00:00:00Z`; no custom quota object returned |
| Storage observations | Original root39,436,288 bytes; isolated root47,120,384; total86,556,672 reported logical bytes. API branch size cap1,073,741,824 bytes. Not an attestation of total billable storage/history/account usage. |
| Verified entitlement versus remaining | [Free plans](https://neon.com/docs/introduction/plans#plan-overview):100 CU-hours/project/month,1 GB/project,20 GB account-wide,5 GB public transfer/project/month. **Exact remaining compute/transfer/storage headroom remains unverified**; no subtraction from813 advertised as remaining allowance. |

One new catalog batch per target/postgres/template1, as isolated neondb_owner,
`BEGIN READ ONLY`, local5s timeout, `ROLLBACK`; verify-full/system CA, channel
binding required,8s connect/25s process deadline; inherited PG settings removed.
Only `pg_proc`/namespace/role metadata, ACL expansion and privilege checks:

- In **all three DBs**, cloud_admin owns
  `pg_catalog.lo_create(oid)`, `pg_catalog.lo_creat(integer)`,
  `pg_catalog.lo_from_bytea(oid,bytea)`, `pg_catalog.lo_put(oid,bigint,bytea)`,
  `pg_catalog.lowrite(integer,bytea)`, `pg_catalog.lo_truncate(integer,integer)`,
  `pg_catalog.lo_truncate64(integer,bigint)`, `pg_catalog.lo_unlink(oid)`.
  Each has PUBLIC EXECUTE, runtime effective EXECUTE, and **no EXECUTE WITH GRANT
  OPTION for neondb_owner**. These are catalog results; no LO function was called.
- `lo_import(text)`, `lo_import(text,oid)`, `lo_export(oid,text)` also cloud_admin
  owned, but **not** PUBLIC/runtime executable. Do not claim server-file access.
  `lo_compat_privileges=off` in these owner sessions; not an ACL substitute.

Thus available owner cannot use ordinary supported REVOKE to fix even the
customer-owned **target** DB's built-ins. Provider action/equivalent supported
enforcement is needed for the proposed LO restriction; no grant attempt repeated.

## Minimal provider request — draft only, not sent

Ask the project operator to submit through the available Free/community channel:

> On Free/free_v3 project crimson-cherry-69611458, **only** root
> br-sweet-tooth-b5p418na / endpoint ep-rapid-darkness-b5t8cypf, can Neon provide a
> supported, durable branch-local restriction for vamotors_runtime and
> vamotors_migrator: permit connections only to t03_disposable_1e760e0e, deny
> postgres/template1 and every other database through direct **and** pooled paths?
> Customer-owned copied DB ACLs already deny access; cloud_admin owns system DBs
> and PUBLIC still connects. Preserve provider/admin operation. If using SQL ACLs,
> preserve explicit necessary provider/owner grants before removing PUBLIC
> CONNECT (and postgres PUBLIC TEMP); a role-specific REVOKE alone cannot deny it.
>
> In the allowed target DB, also disable unneeded PUBLIC/runtime/migrator EXECUTE
> on the eight fully qualified creator/mutator signatures listed above, preserving
> explicit necessary admin/provider execution. cloud_admin owns them and available
> owner has no EXECUTE grant options. No large-object feature is used by this app.
> Existing lo_import/export denials must remain. If system connections cannot be
> denied, explain a supported equivalent blocking both TEMP and **all persistent
> LO writes there**, as well as LO writes in the target; that alternative needs
> explicit handoff review, not an automatic exception.
>
> Confirm Free availability, persistence across suspend/restart/maintenance and
> branch lifecycle, exact verification procedure, and any scope/side effects.
> Do not enable either role, change original br-autumn-rain-b56rxlj9, transfer
> provider-role authority, upgrade billing, or migrate/seed anything. If no supported
> Free solution exists, state that limitation; do not apply internal workarounds.

Denying system CONNECT makes changing their LO function ACLs unnecessary for these
roles; **target LO restriction remains necessary** for the proposed boundary.
Provider confirmation alone is not independent verification. Another provider or
local disposable PostgreSQL can be evaluated separately if unavailable, but is
not authorized here and does not prove the required Neon hosted environment.

## Finite operator budget and stop proposal — NOT activated

Before any LOGIN/delivery: infrastructure operator must record their name, exact
test SHA/scope and a fresh Console project-usage/remaining-quota attestation
covering **all** project computes, storage and network (plus account storage).
R02 unknown-usage review must explicitly clear sufficient headroom; otherwise
**stop**. Freeze overlapping test starts by coordination, not by changing original
resources. Shared project allowance is not isolated by a branch.

Propose **one supervised 30-minute window**, including cleanup, one0.25-CU endpoint,
no retry window without reapproval; reserve **0.25 CU-hours** for this run (30min
plus5min idle tail estimates0.146 CU-hours, leaving margin, not a metered promise).
Require the project remain below accepted70% warning/85% stop thresholds with
this reserve plus concurrent original usage. Limit fixtures to1,000 rows/16MiB
payload, observed logical growth32MiB and transfer64MiB; no LO/blob/load tests,
no health loops. These are conservative proposed **test** limits, not limits on
required v1 features or a storage/WAL hard guarantee.

An independent operator-owned deadline supervisor must be armed **before** role
enablement, with reviewed cleanup on normal exit, failure and deadline: stop test
processes/reconnect sources, set both isolated roles NOLOGIN and terminate their
existing branch sessions, close owner/client connections. NOLOGIN alone leaves
existing sessions alive. Keep credentials private; attest zero role sessions and
roles quarantined; use bounded GET status checks, not SQL keepalives. At any
unexpected write/growth, quota warning/unknown usage, supervisor failure or
deadline, stop and escalate; never silently extend/retry, prune retained data or
upgrade. This is an operator-controlled test budget, **not** protection against
arbitrary malicious resource exhaustion or a verified current stop service.

[Consumption limits](https://neon.com/docs/guides/consumption-limits#available-metrics)
are project-wide, approximate, refreshed every15min and can lag1hour.
Configured project compute/transfer quotas offer persistent suspension, but affect
the original branch too; no change is authorized, and Free configurability was not
write-tested. A separate Free project is an option for quota isolation only after
approval. Current OpenAPI `ProjectQuota` says logical-size exhaustion rejects
writes while allowing startup, whereas the prose describes branch suspension;
do not rely on that discrepancy as a verified stop. `EndpointUpdateRequest.disabled`
schedules suspension but explicitly permits periodic check_availability re-enable;
it is not the sole durable stop. Autosuspend restarts on demand. A provider hard
cap/independent supervisor with sufficient margin is required before stronger
resource-bound claims; if operator cannot provide this, remain stopped.

## Concrete next action / retained scope

**Operator obtains the scoped provider answer above; keep both roles NOLOGIN.**
After supported remediation is separately authorized, infrastructure and an
independent verifier must establish effective ACL/path denial (including target
LOs), no existing sessions and preserved original state, then approve the finite
budget. Only then resume migration-only → exact reviewed grants → initialization/
private bootstrap → real security tests, with unchanged PR5 validators. No access
delivery, writes/probes, ACL/LOGIN changes, provider-internal edits, migrations,
support sending, paid changes, PR push/merge or global-ledger edits occurred here.
