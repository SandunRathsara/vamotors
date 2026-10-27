/** Run after build with PRIVATE_DIRECTORY; real Chromium -> production Next -> PostgreSQL. */
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { spawn, execFileSync } from "node:child_process"
import { once } from "node:events"
import { createServer } from "node:net"
import { join } from "node:path"
import { writeFile, readFile } from "node:fs/promises"
import {
  chromium,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test"
import { privateEnvironment } from "../../scripts/private-environment"
import { runtimeConfig } from "../../lib/server/config"
import pg from "pg"
import {
  legacyAPIs,
  unavailablePages,
  concrete,
  methods,
  queryNames,
  commandNames,
  guessedID,
} from "./route-inventory"
import type {
  RoleDTO,
  UserAdminDTO,
  CurrentActorDTO,
} from "../../.planning/implementation/contracts/api"

let stage = "initialization"
const passed: string[] = []
async function group(name: string, run: () => Promise<void>) {
  stage = name
  await run()
  passed.push(name)
  console.log(`PASS ${name}`)
}
async function main() {
  const directory = process.argv[2]
  assert.ok(directory)
  const runtime = runtimeConfig(
    await privateEnvironment(join(directory, "runtime.env"))
  )
  assert.equal(runtime.APP_ENV, "local")
  const accounts = await privateEnvironment(join(directory, "accounts.env"))
  const credential = (key: string) => {
    const value = accounts[`BOOTSTRAP_${key}`]
    assert.ok(value)
    return value
  }
  const socket = createServer().listen(0, "127.0.0.1")
  await once(socket, "listening")
  const address = socket.address()
  assert.ok(address && typeof address !== "string")
  const origin = `http://127.0.0.1:${address.port}`
  await new Promise<void>((resolve) => socket.close(() => resolve()))
  const server = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(address.port),
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
  server.stderr.resume()
  const exited = once(server, "exit")
  const browser = await chromium.launch({ headless: true })
  const admin = await browser.newContext({ baseURL: origin })
  const other = await browser.newContext({ baseURL: origin })
  const anonymous = await browser.newContext({ baseURL: origin })
  const a = await admin.newPage()
  const b = await other.newPage()
  const checkCache = (headers: Record<string, string>) =>
    assert.match(headers["cache-control"] ?? "", /no-store/)
  async function query<T>(
    client: APIRequestContext,
    name: string,
    params = ""
  ): Promise<T> {
    const response = await client.get(`/api/v1/queries/${name}${params}`)
    assert.equal(response.status(), 200)
    checkCache(response.headers())
    return (await response.json()).data as T
  }
  async function post(
    client: APIRequestContext,
    name: string,
    input: unknown,
    expected: unknown[] = [],
    key = randomUUID()
  ) {
    return client.post(`/api/v1/commands/${name}`, {
      headers: { origin },
      data: { schemaVersion: 1, idempotencyKey: key, expected, input },
    })
  }
  async function login(page: Page, email: string, password: string) {
    await page.goto("/login")
    await page.getByLabel("Email Address").fill(email)
    await page.getByLabel("Password", { exact: true }).fill(password)
    for (let attempt = 0; ; attempt++) {
      const response = page.waitForResponse(
        (r) =>
          r.url().endsWith("/api/auth/sign-in/email") &&
          r.request().method() === "POST"
      )
      await page.getByRole("button", { name: "Sign In", exact: true }).click()
      const result = await response
      if (result.status() !== 429 || attempt >= 2) {
        assert.equal(result.status(), 200, "UI_LOGIN_HTTP_STATUS")
        break
      }
      // Honor the unchanged real library limiter, never disable/bypass it.
      const seconds = Math.min(
        120,
        Math.max(1, Number(result.headers()["retry-after"] ?? 10))
      )
      await new Promise((resolve) => setTimeout(resolve, seconds * 1000 + 100))
    }
    await page.waitForURL("**/dashboard")
    await expect(
      page.getByRole("heading", { name: "Unavailable", exact: true })
    ).toBeVisible()
  }
  async function logout(page: Page) {
    await page.getByRole("button", { name: "Logout", exact: true }).click()
    await page.waitForURL(/\/login(?:\?|$)/)
    await expect(
      page.getByRole("button", { name: "Sign In", exact: true })
    ).toBeVisible()
  }
  async function createRole(name: string, grants: unknown[]) {
    await a.getByRole("button", { name: "Roles", exact: true }).click()
    await a.getByRole("button", { name: "Add Role", exact: true }).click()
    await a.getByLabel("Role name", { exact: true }).fill(name)
    await a
      .getByLabel("Grants (JSON array)", { exact: true })
      .fill(JSON.stringify(grants))
    await a
      .getByLabel("Reason", { exact: true })
      .fill("Synthetic bounded UI check")
    await a.getByRole("button", { name: "Save Role", exact: true }).click()
    await expect(a.getByRole("dialog")).toBeHidden()
  }
  const suffix = randomUUID().slice(0, 8)
  const roleName = `T03b ${suffix} Alpha`
  const roleTwoName = `T03b ${suffix} Beta`
  const userName = `T03b ${suffix} User`
  const userEmail = `${randomUUID()}@example.test`
  const userPassword = `${randomUUID()}Aa!`
  let user: UserAdminDTO
  let role: RoleDTO
  let archivedRoleId: string
  let second: CurrentActorDTO
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("SERVER_START_TIMEOUT")),
        20000
      )
      server.once("exit", () => {
        clearTimeout(timer)
        reject(new Error("SERVER_EARLY_EXIT"))
      })
      server.stdout.on("data", (chunk: Buffer) => {
        if (chunk.toString().includes("Ready in")) {
          clearTimeout(timer)
          resolve()
        }
      })
    })
    if (process.argv[3] === "--portals") {
      const accessibilityErrors: string[] = []
      let transitionLeaks = 0
      await b.exposeFunction("recordPrivatePortalLeak", () => {
        transitionLeaks++
      })
      b.on("console", (message) => {
        if (/flushSync|aria-hidden|focus trap/i.test(message.text()))
          accessibilityErrors.push(message.type())
      })
      // Own isolated cluster only; never use an author's/reviewer's database.
      const cluster = await privateEnvironment(join(directory, "cluster.env"))
      assert.equal(cluster.PROJECT, process.cwd())
      const owner = await privateEnvironment(join(directory, "admin.env"))
      const url = new URL(owner.ADMIN_URL!)
      assert.equal(url.hostname, "127.0.0.1")
      assert.equal(url.port, cluster.PORT)
      url.pathname = new URL(runtime.DATABASE_URL).pathname
      const lock = new pg.Client({ connectionString: url.href })
      const observer = new pg.Client({ connectionString: url.href })
      await lock.connect()
      await observer.connect()
      try {
        await login(a, credential("ADMIN_EMAIL"), credential("ADMIN_PASSWORD"))
        await login(
          b,
          credential("SECOND_EMAIL"),
          credential("SECOND_PASSWORD")
        )
        const actor = await query<CurrentActorDTO>(
          other.request,
          "currentActor"
        )
        const target = await query<UserAdminDTO>(
          admin.request,
          "user",
          `?id=${actor.user.id}`
        )
        const privateEmail = target.email!
        assert.ok(privateEmail)
        const roles = await query<{ data: RoleDTO[] }>(admin.request, "roles")
        const protectedRole = roles.data.find(
          (r) => r.systemKey === "ADMINISTRATOR"
        )!
        assert.ok(protectedRole)
        const customResponse = await post(admin.request, "saveRole", {
          name: roleName,
          grants: [],
          reason: "Portal regression fixture",
        })
        assert.equal(customResponse.status(), 201)
        const custom = (
          await query<{ data: RoleDTO[] }>(
            admin.request,
            "roles",
            `?q=${suffix}`
          )
        ).data[0]
        roles.data.push(custom)
        async function open(kind: "user" | "role", fresh = false) {
          await b.goto("/users")
          if (kind === "role")
            await b.getByRole("button", { name: "Roles", exact: true }).click()
          if (fresh)
            await b
              .getByRole("button", {
                name: kind === "user" ? "Add User" : "Add Role",
                exact: true,
              })
              .click()
          else
            await b
              .getByRole("button", {
                name: `Edit ${kind === "user" ? target.name : custom.name}`,
                exact: true,
              })
              .click()
          await expect(b.getByRole("dialog")).toBeVisible()
          await b
            .getByLabel(kind === "user" ? "Name" : "Role name", { exact: true })
            .fill("Private retained draft")
          if (!fresh || kind === "role")
            await b
              .getByLabel("Reason", { exact: true })
              .fill("Uncontrolled private reason")
          if (kind === "role")
            await b
              .getByLabel("Grants (JSON array)")
              .fill('[{"subject":"User","action":"read","fields":["id"]}]')
          if (kind === "user" && fresh) {
            await b
              .getByLabel("Email", { exact: true })
              .fill("private-draft@example.test")
            await b
              .getByLabel("Initial password")
              .fill("PrivateUnsavedPassword123!")
          }
        }
        async function hidden() {
          await expect(b.getByRole("dialog")).toHaveCount(0)
          await expect(b.locator('[data-slot="sheet-overlay"]')).toBeHidden()
          await expect(
            b.getByRole("status").filter({ hasText: "Checking access" })
          ).toBeVisible()
          assert.ok(
            !(await b.locator("body").innerText()).includes(privateEmail)
          )
          assert.ok(
            !(await b.locator("body").ariaSnapshot()).includes(
              "Private retained draft"
            )
          )
          await b.keyboard.press("Tab")
          assert.equal(
            await b.evaluate(() => {
              const el = document.activeElement
              return (
                el instanceof HTMLElement && !!el.closest('[role="dialog"]')
              )
            }),
            false,
            "HIDDEN_DIALOG_MUST_NOT_TRAP_FOCUS"
          )
        }
        async function hold(run: () => Promise<void>) {
          await lock.query("BEGIN")
          await lock.query(
            "SET LOCAL idle_in_transaction_session_timeout = '20s'"
          )
          await lock.query(
            'LOCK TABLE vamotors."user" IN ACCESS EXCLUSIVE MODE'
          )
          try {
            await run()
          } finally {
            await lock.query("ROLLBACK")
          }
        }
        for (const kind of ["user", "role"] as const)
          for (const fresh of [false, true]) {
            await group(
              `${fresh ? "new" : "existing"} ${kind}: blur + real DB-blocked focus hides all portals; same identity restores draft and keyboard focus`,
              async () => {
                await open(kind, fresh)
                const identityResponse = b.waitForResponse((r) =>
                  r.url().endsWith("/api/v1/queries/currentActor")
                )
                await hold(async () => {
                  await b.evaluate(() =>
                    window.dispatchEvent(new Event("blur"))
                  )
                  await hidden()
                  await b.evaluate(() =>
                    window.dispatchEvent(new Event("focus"))
                  )
                  await expect
                    .poll(async () =>
                      Number(
                        (
                          await observer.query(
                            "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'"
                          )
                        ).rows[0].count
                      )
                    )
                    .toBeGreaterThan(0)
                  await hidden()
                  // Several paints with a real unresolved currentActor query, not an HTTP mock.
                  await b.evaluate(
                    () =>
                      new Promise<void>((resolve) =>
                        requestAnimationFrame(() =>
                          requestAnimationFrame(() => resolve())
                        )
                      )
                  )
                  await hidden()
                  // A response that finishes after a later blur must not reveal old UI.
                  await b.evaluate(() =>
                    window.dispatchEvent(new Event("blur"))
                  )
                })
                await (await identityResponse).finished()
                await b.evaluate(
                  () =>
                    new Promise<void>((resolve) =>
                      requestAnimationFrame(() =>
                        requestAnimationFrame(() => resolve())
                      )
                    )
                )
                await hidden()
                await b.evaluate(() =>
                  window.dispatchEvent(new Event("auth-check"))
                )
                await hidden()
                await b.evaluate(() => window.dispatchEvent(new Event("focus")))
                const field = b.getByLabel(
                  kind === "user" ? "Name" : "Role name",
                  { exact: true }
                )
                await expect(field).toBeVisible()
                await expect(field).toHaveValue("Private retained draft")
                if (!fresh || kind === "role")
                  await expect(
                    b.getByLabel("Reason", { exact: true })
                  ).toHaveValue("Uncontrolled private reason")
                if (kind === "role")
                  await expect(b.getByLabel("Grants (JSON array)")).toHaveValue(
                    '[{"subject":"User","action":"read","fields":["id"]}]'
                  )
                if (kind === "user" && fresh) {
                  await expect(
                    b.getByLabel("Email", { exact: true })
                  ).toHaveValue("private-draft@example.test")
                  await expect(b.getByLabel("Initial password")).toHaveValue(
                    "PrivateUnsavedPassword123!"
                  )
                }
                await expect
                  .poll(() =>
                    b.evaluate(
                      () => !!document.activeElement?.closest('[role="dialog"]')
                    )
                  )
                  .toBe(true)
                await field.focus()
                await b.keyboard.press("Tab")
                assert.equal(
                  await b.evaluate(
                    () => !!document.activeElement?.closest('[role="dialog"]')
                  ),
                  true
                )
                await b.keyboard.press("Escape")
                await expect(b.getByRole("dialog")).toHaveCount(0)
              }
            )
          }
        await group(
          "mobile private sidebar portal hides during real DB-blocked focus and restores keyboard access",
          async () => {
            await b.goto("/users")
            await b.setViewportSize({ width: 375, height: 812 })
            await b
              .getByRole("button", { name: "Toggle Sidebar", exact: true })
              .click()
            await expect(b.getByRole("dialog")).toBeVisible()
            await hold(async () => {
              await b.evaluate(() => window.dispatchEvent(new Event("blur")))
              await hidden()
              await b.evaluate(() => window.dispatchEvent(new Event("focus")))
              await expect
                .poll(async () =>
                  Number(
                    (
                      await observer.query(
                        "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'"
                      )
                    ).rows[0].count
                  )
                )
                .toBeGreaterThan(0)
              await hidden()
            })
            await expect(b.getByRole("dialog")).toBeVisible()
            await b.keyboard.press("Escape")
            await expect(b.getByRole("dialog")).toHaveCount(0)
            await b.setViewportSize({ width: 1280, height: 900 })
          }
        )
        async function change(active: boolean, roleIds: string[]) {
          const current = await query<UserAdminDTO>(
            admin.request,
            "user",
            `?id=${target.id}`
          )
          assert.equal(
            (
              await post(
                admin.request,
                "updateUser",
                {
                  id: target.id,
                  name: target.name,
                  active,
                  roleIds,
                  reason: "Isolated portal access-loss regression",
                },
                [
                  { type: "User", id: target.id, revision: current.revision },
                  ...roles.data
                    .filter((r) => roleIds.includes(r.id))
                    .map((r) => ({
                      type: "Role",
                      id: r.id,
                      revision: r.revision,
                    })),
                ]
              )
            ).status(),
            200
          )
        }
        async function gone() {
          await expect(b.locator('[data-slot="sheet-content"]')).toHaveCount(0)
          assert.ok(
            !(await b.locator("body").innerText()).includes(
              "Private retained draft"
            )
          )
          assert.ok(
            !(await b.locator("body").innerText()).includes(privateEmail)
          )
        }
        for (const kind of ["user", "role"] as const) {
          for (const loss of [
            "permission",
            "deactivation",
            "logout",
            "account switch",
          ] as const) {
            await group(
              `${kind} dialog: confirmed ${loss} removes old identity private state`,
              async () => {
                await open(kind)
                await b.evaluate(() => window.dispatchEvent(new Event("blur")))
                await hidden()
                // Raw browser JS avoids tsx's Node-only function-name helper.
                await b.evaluate(`requestAnimationFrame(function watch() {
                  if ([...document.querySelectorAll('[data-slot="sheet-content"], [data-slot="sheet-overlay"]')].some(node => node.checkVisibility())) {
                    void window.recordPrivatePortalLeak()
                  }
                  requestAnimationFrame(watch)
                })`)
                try {
                  if (loss === "permission") await change(true, [custom.id])
                  if (loss === "deactivation")
                    await change(
                      false,
                      target.roles.map((r) => r.id)
                    )
                  if (loss === "logout" || loss === "account switch") {
                    assert.equal(
                      (
                        await other.request.post("/api/auth/sign-out", {
                          headers: { origin },
                          data: {},
                        })
                      ).status(),
                      200
                    )
                    if (loss === "account switch") {
                      const response = await other.request.post(
                        "/api/auth/sign-in/email",
                        {
                          headers: { origin },
                          data: {
                            email: credential("STAFF_EMAIL"),
                            password: credential("STAFF_PASSWORD"),
                          },
                        }
                      )
                      assert.equal(response.status(), 200)
                    }
                  }
                  await b.evaluate(() =>
                    window.dispatchEvent(new Event("focus"))
                  )
                  await b.waitForURL(/\/login(?:\?|$)/)
                  await gone()
                  assert.equal(
                    transitionLeaks,
                    0,
                    "NO_PRIVATE_PORTAL_PAINT_DURING_ACCESS_LOSS"
                  )
                  await b.goBack()
                  await b.waitForURL(/\/(?:login(?:\?|$)|dashboard$)/)
                  await gone()
                } finally {
                  // Unload any history-restored auth boundary before signing out;
                  // its in-flight check must not race the next fixture login.
                  await b.goto("/login")
                  await expect(
                    b.getByRole("button", { name: "Sign In", exact: true })
                  ).toBeVisible()
                  if (loss === "permission" || loss === "deactivation")
                    await change(
                      true,
                      target.roles.map((r) => r.id)
                    )
                  await other.request.post("/api/auth/sign-out", {
                    headers: { origin },
                    data: {},
                  })
                  await login(
                    b,
                    credential("SECOND_EMAIL"),
                    credential("SECOND_PASSWORD")
                  )
                }
                await b.goto("/users")
                await expect(
                  b.getByRole("heading", { name: "Users & Roles", exact: true })
                ).toBeVisible()
                await expect(b.getByRole("dialog")).toHaveCount(0)
              }
            )
          }
        }
        for (const kind of ["user", "role"] as const)
          await group(
            `${kind} dialog: another tab's real UI logout broadcasts immediate discard`,
            async () => {
              await open(kind)
              const tab = await other.newPage()
              try {
                await tab.goto("/dashboard")
                await logout(tab)
                await b.waitForURL(/\/login(?:\?|$)/)
                await gone()
              } finally {
                await tab.close()
              }
              await login(
                b,
                credential("SECOND_EMAIL"),
                credential("SECOND_PASSWORD")
              )
            }
          )
        assert.deepEqual(
          accessibilityErrors,
          [],
          "NO_FOCUS_OR_FLUSHSYNC_WARNINGS"
        )
        await writeFile(
          join(directory, "t03b-portals-evidence.json"),
          JSON.stringify(
            {
              sha: execFileSync("git", ["rev-parse", "HEAD"], {
                encoding: "utf8",
              }).trim(),
              dirty: !!execFileSync("git", ["status", "--porcelain"], {
                encoding: "utf8",
              }).trim(),
              passed,
              transport:
                "production Next; isolated Chromium; owned PostgreSQL ACCESS EXCLUSIVE lock; no HTTP mocks",
            },
            null,
            2
          ),
          { mode: 0o600 }
        )
      } finally {
        await lock.end()
        await observer.end()
      }
      return
    }
    if (process.argv[3] === "--verify-retained") {
      const evidence = JSON.parse(
        await readFile(join(directory, "t03b-production-evidence.json"), "utf8")
      ) as {
        retained: { userId: string; roleId: string; archivedRoleId: string }
      }
      await group(
        "app/DB restart retains UI-created user, role revisions/grants/archive and restored administrator",
        async () => {
          await login(
            a,
            credential("ADMIN_EMAIL"),
            credential("ADMIN_PASSWORD")
          )
          const retained = await query<UserAdminDTO>(
            admin.request,
            "user",
            `?id=${evidence.retained.userId}`
          )
          assert.equal(retained.active, false)
          assert.ok(retained.name.endsWith("Updated"))
          assert.ok(retained.revision > 1)
          assert.equal(retained.roles.length, 1)
          const custom = await query<RoleDTO>(
            admin.request,
            "role",
            `?id=${evidence.retained.roleId}`
          )
          assert.ok(custom.revision > 1)
          assert.deepEqual(custom.grants[0].fields, ["id"])
          assert.equal(
            (
              await query<RoleDTO>(
                admin.request,
                "role",
                `?id=${evidence.retained.archivedRoleId}`
              )
            ).active,
            false
          )
          await login(
            b,
            credential("SECOND_EMAIL"),
            credential("SECOND_PASSWORD")
          )
          assert.ok(
            (await query<{ total: number }>(other.request, "users")).total > 1
          )
          await logout(a)
          await logout(b)
        }
      )
      await writeFile(
        join(directory, "t03b-restart-evidence.json"),
        JSON.stringify(
          {
            sha: execFileSync("git", ["rev-parse", "HEAD"], {
              encoding: "utf8",
            }).trim(),
            passed,
          },
          null,
          2
        ),
        { mode: 0o600 }
      )
      return
    }
    await group(
      "anonymous complete route/method + page/RSC inventory; disabled public auth/reset",
      async () => {
        for (const route of legacyAPIs)
          for (const method of methods) {
            const response = await anonymous.request.fetch(concrete(route), {
              method,
              headers: { origin },
              maxRedirects: 0,
            })
            assert.equal(response.status(), 401)
            checkCache(response.headers())
          }
        for (const name of queryNames)
          assert.equal(
            (await anonymous.request.get(`/api/v1/queries/${name}`)).status(),
            401
          )
        for (const name of commandNames)
          assert.equal((await post(anonymous.request, name, {})).status(), 401)
        for (const route of ["/", "/users", ...unavailablePages]) {
          for (const rsc of [false, true]) {
            const response = await anonymous.request.get(concrete(route), {
              headers: rsc ? { RSC: "1" } : {},
              maxRedirects: 0,
            })
            assert.ok([200, 307].includes(response.status()))
            checkCache(response.headers())
            const body = await response.text()
            assert.ok(
              response.headers().location === "/login" ||
                body.includes("/login")
            )
            assert.ok(
              !body.includes("presentationGrants") &&
                !body.includes("mock-data")
            )
          }
        }
        for (const path of [
          "sign-up/email",
          "reset-password",
          "request-password-reset",
          "bootstrap",
          "get-session",
          "change-password",
        ]) {
          for (const method of methods) {
            const response = await anonymous.request.fetch(
              `/api/auth/${path}`,
              {
                method,
                headers: { origin },
                data: method === "POST" ? {} : undefined,
              }
            )
            assert.ok([404, 405].includes(response.status()))
            checkCache(response.headers())
          }
        }
        assert.equal(
          (
            await anonymous.request.post("/api/test/reset", { data: {} })
          ).status(),
          404
        )
        assert.equal(
          (await anonymous.request.get(`/api/users/${guessedID}`)).status(),
          404
        )
      }
    )
    await group(
      "real UI failed/successful login; minimized current actor; two isolated browser contexts",
      async () => {
        await a.goto("/login?returnTo=//foreign.example.test")
        await a.getByLabel("Email Address").fill(credential("ADMIN_EMAIL"))
        await a.getByLabel("Password", { exact: true }).fill("not-the-password")
        await a.getByRole("button", { name: "Sign In", exact: true }).click()
        await expect(
          a.getByRole("alert").filter({ hasText: "Sign in failed" })
        ).toBeVisible()
        await login(a, credential("ADMIN_EMAIL"), credential("ADMIN_PASSWORD"))
        await login(
          b,
          credential("SECOND_EMAIL"),
          credential("SECOND_PASSWORD")
        )
        const first = await query<CurrentActorDTO>(
          admin.request,
          "currentActor"
        )
        second = await query<CurrentActorDTO>(other.request, "currentActor")
        assert.notEqual(first.user.id, second.user.id)
        const body = JSON.stringify(first)
        assert.ok(
          !body.includes("password") &&
            !body.includes("token") &&
            !body.includes("sessionId") &&
            !body.includes(credential("ADMIN_EMAIL"))
        )
        await a.goto("/users")
        await expect(
          a.getByRole("heading", { name: "Users & Roles", exact: true })
        ).toBeVisible()
      }
    )
    await group(
      "authenticated legacy APIs fail closed for every method; unsupported pages/RSCs contain no mock facts",
      async () => {
        for (const route of legacyAPIs)
          for (const method of methods) {
            const response = await admin.request.fetch(concrete(route), {
              method,
              headers: { origin },
            })
            assert.equal(response.status(), 503)
            checkCache(response.headers())
          }
        for (const route of unavailablePages) {
          const response = await admin.request.get(concrete(route), {
            headers: { RSC: "1" },
          })
          assert.equal(response.status(), 200)
          assert.match(await response.text(), /Domain|domain|Unavailable/)
          checkCache(response.headers())
        }
      }
    )
    await group(
      "UI role creation + user creation + persisted multirole assignment + authorized list/search/filter/sort",
      async () => {
        await createRole(roleName, [
          { subject: "User", action: "read", fields: ["id", "name"] },
        ])
        await createRole(roleTwoName, [])
        await a.getByRole("button", { name: "Users", exact: true }).click()
        await a.getByRole("button", { name: "Add User", exact: true }).click()
        await a.getByLabel("Name", { exact: true }).fill(userName)
        await a.getByLabel("Email", { exact: true }).fill(userEmail)
        await a
          .getByLabel("Initial password", { exact: true })
          .fill(userPassword)
        await a.getByLabel(roleName, { exact: true }).check()
        await a.getByLabel(roleTwoName, { exact: true }).check()
        await a.getByRole("button", { name: "Save User", exact: true }).click()
        await expect(a.getByRole("dialog")).toBeHidden()
        await a
          .getByRole("textbox", { name: "Search accounts or roles" })
          .fill(suffix)
        await expect(
          a.getByRole("cell", { name: userName, exact: true })
        ).toBeVisible()
        const rows = await query<{ data: UserAdminDTO[]; total: number }>(
          admin.request,
          "users",
          `?q=${suffix}`
        )
        assert.equal(rows.total, 1)
        user = rows.data[0]
        assert.equal(user.roles.length, 2)
        const roles = await query<{ data: RoleDTO[]; total: number }>(
          admin.request,
          "roles",
          `?q=${suffix}&sort=${encodeURIComponent('[{"field":"name","direction":"desc"}]')}`
        )
        assert.equal(roles.total, 2)
        assert.equal(roles.data[0].name, roleTwoName)
        role = roles.data.find((r) => r.name === roleName)!
        archivedRoleId = roles.data.find((r) => r.name === roleTwoName)!.id
        const filtered = await query<{ total: number }>(
          admin.request,
          "users",
          `?roleId=${role.id}&active=true&q=${suffix}`
        )
        assert.equal(filtered.total, 1)
        assert.equal(
          (
            await query<{ total: number }>(
              admin.request,
              "users",
              `?roleId=${role.id}&active=false`
            )
          ).total,
          0
        )
        const safe = JSON.stringify(user)
        assert.ok(
          !safe.includes(userPassword) &&
            !safe.includes("password") &&
            !safe.includes("accounts")
        )
      }
    )
    await group(
      "UI user update and role save; second context sees committed facts",
      async () => {
        await a
          .getByRole("button", { name: `Edit ${userName}`, exact: true })
          .click()
        await a.getByLabel("Name", { exact: true }).fill(`${userName} Updated`)
        await a
          .getByLabel("Reason", { exact: true })
          .fill("Update synthetic account")
        await a.getByRole("button", { name: "Save User", exact: true }).click()
        await expect(a.getByRole("dialog")).toBeHidden()
        user = await query<UserAdminDTO>(
          other.request,
          "user",
          `?id=${user.id}`
        )
        assert.equal(user.name, `${userName} Updated`)
        await a.getByRole("button", { name: "Roles", exact: true }).click()
        await a
          .getByRole("button", { name: `Edit ${roleName}`, exact: true })
          .click()
        await a
          .getByLabel("Grants (JSON array)", { exact: true })
          .fill(
            JSON.stringify([
              { subject: "User", action: "read", fields: ["id"] },
            ])
          )
        await a
          .getByLabel("Reason", { exact: true })
          .fill("Change synthetic permissions")
        await a.getByRole("button", { name: "Save Role", exact: true }).click()
        await expect(a.getByRole("dialog")).toBeHidden()
        role = await query<RoleDTO>(other.request, "role", `?id=${role.id}`)
        assert.deepEqual(role.grants[0].fields, ["id"])
      }
    )
    await group(
      "negative command/query HTTP: origin, unknown/forged input, revisions, replay and secret sort",
      async () => {
        const headers = { origin: "http://foreign.example.test" }
        assert.equal(
          (
            await admin.request.post("/api/v1/commands/saveRole", {
              headers,
              data: {},
            })
          ).status(),
          403
        )
        assert.equal(
          (
            await admin.request.post("/api/v1/commands/saveRole", { data: {} })
          ).status(),
          403
        )
        assert.equal(
          (
            await admin.request.get(
              "/api/v1/queries/users?sort=%5B%7B%22field%22%3A%22password%22%2C%22direction%22%3A%22asc%22%7D%5D"
            )
          ).status(),
          403
        )
        assert.equal(
          (
            await admin.request.get("/api/v1/queries/users?active=yes")
          ).status(),
          422
        )
        assert.equal(
          (await admin.request.get("/api/v1/queries/users?q=x&q=y")).status(),
          422
        )
        assert.equal(
          (
            await admin.request.get("/api/v1/queries/users?actor=forged")
          ).status(),
          422
        )
        const input = {
          id: role.id,
          name: role.name,
          grants: role.grants,
          reason: "HTTP regression",
        }
        assert.equal(
          (
            await post(admin.request, "saveRole", {
              ...input,
              systemKey: "ADMINISTRATOR",
            })
          ).status(),
          422
        )
        assert.equal(
          (await post(admin.request, "saveRole", input)).status(),
          428
        )
        assert.equal(
          (
            await post(admin.request, "saveRole", input, [
              { type: "Role", id: role.id, revision: 1 },
            ])
          ).status(),
          409
        )
        const key = randomUUID()
        const expected = [
          { type: "Role", id: role.id, revision: role.revision },
        ]
        const first = await post(
          admin.request,
          "saveRole",
          input,
          expected,
          key
        )
        assert.equal(first.status(), 200)
        const replay = await post(
          admin.request,
          "saveRole",
          input,
          expected,
          key
        )
        assert.equal(replay.status(), 200)
        assert.equal((await replay.json()).replayed, true)
        assert.equal(
          (
            await post(
              admin.request,
              "saveRole",
              { ...input, name: "changed" },
              expected,
              key
            )
          ).status(),
          409
        )
      }
    )
    await group(
      "stale UI form retained; refresh revisions requires explicit reconfirmation and new intention",
      async () => {
        await a
          .getByRole("button", { name: `Edit ${roleName}`, exact: true })
          .click()
        await a
          .getByLabel("Reason", { exact: true })
          .fill("Retained stale-form intention")
        const current = await query<RoleDTO>(
          other.request,
          "role",
          `?id=${role.id}`
        )
        assert.equal(
          (
            await post(
              other.request,
              "saveRole",
              {
                id: current.id,
                name: current.name,
                grants: current.grants,
                reason: "Concurrent editor",
              },
              [{ type: "Role", id: current.id, revision: current.revision }]
            )
          ).status(),
          200
        )
        await a.getByRole("button", { name: "Save Role", exact: true }).click()
        await expect(
          a.getByRole("alert").filter({ hasText: "STALE_REVISION" })
        ).toBeVisible()
        await expect(a.getByLabel("Reason", { exact: true })).toHaveValue(
          "Retained stale-form intention"
        )
        await expect(
          a.getByRole("button", { name: "Save Role", exact: true })
        ).toBeDisabled()
        await a
          .getByRole("button", {
            name: "Refresh revisions and reconfirm",
            exact: true,
          })
          .click()
        await a.getByRole("button", { name: "Save Role", exact: true }).click()
        await expect(a.getByRole("dialog")).toBeHidden()
      }
    )
    await group(
      "same-cookie administrator-role revocation denies UI/API/direct RSC immediately",
      async () => {
        const target = await query<UserAdminDTO>(
          admin.request,
          "user",
          `?id=${second.user.id}`
        )
        const assignment = [
          { type: "User", id: target.id, revision: target.revision },
          {
            type: "Role",
            id: archivedRoleId,
            revision: (
              await query<RoleDTO>(
                admin.request,
                "role",
                `?id=${archivedRoleId}`
              )
            ).revision,
          },
        ]
        assert.equal(
          (
            await post(
              admin.request,
              "updateUser",
              {
                id: target.id,
                name: target.name,
                active: true,
                // Remove all administrative capabilities, not merely protected
                // membership: a remaining User.read/id grant now permits reads.
                roleIds: [archivedRoleId],
                reason: "Bounded revocation check",
              },
              assignment
            )
          ).status(),
          200
        )
        try {
          for (const name of [
            "users",
            "roles",
            "permissionRegistry",
            `user?id=${user.id}`,
            `role?id=${role.id}`,
          ])
            assert.equal(
              (await other.request.get(`/api/v1/queries/${name}`)).status(),
              name === "permissionRegistry" ? 403 : 404
            )
          assert.equal(
            (await post(other.request, "saveRole", {})).status(),
            422
          )
          const response = await other.request.get("/users", {
            headers: { RSC: "1" },
            maxRedirects: 0,
          })
          const body = await response.text()
          assert.ok(
            response.headers().location?.includes("forbidden") ||
              body.includes("forbidden")
          )
          assert.ok(!body.includes(userEmail))
          await b.goto("/users")
          await b.waitForURL("**/login?reason=forbidden")
          await expect(
            b.getByRole("heading", { name: "Users & Roles", exact: true })
          ).toBeHidden()
        } finally {
          const current = await query<UserAdminDTO>(
            admin.request,
            "user",
            `?id=${target.id}`
          )
          assert.equal(
            (
              await post(
                admin.request,
                "updateUser",
                {
                  id: target.id,
                  name: target.name,
                  active: true,
                  roleIds: target.roles.map((r) => r.id),
                  reason: "Restore isolated seed administrator",
                },
                [
                  { type: "User", id: target.id, revision: current.revision },
                  ...target.roles.map((r) => ({
                    type: "Role",
                    id: r.id,
                    revision: r.revision,
                  })),
                ]
              )
            ).status(),
            200
          )
        }
      }
    )
    await group(
      "keyboard dialog access, mobile layout and private storage/cookie handling",
      async () => {
        await a.goto("/users")
        await a.setViewportSize({ width: 375, height: 812 })
        const add = a.getByRole("button", { name: "Add User", exact: true })
        await add.focus()
        await a.keyboard.press("Enter")
        await expect(a.getByRole("dialog")).toBeVisible()
        await expect(a.getByLabel("Name", { exact: true })).toBeVisible()
        await a.keyboard.press("Escape")
        await expect(a.getByRole("dialog")).toBeHidden()
        assert.ok(
          await a.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth
          )
        )
        assert.equal(
          await a.evaluate(() => localStorage.length + sessionStorage.length),
          0
        )
        const cookie = (await admin.cookies()).find((c) =>
          c.name.includes("session_token")
        )
        assert.ok(cookie?.httpOnly)
        assert.equal(cookie.sameSite, "Lax")
        await a.setViewportSize({ width: 1280, height: 900 })
      }
    )
    await group(
      "logout/back/account switch; multirole login; same-cookie role archive and account deactivation",
      async () => {
        // Reuse the second context, including its old history; replace its live cookie.
        await other.request.post("/api/auth/sign-out", {
          headers: { origin },
          data: {},
        })
        await login(b, userEmail, userPassword)
        const current = await query<CurrentActorDTO>(
          other.request,
          "currentActor"
        )
        assert.equal(current.user.id, user.id)
        assert.equal(current.roles.length, 2)
        const idOnly = await query<{ data: Record<string, unknown>[] }>(
          other.request,
          "users"
        )
        assert.ok(idOnly.data.length > 0)
        assert.ok(
          idOnly.data.every((row) =>
            Object.keys(row).every((key) =>
              ["id", "redactedFields"].includes(key)
            )
          )
        )
        await a.goto("/users")
        await a.getByRole("button", { name: "Roles", exact: true }).click()
        await a
          .getByRole("textbox", { name: "Search accounts or roles" })
          .fill(suffix)
        await a
          .getByRole("button", { name: `Edit ${roleTwoName}`, exact: true })
          .click()
        await a
          .getByLabel("Reason", { exact: true })
          .fill("Archive synthetic role")
        await a
          .getByRole("button", { name: "Archive Role", exact: true })
          .click()
        await expect(a.getByRole("dialog")).toBeHidden()
        assert.equal(
          (await query<CurrentActorDTO>(other.request, "currentActor")).roles
            .length,
          1
        )
        await expect(
          b.getByRole("heading", { name: "Unavailable", exact: true })
        ).toBeVisible()
        await a.getByRole("button", { name: "Users", exact: true }).click()
        await a
          .getByRole("button", {
            name: `Edit ${userName} Updated`,
            exact: true,
          })
          .click()
        await a.getByLabel("Active account", { exact: true }).uncheck()
        // An assigned archived role can be removed, but never newly selected.
        await a
          .getByLabel(`${roleTwoName} (archived)`, { exact: true })
          .uncheck()
        await a
          .getByLabel("Reason", { exact: true })
          .fill("Account revocation check")
        await a.getByRole("button", { name: "Save User", exact: true }).click()
        await expect(a.getByRole("dialog")).toBeHidden()
        assert.equal(
          (await other.request.get("/api/v1/queries/currentActor")).status(),
          403
        )
        const denied = await other.request.get("/dashboard", {
          headers: { RSC: "1" },
          maxRedirects: 0,
        })
        assert.ok(
          denied.headers().location?.includes("inactive") ||
            (await denied.text()).includes("inactive")
        )
        await b.waitForURL(/\/login\?reason=(access-changed|inactive)/)
        await logout(a)
        assert.equal(
          (await admin.request.get("/api/v1/queries/users")).status(),
          401
        )
        await a.goBack()
        await a.waitForURL(/\/login/)
        await expect(
          a.getByRole("heading", { name: "Users & Roles", exact: true })
        ).toBeHidden()
        await login(a, credential("STAFF_EMAIL"), credential("STAFF_PASSWORD"))
        await expect(
          a.getByRole("link", { name: "Users & Roles", exact: true })
        ).toBeHidden()
        for (const name of queryNames.filter((n) => n !== "currentActor"))
          assert.equal(
            (
              await admin.request.get(
                `/api/v1/queries/${name}${name === "parties" ? "?type=SUPPLIER" : name === "party" ? "?type=SUPPLIER&id=00000000-0000-4000-8000-000000000099" : ""}`
              )
            ).status(),
            ["permissionRegistry", "customers", "parties"].includes(name)
              ? 403
              : 404
          )
        assert.equal(
          (
            await admin.request.get(
              `/api/v1/queries/audit?type=User&id=${user.id}`
            )
          ).status(),
          404
        )
        await a.goto("/users")
        await a.waitForURL("**/login?reason=forbidden")
        assert.equal(
          (
            await anonymous.request.get("/api/v1/queries/currentActor")
          ).status(),
          401
        )
      }
    )
    await writeFile(
      join(directory, "t03b-production-evidence.json"),
      JSON.stringify(
        {
          sha: execFileSync("git", ["rev-parse", "HEAD"], {
            encoding: "utf8",
          }).trim(),
          dirty: !!execFileSync("git", ["status", "--porcelain"], {
            encoding: "utf8",
          }).trim(),
          passed,
          retained: {
            userId: user!.id,
            roleId: role!.id,
            archivedRoleId: archivedRoleId!,
          },
          transport:
            "production Next TCP loopback; real PostgreSQL; two isolated Chromium contexts; no mocks",
        },
        null,
        2
      ),
      { mode: 0o600 }
    )
    console.log(
      "PASS bounded production browser/HTTP checks; private evidence saved, no credentials emitted."
    )
  } finally {
    await browser.close()
    server.kill("SIGTERM")
    const timer = setTimeout(() => server.kill("SIGKILL"), 5000)
    await exited
    clearTimeout(timer)
  }
}
main().catch(async (error: unknown) => {
  if (process.argv[2])
    await writeFile(
      join(process.argv[2], "t03b-private-failure.log"),
      error instanceof Error
        ? (error.stack ?? error.message)
        : "Unknown failure",
      { mode: 0o600 }
    )
  console.error(`FAIL ${stage}; private inputs not emitted`)
  process.exitCode = 1
})
