# T17b: bounded private-safe PWA shell

Author evidence; independent review required. Base `db2580dd7fa722489c591f3f9ed8ed0ea4d26a72`. This implements only the manifest/icons/public offline shell/worker and root registration contribution to W17, NFNL-02 and FNDN-09. It does **not** accept whole T17, FNDN-09, NFNL-01/02 or other requirements. Remaining business/navigation/bell contributions and physical mobile/tablet verification are not waived. Local completion and the current W17 privacy boundary supersede the original specification's offline business-read aspiration; offline business reads remain deferred v2.

## Boundary

- `app/manifest.ts`: stable origin-relative ID/start URL/scope `/`, standalone display, English name, ordinary PNG icons at 192/512px. `app/layout.tsx` adds only registration and Apple metadata/icon; existing styles/providers/auth boundaries are unchanged.
- `components/pwa-registration.tsx`: production builds only, secure context and native service-worker support required; `/sw.js`, root scope, `updateViaCache: "none"`. Registration failure emits only a fixed generic warning and never blocks login or commands. Development does not install a worker.
- `public/sw.js` caches **only** `/offline.html`, `/pwa-icon-192.png`, `/pwa-icon-512.png`, `/apple-touch-icon.png`. Installation requests omit credentials, bypass HTTP cache, reject redirects, validate success/MIME, and consume each response immediately. No runtime response is written to CacheStorage. Activation replaces only this worker's `vamotors-public-shell-*` caches, not unrelated caches.
- Only exact allowlisted asset URLs without query, RSC or Authorization headers can read the public cache. Other same-origin GETs use `cache: "no-store"` and preserve original credentials/redirects/status. Offline document navigation gets the generic public unavailable page; API, RSC, subresource and extension-bearing document/download failures stay failures, never fake HTML data. No authenticated HTML, RSC, API/JSON, CSV, PDF, document, signed URL, login/session state or application bundle is cached.
- Non-GET and foreign-origin requests are untouched. There is no sync handler, IndexedDB/local-storage write queue, financial replay or offline business form. An interrupted action must be explicitly retried against the current online record; the shell does not claim whether an action interrupted after submission committed.
- The offline page contains no account/route/query values or external scripts/fonts. Its only action is a normal online reopen link. Existing live-page authorization rechecks and in-memory draft handling remain the existing application's responsibility; this slice does not replace them or claim instantaneous detection of every network failure.

The worker needs one successful online installation before offline fallback exists. Cache deletion/browser storage eviction can remove offline availability. If changing any precached bytes, increment `CACHE_NAME` in `public/sw.js`; keep the allowlist public and explicit. Do not add generic runtime caching, wildcard routes, background sync or a PWA dependency.

## Reproduce

Use a **new owned off-Git local PostgreSQL root**, never another worker's directory or a retained user database. PostgreSQL 18 binaries, Node/pnpm and the pinned Playwright Chromium browser are prerequisites. Existing local setup/grants/schema are reused unchanged.

```sh
pnpm install --frozen-lockfile
pnpm db:generate
export VAMOTORS_LOCAL_DIR="$HOME/.config/vamotors/t17b-own-review"
# If PostgreSQL is not in a default installation, export PG_BIN=/absolute/path/to/bin.
pnpm local:setup
pnpm build
node --test tests/pwa/service-worker.test.mjs
node --import tsx tests/pwa/production-check.ts "$VAMOTORS_LOCAL_DIR"
# Optional native headed app-window reproduction; still a fresh disposable profile:
PWA_HEADED=1 node --import tsx tests/pwa/production-check.ts "$VAMOTORS_LOCAL_DIR"
pnpm typecheck
pnpm test:unit
pnpm exec eslint app/manifest.ts components/pwa-registration.tsx public/sw.js tests/pwa/service-worker.test.mjs tests/pwa/production-check.ts
pnpm exec prettier --check app/manifest.ts components/pwa-registration.tsx public/sw.js public/offline.html tests/pwa/service-worker.test.mjs tests/pwa/production-check.ts docs/operations/T17b-private-safe-pwa.md
git diff --check
pnpm local:stop
pnpm local:start
node --import tsx tests/pwa/production-check.ts "$VAMOTORS_LOCAL_DIR"
pnpm local:stop
```

The production fixture starts/stops its own loopback Next process on an available port, uses real UI login and two isolated authenticated contexts, and retains synthetic test roles. It temporarily removes/restores the second administrator's role assignment through existing commands. It never resets/drops a database or changes grants/schema. Credentials and failure details stay in the private root, not console output. Each invocation makes a new `pwa-browser-<UUID>` directory; it never opens the user's normal browser profile. The installed app is uninstalled in cleanup. The fixture checks installation capability separately and records an explicit gap if CDP cannot demonstrate it; a successful "attempt" group alone is not installation proof.

Actual offline proof stops the app server **and** enables browser offline mode: this Chromium/Playwright combination can still send worker network requests when only page offline emulation is enabled. The fixture then restarts the real app, checks no write replay, logs out, tests back navigation, revokes same-cookie permission, and closes/relaunches the entire browser against the same private profile while the app server is stopped.

