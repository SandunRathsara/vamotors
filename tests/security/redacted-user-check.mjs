/** Production Chromium + same-session API parity; owner-isolated PRIVATE_DIRECTORY. */
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { spawn, execFileSync } from "node:child_process"
import { once } from "node:events"
import { createServer } from "node:net"
import { join } from "node:path"
import { writeFile } from "node:fs/promises"
import { chromium, expect } from "@playwright/test"
import { privateEnvironment } from "../../scripts/private-environment.ts"
import { runtimeConfig } from "../../lib/server/config.ts"

process.umask(0o077)
const directory = process.argv[2]
assert.ok(directory)
const runtime = runtimeConfig(
  await privateEnvironment(join(directory, "runtime.env"))
)
const accounts = await privateEnvironment(join(directory, "accounts.env"))
const cluster = await privateEnvironment(join(directory, "cluster.env"))
assert.equal(runtime.APP_ENV, "local")
assert.equal(cluster.PROJECT, process.cwd())
assert.equal(new URL(runtime.DATABASE_URL).hostname, "127.0.0.1")
assert.equal(new URL(runtime.DATABASE_URL).port, cluster.PORT)
const socket = createServer().listen(0, "127.0.0.1")
await once(socket, "listening")
const port = socket.address().port
await new Promise((resolve) => socket.close(resolve))
const origin = `http://127.0.0.1:${port}`
const server = spawn(
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
const exited = once(server, "exit")
const ready = new Promise((resolve, reject) => {
  const timer = setTimeout(
    () => reject(new Error("SERVER_START_TIMEOUT")),
    20000
  )
  server.stdout.on("data", (chunk) => {
    if (chunk.toString().includes("Ready")) {
      clearTimeout(timer)
      resolve()
    }
  })
  server.once("exit", () => {
    clearTimeout(timer)
    reject(new Error("SERVER_EARLY_EXIT"))
  })
})
server.stderr.resume()
const browser = await chromium.launch({ headless: true })
const results = []
const admin = await browser.newContext({ baseURL: origin })
const delegate = await browser.newContext({ baseURL: origin })
const page = await delegate.newPage()
const suffix = randomUUID().slice(0, 8)
const reason = "Synthetic bounded redacted user regression"
const grant = (subject, action, fields) => ({ subject, action, fields })
const ref = (type, row) => ({ type, id: row.id, revision: row.revision })
async function check(name, run) {
  try {
    await run()
    results.push({ name, pass: true })
    console.log(`PASS ${name}`)
  } catch (error) {
    results.push({ name, pass: false, error: error.message })
    console.log(`FAIL ${name}: ${error.message}`)
  } finally {
    if (await page.getByRole("dialog").isVisible())
      await page.getByRole("button", { name: "Cancel", exact: true }).click()
  }
}
async function query(client, name, params = "") {
  const response = await client.get(`/api/v1/queries/${name}${params}`)
  assert.equal(response.status(), 200)
  assert.match(response.headers()["cache-control"], /no-store/)
  return (await response.json()).data
}
async function post(client, name, input, expected = []) {
  const response = await client.post(`/api/v1/commands/${name}`, {
    headers: { origin },
    data: { schemaVersion: 1, idempotencyKey: randomUUID(), input, expected },
  })
  assert.match(response.headers()["cache-control"], /no-store/)
  return response
}
async function applied(client, name, input, expected = []) {
  const response = await post(client, name, input, expected)
  assert.ok(
    [200, 201].includes(response.status()),
    `${name}: ${response.status()}`
  )
  return response.json()
}
async function login(context, email, password) {
  const response = await context.request.post("/api/auth/sign-in/email", {
    headers: { origin },
    data: { email, password },
  })
  assert.equal(response.status(), 200)
}
const role = (id) => query(admin.request, "role", `?id=${id}`)
const user = (id) => query(admin.request, "user", `?id=${id}`)
async function makeRole(name, grants) {
  const result = await applied(admin.request, "saveRole", {
    name: `Redacted ${suffix} ${name}`,
    grants,
    reason,
  })
  return role(result.result.id)
}
async function makeUser(name, roles) {
  const email = `${randomUUID()}@example.test`,
    password = `${randomUUID()}Aa!`
  const result = await applied(
    admin.request,
    "createUser",
    {
      name: `Redacted ${suffix} ${name}`,
      email,
      password,
      roleIds: roles.map((r) => r.id),
    },
    roles.map((r) => ref("Role", r))
  )
  return { row: await user(result.result.id), email, password }
}
let delegation
async function capabilities(userRead, userUpdate, roleRead, create = false) {
  delegation = await role(delegation.id)
  await applied(
    admin.request,
    "saveRole",
    {
      id: delegation.id,
      name: delegation.name,
      reason,
      grants: [
        grant("User", "read", userRead),
        grant("User", "update", userUpdate),
        grant("Role", "read", roleRead),
        ...(create ? [grant("User", "create", ["*"])] : []),
      ],
    },
    [ref("Role", delegation)]
  )
}
async function open(row) {
  await page.goto("/users")
  await page.getByLabel("Search accounts or roles").fill(row.email)
  await page
    .getByRole("button", { name: `Edit ${row.name}`, exact: true })
    .click()
  await expect(page.getByRole("dialog")).toBeVisible()
}
const input = (row, changes = {}) => ({
  id: row.id,
  name: row.name,
  active: row.active,
  roleIds: row.roles.map((r) => r.id),
  reason,
  ...changes,
})
const refs = (row) => [
  ref("User", row),
  ...row.roles.map((r) => ref("Role", r)),
]
async function save() {
  await page.getByLabel("Reason", { exact: true }).fill(reason)
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/commands/updateUser") &&
      r.request().method() === "POST"
  )
  await page.getByRole("button", { name: "Save User", exact: true }).click()
  assert.equal((await response).status(), 200)
  await expect(page.getByRole("dialog")).toBeHidden()
}
try {
  await ready
  await login(
    admin,
    accounts.BOOTSTRAP_ADMIN_EMAIL,
    accounts.BOOTSTRAP_ADMIN_PASSWORD
  )
  const safe = await makeRole("safe", []),
    other = await makeRole("other", [])
  delegation = await makeRole("delegate", [])
  const account = await makeUser("delegate", [delegation])
  const target = await makeUser("target", [safe, other])
  await login(delegate, account.email, account.password)

  await check(
    "hidden active is unavailable, not archived; addition stays disabled",
    async () => {
      await capabilities(
        ["*"],
        ["name"],
        ["id", "revision", "name", "systemKey", "grants"],
        true
      )
      const dto = await query(delegate.request, "role", `?id=${safe.id}`)
      assert.equal(dto.active, undefined)
      assert.ok(dto.redactedFields.includes("active"))
      assert.equal((await role(safe.id)).active, true)
      await page.goto("/users")
      await page.getByRole("button", { name: "Add User", exact: true }).click()
      const label = page.locator("label").filter({ hasText: safe.name })
      await expect(label).toContainText("unavailable")
      await expect(label).not.toContainText("archived")
      await expect(label.getByRole("checkbox")).toBeDisabled()
    }
  )

  await check(
    "id/revision-only roles allow same-actor API and UI name edits without leaking names",
    async () => {
      await capabilities(["*"], ["name"], ["id", "revision"])
      let dto = await query(delegate.request, "user", `?id=${target.row.id}`)
      assert.ok(dto.redactedFields.includes("roles.name"))
      assert.ok(dto.roles.every((r) => r.id && r.revision && !("name" in r)))
      await applied(
        delegate.request,
        "updateUser",
        input(dto, { name: `${dto.name} API` }),
        refs(dto)
      )
      dto = await query(delegate.request, "user", `?id=${dto.id}`)
      await open(dto)
      await expect(page.getByLabel("Name", { exact: true })).toBeEnabled()
      await expect(page.getByRole("dialog")).not.toContainText(safe.name)
      await expect(
        page.getByLabel("Active account", { exact: true })
      ).toBeDisabled()
      await page.getByLabel("Name", { exact: true }).fill(`${dto.name} UI`)
      await save()
      const after = await user(dto.id)
      assert.equal(after.name, `${dto.name} UI`)
      assert.deepEqual(
        after.roles.map((r) => r.id).sort(),
        dto.roles.map((r) => r.id).sort()
      )
      assert.equal(after.active, dto.active)
    }
  )

  await check(
    "hidden grants/systemKey permit same-actor API and UI custom-role removal, not addition",
    async () => {
      await capabilities(
        ["*"],
        ["roleIds"],
        ["id", "revision", "name", "active"]
      )
      let dto = await query(delegate.request, "user", `?id=${target.row.id}`)
      const hidden = await query(delegate.request, "role", `?id=${safe.id}`)
      assert.equal(hidden.grants, undefined)
      assert.equal(hidden.systemKey, undefined)
      assert.equal(dto.adminProtection.isAdministrator, false)
      await applied(
        delegate.request,
        "updateUser",
        input(dto, { roleIds: [other.id] }),
        [
          ref("User", dto),
          ref(
            "Role",
            dto.roles.find((r) => r.id === other.id)
          ),
        ]
      )
      // Restore only through Administrator; UI then performs the identical authorized reduction.
      const current = await user(dto.id)
      await applied(
        admin.request,
        "updateUser",
        input(current, { roleIds: [safe.id, other.id] }),
        [ref("User", current), ref("Role", safe), ref("Role", other)]
      )
      dto = await query(delegate.request, "user", `?id=${dto.id}`)
      await open(dto)
      await expect(page.getByLabel("Name", { exact: true })).toBeDisabled()
      const checkbox = page.getByLabel(safe.name, { exact: true })
      await expect(checkbox).toBeEnabled()
      await checkbox.uncheck()
      await expect(checkbox).toBeDisabled()
      await save()
      assert.deepEqual(
        (await user(dto.id)).roles.map((r) => r.id),
        [other.id]
      )
    }
  )

  for (const missing of ["id", "revision"]) {
    await check(
      `hidden role ${missing} blocks replacement in UI and same-actor API`,
      async () => {
        await capabilities(
          ["*"],
          ["name"],
          ["id", "revision", "name"].filter((f) => f !== missing)
        )
        const dto = await query(
          delegate.request,
          "user",
          `?id=${target.row.id}`
        )
        assert.ok(dto.redactedFields.includes(`roles.${missing}`))
        await open(dto)
        await expect(page.getByLabel("Name", { exact: true })).toBeDisabled()
        await expect(
          page.getByRole("button", { name: "Save User", exact: true })
        ).toBeDisabled()
        const current = await user(dto.id)
        const response = await post(
          delegate.request,
          "updateUser",
          input(current, { name: `${current.name} forbidden` }),
          refs(current)
        )
        assert.equal(response.status(), 403)
        assert.equal((await response.json()).error.code, "FIELD_FORBIDDEN")
        assert.equal((await user(dto.id)).revision, current.revision)
      }
    )
  }
  await check(
    "hidden replacement field blocks save; forbidden changed field stays disabled and rejected",
    async () => {
      await capabilities(
        ["id", "revision", "name", "email", "roles"],
        ["name"],
        ["id", "revision", "name"]
      )
      let dto = await query(delegate.request, "user", `?id=${target.row.id}`)
      assert.equal(dto.active, undefined)
      await open(dto)
      await expect(
        page.getByRole("button", { name: "Save User", exact: true })
      ).toBeDisabled()
      await page.getByRole("button", { name: "Cancel", exact: true }).click()
      await capabilities(["*"], ["active"], ["id", "revision", "name"])
      dto = await query(delegate.request, "user", `?id=${dto.id}`)
      await open(dto)
      await expect(page.getByLabel("Name", { exact: true })).toBeDisabled()
      const response = await post(
        delegate.request,
        "updateUser",
        input(dto, { name: `${dto.name} forbidden` }),
        refs(dto)
      )
      assert.equal(response.status(), 403)
      assert.equal((await response.json()).error.code, "FIELD_FORBIDDEN")
      assert.equal((await user(dto.id)).revision, dto.revision)
    }
  )
  await check(
    "protected Administrator removal remains disabled when known and server-denied even with hidden metadata",
    async () => {
      const actor = await query(admin.request, "currentActor")
      const protectedUser = await user(actor.user.id)
      const adminRole = await role(protectedUser.roles[0].id)
      for (const metadata of [true, false]) {
        await capabilities(
          ["*"],
          ["roleIds"],
          [
            "id",
            "revision",
            "name",
            "active",
            ...(metadata ? ["systemKey"] : []),
          ]
        )
        const dto = await query(
          delegate.request,
          "user",
          `?id=${protectedUser.id}`
        )
        assert.equal(dto.adminProtection.isAdministrator, true)
        await open(dto)
        if (metadata)
          await expect(
            page.getByLabel(adminRole.name, { exact: true })
          ).toBeDisabled()
        const response = await post(
          delegate.request,
          "updateUser",
          input(dto, { roleIds: [other.id] }),
          [ref("User", dto), ref("Role", other)]
        )
        assert.equal(response.status(), 403)
        assert.equal((await response.json()).error.code, "FORBIDDEN")
        assert.equal((await user(dto.id)).revision, dto.revision)
        await page.getByRole("button", { name: "Cancel", exact: true }).click()
      }
    }
  )
} finally {
  await writeFile(
    join(directory, "redacted-user-results.json"),
    JSON.stringify(
      {
        sha: execFileSync("git", ["rev-parse", "HEAD"], {
          encoding: "utf8",
        }).trim(),
        dirty: !!execFileSync("git", ["status", "--porcelain"], {
          encoding: "utf8",
        }).trim(),
        results,
      },
      null,
      2
    ),
    { mode: 0o600 }
  )
  await browser.close()
  server.kill("SIGTERM")
  await exited
}
process.exitCode = results.some((r) => !r.pass) ? 1 : 0
