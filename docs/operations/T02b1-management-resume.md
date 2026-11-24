# T02b1 management resume — role mapping blocked before provisioning

2026-10-26; infrastructure author evidence, not independent acceptance. Base
`ddd69fb617b4790b3cd64cbf09cb10112d19c281`; reviewed PR5 source
`24698af621cc29375598c12fdb6e0c9c0ae70bf4` and prior checkpoint
`b0e0d2a76b72f3c864a6ca0d479b7de6bc6f9a3e`, without changing either branch.
G0 remains accepted; T03/G1 remains unaccepted, 0/134 implemented acceptance.
No delegation, ledger/package/schema edits, push, merge or hosting changes.

Read the orchestration contract, CLAUDE.md, R02/E6, D24, T02a preparation,
T02b1 blocked access runbook and PR5's exact T03a grant/private-file handshake.
This dispatch authorizes a disposable Neon branch within verified free capacity,
but does not authorize changing foundation's runtime/migration validators.

## Verified existing resource identity and free capacity

The privately delivered management key was consumed inside commands only. No key,
connection URL, response body, subprocess error or delivery-file contents were
printed or stored in this checkout. The delivery file was not changed/deleted.

| Read-only observation                 | Result                                                                                                                                                     |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Organization                          | `org-fancy-mode-53675625`, plan `free`                                                                                                                     |
| Project                               | `crimson-cherry-69611458`, actual name **VA Motors**, `aws-us-east-2`                                                                                      |
| Identity mapping                      | Existing private dev DIRECT_URL hostname exactly matches the project's existing endpoint; this establishes identity despite historical name `vamotors-dev` |
| Existing branch                       | `br-autumn-rain-b56rxlj9`, `production`, default, ready                                                                                                    |
| Existing endpoint                     | `ep-mute-lab-b5d4mno7`, read/write, initially idle                                                                                                         |
| Owner subscription / branch allowance | `free_v3`; API `branches_limit=10`; inventory had 1 branch, so 9 unused slots                                                                              |
| Existing compute settings             | 0.25–2 CU; `suspend_timeout_seconds=0` means plan default, not disabled scale-to-zero                                                                      |
| Current project usage fields          | `compute_time_seconds=813`, `active_time_seconds=3220`; informational, not billing-grade remaining-budget proof                                            |
| Consumption period returned           | 2026-10-25T14:50:04Z through 2026-11-01T00:00:00Z                                                                                                          |
| Storage                               | API branch cap 1,073,741,824 bytes; existing branch logical size 39,436,288 bytes                                                                          |

Current primary docs confirm Free includes 10 branches/project, 100 CU-hours per
project/month, up to 2 CU, automatic five-minute scale-to-zero, 1 GB storage/project
and 5 GB public transfer/project/month. Free has no paid extra-branch fallback;
quota exhaustion suspends/rejects operations rather than authorizing upgrades.
No billing/plan/default settings were changed. A future disposable endpoint should
be capped at 0.25 CU min/max, retaining the Free plan's default idle suspension.
Recheck current capacity immediately before creation; this inventory is not a
reservation or an unlimited verification budget.

`GET /projects` initially returned HTTP400 because a personal API key requires
`org_id`; `GET /users/me/organizations` and organization-scoped project inventory
succeeded. This is **not** evidence of an invalid key. Searching `vamotors-dev`
returned no project; unfiltered inventory and private endpoint comparison found
the actual existing project above. Shared-project inventory was empty.

The billing-grade `/consumption_history/v2/projects` request returned HTTP403,
with its body suppressed. The current OpenAPI specification explicitly restricts
that endpoint to Launch/Scale/Agent/Business/Enterprise. Do not request an upgrade
or infer a missing billing permission from that Free-plan response. Exact billed
remaining CU-hours were not verified; project usage fields above are the bounded
available evidence. Verify Free-console usage through the parent if stricter
remaining-budget attestation is required before creation.

Sources fetched during this attempt:

- <https://neon.com/api_spec/release/v2.json>
- <https://neon.com/docs/introduction/plans>
- Context7 `/neondatabase/website`, management/branch/quota documentation.

## Source audit and isolation status

On the existing credential's database only: BEGIN READ ONLY, SET LOCAL 5s,
catalog SELECT, ROLLBACK passed. Owner has CREATEDB and CREATEROLE; five catalog
databases; zero user tables in the connected database; no `vamotors` schema; zero
roles named `vamotors_runtime` or `vamotors_migrator`. This is not a table/data
audit of every database. No password hashes or role passwords were queried.
The libpq probe cleared inherited PG settings, used verify-full TLS and required
channel binding, with 8s connection/20s process deadlines and captured errors.

No new branch/endpoint/database/schema/role was created. No cloned/shared
credentials were used on a new branch. No DDL or negative write probe ran on
shared dev. Existing PUBLIC ACLs, credentials, Netlify and Vercel were untouched.
Runtime isolation/DDL/escalation tests are **NOT RUN** because no runtime exists.
Do not misreport the source audit or offline validator test as isolation proof.

## Exact blocker and action for parent/foundation

Dispatch asks for unique role names, allowing a mapping correction request if
suffixes fail validators. They do fail in the actual reviewed PR5 code:

- `lib/server/config.ts` passes literal `vamotors_runtime` to `databaseURL`.
- `scripts/private-environment.ts` passes literal `vamotors_migrator`.
- `lib/server/database-url.ts` requires decoded username equality with that
  literal, not a prefix or branch-specific mapping.
- T03a's written access proposal also explicitly requires those exact names.

