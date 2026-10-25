# Local Playwright browser readiness

2026-10-25 UTC; author evidence, **independent review required**. Base
`81216521917c726df1b93e52b487950a2aeb8b13`. Environmental correction only;
not T02 acceptance, release-suite execution, or app usability certification.
Read the orchestration contract and T02a preparation at
`6b86b0c48cdb690fc79559eb69f1be3d17a33ff4` before proceeding. Integration owns
the ledger/evidence-directory updates. No delegation, push, merge, cloud/DB/object
actions, app/config/dependency changes, or built-in browser use.

## Required version and result

- `package.json`, lockfile resolution and existing installed package: Playwright
  **1.59.1**. `playwright.config.ts` uses `Desktop Chrome` for `e2e`; setup/API
  retain the default Chromium browser. No Firefox/WebKit/channel overrides were
  found in tests. Only Chromium was installed.
- macOS arm64; official Chromium and headless-shell **147.0.7727.15**, revision
  **1217**, installed in the normal `~/Library/Caches/ms-playwright` cache.
  Existing FFmpeg 1011 reused; unrelated revision 1243 retained.
- Default `chromium.launch({ timeout: 10000 })` now launches the required shell,
  without `channel`, `executablePath`, or system-browser substitution.
- Both shell and full Chromium passed synthetic data-URL JavaScript, layout and
  PNG checks at **360×800** and **1920×800**. Both exited code 0 and closed cleanly.

This worktree has no `node_modules`. All commands used the **already installed**
T02a dependency tree, with no pnpm invocation, package install, lifecycle scripts,
or symlink added. Paths below replace the home directory with `$HOME`:

```sh
PW_ROOT="$HOME/.t3/worktrees/vamotors/t3-7dfba052"
NODE22="$HOME/.local/share/fnm/node-versions/v22.22.3/installation/bin/node"
```

## Diagnosis and bounded correction

Initial default launch under Node **24.16.0**, 10-second launch / 20-second
process bounds, exited 1: executable missing at the shell path below. The cache
contained only `ABOUT` and `LICENSE.headless_shell`, not an installed shell.
No Playwright/download/proxy/TLS overrides were inherited. No installer process
was found; an old `__dirlock` existed, but the installer acquired the lock and
started downloading promptly. Lock contention was not the reproduced blocker.

Exact CLI argv, run from `$PW_ROOT`, with these environment additions:

```sh
PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT=60000 PLAYWRIGHT_SKIP_BROWSER_GC=1 \
  DEBUG=pw:install node node_modules/@playwright/test/cli.js install chromium
```

One invocation, **360-second process deadline**: official CDN HTTP 200, all
173,508,376 archive bytes received in about 31 seconds, then `extracting archive`
at 16:14:19 UTC with no completion. At 360 seconds the wrapper terminated its
process group; no installer children remained. Thus the reproduced timeout was
**local extraction after successful transfer**, not demonstrated network denial.
Earlier T02a timeouts are consistent with this, but lack equivalent debug logs.

`/usr/bin/unzip -tq "$ARCHIVE"` on that exact downloaded archive exited 0 in
2.7 seconds: no compressed-data errors. A differential used the installed
Playwright `lib/zipBundle.js` extractor on the **same archive**, in disposable
directories under the approved OpenCode temporary directory, with 15-second
process deadlines. `$CORE` denotes the installed
`node_modules/.pnpm/playwright-core@1.59.1/node_modules/playwright-core` directory;
`$ARCHIVE` was the first attempt's temporary Chromium ZIP:

```js
// node -e '<this source>' "$CORE/lib/zipBundle.js" "$ARCHIVE" "$DEST"
let done = false;
process.on('beforeExit', () => {
  if (!done) {
    console.error('FAIL extraction promise unresolved at beforeExit');
    process.exitCode = 1;
  }
});
require(process.argv[1]).extract(process.argv[2], { dir: process.argv[3] })
  .then(() => { done = true; console.log('PASS extraction complete'); })
  .catch(e => { done = true; console.error(e.message); process.exitCode = 1; });
```

| Runtime | Exact-archive differential result |
|---|---|
| Node 24.16.0 | exit 1, unresolved extraction promise, 0.08s, 83 partial entries |
| Node 22.22.3 | exit 0, extraction complete, 1.96s, 662 entries |

A separate 1 MiB synthetic ZIP extracted successfully with both runtimes. This
isolates runtime-sensitive extraction of the real archive, not all ZIP handling;
it does **not** establish the underlying Node/stream defect. The installer child
retains an IPC connection, unlike the standalone extractor, so its incomplete
extraction waited until the outer deadline.

Correction: same installed CLI, cache, official URLs and environment; change only
the invoking executable to the already installed Node 22.22.3:

```sh
PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT=60000 PLAYWRIGHT_SKIP_BROWSER_GC=1 \
  DEBUG=pw:install "$NODE22" node_modules/@playwright/test/cli.js install chromium
```

One invocation, **240-second process deadline**, exited **0 in 49.9s**
(16:20:43–16:21:32 UTC). Each archive succeeded on installer attempt #1:

