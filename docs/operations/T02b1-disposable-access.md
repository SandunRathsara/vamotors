# T02b1 disposable verification access — blocked, not provisioned

2026-10-25; author evidence, independent review required. Accepted base
`ddd69fb617b4790b3cd64cbf09cb10112d19c281`. T01/G0 accepted by dispatch;
historical T01 source-integration wording does not supersede that acceptance.
No full T02 or G1 claim. Infrastructure owns only this operations documentation
and `scripts/infrastructure/`; foundation retains packages/schema/migrations.

Read orchestration, CLAUDE.md, R02, entities E6, T01 source-integration evidence,
T02a preparation and browser-readiness before work. D24's documented unavailable
GSD-command exception and explicit bounded worker dispatch apply; no simulated
GSD execution, delegation, ledger changes, merge or main changes.

## Actual read-only findings and stop decision

Existing owner credential was privately consumed from
`~/.config/vamotors/dev-neon.env`; never copied into runtime credentials.
Owner has CREATE DATABASE and CREATE ROLE, not superuser. Five catalog databases:
three non-template, two template. All five have PUBLIC CONNECT; four allow
connections. The current retained shared-dev database has PUBLIC CONNECT and
TEMPORARY, public-schema USAGE but not CREATE. Current DB has zero user tables,
zero PUBLIC table-grant entries, and two default-ACL entries. This is a bounded
catalog audit, not an assertion that every other DB is empty or secure.

A new role would inherit PUBLIC CONNECT/TEMPORARY and public-schema USAGE on the
original database. A separate same-branch DB, NOINHERIT, per-role REVOKE, default
search_path, or application Environment flag cannot negate PUBLIC. Connection
access alone already fails the requested isolation gate, and TEMPORARY permits
object creation on retained shared dev. Therefore **no DB/schema/role was created**,
no credential/owner password changed, and no shared ACL was modified. No negative
DDL probe was executed on shared dev. Do not claim runtime-denial evidence: no
runtime role exists yet.

The SQL owner is capable of creation; the blocker is safe isolation within the
authorized mutation scope, not missing CREATE privilege. Modifying PUBLIC ACLs
on shared dev would exceed this dispatch. A separate Neon branch is the candidate
safe boundary, but creating a branch is not in the explicit DB/schema/role-only
allowlist. It requires orchestrator authorization and a management inventory/free
allowance check first; do not substitute an unapproved project/provider/host.

No Neon CLI, NEON_API_KEY/NEON_PROJECT_ID environment variables, or credentials at
the inspected standard `~/.config/neonctl/{credentials,config}.json`,
`~/.config/neon/credentials.json`, `~/.config/vamotors/neon-management.env` paths
were present. This is not proof that no credential exists anywhere. A private
project-scoped management-credential card was requested and timed out; no secret
was received. No management API request or branch creation was attempted.

## Reproduction

```sh
python3 scripts/infrastructure/neon-isolation-preflight.py --self-test
python3 scripts/infrastructure/neon-isolation-preflight.py
python3 scripts/infrastructure/neon-readonly-diagnostic.py --transport --startup-negative-control
```

Preflight exit **2** means blocked PUBLIC CONNECT; exit1 is a redacted execution
failure. Exit0 means only that PUBLIC CONNECT was absent, **not** proof of complete
isolation. The live query is BEGIN READ ONLY / SET LOCAL 5s / catalog SELECT /
ROLLBACK, with verified-hostname TLS, required channel binding, no inherited PG
options, 8s connection and 20s process deadlines. Credentials and all subprocess
errors are captured, never printed. No retries, watches or polling.

Fresh results: preflight self-test PASS; live preflight returned the catalog
findings above and expected exit2. Direct and pooled SELECT1 both PASS; both
endpoints passed IPv4/IPv6 hostname/certificate verification with TLS1.3. Pooled
startup negative control returned expected `unsupported_startup_parameter`.
No application/API/E2E or foundation migration test ran: access is blocked, not
silently replaced with shared-dev credentials. Whitespace validation passed.

`pg_stat_ssl.ssl=false` was observed in an initial catalog check. That describes
the backend hop behind Neon's proxy, not client transport; do not label it
end-to-end backend TLS proof or a plaintext client connection. Use the separate
trusted-certificate/hostname SSLRequest transport check for client-facing TLS.

## Foundation handshake — no access delivered yet

Machine-readable state: `disposable-test-identity.json`. EnvironmentID, actual
roles and database remain null deliberately, not an invented accepted identity.
Do not run foundation migrations/seeds with the original owner credential.

Reserved private destinations (both **absent**, not delivered):

