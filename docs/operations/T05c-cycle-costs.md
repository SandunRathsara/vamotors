# T05c cycle costs and bounded corrections — author candidate

Original accepted dispatch base: `b7ac9afb85218e7ec7fbaa0b006d0b165a19b3c3`.
Required final accepted rates base: `e9ba1a939667fc46178f89cccae1022a4bbcfb7e`.
The clean prebase commits were rebased onto that exact parent-supplied base.
Branch: `feat/t05c-cycle-costs-prebase`. This is author work, not acceptance.
Sole schema/registry/grants/dispatcher ownership remains with T05c; T11a stays
frozen. Parent acceptance of bounded LBRK-01–05 raises effective coverage to
26 LOCAL/108 U/134; this candidate promotes no further requirement or gate.

## Implemented bound

Only open, active, command-created CASH/BRAND_NEW supplier cycles in PURCHASED
or IN_STOCK support these commands. Existing strict DTOs remain unchanged.

| Command                 | Actual record actions and exact business field paths                                                                                                                                                                                                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| addCost                 | PurchaseRecord.update `cycleId`; VehicleCost.create `cycleId/category/description/amount/incurredDate`. Optional actual payment additionally PurchaseRecord.pay `cycleId` and VehicleCost.pay `payment.amount/date/method/reference?`.                                                                                                           |
| editCost                | PurchaseRecord.update `cycleId`; actual VehicleCost.update `costId/category/description/amount/incurredDate/reason`.                                                                                                                                                                                                                             |
| payCost                 | PurchaseRecord.pay `cycleId`; VehicleCost.pay `costId/payment.amount/date/method/reference?`.                                                                                                                                                                                                                                                    |
| editPurchase            | PurchaseRecord.update `cycleId/reason/patch.purchaseDate?/patch.purchasePrice?/patch.notes?`; explicit corrections additionally PurchaseRecord.pay `cycleId/cashCorrections.paymentId/cashCorrections.reason/cashCorrections.replacement.amount/date/method/reference?`. Existing Vehicle read/CAS is mandatory even without an identity change. |
| payPurchase             | PurchaseRecord.pay `cycleId/recipient/payment.amount/date/method/reference?`; SELLER only, strictly capped by true corrected outstanding.                                                                                                                                                                                                        |
| reversePayment PURCHASE | Actual PurchaseRecord.pay `sourceType/sourceId/paymentId/reason/replacement.amount/date/method/reference?`.                                                                                                                                                                                                                                      |
| reversePayment COST     | PurchaseRecord.pay `cycleId`; actual VehicleCost.pay on those same source/payment/replacement paths.                                                                                                                                                                                                                                             |

All commands require currently readable owning cycle ID/revision and Vehicle
ID/identityRevision; child commands require actual cost ID/revision. Payment
commands additionally require their consumed financial read fields. References
come from current purchase detail, not guessed receipts or stale revisions.
The server resolves cost/payment owners from FKs, locks Vehicle then cycle and
child, and checks each resolved current ref before execution. Replays reauthorize
current actions/fields and return original receipt identity/committed revision
with authorized current affected refs, without rerunning execution state/CAS.

Costs are incurred liabilities, not payments. Purchase100 + unpaid cost5 is
basis105/cashOut100/outstanding5. Pay2 gives basis105/cashOut102/outstanding3.
Zero/unpaid costs create no payment row. Payment-only changes never append basis.
Cost add/edit and purchase-price changes append immutable superseding basis
versions with same-cycle component snapshots. Listed price is independent.

Cost reductions below net paid reject without effects. There is deliberately no
`editCost.cashCorrections`: explicitly reverse/correct payment, commit, reload,
then reasonedly edit cost with fresh refs/key. A failed second command leaves
the first truthful correction committed, never an implied atomic refund.

Payment correction appends one exact opposite fact at the original actual date,
same amount/method/reference/currency/source, plus an optional distinct positive
replacement. Same-source FKs, unique reversalOf, command/line identity and caps
prevent cross-source, reversal-of-reversal and double reversal. Replacement
line keys bind the original payment; its command also contains that original's
opposite fact. Accepted DTO commandId/reversalOf/reason expose the correction
lineage without inventing wire fields. This is accounting correction, not proof
that cash was physically refunded. Original acquisition payment/date, first
basis and original read/audit versions remain immutable.

## Source and schema map

- `lib/server/purchases.ts`: strict bounded handlers, trusted FK/CAS/lock/replay
  resolution, source cash/basis calculations, nested independent cost/payment
  projection, audit reason/value masking, coherent cycle/Vehicle versions.
  Duplicated post-acquisition basis reasons inherit the same current source-field
  checks as audit reasons; an amount-only reader cannot recover a hidden cost
  description/reason through basis history. Immutable initial generic reason
  remains separately readable under its original field grant.
