# T05b receipt, hold and release — implementation handoff

Author candidate, not independent acceptance. Exact dispatched base:
`db2580dd7fa722489c591f3f9ed8ed0ea4d26a72`. Local detached commits only;
the final returned SHA binds this runbook. Contracts/ledger/matrix, previous nine
migrations, dependency pins/lockfile, authentication Activity/sidebar and the
parallel T06a private-files subtree are unchanged.

## Bound and capability map

Only `receiveStock`, `holdStock`, `releaseStock` are added to the existing POST
command dispatcher. Accepted strict envelopes and PurchaseRecord expected CAS
are used; no invented Supplier/Settings/Vehicle expected dependency. Server FK
resolution supplies the linked physical root. Runtime cannot edit that root.

| Command              | Current actual-record capability / exact business fields    |
| -------------------- | ----------------------------------------------------------- |
| receiveStock RELEASE | PurchaseRecord.receive: `date`, `disposition.kind`          |
| receiveStock HOLD    | Above plus `disposition.reason`                             |
| holdStock            | PurchaseRecord.update: `reason`                             |
| releaseStock         | PurchaseRecord.release: `cycleId` (the sole accepted input) |

Both roots require current readable IDs/revisions (Vehicle `identityRevision`).
Every replay checks current actor/session/action/consumed fields and result-root
reads, then compares the original envelope digest. It returns the original
command/result/committed revision, with authorized **current** affected refs.
It does not rerun old state or CAS tests. A new unchanged hold/release intent
returns `409 INVALID_STATE` without effects; an exact committed retry replays.

Received date is Gregorian, purchase-date through Colombo today inclusive.
Receipt requires open active PURCHASED. Hold/release require open active
IN_STOCK. HOLD records a trimmed 1..2000-character reason; RELEASE clears it.
Every mutation appends a truthful StatusEvent (same-state for hold/release),
field audits and both view versions. It never creates another acquisition,
payment, mileage reading or basis version. Purchase100 remains OUT100/basis100;
listed150 remains independent. Cycle CAS increments once; identity CAS does not.
Vehicle read-version **revision** remains the physical revision while its DTO
payload exposes the newly changed cycle/view revision, matching the contracts.

## Database and permission evolution

New migration: `202610270004_stock_receipt` (nine → ten). No new money model,
fake commitment/history row, generic ledger, bypass flag or schema-model change.

- Acquisition terms/ownership/date/currency/basis/payment/mileage stay immutable.
  Initial provenance is checked separately from current receipt state. Archived
  or subsequently edited suppliers do not strand an existing acquisition.
- Deferred stock graph checks bind the actor, command, environment, increment,
  BusinessSequence, active pointer, status event, exact field diff and both
  read versions. Required evidence must belong to the current transaction.
  Current linked supplier presentation is validated against its actual row;
  old historical version payloads are never rewritten.
- The stock status trigger alone uses SECURITY DEFINER to read root `xmin`,
  with schema-qualified objects and `search_path=pg_catalog,pg_temp`; runtime
  receives no whole-table/system-column read or arbitrary function authority.
  Native xid8→xid casts preserve the transaction-ID epoch/wrap distinction.
- Original initial-cycle capability, one-open-cycle, typed pointer and physical
  identity guards stay in force. Settlement, terminal/repair/commitment edges,
  corrections, repurchase and trade-in remain fail-closed.
- Runtime UPDATE additions are exactly PurchaseRecord `status`, `available`,
  `holdReason`, `receivedDate`, `revision`, `updatedAt`. No Vehicle UPDATE,
  ownership/history/DELETE/DDL/default/future-table grant is added.
- Registry v7 adds only the three implemented operations above. The migration
  retains immutable Permission originals, freezes old wildcard/compound read
  **and create** populations into v6 leaves, preserves conditions/delegation
  ceilings, deliberately appends explicit new protected-Administrator grants
  and bumps Role revisions. Setup revalidates canonical rule hashes/grammar;
  fresh bootstrap also uses explicit new operation fields.

Transaction order: Environment check → BusinessSequence row lock → AdminGuard
generation/current actor → physical Vehicle advisory lock → cycle row lock →
actual-record/field/CAS/state checks → atomic evidence and mutation. The shared
serializable transaction owner retains bounded retries and forces all deferred
constraints inside the callback. No physical UPDATE privilege is needed merely
to synchronize a cycle projection.

## Production reads and UI

