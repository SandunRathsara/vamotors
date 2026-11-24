# T18 independent local verification at 17c73aa

Product revision `17c73aabca850d865d7c541f59d7107e1b46383c`. Node 24.16.0, pnpm 12.4.2, PostgreSQL 18.7, production `next start` on ephemeral loopback ports. Each campaign used a private `VAMOTORS_LOCAL_DIR` with synthetic accounts and persistent files. Playwright used one worker.

## Gate verdicts

| Gate | Verdict | Evidence |
| --- | --- | --- |
| G3 Core workflows | **OPEN** | Core journeys passed in both engines. The matrix retains open lifecycle, sale-field and refund subcriteria. |
| G4 Brokerage and finance | **BLOCKED** | Single-deal Application dispatch, Referral, facility recovery and mixed reconciliation passed. A valid two-deal batch fails. |
| G5 Complete v1 surface | **OPEN** | Seven reports with full exports, historical imports, dashboard and desktop PWA passed. Individual open criteria are in the matrix. |
| G6 Final local completion | **BLOCKED** | G4 defect, remaining per-ID evidence and physical-device PWA verification. Hosting criteria are DEFERRED DEPLOYMENT. |

The [requirements matrix](../requirements-matrix.md) records 111 fresh local results for the 134 v1 IDs. Raw run index and logs are in `/home/omega/.local/share/t18-final.GIq9VYlT` (`results` and corresponding `<check>.log` files).

## Product defect

