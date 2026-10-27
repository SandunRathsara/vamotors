# T05a paid acquisition candidate — author handoff

Base: **7573c54532c5f80edef3d8eaa452720d018f5d1b**, detached clean before implementation. Local checkpoints: `8a23441` (schema/capabilities), `b5bf0a1` (vertical). The returned final SHA and final private runner JSON bind the candidate; this document does **not** accept T05a, a whole requirement, or G2. No contracts, shared acceptance ledger/matrix, old migrations, dependencies/lockfiles, prototypes, shared refs, cloud resources or PRs are changed.

## Delivered source and boundaries

- `lib/server/purchases.ts`: strict `recordPurchase`, `purchases`, `purchase`, `inventory`, `vehicle`, `vehicleIdentity`, and purchase/vehicle audit projection. Separate physical Vehicle ID/revision and PurchaseRecord cycle ID/revision. CASH and COMPANY-only BRAND_NEW create cycle 1 PURCHASED/unavailable, never receive stock implicitly. Duplicate identities conflict rather than overwriting or fabricating a closed cycle.
- `components/purchases/acquisition-workspace.tsx` and the four purchase/vehicle list/detail pages: real persisted reads, active supplier search/select, independent inline supplier creation, zero mileage, optional VIN/CR, exact decimal input, dated full seller payment, actual payment/basis IDs, paging/search URLs, validation/read/denied/conflict/pending states. Uncertain submissions retain the original serialized envelope/key/refs. Stale resolution explicitly reloads/reconfirms and starts a new intent. No offline financial queue or local-storage drafts.
- `components/third-parties/party-detail.tsx`: independently authorized purchase references now navigate to the real detail route. Contribution capability deliberately stays **PENDING_DOMAIN**: the accepted party contract reserves READY promotion for independent review and parent authorization; remaining T05 cycles are not declared complete. Repair/finance contributions remain pending.
- Shared owner edits: schema and two new migrations, explicit local grants, registry/validators/audit/query/command dispatch, `readScope`, route inventory/regression expectations, and the narrow AuthBoundary transient-failure branch. Activity/sidebar structure remains intact. Confirmed logout, revocation, fingerprint/account change still purge private state; a transient verification failure hides but retains Activity/drafts.
- `readScope` now uses `{id:{in:[]}}` for no grants and `{}` for an unconditional grant. Real Prisma 6 testing proved `{OR:[]}` could be dropped inside nested AND and `{OR:[{}]}` could behave as false. Required predicate fields need a covering witness for **every** readable population, including conditional populations, rather than silently shrinking results. Vehicle status scope is resolved through its active cycle. Financial filters/order, links, identity lookup, audit and nested projections recheck their source permissions.

### Schema, constraints and grant inventory

Parent has seven migrations; candidate has nine:

1. `202610270002_purchase_acquisition`: nullable provenance/snapshot FKs only for retained foundation rows; new runtime acquisitions require their command and SettingsVersion. Adds typed immutable **PurchasePayment**, **MileageReading**, **CycleBasisVersion**, correction/reversal linkage, source indexes, immutable initial basis evidence and read-only **CashMovement** view. Deferred graph checks bind full seller OUT, purchase date, source/currency/scale, zero-capable dated mileage, initial basis, status, receipt, audits and both read versions. No writable general ledger or fake backfill cash.
2. `202610270003_purchase_backstops`: physical required/optional checks enforced on new/changed rows (NOT VALID retains old fixtures), immutable owner/new-acquisition roots, required runtime active pointer, exact initial command-owned status event. New acquisitions cannot be edited/received through owner DML or accidental UPDATE grants before a future lawful command migration.

Original `initial_cycle_capability`, `initial_transition`, typed active pointer and one-open-cycle guards remain. Settlement, sold/closed cycles, repurchase and trade-in have **not** been enabled. Historical foundation fixtures remain identifiable by absent acquisition provenance; runtime has no legacy bypass. Existing source history is not replaced by JSON or manufactured payment rows.

