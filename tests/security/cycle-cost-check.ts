/** Retained synthetic UI -> production HTTP -> isolated PostgreSQL campaign. */
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { spawn, execFileSync, type ChildProcess } from "node:child_process"
import { once } from "node:events"
import { createServer } from "node:net"
import { join } from "node:path"
import { writeFile } from "node:fs/promises"
import {
  chromium,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test"
import pg from "pg"
import { privateEnvironment } from "../../scripts/private-environment"
import type {
  Applied,
  PurchaseCycleDTO,
  Dependency,
  Grant,
  CurrentActorDTO,
} from "../../.planning/implementation/contracts/api"

process.umask(0o077)
const root = process.argv[2]
assert.ok(root)
const runtime = await privateEnvironment(join(root, "runtime.env")),
  migration = await privateEnvironment(join(root, "migration.env")),
  accounts = await privateEnvironment(join(root, "accounts.env")),
  cluster = await privateEnvironment(join(root, "cluster.env")),
  admin = await privateEnvironment(join(root, "admin.env"))
assert.equal(cluster.PROJECT, process.argv[3] ?? process.cwd())
assert.equal(runtime.APP_ENV, "local")
assert.equal(new URL(runtime.DATABASE_URL!).hostname, "127.0.0.1")
let db = new pg.Pool({ connectionString: migration.DIRECT_URL, max: 3 }),
  restricted = new pg.Pool({ connectionString: runtime.DATABASE_URL, max: 1 })
const monitorURL = new URL(admin.ADMIN_URL!)
monitorURL.pathname = "/vamotors_local"
let monitor = new pg.Pool({ connectionString: monitorURL.href, max: 1 })
const socket = createServer().listen(0, "127.0.0.1")
await once(socket, "listening")
const address = socket.address()
assert.ok(address && typeof address !== "string")
const port = address.port,
  origin = `http://127.0.0.1:${port}`
await new Promise<void>((resolve) => socket.close(() => resolve()))
let server: ChildProcess | undefined
async function start() {
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
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("START_TIMEOUT")), 20000)
    server!.once("exit", () => {
      clearTimeout(timer)
      reject(new Error("EARLY_EXIT"))
    })
    server!.stdout!.on("data", (c) => {
      if (c.toString().includes("Ready")) {
        clearTimeout(timer)
        resolve()
      }
    })
  })
}
async function stop() {
  if (server && server.exitCode === null) {
    const end = once(server, "exit")
    server.kill("SIGTERM")
    await end
  }
  server = undefined
}
const browser = await chromium.launch({ headless: true }),
  a = await browser.newContext({
    baseURL: origin,
    viewport: { width: 1920, height: 1080 },
    serviceWorkers: "allow",
  }),
  b = await browser.newContext({
    baseURL: origin,
    viewport: { width: 360, height: 800 },
    serviceWorkers: "allow",
  }),
  staff = await browser.newContext({ baseURL: origin }),
  anonymous = await browser.newContext({ baseURL: origin })
const page = await a.newPage(),
  mobile = await b.newPage(),
  limited = await staff.newPage()
const suffix = randomUUID().slice(0, 8),
  groups: string[] = [],
  cycles: string[] = [],
  serviceWorker: Record<string, unknown> = {}
let stage = "initialize",
  originalStaff: CurrentActorDTO | undefined,
  supplier!: { id: string; revision: number },
  cycle!: PurchaseCycleDTO
async function group(name: string, fn: () => Promise<void>) {
  stage = name
  await fn()
  groups.push(name)
  console.log(`PASS ${name}`)
}
async function login(p: Page, who: "ADMIN" | "SECOND" | "STAFF") {
  await p.goto("/login")
  await p.getByLabel("Email Address").fill(accounts[`BOOTSTRAP_${who}_EMAIL`]!)
  await p
    .getByLabel("Password", { exact: true })
    .fill(accounts[`BOOTSTRAP_${who}_PASSWORD`]!)
  const send = async () => {
    const response = p.waitForResponse(
      (r) => new URL(r.url()).pathname === "/api/auth/sign-in/email"
    )
    await p.getByRole("button", { name: "Sign In", exact: true }).click()
    return response
  }
  let response = await send()
  if (response.status() === 429) {
    const seconds = Number(response.headers()["x-retry-after"])
    assert.ok(Number.isInteger(seconds) && seconds > 0 && seconds <= 120)
    await new Promise((r) => setTimeout(r, seconds * 1000))
    response = await send()
  }
  assert.equal(response.status(), 200)
  await p.waitForURL("**/dashboard")
}
async function query<T>(
  client: APIRequestContext,
  name: string,
  params = ""
): Promise<T> {
  const r = await client.get(`/api/v1/queries/${name}${params}`)
  assert.equal(r.status(), 200, `QUERY_${name}`)
  assert.match(r.headers()["cache-control"], /no-store/)
  return (await r.json()).data
}
const envelope = (
  input: unknown,
  expected: Dependency[] = [],
  key = randomUUID()
) => ({ schemaVersion: 1, idempotencyKey: key, expected, input })
const ref = (
  row: { id: string; revision: number },
  type: Dependency["type"] = "PurchaseRecord"
): Dependency => ({ type, id: row.id, revision: row.revision })
const refs = (row: PurchaseCycleDTO, costId?: string, vehicle = false) => [
  ref(row),
  ...(costId
    ? [ref(row.costs.find((c) => c.id === costId)!, "VehicleCost")]
    : []),
  ...(vehicle
    ? [
        {
          type: "Vehicle" as const,
          id: row.vehicleId,
          revision: row.identityRevision,
        },
      ]
    : []),
]
async function command(
  client: APIRequestContext,
  name: string,
  body: unknown,
  status = 200
): Promise<Applied> {
  const r = await client.post(`/api/v1/commands/${name}`, {
    data: body,
    headers: { Origin: origin },
  })
  const value = await r.json()
  assert.equal(r.status(), status, `${name}: ${JSON.stringify(value)}`)
  assert.match(r.headers()["cache-control"], /no-store/)
  return value
}
const current = (id = cycle.id, client = a.request) =>
  query<PurchaseCycleDTO>(client, "purchase", `?cycleId=${id}`)
