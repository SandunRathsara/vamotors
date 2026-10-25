# T02a — bounded infrastructure preparation

2026-10-25; author evidence, **review required**, not T02 acceptance. Base:
`f51b1648bbbda5fb8e37129ba31be0683d63678f`; branch
`t3/t02a-infra-neon-netlify-prep`. No merge or default-branch changes.

## Scope and authority

Read the full orchestration contract, `CLAUDE.md`, all four implementation records,
v1 requirements, C4 decisions and infrastructure findings. The dispatch accepts
T00 despite stale T00 review-state records in this base; integration owns their
updates. No global ledger/matrix/evidence/HANDOFF edits here. GSD commands/tools
remain unavailable (`~/.claude/commands/gsd` and OpenCode commands directory absent),
as already recorded in D24; no GSD execution is claimed. Work follows the explicit
bounded orchestration dispatch; no phase counters changed.

Harness-created isolated worktree is the current checkout, clean at the exact base
before work. No recursive delegation. No package/lockfile/schema edits. No
migrations, role creation, business writes, object writes, Vercel changes, paid
upgrades or application publishing. Runtime/auth/schema details await accepted
T01/T03. NFNL-03/04 remain unaccepted pending hosted TLS, retention and recovery.

## Neon: observed failure and safe resolution

Private file: `~/.config/vamotors/dev-neon.env`, owner-owned mode 0600. Paired
direct/pooler host, user, password and database validated without printing values.
Existing owner credential is diagnostic-only, **not approved runtime access**.

Commands (no secret arguments or raw error output):

```sh
python3 scripts/infrastructure/neon-readonly-diagnostic.py --self-test
python3 scripts/infrastructure/neon-readonly-diagnostic.py --transport --startup-negative-control
```

Observed:

| Probe                                                                            | Result                                          |
| -------------------------------------------------------------------------------- | ----------------------------------------------- |
| Direct DNS/TCP/Postgres SSLRequest/TLS, one IPv4 and IPv6 address                | PASS, TLS 1.3, trusted certificate and hostname |
| Pooled same transport probes                                                     | PASS, TLS 1.3, trusted certificate and hostname |
| Direct `BEGIN READ ONLY; SET LOCAL statement_timeout = '5s'; SELECT 1; ROLLBACK` | PASS                                            |
| Pooled identical transaction, no startup options                                 | PASS                                            |
| Pooled negative control: `PGOPTIONS='-c statement_timeout=5000'`                 | Rejected: `unsupported_startup_parameter`       |

Initial probe included `default_transaction_read_only` and `statement_timeout`
startup options and failed. A first coarse classifier matched the substring
`timeout` in **statement_timeout**, incorrectly describing this as a timeout.
One-variable differential testing removed startup options, passed, then re-added
them and reproduced PgBouncer's explicit startup-parameter rejection. The committed
classifier distinguishes that rejection from `timeout expired`/`timed out`.
This explains the reproduced diagnostic failure; earlier readiness timeouts cannot
be retroactively attributed without their private command/error evidence. No
provider outage or persistent network fault is established.

Fix: no unsupported startup GUCs on pooled connections; enforce read-only and
timeouts **inside each transaction**, not by session settings that leak through
transaction pooling. No connection string/secret file changed. Required channel
binding and `sslmode=verify-full` retained. The script clears inherited `PG*`
overrides, uses environment-only credentials, suppresses subprocess stdout/stderr,
has an 8-second connection timeout and 20-second process deadline, and never retries.
Transport probes use a four-second socket timeout. DNS uses the OS resolver and
does not have a separate script-level deadline. Self-test is offline and includes
credential mode/pair checks. This is libpq evidence, not proof of the future
Prisma/Neon WebSocket adapter's interactive transactions or least privilege.

No Neon management access is needed to resolve this reproduced failure. Management
access remains unverified. T03 must define restricted runtime grants and migration
ownership before T02b installs credentials. Do not deploy the existing owner URL.

## Netlify resource and no-deploy evidence

Authenticated API queries read the existing local Netlify CLI credential privately
from `~/Library/Preferences/netlify/config.json`; only allowlisted fields printed.
CLI is not on PATH; no CLI login/token installation or new token was necessary.