- `~/.config/vamotors/disposable-test-runtime.env`: pooled DATABASE_URL only,
  per-environment >=32-byte BETTER_AUTH_SECRET; APP_ENV=disposable-test;
  ENVIRONMENT_ID assigned once on actual provisioning. Never DIRECT_URL or
  bootstrap/migrator authority.
- `~/.config/vamotors/disposable-test-migration.env`: direct DIRECT_URL,
  matching APP_ENV/ENVIRONMENT_ID; guarded operator use only, never app/build.

Proposed explicit local-only APP_ORIGIN/BETTER_AUTH_URL:
`http://localhost:3000`; no preview wildcard or hosted approval. Both private files
must be created exclusively (never overwrite), owner-owned regular mode0600,
outside Git. Generate auth/bootstrap material privately only after resource and
foundation bootstrap interface acceptance; bootstrap token expires <=30min and
belongs in a separate operational file, never runtime. No auth/bootstrap values
were generated prematurely in this blocked task.

After orchestrator authorizes a separate branch within verified free capacity:

1. Inventory project/branches/compute/plan without printing raw API responses.
   Prefer schema-only isolation, not an accidental data-bearing clone. No paid
   fallback. Record project/branch/database/role identities and a fresh UUID.
2. Create SQL-only suffixed migrator/runtime roles (not management-created roles
   with neon_superuser). Neither role gets superuser, CREATEROLE, CREATEDB,
   BYPASSRLS, replication, or membership in owner/migrator roles for runtime.
   Migrator owns dedicated `vamotors` schema; runtime only USAGE there.
3. On disposable resources only, revoke PUBLIC CONNECT/TEMP/CREATE and public
   schema access as appropriate; grant CONNECT explicitly. Audit PUBLIC function
   EXECUTE/default privileges too. Revoke migrator default PUBLIC function EXECUTE
   before foundation creates guarded functions. No blanket future-table grants.
4. Prove restricted credentials cannot authenticate to original shared-dev
   endpoint/databases (direct and pooled), cannot create/alter schema/objects,
   cannot create roles or SET ROLE migrator. Check memberships and grant options.
   All allowed negative object probes must target disposable resources only.
5. Deliver private files and exact EnvironmentID/actual role mapping through the
   orchestrator. Foundation creates the matching Environment singleton, schema,
   auth tables and guarded functions; infrastructure does not invent those tables.
6. Foundation returns exact generated table/column/function names and desired
   auth lifecycle operations. Infrastructure applies reviewed explicit grants:
   mutable auth/session/verification operations as actually required; retained
   User/business actors no DELETE; audit/status/payment/issued history SELECT and
   INSERT only; Environment/AdminGuard no direct writes. Protected mutations only
   through reviewed guarded functions with fixed safe search_path and exact
   EXECUTE grants. No ALL TABLES, broad future writes, or blanket auth DELETE.
7. Foundation proves real adapter transactions, auth lifecycle, immutable history,
   guard denial and EnvironmentID mismatch before any release claim. Use per-tx
   SET LOCAL timeouts; PgBouncer startup statement_timeout remains unsupported.

## Cleanup and preserved resources

No disposable resource exists to clean up from this task. After successful
provisioning, cleanup must match exact recorded project/branch/database/role and
EnvironmentID, confirm disposableTest=true and stop active foundation use first.
Never wildcard-drop or reset shared dev. Require an explicit orchestrator cleanup
handoff; remove only that disposable resource and its exclusively created private
files after verification evidence is retained. No automatic business-data pruning.
Retained shared-dev DB/data/roles and existing credential files are never cleanup
targets. Shared-dev indefinite retention is distinct from disposable test data.

Netlify site `f69a4d7e-cf97-4933-91d7-aabd4e66616b` was not touched or freshly
queried: disabled/unlinked/zero env/build is inherited T02a evidence only. No
Netlify builds/deploys/linkage, migrations/seeds, object writes, dependency/schema
edits, browser reinstalls, paid resources, or Vercel changes.

## Current sources

Context7 resolved `/neondatabase/website`, then queried SQL-role isolation and
branch roles. Official pages checked 2026-10-25:

- https://www.postgresql.org/docs/current/ddl-priv.html — additive PUBLIC rights,
  default database CONNECT/TEMP and function EXECUTE.
- https://neon.com/docs/manage/branches — branch-local roles, schema-only branches,
  management API and allowance checks. Do not infer actual account quota from docs.
- https://neon.com/docs/manage/roles — SQL-created roles do not automatically get
  neon_superuser; branch roles copied from parent, so create new restricted roles
  only in the isolated destination and test source-endpoint rejection.
