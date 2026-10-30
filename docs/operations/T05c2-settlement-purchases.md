# T05c.2 settlement purchases — author operations

## Status and source boundary

Work in progress, **not accepted and not a final combined handback**. Author session
`ses_e724e8803ffegV2I6w3qrj9OZS` owns this isolated slice. Base is parent-accepted
`55564b5d25983c8de44980362a4c30d6e0e15cc1`, tree
`eba1648a2bfb3db637de1728104214f19a1d60a6`. Parent accepted that exact combined
T05c.1 closure; runtime campaigns ran at 522d26c, with independent runtime-byte
equivalence and test-format verification at 555, not runtime reruns at 555.
Branch `feat/t05c2-settlement-purchases`, worktree
`/Users/alpha/Developer/Personal/vamotors-t05c2`.

Actual accepted inventory is 15 migrations / registry v11 / 16 subjects / 51
actions. This slice adds only **202610300006_settlement_purchases**, yielding
16 migrations / registry v12. All 15 accepted migration files and the migration
lock remain byte-identical, including 005. The original prebase branch remains
at `da56e95760f352280000cb15d1f1d1f761146016` unchanged, with its three stopped
roots and sealed failure history. New final fresh/upgrade proof remains required.

## Runtime behavior and files

`lib/server/validators.ts` strictly discriminates the three acquisition channels
and the finance-company/bank/private-party settlement variants. Settlement
creation has no purchasePrice or extra payment/notes object. Components are
canonical minor strings, each <= A; derived purchase and incurred basis use C.
Only positive components become OUT facts, on the common purchase date/method.
The new purchase remains PURCHASED/unavailable; existing receipt/hold/release
are separate commands.

`lib/server/purchases.ts` extends the existing command transaction, current
authorization, expected refs, idempotency, cost/basis, payment/reversal, version
and audit seams. Both recipient liabilities are capped independently. A payee
change cannot relabel live credit: original payment context is resolved from
the immutable PurchaseRecord version at that payment command's actual business
sequence. Reverse old facts, edit terms, reload, then pay the intended recipient
with a fresh intent. A replacement has no recipient field and retains category.
No loan, quote, sale, lender receipt or second cash ledger is created.

`prisma/schema.prisma` adds the typed unique-owned LeasePurchaseDetail. 006
extends the existing final-graph functions with asserted, narrowly targeted
changes so unrelated stock and cost proofs remain present. It widens only
derived PurchaseRecord.purchasePrice/CycleBasisVersion.purchase storage to C;
cash/brand-new and entered detail components stay A-bounded. Detail is current
terms, governed by the root revision. Leaving lease omits current settlement;
it never deletes the retained detail, initial graph, original cash or versions.
CashMovement still has one PURCHASE branch.

`lib/server/permissions.ts` adds only PurchaseRecord settlement/correction leaves.
006 snapshots all actual accepted v11 universes and conservatively reattaches replacement
rules without modifying immutable Permission records/hashes/conditions. It
preserves compound gates, including ImportBatch.uploads and Document.target;
it does not flatten unchanged compound authority into leaves. Only protected
Administrator deliberately gains new capabilities. Runtime grants add named
supplier/channel and detail columns; no owner/source-kind/DELETE/TRUNCATE/DDL
or future default privilege is granted.

`lib/server/parties.ts` exposes READY settlementPurchases from genuine immutable
company assignments, with independently scoped source/company field checks.
Other absent domains stay PENDING_DOMAIN. Audit historical names are authorized
against their original typed party, not laundered through today's FK.

The real UI seams are `components/purchases/acquisition-workspace.tsx`,
`cycle-costs.tsx` and their shared `settlement-fields.tsx`. They retain the
existing same-body retry, explicit stale reload/reconfirmation, auth-revision
and logout draft lifetime. Company/supplier refs come from current typed queries;
hidden/unreadable values are unavailable, not guessed. Legacy
`lease-settlement-tab.tsx` and `/api/purchases` are not used.

## Owned local state and receipts

Author receipts are private, outside Git:
`/Users/alpha/.config/vamotors/t05c2-author-20261030/evidence/`.
Each `run.py` receipt records start/end, exact HEAD/CWD/command, separate stdout
and stderr, and immediate exit status. It also preserves exact 1ee brief/proof
map/HANDOFF/orchestration/local-completion blobs. No ledger/matrix was edited.

An early setup-only development root
`/Users/alpha/.config/vamotors/t05c2-prebase-fresh-20261030` was initialized while
the forward migration was being written. It is retained and stopped, not reused
as fresh-final or upgrade proof. No business fixtures were claimed there.
Do not adopt, reset or delete any existing root. Every later owned destination
must be checked absent before creation; setup/stop also verifies PROJECT and
the private cluster identity. Use Node 24, native PG18, numeric loopback, private
file storage and generated off-Git credentials. Review capacity policy against
actual usage; never automatically renew review dates.

