/** Only local production HTTP/PG fixtures; never a simulated authorization seam. */
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { spawn, execFileSync, type ChildProcess } from "node:child_process"
import { once } from "node:events"
import { createServer } from "node:net"
import { join } from "node:path"
import { writeFile } from "node:fs/promises"
import { createWriteStream, writeFileSync, type WriteStream } from "node:fs"
import { request, type APIRequestContext } from "@playwright/test"
import pg from "pg"
import { privateEnvironment } from "../../scripts/private-environment"
import type {
  Applied,
  Dependency,
  PurchaseCycleDTO,
} from "../../.planning/implementation/contracts/api"

export const envelope = (
  input: unknown,
  expected: Dependency[] = [],
  idempotencyKey = randomUUID()
) => ({ schemaVersion: 1, idempotencyKey, expected, input })
export const ref = (
  row: { id: string; revision: number },
  type: Dependency["type"] = "PurchaseRecord"
): Dependency => ({ type, id: row.id, revision: row.revision })
export const refs = (row: PurchaseCycleDTO, name: string): Dependency[] =>
  name === "editVehicle"
    ? [{ type: "Vehicle", id: row.vehicleId, revision: row.identityRevision }]
    : [
        ref(row),
        ...(name === "addMileage"
          ? [
              {
                type: "Vehicle" as const,
                id: row.vehicleId,
                revision: row.identityRevision,
              },
            ]
          : []),
      ]