**P2 — Dispatch rejects two ready Application deals, LBRK-21.** Prepare two Application deals through confirmed eligibility, inspection, verified documents and company file references. Confirm that Dispatch Preview marks both ready. On Lease Dispatch, select both, enter the courier and choose **Dispatch selected deals**. The command returns HTTP 409 `IDENTITY_CONFLICT`. PostgreSQL reports `CommissionEntitlement_commandId_key`. The clean-database rerun used separate quotes and customers. Both deals stayed DOCUMENTS_READY, and all dispatch, entitlement, receipt and audit snapshots were unchanged. [dispatch.ts](../../../lib/server/dispatch.ts#L332) creates one entitlement per member using the same batch command ID, and [schema.prisma](../../../prisma/schema.prisma#L1648) makes the entitlement command ID unique. See `dispatch-batch.log` and `dispatch-final.log`. This was the only confirmed product defect in the campaign.

## Executed checks

- Frozen lockfile install, Prisma generation, typecheck, ESLint, Prettier over TS/TSX/Markdown/JSON, 265 Vitest tests and the production build passed. Install completed with an optional transitive Sharp source-build warning. Attachment processing and PDF generation passed in the app.
- The real-DB security and HTTP suites passed. Current grants, private route/RSC/query/download boundaries, concurrent last-admin protection, append-only audit, same-key retries and forced rollback were exercised. The user/role, customer and third-party UI suites passed after the fixture accounts were restored.
- The five preflight regressions passed on this revision. The purchase harnesses checked all six institution switches, delayed refetch after stock release, lower repurchase mileage with a reason, and the acquisition and directory copy. The separate reviewer retrieved the exact committed receipt after the requester lost only the create grant, and lost access on actual originating-authority revocation. No replay duplicated a write.
- The shared keyboard journey passed at 360 and 1920 pixels in Chromium 147.0.7727.15, Firefox 148.0.2 and WebKit 26.4. WebKit used the pinned Playwright archive and local compatibility libraries. Chromium and Firefox exercised settlement acquisition, repairs, the four sale types, approvals, invoices, reconciliation, reports, historical import and the brokerage paths using real sessions. The feature suites mix browser steps and authenticated HTTP for deeper state/negative cases. Keyboard and 360/1920 coverage is recorded per check. The Firefox write-off rerun exercised stale state and committed-response loss with native navigation. Chromium also exercised injected read failures.
- Repair and additional cost retained a 115 basis for 100 + 10 + 5. Purchase 100 + repair 10 sold at 140, then repurchase 120 + repair 5 sold at 150, kept profits 30 and 25 under one vehicle identity. Lease down payments and later lender receipts used their actual dates. DO and unpaid repair produced no lender/vendor cash. Partial advance refund left 20 of 50. The mixed bank remittances of 205 and 563 allocated to vehicle and brokerage once, with separate overpayment return and reversal. See the repair, sales, reservation and reconciliation logs.
- At 2026-11-24 23:25:44 UTC a real deferred timer persisted a successful system JobRun with one expiry and one warning. Manual catch-up persisted one more expiry. The suite exercised duplicate and failed runs, successful retry, and a conversion racing expiry without duplicate cash or an overwritten Sold state. The checked files include the persisted scheduler state and JobRun outcomes.
- Historical import passed in Chromium and Firefox. Seven primary types, CSV/XLSX, invalid-row replacement, late rollback, idempotency, approvals, linked payment reversals and source-row provenance were exercised. One control batch reconciled 5,070,000 out and 5,800,000 in (LKR).
- All seven CSV/PDF exports matched hand-computed scopes and totals. In a separate 10-row screen test the CSV counts and PDF ranges covered all 37 inventory, 11 sold, 11 profit, 11 advance, 11 repair, 99 cash and 11 disposal rows. The saved multi-part report resumed after quota pause and restart, with owner-only downloads.
- The desktop Chromium PWA installed and launched in standalone mode in a disposable profile. After restarting the browser it opened the anonymous shell offline. Private API, RSC and file requests stayed unavailable offline, and the offline attempt generated no queued writes. See `pwa-rerun.log` and `chromium/t17b-pwa-evidence.json`.

The hand-calculated report checkpoints below use major units unless specified.

| Report | Rows | Verified figure |
| --- | ---: | --- |
| Inventory | 1 | Acquired trade-in basis 50 |
| Sold | 2 | 290 sale price, 235 basis, 55 profit |
| Profit | 2 | 220 purchases, 15 repairs, 235 basis, 55 profit |
| Advances | 1 | 100 receipt, 1,000 listed and agreed |
| Repairs | 1 | 3 October dispatch and elapsed Colombo calendar days |
| Cash flow | 6 | 240 in, 235 out, 5 net |
| Disposals | 1 | 5,000,000 basis, 500,000 proceeds, 4,500,000 loss |

## Durability and live smoke

The application and PostgreSQL restarted with their retained private filesystem. The ordered business, audit and cash snapshot remained `2bbbcb22f13e323c635a7ccf33e7cfbe62393489b60d57ba17fc37242b63ae27`. All 89 attachment and 11 invoice hashes matched, including invoice version 3. All seven report counts and totals stayed identical.

The verified backup restored into a separate database and private root. The manifest covered 127 files with SHA-256 `9c6835deeb6df16f71e92cf670e5fa3fa4666c54c082c9a7e8a7c817c98d324c`. All seven populations and totals matched the source, including 229 cash movements with net −3,019,834,401 minor units and sold profit 326,559,200 minor units. A fresh administrator retrieved the retained PDF and attachment bytes by hash. The restricted account was denied reports and both file reads. See `recovery-final.log`.

The live service at `http://127.0.0.1:8000` rendered `/login` with HTTP 200. The HTML carried the on-disk build ID `dRK-RR2TSbVw9wLp4Dns6`, and all 15 referenced script paths resolved in the service checkout at `17c73aa`. The service entered active state immediately after that build artifact was written. `/api/health` returned 404. The live check used anonymous GETs only. See `live-smoke.log`.

## Remaining checks and reproduction

- A human must install on a supported physical mobile device or tablet, open in standalone mode, close and reopen it, and check the anonymous offline shell. Record the device/browser and outcome.
- The 23 open IDs are listed in the matrix. They include the dispatch defect, remaining lifecycle and form negatives, all quick-action completions, complete per-workflow viewport coverage and the physical-device check.
- Earlier nonzero exits include browser-library setup, a sign-in rate limit and an older customer upgrade fixture that removed current purchase grants from the test administrator. Firefox sales respected the retry interval. The obsolete finance-detail and disabled-intake expectations were checked against the current application. Current reruns are indexed separately. Two legacy write-off scripts require a retained `2360cbb` upgrade witness. The fresh write-off API and browser suites used current committed migrations.
- [README](../../../README.md) records local setup/start/stop, credentials, expiry and restore commands. For review use a new off-Git scratch root, `pnpm local:setup`, `pnpm build` and `next start --hostname 127.0.0.1 --port <isolated-port>` with the scratch runtime environment and matching origin. Use `pnpm local:start` and `pnpm local:stop` against the same scratch root. The evidence root retains the serial runners and browser adapters used for this review. All verifier-owned app, browser, timer and PostgreSQL processes were stopped.
