/** Production HTTP + real Chromium + isolated PostgreSQL; retained synthetic rows. */
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
import { registry } from "../../lib/server/permissions"
import type {
  Applied,
  Dependency,
  PurchaseInput,
  PurchaseCycleDTO,
  PartyDTO,
  Grant,
  QueryData,
} from "../../.planning/implementation/contracts/api"

process.umask(0o077)
const root = process.argv[2]
assert.ok(root)
const runtime = await privateEnvironment(join(root, "runtime.env")),
  migration = await privateEnvironment(join(root, "migration.env")),
  accounts = await privateEnvironment(join(root, "accounts.env")),
  cluster = await privateEnvironment(join(root, "cluster.env")),
  admin = await privateEnvironment(join(root, "admin.env"))
assert.equal(cluster.PROJECT, process.cwd())
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
  second = await b.newPage(),
  limited = await staff.newPage()
const suffix = randomUUID().slice(0, 8),
  results: string[] = []
let stage = "initialize"
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
function envelope<T>(
  input: T,
  expected: Dependency[] = [],
  key = randomUUID()
) {
  return { schemaVersion: 1, idempotencyKey: key, expected, input }
}
async function command(
  client: APIRequestContext,
  name: string,
  body: unknown,
  status = 200
) {
  const r = await client.post(`/api/v1/commands/${name}`, {
    data: body,
    headers: { Origin: origin },
  })
  const value = await r.json()
  assert.equal(r.status(), status, `${name}_${JSON.stringify(value)}`)
  assert.match(r.headers()["cache-control"], /no-store/)
  return value
}
const ref = (
  type: Dependency["type"],
  p: { id: string; revision: number }
): Dependency => ({ type, id: p.id, revision: p.revision })
const vehicle = (tag: string) => ({
  engineNumber: `E-${suffix}-${tag}`,
  chassisNumber: `C-${suffix}-${tag}`,
  make: "Synthetic",
  model: `T05a ${suffix}`,
  year: 2026,
  colour: "Blue",
  fuelType: "PETROL" as const,
  transmission: "AUTOMATIC" as const,
})
let individual!: PartyDTO,
  company!: PartyDTO,
  cash!: PurchaseCycleDTO,
  brand!: PurchaseCycleDTO