Initial development checks retained failures: first typecheck found union
narrowing/DTO issues; unit runs found old exact-version/unsupported-slice
assertions plus a test file-URL harness issue; the first build found a test
inference error. Corrections retain the original v9 universe hash and old
security invariants, explicitly extending supported seller/channel assertions
rather than removing their coverage. These failures are not passing evidence.

## Reproducible checks

### Resumed diagnosis and accepted-parent fixture

Private resumed receipts: `/Users/alpha/.config/vamotors/t05c2-resumed-20261030/`.
The exact-555 cash reproduction at `20261030T174539356540Z` reached C and returned
500 at C+1; unconditional whole-graph snapshots were equal. A real authenticated
direct-command probe at `20261030T174643371135Z` captured the actual
`RangeError("MONEY_OVERFLOW")` stack at shared incurred-basis `sum(..., C)`.
The new application guard raises existing `CommandError` 422 at that shared
branch for addCost/editCost/price changes; no public-error catch-all or database
cap relaxation was added. Original prebase failure evidence remains intact.

The first resumed parent fixture attempt at root `t05c2-555-parent-20261030`
failed because its old dispatcher string detector skipped accepted cycle edits.
That root is retained as development history, never final-upgrade proof. The
corrected NEW root `t05c2-555-parent-final-20261030-01` prepared successfully at
exact 555 with real P2, zero/declining mileage, physical/asking corrections,
finance/rates/quotes, scoped file readers and FINAL CSV plus XLSX. It has not yet
completed candidate upgrade/repeat proof. No old root was emptied or reseeded.

Run only in this worker's owned, isolated source/root:

```sh
pnpm db:generate
pnpm build
pnpm typecheck
pnpm test:unit
node .planning/implementation/contracts/check.mjs
node --import tsx tests/security/incurred-basis-check.ts "$VAMOTORS_LOCAL_DIR"
node --import tsx tests/security/settlement-purchase-check.ts "$VAMOTORS_LOCAL_DIR"
```

The settlement campaign writes incremental private, hash-sealed manifests,
retains failures/data, and stops only its own app/browser children. It includes
real SQL, authenticated HTTP, mobile/desktop UI, activated SW response loss,
CAS/races/current revocation, fault rollback, exact-key recovery and authentic
final-file bytes across app/PG restart. Stop the owned PG separately at final
handoff with the verified PROJECT/root. Retain all DB and file bytes.

The **new** upgrade runner takes an explicit parent, never the old costs
runner's hardcoded e9:

```sh
node --import tsx tests/security/settlement-purchase-upgrade-check.ts "$UPGRADE_ROOT" prepare "$EXACT_PARENT_SHA"
# Advance that same owned clean PROJECT from the actual parent to candidate,
# apply committed migrations/restricted grants without reset/reseed, then:
node --import tsx tests/security/settlement-purchase-upgrade-check.ts "$UPGRADE_ROOT" verify "$EXACT_PARENT_SHA"
# Repeat setup and verify without altering the retained preparation.
```

Prepare requires clean PROJECT at exactly the supplied parent, inventories its
real registry/migrations, builds genuine nonempty finance/contact/settings,
purchase/cost/reversal/basis, rate/quote, grants and final attachment history
through the real parent app. When present it also exercises accepted mileage,
listed-price and identity commands. Verify preserves every old business row,
old migration checksum, immutable rule, owner/function ACL and nonadmin ceiling,
including compound gates, and obtains new authorized HTTP download bytes.
Do not run parent preparation on the candidate or use markers/empty arrays as
proof. A changed source requires affected checks again, bound to the new SHA.

Normal retained regression campaigns remain required: costs17/P2/F1, rates8,
stock16, audit32, acquisition15, attachment18 and accepted cycle edits when
available. Final build/types/units/contracts/SW/owned lint/format and upgrade
results must be recorded against the exact clean final source, not this WIP.

## Contribution and remaining scope

Contributes real VPRC-02 settlement and VPRC-09 open supplier/channel corrections;
preserves open-cycle cost/basis/privacy and accepted uploads. This is not whole
T05/T06/FINT acceptance. Customer-as-seller requires actual future trade-in sale
history; closed-cycle restatement/profit/invoice, repairs115/full breakdown and
reporting, genuine two-cycle profits30/25 and full dated business cash reports
remain with their original tasks. No fake sold/repair history was added.

No public contract edit, cloud operation, human G2 root/URL8000 access, push/PR,
deployment, primary/default-branch change, self-acceptance or count/gate decision.
Counts remain 26 LOCAL / 108 U / 134; VSTS-03 U; G3–G6 pending.
