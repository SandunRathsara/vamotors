/** Retained real production HTTP/UI/PostgreSQL settlement campaign. No reset. */
import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { spawn, execFileSync, type ChildProcess } from "node:child_process"
import { once } from "node:events"
import { createServer } from "node:net"
import { createWriteStream } from "node:fs"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import {
  chromium,
  expect,
  type APIRequestContext,
  type APIResponse,
  type Page,
} from "@playwright/test"
import pg from "pg"
import { privateEnvironment } from "../../scripts/private-environment"
import { fieldsFor } from "../../lib/server/permissions"
import type {
  Applied,
  PurchaseCycleDTO,
  Dependency,
  Grant,
  CurrentActorDTO,
  Settlement,
  PartyDetailDTO,
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
const sha = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  suffix = randomUUID()
let db = new pg.Pool({ connectionString: migration.DIRECT_URL, max: 3 }),
  restricted = new pg.Pool({ connectionString: runtime.DATABASE_URL, max: 1 })
const monitorURL = new URL(admin.ADMIN_URL!)
monitorURL.pathname = new URL(migration.DIRECT_URL!).pathname
let monitor = new pg.Pool({ connectionString: monitorURL.href, max: 1 })
const socket = createServer().listen(0, "127.0.0.1")
await once(socket, "listening")
const address = socket.address()
assert.ok(address && typeof address !== "string")
const port = address.port,
  origin = `http://127.0.0.1:${port}`
await new Promise<void>((resolve) => socket.close(() => resolve()))
let server: ChildProcess | undefined,
  stage = "initialization",
  originalStaff: CurrentActorDTO | undefined
const groups: string[] = [],
  cycles: string[] = [],
  manifest = join(root, `settlement-${suffix}-manifest.json`)
const evidence: Record<string, unknown> = {
  sha,
  sourceClean:
    execFileSync("git", ["status", "--porcelain"], {
      encoding: "utf8",
    }).trim() === "",
  root,
  groups,
  cycles,
  origin,
}
async function seal(status: string, failure?: string) {
  const content = JSON.stringify(
    { ...evidence, stage, status, failure, at: new Date().toISOString() },
    null,
    2
  )
  await writeFile(manifest, content, { mode: 0o600 })
  await writeFile(
    `${manifest}.sha256`,
    createHash("sha256").update(content).digest("hex"),
    { mode: 0o600 }
  )
}
async function group(name: string, run: () => Promise<void>) {
  stage = name
  await seal("RUNNING")
  await run()
  groups.push(name)
  await seal("RUNNING")
  console.log(`PASS ${name}`)
}
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
  server.stdout!.pipe(
    createWriteStream(join(root, `settlement-${suffix}-app.stdout`), {
      flags: "a",
      mode: 0o600,
    })
  )
  server.stderr!.pipe(
    createWriteStream(join(root, `settlement-${suffix}-app.stderr`), {
      flags: "a",
      mode: 0o600,
    })
  )
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("START_TIMEOUT")), 20000)
    server!.once("exit", () => {
      clearTimeout(timer)
      reject(new Error("EARLY_EXIT"))
    })
    server!.stdout!.on("data", (data) => {
      if (data.toString().includes("Ready")) {
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
async function login(p: Page, who: "ADMIN" | "SECOND" | "STAFF") {
  await p.goto("/login")
  await p.getByLabel("Email Address").fill(accounts[`BOOTSTRAP_${who}_EMAIL`]!)
  await p
    .getByLabel("Password", { exact: true })
    .fill(accounts[`BOOTSTRAP_${who}_PASSWORD`]!)
  const response = p.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/auth/sign-in/email"
  )
  await p.getByRole("button", { name: "Sign In", exact: true }).click()
  assert.equal((await response).status(), 200)
  await p.waitForURL("**/dashboard")
}
async function query<T>(
  client: APIRequestContext,
  name: string,
  params = ""
): Promise<T> {
  const response = await client.get(`/api/v1/queries/${name}${params}`)
  assert.equal(response.status(), 200, `QUERY_${name}`)
  assert.match(response.headers()["cache-control"], /no-store/)
  return (await response.json()).data
}
const envelope = <T>(
  input: T,
  expected: Dependency[] = [],
  key = randomUUID()
) => ({ schemaVersion: 1, idempotencyKey: key, expected, input })
const ref = (
  row: { id: string; revision: number },
  type: Dependency["type"] = "PurchaseRecord"
): Dependency => ({ type, id: row.id, revision: row.revision })
const refs = (row: PurchaseCycleDTO, vehicle = false): Dependency[] => [
  ref(row),
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
  const response = await client.post(`/api/v1/commands/${name}`, {
    data: body,
    headers: { Origin: origin },
  })
  const result = await response.json()
  assert.equal(response.status(), status, `${name}:${JSON.stringify(result)}`)
  assert.match(response.headers()["cache-control"], /no-store/)
  return result
}
const current = (id: string, client = a.request) =>
  query<PurchaseCycleDTO>(client, "purchase", `?cycleId=${id}`)
const payment = (amount: string, date = "2026-10-03") => ({
  amount,
  date,
  method: "BANK_TRANSFER" as const,
  reference: "Actual synthetic payment",
})
const tables = [
  "Vehicle",
  "PurchaseRecord",
  "LeasePurchaseDetail",
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
  const result: Record<string, unknown> = {}
  for (const table of tables)
    result[table] = (
      await db.query(
        `SELECT to_jsonb(t) AS row FROM vamotors."${table}" t ORDER BY id`
      )
    ).rows
  return JSON.stringify(result)
}
let supplier!: { id: string; revision: number },
  secondSupplier!: typeof supplier,
  company!: typeof supplier,
  secondCompany!: typeof supplier,
  primary!: PurchaseCycleDTO
const bank: Settlement = {
  institutionType: "BANK",
  institutionName: "Synthetic bank",
  reference: "SETTLEMENT-REFERENCE",
  amount: "6000",
  cashToSeller: "4000",
}
const input = (tag: string, settlement: Settlement = bank) => ({
  vehicle: {
    engineNumber: `S-E-${suffix}-${tag}`,
    chassisNumber: `S-C-${suffix}-${tag}`,
    make: "SyntheticSettlement",
    model: "T05c2",
    year: 2026,
    colour: "Blue",
    fuelType: "PETROL",
    transmission: "AUTOMATIC",
  },
  supplierId: supplier.id,
  purchaseDate: "2026-10-01",
  mileage: { reading: 0, date: "2026-10-01" },
  paymentMethod: "BANK_TRANSFER",
  purchaseType: "LEASE_SETTLEMENT",
  settlement,
})
const acquisitionRefs = (settlement: Settlement): Dependency[] => [
  ref(supplier, "Supplier"),
  ...(settlement.institutionType === "FINANCE_COMPANY"
    ? [
        ref(
          settlement.companyId === company.id ? company : secondCompany,
          "FinanceCompany"
        ),
      ]
    : []),
]
async function create(tag: string, settlement: Settlement = bank) {
  const result = await command(
    a.request,
    "recordPurchase",
    envelope(input(tag, settlement), acquisitionRefs(settlement)),
    201
  )
  cycles.push(result.result.id)
  return current(result.result.id)
}
async function edit(
  row: PurchaseCycleDTO,
  patch: unknown,
  extra: Dependency[] = [],
  cashCorrections: unknown[] = []
) {
  await command(
    a.request,
    "editPurchase",
    envelope(
      {
        cycleId: row.id,
        reason: "Actual reasoned purchase correction",
        patch,
        cashCorrections,
      },
      [...refs(row, true), ...extra]
    )
  )
  return current(row.id)
}
async function reverse(
  row: PurchaseCycleDTO,
  id: string,
  replacement?: ReturnType<typeof payment>
) {
  await command(
    a.request,
    "reversePayment",
    envelope(
      {
        sourceType: "PURCHASE",
        sourceId: row.id,
        paymentId: id,
        reason: "Actual erroneous-entry correction",
        ...(replacement ? { replacement } : {}),
      },
      refs(row)
    )
  )
  return current(row.id)
}
async function clear(row: PurchaseCycleDTO, category?: string) {
  for (const p of row.payments.filter(
    (p) =>
      !p.reversalOf &&
      !row.payments.some((r) => r.reversalOf === p.id) &&
      (!category || p.category === category)
  ))
    row = await reverse(row, p.id)
  return row
}
const reads: Grant[] = [
  { subject: "PurchaseRecord", action: "read", fields: ["*"] },
  { subject: "Vehicle", action: "read", fields: ["*"] },
  { subject: "VehicleCost", action: "read", fields: ["*"] },
  { subject: "Supplier", action: "read", fields: ["*"] },
  { subject: "FinanceCompany", action: "read", fields: ["*"] },
  { subject: "AuditLog", action: "read", fields: ["*"] },
]
async function assign(grants: Grant[]) {
  const role = await command(
    a.request,
    "saveRole",
    envelope({
      name: `Settlement-${randomUUID()}`,
      reason: "Synthetic scoped settlement role",
      grants,
    }),
    201
  )
  const user = await query<{ id: string; revision: number; name: string }>(
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
        reason: "Synthetic scoped assignment",
      },
      [ref(user, "User"), ref({ id: role.result.id, revision: 1 }, "Role")]
    )
  )
}
async function restore() {
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
        reason: "Restore original staff authority",
      },
      [ref(user, "User"), ...roles.map((r) => ref(r, "Role"))]
    )
  )
}
try {
  await start()
  await group(
    "real accounts, active SW, typed directory references",
    async () => {
      await login(page, "ADMIN")
      await login(mobile, "SECOND")
      await login(limited, "STAFF")
      await page.waitForFunction(
        () => navigator.serviceWorker.controller?.state === "activated"
      )
      evidence.serviceWorker = await page.evaluate(() => ({
        controller: navigator.serviceWorker.controller?.scriptURL,
        state: navigator.serviceWorker.controller?.state,
      }))
      originalStaff = await query(staff.request, "currentActor")
      assert.equal(
        (
          await anonymous.request.post("/api/v1/commands/recordPurchase", {
            data: {},
            headers: { Origin: origin },
          })
        ).status(),
        401
      )
      for (const index of [0, 1]) {
        const result = await command(
          a.request,
          "createDirectoryParty",
          envelope({
            type: "SUPPLIER",
            values: {
              name: `Settlement supplier ${suffix}-${index}`,
              category: "COMPANY",
              contacts: [],
            },
          }),
          201
        )
        const row = await query<typeof supplier>(
          a.request,
          "party",
          `?type=SUPPLIER&id=${result.result.id}`
        )
        if (index === 0) supplier = row
        else secondSupplier = row
        const settings = await query<{ id: string; revision: number }>(
          a.request,
          "settings"
        )
        const f = await command(
          a.request,
          "createFinanceCompany",
          envelope(
            {
              name: `Settlement finance ${suffix}-${index}`,
              contacts: [
                {
                  name: "Synthetic contact",
                  phone: "0112345678",
                  role: "Settlements",
                  primary: true,
                },
              ],
              policy: {
                path: "APPLICATION",
                commission: { basis: "FIXED", fixed: "1", rateBps: 0 },
                processingFee: "0",
                reconciliationMethod: "PER_DEAL",
              },
            },
            [ref(settings, "Settings")]
          ),
          201
        )
        const finance = await query<typeof company>(
          a.request,
          "party",
          `?type=FINANCE_COMPANY&id=${f.result.id}`
        )
        if (index === 0) company = finance
        else secondCompany = finance
      }
    }
  )
  await group(
    "three institutions, either zero, A+A, exact initial positive dated payments and one basis",
    async () => {
      for (const [tag, settlement] of [
        ["bank", bank],
        ["private", { ...bank, institutionType: "PRIVATE_PARTY" }],
        [
          "finance",
          {
            reference: bank.reference,
            amount: bank.amount,
            cashToSeller: bank.cashToSeller,
            institutionType: "FINANCE_COMPANY",
            companyId: company.id,
          },
        ],
        ["zero-seller", { ...bank, cashToSeller: "0" }],
        ["zero-institution", { ...bank, amount: "0" }],
        [
          "maximum",
          { ...bank, amount: "99999999999999", cashToSeller: "99999999999999" },
        ],
      ] as [string, Settlement][]) {
        const row = await create(tag, settlement),
          total = (
            BigInt(settlement.amount) + BigInt(settlement.cashToSeller)
          ).toString()
        if (tag === "finance") primary = row
        assert.equal(row.purchasePrice, total)
        assert.equal(row.financial?.basis, total)
        assert.equal(row.financial?.cashOut, total)
        assert.equal(row.basisVersions.length, 1)
        assert.equal(row.status, "PURCHASED")
        assert.equal(row.available, false)
        assert.equal(row.mileage[0].reading, 0)
        assert.deepEqual(row.outstanding, { seller: "0", settlement: "0" })
        assert.equal(
          row.payments.length,
          Number(settlement.amount !== "0") +
            Number(settlement.cashToSeller !== "0")
        )
        for (const p of row.payments) {
          assert.equal(p.date, row.purchaseDate)
          assert.equal(p.method, "BANK_TRANSFER")
          assert.equal(p.direction, "OUT")
          assert.ok(BigInt(p.amount) > 0n)
        }
        assert.equal(
          (await current(row.id, b.request)).settlement?.reference,
          settlement.reference
        )
      }
    }
  )
  await group(
    "real incurred basis reaches exact C, then rejects C+1 without effects",
    async () => {
      let row = await create("aggregate-C", {
        ...bank,
        amount: "99999999999999",
        cashToSeller: "0",
      })
      for (let index = 0; index < 100; index++) {
        await command(
          a.request,
          "addCost",
          envelope(
            {
              cycleId: row.id,
              category: "Synthetic bound proof",
              description: `Exact incurred component ${index}`,
              amount: index === 99 ? "99" : "99999999999999",
              incurredDate: "2026-10-02",
            },
            refs(row)
          ),
          201
        )
        row = await current(row.id)
      }
      assert.equal(row.financial?.basis, "9999999999999999")
      assert.equal(row.financial?.cashOut, "99999999999999")
      const before = await snapshot()
      const overflow = await a.request.post("/api/v1/commands/addCost", {
        headers: { Origin: origin },
        data: envelope(
          {
            cycleId: row.id,
            category: "Synthetic bound proof",
            description: "Would overflow incurred C",
            amount: "1",
            incurredDate: "2026-10-02",
          },
          refs(row)
        ),
      })
      const after = await snapshot()
      evidence.incurredC = {
        status: overflow.status(),
        result: await overflow.json(),
        zeroEffects: after === before,
      }
      await seal("RUNNING")
      assert.equal(after, before)
      assert.equal(overflow.status(), 422)
      assert.equal(await snapshot(), before)
    }
  )
  await group(
    "strict XOR, canonical bounds/dates/hidden fields and actual expected refs have zero effects",
    async () => {
      const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Colombo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date())
      const [year, month, day] = today.split("-").map(Number)
      const tomorrow = new Date(Date.UTC(year, month - 1, day + 1))
        .toISOString()
        .slice(0, 10)
      const dated = await command(
        a.request,
        "recordPurchase",
        envelope(
          {
            ...input("colombo-today", {
              ...bank,
              amount: "1",
              cashToSeller: "0",
            }),
            purchaseDate: today,
            mileage: { reading: 0, date: today },
          },
          [ref(supplier, "Supplier")]
        ),
        201
      )
      cycles.push(dated.result.id)
      assert.equal((await current(dated.result.id)).payments[0].date, today)
      const before = await snapshot(),
        original = input("negative")
      await command(
        a.request,
        "recordPurchase",
        envelope(
          {
            ...input("colombo-tomorrow"),
            purchaseDate: tomorrow,
            mileage: { reading: 0, date: tomorrow },
          },
          [ref(supplier, "Supplier")]
        ),
        422
      )
      for (const patch of [
        { purchasePrice: "10000" },
        { payment: payment("1") },
        { notes: "Not a creation field" },
        { purchaseDate: "2026-02-30" },
        { purchaseDate: "9999-12-31" },
        { mileage: { reading: 0, date: "2026-09-30" } },
        ...["0", "01", "1.0", "1e2", "100000000000000", "9999999999999999"].map(
          (amount) => ({ settlement: { ...bank, amount, cashToSeller: "0" } })
        ),
        { settlement: { ...bank, companyId: company.id } },
        { settlement: { ...bank, institutionType: "FINANCE_COMPANY" } },
        { settlement: { ...bank, institutionNameSnapshot: "Forged" } },
      ])
        await command(
          a.request,
          "recordPurchase",
          envelope({ ...original, ...patch }, [ref(supplier, "Supplier")]),
          422
        )
      const finance: Settlement = {
        reference: "Finance refs",
        amount: "1",
        cashToSeller: "0",
        institutionType: "FINANCE_COMPANY",
        companyId: company.id,
      }
      await command(
        a.request,
        "recordPurchase",
        envelope(input("missing", finance), [ref(supplier, "Supplier")]),
        428
      )
      await command(
        a.request,
        "recordPurchase",
        envelope(input("stale", finance), [
          ref(supplier, "Supplier"),
          { ...ref(company, "FinanceCompany"), revision: company.revision + 1 },
        ]),
        409
      )
      await command(
        a.request,
        "recordPurchase",
        envelope(input("wrong-type", { ...finance, companyId: supplier.id }), [
          ref(supplier, "Supplier"),
        ]),
        404
      )
      assert.equal(await snapshot(), before)
      const existing = primary.identity
      await command(
        a.request,
        "recordPurchase",
        envelope({ ...input("identity"), vehicle: existing }, [
          ref(supplier, "Supplier"),
        ]),
        428
      )
      await command(
        a.request,
        "recordPurchase",
        envelope({ ...input("identity"), vehicle: existing }, [
          ref(supplier, "Supplier"),
          {
            type: "Vehicle",
            id: primary.vehicleId,
            revision: primary.identityRevision,
          },
        ]),
        409
      )
      assert.equal(await snapshot(), before)
    }
  )
  await group(
    "both recipient corrections, caps, immutable opposite category/date, cost basis once",
    async () => {
      primary = await reverse(
        primary,
        primary.payments.find((p) => p.category === "SETTLEMENT")!.id,
        payment("2000")
      )
      assert.equal(primary.outstanding.settlement, "4000")
      assert.equal(primary.outstanding.seller, "0")
      assert.equal(primary.basisVersions.length, 1)
      const opposite = primary.payments.find((p) => p.reversalOf)!
      assert.equal(opposite.category, "SETTLEMENT")
      assert.equal(opposite.date, "2026-10-01")
      assert.equal(opposite.amount, "6000")
      const before = await snapshot()
      for (const [recipient, amount] of [
        ["SELLER", "1"],
        ["SETTLEMENT", "4001"],
      ])
        await command(
          a.request,
          "payPurchase",
          envelope(
            { cycleId: primary.id, recipient, payment: payment(amount) },
            refs(primary)
          ),
          422
        )
      for (const paymentId of [opposite.id, opposite.reversalOf!])
        await command(
          a.request,
          "reversePayment",
          envelope(
            {
              sourceType: "PURCHASE",
              sourceId: primary.id,
              paymentId,
              reason: "No double correction",
            },
            refs(primary)
          ),
          409
        )
      await command(
        a.request,
        "reversePayment",
        envelope(
          {
            sourceType: "PURCHASE",
            sourceId: randomUUID(),
            paymentId: primary.payments[0].id,
            reason: "No cross source",
          },
          refs(primary)
        ),
        404
      )
      assert.equal(await snapshot(), before)
      await command(
        a.request,
        "payPurchase",
        envelope(
          {
            cycleId: primary.id,
            recipient: "SETTLEMENT",
            payment: payment("1000"),
          },
          refs(primary)
        )
      )
      primary = await current(primary.id)
      const cost = await command(
        a.request,
        "addCost",
        envelope(
          {
            cycleId: primary.id,
            category: "Transport",
            description: "Real incurred cost",
            amount: "500",
            incurredDate: "2026-10-02",
            payment: payment("200"),
          },
          refs(primary)
        ),
        201
      )
      primary = await current(primary.id)
      assert.equal(primary.financial?.basis, "10500")
      assert.equal(
        primary.costs.find((c) => c.id === cost.result.id)!.outstanding,
        "300"
      )
      await command(
        a.request,
        "receiveStock",
        envelope(
          {
            cycleId: primary.id,
            date: "2026-10-02",
            disposition: { kind: "HOLD", reason: "Real physical receipt" },
          },
          refs(primary)
        )
      )
      primary = await current(primary.id)
      assert.equal(primary.status, "IN_STOCK")
      assert.equal(primary.financial?.basis, "10500")
    }
  )
  await group(
    "live credits block payee changes; explicit reverse-edit-fresh-pay retains historical company links",
    async () => {
      const before = await snapshot(),
        changed: Settlement = {
          reference: "Correct institution",
          amount: "6000",
          cashToSeller: "4000",
          institutionType: "FINANCE_COMPANY",
          companyId: secondCompany.id,
        }
      await command(
        a.request,
        "editPurchase",
        envelope(
          {
            cycleId: primary.id,
            reason: "Cannot relabel paid company",
            patch: { settlement: changed },
            cashCorrections: [],
          },
          [...refs(primary, true), ref(secondCompany, "FinanceCompany")]
        ),
        422
      )
      await command(
        a.request,
        "editPurchase",
        envelope(
          {
            cycleId: primary.id,
            reason: "Cannot relabel paid supplier",
            patch: { seller: { type: "SUPPLIER", id: secondSupplier.id } },
            cashCorrections: [],
          },
          [...refs(primary, true), ref(secondSupplier, "Supplier")]
        ),
        422
      )
      assert.equal(await snapshot(), before)
      primary = await clear(primary)
      const oldBasis = primary.basisVersions.length
      primary = await edit(
        primary,
        {
          seller: { type: "SUPPLIER", id: secondSupplier.id },
          settlement: changed,
        },
        [ref(secondSupplier, "Supplier"), ref(secondCompany, "FinanceCompany")]
      )
      assert.equal(primary.basisVersions.length, oldBasis)
      assert.equal(primary.outstanding.settlement, "6000")
      const truthful = await snapshot()
      await command(
        a.request,
        "payPurchase",
        envelope(
          {
            cycleId: primary.id,
            recipient: "SETTLEMENT",
            payment: payment("6001"),
          },
          refs(primary)
        ),
        422
      )
      assert.equal(await snapshot(), truthful)
      await command(
        a.request,
        "payPurchase",
        envelope(
          {
            cycleId: primary.id,
            recipient: "SETTLEMENT",
            payment: payment("3000", "2026-10-04"),
          },
          refs(primary)
        )
      )
      primary = await current(primary.id)
      assert.equal(primary.outstanding.settlement, "3000")
      for (const companyId of [company.id, secondCompany.id]) {
        const party = await query<PartyDetailDTO>(
          a.request,
          "party",
          `?type=FINANCE_COMPANY&id=${companyId}`
        )
        assert.equal(party.type, "FINANCE_COMPANY")
        if (party.type !== "FINANCE_COMPANY") throw new Error("Wrong party")
        assert.equal(party.contributions.settlementPurchases.state, "READY")
        assert.ok(
          party.contributions.settlementPurchases.links.some(
            (l) => l.id === primary.id
          )
        )
        assert.equal(party.contributions.leaseSales.state, "PENDING_DOMAIN")
      }
      const audit = await query(
        a.request,
        "audit",
        `?type=PurchaseRecord&id=${primary.id}&pageSize=100`
      )
      assert.ok(JSON.stringify(audit).includes(company.id))
      assert.ok(JSON.stringify(audit).includes(secondCompany.id))
    }
  )
  await group(
    "all channel transitions require full settlement / explicit clearing and preserve initial graph",
    async () => {
      let row = await clear(await create("transitions"))
      const initial = row.basisVersions[0],
        original = row.payments[0]
      for (const type of [
        "CASH",
        "BRAND_NEW",
        "LEASE_SETTLEMENT",
        "BRAND_NEW",
        "CASH",
        "LEASE_SETTLEMENT",
      ]) {
        const patch =
          type === "LEASE_SETTLEMENT"
            ? { purchaseType: type, settlement: bank }
            : {
                purchaseType: type,
                ...(row.purchaseType === "LEASE_SETTLEMENT"
                  ? { settlement: null }
                  : {}),
                purchasePrice: "10000",
              }
        row = await edit(row, patch)
        assert.equal(row.purchaseType, type)
        assert.equal(row.settlement === undefined, type !== "LEASE_SETTLEMENT")
        assert.deepEqual(row.basisVersions[0], initial)
        assert.deepEqual(
          row.payments.find((p) => p.id === original.id),
          original
        )
      }
      for (const settlement of [
        { ...bank, institutionType: "PRIVATE_PARTY" } as Settlement,
        {
          institutionType: "FINANCE_COMPANY",
          companyId: company.id,
          reference: "Historic typed institution",
          amount: "6000",
          cashToSeller: "4000",
        } as Settlement,
        bank,
      ]) {
        row = await edit(
          row,
          { settlement },
          settlement.institutionType === "FINANCE_COMPANY"
            ? [ref(company, "FinanceCompany")]
            : []
        )
        assert.equal(
          row.settlement!.institutionType,
          settlement.institutionType
        )
        assert.equal(row.basisVersions.length, 1)
      }
      const before = await snapshot()
      for (const patch of [
        { purchaseType: "CASH" },
        { settlement: null },
        { settlement: { ...bank, amount: "1" }, purchasePrice: "2" },
        { seller: { type: "CUSTOMER", id: company.id } },
      ])
        await command(
          a.request,
          "editPurchase",
          envelope(
            {
              cycleId: row.id,
              reason: "Invalid final terms",
              patch,
              cashCorrections: [],
            },
            refs(row, true)
          ),
          "seller" in patch ? 404 : 422
        )
      await command(
        a.request,
        "editPurchase",
        envelope(
          {
            cycleId: row.id,
            reason: "Owning physical ref mandatory",
            patch: { notes: "Current correction" },
            cashCorrections: [],
          },
          refs(row)
        ),
        428
      )
      assert.equal(await snapshot(), before)
    }
  )
  await group(
    "component reduction, inactive selection and archived historical liabilities remain truthful",
    async () => {
      let row = await create("component-reduction")
      const before = await snapshot()
      await command(
        a.request,
        "editPurchase",
        envelope(
          {
            cycleId: row.id,
            reason: "Cannot erase institution credit",
            patch: {
              settlement: { ...bank, amount: "5000", cashToSeller: "5000" },
            },
            cashCorrections: [],
          },
          refs(row, true)
        ),
        422
      )
      assert.equal(await snapshot(), before)
      row = await edit(
        row,
        { settlement: { ...bank, amount: "5000", cashToSeller: "5000" } },
        [],
        [
          {
            paymentId: row.payments.find((p) => p.category === "SETTLEMENT")!
              .id,
            reason: "Explicit actual correction before split change",
            replacement: payment("5000"),
          },
        ]
      )
      assert.equal(row.basisVersions.length, 1)
      assert.equal(row.outstanding.seller, "1000")
      assert.equal(row.outstanding.settlement, "0")
      await command(
        a.request,
        "archiveParty",
        envelope(
          {
            type: "FINANCE_COMPANY",
            id: secondCompany.id,
            active: false,
            reason: "Retain historical liabilities",
          },
          [ref(secondCompany, "FinanceCompany")]
        )
      )
      secondCompany = await query(
        a.request,
        "party",
        `?type=FINANCE_COMPANY&id=${secondCompany.id}`
      )
      const archivedTerms: Settlement = {
        institutionType: "FINANCE_COMPANY",
        companyId: secondCompany.id,
        reference: "Archived existing reference corrected",
        amount: "6000",
        cashToSeller: "4000",
      }
      const archived = await snapshot()
      await command(
        a.request,
        "recordPurchase",
        envelope(input("inactive-company", archivedTerms), [
          ref(supplier, "Supplier"),
          ref(secondCompany, "FinanceCompany"),
        ]),
        409
      )
      assert.equal(await snapshot(), archived)
      primary = await edit(primary, { settlement: archivedTerms }, [
        ref(secondCompany, "FinanceCompany"),
      ])
      await command(
        a.request,
        "payPurchase",
        envelope(
          {
            cycleId: primary.id,
            recipient: "SETTLEMENT",
            payment: payment("100", "2026-10-05"),
          },
          refs(primary)
        )
      )
      primary = await current(primary.id)
      assert.equal(primary.outstanding.settlement, "2900")
      await command(
        a.request,
        "archiveParty",
        envelope(
          {
            type: "FINANCE_COMPANY",
            id: secondCompany.id,
            active: true,
            reason: "Restore selectable synthetic company",
          },
          [ref(secondCompany, "FinanceCompany")]
        )
      )
      secondCompany = await query(
        a.request,
        "party",
        `?type=FINANCE_COMPANY&id=${secondCompany.id}`
      )
      const name = primary.settlement!.institutionNameSnapshot,
        settings = await query<{ id: string; revision: number }>(
          a.request,
          "settings"
        )
      await command(
        a.request,
        "updateFinanceCompany",
        envelope(
          {
            id: secondCompany.id,
            name: `Renamed synthetic company ${suffix}`,
            contacts: [],
            policy: {
              path: "APPLICATION",
              commission: { basis: "FIXED", fixed: "1", rateBps: 0 },
              processingFee: "0",
              reconciliationMethod: "PER_DEAL",
            },
            reason: "Directory rename must not alter acquisition snapshots",
          },
          [ref(secondCompany, "FinanceCompany"), ref(settings, "Settings")]
        )
      )
      secondCompany = await query(
        a.request,
        "party",
        `?type=FINANCE_COMPANY&id=${secondCompany.id}`
      )
      primary = await current(primary.id)
      assert.equal(primary.settlement!.institutionNameSnapshot, name)
    }
  )
  await group(
    "creation/correction field authority and hidden direction/category/component/name history with positive controls",
    async () => {
      const writes: Grant[] = [
        { subject: "PurchaseRecord", action: "create", fields: ["*"] },
        { subject: "Vehicle", action: "create", fields: ["*"] },
        { subject: "PurchaseRecord", action: "pay", fields: ["*"] },
        { subject: "PurchaseRecord", action: "update", fields: ["*"] },
      ]
      const allLeaves = fieldsFor("PurchaseRecord", "read").filter(
        (f, _i, fields) => !fields.some((child) => child.startsWith(`${f}.`))
      )
      for (const denied of [
        "payments.direction",
        "payments.category",
        "settlement.amount",
        "settlement.cashToSeller",
        "none",
      ]) {
        await assign([
          ...reads.filter((g) => g.subject !== "PurchaseRecord"),
          {
            subject: "PurchaseRecord",
            action: "read",
            fields: allLeaves.filter((f) => f !== denied),
          },
          ...writes,
        ])
        const target = await current(primary.id, staff.request)
        if (denied === "none") {
          assert.equal(target.purchasePrice, primary.purchasePrice)
          assert.ok(target.financial?.basis)
          assert.ok(target.outstanding)
        } else {
          assert.equal(target.outstanding, undefined)
          if (denied.startsWith("settlement.")) {
            assert.equal(target.purchasePrice, undefined)
            assert.equal(target.financial, undefined)
          } else if (denied === "payments.direction")
            assert.equal(target.financial?.cashOut, undefined)
        }
        const audits = await query(
          staff.request,
          "audit",
          `?type=PurchaseRecord&id=${primary.id}&pageSize=100`
        )
        if (denied !== "none")
          assert.ok(
            !JSON.stringify(audits).includes('"path":"outstanding.settlement"')
          )
        for (const width of [360, 1920]) {
          await limited.setViewportSize({ width, height: 1080 })
          await limited.goto(`/purchases/${primary.id}`)
          await expect(
            limited.getByRole("heading", { name: /Purchase cycle/ })
          ).toBeVisible()
          assert.equal(
            await limited.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth
            ),
            true
          )
          await limited.screenshot({
            path: join(
              root,
              `settlement-${suffix}-${denied.replaceAll(".", "-")}-${width}.png`
            ),
            fullPage: true,
          })
        }
      }
      await assign([
        ...reads.filter((g) => g.subject !== "FinanceCompany"),
        {
          subject: "FinanceCompany",
          action: "read",
          fields: [
            "id",
            "revision",
            "active",
            "contributions.settlementPurchases",
          ],
        },
      ])
      const hidden = await query(
        staff.request,
        "audit",
        `?type=PurchaseRecord&id=${primary.id}&pageSize=100`
      )
      assert.ok(
        !JSON.stringify(hidden).includes(`Settlement finance ${suffix}`)
      )
      await assign([...reads, ...writes])
      const visible = await query(
        staff.request,
        "audit",
        `?type=PurchaseRecord&id=${primary.id}&pageSize=100`
      )
      assert.ok(
        JSON.stringify(visible).includes(`Settlement finance ${suffix}`)
      )
      const oldFields = fieldsFor("PurchaseRecord", "create").filter(
        (f) => !f.startsWith("settlement.")
      )
      await assign([
        ...reads,
        { subject: "Vehicle", action: "create", fields: ["*"] },
        { subject: "PurchaseRecord", action: "create", fields: oldFields },
      ])
      const before = await snapshot()
      await command(
        staff.request,
        "recordPurchase",
        envelope(input("missing-leaf"), [ref(supplier, "Supplier")]),
        403
      )
      assert.equal(await snapshot(), before)
      await restore()
    }
  )
  await group(
    "same/different-key recipient pay and channel/edit races serialize once",
    async () => {
      let row = await clear(await create("race"))
      const body = envelope(
        { cycleId: row.id, recipient: "SETTLEMENT", payment: payment("1000") },
        refs(row)
      )
      const same = await Promise.all([
        command(a.request, "payPurchase", body),
        command(a.request, "payPurchase", body),
      ])
      assert.equal(same[0].commandId, same[1].commandId)
      assert.equal(same.filter((r) => r.replayed).length, 1)
      row = await current(row.id)
      for (const names of [
        ["payPurchase", "payPurchase"],
        ["payPurchase", "editPurchase"],
      ]) {
        const responses: APIResponse[] = await Promise.all(
          names.map((name, index) =>
            (index ? b.request : a.request).post(`/api/v1/commands/${name}`, {
              headers: { Origin: origin },
              data:
                name === "payPurchase"
                  ? envelope(
                      {
                        cycleId: row.id,
                        recipient: "SETTLEMENT",
                        payment: payment("100"),
                      },
                      refs(row)
                    )
                  : envelope(
                      {
                        cycleId: row.id,
                        reason: "Concurrent actual terms",
                        patch: { settlement: { ...bank, amount: "7000" } },
                        cashCorrections: [],
                      },
                      refs(row, true)
                    ),
            })
          )
        )
        assert.deepEqual(responses.map((r) => r.status()).sort(), [200, 409])
        row = await current(row.id)
      }
      const before = await snapshot()
      await command(
        a.request,
        "payPurchase",
        { ...body, input: { ...body.input, payment: payment("1001") } },
        409
      )
      assert.equal(await snapshot(), before)
    }
  )
  await group(
    "every essential settlement creation write/final constraint rolls back, exact key recovers",
    async () => {
      for (const [table, timing, predicate] of [
        ["Vehicle", "BEFORE INSERT", "true"],
        ["PurchaseRecord", "BEFORE INSERT", "true"],
        ["LeasePurchaseDetail", "BEFORE INSERT", "true"],
        ["PurchasePayment", "BEFORE INSERT", "NEW.category='SETTLEMENT'"],
        ["CycleBasisVersion", "BEFORE INSERT", "true"],
        ["MileageReading", "BEFORE INSERT", "true"],
        ["StatusEvent", "BEFORE INSERT", "true"],
        ["CommandReceipt", "BEFORE INSERT", "true"],
        ["BusinessSequence", "BEFORE UPDATE", "true"],
        ["AuditEntry", "BEFORE INSERT", "NEW.\"entityType\"='PurchaseRecord'"],
        ["AuditEntry", "BEFORE INSERT", "NEW.\"entityType\"='Vehicle'"],
        [
          "EntityReadVersion",
          "BEFORE INSERT",
          "NEW.\"entityType\"='PurchaseRecord'",
        ],
        ["EntityReadVersion", "BEFORE INSERT", "NEW.\"entityType\"='Vehicle'"],
        ["PurchaseRecord", "AFTER INSERT", "true"],
      ]) {
        const body = envelope(
            input(`fault-${table}-${randomUUID().slice(0, 6)}`),
            [ref(supplier, "Supplier")]
          ),
          before = await snapshot()
        try {
          await db.query(
            `CREATE FUNCTION vamotors.settlement_test_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${predicate} THEN RAISE EXCEPTION 'SYNTHETIC_SETTLEMENT_FAULT'; END IF; RETURN NEW; END $$`
          )
          await db.query(
            timing === "AFTER INSERT"
              ? `CREATE CONSTRAINT TRIGGER settlement_test_fault AFTER INSERT ON vamotors."${table}" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vamotors.settlement_test_fault()`
              : `CREATE TRIGGER settlement_test_fault ${timing} ON vamotors."${table}" FOR EACH ROW EXECUTE FUNCTION vamotors.settlement_test_fault()`
          )
          await command(a.request, "recordPurchase", body, 500)
          assert.equal(await snapshot(), before)
        } finally {
          await db.query(
            `DROP TRIGGER IF EXISTS settlement_test_fault ON vamotors."${table}"`
          )
          await db.query(
            "DROP FUNCTION IF EXISTS vamotors.settlement_test_fault()"
          )
        }
        const result = await command(a.request, "recordPurchase", body, 201)
        cycles.push(result.result.id)
        const after = await snapshot()
        assert.equal(
          (await command(a.request, "recordPurchase", body)).replayed,
          true
        )
        assert.equal(await snapshot(), after)
      }
    }
  )
  await group(
    "detail UPDATE and every essential correction write roll back together with exact-key recovery",
    async () => {
      let row = await create("edit-faults")
      for (const [table, timing, predicate] of [
        ["LeasePurchaseDetail", "BEFORE UPDATE", "true"],
        ["PurchaseRecord", "BEFORE UPDATE", "true"],
        ["PurchasePayment", "BEFORE INSERT", "true"],
        ["CycleBasisVersion", "BEFORE INSERT", "true"],
        ["CommandReceipt", "BEFORE INSERT", "true"],
        ["BusinessSequence", "BEFORE UPDATE", "true"],
        ["AuditEntry", "BEFORE INSERT", "NEW.\"entityType\"='PurchaseRecord'"],
        ["AuditEntry", "BEFORE INSERT", "NEW.\"entityType\"='Vehicle'"],
        [
          "EntityReadVersion",
          "BEFORE INSERT",
          "NEW.\"entityType\"='PurchaseRecord'",
        ],
        ["EntityReadVersion", "BEFORE INSERT", "NEW.\"entityType\"='Vehicle'"],
        ["PurchaseRecord", "AFTER UPDATE", "true"],
      ]) {
        const original = row.payments.find(
          (p) =>
            p.category === "SETTLEMENT" &&
            !p.reversalOf &&
            !row.payments.some((r) => r.reversalOf === p.id)
        )!
        const body = envelope(
            {
              cycleId: row.id,
              reason: "Atomic current settlement correction",
              patch: {
                settlement: {
                  ...bank,
                  amount: (BigInt(row.settlement!.amount) + 100n).toString(),
                },
              },
              cashCorrections: [
                {
                  paymentId: original.id,
                  reason: "Exact original accounting correction",
                  replacement: payment(
                    (BigInt(original.amount) - 1n).toString()
                  ),
                },
              ],
            },
            refs(row, true)
          ),
          before = await snapshot()
        try {
          await db.query(
            `CREATE FUNCTION vamotors.settlement_test_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${predicate} THEN RAISE EXCEPTION 'SYNTHETIC_SETTLEMENT_EDIT_FAULT'; END IF; RETURN NEW; END $$`
          )
          await db.query(
            timing === "AFTER UPDATE"
              ? `CREATE CONSTRAINT TRIGGER settlement_test_fault AFTER UPDATE ON vamotors."${table}" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vamotors.settlement_test_fault()`
              : `CREATE TRIGGER settlement_test_fault ${timing} ON vamotors."${table}" FOR EACH ROW EXECUTE FUNCTION vamotors.settlement_test_fault()`
          )
          await command(a.request, "editPurchase", body, 500)
          assert.equal(await snapshot(), before)
        } finally {
          await db.query(
            `DROP TRIGGER IF EXISTS settlement_test_fault ON vamotors."${table}"`
          )
          await db.query(
            "DROP FUNCTION IF EXISTS vamotors.settlement_test_fault()"
          )
        }
        await command(a.request, "editPurchase", body)
        row = await current(row.id)
      }
    }
  )
  await group(
    "seller reference reauthorization cannot disappear when replay sees the corrected current FK",
    async () => {
      let row = await clear(await create("seller-replay"))
      await assign([
        ...reads,
        { subject: "PurchaseRecord", action: "update", fields: ["*"] },
      ])
      const body = envelope(
        {
          cycleId: row.id,
          reason: "Actual supplier correction",
          patch: { seller: { type: "SUPPLIER", id: secondSupplier.id } },
          cashCorrections: [],
        },
        [...refs(row, true), ref(secondSupplier, "Supplier")]
      )
      await command(staff.request, "editPurchase", body)
      row = await current(row.id)
      assert.equal(row.seller.id, secondSupplier.id)
      await assign([
        ...reads.filter((g) => g.subject !== "Supplier"),
        { subject: "Supplier", action: "read", fields: ["id"] },
        { subject: "PurchaseRecord", action: "update", fields: ["*"] },
      ])
      const before = await snapshot()
      await command(staff.request, "editPurchase", body, 403)
      assert.equal(await snapshot(), before)
      await restore()
    }
  )
  await group(
    "observed sequence-lock revocation denies both pending pay and committed replay",
    async () => {
      let row = await clear(await create("revocation"))
      const grants: Grant[] = [
        ...reads,
        { subject: "PurchaseRecord", action: "pay", fields: ["*"] },
      ]
      await assign(grants)
      const body = envelope(
        { cycleId: row.id, recipient: "SETTLEMENT", payment: payment("100") },
        refs(row)
      )
      await command(staff.request, "payPurchase", body)
      row = await current(row.id)
      for (const mode of ["execution", "replay"]) {
        await assign(grants)
        const blocker = await db.connect()
        try {
          await blocker.query("BEGIN")
          await blocker.query(
            'SELECT value FROM vamotors."BusinessSequence" WHERE id=1 FOR UPDATE'
          )
          const waiting = staff.request.post("/api/v1/commands/payPurchase", {
            data:
              mode === "replay"
                ? body
                : envelope(
                    {
                      cycleId: row.id,
                      recipient: "SETTLEMENT",
                      payment: payment("100"),
                    },
                    refs(row)
                  ),
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
              { timeout: 2000 }
            )
            .toBeGreaterThan(0)
          await assign(reads)
          const before = await snapshot()
          await blocker.query("COMMIT")
          assert.equal((await waiting).status(), 403)
          assert.equal(await snapshot(), before)
        } finally {
          await blocker.query("ROLLBACK")
          blocker.release()
          await restore()
        }
      }
    }
  )
  await group(
    "runtime least privilege and immutable retained detail/payment/source owners",
    async () => {
      const before = await snapshot()
      for (const sql of [
        `DELETE FROM vamotors."LeasePurchaseDetail"`,
        `TRUNCATE vamotors."LeasePurchaseDetail"`,
        `UPDATE vamotors."LeasePurchaseDetail" SET "purchaseRecordId"='${randomUUID()}'`,
        `UPDATE vamotors."PurchasePayment" SET category='SELLER'`,
        `DELETE FROM vamotors."PurchasePayment"`,
        `UPDATE vamotors."PurchaseRecord" SET "acquisitionKind"='TRADE_IN'`,
        `ALTER TABLE vamotors."LeasePurchaseDetail" ADD COLUMN forbidden text`,
        `UPDATE vamotors."LeasePurchaseDetail" SET amount=1`,
      ])
        await assert.rejects(restricted.query(sql))
      assert.equal(await snapshot(), before)
    }
  )
  await group(
    "real settlement acquisition UI, active-SW committed response loss and byte-identical retry",
    async () => {
      await mobile.goto("/purchases")
      await mobile.waitForFunction(
        () => navigator.serviceWorker.controller?.state === "activated"
      )
      evidence.mobileServiceWorker = await mobile.evaluate(() => ({
        controller: navigator.serviceWorker.controller?.scriptURL,
        state: navigator.serviceWorker.controller?.state,
      }))
      await mobile
        .getByRole("button", { name: "New paid acquisition", exact: true })
        .click()
      await mobile
        .getByLabel("Search active suppliers by name")
        .fill(`Settlement supplier ${suffix}-0`)
      await mobile
        .getByLabel("Supplier *", { exact: true })
        .selectOption(supplier.id)
      for (const [label, value] of [
        ["Engine number", `UI-E-${suffix}`],
        ["Chassis number", `UI-C-${suffix}`],
        ["Make", "Synthetic UI"],
        ["Model", "Settlement"],
        ["Year", "2026"],
        ["Colour", "Blue"],
        ["Actual purchase date", "2026-10-01"],
        ["Mileage date", "2026-10-01"],
      ])
        await mobile.getByLabel(label, { exact: false }).fill(value)
      await mobile
        .getByLabel("Purchase type", { exact: false })
        .selectOption("LEASE_SETTLEMENT")
      await mobile
        .getByLabel("Settlement institution type")
        .selectOption("BANK")
      await mobile
        .getByLabel("Settlement institution name")
        .fill("UI synthetic bank")
      await mobile
        .getByLabel("Settlement reference", { exact: false })
        .fill("UI-SETTLEMENT")
      await mobile.getByLabel("Institution amount (major units)").fill("60.00")
      await mobile.getByLabel("Cash to seller (major units)").fill("40.00")
      await expect(
        mobile.getByText("Computed purchase total: 100.00", { exact: true })
      ).toBeVisible()
      await expect(
        mobile.getByLabel("Paid purchase price (major units)")
      ).toHaveCount(0)
      const bodies: string[] = []
      let committed!: Applied
      await b.route("**/api/v1/commands/recordPurchase", async (route) => {
        bodies.push(route.request().postData()!)
        if (bodies.length === 1) {
          const response = await route.fetch()
          assert.equal(response.status(), 201)
          committed = await response.json()
          await route.abort("failed")
        } else await route.continue()
      })
      await mobile
        .getByRole("button", {
          name: "Record fully paid acquisition",
          exact: true,
        })
        .focus()
      await mobile.keyboard.press("Enter")
      await expect(
        mobile.getByRole("button", {
          name: "Retry unchanged acquisition",
          exact: true,
        })
      ).toBeVisible()
      const saved = await current(committed.result.id)
      assert.equal(saved.payments.length, 2)
      cycles.push(saved.id)
      const before = await snapshot()
      await mobile
        .getByRole("button", {
          name: "Retry unchanged acquisition",
          exact: true,
        })
        .click()
      await mobile.waitForURL(`**/purchases/${saved.id}`)
      assert.equal(bodies.length, 2)
      assert.equal(bodies[0], bodies[1])
      assert.equal(await snapshot(), before)
      assert.equal("purchasePrice" in JSON.parse(bodies[0]).input, false)
      await b.unroute("**/api/v1/commands/recordPurchase")
      assert.equal(
        await mobile.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        ),
        true
      )
      await mobile.screenshot({
        path: join(root, `settlement-${suffix}-mobile-ui.png`),
        fullPage: true,
      })
      await page.goto(`/purchases/${saved.id}`)
      await page
        .getByRole("button", { name: "Correct purchase terms", exact: true })
        .click()
      await page
        .getByLabel("Purchase notes", { exact: true })
        .fill("Retained stale settlement draft")
      await page
        .getByLabel("Mandatory correction reason")
        .fill("Explicit stale correction after review")
      await edit(saved, { notes: "Concurrent visible correction" })
      const correctionBodies: string[] = []
      await a.route("**/api/v1/commands/editPurchase", async (route) => {
        correctionBodies.push(route.request().postData()!)
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
      await page
        .getByRole("button", { name: "Reload current cycle", exact: true })
        .click()
      await page
        .getByRole("button", {
          name: "Reconfirm retained draft as new money intent",
          exact: true,
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
      assert.equal(correctionBodies.length, 2)
      assert.notEqual(
        JSON.parse(correctionBodies[0]).idempotencyKey,
        JSON.parse(correctionBodies[1]).idempotencyKey
      )
      assert.equal(
        JSON.parse(correctionBodies[1]).input.patch.notes,
        "Retained stale settlement draft"
      )
      await a.unroute("**/api/v1/commands/editPurchase")
    }
  )
  await group(
    "permission revision and logout purge settlement drafts rather than persisting private inputs",
    async () => {
      const grants: Grant[] = [
        ...reads,
        { subject: "PurchaseRecord", action: "update", fields: ["*"] },
      ]
      await assign(grants)
      await limited.goto(`/purchases/${primary.id}`)
      await limited
        .getByRole("button", { name: "Correct purchase terms", exact: true })
        .click()
      await limited
        .getByLabel("Purchase notes", { exact: true })
        .fill("PRIVATE_SETTLEMENT_DRAFT")
      await assign(reads)
      await limited.evaluate(() =>
        window.dispatchEvent(new Event("auth-check"))
      )
      await expect(
        limited.getByLabel("Purchase notes", { exact: true })
      ).toHaveCount(0)
      await assign(grants)
      await limited.goto(`/purchases/${primary.id}`)
      await limited
        .getByRole("button", { name: "Correct purchase terms", exact: true })
        .click()
      await limited
        .getByLabel("Purchase notes", { exact: true })
        .fill("PRIVATE_SETTLEMENT_LOGOUT")
      await limited.getByRole("button", { name: "Logout", exact: true }).click()
      await limited.waitForURL(/\/login(?:\?|$)/)
      await login(limited, "SECOND")
      await limited.goto(`/purchases/${primary.id}`)
      await expect(
        limited.getByLabel("Purchase notes", { exact: true })
      ).toHaveCount(0)
      assert.equal(
        await limited.evaluate(() =>
          JSON.stringify({ ...localStorage, ...sessionStorage }).includes(
            "PRIVATE_SETTLEMENT"
          )
        ),
        false
      )
      await restore()
    }
  )
  await group(
    "accepted compound upload gates, genuine final HTTP bytes, app/PG restart and fresh-login reads",
    async () => {
      const csv = Buffer.from(
          "name,value\nSynthetic settlement retention,123\n"
        ),
        sha256 = createHash("sha256").update(csv).digest("hex")
      const batch = await command(
        a.request,
        "stageImport",
        envelope({
          types: ["SUPPLIERS"],
          namespace: `settlement-retention-${suffix}`,
        }),
        201
      )
      const initialized = await a.request.post("/api/v1/commands/initUpload", {
        headers: { Origin: origin },
        data: envelope(
          {
            target: { type: "IMPORT_BATCH", id: batch.result.id },
            purpose: "IMPORT_SOURCE",
            filename: "settlement-retained.csv",
            contentType: "text/csv",
            size: csv.length,
            sha256,
          },
          [{ type: "ImportBatch", id: batch.result.id, revision: 1 }]
        ),
      })
      assert.equal(initialized.status(), 201)
      const upload = await initialized.json()
      assert.equal(
        (
          await a.request.put(upload.putUrl, {
            headers: { origin, ...upload.requiredHeaders },
            data: csv,
          })
        ).status(),
        204
      )
      const completed = await command(
        a.request,
        "completeUpload",
        envelope({ uploadId: upload.uploadId }, [
          {
            type: "UploadIntent",
            id: upload.uploadId,
            revision: upload.revision,
          },
          { type: "ImportBatch", id: batch.result.id, revision: 1 },
        ])
      )
      const download = async (client: APIRequestContext) => {
        const d = await query<{ url: string; sha256: string; size: number }>(
          client,
          "download",
          `?attachmentId=${completed.result.id}`
        )
        const response = await client.get(d.url)
        assert.equal(response.status(), 200)
        assert.equal(
          createHash("sha256")
            .update(await response.body())
            .digest("hex"),
          sha256
        )
        assert.equal(d.sha256, sha256)
        assert.equal(d.size, csv.length)
      }
      await download(a.request)
      const metadata = (
        await db.query(
          'SELECT to_jsonb(t) AS row FROM vamotors."Attachment" t ORDER BY id'
        )
      ).rows
      const before = await snapshot()
      await stop()
      await Promise.all([db.end(), restricted.end(), monitor.end()])
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
      assert.deepEqual(
        (
          await db.query(
            'SELECT to_jsonb(t) AS row FROM vamotors."Attachment" t ORDER BY id'
          )
        ).rows,
        metadata
      )
      const fresh = await browser.newContext({ baseURL: origin })
      const freshPage = await fresh.newPage()
      await login(freshPage, "SECOND")
      for (const id of cycles)
        assert.equal((await current(id, fresh.request)).id, id)
      await download(fresh.request)
      await fresh.close()
      evidence.retention = {
        attachmentId: completed.result.id,
        sha256,
        size: csv.length,
        businessSnapshotHash: createHash("sha256").update(before).digest("hex"),
      }
    }
  )
  await seal("PASS")
} catch (error) {
  await seal("FAIL", error instanceof Error ? error.message : "UNKNOWN")
  console.error(
    `FAIL ${stage}: ${error instanceof Error ? error.message : "UNKNOWN"}`
  )
  process.exitCode = 1
} finally {
  try {
    await restore()
  } catch {
    console.error("Staff restore unavailable; retained state requires review")
    process.exitCode = 1
  }
  await browser.close()
  await stop()
  await Promise.all([db.end(), restricted.end(), monitor.end()])
}
