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
            id: role.id,
            revision: (
              await query<RoleDTO>(admin.request, "role", `?id=${role.id}`)
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
                roleIds: [role.id],
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
              403
            )
          assert.equal(
            (await post(other.request, "saveRole", {})).status(),
            403
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
        assert.equal(
          (await other.request.get("/api/v1/queries/users")).status(),
          403
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
            (await admin.request.get(`/api/v1/queries/${name}`)).status(),
            403
          )
        assert.equal(
          (
            await admin.request.get(
              `/api/v1/queries/audit?type=User&id=${user.id}`
            )
          ).status(),
          403
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
