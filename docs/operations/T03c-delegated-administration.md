# T03c bounded delegated administration

Implementation-owner handoff, **not independent review or acceptance**. Exact base:
`61c0583c3a452073d946053fccbd3b8431fcca91`; accepted policy A1D/A3 remains unchanged.
The parent must independently review the committed candidate. G1/T03 and all 134
features remain unaccepted. The user explicitly authorized bypassing unavailable
GSD entry points for this assignment. No delegation, cloud operations, deployment,
push, PR, schema/package changes or integration-record edits.

## Scope and preservation

- `permissions.ts`: one pure per-field, single-conjunction attenuation proof,
  symbolic arbitrary holders versus trusted grantor/recipient identity, semantic
  reductions and normalized positive grant sets. Different fields may have
  distinct witnesses; no merged predicates, action implication, role hierarchy,
  deny rules, provenance leases or general implication engine.
- `admin.ts`: current actual-record/action and changed-business-field checks;
  creation checks all business fields. Role IDs compare as sets, grant arrays as
  normalized positive sets. Profile/rename-only saves do not require unchanged
  field grants or old authority. Additions/reactivation check recipient and
  reusable-holder authority. Pure removals/reductions/archive have no old-grant
  floor. Protected membership/activation and immutable system-role rules remain.
  Every consumed reference is authorized before state/revision diagnostics.
- Matching receipts enter a separate REPLAY-REFERENCE branch immediately after
  guarded current-actor loading. It authorizes current result/action/id/revision
  and supplied role refs, binds existing-target identities, then checks digest.
  Original result/committed revision and command ID are retained; affected uses
  the current authorized revision. No historical delta reconstruction, execution
  transitions, expected-revision/active-role/last-admin rerun, business/revision/
  audit/receipt writes. Guard generation still advances for synchronization.
- Queries retain scoped SQL before count/filter/search/sort/page, strict query
  keys and required ordering fields. Nested current and historical User.roles
  values also require actual target Role.read fields. Role.grants is independent.
  Audit population is scoped before count/page; each diff and actor link is
  separately projected. Protected admin metadata requires User administration
  and its read field. No global assignee counts were added.
- Registry uses the same proof and existing DTO: unconditional field coverage
  only, with safe narrowing condition grammar; conditional-only fields and empty
  entries are omitted. An account-only delegate gains no Role mutation ability.
  Existing authorized conditional grants remain viewable/editable as JSON.
- Page/sidebar/table/dialog hints use current capabilities, not Administrator
  membership. Forms disable forbidden fields, preserve unchanged required values,
  block incomplete/hidden-grant replacements, and allow independent authorized
  archive. Unreadable values are unavailable, never fabricated inactive/empty
  authority. Server checks remain authoritative for every payload.

Unchanged: auth Activity/portal concealment and identity-discard boundary,
`components/ui/sidebar.tsx` mobile-dialog stacking fix, auth/query-cache hooks,
route inventory and fail-closed unsupported domains; currentActor minimization,
no-store transport and Origin checks; transaction owner, three-attempt SERIALIZABLE
retry, AdminGuard generation UPDATE, DB triggers and final `SET CONSTRAINTS ALL
IMMEDIATE`. Schema/migrations, source versions, package pins/lockfiles, foundation
scripts and retained prototypes are not changed.

The retained production suite now explicitly distinguishes an authorized
User.read/id-only response from full administrative revocation. Its full-revocation
fixture retains an empty role, not a still-readable role. Read denial is404;
registry gate denial403; malformed command after authentication422. Portal/mobile
privacy assertions were not weakened.

## Reproduce on a new owner-isolated local cluster

Prerequisites and private-file semantics are in `T03-local-postgres.md`. Do not use
another worker's directory, default Homebrew cluster, retained user database or
service. The following campaigns must run **serially**, not against concurrent
seed/grant mutations. Setup is the unchanged foundation script.