| Fact                                   | Fresh result                                                        |
| -------------------------------------- | ------------------------------------------------------------------- |
| `GET /user`, `/accounts`, `/sites`     | HTTP 200                                                            |
| Team                                   | `sandun-rathsara-x-l1zm`, ID `6ade15b8a28a8abc4b504093`             |
| Role/state/plan                        | Owner, active, Free / `credit-free`                                 |
| Credits/top-up/exceeded/trial          | 300; auto-top-up false; exceeded empty; Pro/Enterprise trials false |
| Initial sites                          | 0                                                                   |
| Created site                           | `vamotors-synthetic-dev-sandun`                                     |
| Site ID                                | `f69a4d7e-cf97-4933-91d7-aabd4e66616b`                              |
| Reserved origin (not a running app)    | `https://vamotors-synthetic-dev-sandun.netlify.app`                 |
| Actual `functions_region`              | `us-east-2` (Ohio; docs code `cmh`)                                 |
| Serving                                | Disabled via `PUT /sites/{id}/disable`                              |
| Published deploy / deploys / builds    | None / 0 / 0                                                        |
| Repository linkage / secrets installed | None / none                                                         |
| Final site environment variable count  | 0                                                                   |

Mutation sequence: attempted documented account-slug create route encountered a
transport error; a subsequent site-list check confirmed zero resources. Creation
through `POST /sites` with `account_slug`, site name, `force_ssl:true` and
`build_settings.stop_builds:true` succeeded. Read-back **did not persist**
`stop_builds` on the unlinked site. A separate `PATCH /sites/{id}` with
`repo:{stop_builds:true}` (no repository) returned HTTP 422. Thus do not claim
builds are stopped. Site was disabled and read back as `disabled:true`, with no
published deploy and empty build/deploy lists. No deploy/build creation endpoint
was called. No repository attachment was attempted.

**Linkage blocker:** cannot verify automatic-build prevention before attaching a
repository on this unlinked site. Current Netlify documentation explicitly warns
that linking/relinking activates builds. Site disablement prevents serving but is
not build isolation. Do not use an initial deploy followed by cancellation as a
substitute. The checked-in `netlify.toml` always exits nonzero through the small
build interlock, in every context. It does not retroactively protect the remote
base branch (which lacks it) or manual artifact uploads.

Intended repository: `SandunRathsara/vamotors`; intended shared-development
production branch: `integration/full-v1` (not `main`), currently remote SHA equals
the accepted T00 base. Integration must accept the interlock on that branch before
T02b considers linking. Final default-branch promotion is integration-owned.
Do not enable serving until authenticated T03–T05 and the hosting security gate
are independently accepted. The placeholder is not the G2 working URL.

## GitHub integration and CI/preview isolation design

Fresh `gh api repos/SandunRathsara/vamotors` confirms public, active, default `main`,
admin/maintain/push/pull true. `integration/full-v1` exists remotely at the base.
Readiness supplied no protection/rulesets; no governance changes were made.
`gh api user/installations` returns HTTP 403: current credential is not authorized
for GitHub App installation enumeration. GitHub push permission does **not** prove
Netlify GitHub App installation/repository authorization. No alternate credentials
requested and no broad GitHub token copied to Netlify.

CI design for T02b (not installed/enabled in this slice):

1. Public-repository PR checks use `pull_request`, read-only `contents`, pinned
   action SHAs, locked install, typecheck/lint/unit/build and interlock checks.
   Never `pull_request_target` with untrusted checkout or deployment credentials.
2. No shared-dev DB/R2/auth/deploy secrets in PR jobs, artifacts, caches or logs.
   API/browser integration checks need an explicitly disposable database and
   separate bucket/credentials; **a prefix with shared credentials is insufficient**.
   No implicit default to shared resources. Do not skip browser setup for release.
3. Until isolated resources/auth origins are ready, disable deploy previews and
   branch deploys, not merely their writes. No wildcard R2 origins. Shared-dev
   reset remains unavailable regardless of test flags. No automatic migrations,
   seed/reset, backup or storage actions in install/build hooks.
4. Serialize deployment/migration in a protected deployment lane with explicit
   trusted ref/SHA and human/environment gate. Never execute PR code with cloud
   secrets. Build-time data access must be reviewed: Free cannot be assumed to
   provide paid granular environment scopes. Context-specific values must be
   verified in the actual Free account before relying on them. If unavailable,
   keep previews off/use a separate credential-free site, not an upgrade.
