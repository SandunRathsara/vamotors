# T18 independent closeout at 32276df

Verified product revision `32276df4a4850b614a44558f63e4a17f1b1a8ae3` with production `next start`, PostgreSQL 18.7, real sessions and private synthetic files. The final regression, dispatch and focused workflow campaigns used separate `VAMOTORS_LOCAL_DIR` roots and loopback app ports. Chromium used a disk-backed `TMPDIR` under `~/.local/share`.

## Gate verdicts

| Gate                         | Verdict                                  | Evidence                                                                                                                                                                      |
| ---------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G3 Core dealership workflows | **PASS**                                 | Reverified the lease picker and all four sale details. Earlier purchase, repair, lifecycle, approvals, write-off, audit and invoice evidence remains attributed to `17c73aa`. |
| G4 Brokerage and finance     | **PASS**                                 | Two- and three-member dispatch batches and per-member allocations passed. Earlier evidence covers both brokerage paths, facility recovery and mixed-source reconciliation.    |
| G5 Complete v1 surface       | **PASS for the automated local surface** | The four keyboard journeys and automated PWA checks passed. Earlier evidence covers the seven reports and exports, historical import and dashboards.                          |
| G6 Final local completion    | **CONDITIONAL**                          | The physical mobile/tablet install and relaunch check below is the sole outstanding local acceptance item. Deployment is deferred.                                            |

The [matrix](../requirements-matrix.md) records 133 local passes and one open ID. Four passes are fresh at `32276df` and 129 retain their prior SHA. The [prior independent campaign](T18-final-17c73aa.md) and [follow-up](T18-open-ids-17c73aa.md) supply retained coverage, including scheduler invocation, restart, backup and isolated restore.

## Acceptance results

| Requirement | Result     | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| LBRK-21     | LOCAL PASS | An incomplete member returned 422 with no batch, item, entitlement, command receipt or audit residue. Direct HTTP and the Chromium and Firefox dispatch screens accepted ready batches of two and three. SQL and a second session confirmed sender, handover time, tracking, one revision advance and one entitlement per member. Exact-key HTTP replay added no writes. Reconciliation allocated against every entitlement and left zero unallocated. |
| TPRT-08     | LOCAL PASS | Refocusing the open lease picker exposed the company created by another session and preserved the draft. Direct lease commands returned 404 for a missing company and 409 for an inactive company. The negative-test cycle stayed available with no sale.                                                                                                                                                                                              |
| SLGN-02     | LOCAL PASS | Chromium and Firefox matched persisted cash, converted advance, settled lease and trade-in payment amounts and timelines. The authorized customer, source cycle, lender and acquired trade-in cycle links opened. A role limited to the sale snapshot received no links to related records.                                                                                                                                                            |
| NFNL-01     | LOCAL PASS | Chromium and Firefox each completed purchase through stock receipt and repair, cash sale, Application brokerage through dispatch, and finance remittance through reconciliation at 360px and 1920px. Tab navigation and keyboard activation reached the tested controls. Playwright populated routine form values and supplied synthetic attachment bytes. Invalid purchase, sale, brokerage and bank transfer submissions retained draft inputs.      |
| NFNL-02     | U          | All five worker tests and eight production browser groups passed. Chromium installed and launched standalone, then relaunched offline after browser restart. The offline shell stayed anonymous, private reads failed and writes never replayed. A human still needs to verify installation and relaunch on a physical device.                                                                                                                         |

## Regression and evidence

- Frozen pnpm install, Prisma generation, fresh migrations, `pnpm typecheck`, `pnpm lint` with zero errors or warnings, `pnpm exec prettier --check "**/*.{ts,tsx,md,json}"` and `pnpm build` passed. Vitest reported 264 passes and one skip. The bounded real-DB security checks passed.
- `pnpm exec playwright test --workers=1` passed all 31 tests, including the API project and both widths in Chromium 147.0.7727.15, Firefox 148.0.2 and WebKit 26.4. WebKit used the locally installed compatibility libraries.
- Logs and temporary adapters are under `/home/omega/.local/share/vamotors-t18-32276df/run.bPiQa4`. See `dispatch-*-final.log`, `detail-complete-*.log`, the per-engine keyboard logs (see `broker-keyboard-chromium-*-retry.log` for the Chromium brokerage passes), `playwright-clean.log` and `db/t17b-pwa-evidence.json`. The first suite run shared a cluster with another harness and hit three serialization failures. The rerun used a dedicated cluster. Chromium brokerage recovery passed after waiting for the validation alert and tabbing backward to the invalid field.
- The host commands for the device-check origin served the standalone manifest and login page. All verifier app, browser and PostgreSQL processes were stopped. The live service was left alone.

## Physical-device PWA check

1. Use a supported Android phone or tablet with Chrome and authorized USB debugging. On the verifier host, open the verified worktree with its production build. Start the retained synthetic cluster and app on an available loopback port. The commands below use port 18082.

   ```sh
   export VAMOTORS_LOCAL_DIR="$HOME/.local/share/vamotors-t18-32276df/run.bPiQa4/db"
   pnpm local:start
   APP_ORIGIN=http://127.0.0.1:18082 BETTER_AUTH_URL=http://127.0.0.1:18082 \
     node --env-file="$VAMOTORS_LOCAL_DIR/runtime.env" node_modules/next/dist/bin/next \
     start --hostname 127.0.0.1 --port 18082
   ```

2. In another host terminal run `adb reverse tcp:18082 tcp:18082`. On the device, open `http://127.0.0.1:18082` in Chrome. Choose **Install app** in the browser menu, or **Add to Home screen** and then **Install**. Launch from the device icon and confirm that it opens in standalone mode. Sign in with the synthetic admin from the private `accounts.env` and open a permitted record. Close the app from Recents and launch from the same icon again to confirm online standalone relaunch.
3. Remove forwarding with `adb reverse --remove tcp:18082` and enable airplane mode. Close the app from Recents and launch from its icon again. Confirm standalone mode and the generic offline page with no saved record details or write controls. Restore connectivity and forwarding, reopen online and confirm the app loads.
4. Record the device model, OS, Chrome version, checked SHA, date and outcomes for install, online relaunch and offline relaunch. Remove the device installation and forwarding, stop this scratch Next process with Ctrl+C and run `pnpm local:stop` with the same `VAMOTORS_LOCAL_DIR`.