```sh
pnpm install --frozen-lockfile
pnpm db:generate
export VAMOTORS_LOCAL_DIR="$HOME/.config/vamotors/local-t03c-NEW-REVIEW"
pnpm local:setup
pnpm test:unit
pnpm typecheck
node .planning/implementation/contracts/check.mjs
pnpm exec tsc --noEmit --strict --skipLibCheck --target ES2020 --module ESNext --moduleResolution bundler .planning/implementation/contracts/api.ts .planning/implementation/contracts/api-check.ts
pnpm build
pnpm local:test
node --import tsx tests/security/delegated-check.ts "$VAMOTORS_LOCAL_DIR"
node --import tsx tests/security/production-check.ts "$VAMOTORS_LOCAL_DIR"
node --import tsx tests/security/production-check.ts "$VAMOTORS_LOCAL_DIR" --portals
node --import tsx tests/security/mobile-focus-check.ts "$VAMOTORS_LOCAL_DIR"
pnpm local:stop
```

Each production campaign owns a randomly selected numeric-loopback port, production
Next child and isolated Chromium contexts; it closes its own children. Delegated
tests validate checkout/cluster/URL ownership before migration-role fault fixtures.
Synthetic accounts/credentials stay private. The database is retained, not reset.

## Author checks and private evidence

Private root: `/Users/alpha/.config/vamotors/local-t03c-cc41145b` (0700).
`runtime.env`, `migration.env`, `admin.env`, `accounts.env`, `cluster.env` are
private inputs, never report contents. Evidence JSON/logs contain no credentials.
Each JSON binds Git SHA and dirty status; final clean committed-tree runs supersede
earlier working-tree runs, not historical failures.

- Unit suite: 91 tests / 6 files, including 14 focused attenuation cases.
- Contract specification: 19 checks, plus typed contract regression compile.
- Production build/typecheck and owned-file ESLint/Prettier/diff checks.
- `pnpm lint`: still **FAIL, tracked 3 errors / 27 warnings** in unrelated retained
  prototype/compose-refs code; no silent repair or passing-full-lint claim.
- `local:test`: 10 retained real-DB groups, including two-admin final-loss race,
  direct-runtime backstops and audit/notification/final-constraint rollback/release.
- `t03c-results.json`: delegated production HTTP/Chromium campaign; field-limited
  profile/role rename, multirole credential creation, safe conditional delegation,
  laundering/self-escalation/hidden-ref/registry/field denial, audit projection,
  reductions/removals/archive without old authority or hidden grants, all command
  replay variants, role-edit versus assignment/reactivation, receipt-fault atomic
  rollback, revoke-before-lock execution/replay, pre-change self-reduction and UI
  privacy. Waiters are observed via PostgreSQL locks, not timing sleeps.
- `t03b-production-evidence.json`: retained 10 production UI/API/RSC groups.
- `t03b-portals-evidence.json`: retained 15 privacy groups.
- `mobile-focus-evidence.json`: retained 12 mobile/lifecycle groups.

Earlier author attempts are not counted as passes: the first race observer used
restricted pg_stat_activity wait details and could not see another role's wait;
it now observes public lock metadata. One accidental overlap with the seed-mutating
DB suite made an in-flight synthetic request see an inactive seed administrator;
all final campaigns are serial. Earlier retained production assertions assumed
Administrator-only reads; fixtures/expectations now test the accepted capability
policy explicitly. Private failure logs are retained as historical diagnostics.

## Remaining G1/T03 and required next seams

This is bounded implementation, not self-acceptance. Parent's independent combined
source/UI/API/DB review and explicit acceptance are still required. It does not
unlock downstream features, certify full E6 or complete G1/T03, storage, expiry,
recovery, reporting, imports, exports, notifications or domain authorization.

The next sole-schema-owner slice must add real reciprocal lifecycle evidence,
source-owned payments and the repair/sale/reservation/disposal/approval/rate/
brokerage/reconciliation/import/export/settings graphs and constraints before
loosening `INITIAL_SECURITY / INITIAL_PURCHASE_ONLY`. Domain owners must normalize
actual DTO records/ownership, expand read/write/condition registries and SQL row
scopes, integrate atomic commands/audit/notifications and real concurrency tests.
**Every registry-universe expansion requires deliberate revalidation/migration of
stored wildcard/parent grants, including protected system grants, and review of
attenuation and registry projection.** User/Role condition keys remain empty;
narrower administrative populations need separately reviewed model/contracts.
Complete conditional-template editing needs a separately reviewed DTO, not a
broader grammar masquerading as filtered choices. Local durable files, scheduling,
restore and whole-application journeys remain separate slices; hosted deployment
is deferred and belongs to the user.