Registry v6 adds only implemented acquisition create/read fields. The migration retains every original immutable Permission row/hash, freezes old Vehicle/PurchaseRecord wildcard and compound coverage into the old explicit universe, replaces attachments in a bounded owner migration window, deliberately adds new read/create grants only to protected Administrator, and bumps Role revisions/fingerprints. Persisted permission canonical hashes/grammar are revalidated by the existing setup step; attenuation still prevents old ceilings from delegating new fields.

`scripts/local-runtime-grants.sql` names every SELECT/INSERT column for the new purchase surface. There is **no** new business DELETE, UPDATE, ownership/history update, DDL, default/future-table grant or runtime migration capability. PurchasePayment correction fields are readable but not insertable by runtime in this slice. Existing auth membership/session privileges are unchanged.

One serializable transaction owns receipt, Vehicle/cycle/pointer, payment, mileage, status, basis, field audit, BusinessSequence and EntityReadVersion. Sequence lock precedes AdminGuard/current authorization and sorted normalized identity locks. Final deferred validation runs through the accepted transaction owner. CASH/BRAND_NEW do not require an invented Settings expected ref: server policy is snapshotted under the sequence lock. Finance writes retain their existing real Settings reference/CAS behavior. There is no settlement UI/fixture financier masquerading as implemented settlement.

## Reproduce on an independent private local root

Use the prerequisites and private-file rules in [T03-local-postgres.md](T03-local-postgres.md). The new runner is committed, not an imaginary npm script:

```sh
export VAMOTORS_LOCAL_DIR="$HOME/.config/vamotors/local-t05a-independent"
pnpm install --frozen-lockfile
pnpm db:generate
pnpm local:setup
pnpm local:setup
pnpm build
node --import tsx tests/security/purchase-acquisition-check.ts "$VAMOTORS_LOCAL_DIR"
node --import tsx tests/security/settings-finance-check.ts "$VAMOTORS_LOCAL_DIR"
node --import tsx tests/security/settings-writes-check.ts "$VAMOTORS_LOCAL_DIR"
pnpm local:stop
```

Run DB-mutating campaigns **serially per root**, with generous process timeouts; they deliberately add/remove constraints, revoke grants and restart their own DB/app. Each runner owns its production Next process and Chromium contexts, closes them, and retains synthetic database rows. Never reuse another worker's root or reset/reseed to hide a failure. `local:dev` is the actual runtime-only loopback start command; it does not migrate/reset. Human credentials remain in that installation's private `accounts.env`, never in this document/chat. Production test origins are loopback ephemeral ports, recorded in the purchase evidence; no long-running server is promised after runner cleanup.

### Genuine exact-parent upgrade (not fresh setup dressed as upgrade)

The author installed an actual archive of exact base `7573c545...` in `/private/var/folders/gb/j8pkyq8j0rd50dzkps44xgh40000gn/T/opencode/t05a-exact-parent-3240`, using its seven migrations/bootstrap/registry/grants and an off-Git private root. The shared already-installed node_modules was linked; no dependency source changed. Before overlay/deploy, run from the candidate checkout:

```sh
node --import tsx tests/security/purchase-upgrade-check.ts <private-upgrade-root> prepare
```

This asserts seven applied migrations/no payment table and installs retained synthetic Settings, finance policy/contact, supplier/contact, customer, open Vehicle/purchase, audit/read-version/receipt and custom old wildcard/compound/delegation-ceiling evidence. `t05a-parent-before.json` inventories original rows, hashes, grants and migration checksums. Overlay the **committed candidate archive** onto that same parent source directory and run its `local-postgres.ts setup` with the same root/PROJECT marker. Do not initialize another environment or seed. Then from the candidate checkout:

```sh
node --import tsx tests/security/purchase-upgrade-check.ts <private-upgrade-root> verify
```

It verifies nine migrations, unchanged seven checksums and every retained original row/key/value/hash, frozen custom ceilings, deliberate Administrator expansion and zero fabricated purchase payments. Repeat setup/verify: no new historical mutations. `t05a-upgrade-after.json` includes current source SHA and full grant inventory.

## Author evidence and provenance

Owned roots (private files are paths, not public credentials):