Existing purchase/vehicle detail and list routes use persisted queries, show
received/status/availability/hold/CAS and expose only current authorized actions.
Inventory filters/sort/search/paging round-trip through URLs. Identity predicates
consume only make/model/engine/chassis leaves on their relevant roots, never
restore old wildcard/compound ceilings. Record scopes precede counts/order/page;
financial fields retain independent projection in JSON, RSC and audit.

Stock audit `reason` duplicates the source `holdReason`; it therefore requires
both AuditLog reason-read and current actual-record source-field read authority.
Vehicle audit additionally inherits PurchaseRecord source authority. This is
read-time projection only: stored reasons/diffs are never rewritten. Authorized
historical hold diffs remain readable after a changed hold or release clears the
optional current reason. Both stock-input paths use this same query boundary.

The stock form lives outside the conditional query-result subtree: transient
observer/read resets cannot unmount its pending envelope. Original serialized
body/key/refs remain frozen across response loss, refetch and transient auth;
stale reload/review/reconfirmation is explicit and creates a new intent only
after confirmation. Confirmed identity/grant/logout changes discard private
drafts through the existing AuthBoundary. No local/session-storage draft queue.
Desktop1920, mobile360 and keyboard confirmation are exercised by the runner.

## Reproduce — isolated roots only

Prerequisites/private-account delivery: [T03-local-postgres.md](T03-local-postgres.md).
Use installed tools; no dependency upgrade, cloud, external secrets, deployment,
push or PR. Synthetic credentials stay in the installation's private files.

```sh
export VAMOTORS_LOCAL_DIR="$HOME/.config/vamotors/local-t05b-independent"
pnpm install --frozen-lockfile --offline
pnpm db:generate
pnpm local:setup
pnpm local:setup
pnpm build
node --import tsx tests/security/stock-audit-check.ts "$VAMOTORS_LOCAL_DIR"
node --import tsx tests/security/stock-receipt-check.ts "$VAMOTORS_LOCAL_DIR"
node --import tsx tests/security/purchase-acquisition-check.ts "$VAMOTORS_LOCAL_DIR"
pnpm test:unit
pnpm typecheck
node .planning/implementation/contracts/check.mjs
pnpm local:stop
```

The committed stock runner has **16 groups**: real sessions/immutable acquisition;
desktop HOLD; mobile keyboard RELEASE/hold/release; dates/DTOs/refs/unsupported
commands; receive and hold/release races; committed response loss/current replay;
explicit stale recovery/read failure; nine essential-write/final-constraint
fault points/full rowsets/exact retry; runtime ACL and owner negative invariants;
field/action/record/redacted/predicate scope; observed execution/replay revocation
waits; archived supplier (including retained parent acquisition when present);
revocation purge; persisted filter/sort/deep reload; logout/account switch;
app+DB restart. Money facts are compared across stock actions.
It writes `stock-receipt-<run>.json`: clean/dirty flag, source SHA, origin, group
inventory, cycle IDs, migration checksums and exact current column grants.
It owns/closes its loopback production app/Chromium, retains synthetic DB rows,
and restarts only the root whose PROJECT marker it verifies. Run serially per
root; separate independent roots may run in parallel.

### Genuine exact-dispatched-parent upgrade

1. Use a separate local source copy at exact **db2580d**, its own installed
   frozen dependencies and a new private root. Run its setup/build and its
   `purchase-acquisition-check.ts` to retain **real command-created PURCHASED**
   acquisitions and Settings/audit/receipt/version history. **Acquisition alone
   does not populate FinanceCompany, FinanceContact, FinancePolicyVersion,
   SupplierContact or Customer.** Populate all five through genuine parent
   commands before prepare and explicitly require nonzero before/after rowsets;
   the existing upgrade runner's equality comparisons alone permit empty arrays.
   Nonempty fixture creation/proof remains a required independent-verifier task.
2. From candidate source, before overlay:
   `node --import tsx tests/security/stock-upgrade-check.ts <root> prepare`.
   It verifies the source copy's exact parent HEAD/nine applied migrations and
   genuine acquisition evidence, appends synthetic v6 wildcard/compound/create
   delegation ceilings, then saves `t05b-parent-before.json` privately.
3. Overlay/checkout the **committed candidate** in that same owned source copy,
   leaving its installation untouched. Run setup there, then from candidate:
   `node --import tsx tests/security/stock-upgrade-check.ts <root> verify`.
   Repeat setup **from that source copy's cwd**, then verify again. No reset,
   reseed, migrated-row edits or new-root substitution.
