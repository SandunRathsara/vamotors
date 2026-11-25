# T18 acceptance follow-up at 17c73aa

Product revision `17c73aabca850d865d7c541f59d7107e1b46383c`. The verification branch fast-forwarded to `2f35508` for the prior matrix and report. Node 24.16.0, PostgreSQL 18.7, a production `next start` on loopback, dedicated local database and file roots, real sessions, Chromium and Firefox. Browser scenarios ran serially.

## Results

| ID | Result | Evidence or remaining gap |
| --- | --- | --- |
| FNDN-06 | LOCAL PASS | Pure transition tests, ten database enum values, rejected illegal command and restricted SQL status writes. |
| TPRT-06 | LOCAL PASS | Sale lease, brokerage and reconciliation shared one company ID. Archiving removed it from the active options and preserved all three histories. |
| TPRT-08 | U | P3. An already-open lease form kept its stale company list after a company was created. Closing and reopening exposed the new company. |
| VSTS-01 | LOCAL PASS | All ten states rendered in Chromium and Firefox, including historical Delivered. Normal cash and lease handovers ended Sold without a Delivered transition. |
| VSTS-02 | LOCAL PASS | Purchase, receipt, repair, reservation, sale and repurchase persisted. Illegal PATCH/command and stale concurrent transition were rejected. |
| SLGN-01 | LOCAL PASS | Independent details and invoice snapshots kept an absent cash reference and the financed sale file reference. |
| SLGN-02 | U | P2. The lease detail renders lender text without a link to the authorized finance company record. |
| SLAD-01 | LOCAL PASS | LKR 100 at LKR 1,000 via cash and bank transfer. Zero rejected, asking price captured, and retry produced one dated receipt. |
| SLAD-03 | LOCAL PASS | Advance receipt and unavailable state persisted together. Advance versus advance and advance versus cash-sale races left one commitment each. |
| SLLS-02 | LOCAL PASS | Missing, zero and negative down payments were blocked in both browsers and direct HTTP. A positive payment persisted one receipt on retry. |
| CUST-04 | LOCAL PASS | Same customer's trade-in acquisition and two sale records across cycles were returned and linked in both browsers. |
| APRV-03 | LOCAL PASS | LKR 60 of LKR 100. Pending approval paid nothing. Self-review failed, concurrent reviewers and retry produced one refund. |
| AUDT-01 | LOCAL PASS | Stock, pricing, user creation and finance archive retained actor, timestamp and field deltas without secrets. Forced audit failure rolled back the transaction and the same key recovered. |
| NOTF-02 | LOCAL PASS | Vehicle, sale, customer and approval targets opened in both browsers. Guessed mark-read failed and deactivation blocked the retained session. |
| REPT-01 | LOCAL PASS | Mixed new inventory returned exact populations for status, availability, make and model. Both browser tables showed the selected held row, cost basis and asking price. |
| FINT-03 | LOCAL PASS | Purchase 100, repair 10 and additional cost 5 showed 115 basis on reload and in an independent session. Historical cycle retained 115 after repurchase at 125 basis. |
| LBRK-18 | LOCAL PASS | Deal default was 2,500, overridden to 2,750 with a recorded reason and field diff. New deal used 3,000. No fee receipt was created. |
| LBRK-21 | U | The existing dispatch-batch defect was excluded from this follow-up. See `T18-final-17c73aa.md`. |
| RCNL-01 | LOCAL PASS | Two companies staged different methods. Changing one company produced a PER_DEAL run and preserved prior PERIOD_NOTICE snapshots. |
| RCNL-05 | LOCAL PASS | Finance-only user reached Reconciliation without Brokerage in both browsers. A denied user saw not-found and the private query was denied. |
| DASH-02 | LOCAL PASS | Purchase, sale and repair quick actions saved records and reported updated dashboard metrics. A no-grant account saw none of the actions and all three direct commands were denied. |
| NFNL-01 | U | Chromium 1920px keyboard coverage is incomplete. The acquisition identity read failed with net::ERR_FAILED before submit. A diagnostic with the worker disabled also hit Chromium resource errors. |
| NFNL-02 | U | Automated desktop Chromium install and offline standalone relaunch passed. Private responses stayed unavailable offline and writes never replayed. Physical mobile/tablet install and relaunch remain human-only. |

## Confirmed defects

- **P3 TPRT-08.** In Chromium and Firefox, open an available vehicle's sale form, choose Lease, and enter a down payment. Create an active company in a separate session. The open dropdown should offer the new company while retaining the draft. The existing options stayed in place for the observation window. Reopening refreshed the options and cleared the down payment. The picker query in `components/sales/commitment-fields.tsx` and uncontrolled payment inputs in the lease form are the likely locations. Direct HTTP returned 404 for a nonexistent company and 409 for an archived company on otherwise eligible stock.
- **P2 SLGN-02.** Open the authorized sale detail after starting a lease with an active finance company. The company name should link to its company record. The detail displayed the company name and term as plain text in Chromium and Firefox. See the lease financing summary in `components/sales/commitment-actions.tsx`.

## Remaining verification gap

- **NFNL-01.** Keyboard purchase and sale completed at both widths in Firefox and at 360px in Chromium, with draft retention after invalid input. The brokerage intake-to-dispatch and mixed reconciliation journeys ran at both widths in both browsers. In repeat Chromium 1920px purchase/sale runs, select an active supplier, enter the acquisition details, and activate Record fully paid acquisition. The valid draft should save and the journey should continue. Instead, Chromium logged `net::ERR_FAILED` on the vehicle identity GET before the command, and the form reported `Failed to fetch` while retaining the draft. With service workers blocked, a diagnostic reached stock receipt and then logged `net::ERR_INSUFFICIENT_RESOURCES` on a notification GET. The acquisition submit path is in `components/purchases/acquisition-workspace.tsx` and calls `lib/security-client.ts`. The source of the Chromium network failure remains unconfirmed.

## Checks and reproduction

- Frozen install, Prisma generation, production build, typecheck, ESLint and the bounded real-DB security suite passed. Vitest reported 264 passed and 1 skipped. The five service worker checks passed.
- Raw logs, browser adapters and serial exit codes are retained under `/home/omega/.local/share/t18-open.cFh6gfNI`. See `results`, `targeted-final.log`, `targeted-retained.log`, `targeted-edges.log`, and the per-browser `detail-*`, `historical-*`, `recon-*`, `broker-*`, and `keyboard-*` logs. In reused harness messages, the word Chromium can appear in Firefox runs. The file names and launch adapters identify the engine.
- Early attempts include a reused reservation harness timing out on the reference-reason field, a browser-adapter syntax error, a legacy cost harness expecting a different status message and a keyboard run searching only the first stock page. These runs are indexed alongside the focused reruns. The originals and adapters are outside Git. A legacy brokerage harness reached its Docker setup before stopping at an existing scratch directory. Its temporary container was stopped and the brokerage checks used the native local cluster.
- Physical PWA verification remains open. A human must install on supported mobile or tablet hardware, open and relaunch in standalone mode, and confirm the anonymous offline shell. Record the device and browser.

Both isolated PostgreSQL clusters were confirmed stopped. All verification app and browser processes were stopped.