5. Keep Netlify repository/preview triggers stopped and serving disabled until
   intentionally activated. Manual CLI/API artifact deploys bypass stopped builds,
   so do not grant deploy tokens to PR jobs. CI green is not runtime authorization.

## Proposed secret-name contract — request to foundation owner

No values below are committed/installed; these names are a **proposal**, not a
final T01/T03 runtime contract. Foundation owns package/schema changes.

| Name                                                                                            | Intended use / boundary                                                                        |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                                                  | Restricted pooled shared-dev application role; server-only                                     |
| `DIRECT_URL`                                                                                    | Direct migration/backup owner, operator/trusted migration lane only; absent from app/PR builds |
| `BETTER_AUTH_SECRET`                                                                            | Unique shared-dev session secret; finalize name with T03                                       |
| `BETTER_AUTH_URL`                                                                               | Exact accepted HTTPS app origin, not a preview wildcard; finalize with T03                     |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`                                                      | Private server-only object credentials scoped to dev bucket                                    |
| `R2_ENDPOINT`, `R2_BUCKET_NAME`                                                                 | Server configuration; never a public bucket URL                                                |
| `NETLIFY_AUTH_TOKEN`, `NETLIFY_SITE_ID`                                                         | Trusted deploy operator/lane only; site ID is public metadata, token is secret                 |
| `TEST_DATABASE_URL`, `TEST_DIRECT_URL`                                                          | Explicit disposable-test DB names; no fallback to shared-dev                                   |
| `TEST_R2_ACCESS_KEY_ID`, `TEST_R2_SECRET_ACCESS_KEY`, `TEST_R2_ENDPOINT`, `TEST_R2_BUCKET_NAME` | Explicit isolated-test object resource names; no fallback to shared-dev                        |

No `NEXT_PUBLIC_*` credentials. Scheduler secret/name and authenticated invocation
contract deferred to T10/T03. No backup credential or production secret introduced.
Foundation proposal: pin compatible existing-target Prisma/client/adapter/auth
versions; prove interactive transaction rollback over the chosen pooled transport;
avoid unsupported startup parameters; provision a non-owner runtime role with no
DDL or audit update/delete and separate migration ownership. Infrastructure will
install accepted runtime names only after T03 tests establish grants. No dependency
or schema change is requested solely for the Python diagnostic.

## R2: exact later access action, not broader runtime credentials

Readiness supplied signed bucket HEAD/location/list PASS, empty APAC bucket, and
`GetBucketCors` AccessDenied. Those are **inherited facts, not rerun here**. Object
write/read, unauthenticated denial, public-access settings and CORS remain unverified.
The reserved origin now exists but is disabled; do not add CORS until it is the
accepted hosted origin and T06 specifies actual signed headers.

Minimal action at T02b/T06: an existing authorized Cloudflare dashboard operator
opens **R2 → vamotors-dev → Settings → CORS Policy → Add/Edit**, reads the current
policy first, then adds one exact accepted origin with `PUT`, `GET`, `HEAD`,
`AllowedHeaders:["Content-Type"]`, `ExposeHeaders:["ETag"]`, `MaxAgeSeconds:3600`.
Add other request headers only when T06 proves they are sent. No `*`, no automatic
preview/local origins, no `r2.dev` or public custom domain. The same operator
verifies public development URL/custom-domain access is disabled. Preserve any
existing intentional policy; don't overwrite unrelated origins blindly.

Prefer that one dashboard action to broadening the application's object token.
If delegated API management is needed instead, obtain separately approved
bucket-CORS management authorization through private secret delivery; this slice
has not verified a bucket-scoped management permission, so does not claim object
credentials can be safely upgraded. No credential value is requested in chat.
Afterward verify allowed and denied preflights, private unsigned reads and actual
authorized synthetic upload/finalization/download in T06 (writes prohibited here).

## T02b next tasks and operational gates

1. Integration accepts this branch/interlock; T01/T03 contracts and restricted-role
   evidence become prerequisites. Fresh independent reviewer reruns diagnostics.
2. Confirm Netlify GitHub App has access to **only** this intended repository
   (GitHub Settings → Applications → Installed GitHub Apps → Netlify → Configure;
   if absent, Netlify's authorization flow). No account-wide install required.
   This is not yet a user-blocking access demand: first use an authorized operator
   to inspect existing installation state; the 403 only blocks this token's query.
3. Establish a documented/API-supported atomic link with builds stopped, or first
   prove the interlock on the accepted remote branch and obtain explicit approval
   for a blocked build. Keep serving disabled. If strict zero-build linking cannot
   be guaranteed, leave unlinked and escalate, not experiment with deploys.
4. Verify Free context isolation; install runtime-only accepted credentials using
   private delivery; separate migration operator. Add trusted CI configuration
   after foundation selects Node/pnpm/backend versions. Replace the interlock only
   with accepted security/isolation checks; no ambient enable flag in this slice.
5. Apply exact-origin CORS through the operator action above. T06 proves storage
   privacy and writes; T18 proves hosted HTTPS/redirects and unauthorized denial.
6. No automatic pruning of business data/audit/invoice versions. Measure actual
   service usage; warn before exhaustion and stop/escalate rather than pay or delete.
   Before migrations/imports: encrypted direct DB export plus referenced final-object
   copy/manifest to private off-Git independent storage; restore to separate resources
   and prove balances/roles/audit/attachments. Tooling and actual restore remain T18,
   not acceptance inferred from this design. No keep-alive quota-burning probes.

## Local setup and check results

- Live model catalog confirms active `openai/gpt-6.1-sol`; current harness is
  OpenCode, no model substitution or child agents.
- `pnpm install --frozen-lockfile`: PASS in this isolated worktree. No manifest,
  lockfile or workspace changes; earlier offline-install failure is not rerun here.
- Diagnostic self-test: PASS (classification, file permissions and paired endpoints).
- Final diagnostic command above: PASS for both endpoints, IPv4/IPv6 TLS 1.3 and
  expected startup-option rejection. Only read-only transactions executed.
- `node scripts/infrastructure/netlify-build-blocked.mjs`: expected exit 1.
  Parsed TOML command execution also asserted exit 1 and the blocked message;
  there are no context overrides. This is a safety interlock test, not a build pass.
- Final Netlify read-back: disabled true, `us-east-2`, repository absent, published
  deploy absent, builds/deploys/environment variables all zero.
- Browser install: initial `pnpm exec playwright install chromium firefox webkit`
  exceeded a 120-second command bound. A direct pinned CLI invocation, bounded
  180 seconds, reached 100% of Chromium's 165.5 MiB archive but did not finish.
  A narrower `node node_modules/@playwright/test/cli.js install --only-shell chromium`,
  bounded 120 seconds, reached 100% of its 92 MiB archive but also did not finish.
  The installer reported removing an unused Chromium cache; no manual cache deletion
  was performed. No Firefox/WebKit completion was reported. Final executable checks
  for Chromium/Firefox/WebKit were all false; a real Chromium headless launch with a
  10-second deadline failed with missing executable. **Browser provisioning blocked**;
  download progress is not installation evidence. Do not claim browser tests pass.
  Future verifier/operator must complete the pinned CLI install and verify a real
  local headless launch. No browser-setup bypass, browser pane, external website,
  authenticated state or trace used by this task.
- No app build/lint/API/E2E release checks rerun: no app/runtime changes, and this
  slice is not release acceptance. Existing baseline failures remain with owners.
- `git diff --check`: PASS; dependency files unchanged. Only declared infrastructure
  configuration/scripts and this operations report are intended for the commit.

## Current primary documentation

Context7 library resolution + docs queries were used for Netlify OpenAPI, Neon,
R2 and Playwright (nearest indexed 1.59.0; installed package remains 1.59.1).
Official live references checked 2026-10-25:

- [Netlify OpenAPI](https://github.com/netlify/open-api/blob/master/swagger.yml): create/update site, repo fields, `stop_builds`, environment endpoints; granular scopes are Pro+.
- [Stop/activate builds](https://docs.netlify.com/build/configure-builds/stop-or-activate-builds/): linking activates builds; manual artifacts bypass stopped builds.
- [Functions configuration](https://docs.netlify.com/build/functions/optional-configuration/): new-site Ohio `cmh`, custom regions paid; actual API confirms `us-east-2`. No upgrade needed.
- [Neon connection errors](https://neon.com/docs/connect/connection-errors#unsupported-startup-parameter): unsupported PgBouncer startup GUCs; use transaction-scoped settings.
- [R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/): exact browser origins and headers, dashboard policy action; CORS is not authorization.
- [Playwright 1.59 browser install](https://github.com/microsoft/playwright/blob/v1.59.0/docs/src/browsers.md): existing CLI installs binaries, no new package required.