- `lib/server/{validators,permissions,queries}.ts`: exact accepted inputs,
  registry/read/audit dispatch. No shared transaction/auth/idempotency primitive
  or dependency changes.
- `app/api/v1/commands/[name]/route.ts`: six named command registrations only.
- `components/purchases/cycle-costs.tsx`: real forms, read IDs/refs, actual dated
  facts, two-step correction explanation, retained original uncertain envelope,
  explicit stale reload/reconfirmation. Narrow detail wiring in
  `components/purchases/acquisition-workspace.tsx` reaches both existing pages;
  no route/shell/PWA/assets/packages/contracts changes are needed.
- `prisma/schema.prisma` and new allocated
  `202610300002_cycle_costs_corrections/migration.sql`: PurchaseRecord.notes,
  typed VehicleCost/CostPayment, exact reversal FKs and append-only money,
  superseding incurred basis, one COST union branch in CashMovement.
- `scripts/local-runtime-grants.sql`: PurchaseRecord UPDATE additions exactly
  `purchaseDate/purchasePrice/notes`; VehicleCost UPDATE exactly
  `category/description/amount/incurredDate/revision/updatedAt`. Old six stock
  UPDATE columns remain. New cost and cost-payment SELECT/INSERT are on named
  current tables only; reversal/reference/reason and supersedes INSERT columns
  are added to existing immutable payment/basis tables. No Vehicle UPDATE,
  business DELETE/TRUNCATE, DDL/owner/default-future grants.

The original eleven migration files remain byte-identical. Acquisition proof is
validated from immutable initial versions separately from corrected current
terms. Stock graph validation still runs for stock deltas; unchanged-lifecycle
money commands have their own exact command/actor/environment/sequence/current-
transaction root/child/audit/version/final graph checks. There is no caller GUC,
generic ledger, bypass, dropped lifecycle guard or fabricated repair/sale.

**Final registry v8 -> v9 / eleven -> thirteen migrations.** Every stored old
wildcard/compound/create/delegation ceiling is frozen before exposing new paths;
Permission originals are never overwritten. Existing payment/basis compounds
freeze to their already-defined leaves; old always-empty costs authorize no new
cost leaves. Only protected Administrator deliberately receives the new rules.
Accepted RateSheet/Quote create/read universes and condition mappings remain;
their v8 wildcard/compound/delegation ceilings freeze too. All Role revisions
change, current fingerprints invalidate, hashes/grammar are
revalidated by setup. Fresh bootstrap uses current registry.

## Reproduction and evidence

Use only a new owner-private root outside Git. No cloud credentials are read.
Installed PG18 binaries and the existing local runbook/scripts are used.

```sh
pnpm install --offline --frozen-lockfile
pnpm db:generate
export VAMOTORS_LOCAL_DIR="$HOME/.config/vamotors/t05c-isolated-review"
pnpm local:setup
pnpm local:setup
pnpm build
node --import tsx tests/security/cycle-cost-check.ts "$VAMOTORS_LOCAL_DIR"
node --import tsx tests/security/rates-check.ts "$VAMOTORS_LOCAL_DIR"
node --import tsx tests/security/rate-xid-epoch-check.ts "$VAMOTORS_LOCAL_DIR"
node --import tsx tests/security/stock-receipt-check.ts "$VAMOTORS_LOCAL_DIR"
node --import tsx tests/security/stock-audit-check.ts "$VAMOTORS_LOCAL_DIR"
node --import tsx tests/security/purchase-acquisition-check.ts "$VAMOTORS_LOCAL_DIR"
pnpm test:unit
pnpm typecheck
pnpm lint
node .planning/implementation/contracts/check.mjs
pnpm local:stop
```

The dedicated campaign exercises real production sessions/two accounts,
1920/360px keyboard UI, active application service worker, zero/unpaid/partial/
full costs, exact reversals/replacements, purchase corrections/outstanding,
strict negatives, missing/stale owner refs, same/different-key pay and edit/pay
races, observed-lock revocation for execution/replay, actual lost committed UI
response, SW-aware failed reload and explicit reconfirmation, essential-write
fault rollback/exact-key recovery, financial/child/audit privacy, runtime ACLs,
logout/revocation draft purge and app/DB restart. It owns/stops its app/browser;
the root PostgreSQL remains for explicit stop. Private JSON evidence records
source SHA/dirty state, group inventory, migration checksums and column grants.