- `/Users/alpha/.config/vamotors/local-t05a-3240-fresh`: fresh/repeated setup, purchase runner, finance/Settings, foundation DB security, app/DB restarts.
- `/Users/alpha/.config/vamotors/local-t05a-3240-upgrade`: genuine exact-parent pre/post inventories, retained graph and repeat-upgrade proof; source PROJECT is the archive above.
- `/Users/alpha/.config/vamotors/local-t05a-3240-regressions`: separately initialized affected-regression installation.

Purchase runner writes `purchase-acquisition-<run>.json`: HEAD, dirty flag, test origin, each passed group, synthetic cycle IDs, migration checksums and exact runtime column-grant inventory. Scenarios include actual UI cash/second-account detail, COMPANY brand-new/max money, >32-bit amounts, zero mileage/VIN/CR omission, canonical/bounds/enums/dates/extra-field rejection, missing/wrong/duplicate/stale refs, exactly-once/same-key/different-key identity races, table-by-table essential-write/final-constraint rollback and same-key recovery, direct DML/history/DDL/DELETE denial, real committed response loss after another account changes supplier data, financial API/audit/RSC/predicate projection, explicit stale UI recovery, current field/record/grant denial, policy snapshot race, locked execution/replay revocation, archived supplier history/new-selection rejection, inline supplier keyboard/mobile/transient-auth retention and app/DB restart durability.

The concrete financial proof is **purchase100 → initial basis100 and one OUT100 on the actual purchase date**, seller/settlement outstanding0; listed150 changes neither cash nor basis. No invoice, lender receipt, settlement, repair, cost, sale or repurchase profit was invented. Extra-cost/repair115 proof is not claimed.

Affected real production campaigns executed during implementation: finance15, party17, customer15, customer response-loss6, Settings writes16, administrative production10, portal lifecycle15, mobile-focus12 and redacted-user7; foundation real-DB security10. Final fresh checks also cover 115 unit tests, contracts19, strict five-file contract compilation, existing5 + reviewed3 executable roundtrips, typecheck/build, owned lint/format and diff checks. Exact final-head reruns and artifact names are returned separately rather than writing a self-referential SHA into this file.

Failures/retries are retained, not counted as passing runs: initial schema one-to-one composite validation was corrected; production tests exposed CASL candidate reuse and Prisma scope-composition bugs, fixed in source. The expanded administrative inventory initially assumed old blanket statuses/missing selectors and was updated for the new real query seams. One reused-root party run passed its17 groups but failed synthetic-staff restoration; an independently fresh regression-root run passed including cleanup. A concurrent finance run missed its stale-create UI observation; a serial regression-root rerun passed all15. A 120-second Settings campaign invocation timed out near restart/setup; a serial 300-second invocation passed all16. Source/migrations were never reset to manufacture success.

Full repository lint is unchanged **3 errors / 40 warnings**, explicit G6 debt (`app/api/cash-flow/prototype.ts`, `lib/compose-refs.ts`, existing warnings). Owned lint is separate; no baseline prototype repair is claimed.

## Remaining independent criteria and next bounded slice

- Independent reviewer must bind the returned clean SHA and reproduce its own fresh/upgrade/production evidence. Author results alone cannot authorize READY, accept T05a, promote any of134 IDs, or move a gate.
- **T05b:** actual receive/hold/release; lawful settlement graph/institution variants/positive component payments/outstanding/corrections; dated costs/mileage append/listed-price/reasoned edits and correction reads. Replace narrow immutable acquisition restrictions only when the corresponding real commands, grants and constraints are installed/tested; never disable all initial protections.
- **T05c:** real sale completion/immutable original basis/profit before repurchase; real linked noncash source-sale/customer trade-in. One physical identity/new purchase cycle, no fake SOLD fixture presented as runtime proof. Repair/reservation/finance/DO/full ten-state availability closure remains T08–T10 work.
- **G2 pending:** this contributes real two-account persisted acquisition, local origin/session, restricted runtime, restart and private-login setup evidence. Whole local T02–T05 scope, private file storage/recovery, complete purchase workflows, independent review/parent adjudication and the eventual human run handoff remain. No cloud/hosted/deployment or whole-app acceptance is claimed.
