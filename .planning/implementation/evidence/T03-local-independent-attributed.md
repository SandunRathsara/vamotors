# T03-local independent review — sanitized attribution

Reviewer `ced411b9-39b3-4578-a091-3a4e1e5de9e0`, supplied report `review-d71-report.md`, inspected by integration owner on 2026-10-26. Reviewed exact source **`d71def0217a17c66b7c5a2162ef06c440b5ea4da`**, against PR5 **`24698af621cc29375598c12fdb6e0c9c0ae70bf4`**, under accepted local plan **`5ed7083fcede77f6218625b7930b717eb146597f`**. This is an attributed sanitized record, not a claim that integration reran the reviewer-only adversarial fixture. Private source/config paths omitted; no credentials or fixture payloads copied.

## Verdict and limits

**PASS bounded local PostgreSQL/auth/security spine**, no new blocking defect in the 14 changed files. **Not full T03, G1 or application acceptance.** Parent must verify final combined SHA with accepted plan lineage retained. **FAIL full lint:** unchanged `app/api/cash-flow/route.ts:20` prefer-const and two React compiler errors at `lib/compose-refs.ts:59`, plus 27 warnings. These remain integrated/G6 blockers.

Reviewer used an independent `git archive` snapshot, offline frozen-lockfile install, new random private cluster/accounts/ports, native PostgreSQL18 binaries (not default cluster). No delegation, author private-state reads, cloud calls, pushes, PR changes, merges or application edits. All reviewer Next children stopped/awaited; only explicit reviewer cluster stopped; retained private data/config not deleted.

## Executed evidence (reviewer, not integration)

`pnpm install --frozen-lockfile --offline`, `pnpm db:generate`, `pnpm local:setup` twice, `pnpm local:test`, `pnpm test:unit`, `pnpm typecheck`, `node .planning/implementation/contracts/check.mjs`, `pnpm build`, `pnpm local:test:http`, reviewer-only independent fixture, `local:stop`, `local:start`, `local:test`, `local:stop`. Explicit reviewer-only `VAMOTORS_LOCAL_DIR` used for every local command. Owned-file ESLint/Prettier and base/candidate diff check PASS; full lint FAIL above. No dependency/lockfile changes (six package scripts added).

- Fresh install: two committed migrations, retained Environment `local` / `disposableTest=false`, consumed/cleared bootstrap hash, separate admin/migrator/runtime credentials, three real credential/session accounts. Repeated setup does not reset/reseed. Deterministic IDs/grants, random secrets.
- All 10 real-DB groups including after restart, 70 units, 19 pure contracts, typecheck and production build PASS. A reviewer UUID marker survived stop/start. Consumed bootstrap replay exits1.
- Owner-only root0700/env0600/current UID verified. Insecure0644 input, unrelated pre-existing root and symlink root rejected without changing existing marker/content.
- Independent 50-combination host/TLS matrix and 350 startup-option/query attacks PASS: numeric127.0.0.1 only locally; remote-local hosts even with TLS rejected; nonlocal disable rejected; role/host/port/schema/SSL/options overrides and duplicate sslmode rejected; foreign/arbitrary-scheme origins and migrator target-authorization mismatch rejected.
- Runtime ALTER/DROP, receipt TRUNCATE/DELETE, audit UPDATE, permission UPDATE, SET ROLE admin, migrator membership grant and bootstrap-secret SELECT denied. Author DB groups additionally cover TEMP/schema/role CREATE, Environment/AdminGuard writes, audit DELETE/TRUNCATE, escalation/role flags and owner append-only triggers.
- Actual production HTTP: private HttpOnly login cookies; anonymous401, staff admin query/command403, signup/reset404, missing/foreign Origin403, unknown systemKey422, minimized no-store actor, logout invalidation.
- Independent eight-way HTTP saveRole: exactly one201 and one audit/receipt, same-input retries200, changed input409. Earlier bounded503 RETRYABLE_TRANSACTION (`retryable=true`, Retry-After1) recovered with sequential same-key200 and no duplicate commit; unconditional concurrent success is not claimed.
- Forced production HTTP audit CHECK failure500 rolled back Role and receipt; removal of injected constraint let same key commit201. Author groups separately cover required-notification failure and business/audit/receipt rollback.
- Real-session stored Vehicle projection: own financial allowed, other owner's omitted, forbidden listedPrice FIELD_FORBIDDEN. Finance-role revocation changes same-cookie next-request fingerprint/removes fields. Shared projection seam only, not vehicle HTTP/domain acceptance.
- Account deactivation denies same-cookie403 ACCOUNT_INACTIVE. Concurrent two-admin HTTP self-deactivation gives one200/one409, one active remains, inactive replay403. Accounts/grants restored in finally. Author groups verify LAST_ADMIN and six consecutive deferred-trigger failures beyond pool capacity with rollback/release.
- Fresh bootstrap replay and restart retention PASS; post-restart complete DB suite PASS.

Reviewer fixture-only intermediate mistakes (201 versus200, inactive403 versus401, environment prefix, wrapper `.data`, reused marker) corrected; failed runs not counted, no application edits to obtain passes.

## Contract assessment and remaining scope

Candidate changes no contracts relative to PR5. Accepted local plan justifies loopback-only plaintext (not hosted TLS), retained local Environment, separately authorized migrations/bootstrap and app-specific least privilege, not global PostgreSQL lockdown. `SET CONSTRAINTS ALL IMMEDIATE` after final callback graph construction moves deferred errors into working rollback/release; not proof of every commit/network/driver failure. Separate plan lineage must survive integration; temporary test directories are not durable production file acceptance.

Remaining: login/admin UI, authorization-aware RSC/global legacy API/page protection, remaining domain schema/commands and endpoint/field coverage; final combined-SHA verification. G2+ remain unaccepted: persistent purchase/multi-browser journeys, durable private file IO/restart, actual timer/catch-up, business/finance/reports/import/PWA, capacity/backup/separate DB+file restore, zero-error full lint and final handoff. Hosted/provider/deployment **DEFERRED / NOT PASSED**.