export async function fixture(
  root: string,
  source = process.cwd(),
  startupTimeout = 20_000
) {
  process.umask(0o077)
  const runId = randomUUID().slice(0, 8)
  const runtime = await privateEnvironment(join(root, "runtime.env")),
    migration = await privateEnvironment(join(root, "migration.env")),
    accounts = await privateEnvironment(join(root, "accounts.env")),
    cluster = await privateEnvironment(join(root, "cluster.env"))
  assert.equal(cluster.PROJECT, source)
  assert.equal(runtime.APP_ENV, "local")
  assert.equal(new URL(runtime.DATABASE_URL!).hostname, "127.0.0.1")
  let db = new pg.Pool({ connectionString: migration.DIRECT_URL, max: 3 }),
    restricted = new pg.Pool({ connectionString: runtime.DATABASE_URL, max: 1 })
  const transcript: unknown[] = [],
    apps: unknown[] = []
  const socket = createServer().listen(0, "127.0.0.1")
  await once(socket, "listening")
  const address = socket.address()
  assert.ok(address && typeof address !== "string")
  const port = address.port,
    origin = `http://127.0.0.1:${port}`
  await new Promise<void>((resolve) => socket.close(() => resolve()))
  let server: ChildProcess | undefined
  let appLogs: WriteStream[] = []
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
        cwd: source,
        env: {
          ...process.env,
          ...runtime,
          NODE_ENV: "production",
          APP_ORIGIN: origin,
          BETTER_AUTH_URL: origin,
        },
        stdio: ["ignore", "pipe", "pipe"],
      }
    )
    apps.push({ pid: server.pid, origin, started: new Date().toISOString() })
    appLogs = ["stdout", "stderr"].map((name) =>
      createWriteStream(join(root, `cycle-edits-app-${server!.pid}.${name}`), {
        mode: 0o600,
        flags: "wx",
      })
    )
    server.stdout!.pipe(appLogs[0])
    server.stderr!.pipe(appLogs[1])
    writeFileSync(
      join(root, `cycle-edits-processes-${runId}.json`),
      JSON.stringify(
        {
          source,
          head: execFileSync("git", ["rev-parse", "HEAD"], {
            cwd: source,
            encoding: "utf8",
          }).trim(),
          apps,
        },
        null,
        2
      ),
      { mode: 0o600 }
    )
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(Error("START_TIMEOUT")),
        startupTimeout
      )
      server!.once("exit", () => {
        clearTimeout(timer)
        reject(Error("EARLY_EXIT"))
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
      const child = server,
        end = once(child, "exit")
      child.kill("SIGTERM")
      const timer = setTimeout(() => child.kill("SIGKILL"), 5000)
      await end
      clearTimeout(timer)
      apps.push({
        pid: child.pid,
        code: child.exitCode,
        signal: child.signalCode,
        stopped: new Date().toISOString(),
      })
      await Promise.all(
        appLogs.map((log) =>
          log.writableFinished ? Promise.resolve() : once(log, "finish")
        )
      )
      await writeFile(
        join(root, `cycle-edits-processes-${runId}.json`),
        JSON.stringify({ source, apps }, null, 2),
        { mode: 0o600 }
      )
    }
    server = undefined
  }
  async function login(who: "ADMIN" | "SECOND" | "STAFF") {
    const client = await request.newContext({ baseURL: origin }),
      response = await client.post("/api/auth/sign-in/email", {
        headers: { Origin: origin },
        data: {
          email: accounts[`BOOTSTRAP_${who}_EMAIL`],
          password: accounts[`BOOTSTRAP_${who}_PASSWORD`],
        },
      })
    assert.equal(response.status(), 200)
    return client
  }
  async function query<T>(
    client: APIRequestContext,
    name: string,
    params = ""
  ): Promise<T> {
    const r = await client.get(`/api/v1/queries/${name}${params}`),
      value = await r.json()
    transcript.push({ kind: "query", name, params, status: r.status(), value })
    assert.equal(r.status(), 200, `${name}: ${JSON.stringify(value)}`)
    assert.match(r.headers()["cache-control"], /no-store/)
    return value.data
  }
  async function command(
    client: APIRequestContext,
    name: string,
    body: unknown,
    status = 200
  ): Promise<Applied> {
    const r = await client.post(`/api/v1/commands/${name}`, {
        data: body,
        headers: { Origin: origin },
      }),
      value = await r.json()
    transcript.push({ kind: "command", name, body, status: r.status(), value })
    assert.equal(r.status(), status, `${name}: ${JSON.stringify(value)}`)
    assert.match(r.headers()["cache-control"], /no-store/)
    return value
  }
  async function snapshot(
    tables = [
      "Vehicle",
      "PurchaseRecord",
      "MileageReading",
      "PurchasePayment",
      "VehicleCost",
      "CostPayment",
      "CycleBasisVersion",
      "StatusEvent",
      "AuditEntry",
      "EntityReadVersion",
      "CommandReceipt",
      "BusinessSequence",
      "Quote",
    ]
  ) {
    const rows: Record<string, unknown> = {}
    for (const t of tables)
      rows[t] = (
        await db.query(
          `SELECT to_jsonb(t) row FROM vamotors."${t}" t ORDER BY id`
        )
      ).rows
    return JSON.stringify(rows)
  }
  async function close() {
    await stop()
    await writeFile(
      join(root, `cycle-edits-http-${runId}.json`),
      JSON.stringify({ origin, source, apps, transcript }, null, 2),
      { mode: 0o600 }
    )
    await db.end()
    await restricted.end()
  }
  async function restart() {
    await stop()
    await db.end()
    await restricted.end()
    const results = []
    for (const action of ["stop", "start"])
      results.push(
        execFileSync(
          process.execPath,
          ["--import", "tsx", "scripts/local-postgres.ts", action],
          {
            cwd: source,
            env: { ...process.env, VAMOTORS_LOCAL_DIR: root },
            encoding: "utf8",
          }
        )
      )
    await writeFile(
      join(root, `cycle-edits-restart-${runId}-${apps.length}.txt`),
      results.join("\n"),
      {
        mode: 0o600,
      }
    )
    db = new pg.Pool({ connectionString: migration.DIRECT_URL, max: 3 })
    restricted = new pg.Pool({ connectionString: runtime.DATABASE_URL, max: 1 })
    await start()
  }
  return {
    root,
    source,
    runtime,
    cluster,
    get db() {
      return db
    },
    get restricted() {
      return restricted
    },
    origin,
    start,
    stop,
    restart,
    login,
    query,
    command,
    snapshot,
    close,
  }
}