Executed PR5's actual `databaseURL` function using Node24 TypeScript stripping in
an approved temporary directory, with synthetic `.example` URLs only: exact
runtime and migrator names accepted; both `_t02b1`-suffixed variants rejected.
**Four assertions PASS.** No PR5 file/branch was mutated.

**Next action:** foundation/parent must accept an explicit mapping for unique
roles, proposed `vamotors_runtime_t02b1_9fad086d` and
`vamotors_migrator_t02b1_9fad086d`, and update/test BOTH runtime and guarded
migration validation against that exact mapping. Do not broaden to arbitrary
usernames or regex-prefix acceptance. Alternatively parent must explicitly amend
the dispatch to authorize branch-local exact reserved names, which currently have
no source collisions. Infrastructure does not silently make that policy choice.

Stopped before cloud creation to avoid an unusable partial branch. Branch-create
permission itself has not been exercised; inventory success does not prove it.
No Environment UUID has been assigned and no DB Environment singleton exists.
After mapping approval, assign one fresh immutable UUID to the provisioned target
and private files; foundation alone creates its matching singleton.

## Resume and grant handshake — table grants remain unexecuted

1. Recheck project/free capacity and source read-only. Prefer documented
   schema-only branch initialization; inspect any cloned databases/roles before
   access delivery. Never reset a shared password. Use unique credentials and
   SQL-created non-neon_superuser roles on the new branch only.
2. Create dedicated verification DB and `vamotors` schema scaffolding, migrator
   schema ownership and runtime USAGE/CONNECT only. Deny PUBLIC CONNECT/TEMP on
   other copied databases and PUBLIC CREATE/USAGE as required on the new branch
   only; remove migrator default PUBLIC function EXECUTE. Neither role gets
   superuser/CREATEDB/CREATEROLE/BYPASSRLS/replication; runtime gets no ownership,
   migrator membership or grant options. No business/auth tables or seeds.
3. Prove runtime denial on original direct/pooled endpoints and every other
   disposable-branch database, denied schema/table/temp DDL, role creation and
   SET ROLE migrator. Preserve verify-full/channel binding, no pooled startup
   GUCs, and transaction-local timeouts. Deliver only after these checks pass.
4. Privately create exclusive owner-owned regular mode0600 files outside Git;
   never overwrite `dev-neon.env` or any existing delivery. Proposed paths,
   **not delivered or created in this attempt**:
   - `~/.config/vamotors/t03-disposable-runtime.env`: pooled DATABASE_URL only,
     APP_ENV=disposable-test, ENVIRONMENT_ID, explicit local
     APP_ORIGIN=BETTER_AUTH_URL=`http://localhost:3000`, random independent
     > =32-byte BETTER_AUTH_SECRET. No DIRECT_URL/bootstrap material.
   - `~/.config/vamotors/t03-disposable-migration.env`: direct DIRECT_URL,
     same APP_ENV/ENVIRONMENT_ID, T03_DISPOSABLE_AUTHORIZATION matching UUID,
     T03_DISPOSABLE_HOST and T03_DISPOSABLE_DATABASE matching actual new target.
   - `~/.config/vamotors/t03-disposable-accounts.env`: random32-byte hex
     BOOTSTRAP_TOKEN and distinct private ADMIN/SECOND/STAFF email/password
     fields from the exact T03a interface. Passwords12..128, random and distinct;
     no public defaults. Foundation initialization supplies <=30min expiry.
5. Parent coordinates foundation's reviewed migration-only runner on the direct
   private file. Foundation returns migration-ready confirmation and exact
   table/column/function identities. Infrastructure then applies ONLY this
   reviewed PR5 proposal; no blanket/future-table grants:

| Object in `vamotors`                                                   | Runtime grant after migration-ready confirmation                                     |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `user`                                                                 | SELECT, INSERT; UPDATE(name,active,authzRevision,updatedAt); no DELETE               |
| `session`                                                              | SELECT, INSERT, UPDATE, DELETE                                                       |
| `account`                                                              | SELECT, INSERT only                                                                  |
| `verification`                                                         | None                                                                                 |
| `Environment`                                                          | SELECT(singleton,id,name,allowBusinessWrites,disposableTest,bootstrappedAt) only     |
| `AdminGuard`                                                           | None; EXECUTE `vamotors.lock_admin_guard()` only, reviewed fixed-search-path definer |
| `Role`                                                                 | SELECT, INSERT; UPDATE(name,active,revision) only                                    |
| `Permission`                                                           | SELECT, INSERT only                                                                  |
| `UserRole`, `RolePermission`                                           | SELECT, INSERT, DELETE only                                                          |
| `CommandReceipt`, `AuditEntry`, `EntityReadVersion`, `StatusEvent`     | SELECT, INSERT only                                                                  |
| `BusinessSequence`                                                     | SELECT; UPDATE(value) only                                                           |
| `Notification`                                                         | SELECT, INSERT; UPDATE(readAt,revision) only                                         |
| `Customer`, `Supplier`, `SupplierContact`, `Vehicle`, `PurchaseRecord` | None                                                                                 |
| `_prisma_migrations`, other schemas, future tables                     | None                                                                                 |

6. Foundation then initializes the singleton and runs guarded bootstrap and real
   adapter/security tests in the T03a order. Initialization/bootstrap/table writes
   are foundation-owned; this document does not authorize infrastructure to run
   them. Parent retains all gate/acceptance decisions. An observed new adapter
   requirement requires exact-grant review, never automatic account/verification
   broadening. No shared-dev/hosted release is unlocked by inventory alone.