4. Verify asserts all nine checksums and retained rows/money/history bytes,
   original Permission hashes, frozen field/population ceilings, deliberate
   Administrator-only additions, Role revisions and the exact six UPDATE
   columns. `t05b-upgrade-after.json` includes the inventory/source SHA.
5. After this no-business-write comparison, run the stock campaign against the
   upgraded installation using candidate build:
   `node --import tsx tests/security/stock-receipt-check.ts <root> <source-copy>`.
   The third argument validates PROJECT and directs its restart to that copy.
   Subsequent lawful business changes are not a migration-byte comparison.

## Author evidence, retries and limits

Rejected candidate `490f7d3f960bafa604839fe8009f3a99272ba661` has a definitive
independent FAIL R1: AuditLog-only permission disclosed denied stock hold reasons.
Its prior positive campaigns remain attributed partial evidence, not acceptance.
The bounded R1 correction changes only purchase audit projection, adds
`stock-audit-check.ts`, and fixes the owned acquisition-runner formatting failure;
schema, migrations, registry, grants and dependencies stay byte-identical.

The focused runner uses real production sessions and UI-submitted receive HOLD
and holdStock, then checks both roots over HTTP and rendered detail UI. It covers
denied/allowed source reads, independent AuditLog reason denial, each root's
source denial, current record conditions, changed hold then release, subsequent
grant revocation in the same session, and byte-preserved stored audit history.
It owns/closes its app and Chromium; stop its retained PostgreSQL root separately
with `VAMOTORS_LOCAL_DIR=<root> pnpm local:stop`. It writes
`stock-audit-<run>.json` with source SHA, clean/dirty flag and case inventory.

Per the parent's bounded-handback instruction, the correction is a review
candidate only. Exact-SHA independent fresh/upgrade verification, the nonempty
exact-db2580dd nine→ten upgrade fixture (including repeat retention validation),
stock16, acquisition15 and broad affected regression reruns remain outstanding;
historical positives do not satisfy those replacement-SHA checks. No acceptance,
integration or whole-requirement promotion follows from the focused author pass.

Final exact-SHA results/artifact paths are returned in the implementation
handback. Earlier clean source `fd4d6f3` passed fresh14/upgrade14/acquisition15,
finance15/Settings16/DB10, party17/customer15/response-loss6, admin10/portal15,
delegated14/mobile12/redacted7, units124/spec19/types/build. These are author
results, not independent acceptance and not automatically final-head claims.

Development failures were retained: the first stock SQL CASE needed parentheses;
owner-root xmin verification needed trigger-only definer authority rather than
a broad runtime SELECT; historical supplier presentation needed current-row
validation distinct from immutable facts; conditional read-result mounting lost
a pending stock envelope on refetch; rapid filter changes needed retained URL
intent rather than stale navigation params. Dedicated final fresh/upgrade roots
avoid claiming iteratively refreshed development DB functions as fresh proof.
An out-of-root node_modules symlink prevented parent Turbopack build; installing
the same frozen offline dependencies locally fixed it. One reused administrative
fixture lacked staff identity-read authority; a fresh admin root passed all10.
An upgrade setup launched from the wrong cwd correctly failed PROJECT mismatch.
Redaction `.mjs` needs `node --import tsx` for its imported TypeScript modules.
Recovery verification exposed the production sign-in limiter on the fourth
real login in the logout/account-switch group. The runner now asserts the
sign-in HTTP result and honors one bounded server `X-Retry-After` on429; it does
not bypass or weaken authentication. Failed campaigns are retained privately.

Remaining scope: VSTS-01–04 gain this bounded receipt/hold/release evidence, not
full ten-state/S2 completion. T05b2 mileage/listed-price changes, T05b3 dated
costs/payments, T05c settlement/financial and identity corrections, T05d lawful
sold→repurchase/trade-in, and T08–T10 commitments/repair/finance/DO remain required.
No whole original requirement/134-ID promotion or G2 acceptance is claimed.
Literal G2 still needs parent-reviewed enduring URL/verified SHA/private human
login handoff and genuine private application-file referenced-byte persistence;
the disjoint T06a adapter is not integrated or certified by this purchase task.
Hosting remains deferred/not passed. Independent combined review and parent
acceptance remain mandatory. All owned test services are stopped at handback;
retained roots are not deleted.
