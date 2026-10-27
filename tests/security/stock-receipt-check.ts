/** Retained synthetic PostgreSQL + production HTTP/Chromium stock campaign. */
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
  type APIRequestContext,
  type Page,
} from "@playwright/test"
import pg from "pg"
import { privateEnvironment } from "../../scripts/private-environment"
import type {
  Applied,
  PurchaseCycleDTO,
  PartyDTO,
  Grant,
  CurrentActorDTO,
  Dependency,
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
  restricted = new pg.Pool({ connectionString: runtime.DATABASE_URL, max: 2 })
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
  }),
  b = await browser.newContext({
    baseURL: origin,
    viewport: { width: 360, height: 800 },
  }),
  staff = await browser.newContext({ baseURL: origin }),
  anonymous = await browser.newContext({ baseURL: origin })
const page = await a.newPage(),
  mobile = await b.newPage(),
  limited = await staff.newPage()
const suffix = randomUUID().slice(0, 8),
  results: string[] = [],
  cycles: string[] = []
let stage = "initialize",
  originalStaff: CurrentActorDTO | undefined
async function group(name: string, run: () => Promise<void>) {
  stage = name
  await run()
  results.push(name)
  console.log(`PASS ${name}`)
}
async function login(p: Page, who: "ADMIN" | "SECOND" | "STAFF") {
  await p.goto("/login")
  await p.getByLabel("Email Address").fill(accounts[`BOOTSTRAP_${who}_EMAIL`]!)
  await p
    .getByLabel("Password", { exact: true })
    .fill(accounts[`BOOTSTRAP_${who}_PASSWORD`]!)
  await p.getByRole("button", { name: "Sign In", exact: true }).click()
  await p.waitForURL("**/dashboard")
}
async function query<T>(
  client: APIRequestContext,
  name: string,
  params = ""
): Promise<T> {
  const r = await client.get(`/api/v1/queries/${name}${params}`)
  assert.equal(r.status(), 200, `QUERY_${name}_${r.status()}`)
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
  assert.equal(r.status(), status, `${name}_${JSON.stringify(value)}`)
  assert.match(r.headers()["cache-control"], /no-store/)
  if (status >= 400)
    assert.deepEqual(Object.keys(value).sort(), ["error", "ok"])
  return value
}
const snapshotTables = [
  "Vehicle",
  "PurchaseRecord",
  "PurchasePayment",
  "MileageReading",
  "CycleBasisVersion",
  "StatusEvent",
  "CommandReceipt",
  "AuditEntry",
  "EntityReadVersion",
  "BusinessSequence",
]
async function snapshot(tables = snapshotTables) {
  const result: Record<string, unknown> = {}
  for (const table of tables)
    result[table] = (
      await db.query(
        `SELECT to_jsonb(t) AS row FROM vamotors."${table}" t ORDER BY id`
      )
    ).rows
  return JSON.stringify(result)
}
const money = () =>
  snapshot(["PurchasePayment", "MileageReading", "CycleBasisVersion"])
const current = (id: string, client = a.request) =>
  query<PurchaseCycleDTO>(client, "purchase", `?cycleId=${id}`)