Retained old runner assertions are not removed: only the two newly supported
commands' malformed-body checks change 404 -> 422, stock nextActions checks the
stock subset, and unit registry/correction expectations advance deliberately.
All stock16 assertions and SW-aware routing remain; no old pass is inferred.

### Genuine accepted-parent upgrade

1. Own a separate clean source worktree at exact e9ba1a9; install its own client,
   setup a new private root, and build **that exact parent**.
2. From candidate source run
   `node --import tsx tests/security/cycle-cost-upgrade-check.ts <root> prepare`.
   The runner verifies parent SHA/clean state, launches the real parent app and
   uses real HTTP commands for nonempty finance/contact/policy/customer/supplier/
   contact/purchase/payment/status/basis/audit history, actual published rates,
   cards and selected immutable quotes, and v8 rate/quote grant ceilings.
   It retains `t05c-parent-before.json`; it never fabricates missing finance data
   or substitutes empty-array equality for nonempty proof.
3. Move only that owned source worktree forward to the committed candidate,
   preserving its private root/PROJECT marker. Generate its own client; run
   setup there. From candidate run the same runner with `verify`.
4. Repeat setup from **that source worktree cwd**, then verify again without
   delete/reset/reseed. Comparison covers all prior checksums/rows/owners,
   original Permission hashes, frozen nonadmin populations and exact grants.
   The new nullable notes column is the only old-root shape addition. New cost
   tables must still be empty before subsequent lawful-command campaigns.

Development evidence (not frozen-source acceptance): initial five financial/UI
groups passed; extended thirteen-group campaign passed in
`t05c-author-prebase-dev2/cycle-cost-f509e24f.json`. The first development root
retains a SQL syntax attempt and a deferred heterogeneous-record field error;
the trigger table-specific branch was corrected before a new fresh install.
Later exact committed checkpoint evidence is supplied in the handback manifest.

The first clean checkpoint `7aab008` passed the expanded 17-group fresh campaign
(`cycle-cost-87f64846.json`). Its separate nonempty upgrade correctly exposed an
ambiguous Administrator-rule SQL variable; that migration transaction rolled
back. The replacement uses the already-declared unambiguous replacement value.
The failed attempt/root is retained, and both fresh and upgrade proof must bind
the replacement migration checksum/SHA rather than inheriting the earlier pass.

## F1 forward correction and final verification boundary

Parent assigned independent T11a review finding F1/P3 to the current sole owner.
New forward migration `202610300003_rate_xid_epoch_guard` replaces only
`rate_graph_guard`'s `c.xmin::text=pg_current_xact_id()::text` with
`c.xmin=pg_current_xact_id()::xid`, matching accepted stock width normalization.
The accepted rates001 migration is not edited. CREATE OR REPLACE retains the
function's identity/owner/ACL/options and every other guard byte. PostgreSQL18
documentation was fetched with ctx7: [transaction identifiers](https://www.postgresql.org/docs/18/transaction-id.html)
and [transaction information functions](https://www.postgresql.org/docs/18/functions-info.html)
confirm 32-bit xid, epoch-bearing xid8, and the supported cast.

`rate-xid-epoch-check.ts` contains one focused read-only width-wrap expression,
compares the stored function body to the accepted body with only that expression
changed, publishes a real lawful same-transaction card over HTTP, denies a late
card append and preserves prior quote bytes. This is **not** a simulated/forced
cluster epoch or actual post-wrap workflow. F1 is source-corrected here; fresh
independent verification remains pending.

Final proof must use new own roots/source at exact e9ba1a9, eleven original
migrations and NONEMPTY original rates/cards/quotes plus existing business and
grant history. Upgrade that same retained cluster through costs002 and F1-003,
repeat setup/verify without deletion/reseed, run final rates8/costs/stock16/
audit32/acquisition15 and affected checks, then stop only owned services.
Historical prebase passes are not final-SHA evidence, and no lower-numbered
rates migration is retrofitted into a prebase installation to fake upgrade proof.

Contributions only to VPRC-07/09, FINT-01/03, AUDT-01/02; no whole IDs/gates are
promoted. Original purchase100+repair10+cost5=115, two completed purchase-cycle
profits, repairs/sales/closed restatements/settlement/repurchase/mileage/listed-
price/full physical edits remain queued. VSTS-03 remains U until actual lawful
buyer-commitment integration in T09/T10; unsupported commands are not evidence.
Independent verifier and parent acceptance remain mandatory. No push, PR,
deployment, cloud/default/protected-ref changes or fabricated GSD execution.
