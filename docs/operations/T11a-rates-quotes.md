# T11a: exact rates and quote candidates (local only)

This bounded vertical implements LBRK-01–05 and the **selection/charges/snapshot part** of LBRK-06. It does not accept full T11, T06 or G4. Brokerage intake/customer/guarantor/eligibility and execution remain explicit later tasks. “Open brokerage intake” is truthfully disabled. No quote operation creates a Vehicle, PurchaseRecord or BrokerageDeal.

The independently verified rebase parent is exact `b7ac9afb85218e7ec7fbaa0b006d0b165a19b3c3`. The prebase author checkpoint remains preserved on `t11a-rates-prebase-1ed9867`; its earlier counts are historical, not final rebased evidence.

## Runtime

- `/lease-rate-sheets`: authorized persisted sheets/cards and immutable publication form. Active companies come from the persisted directory, through every authorized page; no fixture companies.
- `/lease-comparison`: maxima before principal, then exact principal+months **or** principal+installment. Per-company `NO_CARD`, `OVER_LIMIT`, `EXPIRED`, `AMBIGUOUS`; ambiguity requires explicit card selection. No interest formula/nearest amount.
- `POST /api/v1/commands/publishRates`, `selectQuote`: accepted strict command envelopes and dependency/CAS rules. `publishRates` requires current FinanceCompany reference; selection requires RateSheet revision1, current FinanceCompany and Settings references.
- `POST /api/v1/queries/loanMaxima`, `compare`: accepted query input JSON. Authenticated, same-origin, read-only, no-store. `GET /api/v1/queries/quote?id=<UUID>` returns authorized snapshot fields and only an independently readable **current** company revision.
- `GET /api/lease-rate-sheets?page=1&pageSize=20&companyId=<optional UUID>` is the authorized existing-route sheet list. `POST /api/lease-comparison` aliases the exact comparison query, not the retired approximate DTO.
- `/lease-comparison?quote=<UUID>` is a reloadable, permission-checked handoff link. It conveys no permission and does not open intake.

Amounts on the wire are canonical bounded integer minor-unit strings; form amounts are exact major-unit decimals. Valid-through is inclusive in Asia/Colombo. Quote expiry is the earlier of the next Colombo midnight after valid-through and creation+24h. Past/future rate-date comparisons are discovery only; selection always revalidates **now**.

## Persistence and authority

Migration `202610300001_exact_rates_quotes` follows stock `202610270004`. It creates append-only `RateSheetVersion`, `RateCardEntry`, `Quote`, extends the existing read-version type check, adds bounds/card uniqueness, company/model/year overlap prevention and deferred essential-evidence/snapshot checks. No old migration is rewritten.

Registry v8 adds only:

| Subject   | Actions      | Conditions                                                |
| --------- | ------------ | --------------------------------------------------------- |
| RateSheet | read, create | trusted createdBy; financeCompanyId → persisted companyId |
| Quote     | read, create | trusted createdBy; financeCompanyId → persisted companyId |

Only protected Administrator receives the four explicit new capabilities during upgrade. Existing Permission bytes, RolePermission joins, delegated ceilings and stock grants remain unchanged. No existing subject/action field universe is expanded. New runtime grants are SELECT/INSERT only on the three new tables; no UPDATE/DELETE/TRUNCATE, ownership, schema CREATE or future-table defaults.

Selection stores immutable exact card/max/vehicle/charges, company policy version+path/commission/processing fee, company/contact values, settings version+values, and explicitly computed expected commission (existing exact rounding helper). Future directory/settings changes cannot rewrite these rows. Source audit/read versions/receipt commit with the snapshot in the same transaction. Same key retries are currently reauthorized before returning the original reference.

Quote.create never implies Quote.read. Owner-only reads do not permit another staff member’s quote; cross-staff handoff requires an explicit current matching Quote.read grant. Policy/commission/charges project independently. `quoteForUse(tx, actor, id)` is the later intake/reselection seam: it enforces all consumed Quote fields and expiry inside the caller transaction. A future intake owner must additionally enforce its command’s domain grants, current source/card/company/path/state/CAS and atomic deal creation; merely reading a quote is not intake acceptance.

