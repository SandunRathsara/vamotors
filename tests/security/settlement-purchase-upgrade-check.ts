/** Genuine exact-parent NONEMPTY retention. Usage: <root> prepare|verify <parentSHA>.
 * Run this candidate runner against an owned PROJECT checked out at the parent
 * for prepare; upgrade that same PROJECT/cluster, then verify (and repeat).
 */
import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { readFile, writeFile, readdir } from "node:fs/promises"
import { execFileSync, spawn, type ChildProcess } from "node:child_process"
import { once } from "node:events"
import { createServer } from "node:net"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { request, type APIRequestContext } from "@playwright/test"
import pg from "pg"
import { privateEnvironment } from "../../scripts/private-environment"
import { canonical } from "../../lib/server/idempotency"
import { expanded, grantSchema } from "../../lib/server/permissions"
import { fixture as localFixture } from "./cycle-edits-fixture"
import {
  seedFiles,
  verifyFiles,
  fileBytes,
  type RetainedFiles,
} from "./cycle-edits-files"
import type {
  Applied,
  Dependency,
  Grant,
  PurchaseCycleDTO,
  DownloadDTO,
} from "../../.planning/implementation/contracts/api"

process.umask(0o077)
const [root, mode, parentSHA] = process.argv.slice(2)
assert.ok(
  root &&
    ["prepare", "verify"].includes(mode) &&
    /^[a-f0-9]{40}$/.test(parentSHA ?? "")
)
const runtime = await privateEnvironment(join(root, "runtime.env")),
  migration = await privateEnvironment(join(root, "migration.env")),
  cluster = await privateEnvironment(join(root, "cluster.env")),
  accounts = await privateEnvironment(join(root, "accounts.env"))
const project = cluster.PROJECT!
assert.ok(
  project &&
    runtime.APP_ENV === "local" &&
    new URL(runtime.DATABASE_URL!).hostname === "127.0.0.1"
)
const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: project, encoding: "utf8" }).trim()
const head = git("rev-parse", "HEAD")
assert.equal(
  git("status", "--porcelain"),
  "",
  "PROJECT must be clean, not a mutable candidate"
)
assert.equal(git("rev-parse", `${parentSHA}^{commit}`), parentSHA)
execFileSync("git", ["merge-base", "--is-ancestor", parentSHA, head], {
  cwd: project,
  stdio: "pipe",
})
let db = new pg.Pool({ connectionString: migration.DIRECT_URL, max: 1 })
const record = join(root, `settlement-upgrade-${parentSHA}.json`)
const hash = (value: unknown) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : canonical(value))
    .digest("hex")