/** Real preexisting graph used by both the new campaign and genuine upgrade. */
export async function seed(
  f: Awaited<ReturnType<typeof fixture>>,
  admin: APIRequestContext,
  suffix: string
) {
  const cmd = (
    name: string,
    input: unknown,
    expected: Dependency[] = [],
    status = 200
  ) => f.command(admin, name, envelope(input, expected), status)
  const settings = await f.query<{ id: string; revision: number }>(
    admin,
    "settings"
  )
  const supplier = await cmd(
    "createDirectoryParty",
    {
      type: "SUPPLIER",
      values: {
        name: `Cycle edits ${suffix}`,
        category: "COMPANY",
        contacts: [
          {
            name: "Synthetic contact",
            phone: "0112345678",
            role: "Sales",
            primary: true,
          },
        ],
      },
    },
    [],
    201
  )
  await cmd(
    "createCustomer",
    {
      fullName: `Cycle edits ${suffix}`,
      callingName: "Retained",
      nicOrPassport: `EDIT-${suffix}`,
      address: "Synthetic retained address",
      phone: "0112345678",
    },
    [],
    201
  )
  const finance = await cmd(
    "createFinanceCompany",
    {
      name: `Cycle edit finance ${suffix}`,
      contacts: [
        {
          name: "Finance contact",
          phone: "0112345678",
          role: "Processing",
          primary: true,
        },
      ],
      policy: {
        path: "APPLICATION",
        commission: { basis: "FINANCED_PRINCIPAL", rateBps: 100 },
        processingFee: "250000",
        reconciliationMethod: "PERIOD_NOTICE",
      },
    },
    [ref(settings, "Settings")],
    201
  )
  const sheet = await cmd(
    "publishRates",
    {
      companyId: finance.result.id,
      make: "Edits",
      model: suffix,
      year: 2026,
      validFrom: "2026-01-01",
      validThrough: "2027-12-31",
      maximum: "120000",
      cards: [{ principal: "100000", months: 12, installment: "9000" }],
    },
    [ref(finance.result, "FinanceCompany")],
    201
  )
  const vehicle = {
    make: "Edits",
    model: suffix,
    year: 2026,
    description: "External quote, not owned inventory",
  }
  const comparison = await admin.post("/api/v1/queries/compare", {
    headers: { Origin: f.origin },
    data: {
      vehicle,
      principal: "100000",
      months: 12,
      asOf: new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Colombo",
      }).format(new Date()),
    },
  })
  assert.equal(comparison.status(), 200)
  const option = (await comparison.json()).data.find(
    (o: { companyId: string }) => o.companyId === finance.result.id
  )
  assert.equal(option.status, "SUPPORTED")
  await cmd(
    "selectQuote",
    {
      sheetId: sheet.result.id,
      cardId: option.cardId,
      vehicle,
      charges: [{ category: "Synthetic actual charge", amount: "500" }],
    },
    [
      ref(sheet.result, "RateSheet"),
      ref(finance.result, "FinanceCompany"),
      ref(settings, "Settings"),
    ],
    201
  )
  const purchase = await cmd(
    "recordPurchase",
    purchaseInput(supplier.result.id, suffix, "seed"),
    [ref(supplier.result, "Supplier")],
    201
  )
  const current = () =>
    f.query<PurchaseCycleDTO>(
      admin,
      "purchase",
      `?cycleId=${purchase.result.id}`
    )
  let row = await current()
  const cost = await cmd(
    "addCost",
    {
      cycleId: row.id,
      category: "Transport",
      description: "Retained invoice",
      amount: "500",
      incurredDate: "2026-10-02",
      payment: { amount: "200", date: "2026-10-03", method: "CASH" },
    },
    [ref(row)],
    201
  )
  row = await current()
  const child = row.costs.find((c) => c.id === cost.result.id)!
  await cmd(
    "reversePayment",
    {
      sourceType: "COST",
      sourceId: child.id,
      paymentId: child.payments[0].id,
      replacement: { amount: "100", date: "2026-10-03", method: "CASH" },
      reason: "Retained accounting correction, not refund",
    },
    [ref(row), ref(child, "VehicleCost")]
  )
  row = await current()
  await cmd(
    "receiveStock",
    {
      cycleId: row.id,
      date: "2026-10-03",
      disposition: { kind: "HOLD", reason: "Retained held stock" },
    },
    [ref(row)]
  )
  return {
    supplier: supplier.result,
    cycle: await current(),
    settings,
    quoteCount: (await f.db.query('SELECT count(*) FROM vamotors."Quote"'))
      .rows[0].count,
  }
}
export function purchaseInput(
  supplierId: string,
  suffix: string,
  tag: string,
  reading = 0,
  date = "2026-10-01"
) {
  return {
    supplierId,
    vehicle: {
      engineNumber: `EDIT-E-${suffix}-${tag}`,
      chassisNumber: `EDIT-C-${suffix}-${tag}`,
      make: "CycleEdits",
      model: suffix,
      year: 2026,
      colour: "Blue",
      fuelType: "PETROL",
      transmission: "AUTOMATIC",
      vin: `VIN-${tag}`,
      crNumber: `CR-${tag}`,
      notes: "Original physical notes",
    },
    purchaseType: "BRAND_NEW",
    purchasePrice: "10000",
    listedPrice: "15000",
    purchaseDate: "2026-10-01",
    mileage: { reading, date },
    paymentMethod: "CASH",
  }
}
