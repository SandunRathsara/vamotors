/** Own isolated local root only; build first. No reset, HTTP mocks or shared profile. */
import assert from "node:assert/strict"
import { spawn, execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { once } from "node:events"
import { mkdir, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import { join } from "node:path"
import { chromium, expect, type CDPSession, type Page } from "@playwright/test"
import { privateEnvironment } from "../../scripts/private-environment"
import { runtimeConfig } from "../../lib/server/config"
import type {
  RoleDTO,
  UserAdminDTO,
} from "../../.planning/implementation/contracts/api"

process.umask(0o077)
let stage = "initialization"
const passed: string[] = []
const install: Record<string, unknown> = {}
const assets = [
  "/offline.html",
  "/pwa-icon-192.png",
  "/pwa-icon-512.png",
  "/apple-touch-icon.png",
].sort()
async function group(name: string, run: () => Promise<void>) {
  stage = name
  await run()
  passed.push(name)
  console.log(`PASS ${name}`)
}

async function main() {
  const directory = process.argv[2]
  assert.ok(directory)
  const cluster = await privateEnvironment(join(directory, "cluster.env"))
  assert.equal(cluster.PROJECT, process.cwd(), "OWN_CHECKOUT_REQUIRED")
  const runtime = runtimeConfig(
    await privateEnvironment(join(directory, "runtime.env"))
  )
  assert.equal(runtime.APP_ENV, "local")
  assert.equal(new URL(runtime.DATABASE_URL).port, cluster.PORT)
  const accounts = await privateEnvironment(join(directory, "accounts.env"))
  const socket = createServer().listen(0, "127.0.0.1")
  await once(socket, "listening")
  const address = socket.address()
  assert.ok(address && typeof address !== "string")
  const port = address.port
  const origin = `http://127.0.0.1:${port}`
  await new Promise<void>((resolve) => socket.close(() => resolve()))
  let server: ReturnType<typeof spawn> | undefined
  let exited: Promise<unknown> | undefined
  async function startServer() {
    server = spawn(
      process.execPath,
      [
        "node_modules/next/dist/bin/next",
        "start",
        "--hostname",
        "127.0.0.1",
        "--port",
        String(port),
      ],
      {
        env: {
          ...process.env,
          ...runtime,
          APP_ORIGIN: origin,
          BETTER_AUTH_URL: origin,
          NODE_ENV: "production",
        },
        stdio: ["ignore", "pipe", "pipe"],
      }
    )
    server.stderr!.resume()
    exited = once(server, "exit")
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("SERVER_START_TIMEOUT")),
        20000
      )
      server!.once("exit", () => {
        clearTimeout(timer)
        reject(new Error("SERVER_EARLY_EXIT"))
      })
      server!.stdout!.on("data", (chunk: Buffer) => {
        if (chunk.toString().includes("Ready in")) {
          clearTimeout(timer)
          resolve()
        }
      })
    })
  }
  async function stopServer() {
    if (!server) return
    const child = server
    child.kill("SIGTERM")
    const timer = setTimeout(() => child.kill("SIGKILL"), 5000)
    await exited
    clearTimeout(timer)
    server = undefined
  }
  const profile = join(directory, `pwa-browser-${randomUUID()}`)
  await mkdir(profile, { mode: 0o700 })
  let context:
    | Awaited<ReturnType<typeof chromium.launchPersistentContext>>
    | undefined
  let restore: (() => Promise<void>) | undefined
  let installed = false
  const launch = () =>
    chromium.launchPersistentContext(profile, {
      channel: "chromium",
      headless: process.env.PWA_HEADED !== "1",
      baseURL: origin,
      serviceWorkers: "allow",
      viewport: { width: 1920, height: 900 },
    })
  async function controlled(page: Page) {
    await page.waitForFunction(
      () => navigator.serviceWorker.controller?.state === "activated"
    )
    const registration = await page.evaluate(async () => {
      const r = await navigator.serviceWorker.ready
      return {
        scope: r.scope,
        script: r.active?.scriptURL,
        cache: r.updateViaCache,
      }
    })
    assert.deepEqual(registration, {
      scope: `${origin}/`,
      script: `${origin}/sw.js`,
      cache: "none",
    })
  }
  async function launchInstalled(cdp: CDPSession) {
    const opened = context!.waitForEvent("page", { timeout: 15000 })
    // Also consume a timeout if the browser rejects launch before creating a target.
    void opened.catch(() => {})
    const result = await cdp.send("PWA.launch", { manifestId: `${origin}/` })
    assert.ok(result.targetId)
    const app = await opened
    await app.waitForURL((url) => url.origin === origin)
    await app.waitForLoadState("domcontentloaded")
    assert.equal(
      await app.evaluate(
        () => matchMedia("(display-mode: standalone)").matches
      ),
      true
    )
    await controlled(app)
    return app
  }
  async function publicCacheOnly(page: Page) {
    const storage = await page.evaluate(async () => {
      const names = await caches.keys()
      const entries = await Promise.all(
        names.map(async (name) => ({
          name,
          urls: (await (await caches.open(name)).keys())
            .map((r) => r.url)
            .sort(),
        }))
      )
      return {
        entries,
        databases: (await indexedDB.databases()).map((db) => db.name),
      }
    })
    assert.deepEqual(storage.entries, [
      {
        name: "vamotors-public-shell-v1",
        urls: assets.map((path) => `${origin}${path}`),
      },
    ])
    assert.deepEqual(storage.databases, [], "NO_OFFLINE_WRITE_DATABASE")
    return storage
  }
  async function browserFetch(
    page: Page,
    path: string,
    init: RequestInit = {}
  ) {
    return page.evaluate(
      async ({ path, init }) => {
        try {
          const r = await fetch(path, init)
          return {
            status: r.status,
            cache: r.headers.get("cache-control"),
            type: r.headers.get("content-type"),
            body: await r.text(),
          }
        } catch {
          return { status: 0, cache: null, type: null, body: "" }
        }
      },
      { path, init }
    )
  }
  async function login(page: Page, who: "ADMIN" | "SECOND") {
    await page.bringToFront()
    await page.goto("/login")
    await page
      .getByLabel("Email Address")
      .fill(accounts[`BOOTSTRAP_${who}_EMAIL`]!)
    await page
      .getByLabel("Password", { exact: true })
      .fill(accounts[`BOOTSTRAP_${who}_PASSWORD`]!)
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/auth/sign-in/email") &&
        r.request().method() === "POST"
    )
    await page.getByRole("button", { name: "Sign In", exact: true }).click()
    assert.equal((await response).status(), 200)
    await page.waitForURL("**/dashboard")
    await page.goto("/users")
    await expect(
      page.getByRole("heading", { name: "Users & Roles", exact: true })
    ).toBeVisible()
    await controlled(page)
  }
  async function offlineShell(page: Page, path = "/users") {
    const response = await page.goto(path)
    assert.ok(response?.fromServiceWorker())
    await expect(
      page.getByRole("heading", { name: "Unavailable offline", exact: true })
    ).toBeVisible()
    assert.ok(
      !(await page.locator("body").innerText()).includes(
        accounts.BOOTSTRAP_SECOND_EMAIL!
      )
    )
    assert.equal(await page.locator("form, input, button").count(), 0)
    await publicCacheOnly(page)
  }
  try {
    await startServer()
    context = await launch()
    const observer = await context.browser()!.newContext({ baseURL: origin })
    const page = context.pages()[0] ?? (await context.newPage())
    const other = await observer.newPage()
    await group(
      "manifest, PNG dimensions, Apple metadata and active root-controlled worker",
      async () => {
        await page.goto("/login")
        await controlled(page)
        await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
          "href",
          "/manifest.webmanifest"
        )
        await expect(
          page.locator('link[rel="apple-touch-icon"]')
        ).toHaveAttribute("href", "/apple-touch-icon.png")
        const response = await context!.request.get("/manifest.webmanifest")
        assert.match(
          response.headers()["content-type"],
          /application\/manifest\+json/
        )
        const manifest = await response.json()
        assert.equal(manifest.id, "/")
        assert.equal(manifest.start_url, "/")
        assert.equal(manifest.scope, "/")
        assert.equal(manifest.display, "standalone")
        for (const [path, size] of [
          ["/pwa-icon-192.png", 192],
          ["/pwa-icon-512.png", 512],
          ["/apple-touch-icon.png", 180],
        ] as const) {
          const image = await context!.request.get(path)
          assert.equal(image.status(), 200)
          assert.match(image.headers()["content-type"], /image\/png/)
          const bytes = await image.body()
          assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a")
          assert.equal(bytes.readUInt32BE(16), size)
          assert.equal(bytes.readUInt32BE(20), size)
        }
        const cdp = await context!.newCDPSession(page)
        const parsed = await cdp.send("Page.getAppManifest")
        assert.deepEqual(parsed.errors, [])
        const eligibility = await cdp.send("Page.getInstallabilityErrors")
        assert.deepEqual(eligibility.installabilityErrors, [])
        install.eligibility = "Chrome CDP: zero manifest/installability errors"
        await cdp.detach()
        await publicCacheOnly(page)
      }
    )
    await group(
      "two real UI logins and current private HTML/RSC/API/session no-store boundaries",
      async () => {
        await login(page, "SECOND")
        await login(other, "ADMIN")
        const first = await browserFetch(page, "/api/v1/queries/currentActor")
        const second = await browserFetch(other, "/api/v1/queries/currentActor")
        assert.notEqual(
          JSON.parse(first.body).data.user.id,
          JSON.parse(second.body).data.user.id
        )
        for (const path of [
          "/users",
          "/users?_rsc=t17b",
          "/api/v1/queries/users",
          "/api/auth/get-session",
          "/api/reports/profit",
          "/api/private/document.pdf?signature=t17b",
        ]) {
          const response = await browserFetch(
            page,
            path,
            path.includes("_rsc") ? { headers: { RSC: "1" } } : {}
          )
          assert.match(response.cache ?? "", /no-store/)
          assert.ok(response.status > 0)
          assert.ok(!response.body.includes("Unavailable offline"))
        }
        await publicCacheOnly(page)
        await publicCacheOnly(other)
      }
    )
    await group(
      "actual CDP install/launch attempt restricted to disposable profile (capability gap recorded if unsupported)",
      async () => {
        const cdp = await context!.newCDPSession(page)
        try {
          await cdp.send("PWA.install", {
            manifestId: `${origin}/`,
            installUrlOrBundleUrl: `${origin}/login`,
          })
          installed = true
          install.installed = true
          // Make the install choice explicit in this disposable profile only.
          await cdp.send("PWA.changeAppUserSettings", {
            manifestId: `${origin}/`,
            displayMode: "standalone",
          })
          install.displayModePreference = "standalone"
          const app = await launchInstalled(cdp)
          install.launchStandalone = true
          assert.equal(
            (await browserFetch(app, "/api/v1/queries/currentActor")).status,
            200
          )
          await publicCacheOnly(app)
          await app.close()
        } catch (error) {
          install.installed = installed
          install.gap =
            error instanceof Error
              ? error.message
              : "CDP installation/launch unsupported"
        } finally {
          await cdp.detach()
        }
        await page.bringToFront()
      }
    )
    const intention = `T17b offline ${randomUUID()}`
    let commandRequests = 0
    page.on("request", (request) => {
      if (
        request.url().endsWith("/api/v1/commands/saveRole") &&
        request.method() === "POST"
      )
        commandRequests++
    })
    await group(
      "offline private navigation, API/RSC/download failure and no queued mutation",
      async () => {
        // Stop the actual server too: Chromium worker traffic may bypass page offline emulation.
        await stopServer()
        await context!.setOffline(true)
        const result = await browserFetch(page, "/api/v1/commands/saveRole", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            schemaVersion: 1,
            idempotencyKey: randomUUID(),
            expected: [],
            input: {
              name: intention,
              grants: [],
              reason: "Must never commit offline",
            },
          }),
        })
        assert.equal(result.status, 0)
        for (const path of [
          "/api/v1/queries/users",
          "/api/auth/get-session",
          "/report.csv",
          "/invoice.pdf",
          "/api/private/download?signature=private",
          "/pwa-icon-192.png?signature=private",
        ])
          assert.equal((await browserFetch(page, path)).status, 0)
        assert.equal(
          (
            await browserFetch(page, "/users?_rsc=offline", {
              headers: { RSC: "1" },
            })
          ).status,
          0
        )
        await offlineShell(page, "/users?private=filter")
        for (const path of ["/login", "/customers", "/purchases"])
          await offlineShell(page, path)
      }
    )
    await group(
      "public offline shell at 360/1920px: keyboard, landmarks, image, 44px target and no overflow",
      async () => {
        for (const width of [360, 1920]) {
          await page.setViewportSize({ width, height: 900 })
          await expect(page.getByRole("main")).toBeVisible()
          await expect(
            page.getByRole("img", { name: "VA Motors" })
          ).toBeVisible()
          await page.keyboard.press("Tab")
          const reopen = page.getByRole("link", {
            name: "Reopen VA Motors",
            exact: true,
          })
          await reopen.focus()
          await expect(reopen).toBeFocused()
          assert.ok((await reopen.boundingBox())!.height >= 44)
          assert.equal(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth
            ),
            true
          )
          assert.equal(await page.locator("html").getAttribute("lang"), "en")
          await page.screenshot({
            path: join(directory, `pwa-offline-${width}.png`),
            fullPage: true,
          })
        }
      }
    )
    async function noQueuedWrite() {
      const query = await observer.request.get(
        `/api/v1/queries/roles?q=${encodeURIComponent(intention)}`
      )
      assert.equal(query.status(), 200)
      assert.equal((await query.json()).data.total, 0)
      assert.equal(commandRequests, 1)
    }
    await group(
      "reconnection does not replay writes; real logout preserves anonymous online denial and generic offline fallback",
      async () => {
        await startServer()
        await context!.setOffline(false)
        await page.goto("/users")
        await expect(
          page.getByRole("heading", { name: "Users & Roles", exact: true })
        ).toBeVisible()
        await noQueuedWrite()
        await page.getByRole("button", { name: "Logout", exact: true }).click()
        await page.waitForURL(/\/login(?:\?|$)/)
        assert.equal(
          (await browserFetch(page, "/api/v1/queries/users")).status,
          401
        )
        await page.goBack()
        await page.waitForURL(/\/login(?:\?|$)/)
        await stopServer()
        await context!.setOffline(true)
        await offlineShell(page)
        await startServer()
        await context!.setOffline(false)
        await page.goto("/users")
        await page.waitForURL(/\/login(?:\?|$)/)
        await publicCacheOnly(page)
      }
    )
    await group(
      "real same-cookie permission revocation cannot recover old private bytes through worker",
      async () => {
        await login(page, "SECOND")
        const query = async <T>(name: string): Promise<T> => {
          const r = await observer.request.get(`/api/v1/queries/${name}`)
          assert.equal(r.status(), 200)
          return (await r.json()).data
        }
        const command = async (
          name: string,
          input: unknown,
          expected: unknown[] = []
        ) => {
          const r = await observer.request.post(`/api/v1/commands/${name}`, {
            headers: { origin },
            data: {
              schemaVersion: 1,
              idempotencyKey: randomUUID(),
              input,
              expected,
            },
          })
          assert.ok(r.ok(), `COMMAND_${r.status()}`)
        }
        const actor = JSON.parse(
          (await browserFetch(page, "/api/v1/queries/currentActor")).body
        ).data
        const target = await query<UserAdminDTO>(`user?id=${actor.user.id}`)
        const name = `T17b revoked ${randomUUID()}`
        await command("saveRole", {
          name,
          grants: [],
          reason: "PWA isolation test",
        })
        const role = (
          await query<{ data: RoleDTO[] }>(
            `roles?q=${encodeURIComponent(name)}`
          )
        ).data[0]
        const assign = async (roles: RoleDTO[]) => {
          const current = await query<UserAdminDTO>(`user?id=${target.id}`)
          await command(
            "updateUser",
            {
              id: target.id,
              name: target.name,
              active: true,
              roleIds: roles.map((r) => r.id),
              reason: "PWA revocation/restoration test",
            },
            [
              { type: "User", id: current.id, revision: current.revision },
              ...roles.map((r) => ({
                type: "Role",
                id: r.id,
                revision: r.revision,
              })),
            ]
          )
        }
        const originals = await Promise.all(
          target.roles.map((r) => query<RoleDTO>(`role?id=${r.id}`))
        )
        restore = () => assign(originals)
        await assign([role])
        assert.equal(
          (await browserFetch(page, "/api/v1/queries/users")).status,
          404
        )
        const rsc = await browserFetch(page, "/users?_rsc=revoked", {
          headers: { RSC: "1" },
        })
        assert.match(rsc.cache ?? "", /no-store/)
        assert.ok(!rsc.body.includes(accounts.BOOTSTRAP_SECOND_EMAIL!))
        await page.goto("/users")
        await page.waitForURL("**/login?reason=forbidden")
        await stopServer()
        await context!.setOffline(true)
        await offlineShell(page)
        await startServer()
        await context!.setOffline(false)
        assert.equal(
          (
            await context!.request.post("/api/auth/sign-out", {
              headers: { origin },
              data: {},
            })
          ).status(),
          200
        )
        await restore()
        restore = undefined
        await noQueuedWrite()
        await publicCacheOnly(page)
      }
    )
    await observer.close()
    const browserVersion = context.browser()!.version()
    await group(
      "browser process restart retains only public shell and root worker; offline relaunch stays anonymous",
      async () => {
        await context!.close()
        await stopServer()
        context = await launch()
        await context.setOffline(true)
        const relaunched = context.pages()[0] ?? (await context.newPage())
        await offlineShell(relaunched, "/")
        await controlled(relaunched)
        if (installed) {
          const cdp = await context.newCDPSession(relaunched)
          try {
            const app = await launchInstalled(cdp)
            await expect(
              app.getByRole("heading", {
                name: "Unavailable offline",
                exact: true,
              })
            ).toBeVisible()
            await publicCacheOnly(app)
            install.relaunchOfflineStandalone = true
            await app.close()
          } catch (error) {
            install.relaunchGap =
              error instanceof Error
                ? error.message
                : "PWA relaunch unsupported"
          } finally {
            await cdp.detach()
          }
        }
        await startServer()
        await context.setOffline(false)
        await relaunched.goto("/users")
        await relaunched.waitForURL(/\/login(?:\?|$)/)
        assert.equal(
          (await browserFetch(relaunched, "/api/v1/queries/currentActor"))
            .status,
          401
        )
        await publicCacheOnly(relaunched)
      }
    )
    await writeFile(
      join(directory, "t17b-pwa-evidence.json"),
      JSON.stringify(
        {
          sha: execFileSync("git", ["rev-parse", "HEAD"], {
            encoding: "utf8",
          }).trim(),
          dirty: !!execFileSync("git", ["status", "--porcelain"], {
            encoding: "utf8",
          }).trim(),
          passed,
          install,
          browserVersion,
          headed: process.env.PWA_HEADED === "1",
          transport:
            "Production Next; own PostgreSQL; real UI sessions in two contexts; actual app-server stops plus browser offline emulation; same disposable profile process restart; no HTTP mocks",
          limits: [
            "No mobile/tablet physical device or human OS install gesture evidence",
            "No whole T17/FNDN-09/NFNL-02 acceptance",
            "No hosted HTTPS/deployment verification",
          ],
        },
        null,
        2
      ),
      { mode: 0o600 }
    )
  } finally {
    try {
      if (restore && !server) await startServer()
      await restore?.()
    } finally {
      try {
        if (context) {
          try {
            if (installed) {
              const cleanup = await context.newPage()
              const cdp = await context.newCDPSession(cleanup)
              await cdp.send("PWA.uninstall", { manifestId: `${origin}/` })
              await cdp.detach()
            }
          } finally {
            await context.close()
          }
        }
      } finally {
        await stopServer()
      }
    }
  }
}

main().catch(async (error: unknown) => {
  if (process.argv[2])
    await writeFile(
      join(process.argv[2], "t17b-pwa-private-failure.log"),
      error instanceof Error ? (error.stack ?? error.message) : "Unknown error",
      { mode: 0o600 }
    )
  console.error(
    `FAIL ${stage}; private diagnostics retained, no credentials emitted`
  )
  process.exitCode = 1
})