const cash = (amount: string) => ({
  amount,
  date: "2026-10-03",
  method: "CASH",
})
const costInput = (row: PurchaseCycleDTO, amount = "500") => ({
  cycleId: row.id,
  category: "Transport",
  description: `Synthetic actual transport ${suffix}`,
  amount,
  incurredDate: "2026-10-02",
})
const tables = [
  "Vehicle",
  "PurchaseRecord",
  "VehicleCost",
  "PurchasePayment",
  "CostPayment",
  "MileageReading",
  "CycleBasisVersion",
  "StatusEvent",
  "CommandReceipt",
  "AuditEntry",
  "EntityReadVersion",
  "BusinessSequence",
]
async function snapshot() {
  const rows: Record<string, unknown> = {}
  for (const t of tables)
    rows[t] = (
      await db.query(
        `SELECT to_jsonb(t) AS row FROM vamotors."${t}" t ORDER BY id`
      )
    ).rows
  return JSON.stringify(rows)
}
async function create(tag: string) {
  const result = await command(
    a.request,
    "recordPurchase",
    envelope(
      {
        vehicle: {
          engineNumber: `COST-E-${suffix}-${tag}`,
          chassisNumber: `COST-C-${suffix}-${tag}`,
          make: "SyntheticCost",
          model: `T05c ${suffix}`,
          year: 2026,
          colour: "Blue",
          fuelType: "PETROL",
          transmission: "AUTOMATIC",
        },
        supplierId: supplier.id,
        purchaseType: "CASH",
        purchasePrice: "10000",
        listedPrice: "15000",
        purchaseDate: "2026-10-01",
        mileage: { reading: 0, date: "2026-10-01" },
        paymentMethod: "CASH",
      },
      [ref(supplier, "Supplier")]
    ),
    201
  )
  cycles.push(result.result.id)
  return current(result.result.id)
}
async function assign(grants: Grant[]) {
  const role = await command(
    a.request,
    "saveRole",
    envelope({
      name: `Cost-${suffix}-${randomUUID().slice(0, 6)}`,
      reason: "Synthetic cost authority",
      grants,
    }),
    201
  )
  const user = await query<{ id: string; name: string; revision: number }>(
    a.request,
    "user",
    `?id=${originalStaff!.user.id}`
  )
  await command(
    a.request,
    "updateUser",
    envelope(
      {
        id: user.id,
        name: user.name,
        active: true,
        roleIds: [role.result.id],
        reason: "Synthetic cost authority",
      },
      [ref(user, "User"), { type: "Role", id: role.result.id, revision: 1 }]
    )
  )
}
async function restoreStaff() {
  if (!originalStaff) return
  const user = await query<{ id: string; name: string; revision: number }>(
      a.request,
      "user",
      `?id=${originalStaff.user.id}`
    ),
    roles = await Promise.all(
      originalStaff.roles.map((r) =>
        query<{ id: string; revision: number }>(
          a.request,
          "role",
          `?id=${r.id}`
        )
      )
    )
  await command(
    a.request,
    "updateUser",
    envelope(
      {
        id: user.id,
        name: user.name,
        active: true,
        roleIds: roles.map((r) => r.id),
        reason: "Restore original staff authority",
      },
      [ref(user, "User"), ...roles.map((r) => ref(r, "Role"))]
    )
  )
}
const reads: Grant[] = [
  { subject: "PurchaseRecord", action: "read", fields: ["*"] },
  { subject: "Vehicle", action: "read", fields: ["*"] },
  { subject: "VehicleCost", action: "read", fields: ["*"] },
  { subject: "AuditLog", action: "read", fields: ["*"] },
]
try {
  await start()
  await group(
    "two real accounts, activated service worker and immutable paid acquisition",
    async () => {
      await login(page, "ADMIN")
      await page.waitForFunction(
        () => navigator.serviceWorker.controller?.state === "activated",
        undefined,
        { timeout: 5000 }
      )
      Object.assign(
        serviceWorker,
        await page.evaluate(() => ({
          controller: navigator.serviceWorker.controller?.scriptURL,
          state: navigator.serviceWorker.controller?.state,
        }))
      )
      assert.equal(serviceWorker.state, "activated")
      await login(mobile, "SECOND")
      await login(limited, "STAFF")
      originalStaff = await query(staff.request, "currentActor")
      assert.equal(
        (
          await anonymous.request.post("/api/v1/commands/addCost", {
            data: {},
            headers: { Origin: origin },
          })
        ).status(),
        401
      )
      const result = await command(
        a.request,
        "createDirectoryParty",
        envelope({
          type: "SUPPLIER",
          values: {
            name: `Cycle cost supplier ${suffix}`,
            category: "INDIVIDUAL",
            contacts: [],
          },
        }),
        201
      )
      supplier = await query(
        a.request,
        "party",
        `?type=SUPPLIER&id=${result.result.id}`
      )
      cycle = await create("primary")
      assert.equal(cycle.financial?.basis, "10000")
      assert.equal(cycle.payments.length, 1)
    }
  )
  await group(
    "desktop UI zero cost creates no money; unpaid incurred five raises basis to 105",
    async () => {
      await page.goto(`/purchases/${cycle.id}`)
      for (const amount of ["0.00", "5.00"]) {
        await page
          .getByRole("button", { name: "Add incurred cost", exact: true })
          .click()
        await page.getByLabel("Cost category").fill("Transport")
        await page
          .getByLabel("Cost description")
          .fill(`UI unpaid ${amount} ${suffix}`)
        await page.getByLabel("Incurred amount (major units)").fill(amount)
        await page.getByLabel("Actual incurred date").fill("2026-10-02")
        await page
          .getByRole("button", {
            name: "Confirm cycle money change",
            exact: true,
          })
          .click()
        await expect(
          page
            .getByRole("status")
            .filter({ hasText: "Cycle money change committed" })
        ).toBeVisible()
      }
      cycle = await current(cycle.id, b.request)
      assert.equal(cycle.costs.length, 2)
      assert.ok(cycle.costs.every((c) => c.payments.length === 0))
      assert.equal(cycle.financial?.basis, "10500")
      assert.equal(cycle.financial?.cashOut, "10000")
      assert.equal(
        (
          await db.query(
            'SELECT count(*) FROM vamotors."CostPayment" WHERE "cycleId"=$1',
            [cycle.id]
          )
        ).rows[0].count,
        "0"
      )
    }
  )
  await group(
    "360px keyboard actual partial two; both detail roots retain basis 105 and outstanding three",
    async () => {
      const cost = cycle.costs.find((c) => c.amount === "500")!
      await mobile.goto(`/vehicles/${cycle.vehicleId}`)
      await mobile
        .getByRole("button", { name: "Pay cost", exact: true })
        .click()
      await mobile.locator("#cycle-money-cost").selectOption(cost.id)
      await mobile
        .getByLabel("Actual payment amount (major units)")
        .fill("2.00")
      await mobile.getByLabel("Actual payment date").fill("2026-10-03")
      await mobile
        .getByRole("button", {
          name: "Confirm cycle money change",
          exact: true,
        })
        .focus()
      await mobile.keyboard.press("Enter")
      await expect(
        mobile
          .getByRole("status")
          .filter({ hasText: "Cycle money change committed" })
      ).toBeVisible()
      cycle = await current()
      assert.equal(
        cycle.costs.find((c) => c.id === cost.id)!.outstanding,
        "300"
      )
      assert.equal(cycle.financial?.cashOut, "10200")
      assert.equal(cycle.financial?.basis, "10500")
      assert.equal(cycle.identityRevision, 1)
      await mobile.reload()
      await expect(
        mobile.getByText("Actual cash out", { exact: true })
      ).toBeVisible()
      assert.equal(
        await mobile.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        ),
        true
      )
      const vehicle = await query<{
        financial: { basis: string; cashOut: string }
        cycles: PurchaseCycleDTO[]
      }>(b.request, "vehicle", `?id=${cycle.vehicleId}`)
      assert.equal(vehicle.financial.basis, "10500")
      assert.equal(vehicle.financial.cashOut, "10200")
      assert.equal(
        vehicle.cycles[0].costs.find((c) => c.id === cost.id)!.revision,
        2
      )
    }
  )
  await group(
    "full cost payment, caps, exact reversal/replacement and separate reasoned cost edit",
    async () => {
      let cost = cycle.costs.find((c) => c.amount === "500")!
      await command(
        a.request,
        "payCost",
        envelope(
          { costId: cost.id, payment: cash("300") },
          refs(cycle, cost.id)
        )
      )
      cycle = await current()
      cost = cycle.costs.find((c) => c.id === cost.id)!
      const paid = await snapshot()
      await command(
        a.request,
        "payCost",
        envelope({ costId: cost.id, payment: cash("1") }, refs(cycle, cost.id)),
        422
      )
      await command(
        a.request,
        "editCost",
        envelope(
          {
            costId: cost.id,
            category: cost.category,
            description: cost.description,
            amount: "400",
            incurredDate: cost.incurredDate,
            reason: "Would erase actual paid liability",
          },
          refs(cycle, cost.id)
        ),
        422
      )
      assert.equal(await snapshot(), paid)
      const original = cost.payments.find((p) => p.amount === "200")!,
        basisCount = cycle.basisVersions.length
      const reverse = {
        sourceType: "COST",
        sourceId: cost.id,
        paymentId: original.id,
        replacement: cash("100"),
        reason: "Correct accidentally overstated payment, not a refund",
      }
      await command(
        a.request,
        "reversePayment",
        envelope(reverse, refs(cycle, cost.id))
      )
      cycle = await current()
      cost = cycle.costs.find((c) => c.id === cost.id)!
      assert.equal(cost.outstanding, "100")
      assert.equal(cycle.basisVersions.length, basisCount)
      assert.equal(
        cost.payments.find((p) => p.reversalOf === original.id)!.amount,
        "200"
      )
      assert.equal(cycle.financial?.cashIn, "200")
      await command(
        a.request,
        "reversePayment",
        envelope(reverse, refs(cycle, cost.id)),
        409
      )
      await command(
        a.request,
        "reversePayment",
        envelope(
          {
            ...reverse,
            paymentId: cost.payments.find((p) => p.reversalOf)!.id,
          },
          refs(cycle, cost.id)
        ),
        409
      )
      await command(
        a.request,
        "reversePayment",
        envelope({ ...reverse, sourceId: randomUUID() }, refs(cycle, cost.id)),
        404
      )
      await command(
        a.request,
        "reversePayment",
        envelope(
          {
            sourceType: "COST",
            sourceId: cost.id,
            paymentId: cost.payments.find(
              (p) => p.amount === "300" && p.direction === "OUT"
            )!.id,
            reason: "Separate accounting correction before reducing cost",
          },
          refs(cycle, cost.id)
        )
      )
      cycle = await current()
      cost = cycle.costs.find((c) => c.id === cost.id)!
      assert.equal(cost.outstanding, "400")
      await command(
        a.request,
        "editCost",
        envelope(
          {
            costId: cost.id,
            category: "Inspection",
            description: "Corrected incurred invoice",
            amount: "200",
            incurredDate: cost.incurredDate,
            reason:
              "Actual invoice was two; payment correction already committed",
          },
          refs(cycle, cost.id)
        )
      )
      cycle = await current()
      cost = cycle.costs.find((c) => c.id === cost.id)!
      assert.equal(cost.outstanding, "100")
      assert.equal(cycle.financial?.basis, "10200")
      await command(
        a.request,
        "payCost",
        envelope(
          { costId: cost.id, payment: cash("100") },
          refs(cycle, cost.id)
        )
      )
      cycle = await current()
      assert.equal(cycle.costs.find((c) => c.id === cost.id)!.outstanding, "0")
    }
  )
  await group(
    "strict money/date/reason boundaries, exact DTOs and required owning refs are zero-effect",
    async () => {
      const row = await create("negatives"),
        before = await snapshot()
      for (const input of [
        { ...costInput(row), category: " " },
        { ...costInput(row), amount: "01" },
        { ...costInput(row), amount: "1.00" },
        { ...costInput(row), amount: "100000000000000" },
        { ...costInput(row), incurredDate: "2026-02-30" },
        { ...costInput(row), incurredDate: "9999-12-31" },
        { ...costInput(row), incurredDate: "2026-09-30" },
        { ...costInput(row), payment: cash("0") },
        { ...costInput(row), payment: cash("501") },
        { ...costInput(row), actor: "ADMIN" },
      ])
        await command(a.request, "addCost", envelope(input, refs(row)), 422)
      await command(a.request, "addCost", envelope(costInput(row)), 428)
      await command(
        a.request,
        "addCost",
        envelope(costInput(row), [{ ...ref(row), revision: 2 }]),
        409
      )
      await command(
        a.request,
        "editPurchase",
        envelope(
          {
            cycleId: row.id,
            reason: " ",
            patch: { purchasePrice: "1" },
            cashCorrections: [],
          },
          refs(row, undefined, true)
        ),
        422
      )
      await command(
        a.request,
        "editPurchase",
        envelope(
          {
            cycleId: row.id,
            reason: "No identity bypass",
            patch: { purchasePrice: "11000" },
            cashCorrections: [],
          },
          refs(row)
        ),
        428
      )
      for (const sourceType of ["SALE", "REPAIR", "FACILITY", "REMITTANCE"])
        await command(
          a.request,
          "reversePayment",
          envelope(
            {
              sourceType,
              sourceId: row.id,
              paymentId: row.payments[0].id,
              reason: "Unsupported source",
            },
            refs(row)
          ),
          422
        )
      await command(
        a.request,
        "payPurchase",
        envelope(
          { cycleId: row.id, recipient: "SETTLEMENT", payment: cash("1") },
          refs(row)
        ),
        422
      )
      assert.equal(await snapshot(), before)
      const result = await command(
          a.request,
          "addCost",
          envelope(costInput(row), refs(row)),
          201
        ),
        now = await current(row.id),
        cost = now.costs.find((c) => c.id === result.result.id)!
      const unchanged = await snapshot()
      for (const expected of [
        [ref(now)],
        [ref(cost, "VehicleCost")],
        [ref(now), { ...ref(cost, "VehicleCost"), revision: 2 }],
      ])
        await command(
          a.request,
          "payCost",
          envelope({ costId: cost.id, payment: cash("1") }, expected),
          expected.length === 2 ? 409 : 428
        )
      await command(
        a.request,
        "editCost",
        envelope(
          {
            costId: cost.id,
            category: cost.category,
            description: cost.description,
            amount: "1",
            incurredDate: cost.incurredDate,
            reason: "Explicit separate reverse only",
            cashCorrections: [],
          },
          refs(now, cost.id)
        ),
        422
      )
      assert.equal(await snapshot(), unchanged)
    }
  )
  await group(
    "same-key/different-key pay races, edit/pay races and stale child/cycle CAS",
    async () => {
      let row = await create("races")
      const added = await command(
        a.request,
        "addCost",
        envelope(costInput(row), refs(row)),
        201
      )
      row = await current(row.id)
      const costId = added.result.id
      const body = envelope({ costId, payment: cash("100") }, refs(row, costId))
      const same = await Promise.all([
        command(a.request, "payCost", body),
        command(a.request, "payCost", body),
      ])
      assert.equal(same[0].commandId, same[1].commandId)
      assert.equal(same.filter((r) => r.replayed).length, 1)
      row = await current(row.id)
      const responses = await Promise.all([
        a.request.post("/api/v1/commands/payCost", {
          data: envelope({ costId, payment: cash("300") }, refs(row, costId)),
          headers: { Origin: origin },
        }),
        b.request.post("/api/v1/commands/payCost", {
          data: envelope({ costId, payment: cash("300") }, refs(row, costId)),
          headers: { Origin: origin },
        }),
      ])
      assert.deepEqual(responses.map((r) => r.status()).sort(), [200, 409])
      row = await current(row.id)
      const c = row.costs.find((c) => c.id === costId)!
      const race = await Promise.all([
        a.request.post("/api/v1/commands/payCost", {
          data: envelope({ costId, payment: cash("100") }, refs(row, costId)),
          headers: { Origin: origin },
        }),
        b.request.post("/api/v1/commands/editCost", {
          data: envelope(
            {
              costId,
              category: c.category,
              description: "Concurrent corrected invoice",
              amount: "600",
              incurredDate: c.incurredDate,
              reason: "Real invoice correction",
            },
            refs(row, costId)
          ),
          headers: { Origin: origin },
        }),
      ])
      assert.deepEqual(race.map((r) => r.status()).sort(), [200, 409])
      assert.equal((await current(row.id)).revision, row.revision + 1)
      const before = await snapshot()
      await command(
        a.request,
        "payCost",
        { ...body, input: { costId, payment: cash("101") } },
        409
      )
      assert.equal(await snapshot(), before)
    }
  )
  await group(
    "actual lost committed UI response preserves exact envelope through active-SW refetch/auth failure",
    async () => {
      const row = await create("lost"),
        bodies: string[] = []
      let committed!: Applied
      await page.goto(`/purchases/${row.id}`)
      await page
        .getByRole("button", { name: "Add incurred cost", exact: true })
        .click()
      await page.getByLabel("Cost category").fill("Transport")
      await page
        .getByLabel("Cost description")
        .fill("Retained actual response-loss invoice")
      await page.getByLabel("Incurred amount (major units)").fill("5.00")
      await page.getByLabel("Actual incurred date").fill("2026-10-02")
      await page.getByLabel("Record a positive actual payment now").check()
      await page.getByLabel("Actual payment amount (major units)").fill("2.00")
      await page.getByLabel("Actual payment date").fill("2026-10-03")
      await a.route("**/api/v1/commands/addCost", async (route) => {
        bodies.push(route.request().postData()!)
        if (bodies.length === 1) {
          const response = await route.fetch()
          assert.equal(response.status(), 201)
          committed = await response.json()
          await route.abort("failed")
        } else await route.continue()
      })
      await page
        .getByRole("button", {
          name: "Confirm cycle money change",
          exact: true,
        })
        .click()
      await expect(
        page.getByRole("button", { name: "Retry unchanged money intent" })
      ).toBeVisible()
      assert.equal((await current(row.id)).costs.length, 1)
      assert.equal((await current(row.id)).costs[0].payments.length, 1)
      assert.equal((await current(row.id)).financial?.cashOut, "10200")
      await page.evaluate(() => window.dispatchEvent(new Event("focus")))
      await a.route("**/api/v1/queries/currentActor", (route) =>
        route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            ok: false,
            error: { code: "RETRYABLE_TRANSACTION", retryable: true },
          }),
        })
      )
      await page.evaluate(() => window.dispatchEvent(new Event("auth-check")))
      await expect(
        page.getByText("Checking access…", { exact: true })
      ).toBeVisible()
      await a.unroute("**/api/v1/queries/currentActor")
      await page.evaluate(() => window.dispatchEvent(new Event("focus")))
      await expect(
        page.getByRole("button", { name: "Retry unchanged money intent" })
      ).toBeVisible()
      await expect(page.getByLabel("Cost description")).toHaveValue(
        "Retained actual response-loss invoice"
      )
      const before = await snapshot()
      await page
        .getByRole("button", { name: "Retry unchanged money intent" })
        .click()
      await expect(
        page
          .getByRole("status")
          .filter({ hasText: "Cycle money change committed" })
      ).toBeVisible()
      assert.equal(bodies.length, 2)
      assert.equal(bodies[0], bodies[1])
      assert.equal(await snapshot(), before)
      const replay = await command(a.request, "addCost", JSON.parse(bodies[0]))
      assert.equal(replay.commandId, committed.commandId)
      assert.equal(replay.replayed, true)
      await a.unroute("**/api/v1/commands/addCost")
    }
  )
  await group(
    "stale UI retains draft and original body; SW-aware failed read then explicit new intent",
    async () => {
      let row = await create("stale")
      await page.goto(`/purchases/${row.id}`)
      await page
        .getByRole("button", { name: "Add incurred cost", exact: true })
        .click()
      await page.getByLabel("Cost category").fill("Inspection")
      await page.getByLabel("Cost description").fill("Retained stale invoice")
      await page.getByLabel("Incurred amount (major units)").fill("2.00")
      await page.getByLabel("Actual incurred date").fill("2026-10-02")
      await command(
        b.request,
        "addCost",
        envelope(costInput(row), refs(row)),
        201
      )
      const bodies: string[] = []
      await a.route("**/api/v1/commands/addCost", async (route) => {
        bodies.push(route.request().postData()!)
        await route.continue()
      })
      await page
        .getByRole("button", {
          name: "Confirm cycle money change",
          exact: true,
        })
        .click()
      await expect(
        page.getByRole("status").filter({ hasText: "STALE_REVISION" })
      ).toBeVisible()
      await a.route("**/api/v1/queries/purchase?**", (route) => {
        assert.ok(
          route.request().serviceWorker(),
          "Fault must reach controlling worker network request"
        )
        return route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            ok: false,
            error: { code: "RETRYABLE_TRANSACTION", retryable: true },
          }),
        })
      })
      await page
        .getByRole("button", { name: "Reload current cycle", exact: true })
        .click()
      await expect(
        page
          .getByRole("status")
          .filter({ hasText: "Current cycle reload failed" })
      ).toBeVisible()
      await expect(page.getByLabel("Cost description")).toHaveValue(
        "Retained stale invoice"
      )
      await a.unroute("**/api/v1/queries/purchase?**")
      await page
        .getByRole("button", { name: "Reload current cycle", exact: true })
        .click()
      await page
        .getByRole("button", {
          name: "Reconfirm retained draft as new money intent",
        })
        .click()
      await page
        .getByRole("button", {
          name: "Confirm cycle money change",
          exact: true,
        })
        .click()
      await expect(
        page
          .getByRole("status")
          .filter({ hasText: "Cycle money change committed" })
      ).toBeVisible()
      assert.equal(bodies.length, 2)
      assert.notEqual(
        JSON.parse(bodies[0]).idempotencyKey,
        JSON.parse(bodies[1]).idempotencyKey
      )
      assert.equal(
        JSON.parse(bodies[0]).input.description,
        JSON.parse(bodies[1]).input.description
      )
      row = await current(row.id)
      assert.equal(row.costs.length, 2)
      await a.unroute("**/api/v1/commands/addCost")
    }
  )
  await group(
    "every essential root/cost/payment/basis/audit/receipt/version/sequence/final write rolls back; exact-key recovery",
    async () => {
      let row = await create("faults")
      for (const [table, timing, predicate] of [
        ["PurchaseRecord", "BEFORE UPDATE", "true"],
        ["VehicleCost", "BEFORE INSERT", "true"],
        ["CostPayment", "BEFORE INSERT", "true"],
        ["CycleBasisVersion", "BEFORE INSERT", "true"],
        ["AuditEntry", "BEFORE INSERT", `NEW."entityType"='PurchaseRecord'`],
        ["AuditEntry", "BEFORE INSERT", `NEW."entityType"='Vehicle'`],
        ["AuditEntry", "BEFORE INSERT", `NEW."entityType"='VehicleCost'`],
        ["CommandReceipt", "BEFORE INSERT", "true"],
        [
          "EntityReadVersion",
          "BEFORE INSERT",
          `NEW."entityType"='PurchaseRecord'`,
        ],
        ["EntityReadVersion", "BEFORE INSERT", `NEW."entityType"='Vehicle'`],
        ["BusinessSequence", "BEFORE UPDATE", "true"],
        ["PurchaseRecord", "AFTER UPDATE", "true"],
      ]) {
        const body = envelope(
            { ...costInput(row, "100"), payment: cash("100") },
            refs(row)
          ),
          before = await snapshot()
        try {
          await db.query(
            `CREATE FUNCTION vamotors.cycle_cost_test_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${predicate} THEN RAISE EXCEPTION 'SYNTHETIC_CYCLE_COST_FAULT'; END IF; RETURN NEW; END $$`
          )
          await db.query(
            timing === "AFTER UPDATE"
              ? `CREATE CONSTRAINT TRIGGER cycle_cost_test_fault AFTER UPDATE ON vamotors."${table}" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vamotors.cycle_cost_test_fault()`
              : `CREATE TRIGGER cycle_cost_test_fault ${timing} ON vamotors."${table}" FOR EACH ROW EXECUTE FUNCTION vamotors.cycle_cost_test_fault()`
          )
          await command(a.request, "addCost", body, 500)
          assert.equal(await snapshot(), before)
        } finally {
          await db.query(
            `DROP TRIGGER IF EXISTS cycle_cost_test_fault ON vamotors."${table}"`
          )
          await db.query(
            "DROP FUNCTION IF EXISTS vamotors.cycle_cost_test_fault()"
          )
        }
        await command(a.request, "addCost", body, 201)
        row = await current(row.id)
      }
      const cost = row.costs[0],
        original = row.payments[0],
        body = envelope(
          {
            sourceType: "PURCHASE",
            sourceId: row.id,
            paymentId: original.id,
            replacement: cash("9900"),
            reason: "Fault-injected immutable purchase reversal",
          },
          refs(row)
        ),
        before = await snapshot()
      try {
        await db.query(
          "CREATE FUNCTION vamotors.cycle_cost_test_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'SYNTHETIC_PURCHASE_PAYMENT_FAULT'; END $$"
        )
        await db.query(
          'CREATE TRIGGER cycle_cost_test_fault BEFORE INSERT ON vamotors."PurchasePayment" FOR EACH ROW EXECUTE FUNCTION vamotors.cycle_cost_test_fault()'
        )
        await command(a.request, "reversePayment", body, 500)
        assert.equal(await snapshot(), before)
      } finally {
        await db.query(
          'DROP TRIGGER IF EXISTS cycle_cost_test_fault ON vamotors."PurchasePayment"'
        )
        await db.query(
          "DROP FUNCTION IF EXISTS vamotors.cycle_cost_test_fault()"
        )
      }
      assert.ok(cost)
      await command(a.request, "reversePayment", body)
    }
  )
  await group(
    "root+child+field authority, hidden costs/amounts/aggregates/audit reasons and current revocation",
    async () => {
      const row = await create("privacy"),
        added = await command(
          a.request,
          "addCost",
          envelope(
            {
              ...costInput(row),
              description: "PRIVATE_COST_MARKER",
              payment: cash("200"),
            },
            refs(row)
          ),
          201
        ),
        now = await current(row.id),
        cost = now.costs.find((c) => c.id === added.result.id)!
      const write: Grant[] = [
        { subject: "PurchaseRecord", action: "update", fields: ["cycleId"] },
        { subject: "VehicleCost", action: "create", fields: ["*"] },
        { subject: "VehicleCost", action: "update", fields: ["*"] },
        { subject: "PurchaseRecord", action: "pay", fields: ["cycleId"] },
        { subject: "VehicleCost", action: "pay", fields: ["*"] },
      ]
      for (const grants of [
        reads,
        [...reads, ...write.filter((g) => g.subject !== "PurchaseRecord")],
        [...reads, ...write.filter((g) => g.subject !== "VehicleCost")],
      ]) {
        await assign(grants)
        const before = await snapshot()
        await command(
          staff.request,
          "editCost",
          envelope(
            {
              costId: cost.id,
              category: cost.category,
              description: cost.description,
              amount: "600",
              incurredDate: cost.incurredDate,
              reason: "PRIVATE_REASON_MARKER",
            },
            refs(now, cost.id)
          ),
          403
        )
        assert.equal(await snapshot(), before)
      }
      await assign([...reads, ...write])
      await command(
        staff.request,
        "editCost",
        envelope(
          {
            costId: cost.id,
            category: cost.category,
            description: cost.description,
            amount: "600",
            incurredDate: cost.incurredDate,
            reason: "PRIVATE_REASON_MARKER",
          },
          refs(now, cost.id)
        )
      )
      await assign(reads.filter((g) => g.subject !== "VehicleCost"))
      const hidden = await query<Record<string, unknown>>(
        staff.request,
        "purchase",
        `?cycleId=${row.id}`
      )
      assert.deepEqual(hidden.costs, [])
      assert.equal("basis" in (hidden.financial as object), false)
      assert.equal("additionalCosts" in (hidden.financial as object), false)
      assert.equal("cashOut" in (hidden.financial as object), false)
      assert.equal("basisVersions" in hidden, false)
      assert.ok(!JSON.stringify(hidden).includes("PRIVATE_COST_MARKER"))
      const audit = await query(
        staff.request,
        "audit",
        `?type=PurchaseRecord&id=${row.id}`
      )
      assert.ok(!JSON.stringify(audit).includes("PRIVATE_REASON_MARKER"))
      assert.ok(!JSON.stringify(audit).includes("PRIVATE_COST_MARKER"))
      await assign([
        ...reads.filter((g) => g.subject !== "VehicleCost"),
        {
          subject: "VehicleCost",
          action: "read",
          fields: ["id", "revision", "description"],
        },
      ])
      const leaf = await query<PurchaseCycleDTO>(
        staff.request,
        "purchase",
        `?cycleId=${row.id}`
      )
      assert.equal(leaf.costs[0].description, "PRIVATE_COST_MARKER")
      assert.equal(leaf.costs[0].amount, undefined)
      assert.equal(leaf.costs[0].outstanding, undefined)
      assert.equal(leaf.costs[0].payments, undefined)
      const costAudit = await query(
        staff.request,
        "audit",
        `?type=VehicleCost&id=${cost.id}`
      )
      assert.ok(!JSON.stringify(costAudit).includes("PRIVATE_REASON_MARKER"))
      assert.ok(!JSON.stringify(costAudit).includes('"600"'))
      await assign([
        ...reads.filter((g) => g.subject !== "VehicleCost"),
        {
          subject: "VehicleCost",
          action: "read",
          fields: ["id", "revision", "amount"],
        },
      ])
      const amountOnly = await query<PurchaseCycleDTO>(
        staff.request,
        "purchase",
        `?cycleId=${row.id}`
      )
      assert.equal(amountOnly.financial?.basis, "10600")
      assert.ok(
        !JSON.stringify(amountOnly.basisVersions).includes(
          "PRIVATE_REASON_MARKER"
        ),
        "Basis reasons must not launder a source-hidden correction reason"
      )
      const costFields = [
        "id",
        "revision",
        "category",
        "description",
        "amount",
        "incurredDate",
        "payments.id",
        "payments.amount",
        "outstanding",
      ]
      for (const denied of ["child-direction", "root-direction", "none"]) {
        await assign(
          denied === "none"
            ? reads
            : [
                ...reads.filter(
                  (g) =>
                    g.subject !==
                    (denied === "child-direction"
                      ? "VehicleCost"
                      : "PurchaseRecord")
                ),
                {
                  subject:
                    denied === "child-direction"
                      ? "VehicleCost"
                      : "PurchaseRecord",
                  action: "read",
                  fields:
                    denied === "child-direction"
                      ? costFields
                      : [
                          "id",
                          "revision",
                          "vehicleId",
                          "identityRevision",
                          "purchasePrice",
                          "financial",
                          "payments",
                          ...costFields.map((f) => `costs.${f}`),
                        ],
                },
              ]
        )
        const actor = await query<CurrentActorDTO>(
            staff.request,
            "currentActor"
          ),
          purchase = await current(row.id, staff.request),
          vehicle = await query<{ cycles: PurchaseCycleDTO[] }>(
            staff.request,
            "vehicle",
            `?id=${row.vehicleId}`
          ),
          purchases = await query<{ data: PurchaseCycleDTO[] }>(
            staff.request,
            "purchases",
            `?vehicleId=${row.vehicleId}`
          ),
          audits = await Promise.all(
            [
              ["PurchaseRecord", row.id],
              ["VehicleCost", cost.id],
            ].map(([type, id]) =>
              query(staff.request, "audit", `?type=${type}&id=${id}`)
            )
          )
        const evidence = { denied, actor, purchase, vehicle, purchases, audits }
        await writeFile(
          join(root, `cycle-cost-direction-${suffix}-${denied}.json`),
          JSON.stringify(evidence, null, 2),
          { mode: 0o600 }
        )
        assert.equal(actor.roles.length, 1, "No inherited role may mask denial")
        const authorized = denied === "none"
        for (const projected of [
          purchase,
          vehicle.cycles.find((c) => c.id === row.id)!,
          purchases.data.find((c) => c.id === row.id)!,
        ]) {
          const visible = projected.costs.find((c) => c.id === cost.id)!
          assert.equal(visible.amount, "600")
          assert.equal(visible.payments[0].amount, "200")
          assert.equal(
            visible.payments[0].direction,
            authorized ? "OUT" : undefined
          )
          assert.equal(
            visible.outstanding,
            authorized ? "400" : undefined,
            `${denied}: outstanding must inherit both source direction grants`
          )
          assert.equal(
            projected.financial?.cashOut,
            authorized ? "10200" : undefined
          )
        }
        for (const audit of audits)
          assert.equal(JSON.stringify(audit).includes('"400"'), authorized)
        for (const width of [360, 1920]) {
          await limited.setViewportSize({ width, height: 1080 })
          for (const path of [
            `/purchases/${row.id}`,
            `/vehicles/${row.vehicleId}`,
          ]) {
            await limited.goto(path)
            const item = limited.locator("li").filter({
              has: limited.locator("p").filter({ hasText: `Cost ${cost.id}` }),
            })
            await expect(item).toBeVisible()
            await expect(item).toContainText(
              `outstanding ${authorized ? "4.00" : "Unavailable"}`
            )
            assert.equal(/\bOUT\b/.test(await item.innerText()), authorized)
            const name = `cycle-cost-direction-${suffix}-${denied}-${width}-${path.split("/")[1]}`
            await limited.screenshot({
              path: join(root, `${name}.png`),
              fullPage: true,
            })
            await writeFile(
              join(root, `${name}.txt`),
              await limited.locator("body").innerText(),
              { mode: 0o600 }
            )
          }
        }
      }
      await restoreStaff()
    }
  )
  await group(
    "observed BusinessSequence waits recheck revoked execution and exact-key replay authority",
    async () => {
      const row = await create("revocation"),
        grants: Grant[] = [
          ...reads,
          { subject: "PurchaseRecord", action: "update", fields: ["cycleId"] },
          { subject: "VehicleCost", action: "create", fields: ["*"] },
        ]
      await assign(grants)
      const body = envelope(costInput(row), refs(row))
      await command(staff.request, "addCost", body, 201)
      for (const mode of ["execution", "replay"]) {
        await assign(grants)
        const target = await current(row.id),
          requestBody =
            mode === "replay"
              ? body
              : envelope(costInput(target), refs(target)),
          blocker = await db.connect()
        try {
          await blocker.query("BEGIN")
          await blocker.query(
            'SELECT value FROM vamotors."BusinessSequence" WHERE id=1 FOR UPDATE'
          )
          const request = staff.request.post("/api/v1/commands/addCost", {
            data: requestBody,
            headers: { Origin: origin },
          })
          await expect
            .poll(
              async () =>
                Number(
                  (
                    await monitor.query(
                      "SELECT count(*) FROM pg_stat_activity WHERE usename='vamotors_runtime' AND wait_event_type='Lock' AND query LIKE '%BusinessSequence%'"
                    )
                  ).rows[0].count
                ),
              { timeout: 1200 }
            )
            .toBeGreaterThan(0)
          await assign(reads)
          const before = await snapshot()
          await blocker.query("COMMIT")
          assert.equal((await request).status(), 403)
          assert.equal(await snapshot(), before)
        } finally {
          await blocker.query("ROLLBACK")
          blocker.release()
          await restoreStaff()
        }
      }
    }
  )
  await group(
    "runtime column ACLs, immutable opposite history, same-cycle FKs and final-graph guards",
    async () => {
      const row = await current(),
        c = row.costs.find((c) => c.amount === "200")!,
        before = await snapshot()
      for (const sql of [
        `UPDATE vamotors."PurchaseRecord" SET "supplierId"="supplierId" WHERE id='${row.id}'`,
        `UPDATE vamotors."Vehicle" SET revision=revision+1 WHERE id='${row.vehicleId}'`,
        `UPDATE vamotors."PurchaseRecord" SET "purchasePrice"=1,revision=revision+1 WHERE id='${row.id}'`,
        `UPDATE vamotors."VehicleCost" SET amount=1,revision=revision+1 WHERE id='${c.id}'`,
        `DELETE FROM vamotors."VehicleCost" WHERE id='${c.id}'`,
        `UPDATE vamotors."CostPayment" SET amount=1 WHERE "costId"='${c.id}'`,
        `DELETE FROM vamotors."CostPayment" WHERE "costId"='${c.id}'`,
        `TRUNCATE vamotors."CostPayment"`,
        `ALTER TABLE vamotors."VehicleCost" ADD COLUMN forbidden text`,
      ])
        await assert.rejects(restricted.query(sql))
      for (const sql of [
        `UPDATE vamotors."VehicleCost" SET "cycleId"='${randomUUID()}',revision=revision+1 WHERE id='${c.id}'`,
        `UPDATE vamotors."CostPayment" SET amount=1 WHERE "costId"='${c.id}'`,
        `UPDATE vamotors."CycleBasisVersion" SET total=1 WHERE "cycleId"='${row.id}'`,
        `UPDATE vamotors."PurchaseRecord" SET status='SOLD',revision=revision+1 WHERE id='${row.id}'`,
      ])
        await assert.rejects(db.query(sql))
      assert.equal(await snapshot(), before)
    }
  )
  await group(
    "real UI explicit payment correction, then fresh reasoned cost and purchase edits",
    async () => {
      let row = await create("ui-corrections")
      const add = await command(
        a.request,
        "addCost",
        envelope({ ...costInput(row), payment: cash("200") }, refs(row)),
        201
      )
      row = await current(row.id)
      const cost = row.costs.find((c) => c.id === add.result.id)!
      await page.goto(`/purchases/${row.id}`)
      await page
        .getByRole("button", { name: "Correct payment entry", exact: true })
        .click()
      await page.getByLabel("Payment owner").selectOption(cost.id)
      await page
        .getByLabel("Original payment")
        .selectOption(cost.payments[0].id)
      await page
        .getByLabel("Mandatory correction reason")
        .fill("UI accounting correction before fresh cost edit")
      await page
        .getByRole("button", {
          name: "Confirm cycle money change",
          exact: true,
        })
        .click()
      await expect(
        page
          .getByRole("status")
          .filter({ hasText: "Cycle money change committed" })
      ).toBeVisible()
      row = await current(row.id)
      assert.equal(row.costs.find((c) => c.id === cost.id)!.outstanding, "500")
      assert.equal(row.financial?.basis, "10500")
      await page
        .getByRole("button", { name: "Correct cost terms", exact: true })
        .click()
      await page.locator("#cycle-money-cost").selectOption(cost.id)
      await page.getByLabel("Incurred amount (major units)").fill("3.00")
      await page
        .getByLabel("Mandatory correction reason")
        .fill(
          "UI actual invoice three after separate committed payment correction"
        )
      await page
        .getByRole("button", {
          name: "Confirm cycle money change",
          exact: true,
        })
        .click()
      await expect(
        page
          .getByRole("status")
          .filter({ hasText: "Cycle money change committed" })
      ).toBeVisible()
      row = await current(row.id)
      assert.equal(row.financial?.basis, "10300")
      assert.equal(row.costs.find((c) => c.id === cost.id)!.payments.length, 2)
      await page
        .getByRole("button", { name: "Correct purchase terms", exact: true })
        .click()
      await page
        .getByLabel("Corrected purchase price (major units)")
        .fill("110.00")
      await page
        .getByLabel("Purchase notes")
        .fill("UI current corrected purchase note")
      await page
        .getByLabel("Mandatory correction reason")
        .fill("UI reasoned supplier price correction")
      await page
        .getByRole("button", {
          name: "Confirm cycle money change",
          exact: true,
        })
        .click()
      await expect(
        page
          .getByRole("status")
          .filter({ hasText: "Cycle money change committed" })
      ).toBeVisible()
      row = await current(row.id)
      assert.equal(row.purchasePrice, "11000")
      assert.equal(row.financial?.basis, "11300")
      assert.equal(row.outstanding.seller, "1000")
      assert.equal(row.notes, "UI current corrected purchase note")
    }
  )
  await group(
    "grant revocation and logout/account switch purge private cost drafts, no browser persistence",
    async () => {
      const grants: Grant[] = [
        ...reads,
        { subject: "PurchaseRecord", action: "update", fields: ["cycleId"] },
        { subject: "VehicleCost", action: "create", fields: ["*"] },
      ]
      await assign(grants)
      await limited.goto(`/purchases/${cycle.id}`)
      await limited
        .getByRole("button", { name: "Add incurred cost", exact: true })
        .click()
      await limited
        .getByLabel("Cost description")
        .fill("PRIVATE_COST_DRAFT_PURGE")
      await assign(reads)
      await limited.evaluate(() =>
        window.dispatchEvent(new Event("auth-check"))
      )
      await expect(limited.getByLabel("Cost description")).toHaveCount(0)
      await assign(grants)
      await limited.goto(`/purchases/${cycle.id}`)
      await limited
        .getByRole("button", { name: "Add incurred cost", exact: true })
        .click()
      await limited
        .getByLabel("Cost description")
        .fill("PRIVATE_LOGOUT_COST_DRAFT")
      await limited.getByRole("button", { name: "Logout", exact: true }).click()
      await limited.waitForURL(/\/login(?:\?|$)/)
      await expect(limited.getByLabel("Cost description")).toHaveCount(0)
      await login(limited, "SECOND")
      await limited.goto(`/purchases/${cycle.id}`)
      await expect(
        limited.getByRole("button", { name: "Add incurred cost", exact: true })
      ).toBeVisible()
      await expect(limited.getByLabel("Cost description")).toHaveCount(0)
      assert.equal(
        await limited.evaluate(() =>
          JSON.stringify({ ...localStorage, ...sessionStorage }).includes(
            "PRIVATE_"
          )
        ),
        false
      )
      await restoreStaff()
    }
  )
  await group(
    "app and isolated PostgreSQL restart retain source facts, corrections, basis history and sessions",
    async () => {
      const before = await snapshot()
      await stop()
      await db.end()
      await restricted.end()
      await monitor.end()
      for (const action of ["stop", "start"])
        execFileSync(
          process.execPath,
          ["--import", "tsx", "scripts/local-postgres.ts", action],
          {
            cwd: cluster.PROJECT,
            env: { ...process.env, VAMOTORS_LOCAL_DIR: root },
            stdio: "pipe",
          }
        )
      db = new pg.Pool({ connectionString: migration.DIRECT_URL, max: 3 })
      restricted = new pg.Pool({
        connectionString: runtime.DATABASE_URL,
        max: 1,
      })
      monitor = new pg.Pool({ connectionString: monitorURL.href, max: 1 })
      await start()
      assert.equal(await snapshot(), before)
      for (const id of cycles)
        assert.equal((await current(id, b.request)).id, id)
      await mobile.goto(`/vehicles/${cycle.vehicleId}`)
      await expect(
        mobile.getByRole("heading", {
          name: "Incurred costs and actual payments",
          exact: true,
        })
      ).toBeVisible()
      assert.equal(
        (await current(cycle.id, b.request)).financial?.basis,
        "10200"
      )
    }
  )
  await group(
    "cost-bearing stock receipt/release preserves money; held IN_STOCK accepts bounded cost correction",
    async () => {
      cycle = await current()
      const immutable = JSON.stringify({
        payments: cycle.payments,
        costs: cycle.costs,
        basis: cycle.basisVersions,
        financial: cycle.financial,
      })
      await command(
        a.request,
        "receiveStock",
        envelope(
          {
            cycleId: cycle.id,
            date: "2026-10-03",
            disposition: {
              kind: "HOLD",
              reason: "Real held stock after incurred costs",
            },
          },
          refs(cycle)
        )
      )
      cycle = await current()
      assert.equal(cycle.status, "IN_STOCK")
      assert.equal(cycle.available, false)
      assert.equal(
        JSON.stringify({
          payments: cycle.payments,
          costs: cycle.costs,
          basis: cycle.basisVersions,
          financial: cycle.financial,
        }),
        immutable
      )
      const zero = cycle.costs.find((c) => c.amount === "0")!
      await command(
        a.request,
        "editCost",
        envelope(
          {
            costId: zero.id,
            category: zero.category,
            description: "Reasoned zero-cost description correction while held",
            amount: "0",
            incurredDate: zero.incurredDate,
            reason: "Correct description only; zero is not an actual payment",
          },
          refs(cycle, zero.id)
        )
      )
      cycle = await current()
      assert.equal(cycle.available, false)
      assert.equal(cycle.financial?.basis, "10200")
      assert.equal(
        cycle.costs.find((c) => c.id === zero.id)!.payments.length,
        0
      )
      const money = JSON.stringify({
        payments: cycle.payments,
        costs: cycle.costs,
        basis: cycle.basisVersions,
        financial: cycle.financial,
      })
      await command(
        a.request,
        "releaseStock",
        envelope({ cycleId: cycle.id }, refs(cycle))
      )
      cycle = await current()
      assert.equal(cycle.available, true)
      assert.equal(
        JSON.stringify({
          payments: cycle.payments,
          costs: cycle.costs,
          basis: cycle.basisVersions,
          financial: cycle.financial,
        }),
        money
      )
    }
  )
  await group(
    "bounded purchase price/date/notes, true seller outstanding and original immutable basis/payment",
    async () => {
      const initial = cycle.basisVersions[0],
        original = cycle.payments[0]
      await command(
        a.request,
        "payPurchase",
        envelope(
          { cycleId: cycle.id, recipient: "SELLER", payment: cash("1") },
          refs(cycle)
        ),
        422
      )
      await command(
        a.request,
        "editPurchase",
        envelope(
          {
            cycleId: cycle.id,
            reason: "Correct supplier invoice to 120",
            patch: {
              purchasePrice: "12000",
              purchaseDate: "2026-09-30",
              notes: "Synthetic corrected terms",
            },
            cashCorrections: [],
          },
          refs(cycle, undefined, true)
        )
      )
      cycle = await current()
      assert.equal(cycle.outstanding.seller, "2000")
      assert.equal(cycle.financial?.basis, "12200")
      await command(
        a.request,
        "payPurchase",
        envelope(
          { cycleId: cycle.id, recipient: "SELLER", payment: cash("1000") },
          refs(cycle)
        )
      )
      cycle = await current()
      await command(
        a.request,
        "editPurchase",
        envelope(
          {
            cycleId: cycle.id,
            reason: "Correct actual invoice and explicit original payment",
            patch: { purchasePrice: "9500", notes: null },
            cashCorrections: [
              {
                paymentId: original.id,
                replacement: cash("8000"),
                reason:
                  "Original entry overstated by twenty, not a physical refund",
              },
            ],
          },
          refs(cycle, undefined, true)
        )
      )
      cycle = await current()
      assert.equal(cycle.outstanding.seller, "500")
      assert.equal(cycle.financial?.basis, "9700")
      assert.equal(cycle.notes, undefined)
      assert.deepEqual(cycle.basisVersions[0], initial)
      assert.deepEqual(
        cycle.payments.find((p) => p.id === original.id),
        original
      )
      await command(
        a.request,
        "payPurchase",
        envelope(
          { cycleId: cycle.id, recipient: "SELLER", payment: cash("500") },
          refs(cycle)
        )
      )
      cycle = await current()
      assert.equal(cycle.outstanding.seller, "0")
      const versions = (
        await db.query(
          'SELECT "entityType",revision,payload->>\'revision\' AS view_revision,sequence FROM vamotors."EntityReadVersion" WHERE "commandId"=(SELECT id FROM vamotors."CommandReceipt" WHERE "businessSequence"=(SELECT value FROM vamotors."BusinessSequence" WHERE id=1)) ORDER BY "entityType"'
        )
      ).rows
      assert.deepEqual(
        versions.map((v) => [v.entityType, v.revision, v.view_revision]),
        [
          ["PurchaseRecord", cycle.revision, String(cycle.revision)],
          ["Vehicle", 1, String(cycle.revision)],
        ]
      )
      assert.equal(versions[0].sequence, versions[1].sequence)
    }
  )
  const evidence = {
    head: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    dirty: !!execFileSync("git", ["status", "--porcelain"], {
      encoding: "utf8",
    }).trim(),
    authorPrebase: false,
    acceptedParent: "e9ba1a939667fc46178f89cccae1022a4bbcfb7e",
    origin,
    browser: await browser.version(),
    groups,
    cycles,
    serviceWorker,
    migrations: (
      await db.query(
        "SELECT migration_name,checksum FROM vamotors._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name"
      )
    ).rows,
    grants: (
      await db.query(
        "SELECT table_name,column_name,privilege_type FROM information_schema.column_privileges WHERE grantee='vamotors_runtime' ORDER BY table_name,column_name,privilege_type"
      )
    ).rows,
  }
  await writeFile(
    join(root, `cycle-cost-${suffix}.json`),
    JSON.stringify(evidence, null, 2),
    { mode: 0o600 }
  )
  console.log(
    `PASS ${groups.length} cycle-cost groups; cycle-cost-${suffix}.json`
  )
} catch (error) {
  await writeFile(
    join(root, `cycle-cost-failure-${suffix}.json`),
    JSON.stringify(
      {
        stage,
        groups,
        primary: await page.locator("body").innerText(),
        mobile: await mobile.locator("body").innerText(),
      },
      null,
      2
    ),
    { mode: 0o600 }
  )
  console.error(
    `FAIL ${stage}: ${error instanceof Error ? error.message : "TEST_FAILED"}`
  )
  process.exitCode = 1
} finally {
  try {
    await restoreStaff()
  } catch {
    console.error("STAFF_RESTORE_FAILED")
    process.exitCode = 1
  }
  await browser.close()
  await stop()
  await db.end()
  await restricted.end()
  await monitor.end()
}