type Inventory = Record<string, Record<string, readonly string[]>>
type Snapshot = {
  source: {
    sha: string
    tree: string
    registryVersion: number
    registry: Inventory
    migrations: Record<string, string>
  }
  rows: Record<string, unknown[]>
  migrations: { migration_name: string; checksum: string }[]
  grants: { roleId: string; rule: Grant; systemKey: string | null }[]
  owners: { name: string; owner: string }[]
  privileges: Record<string, string>[]
  functions: {
    name: string
    body: string
    owner: number
    acl: unknown
    securityDefiner: boolean
    config: unknown
  }[]
  fixture: {
    purchaseId: string
    attachmentId: string
    sha256: string
    size: number
    files: RetainedFiles
    bytes: Awaited<ReturnType<typeof fileBytes>>
  }
}
async function source() {
  const value = JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        `import {registry,registryVersion} from ${JSON.stringify(pathToFileURL(join(project, "lib/server/permissions.ts")).href)};console.log(JSON.stringify({registry,registryVersion}))`,
      ],
      { cwd: project, encoding: "utf8" }
    )
  ) as { registry: Inventory; registryVersion: number }
  const migrations: Record<string, string> = {}
  for (const directory of (
    await readdir(join(project, "prisma/migrations"), { withFileTypes: true })
  )
    .filter((e) => e.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name)))
    migrations[directory.name] = hash(
      await readFile(
        join(project, "prisma/migrations", directory.name, "migration.sql"),
        "utf8"
      )
    )
  return {
    sha: head,
    tree: git("rev-parse", "HEAD^{tree}"),
    ...value,
    migrations,
  }
}
async function snapshot(fixture: Snapshot["fixture"]): Promise<Snapshot> {
  const rows: Snapshot["rows"] = {}
  const tables = (
    await db.query(
      "SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='vamotors' AND c.relkind='r' AND c.relname NOT IN ('_prisma_migrations','AdminGuard','session','verification') ORDER BY c.relname"
    )
  ).rows as { name: string }[]
  for (const { name } of tables) {
    assert.match(name, /^[a-zA-Z][a-zA-Z0-9]*$/)
    const entries = (
      await db.query(
        `SELECT to_jsonb(t) AS row FROM vamotors."${name}" t ORDER BY to_jsonb(t)::text`
      )
    ).rows.map((r) => r.row)
    // Credential hashes/tokens never enter even the private evidence snapshot.
    rows[name] =
      name === "account"
        ? entries.map((r) => ({ id: r.id, hash: hash(r) }))
        : entries
  }
  return {
    source: await source(),
    rows,
    fixture,
    migrations: (
      await db.query(
        "SELECT migration_name,checksum FROM vamotors._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name"
      )
    ).rows,
    grants: (
      await db.query(
        'SELECT rp."roleId",p.rule,r."systemKey" FROM vamotors."RolePermission" rp JOIN vamotors."Permission" p ON p.id=rp."permissionId" JOIN vamotors."Role" r ON r.id=rp."roleId" ORDER BY rp."roleId",p."ruleHash"'
      )
    ).rows,
    owners: (
      await db.query(
        "SELECT c.relname AS name,pg_get_userbyid(c.relowner) AS owner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='vamotors' AND c.relkind IN ('r','v') ORDER BY c.relname"
      )
    ).rows,
    privileges: (
      await db.query(
        "SELECT table_name,column_name,privilege_type FROM information_schema.column_privileges WHERE grantee='vamotors_runtime' ORDER BY table_name,column_name,privilege_type"
      )
    ).rows,
    functions: (
      await db.query(
        "SELECT p.oid::regprocedure::text AS name,p.prosrc AS body,p.proowner AS owner,p.proacl AS acl,p.prosecdef AS \"securityDefiner\",p.proconfig AS config FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='vamotors' ORDER BY p.oid"
      )
    ).rows,
  }
}
let server: ChildProcess | undefined, client: APIRequestContext | undefined
let origin = ""
async function start() {
  const socket = createServer().listen(0, "127.0.0.1")
  await once(socket, "listening")
  const address = socket.address()
  assert.ok(address && typeof address !== "string")
  origin = `http://127.0.0.1:${address.port}`
  await new Promise<void>((resolve) => socket.close(() => resolve()))
  server = spawn(
    process.execPath,
    [
      join(project, "node_modules/next/dist/bin/next"),
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      new URL(origin).port,
    ],
    {
      cwd: project,
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
    server!.stdout!.on("data", (v) => {
      if (v.toString().includes("Ready")) {
        clearTimeout(timer)
        resolve()
      }
    })
  })
  client = await request.newContext({ baseURL: origin })
  const auth = await client.post("/api/auth/sign-in/email", {
    headers: { Origin: origin },
    data: {
      email: accounts.BOOTSTRAP_ADMIN_EMAIL,
      password: accounts.BOOTSTRAP_ADMIN_PASSWORD,
    },
  })
  assert.equal(auth.status(), 200)
}
const envelope = (input: unknown, expected: Dependency[] = []) => ({
  schemaVersion: 1,
  idempotencyKey: randomUUID(),
  expected,
  input,
})
const ref = (
  type: Dependency["type"],
  row: { id: string; revision: number }
): Dependency => ({ type, id: row.id, revision: row.revision })
async function command(
  name: string,
  input: unknown,
  expected: Dependency[] = []
) {
  const response = await client!.post(`/api/v1/commands/${name}`, {
    headers: { Origin: origin },
    data: envelope(input, expected),
  })
  assert.ok(
    response.ok(),
    `${name}:${response.status()}:${(await response.json()).error?.code}`
  )
  return response.json() as Promise<Applied>
}
async function query<T>(name: string, params = ""): Promise<T> {
  const response = await client!.get(`/api/v1/queries/${name}${params}`)
  assert.equal(response.status(), 200, name)
  return (await response.json()).data
}
async function bytes(fixture: Snapshot["fixture"]) {
  const d = await query<DownloadDTO>(
    "download",
    `?attachmentId=${fixture.attachmentId}`
  )
  const response = await client!.get(d.url)
  assert.equal(response.status(), 200)
  assert.equal(
    createHash("sha256")
      .update(await response.body())
      .digest("hex"),
    fixture.sha256
  )
  assert.equal(d.sha256, fixture.sha256)
  assert.equal(d.size, fixture.size)
}
async function populate(): Promise<Snapshot["fixture"]> {
  const suffix = randomUUID(),
    settings = await query<{ id: string; revision: number }>("settings")
  const supplier = await command("createDirectoryParty", {
    type: "SUPPLIER",
    values: {
      name: `Retained settlement parent supplier ${suffix}`,
      category: "COMPANY",
      contacts: [
        {
          name: "Retained supplier contact",
          phone: "0112345678",
          role: "Sales",
          primary: true,
        },
      ],
    },
  })
  await command("createCustomer", {
    fullName: `Retained settlement parent customer ${suffix}`,
    callingName: "Retained",
    nicOrPassport: `SETTLEMENT-PARENT-${suffix}`,
    phone: "0112345678",
    address: "Synthetic retained address",
  })
  const finance = await command(
    "createFinanceCompany",
    {
      name: `Retained parent finance ${suffix}`,
      contacts: [
        {
          name: "Retained finance contact",
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
    [ref("Settings", settings)]
  )
  await command(
    "publishRates",
    {
      companyId: finance.result.id,
      make: "Retained",
      model: suffix,
      year: 2026,
      validFrom: "2026-01-01",
      validThrough: "2027-12-31",
      maximum: "120000",
      cards: [{ principal: "100000", months: 12, installment: "9000" }],
    },
    [ref("FinanceCompany", finance.result)]
  )
  // Actual public comparison supplies card/sheet refs, not a private DB lookup.
  const compared = await client!.post("/api/v1/queries/compare", {
    headers: { Origin: origin },
    data: {
      vehicle: {
        make: "Retained",
        model: suffix,
        year: 2026,
        description: "Retained external vehicle",
      },
      principal: "100000",
      months: 12,
      asOf: "2026-10-30",
    },
  })
  assert.equal(compared.status(), 200)
  const option = (await compared.json()).data.find(
    (o: { companyId: string }) => o.companyId === finance.result.id
  )
  assert.equal(option.status, "SUPPORTED")
  await command(
    "selectQuote",
    {
      sheetId: option.sheetId,
      cardId: option.cardId,
      vehicle: {
        make: "Retained",
        model: suffix,
        year: 2026,
        description: "Retained external vehicle",
      },
      charges: [{ category: "Retained fee", amount: "500" }],
    },
    [
      ref("RateSheet", { id: option.sheetId, revision: option.sheetRevision }),
      ref("FinanceCompany", finance.result),
      ref("Settings", settings),
    ]
  )
  const vehicle = {
    engineNumber: `UPGRADE-E-${suffix}`,
    chassisNumber: `UPGRADE-C-${suffix}`,
    make: "Retained",
    model: "Settlement parent",
    year: 2026,
    colour: "Blue",
    fuelType: "PETROL",
    transmission: "AUTOMATIC",
  }
  const purchase = await command(
    "recordPurchase",
    {
      vehicle,
      supplierId: supplier.result.id,
      purchaseType: "CASH",
      purchasePrice: "10000",
      listedPrice: "15000",
      purchaseDate: "2026-10-01",
      mileage: { reading: 0, date: "2026-10-01" },
      paymentMethod: "CASH",
    },
    [ref("Supplier", supplier.result)]
  )
  let row = await query<PurchaseCycleDTO>(
    "purchase",
    `?cycleId=${purchase.result.id}`
  )
  const cost = await command(
    "addCost",
    {
      cycleId: row.id,
      category: "Transport",
      description: "Retained actual parent cost",
      amount: "500",
      incurredDate: "2026-10-02",
      payment: { amount: "200", date: "2026-10-03", method: "CASH" },
    },
    [ref("PurchaseRecord", row)]
  )
  row = await query("purchase", `?cycleId=${row.id}`)
  const child = row.costs.find((c) => c.id === cost.result.id)!
  await command(
    "reversePayment",
    {
      sourceType: "COST",
      sourceId: child.id,
      paymentId: child.payments[0].id,
      reason: "Retained actual payment correction",
      replacement: {
        amount: "100",
        date: "2026-10-04",
        method: "BANK_TRANSFER",
      },
    },
    [ref("PurchaseRecord", row), ref("VehicleCost", child)]
  )
  row = await query("purchase", `?cycleId=${row.id}`)
  await command(
    "editPurchase",
    {
      cycleId: row.id,
      reason: "Retained current parent terms",
      patch: { purchasePrice: "11000", notes: "Retained before upgrade" },
      cashCorrections: [
        {
          paymentId: row.payments[0].id,
          reason: "Retained actual P2 original-entry correction, not refund",
          replacement: { amount: "9000", date: "2026-10-01", method: "CASH" },
        },
      ],
    },
    [
      ref("PurchaseRecord", row),
      ref("Vehicle", { id: row.vehicleId, revision: row.identityRevision }),
    ]
  )
  row = await query("purchase", `?cycleId=${row.id}`)
  await command(
    "receiveStock",
    {
      cycleId: row.id,
      date: "2026-10-02",
      disposition: { kind: "HOLD", reason: "Retained physical parent receipt" },
    },
    [ref("PurchaseRecord", row)]
  )
  const dispatcher = await readFile(
    join(project, "app/api/v1/commands/[name]/route.ts"),
    "utf8"
  )
  assert.ok(
    dispatcher.includes("executeCycleEdit"),
    "Accepted current cycle-edit dispatcher is required"
  )
  row = await query("purchase", `?cycleId=${row.id}`)
  await command(
    "addMileage",
    {
      cycleId: row.id,
      mileage: {
        reading: 100,
        date: "2026-10-05",
        remark: "Retained appended parent mileage",
      },
    },
    [
      ref("PurchaseRecord", row),
      ref("Vehicle", { id: row.vehicleId, revision: row.identityRevision }),
    ]
  )
  row = await query("purchase", `?cycleId=${row.id}`)
  await command(
    "addMileage",
    {
      cycleId: row.id,
      mileage: {
        reading: 0,
        date: "2026-10-06",
        remark: "Retained zero after reasoned correction",
        decreaseReason: "Verified instrument transcription decline",
      },
    },
    [
      ref("PurchaseRecord", row),
      ref("Vehicle", { id: row.vehicleId, revision: row.identityRevision }),
    ]
  )
  row = await query("purchase", `?cycleId=${row.id}`)
  await command(
    "setListedPrice",
    {
      cycleId: row.id,
      amount: "0",
      reason: "Retained explicit zero asking price",
    },
    [ref("PurchaseRecord", row)]
  )
  row = await query("purchase", `?cycleId=${row.id}`)
  await command(
    "setListedPrice",
    {
      cycleId: row.id,
      amount: "16000",
      reason: "Retained parent asking price",
    },
    [ref("PurchaseRecord", row)]
  )
  row = await query("purchase", `?cycleId=${row.id}`)
  await command(
    "editVehicle",
    {
      vehicleId: row.vehicleId,
      values: {
        ...vehicle,
        engineNumber: `CORRECTED-E-${suffix}`,
        chassisNumber: `CORRECTED-C-${suffix}`,
        colour: "Silver",
      },
      reason: "Retained parent identity correction",
    },
    [ref("Vehicle", { id: row.vehicleId, revision: row.identityRevision })]
  )
  const base = await source()
  const allGrants = Object.entries(base.registry).flatMap(
    ([subject, actions]) =>
      Object.keys(actions).map((action) => ({
        subject,
        action,
        fields: ["*"],
        ...(subject === "PurchaseRecord"
          ? { conditions: { createdBy: "$actor.id" } }
          : {}),
      }))
  )
  await command("saveRole", {
    name: `Retained wildcard parent ${suffix}`,
    reason: "Retained exact prebase universe",
    grants: allGrants,
  })
  await command("saveRole", {
    name: `Retained compound parent ${suffix}`,
    reason: "Retained compound upload and finance authority",
    grants: [
      { subject: "ImportBatch", action: "read", fields: ["uploads"] },
      { subject: "ImportBatch", action: "update", fields: ["uploads"] },
      {
        subject: "Document",
        action: "create",
        fields: [
          "target",
          "purpose",
          "filename",
          "contentType",
          "size",
          "sha256",
        ],
      },
      {
        subject: "PurchaseRecord",
        action: "read",
        fields: [
          "financial",
          "payments",
          "costs",
          "basisVersions",
          "outstanding",
          "mileage",
        ],
        conditions: { createdBy: "$actor.id" },
      },
    ],
  })
  const batch = await command("stageImport", {
    types: ["SUPPLIERS"],
    namespace: `retained-settlement-parent-${suffix}`,
  })
  const csv = Buffer.from("name,value\nRetained authentic parent bytes,123\n"),
    sha256 = createHash("sha256").update(csv).digest("hex")
  const init = await client!.post("/api/v1/commands/initUpload", {
    headers: { Origin: origin },
    data: envelope(
      {
        target: { type: "IMPORT_BATCH", id: batch.result.id },
        purpose: "IMPORT_SOURCE",
        filename: "retained-parent.csv",
        contentType: "text/csv",
        size: csv.length,
        sha256,
      },
      [ref("ImportBatch", batch.result)]
    ),
  })
  assert.equal(init.status(), 201)
  const upload = await init.json()
  assert.equal(
    (
      await client!.put(upload.putUrl, {
        headers: { origin, ...upload.requiredHeaders },
        data: csv,
      })
    ).status(),
    204
  )
  const completed = await command(
    "completeUpload",
    { uploadId: upload.uploadId },
    [
      ref("ImportBatch", batch.result),
      ref("UploadIntent", { id: upload.uploadId, revision: upload.revision }),
    ]
  )
  const fixture = {
    purchaseId: row.id,
    attachmentId: completed.result.id,
    sha256,
    size: csv.length,
    files: undefined as unknown as RetainedFiles,
    bytes: [] as Awaited<ReturnType<typeof fileBytes>>,
  }
  await bytes(fixture)
  const local = await localFixture(root, project)
  try {
    await local.start()
    const reader = await local.login("ADMIN")
    try {
      fixture.files = await seedFiles(local, reader)
    } finally {
      await reader.dispose()
    }
    await verifyFiles(local, fixture.files)
    fixture.bytes = await fileBytes(local)
  } finally {
    await local.close()
  }
  row = await query("purchase", `?cycleId=${row.id}`)
  assert.deepEqual(
    row.mileage.map((m) => m.reading),
    [0, 100, 0]
  )
  assert.ok(row.mileage[2].decreaseReason)
  assert.equal(row.financial?.basis, "11500")
  assert.equal(row.outstanding.seller, "2000")
  assert.equal(row.listedPrice, "16000")
  return fixture
}
try {
  if (mode === "prepare") {
    assert.equal(head, parentSHA)
    await assert.rejects(
      readFile(record),
      "Never overwrite a retained preparation"
    )
    await start()
    const fixture = await populate(),
      before = await snapshot(fixture)
    for (const table of [
      "Settings",
      "SettingsVersion",
      "FinanceCompany",
      "FinanceContact",
      "FinancePolicyVersion",
      "Supplier",
      "SupplierContact",
      "Customer",
      "Vehicle",
      "PurchaseRecord",
      "VehicleCost",
      "PurchasePayment",
      "CostPayment",
      "CycleBasisVersion",
      "MileageReading",
      "StatusEvent",
      "CommandReceipt",
      "AuditEntry",
      "EntityReadVersion",
      "Permission",
      "RolePermission",
      "UserRole",
      "RateSheetVersion",
      "RateCardEntry",
      "Quote",
      "ImportBatch",
      "UploadIntent",
      "UploadAttempt",
      "Attachment",
      "UploadEvent",
    ])
      assert.ok(before.rows[table]?.length, `NONEMPTY_${table}`)
    assert.deepEqual(
      Object.fromEntries(
        before.migrations.map((m) => [m.migration_name, m.checksum])
      ),
      before.source.migrations
    )
    await writeFile(record, JSON.stringify(before, null, 2), {
      flag: "wx",
      mode: 0o600,
    })
    await writeFile(`${record}.sha256`, hash(await readFile(record, "utf8")), {
      flag: "wx",
      mode: 0o600,
    })
    console.log(
      `PASS genuine NONEMPTY exact parent ${parentSHA}; source inventory, old rows/ACLs, compound grants and authenticated final bytes sealed`
    )
  } else {
    const text = await readFile(record, "utf8")
    assert.equal(hash(text), await readFile(`${record}.sha256`, "utf8"))
    const before = JSON.parse(text) as Snapshot
    assert.equal(before.source.sha, parentSHA)
    assert.notEqual(head, parentSHA)
    const after = await snapshot(before.fixture)
    const repeatedState = join(root, "settlement-migration-role-state.json")
    const roleState = canonical({
      roles: after.rows.Role,
      permissions: after.rows.Permission,
      memberships: after.rows.RolePermission,
    })
    try {
      assert.equal(
        await readFile(repeatedState, "utf8"),
        roleState,
        "Repeat setup must not bump roles or add grants"
      )
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      await writeFile(repeatedState, roleState, { flag: "wx", mode: 0o600 })
    }
    assert.equal(before.source.registryVersion, 11)
    assert.equal(after.source.registryVersion, 12)
    assert.equal(before.migrations.length, 15)
    assert.equal(after.migrations.length, 16)
    for (const m of before.migrations) {
      assert.ok(after.migrations.some((n) => canonical(m) === canonical(n)))
      assert.equal(after.source.migrations[m.migration_name], m.checksum)
    }
    assert.equal(after.migrations.length, before.migrations.length + 1)
    assert.equal(
      after.migrations.at(-1)?.migration_name,
      "202610300006_settlement_purchases"
    )
    for (const [table, rows] of Object.entries(before.rows)) {
      if (table === "RolePermission") continue
      const current = new Set(after.rows[table].map(canonical))
      for (const entry of rows) {
        if (table === "Role") {
          const old = entry as { id: string; revision: number },
            now = after.rows.Role.find(
              (r) => (r as { id: string }).id === old.id
            ) as typeof old
          assert.deepEqual(now, { ...old, revision: old.revision + 1 })
        } else assert.ok(current.has(canonical(entry)), `RETAINED_${table}`)
      }
    }
    for (const owner of before.owners)
      assert.ok(after.owners.some((o) => canonical(o) === canonical(owner)))
    for (const privilege of before.privileges)
      assert.ok(
        after.privileges.some((p) => canonical(p) === canonical(privilege)),
        `PRIVILEGE_${canonical(privilege)}`
      )
    const sql = await readFile(
      join(
        project,
        "prisma/migrations/202610300006_settlement_purchases/migration.sql"
      ),
      "utf8"
    )
    const pairs = [
      ...sql.matchAll(/ARRAY\['((?:[^']|'')*)','((?:[^']|'')*)'\]/g),
    ].map((m) => [m[1].replaceAll("''", "'"), m[2].replaceAll("''", "'")])
    assert.equal(pairs.length, 8)
    const replacement = (body: string, from: string, to: string) => {
      assert.ok(
        body.includes(from),
        `Expected exact accepted guard fragment: ${from}`
      )
      return body.replaceAll(from, to)
    }
    const expectedBody = (name: string, body: string) => {
      if (name === "vamotors.check_acquisition_graph()")
        return sql.match(
          /CREATE OR REPLACE FUNCTION vamotors\.check_acquisition_graph\(\)[\s\S]*? AS \$\$([\s\S]*?)\$\$;/
        )![1]
      if (name === "vamotors.acquisition_root_guard()")
        return pairs
          .slice(0, 2)
          .reduce((value, [from, to]) => replacement(value, from, to), body)
      if (name === "vamotors.cycle_cost_root_graph()")
        return pairs
          .slice(2)
          .reduce((value, [from, to]) => replacement(value, from, to), body)
      if (name === "vamotors.cycle_cost_diff(text,jsonb,jsonb)")
        return replacement(
          body,
          "'purchaseType','acquisitionKind'",
          "'purchaseType','settlement.institutionType','settlement.companyId','settlement.institutionName','settlement.institutionNameSnapshot','settlement.reference','settlement.amount','settlement.cashToSeller','acquisitionKind'"
        )
      if (name === "vamotors.cycle_cost_child_graph()")
        return replacement(
          replacement(
            body,
            "AND NEW.\"lineKey\"='seller'",
            "AND NEW.\"lineKey\" IN ('seller','settlement')"
          ),
          "m.direction='IN' AND m.\"sourceType\"",
          "m.direction='IN' AND m.category=NEW.category AND m.\"sourceType\""
        )
      if (name.startsWith("vamotors.check_cycle_edit("))
        return replacement(
          body,
          "new_root.\"purchaseType\" NOT IN ('CASH','BRAND_NEW')",
          "new_root.\"purchaseType\" NOT IN ('CASH','BRAND_NEW','LEASE_SETTLEMENT')"
        )
      return body
    }
    for (const old of before.functions) {
      const now = after.functions.find((f) => f.name === old.name)!
      assert.ok(now)
      assert.equal(now.owner, old.owner)
      assert.deepEqual(now.acl, old.acl)
      assert.equal(
        now.securityDefiner,
        old.securityDefiner,
        `${old.name}: preserve execution authority`
      )
      assert.deepEqual(
        now.config,
        old.config,
        `${old.name}: preserve search path`
      )
      assert.equal(
        now.body,
        expectedBody(old.name, old.body),
        `Exact guarded function extension: ${old.name}`
      )
    }
    for (const g of after.grants) {
      grantSchema.parse(g.rule)
      if (g.systemKey === "ADMINISTRATOR") continue
      const prior = before.grants.filter((p) => p.roleId === g.roleId)
      if (!prior.length) continue
      for (const field of expanded(g.rule))
        assert.ok(
          prior.some(
            (p) =>
              p.rule.subject === g.rule.subject &&
              p.rule.action === g.rule.action &&
              canonical(p.rule.conditions ?? {}) ===
                canonical(g.rule.conditions ?? {}) &&
              (
                before.source.registry[p.rule.subject]?.[p.rule.action] ?? []
              ).some(
                (f) =>
                  f === field &&
                  p.rule.fields.some(
                    (selected) =>
                      selected === "*" ||
                      f === selected ||
                      f.startsWith(`${selected}.`)
                  )
              )
          ),
          `NO_AUTHORITY_WIDENING_${g.rule.subject}_${field}`
        )
    }
    for (const old of before.grants.filter(
      (g) => g.systemKey !== "ADMINISTRATOR"
    )) {
      const originals = before.source.registry[old.rule.subject][
        old.rule.action
      ].filter((f) =>
        old.rule.fields.some(
          (p) => p === "*" || p === f || f.startsWith(`${p}.`)
        )
      )
      const actual = after.grants
        .filter(
          (g) =>
            g.roleId === old.roleId &&
            g.rule.subject === old.rule.subject &&
            g.rule.action === old.rule.action &&
            canonical(g.rule.conditions ?? {}) ===
              canonical(old.rule.conditions ?? {})
        )
        .flatMap((g) => expanded(g.rule))
      for (const field of originals)
        assert.ok(
          actual.includes(field),
          `COMPOUND_GATE_RETAINED_${old.rule.subject}_${field}`
        )
    }
    await start()
    await bytes(before.fixture)
    const local = await localFixture(root, project)
    try {
      await local.start()
      assert.deepEqual(await fileBytes(local), before.fixture.bytes)
      await verifyFiles(local, before.fixture.files)
      await client?.dispose()
      client = undefined
      if (server && server.exitCode === null) {
        const done = once(server, "exit")
        server.kill("SIGTERM")
        await done
      }
      await db.end()
      db = new pg.Pool({ connectionString: migration.DIRECT_URL, max: 1 })
      await local.restart()
      await verifyFiles(local, before.fixture.files)
      assert.deepEqual(await fileBytes(local), before.fixture.bytes)
    } finally {
      await local.close()
    }
    await start()
    const row = await query<PurchaseCycleDTO>(
      "purchase",
      `?cycleId=${before.fixture.purchaseId}`
    )
    assert.equal(row.id, before.fixture.purchaseId)
    const receipt = {
      parentSHA,
      finalSHA: head,
      finalTree: after.source.tree,
      parentMigrations: before.migrations.length,
      finalMigrations: after.migrations.length,
      oldTableCounts: Object.fromEntries(
        Object.entries(before.rows).map(([table, rows]) => [table, rows.length])
      ),
      registry: {
        parent: before.source.registryVersion,
        final: after.source.registryVersion,
      },
      authenticatedBytes: before.fixture,
      status: "PASS",
      at: new Date().toISOString(),
    }
    await writeFile(
      join(root, `settlement-upgrade-verify-${randomUUID()}.json`),
      JSON.stringify(receipt, null, 2),
      { mode: 0o600 }
    )
    console.log(
      "PASS exact-parent NONEMPTY upgrade retention, all original rows/checksums/owners/function ACLs, nonadmin ceilings and compound gates, authenticated HTTP final bytes"
    )
  }
} finally {
  await client?.dispose()
  if (server && server.exitCode === null) {
    const done = once(server, "exit")
    server.kill("SIGTERM")
    await done
  }
  await db.end()
}
