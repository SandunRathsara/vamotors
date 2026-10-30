/** Exact accepted-parent NONEMPTY upgrade. Never resets/reseeds retained rows. */
import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { spawn, execFileSync, type ChildProcess } from "node:child_process"
import { once } from "node:events"
import { createServer } from "node:net"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { request } from "@playwright/test"
import pg from "pg"
import { privateEnvironment } from "../../scripts/private-environment"
import { canonical } from "../../lib/server/idempotency"
import {
  expanded,
  fieldsFor,
  grantSchema,
  registryVersion,
  sourcePaymentFields,
} from "../../lib/server/permissions"
import type {
  Applied,
  Grant,
} from "../../.planning/implementation/contracts/api"

process.umask(0o077)
const [root, mode] = process.argv.slice(2)
assert.ok(root && ["prepare", "verify"].includes(mode))
const runtime = await privateEnvironment(join(root, "runtime.env")),
  migration = await privateEnvironment(join(root, "migration.env")),
  cluster = await privateEnvironment(join(root, "cluster.env"))
const db = new pg.Pool({ connectionString: migration.DIRECT_URL, max: 1 })
const parentSHA = "b7ac9afb85218e7ec7fbaa0b006d0b165a19b3c3"
const tables = [
  "Environment",
  "Settings",
  "SettingsVersion",
  "FinanceCompany",
  "FinanceContact",
  "FinancePolicyVersion",
  "Supplier",
  "SupplierContact",
  "RepairVendor",
  "VendorContact",
  "Customer",
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
  "Permission",
  "Role",
  "RolePermission",
  "UserRole",
]
const required = [
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
  "PurchasePayment",
  "MileageReading",
  "CycleBasisVersion",
  "StatusEvent",
  "CommandReceipt",
  "AuditEntry",
  "EntityReadVersion",
  "Permission",
  "RolePermission",
  "UserRole",
]
type Snapshot = {
  migrations: { migration_name: string; checksum: string }[]
  rows: Record<string, Record<string, unknown>[]>
  grants: { roleId: string; rule: Grant; systemKey: string | null }[]
  owners: { name: string; owner: string }[]
}
async function snapshot(): Promise<Snapshot> {
  const rows: Snapshot["rows"] = {}
  for (const table of tables)
    rows[table] = (
      await db.query(
        `SELECT to_jsonb(t) AS row FROM vamotors."${table}" t ORDER BY to_jsonb(t)::text`
      )
    ).rows.map((r) => r.row)
  return {
    rows,
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
  }
}
let server: ChildProcess | undefined
async function populate() {
  assert.equal(
    execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: cluster.PROJECT,
      encoding: "utf8",
    }).trim(),
    parentSHA
  )
  assert.equal(
    execFileSync("git", ["status", "--porcelain"], {
      cwd: cluster.PROJECT,
      encoding: "utf8",
    }).trim(),
    ""
  )
  const socket = createServer().listen(0, "127.0.0.1")
  await once(socket, "listening")
  const address = socket.address()
  assert.ok(address && typeof address !== "string")
  const port = address.port,
    origin = `http://127.0.0.1:${port}`
  await new Promise<void>((r) => socket.close(() => r()))
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
      cwd: cluster.PROJECT,
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
  const client = await request.newContext({ baseURL: origin }),
    accounts = await privateEnvironment(join(root, "accounts.env")),
    suffix = randomUUID().slice(0, 8)
  const envelope = (input: unknown, expected: unknown[] = []) => ({
    schemaVersion: 1,
    idempotencyKey: randomUUID(),
    input,
    expected,
  })
  const command = async (
    name: string,
    input: unknown,
    expected: unknown[] = []
  ) => {
    const response = await client.post(`/api/v1/commands/${name}`, {
      data: envelope(input, expected),
      headers: { Origin: origin },
    })
    const value = await response.json()
    assert.ok(
      response.ok(),
      `${name}:${response.status()}:${JSON.stringify(value)}`
    )
    return value as Applied
  }
  const ref = (type: string, result: Applied) => ({
    type,
    id: result.result.id,
    revision: result.result.revision,
  })
  try {
    const auth = await client.post("/api/auth/sign-in/email", {
      data: {
        email: accounts.BOOTSTRAP_ADMIN_EMAIL,
        password: accounts.BOOTSTRAP_ADMIN_PASSWORD,
      },
      headers: { Origin: origin },
    })
    assert.equal(auth.status(), 200)
    const supplier = await command("createDirectoryParty", {
      type: "SUPPLIER",
      values: {
        name: `Retained parent supplier ${suffix}`,
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
      fullName: `Retained customer ${suffix}`,
      callingName: "Retained",
      nicOrPassport: `UPGRADE-${suffix}`,
      phone: "0112345678",
      address: "Synthetic retained address",
    })
    const settingsResponse = await client.get("/api/v1/queries/settings"),
      settings = (await settingsResponse.json()).data
    assert.equal(settingsResponse.status(), 200)
    await command(
      "createFinanceCompany",
      {
        name: `Retained finance ${suffix}`,
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
      [{ type: "Settings", id: settings.id, revision: settings.revision }]
    )
    const purchase = await command(
      "recordPurchase",
      {
        vehicle: {
          engineNumber: `PARENT-E-${suffix}`,
          chassisNumber: `PARENT-C-${suffix}`,
          make: "Retained",
          model: "Parent cost upgrade",
          year: 2026,
          colour: "Blue",
          fuelType: "PETROL",
          transmission: "AUTOMATIC",
        },
        supplierId: supplier.result.id,
        purchaseDate: "2026-10-01",
        purchaseType: "CASH",
        purchasePrice: "10000",
        listedPrice: "15000",
        mileage: { reading: 0, date: "2026-10-01" },
        paymentMethod: "CASH",
      },
      [ref("Supplier", supplier)]
    )
    await command(
      "receiveStock",
      {
        cycleId: purchase.result.id,
        date: "2026-10-02",
        disposition: {
          kind: "HOLD",
          reason: "Retained parent held stock evidence",
        },
      },
      [ref("PurchaseRecord", purchase)]
    )
    for (const grants of [
      [
        { subject: "PurchaseRecord", action: "read", fields: ["*"] },
        { subject: "PurchaseRecord", action: "create", fields: ["*"] },
        { subject: "PurchaseRecord", action: "update", fields: ["*"] },
        { subject: "Vehicle", action: "read", fields: ["*"] },
        { subject: "Vehicle", action: "create", fields: ["*"] },
        { subject: "Role", action: "create", fields: ["*"] },
      ],
      [
        {
          subject: "PurchaseRecord",
          action: "read",
          fields: [
            "financial",
            "costs",
            "payments",
            "basisVersions",
            "outstanding",
          ],
          conditions: { createdBy: "$actor.id" },
        },
        {
          subject: "Vehicle",
          action: "read",
          fields: ["financial", "identity"],
          conditions: { createdBy: "$actor.id" },
        },
      ],
    ])
      await command("saveRole", {
        name: `Retained v7 ceiling ${randomUUID()}`,
        grants,
        reason: "Synthetic immutable pre-upgrade delegation ceiling",
      })
  } finally {
    await client.dispose()
    if (server?.exitCode === null) {
      const end = once(server, "exit")
      server.kill("SIGTERM")
      await end
    }
    server = undefined
  }
}
const atoms = (g: Grant) =>
  expanded(g)
    .filter(
      (f) =>
        !fieldsFor(g.subject as Parameters<typeof fieldsFor>[0], g.action).some(
          (child) => child.startsWith(`${f}.`)
        )
    )
    .map((field) =>
      canonical({
        subject: g.subject,
        action: g.action,
        field,
        conditions: g.conditions ?? {},
      })
    )
try {
  if (mode === "prepare") {
    await populate()
    const parent = await import(
      pathToFileURL(join(cluster.PROJECT!, "lib/server/permissions.ts")).href
    )
    assert.equal(parent.registryVersion, 7)
    const before = await snapshot()
    assert.equal(before.migrations.length, 10)
    for (const table of required)
      assert.ok(
        before.rows[table].length > 0,
        `${table}: genuine nonempty parent fixture required`
      )
    const oldAtoms = (g: Grant) =>
      (parent.expanded(g) as string[])
        .filter(
          (f) =>
            !(parent.fieldsFor(g.subject, g.action) as string[]).some((child) =>
              child.startsWith(`${f}.`)
            )
        )
        .flatMap((field) => {
          const paths =
            g.subject === "PurchaseRecord" && g.action === "read"
              ? field === "costs"
                ? []
                : field === "payments"
                  ? sourcePaymentFields.map((p) => `payments.${p}`)
                  : field === "outstanding"
                    ? ["outstanding.seller", "outstanding.settlement"]
                    : field === "basisVersions"
                      ? [
                          "basisVersions.id",
                          "basisVersions.version",
                          "basisVersions.total",
                          "basisVersions.reason",
                        ]
                      : [field]
              : [field]
          return paths.map((field) =>
            canonical({
              subject: g.subject,
              action: g.action,
              field,
              conditions: g.conditions ?? {},
            })
          )
        })
    const ceilings = Object.fromEntries(
      before.rows.Role.map((r) => [
        String(r.id),
        [
          ...new Set(
            before.grants
              .filter((g) => g.roleId === r.id)
              .flatMap((g) => oldAtoms(g.rule))
          ),
        ].sort(),
      ])
    )
    await writeFile(
      join(root, "t05c-parent-before.json"),
      JSON.stringify(
        { parentSHA, authorPrebase: true, ...before, ceilings },
        null,
        2
      ),
      { mode: 0o600, flag: "wx" }
    )
    console.log(
      "PASS exact accepted b7ac9af ten-migration NONEMPTY real-command parent prepared; rates proof still pending"
    )
  } else {
    const before = JSON.parse(
        await readFile(join(root, "t05c-parent-before.json"), "utf8")
      ) as Snapshot & { parentSHA: string; ceilings: Record<string, string[]> },
      after = await snapshot()
    assert.equal(before.parentSHA, parentSHA)
    assert.equal(after.migrations.length, 11)
    assert.deepEqual(after.migrations.slice(0, 10), before.migrations)
    for (const table of required)
      assert.ok(before.rows[table].length > 0 && after.rows[table].length > 0)
    for (const table of tables.filter(
      (t) => !["Role", "RolePermission", "Permission"].includes(t)
    )) {
      const normalize = (rows: Record<string, unknown>[]) =>
        rows
          .map((r) => {
            const next = { ...r }
            if (table === "PurchaseRecord") {
              assert.ok(next.notes === undefined || next.notes === null)
              delete next.notes
            }
            return canonical(next)
          })
          .sort()
      assert.deepEqual(
        normalize(after.rows[table]),
        normalize(before.rows[table]),
        `${table}: retained bytes changed`
      )
    }
    for (const old of before.rows.Permission)
      assert.ok(
        after.rows.Permission.some((p) => canonical(p) === canonical(old)),
        "Immutable permission changed"
      )
    for (const old of before.owners)
      assert.ok(
        after.owners.some((o) => canonical(o) === canonical(old)),
        "Previous table/view owner changed"
      )
    for (const old of before.rows.Role) {
      const next = after.rows.Role.find((r) => r.id === old.id)!
      assert.equal(next.revision, Number(old.revision) + 1)
      const { revision: unused1, ...a } = next,
        { revision: unused2, ...b } = old
      void unused1
      void unused2
      assert.deepEqual(a, b)
      const population = [
        ...new Set(
          after.grants
            .filter((g) => g.roleId === old.id)
            .flatMap((g) => atoms(g.rule))
        ),
      ].sort()
      if (old.systemKey !== "ADMINISTRATOR")
        assert.deepEqual(
          population,
          before.ceilings[String(old.id)],
          "Old wildcard/compound/create/delegation population widened"
        )
      else
        for (const atom of before.ceilings[String(old.id)])
          assert.ok(
            population.includes(atom),
            "Protected Administrator prior capability lost"
          )
    }
    for (const p of after.rows.Permission) {
      grantSchema.parse(p.rule)
      assert.equal(
        createHash("sha256").update(canonical(p.rule)).digest("hex"),
        p.ruleHash
      )
    }
    assert.equal(registryVersion, 8)
    assert.equal(
      (await db.query('SELECT count(*) FROM vamotors."VehicleCost"')).rows[0]
        .count,
      "0"
    )
    assert.equal(
      (await db.query('SELECT count(*) FROM vamotors."CostPayment"')).rows[0]
        .count,
      "0"
    )
    const grants = (
      await db.query(
        "SELECT table_name,column_name,privilege_type FROM information_schema.column_privileges WHERE grantee='vamotors_runtime' ORDER BY table_name,column_name,privilege_type"
      )
    ).rows
    assert.deepEqual(
      grants
        .filter(
          (g) =>
            [
              "PurchaseRecord",
              "Vehicle",
              "VehicleCost",
              "CostPayment",
              "PurchasePayment",
              "CycleBasisVersion",
            ].includes(g.table_name) && g.privilege_type === "UPDATE"
        )
        .map((g) => `${g.table_name}.${g.column_name}`)
        .sort(),
      [
        "PurchaseRecord.available",
        "PurchaseRecord.holdReason",
        "PurchaseRecord.notes",
        "PurchaseRecord.purchaseDate",
        "PurchaseRecord.purchasePrice",
        "PurchaseRecord.receivedDate",
        "PurchaseRecord.revision",
        "PurchaseRecord.status",
        "PurchaseRecord.updatedAt",
        "VehicleCost.amount",
        "VehicleCost.category",
        "VehicleCost.description",
        "VehicleCost.incurredDate",
        "VehicleCost.revision",
        "VehicleCost.updatedAt",
      ].sort()
    )
    await writeFile(
      join(root, "t05c-upgrade-after.json"),
      JSON.stringify(
        {
          head: execFileSync("git", ["rev-parse", "HEAD"], {
            encoding: "utf8",
          }).trim(),
          authorPrebase: true,
          ...after,
          grants,
        },
        null,
        2
      ),
      { mode: 0o600 }
    )
    console.log(
      "PASS exact-parent NONEMPTY ten->eleven upgrade; checksums, old facts/owners/ceilings preserved; explicit current column grants; final accepted rates upgrade pending"
    )
  }
} finally {
  if (server?.exitCode === null) server.kill("SIGTERM")
  await db.end()
}