For installation, the fixture calls native CDP `PWA.install`, explicitly selects the disposable profile's `standalone` display preference with `PWA.changeAppUserSettings`, and calls `PWA.launch`. A pass requires a new target at the actual app origin, an activated controller and `matchMedia("(display-mode: standalone)")`. It repeats the launch after browser-process restart with the app server stopped and verifies the public fallback. This explicit install preference is test-only, not a product override of the user's browser preferences.

## Author results and artifacts

On 2026-10-30: own root `/Users/alpha/.config/vamotors/t17b-pwa-author-v2`, real PostgreSQL **18.6**, production Next **16.1.7**, pinned Chromium **147.0.7727.15**. No project package/lockfile change, system service, cloud/deploy/push/PR action or other worktree/database modification.

The machine lacked the server binary. `brew fetch --force-bottle postgresql@18` downloaded the native bottle only; it was extracted/relocated/ad-hoc signed under the approved temporary directory in `t17b-postgres-prefix`, reusing existing native libraries. No Homebrew package was installed or service started. An initial flat extraction could not locate PostgreSQL share files; the failed private `t17b-pwa-author` setup remains untouched. A separate Homebrew-compatible isolated prefix and fresh `-v2` root passed existing setup. Reviewers may use any already installed PostgreSQL 18 via `PG_BIN` instead.

| Check                                                                                 | Author result                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frozen install / client generation / fresh local setup / production build / typecheck | PASS                                                                                                                                                                                                                                                                 |
| Existing Vitest suite                                                                 | PASS: 117 tests, 11 files; unchanged pg TLS-alias warning                                                                                                                                                                                                            |
| Native worker policy tests                                                            | PASS: 5 tests; exact allowlist/credential omission, failed install, owned-cache cleanup, private/request classifications, no write handling, absent fallback                                                                                                         |
| Production browser fixture                                                            | PASS: 8 groups, real UI/auth/DB, zero manifest/installability errors, correct PNG dimensions/root controller, exactly four public cache keys, no IndexedDB queue, network-only private responses, real offline no-write/reconnect/logout/revocation/restart behavior |
| Native desktop install/relaunch                                                       | PASS with explicit disposable-profile standalone preference; actual CDP install, standalone app window, whole-browser restart, standalone offline relaunch; cleanup uninstalls only that test app                                                                    |
| Offline shell accessibility/responsiveness                                            | PASS at 360/1920px: main/heading/image/link semantics, English language, keyboard focus, visible outline, >=44px target, no horizontal overflow; screenshots inspected                                                                                               |
| Owned-file lint / new-file formatting / diff whitespace                               | PASS; existing root layout formatting preserved, no bulk formatting                                                                                                                                                                                                  |
| Whole-repo lint at accepted base plus this slice                                      | NOT PASSED: unchanged 3 errors (`app/api/cash-flow/prototype.ts` prefer-const; two `lib/compose-refs.ts` compiler rules), 40 warnings; separate lint lane owns correction                                                                                            |

An initial real-browser failure caught install response-stream backpressure when all fetch responses were held before cache writes. Sequential validated consumption fixed it, and the real activated-controller check now passes. Default CDP installation initially used browser-window preference; explicitly choosing standalone in the disposable profile produced the verified native app window. Failed intermediate runs are not counted as passed install evidence.

Private artifacts (paths, no credentials): `t17b-pwa-evidence.json` records exact tested HEAD, dirty flag, groups, browser version, headed mode and distinct install/standalone/relaunch outcomes. `pwa-offline-360.png` and `pwa-offline-1920.png` capture only the public fallback. `t17b-pwa-private-failure.log` retains the last failed diagnostic and is not evidence of the final run. Runtime/account files follow the existing local runbook's 0700 directory / 0600 file rules. DB stop/start retains data; final browser checks are rerun against the committed candidate.

**Limits:** no physical supported mobile/tablet, mobile Add-to-Home-Screen gesture, screen reader/device usability certification, hosted HTTPS/provider test or whole-app acceptance. General navigation, bell, domain forms/table responsive states and all other T17 contributions are unchanged and remain separately reviewable. Offline business records are intentionally unavailable, not an unreported implementation shortcut.

## Documentation checked

Current Context7 `library` then `docs` lookups: `/vercel/next.js` (App Router PWA manifest/registration), `/mdn/content` (fetch/CacheStorage/service-worker behavior), `/microsoft/playwright` (persistent contexts/offline/worker APIs). Direct primary references: [Next PWA guide](https://nextjs.org/docs/app/guides/progressive-web-apps), [MDN register/scope/updateViaCache](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/register), [MDN HTTP cache modes](https://developer.mozilla.org/en-US/docs/Web/API/Request/cache), [Chrome DevTools PWA domain](https://chromedevtools.github.io/devtools-protocol/tot/PWA/). The existing proxy already supplies private no-store/nosniff headers for the worker and non-static private routes; no proxy/config change is needed.
