/** Production Chromium + real DB. Run after build/local:setup with OWN private directory. */
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { spawn, type ChildProcess } from "node:child_process"
import { once } from "node:events"
import { createServer } from "node:net"
import { join } from "node:path"
import { writeFile } from "node:fs/promises"
import { chromium, expect, type Route } from "@playwright/test"
import pg from "pg"
import { privateEnvironment } from "../../scripts/private-environment"
import { runtimeConfig } from "../../lib/server/config"
import type {
  CustomerDTO,
  Applied,
} from "../../.planning/implementation/contracts/api"

process.umask(0o077)
async function main() {
  const directory = process.argv[2]
  assert.ok(directory)
  const runtime = runtimeConfig(
    await privateEnvironment(join(directory, "runtime.env"))
  )
  const migration = await privateEnvironment(join(directory, "migration.env"))
  const accounts = await privateEnvironment(join(directory, "accounts.env"))
  const cluster = await privateEnvironment(join(directory, "cluster.env"))
  assert.equal(cluster.PROJECT, process.cwd())
  assert.equal(runtime.APP_ENV, "local")
  for (const url of [runtime.DATABASE_URL, migration.DIRECT_URL!]) {
    assert.equal(new URL(url).hostname, "127.0.0.1")
    assert.equal(new URL(url).port, cluster.PORT)
  }
  const db = new pg.Pool({ connectionString: migration.DIRECT_URL, max: 2 })
  const socket = createServer().listen(0, "127.0.0.1")
  await once(socket, "listening")
  const address = socket.address()
  assert.ok(address && typeof address !== "string")
  const origin = `http://127.0.0.1:${address.port}`
  await new Promise<void>((resolve) => socket.close(() => resolve()))
  let server: ChildProcess | undefined
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ baseURL: origin })
  const page = await context.newPage()
  const passed: string[] = []
  const network: { body: string; status: number; result: Applied }[] = []
  const suffix = randomUUID()
  const values = {
    fullName: `Response loss ${suffix}`,
    callingName: "Synthetic",
    nicOrPassport: suffix,
    address: "Synthetic address",
    phone: "077 123 4567",
    notes: "Original notes",
  }
  async function post(name: string, input: unknown, expected: unknown[] = []) {
    const response = await context.request.post(`/api/v1/commands/${name}`, {
      headers: { origin },
      data: { schemaVersion: 1, idempotencyKey: randomUUID(), expected, input },
    })
    assert.ok(response.ok(), `SETUP_${name}_${response.status()}`)
    return (await response.json()) as Applied
  }
  async function customer(id: string) {
    const response = await context.request.get(
      `/api/v1/queries/customer?id=${id}`
    )
    assert.equal(response.status(), 200)
    return (await response.json()).data as CustomerDTO
  }
  const expected = (row: CustomerDTO) => [
    { type: "Customer", id: row.id, revision: row.revision },
  ]
  async function counts(id: string) {
    return (
      await db.query(
        `SELECT
      (SELECT revision FROM vamotors."Customer" WHERE id=$1) AS revision,
      (SELECT count(*)::int FROM vamotors."AuditEntry" WHERE "entityType"='Customer' AND "entityId"=$1) AS audit,
      (SELECT count(*)::int FROM vamotors."CommandReceipt" WHERE result->>'id'=$1::text) AS receipts,
      (SELECT count(*)::int FROM vamotors."EntityReadVersion" WHERE "entityType"='Customer' AND "entityId"=$1) AS versions`,
        [id]
      )
    ).rows[0]
  }
  // Only the transport is faulted: every intercepted request executes the real server transaction.
  let lose = 0
  let beforeTransport: (() => Promise<void>) | undefined
  async function transport(route: Route) {
    const before = beforeTransport
    beforeTransport = undefined
    await before?.()
    const response = await route.fetch({ maxRetries: 0 })
    network.push({
      body: route.request().postData()!,
      status: response.status(),
      result: await response.json(),
    })
    if (lose > 0) {
      lose--
      await route.abort("connectionreset")
    } else await route.fulfill({ response })
  }
  async function refetch(id: string) {
    const response = page.waitForResponse((r) =>
      r.url().includes(`/queries/customer?id=${id}`)
    )
    await page.evaluate(() =>
      document.dispatchEvent(new Event("visibilitychange"))
    )
    assert.equal((await response).status(), 200)
  }
  try {
    server = spawn(
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
    server.stderr!.resume()
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("SERVER_START_TIMEOUT")),
        20000
      )
      server!.once("exit", () => {
        clearTimeout(timer)
        reject(new Error("SERVER_EARLY_EXIT"))
      })
      server!.stdout!.on("data", (chunk) => {
        if (chunk.toString().includes("Ready")) {
          clearTimeout(timer)
          resolve()
        }
      })
    })
    await page.goto("/login")
    await page.getByLabel("Email Address").fill(accounts.BOOTSTRAP_ADMIN_EMAIL!)
    await page
      .getByLabel("Password", { exact: true })
      .fill(accounts.BOOTSTRAP_ADMIN_PASSWORD!)
    await page.getByRole("button", { name: "Sign In", exact: true }).click()
    await page.waitForURL("**/dashboard")
    const created = await post("createCustomer", values)
    const id = created.result.id
    await page.goto(`/customers/${id}`)
    await page.route("**/api/v1/commands/archiveParty", transport)
    for (const active of [false, true]) {
      const before = await counts(id)
      const reason = active ? "Explicit reactivation" : "Explicit archive"
      await page.getByLabel("Reason", { exact: true }).fill(reason)
      lose = 2
      const start = network.length
      const button = page
        .locator("form")
        .filter({ has: page.locator("#archive-reason") })
        .getByRole("button", { name: /Confirm|Retry/ })
      await button.click()
      await expect(
        page.getByRole("alert").filter({ hasText: "NETWORK_ERROR" })
      ).toBeVisible()
      const first = network[start]
      assert.equal(first.status, 200)
      assert.equal(first.result.replayed, false)
      const envelope = JSON.parse(first.body)
      assert.equal(envelope.input.active, active)
      assert.equal(envelope.input.reason, reason)
      const committed = await counts(id)
      assert.deepEqual(committed, {
        revision: before.revision + 1,
        audit: before.audit + 1,
        receipts: before.receipts + 1,
        versions: before.versions + 1,
      })
      await refetch(id)
      await expect(page.getByLabel("Reason", { exact: true })).toHaveValue(
        reason
      )
      await expect(page.getByLabel("Reason", { exact: true })).toBeDisabled()
      await expect(
        page.getByRole("button", {
          name: active ? "Retry reactivation" : "Retry archive",
          exact: true,
        })
      ).toBeVisible()
      await expect(
        page.getByRole("button", {
          name: active ? "Confirm archive" : "Confirm reactivation",
          exact: true,
        })
      ).toHaveCount(0)
      await button.click()
      await expect(
        page.getByRole("alert").filter({ hasText: "NETWORK_ERROR" })
      ).toBeVisible()
      assert.equal(
        network[start + 1].body,
        first.body,
        "retry must retain exact immutable envelope after refetch"
      )
      assert.equal(network[start + 1].status, 200)
      assert.equal(network[start + 1].result.commandId, first.result.commandId)
      assert.equal(network[start + 1].result.replayed, true)
      assert.deepEqual(await counts(id), committed)
      await refetch(id)
      await button.click()
      await expect(page.getByLabel("Reason", { exact: true })).toHaveValue("")
      assert.equal(network[start + 2].body, first.body)
      assert.equal(network[start + 2].result.commandId, first.result.commandId)
      assert.deepEqual(await counts(id), committed)
      assert.equal((await customer(id)).active, active)
      await expect(
        page.getByRole("button", {
          name: active ? "Confirm archive" : "Confirm reactivation",
          exact: true,
        })
      ).toBeVisible()
      if (start > 0)
        assert.notEqual(
          envelope.idempotencyKey,
          JSON.parse(network[start - 1].body).idempotencyKey
        )
      passed.push(
        `${active ? "reactivate" : "archive"}: commit, refetch, two response losses, exact replay, one audit/version/receipt; opposite intent only after explicit confirmation`
      )
    }
    // The edit path must not rotate a key or rebuild input from refreshed props either.
    await page.route("**/api/v1/commands/updateCustomer", transport)
    await page
      .getByRole("button", { name: "Edit customer", exact: true })
      .click()
    await page.locator('[name="notes"]').fill("Retained uncertain edit")
    await page.getByLabel(/Correction reason/).fill("Retained edit reason")
    const start = network.length
    lose = 2
    const save = page.getByRole("button", {
      name: /Save customer changes|Retry customer changes/,
      exact: true,
    })
    const before = await counts(id)
    await save.click()
    await expect(
      page.getByRole("alert").filter({ hasText: "NETWORK_ERROR" })
    ).toBeVisible()
    await expect(page.locator('[name="notes"]')).toBeDisabled()
    await expect(
      page.getByRole("button", { name: "Close edit form", exact: true })
    ).toBeDisabled()
    await expect(page.getByLabel(/Correction reason/)).toHaveValue(
      "Retained edit reason"
    )
    await refetch(id)
    await expect(page.locator('[name="notes"]')).toHaveValue(
      "Retained uncertain edit"
    )
    await expect(page.locator('[name="notes"]')).toBeDisabled()
    await save.click()
    await expect(
      page.getByRole("alert").filter({ hasText: "NETWORK_ERROR" })
    ).toBeVisible()
    await refetch(id)
    await save.click()
    await expect(page.locator('[name="notes"]')).toHaveCount(0)
    for (const entry of network.slice(start)) {
      assert.equal(entry.body, network[start].body)
      assert.equal(entry.result.commandId, network[start].result.commandId)
    }
    assert.deepEqual(await counts(id), {
      revision: before.revision + 1,
      audit: before.audit + 1,
      receipts: before.receipts + 1,
      versions: before.versions + 1,
    })
    passed.push(
      "edit: retained immutable input/reason/revision/key after repeated response loss and refetch"
    )
    // Genuine stale conflict remains an explicit reload + reconfirmation, not an uncertain replay.
    await page
      .getByLabel("Reason", { exact: true })
      .fill("Retained stale reason")
    const current = await customer(id)
    await post(
      "updateCustomer",
      { id, values: { ...values, notes: "Concurrent edit" } },
      expected(current)
    )
    const staleBefore = await counts(id)
    const staleStart = network.length
    await page
      .getByRole("button", { name: "Confirm archive", exact: true })
      .click()
    await expect(
      page.getByRole("alert").filter({ hasText: "STALE_REVISION" })
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: "Confirm archive", exact: true })
    ).toBeDisabled()
    assert.deepEqual(await counts(id), staleBefore)
    await page
      .getByRole("button", { name: "Reload status and reconfirm", exact: true })
      .click()
    await expect(page.getByLabel("Reason", { exact: true })).toHaveValue(
      "Retained stale reason"
    )
    assert.equal(network.length, staleStart + 1)
    await page
      .getByRole("button", { name: "Confirm archive", exact: true })
      .click()
    await expect(page.getByLabel("Reason", { exact: true })).toHaveValue("")
    assert.notEqual(
      JSON.parse(network.at(-1)!.body).idempotencyKey,
      JSON.parse(network[staleStart].body).idempotencyKey
    )
    passed.push(
      "true archive conflict: zero effects until explicit reload and new confirmation/key; reason retained"
    )
    // Shared create form: no editable inputs/close-induced new key before reconciliation.
    await page.goto("/customers")
    await page.route("**/api/v1/commands/createCustomer", transport)
    await page
      .getByRole("button", { name: "New customer", exact: true })
      .click()
    for (const [field, value] of Object.entries({
      ...values,
      nicOrPassport: randomUUID(),
    }))
      await page.locator(`[name="${field}"]`).fill(value)
    const createStart = network.length
    lose = 1
    await page
      .getByRole("button", { name: "Create customer", exact: true })
      .click()
    await expect(
      page.getByRole("alert").filter({ hasText: "NETWORK_ERROR" })
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: "Close new customer form", exact: true })
    ).toBeDisabled()
    await expect(page.locator('[name="notes"]')).toBeDisabled()
    const newId = network[createStart].result.result.id
    const createCounts = await counts(newId)
    await page.evaluate(() =>
      document.dispatchEvent(new Event("visibilitychange"))
    )
    await page
      .getByRole("button", { name: "Create customer", exact: true })
      .click()
    await page.waitForURL(`**/customers/${newId}`)
    assert.equal(network[createStart + 1].body, network[createStart].body)
    assert.equal(
      network[createStart + 1].result.commandId,
      network[createStart].result.commandId
    )
    assert.deepEqual(await counts(newId), createCounts)
    passed.push(
      "create: response loss/refetch retains exact command, draft and single creation"
    )

    // Revoke current authority immediately before the real replay transaction executes.
    const staff = await browser.newContext({ baseURL: origin })
    const staffPage = await staff.newPage()
    await staffPage.goto("/login")
    await staffPage
      .getByLabel("Email Address")
      .fill(accounts.BOOTSTRAP_STAFF_EMAIL!)
    await staffPage
      .getByLabel("Password", { exact: true })
      .fill(accounts.BOOTSTRAP_STAFF_PASSWORD!)
    await staffPage
      .getByRole("button", { name: "Sign In", exact: true })
      .click()
    await staffPage.waitForURL("**/dashboard")
    const actorResponse = await staff.request.get(
      "/api/v1/queries/currentActor"
    )
    const actor = (await actorResponse.json()).data
    const grants = [
      { subject: "Customer", action: "read", fields: ["*"] },
      { subject: "Customer", action: "archive", fields: ["active"] },
    ]
    const role = await post("saveRole", {
      name: `Response loss ${suffix}`,
      grants,
      reason: "Synthetic replay authority",
    })
    const roleResponse = await context.request.get(
      `/api/v1/queries/role?id=${role.result.id}`
    )
    const roleRow = (await roleResponse.json()).data
    const userResponse = await context.request.get(
      `/api/v1/queries/user?id=${actor.user.id}`
    )
    const userRow = (await userResponse.json()).data
    await post(
      "updateUser",
      {
        id: userRow.id,
        name: userRow.name,
        active: true,
        roleIds: [roleRow.id],
        reason: "Synthetic replay authority",
      },
      [
        { type: "User", id: userRow.id, revision: userRow.revision },
        { type: "Role", id: roleRow.id, revision: roleRow.revision },
      ]
    )
    await staffPage.goto(`/customers/${newId}`)
    await staffPage.route("**/api/v1/commands/archiveParty", transport)
    await staffPage
      .getByLabel("Reason", { exact: true })
      .fill("Uncertain then revoked")
    const revokedStart = network.length
    lose = 1
    await staffPage
      .getByRole("button", { name: "Confirm archive", exact: true })
      .click()
    await expect(
      staffPage.getByRole("alert").filter({ hasText: "NETWORK_ERROR" })
    ).toBeVisible()
    const committedBeforeRevoke = await counts(newId)
    beforeTransport = async () => {
      await post(
        "saveRole",
        {
          id: roleRow.id,
          name: roleRow.name,
          grants: grants.slice(0, 1),
          reason: "Revoke replay authority",
        },
        [{ type: "Role", id: roleRow.id, revision: roleRow.revision }]
      )
    }
    await staffPage
      .getByRole("button", { name: "Retry archive", exact: true })
      .click()
    await staffPage.waitForURL(/\/login/)
    assert.equal(network[revokedStart + 1].body, network[revokedStart].body)
    assert.equal(network[revokedStart + 1].status, 403)
    assert.deepEqual(await counts(newId), committedBeforeRevoke)
    await staff.close()
    passed.push(
      "uncertain replay after current-authority revocation: exact envelope, real 403, private UI purged, zero extra effects"
    )
    await writeFile(
      join(directory, "customer-response-loss-evidence.json"),
      JSON.stringify({ passed, network, origin }, null, 2),
      { mode: 0o600 }
    )
    for (const name of passed) console.log(`PASS ${name}`)
  } finally {
    await browser.close()
    if (server && server.exitCode === null) {
      const ended = once(server, "exit")
      server.kill("SIGTERM")
      await ended
    }
    await db.end()
  }
}
main().catch(async (error: unknown) => {
  await writeFile(
    join(process.argv[2], "customer-response-loss-failure.txt"),
    error instanceof Error
      ? error.stack!.replace(
          /postgres(?:ql)?:\/\/\S+/g,
          "[REDACTED_CONNECTION]"
        )
      : "Unknown failure",
    { mode: 0o600 }
  )
  console.error(
    "FAIL customer response-loss regression; private diagnostics retained, no credentials emitted"
  )
  process.exitCode = 1
})