The rate forms retain values and exact serialized requests after 422/403/409/transient errors. Retry uses the same key. A definitive refusal requires explicit new-intent confirmation and fresh references. Auth boundary preservation is restricted to these two pages, the same user and unchanged role membership: it cancels/clears private queries, refreshes grants and hides obsolete comparison results. Identity/membership changes still leave/reload; no old authority is retained with a draft.

## Reproduce author checks

Use a new private project-owned cluster; never reset another worker’s state or use cloud credentials. `scripts/local-postgres.ts` binds only loopback and writes separate private runtime/migration/admin/account files outside Git. PostgreSQL server binaries must exist (`PG_BIN` can identify an installed server directory). The author restored Homebrew PostgreSQL18 binaries only; no global service was enabled.

```sh
pnpm install --frozen-lockfile
pnpm db:generate
VAMOTORS_LOCAL_DIR="$HOME/.config/vamotors/local-t11a-review-UNIQUE" pnpm local:setup
pnpm build
node --import tsx tests/security/rates-check.ts "$HOME/.config/vamotors/local-t11a-review-UNIQUE"
pnpm exec vitest run tests/security/rates.test.ts tests/security/settings-finance.test.ts
pnpm typecheck
pnpm lint
```

The single maintained campaign launches a production Next server on a random loopback port with the actual controlling `/sw.js`, signs in three real accounts using Chromium, publishes synthetic A/B cards via UI at1920/360px, verifies HTTP/database snapshots, exercises exact lookup/negative/security/race/rollback/retry cases, and stops its own server/browser. A context-level transport fault commits through real HTTP before aborting the response; the identical retry must return the original receipt with zero new effects. Same-membership grant revocation retains rate drafts while clearing private reads; changed membership/identity discards them. No worker bypass or mocked finance/auth/transaction invariant is used. It retains synthetic database rows. No auth state, credentials or unredacted server diagnostics are written to repository evidence.

### Genuine exact-parent upgrade

After the parent supplies its independently verified combined SHA, install **that exact parent** in an isolated checkout/cluster first. Capture existing data/ceilings using the campaign’s `prepare-upgrade` mode (pass the exact parent SHA), then upgrade that same cluster with this branch’s committed migrations and explicit runtime grants. The cluster’s private `cluster.env` PROJECT binding must name the checkout running local setup; move only this isolated test binding when transferring from parent checkout to candidate checkout. Never repoint a shared/retained worker cluster.

```sh
node --import tsx tests/security/rates-check.ts "$PRIVATE_UPGRADE_ROOT" prepare-upgrade "$VERIFIED_PARENT_SHA"
# Apply candidate migrations/grants using the existing local setup owner path.
VAMOTORS_LOCAL_DIR="$PRIVATE_UPGRADE_ROOT" pnpm local:setup
node --import tsx tests/security/rates-check.ts "$PRIVATE_UPGRADE_ROOT" verify-upgrade
```

`prepare-upgrade` adds a synthetic retained finance policy/company and non-admin wildcard/conditional ceiling in the genuinely old schema, then captures private row/permission/join/ACL/migration-checksum evidence. `verify-upgrade` requires parent ancestry, exact unchanged old migrations/business rows/Permission bytes/joins, unchanged non-admin role revisions, only four new protected-admin joins, preserved old column privileges and insert/read-only new table grants. This is upgrade proof, not final v1/deployment acceptance.

Before prepare, run the normal committed parent `stock-receipt-check.ts` and `purchase-acquisition-check.ts` against that exact parent installation, then run this campaign from the parent checkout with `seed-parent` (the script may be addressed by its absolute candidate path). That mode uses genuine parent HTTP commands to populate finance policy/contact revisions, customer and supplier/contact rows. Prepare fails closed if the required parent populations, received/held stock, payments/status/audit histories, ten old migrations or actual source SHA are missing. The added non-admin metadata includes assigned wildcard/conditional and Role/User delegation ceilings. Snapshot coverage includes StatusEvent, SupplierContact and BusinessSequence. Verify requires eleven migrations and can be repeated after repeated setup without reseeding or deleting anything.
