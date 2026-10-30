# T05c.1 open-cycle edits — PREBASE author candidate

Base: exact accepted `ac746b90ce9782fd35635847dff6c1b3ab669618`.
No unaccepted T06b implementation is imported. Migration005 is reserved after
T06b004; the intentional gap does not import004. Registry9→10 on this PREBASE.
Before final handback, parent must supply an accepted T06b combined SHA; rebase,
reconcile its actual registry/dispatcher/grants/imports/attachment history, then
repeat final exact-combination proof (normally actual10→11). PREBASE results are
not final-combination evidence or acceptance.

## Exact commands and authority

Only active command-created open PURCHASED/IN_STOCK CASH/BRAND_NEW supplier
cycles are supported. No sales, repairs, proposals, repurchases or closed cycles
are synthesized. All inputs and selectors are unchanged accepted API contracts.

| Command | Existing expected refs | Actual operational fields |
|---|---|---|
| addMileage | PurchaseRecord + Vehicle at identityRevision | PurchaseRecord.update cycleId, mileage.reading/date and each supplied remark/decreaseReason |
| setListedPrice | PurchaseRecord only | PurchaseRecord.update cycleId, amount and supplied reason |
| editVehicle | Vehicle only at identityRevision | Vehicle.update vehicleId, reason and every actually changed values leaf, including omitted optional clears |

Consumed current physical/history fields require actual root AND Vehicle read
authority. Mileage reads/projected audit values inherit both owners' nested
leaf grants; derived action/revision views confer no write permission. Full
physical correction requires all existing physical fields readable, preserves
unchanged values, and clears omitted optional vin/crNumber/notes to SQL NULL,
without accepting wire nulls. Replay derives original changed leaves from its
immutable audit, never from today's already-corrected values. Initial physical,
mileage, basis and payment evidence remains immutable.

Mileage uses integer0..99999999, purchase..Colombo-today actual dates. Reads and
validation use stable(date,id), checking predecessor and successor across actual
physical history. A backdated entry cannot silently repair an old unexplained
successor decrease; new decreases require nonblank decreaseReason. Zero is real.
Mileage and physical correction each bump Vehicle + current cycle exactly once;
asking price bumps only cycle. Asking price is canonical nonnegative Money
through A maximum, including zero. No cash, basis, cost/payment, Quote or rate
snapshot changes; actual future approval/advance integration remains later.

Physical edit locks sorted old/new normalized identity keys consistent with
recordPurchase, then Vehicle/cycle, after BusinessSequence/current auth. The
composite engine+chassis pair remains the uniqueness rule; punctuation remains,
individual engines are not newly unique, and hidden collision responses contain
no target identity. Same vehicle UUID and source links remain.

## Forward guards and grants

Only NEW `202610300005_cycle_edits/migration.sql` extends acquired Vehicle,
root/cost final-graph and original-mileage guards. Exact initial acquisition
mileage is validated separately from later history. New command-specific
receipt/actor/environment/current-transaction/sequence, exact root deltas,
cardinalities, coherent versions/audits and chronology are mandatory. Existing
money/stock guard bodies are preserved except explicit forward insertion points;
all13 accepted migration bytes stay unchanged. There is no caller GUC or blanket
lifecycle bypass, no new schema column, and no new dependency.

Vehicle UPDATE grants are physical/normalized columns + revision/updatedAt only;
PurchaseRecord adds listedPrice only. Mileage/payment/basis/audit/read history
stays append-only; activePurchaseId/createdBy/ownership remain ungrantable.
Only growing old read/update universes are frozen into exact leaves; old mileage
compound already meant its known DTO leaves, now made explicit. All unchanged
create/delegation/rate/quote universes retain their existing ceiling. Only
protected Administrator deliberately gets new operations. Upgrade proof checks
every old role population, immutable Permission hashes and function metadata.

Four retained unit registry-version assertions advance9→10, and the stock unit's
exact PurchaseRecord.update list adds only amount + four mileage input leaves.
No assertion is dropped, and acquisition's bounded shutdown helper is unchanged.

## Runnable isolated proof

Use Node24, offline frozen dependencies, installed local PG18 binaries and NEW
private roots. Never point these commands at a reviewer/other-author root.

```sh
pnpm install --offline --frozen-lockfile
pnpm db:generate
VAMOTORS_LOCAL_DIR="$FRESH_ROOT" pnpm local:setup
pnpm build
node --import tsx tests/security/cycle-edits-check.ts "$FRESH_ROOT"
```

For genuine NONEMPTY upgrade, create a separate clean source at the supplied
exact accepted parent, generate/setup/build there. Run the candidate's new
upgrade runner against that parent-owned PROJECT:

```sh
node --import tsx tests/security/cycle-edits-upgrade-check.ts "$UPGRADE_ROOT" prepare "$PARENT_SHA"
# Advance only that OWN source to the clean candidate; preserve same cluster/root.
# Generate/build and run setup from that source cwd, without reset/reseed/delete.
node --import tsx tests/security/cycle-edits-upgrade-check.ts "$UPGRADE_ROOT" verify "$PARENT_SHA"
# Repeat setup + verify before lawful new-command campaign writes.
node --import tsx tests/security/cycle-edits-check.ts "$UPGRADE_ROOT" "$UPGRADE_SOURCE"
```

The runner binds the actual parent SHA, PROJECT and clean source; it creates
real nonempty finance/contacts/Settings, rates/Quote, purchase/mileage/stock,
cost/payment/reversal/basis/audit/read/grant history. It compares original rows,
checksums, immutable permissions, role populations, owners/function metadata and
exact runtime-column additions. Accepted T06b attachment bytes/history must be
included when rebased; PREBASE ac has no such workflow to fabricate.

Normal retained costs17 (including P2), rates8, bounded F1, stock16, audit32 and
acquisition15 remain required on appropriate fresh/upgraded roots. Also run full
current generated-client types, units, contracts20, owned lint/format and diff.
Keep stdout/stderr/exit/SHA immediately for every long command, retain all failed
roots and evidence, and stop only owned app/browser/PostgreSQL services. The new
fixture records safe HTTP envelopes/results and process identities, never auth
credentials, session headers or capability headers.

Contributions only: open-cycle VPRC-05/06 and physical VPRC-04/09 subsets. Actual
handover/cross-cycle history, approval/advance snapshots, closed profit30/25,
repair115/report/global cash remain later. No whole IDs/gates promoted:
26 LOCAL/108 U/134; VSTS-03 U; G2–G6 open. Parent/distinct verifier decides.