- `https://cdn.playwright.dev/builds/cft/147.0.7727.15/mac-arm64/chrome-mac-arm64.zip`
  — HTTP 200, 173,508,376 bytes; extraction 1.9s.
- `https://cdn.playwright.dev/builds/cft/147.0.7727.15/mac-arm64/chrome-headless-shell-mac-arm64.zip`
  — HTTP 200, 96,491,915 bytes; extraction 0.9s.

Host validation passed for Chromium, FFmpeg and headless-shell. No mirror, TLS
weakening, manual extraction into cache, force install, or manual lock/cache
deletion. `PLAYWRIGHT_SKIP_BROWSER_GC=1` prevented removal of unrelated revisions.
The installer repaired its incomplete revision itself. No global Node selection
changed. Process bounds used Python `Popen(start_new_session=True)` and
`communicate(timeout=...)`; on timeout, SIGTERM to the process group, five-second
grace, then SIGKILL if needed. No polling, sleeps or retry loops were used.
Disposable extractor directories were cleaned automatically; only this run's
failed-attempt temporary ZIP and its empty directory were removed afterward.

## Real launch and rendering proof

Run from `$PW_ROOT` using ordinary **Node 24.16.0**, `DEBUG=pw:browser`, via
`node -e '<source below>'`. The enclosing Python `subprocess.run` had a 60-second
timeout. Exit **0 in 9.13s**, 16:22:11–16:22:20 UTC:

```js
const assert = require('node:assert/strict');
const { chromium } = require('./node_modules/@playwright/test');
(async () => {
  console.log('node=' + process.version + ' playwright=' + require('./node_modules/@playwright/test/package.json').version);
  for (const channel of [undefined, 'chromium']) {
    const browser = await chromium.launch({ timeout: 10000, ...(channel ? { channel } : {}) });
    try {
      console.log('mode=' + (channel || 'default-headless-shell') + ' browser=' + browser.version());
      for (const width of [360, 1920]) {
        const context = await browser.newContext({ viewport: { width, height: 800 }, deviceScaleFactor: 1 });
        try {
          const page = await context.newPage();
          await page.goto('data:text/html,' + encodeURIComponent(`<!doctype html><meta name="viewport" content="width=device-width"><style>body{margin:0}#probe{width:100%;height:80px;background:rgb(0,128,0)}@media(max-width:600px){#probe{height:120px}}</style><div id="probe">synthetic readiness</div><script>document.querySelector('#probe').textContent='JS rendered '+(6*7)</script>`), { timeout: 10000 });
          const rendered = await page.locator('#probe').evaluate(el => ({ text: el.textContent, width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height, color: getComputedStyle(el).backgroundColor, viewport: innerWidth }));
          assert.deepEqual(rendered, { text: 'JS rendered 42', width, height: width === 360 ? 120 : 80, color: 'rgb(0, 128, 0)', viewport: width });
          const png = await page.screenshot({ timeout: 10000 });
          assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
          assert.equal(png.readUInt32BE(16), width);
          assert.equal(png.readUInt32BE(20), 800);
          assert.ok(png.length > 1000);
          console.log(JSON.stringify({ result: 'PASS', ...rendered, screenshot: `${width}x800 PNG`, bytes: png.length }));
        } finally { await context.close(); }
      }
    } finally { await browser.close(); assert.equal(browser.isConnected(), false); console.log('closed cleanly'); }
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
```

All four assertions passed: text `JS rendered 42`, computed green background,
width equal to viewport, media-query height 120px at 360 / 80px at 1920, valid
PNG dimensions. Shell PNG sizes: 3,857 / 7,788 bytes; full Chromium: 3,855 /
7,786 bytes. Screenshots stayed in memory. Browser debug logs confirmed the
following executables, graceful close completion and process exit code 0:

```text
~/Library/Caches/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-mac-arm64/chrome-headless-shell
~/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing
```

Both files executable, both revision directories have `INSTALLATION_COMPLETE`,
and `__dirlock` is absent. SHA-256 (local identity, not independent authenticity
verification; the full-browser entry is the app launcher):

```text
shell:    a8a0ac2829aeaa132389b001640fb835bdc93a49fb7f26af0c3de0df3ee4d66f
launcher: 3ae4a8cdc0e8d19f8799d3031eca038459dcb1fb6879b8e28a6f0c4fb5f75fc2
```

## Handoff

Independent reviewer should rerun the default launch/render proof against the
installed 1.59.1 package and shared cache. Cache contents are environmental, not
part of the commit; retain an installed package reference or reprovision after
cache cleanup. No release tests were run and no v1 requirement is accepted here.
GSD command directories remain unavailable, as in T02a; this bounded dispatch is
recorded without claiming a GSD invocation or changing phase/ledger counters.

Current docs were resolved via Context7 `/microsoft/playwright/v1.59.0` (nearest
indexed version, not a package upgrade):
[official browser guidance](https://github.com/microsoft/playwright/blob/v1.59.0/docs/src/browsers.md).
The installed 1.59.1 CLI dry run supplied the exact versions, cache paths and CDN
URLs; its source confirmed extraction follows transfer and the GC opt-out.