const purchase = (
  tag: string,
  supplier = individual,
  type: "CASH" | "BRAND_NEW" = "CASH",
  price = "10000"
): PurchaseInput => ({
  vehicle: vehicle(tag),
  supplierId: supplier.id,
  purchaseType: type,
  purchasePrice: price,
  listedPrice: "15000",
  purchaseDate: "2026-10-01",
  mileage: { reading: 0, date: "2026-10-01" },
  paymentMethod: "BANK_TRANSFER",
})
const snapshot = async () => {
  const result: Record<string, unknown> = {}
  for (const table of [
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
    "SettingsVersion",
    "FinancePolicyVersion",
    "SupplierContact",
    "FinanceContact",
  ])
    result[table] = (
      await db.query(
        `SELECT to_jsonb(t) AS row FROM vamotors."${table}" t ORDER BY id`
      )
    ).rows
  return JSON.stringify(result)
}
async function create(
  tag: string,
  supplier = individual,
  type: "CASH" | "BRAND_NEW" = "CASH",
  price = "10000"
) {
  const body = envelope(purchase(tag, supplier, type, price), [
    ref("Supplier", supplier),
  ])
  const result = (await command(
    a.request,
    "recordPurchase",
    body,
    201
  )) as Applied
  return {
    body,
    result,
    row: await query<PurchaseCycleDTO>(
      a.request,
      "purchase",
      `?cycleId=${result.result.id}`
    ),
  }
}
try {
  await start()
  await group(
    "real independent logins, anonymous denial and active persisted selectors",
    async () => {
      await login(page, "ADMIN")
      await login(second, "SECOND")
      await login(limited, "STAFF")
      assert.equal(
        (await anonymous.request.get("/api/v1/queries/purchases")).status(),
        401
      )
      for (const category of ["INDIVIDUAL", "COMPANY"] as const) {
        const result = await command(
          a.request,
          "createDirectoryParty",
          envelope({
            type: "SUPPLIER",
            values: {
              name: `T05a ${category} ${suffix}`,
              category,
              phone: "0112345678",
              contacts: [],
            },
          }),
          201
        )
        const row = await query<PartyDTO>(
          a.request,
          "party",
          `?type=SUPPLIER&id=${result.result.id}`
        )
        if (category === "INDIVIDUAL") individual = row
        else company = row
      }
      const list = await query<{ data: PartyDTO[] }>(
        a.request,
        "parties",
        `?type=SUPPLIER&active=true&q=${suffix}`
      )
      assert.ok(list.data.some((p) => p.id === individual.id))
      assert.ok(list.data.some((p) => p.id === company.id))
    }
  )
  await group(
    "production UI cash, zero mileage, omitted VIN/CR, actual source payment and basis",
    async () => {
      await page.goto("/purchases")
      await page.getByRole("button", { name: "New paid acquisition" }).click()
      await page.getByLabel("Search active suppliers by name").fill(suffix)
      await expect(
        page.locator("#supplier option", { hasText: "INDIVIDUAL" })
      ).toHaveCount(1)
      await page.locator("#supplier").selectOption(individual.id)
      const values = {
        engineNumber: `E-${suffix}-ui`,
        chassisNumber: `C-${suffix}-ui`,
        make: "Synthetic",
        model: `T05a ${suffix}`,
        year: "2026",
        colour: "Blue",
        purchaseDate: "2026-10-01",
        purchasePrice: "100.00",
        listedPrice: "150.00",
        mileageDate: "2026-10-01",
      }
      for (const [key, value] of Object.entries(values))
        await page.locator(`#acquisition-${key}`).fill(value)
      await page
        .locator("#acquisition-paymentMethod")
        .selectOption("BANK_TRANSFER")
      await page
        .getByRole("button", { name: "Record fully paid acquisition" })
        .click()
      await page.waitForURL(/\/purchases\/[0-9a-f-]+$/)
      cash = await query(
        a.request,
        "purchase",
        `?cycleId=${page.url().split("/").at(-1)}`
      )
      assert.equal(cash.mileage[0].reading, 0)
      assert.equal(cash.identity.vin, undefined)
      assert.equal(cash.identity.crNumber, undefined)
      assert.equal(cash.status, "PURCHASED")
      assert.equal(cash.available, false)
      assert.equal(cash.purchasePrice, "10000")
      assert.equal(cash.listedPrice, "15000")
      assert.equal(cash.financial?.basis, "10000")
      assert.equal(cash.financial?.cashOut, "10000")
      assert.deepEqual(cash.outstanding, { seller: "0", settlement: "0" })
      assert.equal(cash.payments.length, 1)
      assert.equal(cash.payments[0].direction, "OUT")
      assert.equal(cash.payments[0].date, "2026-10-01")
      assert.equal(cash.payments[0].owner.id, cash.id)
      assert.ok(cash.payments[0].commandId)
      assert.equal(cash.basisVersions.length, 1)
      assert.equal(cash.costs.length, 0)
      assert.equal(cash.sales.length, 0)
      assert.equal(cash.repairs.length, 0)
      assert.equal(cash.disposal, null)
      const secondRead = await query<PurchaseCycleDTO>(
        b.request,
        "purchase",
        `?cycleId=${cash.id}`
      )
      assert.deepEqual(secondRead, cash)
      await second.goto(`/vehicles/${cash.vehicleId}`)
      await expect(
        second.getByRole("heading", { name: "Physical vehicle", exact: true })
      ).toBeVisible()
      await expect(
        second.getByText("Purchase cycle 1", { exact: true })
      ).toBeVisible()
      assert.equal(
        await second.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        ),
        true
      )
    }
  )
  await group(
    "company brand-new, maximum bounds and >32-bit exact arithmetic",
    async () => {
      brand = (await create("brand", company, "BRAND_NEW", "99999999999999"))
        .row
      assert.equal(brand.purchasePrice, "99999999999999")
      assert.equal(brand.payments[0].amount, brand.purchasePrice)
      assert.equal(brand.financial?.basis, brand.purchasePrice)
      const large = (await create("large", individual, "CASH", "2147483648"))
        .row
      assert.equal(large.financial?.cashOut, "2147483648")
      assert.equal(
        (await query<{ total: number }>(a.request, "inventory", `?q=${suffix}`))
          .total,
        3
      )
      const link = await query<{
        contributions: { purchases: { links: { id: string }[] } }
      }>(b.request, "party", `?type=SUPPLIER&id=${individual.id}`)
      assert.ok(
        link.contributions.purchases.links.some((l) => l.id === cash.id)
      )
    }
  )
  await group(
    "strict validation, eligibility, references and disabled unsupported commands leave no effects",
    async () => {
      const before = await snapshot()
      const input = purchase("invalid")
      const invalid: unknown[] = [
        { ...input, purchasePrice: "0" },
        { ...input, purchasePrice: "01" },
        { ...input, purchasePrice: "1.0" },
        { ...input, purchaseDate: "2026-02-30" },
        { ...input, purchaseDate: "2099-01-01" },
        { ...input, vehicle: { ...input.vehicle, engineNumber: "" } },
        { ...input, vehicle: { ...input.vehicle, transmission: "BOGUS" } },
        { ...input, mileage: { ...input.mileage, reading: -1 } },
        { ...input, purchaseType: "LEASE_SETTLEMENT" },
        { ...input, available: true },
      ]
      for (const value of invalid)
        await command(
          a.request,
          "recordPurchase",
          envelope(value, [ref("Supplier", individual)]),
          422
        )
      await command(
        a.request,
        "recordPurchase",
        envelope({ ...input, purchasePrice: "100000000000000" }, [
          ref("Supplier", individual),
        ]),
        422
      )
      await command(
        a.request,
        "recordPurchase",
        envelope(purchase("wrong-brand", individual, "BRAND_NEW"), [
          ref("Supplier", individual),
        ]),
        409
      )
      await command(a.request, "recordPurchase", envelope(input), 428)
      await command(
        a.request,
        "recordPurchase",
        envelope(input, [ref("Supplier", company)]),
        428
      )
      await command(
        a.request,
        "recordPurchase",
        envelope(input, [
          ref("Supplier", individual),
          ref("Supplier", individual),
        ]),
        422
      )
      await command(
        a.request,
        "recordPurchase",
        envelope(input, [
          { ...ref("Supplier", individual), revision: 2147483647 },
        ]),
        409
      )
      for (const name of [
        "payPurchase",
        "receiveStock",
        "intakeTradeIn",
        "editPurchase",
      ])
        await command(a.request, name, envelope({ cycleId: cash.id }), 404)
      assert.equal(await snapshot(), before)
    }
  )
  await group(
    "concurrent identity and idempotency winners, replay and changed-payload mismatch",
    async () => {
      const body = envelope(purchase("race"), [ref("Supplier", individual)])
      const responses = await Promise.all([
        a.request.post("/api/v1/commands/recordPurchase", {
          data: body,
          headers: { Origin: origin },
        }),
        a.request.post("/api/v1/commands/recordPurchase", {
          data: body,
          headers: { Origin: origin },
        }),
      ])
      const values = await Promise.all(responses.map((r) => r.json()))
      assert.equal(values[0].result.id, values[1].result.id)
      assert.equal(values.filter((v) => v.replayed).length, 1)
      const before = await snapshot()
      await command(
        a.request,
        "recordPurchase",
        { ...body, input: { ...body.input, purchasePrice: "10001" } },
        409
      )
      assert.equal(await snapshot(), before)
      const input = purchase("identity-race")
      const race = await Promise.all([
        a.request.post("/api/v1/commands/recordPurchase", {
          data: envelope(input, [ref("Supplier", individual)]),
          headers: { Origin: origin },
        }),
        b.request.post("/api/v1/commands/recordPurchase", {
          data: envelope(input, [ref("Supplier", individual)]),
          headers: { Origin: origin },
        }),
      ])
      assert.deepEqual(race.map((r) => r.status()).sort(), [201, 428])
      const identity = await query<{ id: string; revision: number }>(
        a.request,
        "vehicleIdentity",
        `?engineNumber=${input.vehicle.engineNumber}&chassisNumber=${input.vehicle.chassisNumber}`
      )
      await command(
        a.request,
        "recordPurchase",
        envelope(input, [
          ref("Supplier", individual),
          ref("Vehicle", identity),
        ]),
        409
      )
      const count = await db.query(
        'SELECT count(*) FROM vamotors."PurchasePayment" WHERE "cycleId"=$1',
        [values[0].result.id]
      )
      assert.equal(count.rows[0].count, "1")
    }
  )
  await group(
    "essential graph faults rollback entire rowsets and sequence; original-key retry commits once",
    async () => {
      for (const table of [
        "Vehicle",
        "PurchaseRecord",
        "PurchasePayment",
        "MileageReading",
        "CycleBasisVersion",
        "StatusEvent",
        "AuditEntry",
        "CommandReceipt",
        "EntityReadVersion",
      ]) {
        const body = envelope(purchase(`fault-${table}`), [
            ref("Supplier", individual),
          ]),
          before = await snapshot()
        await db.query(
          `ALTER TABLE vamotors."${table}" ADD CONSTRAINT t05a_fault CHECK(false) NOT VALID`
        )
        try {
          await command(a.request, "recordPurchase", body, 500)
          assert.equal(await snapshot(), before)
        } finally {
          await db.query(
            `ALTER TABLE vamotors."${table}" DROP CONSTRAINT t05a_fault`
          )
        }
        const result = await command(a.request, "recordPurchase", body, 201)
        const replay = await command(a.request, "recordPurchase", body)
        assert.equal(result.commandId, replay.commandId)
        assert.equal(replay.replayed, true)
      }
      const body = envelope(purchase("deferred-fault"), [
          ref("Supplier", individual),
        ]),
        before = await snapshot()
      await db.query(
        `CREATE FUNCTION vamotors.t05a_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'TEST_FINAL_FAULT'; END $$`
      )
      await db.query(
        'CREATE CONSTRAINT TRIGGER t05a_fault AFTER INSERT ON vamotors."PurchaseRecord" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vamotors.t05a_fault()'
      )
      try {
        await command(a.request, "recordPurchase", body, 500)
        assert.equal(await snapshot(), before)
      } finally {
        await db.query('DROP TRIGGER t05a_fault ON vamotors."PurchaseRecord"')
        await db.query("DROP FUNCTION vamotors.t05a_fault()")
      }
      await command(a.request, "recordPurchase", body, 201)
    }
  )
  await group(
    "runtime direct DML, malformed source ownership, history, DDL and DELETE rejected",
    async () => {
      for (const sql of [
        'DELETE FROM vamotors."PurchaseRecord"',
        'UPDATE vamotors."PurchasePayment" SET amount=1',
        'UPDATE vamotors."MileageReading" SET reading=1',
        'UPDATE vamotors."CycleBasisVersion" SET total=1',
        'UPDATE vamotors."PurchaseRecord" SET "createdBy"=gen_random_uuid()',
        'UPDATE vamotors."Vehicle" SET "activePurchaseId"=NULL',
        "CREATE TABLE vamotors.t05a_denied(id integer)",
        `INSERT INTO vamotors."PurchasePayment"(id,"cycleId",amount,direction,category,"occurredDate",method,currency,scale,"commandId","lineKey") SELECT gen_random_uuid(),id,1,'OUT','SELLER',"purchaseDate",'CASH','LKR',2,"acquisitionCommandId",'extra' FROM vamotors."PurchaseRecord" WHERE id='${cash.id}'`,
        `INSERT INTO vamotors."MileageReading"(id,"cycleId","vehicleId",reading,"recordedDate","commandId") SELECT gen_random_uuid(),id,'${brand.vehicleId}',0,"purchaseDate","acquisitionCommandId" FROM vamotors."PurchaseRecord" WHERE id='${cash.id}'`,
        `INSERT INTO vamotors."StatusEvent"(id,"cycleId","to",action,"commandId","userId","occurredAt") SELECT gen_random_uuid(),id,'SOLD','fake',"acquisitionCommandId","createdBy","purchaseDate" FROM vamotors."PurchaseRecord" WHERE id='${cash.id}'`,
      ])
        await assert.rejects(restricted.query(sql))
      await assert.rejects(
        db.query(
          'UPDATE vamotors."PurchasePayment" SET amount=1 WHERE "cycleId"=$1',
          [cash.id]
        )
      )
      await assert.rejects(
        db.query('UPDATE vamotors."Vehicle" SET "createdBy"=$1 WHERE id=$2', [
          "03000000-0000-4000-8000-000000000012",
          cash.vehicleId,
        ])
      )
    }
  )
  await group(
    "actual dropped committed response retries identical body after supplier change",
    async () => {
      await page.goto("/purchases")
      await page.getByRole("button", { name: "New paid acquisition" }).click()
      await page.getByLabel("Search active suppliers by name").fill(suffix)
      await expect(
        page.locator("#supplier option", { hasText: "INDIVIDUAL" })
      ).toHaveCount(1)
      await page.locator("#supplier").selectOption(individual.id)
      for (const [key, value] of Object.entries({
        engineNumber: `E-${suffix}-loss`,
        chassisNumber: `C-${suffix}-loss`,
        make: "Synthetic",
        model: "Lost response",
        year: "2026",
        colour: "Blue",
        purchaseDate: "2026-10-01",
        purchasePrice: "100",
        mileageDate: "2026-10-01",
      }))
        await page.locator(`#acquisition-${key}`).fill(value)
      let original = "",
        count = 0
      await page.route("**/api/v1/commands/recordPurchase", async (route) => {
        const body = route.request().postData()!
        if (!count++) {
          original = body
          const response = await route.fetch()
          assert.equal(response.status(), 201)
          await route.abort("failed")
        } else {
          assert.equal(body, original)
          await route.continue()
        }
      })
      await page
        .getByRole("button", { name: "Record fully paid acquisition" })
        .click()
      await expect(
        page.getByRole("button", { name: "Retry unchanged acquisition" })
      ).toBeVisible()
      await command(
        b.request,
        "updateDirectoryParty",
        envelope(
          {
            type: "SUPPLIER",
            id: individual.id,
            values: {
              ...individual.directory!,
              name: `${individual.name} changed`,
            },
          },
          [ref("Supplier", individual)]
        )
      )
      individual = await query(
        a.request,
        "party",
        `?type=SUPPLIER&id=${individual.id}`
      )
      await page
        .getByRole("button", { name: "Retry unchanged acquisition" })
        .click()
      await page.waitForURL(/\/purchases\/[0-9a-f-]+$/)
      assert.equal(count, 2)
      await page.unroute("**/api/v1/commands/recordPurchase")
    }
  )
  await group(
    "field-limited financial projection, predicates, audit, party targets and RSC privacy",
    async () => {
      const me = await query<{ user: { id: string }; roles: { id: string }[] }>(
        staff.request,
        "currentActor"
      )
      const role = await command(
        a.request,
        "saveRole",
        envelope({
          name: `T05a limited ${suffix}`,
          reason: "Synthetic projection proof",
          grants: [
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
                "purchaseDate",
              ],
            },
            {
              subject: "Vehicle",
              action: "read",
              fields: [
                "id",
                "revision",
                "identityRevision",
                "identity",
                "status",
                "available",
                "cycleId",
              ],
            },
            { subject: "AuditLog", action: "read", fields: ["*"] },
          ] satisfies Grant[],
        }),
        201
      )
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
            reason: "Synthetic projection",
          },
          [ref("User", user), { type: "Role", id: role.result.id, revision: 1 }]
        )
      )
      const visible = await query<Record<string, unknown>>(
        staff.request,
        "purchase",
        `?cycleId=${brand.id}`
      )
      for (const field of [
        "purchasePrice",
        "financial",
        "payments",
        "basisVersions",
        "outstanding",
        "listedPrice",
      ])
        assert.equal(field in visible, false)
      const list = await query(staff.request, "purchases")
      assert.ok(!JSON.stringify(list).includes("99999999999999"))
      assert.equal(
        (
          await staff.request.get(
            '/api/v1/queries/purchases?sort=[{"field":"purchasePrice","direction":"asc"}]'
          )
        ).status(),
        403
      )
      const audits = await query(
        staff.request,
        "audit",
        `?type=PurchaseRecord&id=${brand.id}`
      )
      assert.ok(!JSON.stringify(audits).includes("99999999999999"))
      const rsc = await staff.request.get(`/vehicles/${brand.vehicleId}`, {
        headers: { RSC: "1" },
      })
      assert.equal(rsc.status(), 200)
      assert.ok(!(await rsc.text()).includes("99999999999999"))
      const before = await snapshot()
      await command(
        staff.request,
        "recordPurchase",
        envelope(purchase("denied"), [ref("Supplier", individual)]),
        403
      )
      assert.equal(await snapshot(), before)
      const changedRole = await command(
        a.request,
        "saveRole",
        envelope(
          {
            id: role.result.id,
            name: `T05a limited ${suffix}`,
            reason: "Synthetic changed financial field denial",
            grants: [
              {
                subject: "PurchaseRecord",
                action: "create",
                fields: registry.PurchaseRecord.create.filter(
                  (f) => f !== "purchasePrice"
                ),
              },
              {
                subject: "Vehicle",
                action: "create",
                fields: [...registry.Vehicle.create],
              },
              {
                subject: "Vehicle",
                action: "read",
                fields: [
                  "id",
                  "revision",
                  "identity",
                  "identityRevision",
                  "cycleId",
                  "status",
                ],
              },
              {
                subject: "Supplier",
                action: "read",
                fields: ["id", "revision", "name", "contributions.purchases"],
              },
            ],
          },
          [{ type: "Role", id: role.result.id, revision: 1 }]
        )
      )
      const deniedBefore = await snapshot()
      const denied = await command(
        staff.request,
        "recordPurchase",
        envelope(purchase("price-field-denied"), [ref("Supplier", individual)]),
        403
      )
      assert.equal(denied.error.code, "FIELD_FORBIDDEN")
      assert.equal(await snapshot(), deniedBefore)
      const identityOnly = await query<Record<string, unknown>>(
        staff.request,
        "vehicleIdentity",
        `?engineNumber=${brand.identity.engineNumber}&chassisNumber=${brand.identity.chassisNumber}`
      )
      assert.equal(identityOnly.id, brand.vehicleId)
      for (const field of ["activeCycleId", "latestCycleId", "latestStatus"])
        assert.equal(field in identityOnly, false)
      assert.equal(
        (await staff.request.get("/api/v1/queries/inventory")).status(),
        403
      )
      assert.equal(
        (
          await staff.request.get(
            `/api/v1/queries/purchase?cycleId=${brand.id}`
          )
        ).status(),
        404
      )
      assert.equal(changedRole.result.revision, 2)
      const noTargetGrant = await query<{
        contributions: { purchases: { links: unknown[] } }
      }>(staff.request, "party", `?type=SUPPLIER&id=${individual.id}`)
      assert.deepEqual(noTargetGrant.contributions.purchases.links, [])
      assert.equal(
        (
          await db.query(
            'SELECT count(*) FROM vamotors."PurchaseRecord" WHERE "supplierId"=$1',
            [individual.id]
          )
        ).rows[0].count === "0",
        false
      )
      const current = await query<{
        id: string
        revision: number
        name: string
      }>(a.request, "user", `?id=${user.id}`)
      const refs = await Promise.all(
        me.roles.map(async (r) =>
          ref(
            "Role",
            await query<{ id: string; revision: number }>(
              a.request,
              "role",
              `?id=${r.id}`
            )
          )
        )
      )
      await command(
        a.request,
        "updateUser",
        envelope(
          {
            id: user.id,
            name: current.name,
            active: true,
            roleIds: me.roles.map((r) => r.id),
            reason: "Restore original staff roles",
          },
          [ref("User", current), ...refs]
        )
      )
    }
  )
  await group(
    "stale acquisition retains original draft and requires explicit reload/reconfirmation/new key",
    async () => {
      await page.goto("/purchases")
      await page.getByRole("button", { name: "New paid acquisition" }).click()
      await page.getByLabel("Search active suppliers by name").fill(suffix)
      await expect(
        page.locator("#supplier option", { hasText: "INDIVIDUAL" })
      ).toHaveCount(1)
      await page.locator("#supplier").selectOption(individual.id)
      for (const [key, value] of Object.entries({
        engineNumber: `E-${suffix}-stale-ui`,
        chassisNumber: `C-${suffix}-stale-ui`,
        make: "Synthetic",
        model: "Retained stale draft",
        year: "2026",
        colour: "Blue",
        purchaseDate: "2026-10-01",
        purchasePrice: "100",
        mileageDate: "2026-10-01",
      }))
        await page.locator(`#acquisition-${key}`).fill(value)
      const oldRevision = individual.revision
      await command(
        b.request,
        "updateDirectoryParty",
        envelope(
          {
            type: "SUPPLIER",
            id: individual.id,
            values: {
              ...individual.directory!,
              name: `${individual.name} stale review`,
            },
          },
          [ref("Supplier", individual)]
        )
      )
      individual = await query(
        a.request,
        "party",
        `?type=SUPPLIER&id=${individual.id}`
      )
      const bodies: string[] = []
      await page.route("**/api/v1/commands/recordPurchase", async (route) => {
        bodies.push(route.request().postData()!)
        await route.continue()
      })
      const before = await snapshot()
      await page
        .getByRole("button", { name: "Record fully paid acquisition" })
        .click()
      await expect(
        page.getByRole("alert").filter({ hasText: "STALE_REVISION" })
      ).toBeVisible()
      assert.equal(await snapshot(), before)
      await expect(page.locator("#acquisition-model")).toHaveValue(
        "Retained stale draft"
      )
      await page
        .getByRole("button", { name: "Reload current supplier", exact: true })
        .click()
      await page
        .getByRole("button", { name: "Reconfirm retained draft as new intent" })
        .click()
      await page
        .getByRole("button", { name: "Record fully paid acquisition" })
        .click()
      await page.waitForURL(/\/purchases\/[0-9a-f-]+$/)
      assert.equal(bodies.length, 2)
      const first = JSON.parse(bodies[0]),
        next = JSON.parse(bodies[1])
      assert.deepEqual(first.input, next.input)
      assert.notEqual(first.idempotencyKey, next.idempotencyKey)
      assert.equal(first.expected[0].revision, oldRevision)
      assert.equal(next.expected[0].revision, individual.revision)
      await page.unroute("**/api/v1/commands/recordPurchase")
    }
  )
  await group(
    "cash has no invented Settings CAS; concurrent policy changes preserve immutable acquisition snapshots",
    async () => {
      const settings = await query<QueryData["settings"]>(a.request, "settings")
      const { id, revision, policyVersion, ...values } = settings
      void policyVersion
      const before = (
        await db.query(
          'SELECT to_jsonb(p) AS p,to_jsonb(v) AS v FROM vamotors."PurchaseRecord" p JOIN vamotors."SettingsVersion" v ON v.id=p."settingsVersionId" WHERE p.id=$1',
          [brand.id]
        )
      ).rows[0]
      const body = envelope(purchase("settings-race"), [
        ref("Supplier", individual),
      ])
      assert.equal(
        body.expected.some((r) => r.type === "Settings"),
        false
      )
      const [acquired] = await Promise.all([
        command(a.request, "recordPurchase", body, 201),
        command(
          b.request,
          "updateSettings",
          envelope(
            {
              ...values,
              timezone: values.timezone === "UTC" ? "Asia/Colombo" : "UTC",
              reason: "Synthetic purchase policy race",
            },
            [{ type: "Settings", id, revision }]
          )
        ),
      ])
      const after = (
        await db.query(
          'SELECT to_jsonb(p) AS p,to_jsonb(v) AS v FROM vamotors."PurchaseRecord" p JOIN vamotors."SettingsVersion" v ON v.id=p."settingsVersionId" WHERE p.id=$1',
          [brand.id]
        )
      ).rows[0]
      assert.deepEqual(after, before)
      const row = await query<PurchaseCycleDTO>(
        a.request,
        "purchase",
        `?cycleId=${acquired.result.id}`
      )
      assert.equal(row.payments[0].date, "2026-10-01")
      assert.equal(row.financial?.currency, values.currency)
      assert.equal(
        (
          await db.query(
            'SELECT count(*) FROM vamotors."SettingsVersion" v JOIN vamotors."PurchaseRecord" p ON p."settingsVersionId"=v.id WHERE p.id=$1',
            [row.id]
          )
        ).rows[0].count,
        "1"
      )
    }
  )
  await group(
    "locked execution and locked replay observe committed current-account revocation",
    async () => {
      const target = await query<{ user: { id: string } }>(
        b.request,
        "currentActor"
      )
      const current = async () =>
        query<{
          id: string
          revision: number
          name: string
          active: boolean
          roles: { id: string; revision: number }[]
        }>(a.request, "user", `?id=${target.user.id}`)
      const setActive = async (active: boolean) => {
        const user = await current()
        return command(
          a.request,
          "updateUser",
          envelope(
            {
              id: user.id,
              name: user.name,
              active,
              roleIds: user.roles.map((r) => r.id),
              reason: "Synthetic lock/revocation proof",
            },
            [ref("User", user), ...user.roles.map((r) => ref("Role", r))]
          )
        )
      }
      const replayBody = envelope(purchase("revocation-replay"), [
        ref("Supplier", individual),
      ])
      await command(b.request, "recordPurchase", replayBody, 201)
      for (const body of [
        envelope(purchase("revocation-new"), [ref("Supplier", individual)]),
        replayBody,
      ]) {
        const before = await snapshot(),
          blocker = await db.connect()
        try {
          await blocker.query("BEGIN")
          await blocker.query(
            'SELECT value FROM vamotors."BusinessSequence" WHERE id=1 FOR UPDATE'
          )
          const request = b.request.post("/api/v1/commands/recordPurchase", {
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
          await setActive(false)
          await blocker.query("COMMIT")
          const response = await request
          assert.equal(response.status(), 403)
          assert.equal((await response.json()).error.code, "ACCOUNT_INACTIVE")
          // Administrative changes do not change any report/source/history row.
          const after = JSON.parse(await snapshot()),
            old = JSON.parse(before)
          for (const key of [
            "Vehicle",
            "PurchaseRecord",
            "PurchasePayment",
            "MileageReading",
            "CycleBasisVersion",
            "StatusEvent",
            "EntityReadVersion",
            "BusinessSequence",
          ])
            assert.deepEqual(after[key], old[key])
        } finally {
          await blocker.query("ROLLBACK")
          blocker.release()
          await setActive(true)
        }
      }
    }
  )
  await group(
    "supplier archive/update eligibility races preserve lawful history without new effects",
    async () => {
      const old = company
      const archived = await command(
        a.request,
        "archiveParty",
        envelope(
          {
            type: "SUPPLIER",
            id: company.id,
            active: false,
            reason: "Synthetic eligibility proof",
          },
          [ref("Supplier", company)]
        )
      )
      company = await query(
        a.request,
        "party",
        `?type=SUPPLIER&id=${company.id}`
      )
      const before = await snapshot()
      await command(
        a.request,
        "recordPurchase",
        envelope(purchase("stale-archived", old, "BRAND_NEW"), [
          ref("Supplier", old),
        ]),
        409
      )
      await command(
        a.request,
        "recordPurchase",
        envelope(purchase("archived", company, "BRAND_NEW"), [
          ref("Supplier", company),
        ]),
        409
      )
      assert.equal(await snapshot(), before)
      const history = await query<PurchaseCycleDTO>(
        a.request,
        "purchase",
        `?cycleId=${brand.id}`
      )
      assert.equal(history.seller.active, false)
      assert.equal(history.payments[0].id, brand.payments[0].id)
      await command(
        a.request,
        "archiveParty",
        envelope(
          {
            type: "SUPPLIER",
            id: company.id,
            active: true,
            reason: "Restore synthetic supplier",
          },
          [
            {
              type: "Supplier",
              id: company.id,
              revision: archived.result.revision,
            },
          ]
        )
      )
      company = await query(
        a.request,
        "party",
        `?type=SUPPLIER&id=${company.id}`
      )
    }
  )
  await group(
    "mobile inline supplier owns independent envelope; keyboard, retained draft and transient authorization read",
    async () => {
      await second.goto("/purchases")
      await second.getByRole("button", { name: "New paid acquisition" }).click()
      await second
        .locator("#acquisition-engineNumber")
        .fill(`E-${suffix}-inline`)
      await second
        .getByRole("button", { name: "Create supplier inline" })
        .click()
      const inline = second.getByRole("region", { name: "Inline supplier" })
      await inline.locator("#party-name").fill(`Inline supplier ${suffix}`)
      const submit = inline.getByRole("button", {
        name: "Create directory entry",
        exact: true,
      })
      await expect(submit).toBeVisible()
      await submit.focus()
      await second.keyboard.press("Enter")
      await expect(second.locator("#supplier")).not.toHaveValue("")
      await expect(second.locator("#acquisition-engineNumber")).toHaveValue(
        `E-${suffix}-inline`
      )
      assert.equal(
        await second.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        ),
        true
      )
      await second.route("**/api/v1/queries/currentActor", (route) =>
        route.abort("failed")
      )
      await second.evaluate(() => window.dispatchEvent(new Event("auth-check")))
      await expect(
        second.getByText("Checking access…", { exact: true })
      ).toBeVisible()
      await second.unroute("**/api/v1/queries/currentActor")
      await second.evaluate(() => window.dispatchEvent(new Event("auth-check")))
      await expect(second.locator("#acquisition-engineNumber")).toBeVisible()
      await expect(second.locator("#acquisition-engineNumber")).toHaveValue(
        `E-${suffix}-inline`
      )
    }
  )
  await group(
    "app and DB restart preserves identities, source rows, versions and sessions",
    async () => {
      const before = await snapshot()
      await stop()
      await db.end()
      await restricted.end()
      await monitor.end()
      execFileSync(
        process.execPath,
        ["--import", "tsx", "scripts/local-postgres.ts", "stop"],
        { env: { ...process.env, VAMOTORS_LOCAL_DIR: root }, stdio: "pipe" }
      )
      execFileSync(
        process.execPath,
        ["--import", "tsx", "scripts/local-postgres.ts", "start"],
        { env: { ...process.env, VAMOTORS_LOCAL_DIR: root }, stdio: "pipe" }
      )
      db = new pg.Pool({ connectionString: migration.DIRECT_URL, max: 3 })
      restricted = new pg.Pool({
        connectionString: runtime.DATABASE_URL,
        max: 2,
      })
      monitor = new pg.Pool({ connectionString: monitorURL.href, max: 1 })
      assert.equal(await snapshot(), before)
      await start()
      assert.deepEqual(
        await query(b.request, "purchase", `?cycleId=${brand.id}`),
        brand
      )
      await second.goto(`/purchases/${cash.id}`)
      await expect(
        second.getByText("Purchase cycle 1", { exact: true })
      ).toBeVisible()
    }
  )
  await writeFile(
    join(root, `purchase-acquisition-${suffix}.json`),
    JSON.stringify(
      {
        source: execFileSync("git", ["rev-parse", "HEAD"], {
          encoding: "utf8",
        }).trim(),
        results,
        passed: results.length,
        note: "Author evidence only, not independent acceptance",
        origin,
        dirty: !!execFileSync("git", ["status", "--porcelain"], {
          encoding: "utf8",
        }).trim(),
        synthetic: { cash: cash.id, brand: brand.id },
        migrationInventory: (
          await db.query(
            "SELECT migration_name,checksum FROM vamotors._prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name"
          )
        ).rows,
        runtimeGrants: (
          await db.query(
            "SELECT table_name,column_name,privilege_type FROM information_schema.column_privileges WHERE grantee='vamotors_runtime' ORDER BY table_name,column_name,privilege_type"
          )
        ).rows,
      },
      null,
      2
    ),
    { mode: 0o600 }
  )
  console.log(
    `PASS ${results.length} purchase groups; private evidence: ${root}/purchase-acquisition-${suffix}.json`
  )
} catch (error) {
  console.error(`FAIL purchase campaign: ${stage}`)
  console.error((await page.getByRole("alert").allTextContents()).join("\n"))
  console.error((await second.getByRole("alert").allTextContents()).join("\n"))
  console.error(
    error instanceof assert.AssertionError
      ? error.message
      : error instanceof Error &&
          !/postgres|password|connection/i.test(error.message)
        ? error.message
        : "private failure diagnostics withheld"
  )
  process.exitCode = 1
} finally {
  await browser.close()
  await stop()
  await db.end()
  await restricted.end()
  await monitor.end()
}