let supplier!: PartyDTO, held!: PurchaseCycleDTO, released!: PurchaseCycleDTO
async function create(tag: string) {
  const result = await command(
    a.request,
    "recordPurchase",
    envelope(
      {
        vehicle: {
          engineNumber: `STOCK-E-${suffix}-${tag}`,
          chassisNumber: `STOCK-C-${suffix}-${tag}`,
          make: "SyntheticStock",
          model: `T05b ${suffix}`,
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
const receive = (
  row: PurchaseCycleDTO,
  disposition: { kind: "RELEASE" } | { kind: "HOLD"; reason: string } = {
    kind: "RELEASE",
  }
) => envelope({ cycleId: row.id, date: "2026-10-02", disposition }, [ref(row)])
async function assign(grants: Grant[]) {
  const role = await command(
    a.request,
    "saveRole",
    envelope({
      name: `Stock-${suffix}-${randomUUID().slice(0, 6)}`,
      reason: "Synthetic stock authority",
      grants,
    }),
    201
  )
  const me = originalStaff!
  const user = await query<{ id: string; revision: number; name: string }>(
    a.request,
    "user",
    `?id=${me.user.id}`
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
        reason: "Synthetic stock authority",
      },
      [ref(user, "User"), { type: "Role", id: role.result.id, revision: 1 }]
    )
  )
}
const reads: Grant[] = [
  {
    subject: "PurchaseRecord",
    action: "read",
    fields: [
      "id",
      "revision",
      "vehicleId",
      "identity",
      "identityRevision",
      "status",
      "available",
      "receivedDate",
      "holdReason",
      "nextActions",
    ],
  },
  {
    subject: "Vehicle",
    action: "read",
    fields: [
      "id",
      "identity",
      "identityRevision",
      "cycleId",
      "revision",
      "status",
      "available",
      "holdReason",
    ],
  },
  { subject: "AuditLog", action: "read", fields: ["*"] },
]
async function restoreStaff() {
  if (!originalStaff) return
  const user = await query<{ id: string; revision: number; name: string }>(
    a.request,
    "user",
    `?id=${originalStaff.user.id}`
  )
  const roles = await Promise.all(
    originalStaff.roles.map((r) =>
      query<{ id: string; revision: number }>(a.request, "role", `?id=${r.id}`)
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
        reason: "Restore original staff roles",
      },
      [ref(user, "User"), ...roles.map((r) => ref(r, "Role"))]
    )
  )
}
try {
  await start()
  await group(
    "private production accounts, strict anonymous boundary, acquired immutable facts",
    async () => {
      await login(page, "ADMIN")
      await login(mobile, "SECOND")
      await login(limited, "STAFF")
      originalStaff = await query(staff.request, "currentActor")
      assert.equal(
        (
          await anonymous.request.post("/api/v1/commands/receiveStock", {
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
            name: `Stock supplier ${suffix}`,
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
      held = await create("held")
      released = await create("released")
      assert.equal(held.financial?.basis, "10000")
      assert.equal(held.payments[0].amount, "10000")
      assert.equal(held.listedPrice, "15000")
      assert.deepEqual(held.nextActions, ["receiveStock"])
    }
  )
  await group(
    "desktop UI physical receipt HOLD; second account persisted state, separate identity CAS",
    async () => {
      const before = await money()
      await page.goto(`/purchases/${held.id}`)
      await page
        .getByRole("button", { name: "Receive stock", exact: true })
        .click()
      await page.getByLabel("Actual received date").fill("2026-10-02")
      await page.getByLabel("Receipt disposition").selectOption("HOLD")
      await page.getByLabel("Hold reason").fill("Awaiting inspection")
      await page
        .getByRole("button", { name: "Confirm receive stock", exact: true })
        .click()
      await expect(
        page.getByRole("status").filter({ hasText: "Stock change committed" })
      ).toBeVisible()
      held = await current(held.id, b.request)
      assert.equal(held.status, "IN_STOCK")
      assert.equal(held.available, false)
      assert.equal(held.receivedDate, "2026-10-02")
      assert.equal(held.holdReason, "Awaiting inspection")
      assert.equal(held.revision, 2)
      assert.equal(held.identityRevision, 1)
      assert.equal(await money(), before)
      const v = await query<{ revision: number; identityRevision: number }>(
        a.request,
        "vehicle",
        `?id=${held.vehicleId}`
      )
      assert.equal(v.revision, 2)
      assert.equal(v.identityRevision, 1)
      const versions = (
        await db.query(
          'SELECT "entityType",revision,payload->>\'revision\' AS view_revision,sequence FROM vamotors."EntityReadVersion" WHERE "commandId"=(SELECT "commandId" FROM vamotors."StatusEvent" WHERE "cycleId"=$1 AND action=\'receiveStock\') ORDER BY "entityType"',
          [held.id]
        )
      ).rows
      assert.deepEqual(
        versions.map((v) => [v.entityType, v.revision, v.view_revision]),
        [
          ["PurchaseRecord", 2, "2"],
          ["Vehicle", 1, "2"],
        ]
      )
      assert.equal(versions[0].sequence, versions[1].sequence)
    }
  )
  await group(
    "mobile keyboard receipt RELEASE, hold and release; no-change intent rejected",
    async () => {
      const before = await money()
      await mobile.goto(`/vehicles/${released.vehicleId}`)
      await mobile
        .getByRole("button", { name: "Receive stock", exact: true })
        .click()
      await mobile.getByLabel("Actual received date").fill("2026-10-03")
      await mobile
        .getByRole("button", { name: "Confirm receive stock", exact: true })
        .focus()
      await mobile.keyboard.press("Enter")
      await expect(
        mobile.getByRole("status").filter({ hasText: "Stock change committed" })
      ).toBeVisible()
      released = await current(released.id)
      assert.equal(released.available, true)
      await mobile
        .getByRole("button", { name: "Hold stock", exact: true })
        .click()
      await mobile.getByLabel("Hold reason").fill("Mobile keyboard hold")
      await mobile
        .getByRole("button", { name: "Confirm hold stock", exact: true })
        .focus()
      await mobile.keyboard.press("Enter")
      await expect(
        mobile.getByRole("button", { name: "Release stock", exact: true })
      ).toBeVisible()
      await mobile
        .getByRole("button", { name: "Release stock", exact: true })
        .click()
      await mobile
        .getByRole("button", { name: "Confirm release stock", exact: true })
        .click()
      await expect(
        mobile.getByRole("status").filter({ hasText: "Stock change committed" })
      ).toBeVisible()
      released = await current(released.id)
      assert.equal(released.revision, 4)
      assert.equal(released.identityRevision, 1)
      assert.equal(released.holdReason, undefined)
      assert.equal(await money(), before)
      assert.equal(
        await mobile.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        ),
        true
      )
      const snap = await snapshot()
      await command(
        a.request,
        "releaseStock",
        envelope({ cycleId: released.id }, [ref(released)]),
        409
      )
      assert.equal(await snapshot(), snap)
    }
  )
  await group(
    "Gregorian chronology, strict DTOs, refs and unsupported states are zero-effect",
    async () => {
      const row = await create("validation"),
        before = await snapshot()
      const valid = receive(row)
      for (const date of [
        "0000-01-01",
        "2026-02-30",
        "9999-12-31",
        "2026-09-30",
      ])
        await command(
          a.request,
          "receiveStock",
          {
            ...valid,
            idempotencyKey: randomUUID(),
            input: { ...(valid.input as object), date },
          },
          422
        )
      for (const input of [
        {
          cycleId: row.id,
          date: "2026-10-02",
          disposition: { kind: "HOLD", reason: " " },
        },
        {
          cycleId: row.id,
          date: "2026-10-02",
          disposition: { kind: "RELEASE", reason: "extra" },
        },
        {
          cycleId: row.id,
          date: "2026-10-02",
          disposition: { kind: "RELEASE" },
          override: true,
        },
      ])
        await command(
          a.request,
          "receiveStock",
          envelope(input, [ref(row)]),
          422
        )
      await command(a.request, "receiveStock", { ...valid, expected: [] }, 428)
      await command(
        a.request,
        "receiveStock",
        { ...valid, expected: [ref(row), ref(row)] },
        422
      )
      await command(
        a.request,
        "receiveStock",
        { ...valid, expected: [{ ...ref(row), id: held.id }] },
        428
      )
      await command(
        a.request,
        "receiveStock",
        { ...valid, expected: [{ ...ref(row), revision: 2 }] },
        409
      )
      await command(
        a.request,
        "releaseStock",
        envelope({ cycleId: row.id }, [ref(row)]),
        409
      )
      await command(a.request, "receiveStock", receive(released), 409)
      for (const name of [
        "sendRepair",
        "placeReservation",
        "startFinance",
        "editPurchase",
        "addCost",
        "setListedPrice",
        "intakeTradeIn",
      ])
        await command(
          a.request,
          name,
          envelope({ cycleId: row.id }, [ref(row)]),
          404
        )
      assert.equal(await snapshot(), before)
    }
  )
  await group(
    "same-key receive race replays once; different-key receive and hold/release races have one winner",
    async () => {
      const row = await create("same-race"),
        before = await money(),
        body = receive(row)
      const pair = await Promise.all([
        command(a.request, "receiveStock", body),
        command(a.request, "receiveStock", body),
      ])
      assert.equal(pair[0].commandId, pair[1].commandId)
      assert.equal(pair.filter((r) => r.replayed).length, 1)
      const other = await create("different-race")
      const responses = await Promise.all([
        a.request.post("/api/v1/commands/receiveStock", {
          data: receive(other),
          headers: { Origin: origin },
        }),
        b.request.post("/api/v1/commands/receiveStock", {
          data: receive(other),
          headers: { Origin: origin },
        }),
      ])
      assert.deepEqual(responses.map((r) => r.status()).sort(), [200, 409])
      const race = await current(held.id)
      const contested = await Promise.all([
        a.request.post("/api/v1/commands/holdStock", {
          data: envelope({ cycleId: race.id, reason: "Concurrent hold" }, [
            ref(race),
          ]),
          headers: { Origin: origin },
        }),
        b.request.post("/api/v1/commands/releaseStock", {
          data: envelope({ cycleId: race.id }, [ref(race)]),
          headers: { Origin: origin },
        }),
      ])
      assert.deepEqual(contested.map((r) => r.status()).sort(), [200, 409])
      assert.equal((await current(race.id)).revision, race.revision + 1)
      assert.equal(
        (
          await db.query(
            'SELECT count(*) FROM vamotors."StatusEvent" WHERE "commandId"=$1',
            [pair[0].commandId]
          )
        ).rows[0].count,
        "1"
      )
      // Only the intervening acquisition appends money, never a stock command.
      const after = JSON.parse(await money()),
        old = JSON.parse(before)
      for (const table of [
        "PurchasePayment",
        "MileageReading",
        "CycleBasisVersion",
      ])
        assert.equal(after[table].length, old[table].length + 1)
    }
  )
  await group(
    "lost committed UI response retains immutable envelope through refetch and transient auth; current-authority replay",
    async () => {
      const row = await create("loss"),
        bodies: string[] = []
      await page.goto(`/purchases/${row.id}`)
      await page
        .getByRole("button", { name: "Receive stock", exact: true })
        .click()
      await page.getByLabel("Actual received date").fill("2026-10-02")
      let committed!: Applied
      await page.route("**/api/v1/commands/receiveStock", async (route) => {
        bodies.push(route.request().postData()!)
        if (bodies.length === 1) {
          const response = await route.fetch()
          committed = await response.json()
          await route.abort("failed")
        } else await route.continue()
      })
      await page
        .getByRole("button", { name: "Confirm receive stock", exact: true })
        .click()
      await expect(
        page.getByRole("button", { name: "Retry unchanged stock intent" }),
        "after lost response"
      ).toBeVisible()
      const now = await current(row.id)
      console.log("PASS lost response leaves retry control", bodies.length)
      await command(
        b.request,
        "holdStock",
        envelope(
          { cycleId: row.id, reason: "Another account after response loss" },
          [ref(now)]
        )
      )
      // A refetch must not replace the captured revision or unmount the pending form.
      await page.evaluate(() => window.dispatchEvent(new Event("focus")))
      await expect(
        page.getByRole("button", { name: "Retry unchanged stock intent" })
      ).toBeVisible()
      console.log("PASS pending envelope survives first focus/refetch")
      await page.route("**/api/v1/queries/currentActor", (route) =>
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
      await page.unroute("**/api/v1/queries/currentActor")
      await page.evaluate(() => window.dispatchEvent(new Event("focus")))
      await expect(
        page.getByRole("button", { name: "Retry unchanged stock intent" }),
        "after transient auth recovery"
      ).toBeVisible()
      await expect(page.getByLabel("Actual received date")).toHaveValue(
        "2026-10-02"
      )
      const before = await snapshot()
      await page
        .getByRole("button", { name: "Retry unchanged stock intent" })
        .click()
      await expect(
        page.getByRole("status").filter({ hasText: "Stock change committed" })
      ).toBeVisible()
      assert.equal(bodies.length, 2)
      assert.equal(bodies[0], bodies[1])
      assert.equal(await snapshot(), before)
      const replay = await command(
        a.request,
        "receiveStock",
        JSON.parse(bodies[0])
      )
      assert.equal(replay.commandId, committed.commandId)
      assert.equal(replay.result.revision, 2)
      assert.equal(replay.affected[0].revision, 3)
      await command(
        a.request,
        "receiveStock",
        {
          ...JSON.parse(bodies[0]),
          input: { ...JSON.parse(bodies[0]).input, date: "2026-10-03" },
        },
        409
      )
      await page.unroute("**/api/v1/commands/receiveStock")
    }
  )
  await group(
    "stale UI explicitly reloads/reconfirms draft; read failure retains old envelope",
    async () => {
      let row = await current(released.id)
      await page.goto(`/purchases/${row.id}`)
      await page
        .getByRole("button", { name: "Hold stock", exact: true })
        .click()
      await page.getByLabel("Hold reason").fill("Retained stale reason")
      await command(
        b.request,
        "holdStock",
        envelope({ cycleId: row.id, reason: "Intervening hold" }, [ref(row)])
      )
      const bodies: string[] = []
      await page.route("**/api/v1/commands/holdStock", async (route) => {
        bodies.push(route.request().postData()!)
        await route.continue()
      })
      await page
        .getByRole("button", { name: "Confirm hold stock", exact: true })
        .click()
      await expect(
        page.getByRole("status").filter({ hasText: "STALE_REVISION" })
      ).toBeVisible()
      await page.route("**/api/v1/queries/purchase?**", (route) =>
        route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            ok: false,
            error: { code: "RETRYABLE_TRANSACTION", retryable: true },
          }),
        })
      )
      await page
        .getByRole("button", { name: "Reload current stock", exact: true })
        .click()
      await expect(
        page.getByRole("status").filter({ hasText: "Current read failed" })
      ).toBeVisible()
      await expect(page.getByLabel("Hold reason")).toHaveValue(
        "Retained stale reason"
      )
      await page.unroute("**/api/v1/queries/purchase?**")
      await page
        .getByRole("button", { name: "Reload current stock", exact: true })
        .click()
      await page
        .getByRole("button", {
          name: "Reconfirm retained draft as new stock intent",
        })
        .click()
      await page
        .getByRole("button", { name: "Confirm hold stock", exact: true })
        .click()
      await expect(
        page.getByRole("status").filter({ hasText: "Stock change committed" })
      ).toBeVisible()
      assert.equal(bodies.length, 2)
      assert.deepEqual(JSON.parse(bodies[0]).input, JSON.parse(bodies[1]).input)
      assert.notEqual(
        JSON.parse(bodies[0]).idempotencyKey,
        JSON.parse(bodies[1]).idempotencyKey
      )
      row = await current(row.id)
      assert.equal(JSON.parse(bodies[1]).expected[0].revision, row.revision - 1)
      await page.unroute("**/api/v1/commands/holdStock")
    }
  )
  await group(
    "fault every root/history/audit/receipt/version/sequence/final-graph write, exact-key recovery",
    async () => {
      const row = await create("faults")
      for (const [table, timing, predicate] of [
        ["PurchaseRecord", "BEFORE UPDATE", "true"],
        ["StatusEvent", "BEFORE INSERT", "true"],
        ["AuditEntry", "BEFORE INSERT", `NEW."entityType"='PurchaseRecord'`],
        ["AuditEntry", "BEFORE INSERT", `NEW."entityType"='Vehicle'`],
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
        let target = await current(row.id)
        const name =
          target.status === "PURCHASED"
            ? "receiveStock"
            : target.available
              ? "holdStock"
              : "releaseStock"
        const body =
          name === "receiveStock"
            ? receive(target)
            : envelope(
                {
                  cycleId: target.id,
                  ...(name === "holdStock"
                    ? { reason: "Fault recovery hold" }
                    : {}),
                },
                [ref(target)]
              )
        const before = await snapshot()
        try {
          await db.query(
            `CREATE FUNCTION vamotors.stock_test_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${predicate} THEN RAISE EXCEPTION 'SYNTHETIC_STOCK_FAULT'; END IF; RETURN NEW; END $$`
          )
          await db.query(
            timing === "AFTER UPDATE"
              ? `CREATE CONSTRAINT TRIGGER stock_test_fault AFTER UPDATE ON vamotors."${table}" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vamotors.stock_test_fault()`
              : `CREATE TRIGGER stock_test_fault ${timing} ON vamotors."${table}" FOR EACH ROW EXECUTE FUNCTION vamotors.stock_test_fault()`
          )
          await command(a.request, name, body, 500)
          assert.equal(await snapshot(), before)
        } finally {
          await db.query(
            `DROP TRIGGER IF EXISTS stock_test_fault ON vamotors."${table}"`
          )
          await db.query("DROP FUNCTION IF EXISTS vamotors.stock_test_fault()")
        }
        const cash = await money()
        await command(a.request, name, body)
        assert.equal(await money(), cash)
        target = await current(row.id)
        assert.ok(target.revision > 1)
      }
    }
  )
  await group(
    "runtime minimum column ACLs and owner final-graph/provenance/chronology/history backstops",
    async () => {
      const before = await snapshot(),
        row = await current(released.id)
      for (const sql of [
        `UPDATE vamotors."PurchaseRecord" SET "createdBy"="createdBy" WHERE id='${row.id}'`,
        `UPDATE vamotors."PurchaseRecord" SET "purchasePrice"=1 WHERE id='${row.id}'`,
        `UPDATE vamotors."Vehicle" SET revision=revision+1 WHERE id='${row.vehicleId}'`,
        `UPDATE vamotors."PurchaseRecord" SET available=true, "holdReason"=NULL, revision=revision+1 WHERE id='${row.id}'`,
        `DELETE FROM vamotors."PurchaseRecord" WHERE id='${row.id}'`,
        `UPDATE vamotors."PurchasePayment" SET amount=1 WHERE "cycleId"='${row.id}'`,
        `ALTER TABLE vamotors."PurchaseRecord" ADD COLUMN forbidden text`,
      ])
        await assert.rejects(restricted.query(sql))
      for (const sql of [
        `UPDATE vamotors."PurchaseRecord" SET "receivedDate"='2026-09-01',revision=revision+1 WHERE id='${row.id}'`,
        `UPDATE vamotors."PurchaseRecord" SET status='SOLD',revision=revision+1 WHERE id='${row.id}'`,
        `UPDATE vamotors."PurchaseRecord" SET "purchasePrice"=1,revision=revision+1 WHERE id='${row.id}'`,
        `UPDATE vamotors."PurchaseRecord" SET available=true,"holdReason"=NULL,revision=revision+1 WHERE id='${row.id}'`,
        `UPDATE vamotors."StatusEvent" SET action='receiveStock' WHERE "cycleId"='${row.id}'`,
        `UPDATE vamotors."PurchasePayment" SET amount=1 WHERE "cycleId"='${row.id}'`,
      ])
        await assert.rejects(db.query(sql))
      assert.equal(await snapshot(), before)
    }
  )
  await group(
    "field/action/record grants, redacted queries/audits/RSC and consumed predicate leaves",
    async () => {
      const row = await create("authority"),
        before = await money()
      for (const grant of [
        undefined,
        {
          subject: "PurchaseRecord",
          action: "receive",
          fields: ["date"],
        } as Grant,
        {
          subject: "PurchaseRecord",
          action: "receive",
          fields: ["*"],
          conditions: { createdBy: "$actor.id" },
        } as Grant,
      ]) {
        await assign([...reads, ...(grant ? [grant] : [])])
        const snap = await snapshot()
        await command(staff.request, "receiveStock", receive(row), 403)
        assert.equal(await snapshot(), snap)
      }
      await assign([
        ...reads,
        {
          subject: "PurchaseRecord",
          action: "receive",
          fields: ["date", "disposition.kind"],
        },
      ])
      await command(
        staff.request,
        "receiveStock",
        receive(row, { kind: "HOLD", reason: "Unauthorized reason" }),
        403
      )
      const intent = receive(row)
      await command(staff.request, "receiveStock", intent)
      const visible = await query<Record<string, unknown>>(
        staff.request,
        "purchase",
        `?cycleId=${row.id}`
      )
      for (const f of [
        "purchasePrice",
        "payments",
        "financial",
        "basisVersions",
        "outstanding",
        "listedPrice",
      ])
        assert.equal(f in visible, false)
      const audit = await query(
        staff.request,
        "audit",
        `?type=PurchaseRecord&id=${row.id}`
      )
      assert.ok(!JSON.stringify(audit).includes('"10000"'))
      const rsc = await staff.request.get(`/purchases/${row.id}`, {
        headers: { RSC: "1" },
      })
      assert.equal(rsc.status(), 200)
      assert.ok(!(await rsc.text()).includes('"10000"'))
      await assign(reads)
      const snap = await snapshot()
      await command(staff.request, "receiveStock", intent, 403)
      assert.equal(await snapshot(), snap)
      // Full leaf grants, no compound identity, must support both source roots.
      const identity = ["make", "model", "engineNumber", "chassisNumber"].map(
        (f) => `identity.${f}`
      )
      const leafReads: Grant[] = ["PurchaseRecord", "Vehicle"].map(
        (subject) => ({
          subject: subject as "Vehicle" | "PurchaseRecord",
          action: "read",
          fields: ["id", ...identity],
        })
      )
      await assign(leafReads)
      for (const name of ["inventory", "purchases"])
        for (const params of [
          `?q=${suffix}`,
          ...(name === "inventory"
            ? [
                "?make=SyntheticStock",
                `?model=${encodeURIComponent(`T05b ${suffix}`)}`,
              ]
            : []),
        ])
          assert.ok(
            (await query<{ total: number }>(staff.request, name, params))
              .total > 0
          )
      for (const subject of ["Vehicle", "PurchaseRecord"] as const)
        for (const missing of identity) {
          await assign(
            leafReads.map((g) =>
              g.subject === subject
                ? { ...g, fields: g.fields.filter((f) => f !== missing) }
                : g
            )
          )
          const r = await staff.request.get(
            `/api/v1/queries/purchases?q=definitely-no-match&page=2`
          )
          assert.equal(r.status(), 403)
          const value = await r.json()
          assert.equal(value.data, undefined)
          assert.equal(value.total, undefined)
        }
      await assign([
        ...leafReads,
        {
          subject: "PurchaseRecord",
          action: "read",
          fields: ["purchasePrice"],
          conditions: { createdBy: "$actor.id" },
        },
      ])
      assert.equal(
        (
          await staff.request.get(
            '/api/v1/queries/purchases?sort=[{"field":"purchasePrice","direction":"asc"}]'
          )
        ).status(),
        403
      )
      assert.equal(await money(), before)
      await restoreStaff()
    }
  )
  await group(
    "observed execution/replay lock waits honor committed permission removal and inactive actor",
    async () => {
      const row = await create("revocation"),
        me = originalStaff!
      const grants: Grant[] = [
        ...reads,
        { subject: "PurchaseRecord", action: "receive", fields: ["*"] },
      ]
      const replay = receive(row)
      await assign(grants)
      await command(staff.request, "receiveStock", replay)
      for (const mode of ["execution", "replay", "inactive"] as const) {
        await assign(grants)
        const fresh =
          mode === "replay" ? undefined : await create(`wait-${mode}`)
        const body = fresh ? receive(fresh) : replay
        const blocker = await db.connect()
        try {
          await blocker.query("BEGIN")
          await blocker.query(
            'SELECT value FROM vamotors."BusinessSequence" WHERE id=1 FOR UPDATE'
          )
          const request = staff.request.post("/api/v1/commands/receiveStock", {
            data: body,
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
          if (mode === "inactive") {
            const user = await query<{
              id: string
              name: string
              revision: number
              roles: { id: string; revision: number }[]
            }>(a.request, "user", `?id=${me.user.id}`)
            await command(
              a.request,
              "updateUser",
              envelope(
                {
                  id: user.id,
                  name: user.name,
                  active: false,
                  roleIds: user.roles.map((r) => r.id),
                  reason: "Synthetic wait revocation",
                },
                [ref(user, "User"), ...user.roles.map((r) => ref(r, "Role"))]
              )
            )
          } else await assign(reads)
          await blocker.query("COMMIT")
          assert.equal((await request).status(), 403)
        } finally {
          await blocker.query("ROLLBACK")
          blocker.release()
          await restoreStaff()
        }
      }
    }
  )
  await group(
    "archived supplier cannot strand receipt; persisted filters and exact source history",
    async () => {
      const row = await create("archived"),
        before = await money()
      await command(
        a.request,
        "archiveParty",
        envelope(
          {
            type: "SUPPLIER",
            id: supplier.id,
            active: false,
            reason: "Synthetic historical supplier",
          },
          [ref(supplier, "Supplier")]
        )
      )
      await command(a.request, "receiveStock", receive(row))
      const list = await query<{ data: PurchaseCycleDTO[]; total: number }>(
        b.request,
        "purchases",
        `?statuses=["IN_STOCK"]&supplierId=${supplier.id}`
      )
      assert.ok(list.data.some((r) => r.id === row.id))
      const inventory = await query<{ total: number }>(
        b.request,
        "inventory",
        `?available=true&make=SyntheticStock&model=${encodeURIComponent(`T05b ${suffix}`)}`
      )
      assert.ok(inventory.total > 0)
      assert.equal(await money(), before)
      const history = (
        await db.query(
          'SELECT action,"from","to" FROM vamotors."StatusEvent" WHERE "cycleId"=$1 ORDER BY "recordedAt",id',
          [row.id]
        )
      ).rows
      assert.deepEqual(
        history.map((r) => [r.action, r.from, r.to]),
        [
          ["recordPurchase", null, "PURCHASED"],
          ["receiveStock", "PURCHASED", "IN_STOCK"],
        ]
      )
      const retained = (
        await db.query(
          'SELECT p.id FROM vamotors."PurchaseRecord" p JOIN vamotors."Supplier" s ON s.id=p."supplierId" WHERE p."acquisitionCommandId" IS NOT NULL AND p.status=\'PURCHASED\' AND NOT s.active ORDER BY p.id LIMIT 1'
        )
      ).rows[0]
      if (retained) {
        const original = await current(retained.id)
        await command(a.request, "receiveStock", receive(original))
        assert.equal(
          (await current(retained.id)).revision,
          original.revision + 1
        )
        assert.equal(await money(), before)
      }
    }
  )
  await group(
    "account revocation purges private stock draft; no browser persistence",
    async () => {
      await assign([
        ...reads,
        { subject: "PurchaseRecord", action: "update", fields: ["reason"] },
      ])
      await limited.goto(`/purchases/${released.id}`)
      await limited
        .getByRole("button", { name: "Hold stock", exact: true })
        .click()
      await limited
        .getByLabel("Hold reason")
        .fill("Private stock draft must disappear")
      await assign(reads)
      await limited.evaluate(() =>
        window.dispatchEvent(new Event("auth-check"))
      )
      await expect(
        limited.getByText("Private stock draft must disappear")
      ).toHaveCount(0)
      await expect(limited.getByLabel("Hold reason")).toHaveCount(0)
      assert.equal(
        await limited.evaluate(() =>
          JSON.stringify({ ...localStorage, ...sessionStorage }).includes(
            "Private stock draft"
          )
        ),
        false
      )
      await restoreStaff()
    }
  )
  await group(
    "production app and isolated PostgreSQL restart retain exact stock, source facts and sessions",
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
        max: 2,
      })
      monitor = new pg.Pool({ connectionString: monitorURL.href, max: 1 })
      await start()
      assert.equal(await snapshot(), before)
      for (const id of cycles)
        assert.equal((await current(id, b.request)).id, id)
      await mobile.goto(`/purchases/${held.id}`)
      await expect(
        mobile.getByRole("heading", { name: "Purchase detail" })
      ).toBeVisible()
    }
  )
  const evidence = {
    head: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    dirty: !!execFileSync("git", ["status", "--porcelain"], {
      encoding: "utf8",
    }).trim(),
    origin,
    groups: results,
    cycles,
    migrations: (
      await db.query(
        "SELECT migration_name,checksum FROM vamotors._prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name"
      )
    ).rows,
    grants: (
      await db.query(
        "SELECT table_name,column_name,privilege_type FROM information_schema.column_privileges WHERE grantee='vamotors_runtime' ORDER BY table_name,column_name,privilege_type"
      )
    ).rows,
  }
  await writeFile(
    join(root, `stock-receipt-${suffix}.json`),
    JSON.stringify(evidence, null, 2),
    { mode: 0o600 }
  )
  console.log(
    `PASS ${results.length} stock groups; evidence stock-receipt-${suffix}.json`
  )
} catch (error) {
  await writeFile(
    join(root, `stock-failure-${suffix}.txt`),
    await page.locator("body").innerText(),
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
