/** Genuine NONEMPTY accepted-parent upgrade; prepare never installs candidate schema.
 * prepare LOCAL_DIR PARENT_SHA: real parent HTTP fixtures + immutable snapshot.
 * bind LOCAL_DIR PARENT_SHA: explicit handoff of THIS worker's retained cluster.
 * verify/repeat LOCAL_DIR PARENT_SHA: compare exact rows/grants/checksums. */
import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { readFile, writeFile, mkdir } from "node:fs/promises"
import { spawn, execFileSync, type ChildProcess } from "node:child_process"
import { createServer } from "node:net"
import { once } from "node:events"
import { join } from "node:path"
import { chromium } from "@playwright/test"
import pg from "pg"
import { privateEnvironment } from "../../scripts/private-environment"
import { canonical } from "../../lib/server/idempotency"
import { grantSchema, registry } from "../../lib/server/permissions"
import type {
  Applied,
  Dependency,
  Grant,
  QueryData,
} from "../../.planning/implementation/contracts/api"
process.umask(0o077)
const [mode, root, parent] = process.argv.slice(2)
assert.ok(
  ["prepare", "bind", "verify", "repeat"].includes(mode) &&
    root &&
    /^[a-f0-9]{40}$/.test(parent)
)
const runtime = await privateEnvironment(join(root, "runtime.env")),
  migration = await privateEnvironment(join(root, "migration.env")),
  cluster = await privateEnvironment(join(root, "cluster.env"))
assert.equal(runtime.APP_ENV, "local")
assert.equal(new URL(migration.DIRECT_URL!).hostname, "127.0.0.1")
const db = new pg.Client({ connectionString: migration.DIRECT_URL })
await db.connect()
const snapshotPath = join(root, "t06b-upgrade-before.json"),
  afterPath = join(root, "t06b-upgrade-after.json")
const names = [
  "Settings",
  "SettingsVersion",
  "Customer",
  "Supplier",
  "SupplierContact",
  "RepairVendor",
  "FinanceCompany",
  "FinancePolicyVersion",
  "FinanceContact",
  "Vehicle",
  "PurchaseRecord",
  "PurchasePayment",
  "CycleBasisVersion",
  "MileageReading",
  "StatusEvent",
  "RateSheetVersion",
  "RateCardEntry",
  "Quote",
  "VehicleCost",
  "CostPayment",
  "BusinessSequence",
  "CommandReceipt",
  "AuditEntry",
  "EntityReadVersion",
  "Permission",
  "Role",
  "RolePermission",
  "UserRole",
]
async function snapshot() {
  const tables: Record<string, Record<string, unknown>[]> = {}
  for (const name of names)
    if (
      (await db.query("SELECT to_regclass($1) t", [`vamotors.\"${name}\"`]))
        .rows[0].t
    )
      tables[name] = (
        await db.query(
          `SELECT to_jsonb(t) AS row FROM vamotors."${name}" t ORDER BY to_jsonb(t)::text`
        )
      ).rows.map((r) => r.row)
  return {
    tables,
    migrations: (
      await db.query(
        "SELECT migration_name,checksum FROM vamotors._prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name"
      )
    ).rows as { migration_name: string; checksum: string }[],
    columns: (
      await db.query(
        "SELECT table_name,column_name,privilege_type FROM information_schema.column_privileges WHERE grantee='vamotors_runtime' ORDER BY table_name,column_name,privilege_type"
      )
    ).rows as Record<string, string>[],
  }
}
let server: ChildProcess | undefined,
  browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
try {
  if (mode === "prepare") {
    assert.equal(
      execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: cluster.PROJECT,
        encoding: "utf8",
      }).trim(),
      parent
    )
    assert.equal(
      (await db.query("SELECT to_regclass('vamotors.\"ImportBatch\"') t"))
        .rows[0].t,
      null
    )
    const accounts = await privateEnvironment(join(root, "accounts.env")),
      socket = createServer().listen(0, "127.0.0.1")
    await once(socket, "listening")
    const address = socket.address()
    assert.ok(address && typeof address !== "string")
    await new Promise<void>((resolve) => socket.close(() => resolve()))
    const origin = `http://127.0.0.1:${address.port}`
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
        cwd: cluster.PROJECT,
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
    browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({ baseURL: origin }),
      page = await context.newPage()
    await page.goto("/login")
    await page.getByLabel("Email Address").fill(accounts.BOOTSTRAP_ADMIN_EMAIL!)
    await page
      .getByLabel("Password", { exact: true })
      .fill(accounts.BOOTSTRAP_ADMIN_PASSWORD!)
    await page.getByRole("button", { name: "Sign In", exact: true }).click()
    await page.waitForURL("**/dashboard")
    const query = async <T>(name: string, params = "") => {
      const r = await context.request.get(`/api/v1/queries/${name}${params}`)
      assert.equal(r.status(), 200, `PARENT_QUERY_${name}`)
      return (await r.json()).data as T
    }
    const command = async (
      name: string,
      input: unknown,
      expected: Dependency[] = []
    ) => {
      const r = await context.request.post(`/api/v1/commands/${name}`, {
        headers: { origin },
        data: {
          schemaVersion: 1,
          idempotencyKey: randomUUID(),
          expected,
          input,
        },
      })
      const b = await r.json()
      assert.ok(
        [200, 201].includes(r.status()),
        `PARENT_${name}_${r.status()}_${b.error?.code}`
      )
      return b as Applied
    }
    const ref = (
      type: Dependency["type"],
      row: { id: string; revision: number }
    ): Dependency => ({ type, id: row.id, revision: row.revision })
    const suffix = randomUUID().slice(0, 10),
      date = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Colombo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date())
    let settings = await query<QueryData["settings"]>("settings")
    const { id, revision, policyVersion, ...settingsValues } = settings
    void policyVersion
    // Pick only declared settings fields; projection/redaction metadata is not input.
    const settingsKeys = [
      "company",
      "declarations",
      "currency",
      "scale",
      "timezone",
      "tiers",
      "warningLeadDays",
      "processingFee",
      "dateFormat",
      "itemsPerPage",
      "theme",
    ]
    await command(
      "updateSettings",
      {
        ...Object.fromEntries(
          Object.entries(settingsValues).filter(([key]) =>
            settingsKeys.includes(key)
          )
        ),
        company: {
          ...settings.company,
          name: `Retained T06b parent ${suffix}`,
        },
        reason: "Real parent upgrade retention",
      },
      [{ type: "Settings", id, revision }]
    )
    settings = await query<QueryData["settings"]>("settings")
    const supplierResult = await command("createDirectoryParty", {
      type: "SUPPLIER",
      values: {
        name: `Retained supplier ${suffix}`,
        category: "COMPANY",
        contacts: [
          {
            name: "Synthetic agent",
            phone: "0112345678",
            role: "Agent",
            primary: true,
          },
        ],
      },
    })
    const supplier = await query<QueryData["party"]>(
      "party",
      `?type=SUPPLIER&id=${supplierResult.result.id}`
    )
    await command("createCustomer", {
      fullName: `Retained parent ${suffix}`,
      callingName: "Retained",
      nicOrPassport: `T06B-${suffix}`,
      address: "Synthetic Colombo",
      phone: "0771234567",
    })
    const purchase = await command(
      "recordPurchase",
      {
        vehicle: {
          engineNumber: `T06BE-${suffix}`,
          chassisNumber: `T06BC-${suffix}`,
          make: "Synthetic",
          model: "Parent",
          year: 2026,
          colour: "Blue",
          fuelType: "PETROL",
          transmission: "AUTOMATIC",
        },
        supplierId: supplier.id,
        purchaseDate: date,
        purchaseType: "CASH",
        purchasePrice: "1000000",
        listedPrice: "1200000",
        mileage: { reading: 100, date },
        paymentMethod: "CASH",
      },
      [ref("Supplier", supplier)]
    )
    let cycle = await query<QueryData["purchase"]>(
      "purchase",
      `?cycleId=${purchase.result.id}`
    )
    await command(
      "receiveStock",
      {
        cycleId: cycle.id,
        date,
        disposition: { kind: "HOLD", reason: "Retained parent hold" },
      },
      [ref("PurchaseRecord", cycle)]
    )
    cycle = await query<QueryData["purchase"]>(
      "purchase",
      `?cycleId=${cycle.id}`
    )
    if (
      (await db.query("SELECT to_regclass('vamotors.\"VehicleCost\"') t"))
        .rows[0].t
    ) {
      await command(
        "addCost",
        {
          cycleId: cycle.id,
          category: "OTHER",
          description: "Retained parent cost",
          amount: "10000",
          incurredDate: date,
          payment: { amount: "1000", date, method: "CASH" },
        },
        [ref("PurchaseRecord", cycle)]
      )
    }
    const financeResult = await command(
      "createFinanceCompany",
      {
        name: `Retained finance ${suffix}`,
        contacts: [
          {
            name: "Synthetic finance agent",
            phone: "0112345678",
            role: "Agent",
            primary: true,
          },
        ],
        policy: {
          path: "APPLICATION",
          commission: { basis: "FIXED", fixed: "5000", rateBps: 0 },
          processingFee: "250000",
          reconciliationMethod: "PER_DEAL",
        },
      },
      [ref("Settings", settings)]
    )
    const finance = await query<QueryData["party"]>(
      "party",
      `?type=FINANCE_COMPANY&id=${financeResult.result.id}`
    )
    const sheet = await command(
      "publishRates",
      {
        companyId: finance.id,
        make: "Synthetic",
        model: `Parent-${suffix}`,
        year: 2026,
        maximum: "120000",
        validFrom: date,
        validThrough: date,
        cards: [{ principal: "100000", months: 12, installment: "9000" }],
      },
      [ref("FinanceCompany", finance)]
    )
    const card = (
      await db.query(
        'SELECT id FROM vamotors."RateCardEntry" WHERE "sheetVersionId"=$1',
        [sheet.result.id]
      )
    ).rows[0]
    await command(
      "selectQuote",
      {
        sheetId: sheet.result.id,
        cardId: card.id,
        vehicle: {
          make: "Synthetic",
          model: `Parent-${suffix}`,
          year: 2026,
          description: "Retained exact parent quote",
        },
        charges: [{ category: "DOCUMENT_FEES", amount: "2500" }],
      },
      [
        ref("FinanceCompany", finance),
        { type: "RateSheet", id: sheet.result.id, revision: 1 },
        ref("Settings", settings),
      ]
    )
    // Existing wildcard, compound, create and delegated ceiling are all real old rules.
    await command("saveRole", {
      name: `Retained ceiling ${suffix}`,
      grants: [
        { subject: "Vehicle", action: "read", fields: ["*"] },
        {
          subject: "Vehicle",
          action: "read",
          fields: ["financial"],
          conditions: { createdBy: "$actor.id" },
        },
        { subject: "PurchaseRecord", action: "create", fields: ["*"] },
        { subject: "Role", action: "read", fields: ["*"] },
        { subject: "Role", action: "update", fields: ["name", "grants"] },
        { subject: "User", action: "update", fields: ["roleIds"] },
      ],
      reason: "Retained delegated capability ceiling",
    })
    const before = await snapshot()
    for (const name of [
      "Settings",
      "SettingsVersion",
      "Customer",
      "Supplier",
      "SupplierContact",
      "FinanceCompany",
      "FinancePolicyVersion",
      "FinanceContact",
      "Vehicle",
      "PurchaseRecord",
      "PurchasePayment",
      "CycleBasisVersion",
      "MileageReading",
      "StatusEvent",
      "RateSheetVersion",
      "RateCardEntry",
      "Quote",
      "CommandReceipt",
      "AuditEntry",
      "EntityReadVersion",
    ])
      assert.ok(before.tables[name]?.length, `NONEMPTY_${name}`)
    if (before.tables.VehicleCost)
      assert.ok(
        before.tables.VehicleCost.length && before.tables.CostPayment.length
      )
    const source = execFileSync(
      "git",
      ["show", `${parent}:lib/server/permissions.ts`],
      { cwd: cluster.PROJECT, encoding: "utf8" }
    )
    const parentRegistry = Function(
      `return (${source.split("export const registry = ")[1].split(" as const")[0]})`
    )() as typeof registry
    await writeFile(
      snapshotPath,
      JSON.stringify(
        {
          parent,
          parentProject: cluster.PROJECT,
          registry: parentRegistry,
          actor: await query<QueryData["currentActor"]>("currentActor"),
          ...before,
        },
        null,
        2
      ),
      { mode: 0o600, flag: "wx" }
    )
    console.log(
      `PASS genuine NONEMPTY exact-parent ${parent}: real HTTP purchases/settings/finance/rates/quotes and old grant universes retained for upgrade.`
    )
  } else {
    const before = JSON.parse(await readFile(snapshotPath, "utf8")) as Awaited<
      ReturnType<typeof snapshot>
    > & { parent: string; parentProject: string; registry: typeof registry }
    assert.equal(before.parent, parent)
    if (mode === "bind") {
      assert.equal(cluster.PROJECT, before.parentProject)
      execFileSync("git", ["merge-base", "--is-ancestor", parent, "HEAD"], {
        stdio: "pipe",
      })
      const fileRoot = join(root, "private-files"),
        policyPath = join(root, "private-files-policy.json")
      await mkdir(fileRoot, { mode: 0o700 })
      await writeFile(
        policyPath,
        JSON.stringify({
          environmentId: runtime.ENVIRONMENT_ID,
          allowWrites: true,
          reviewedThrough: new Date(Date.now() + 86400000).toISOString(),
          maxBytes: 268435456,
          minFreeBytes: 134217728,
          maxEntries: 10000,
        }),
        { mode: 0o600, flag: "wx" }
      )
      await writeFile(
        join(root, "runtime.env"),
        (await readFile(join(root, "runtime.env"), "utf8")) +
          `PRIVATE_FILES_ROOT=${JSON.stringify(fileRoot)}\nPRIVATE_FILES_POLICY=${JSON.stringify(policyPath)}\n`,
        { mode: 0o600 }
      )
      await writeFile(
        join(root, "cluster.env"),
        Object.entries({ ...cluster, PROJECT: process.cwd() })
          .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
          .join("\n") + "\n",
        { mode: 0o600 }
      )
      console.log(
        "PASS explicit own-cluster upgrade binding; old credentials, Environment, DB and bytes unchanged."
      )
    } else {
      assert.equal(cluster.PROJECT, process.cwd())
      const after = await snapshot()
      for (const [subject, actions] of Object.entries(before.registry))
        assert.deepEqual(
          registry[subject as keyof typeof registry],
          actions,
          `FROZEN_${subject}`
        )
      assert.deepEqual(
        after.migrations.slice(0, before.migrations.length),
        before.migrations
      )
      assert.deepEqual(
        after.migrations
          .slice(before.migrations.length)
          .map((m) => m.migration_name),
        ["202610300004_import_attachments"]
      )
      for (const [name, rows] of Object.entries(before.tables)) {
        if (!["Permission", "RolePermission", "Role"].includes(name))
          assert.deepEqual(after.tables[name], rows, `RETAIN_${name}`)
      }
      for (const row of before.tables.Permission)
        assert.ok(
          after.tables.Permission.some((p) => canonical(p) === canonical(row)),
          "IMMUTABLE_PERMISSION"
        )
      for (const row of before.tables.RolePermission)
        assert.ok(
          after.tables.RolePermission.some(
            (p) => canonical(p) === canonical(row)
          ),
          "FROZEN_CEILING"
        )
      for (const row of before.tables.Role)
        assert.deepEqual(
          after.tables.Role.find((r) => r.id === row.id),
          row.systemKey === "ADMINISTRATOR"
            ? { ...row, revision: Number(row.revision) + 1 }
            : row
        )
      const joins = new Set(before.tables.RolePermission.map(canonical)),
        additions = after.tables.RolePermission.filter(
          (r) => !joins.has(canonical(r))
        )
      assert.equal(additions.length, 6)
      for (const join of additions) {
        assert.equal(
          after.tables.Role.find((r) => r.id === join.roleId)?.systemKey,
          "ADMINISTRATOR"
        )
        const rule = after.tables.Permission.find(
          (p) => p.id === join.permissionId
        )!.rule as Grant
        grantSchema.parse(rule)
        assert.ok(["Document", "ImportBatch"].includes(rule.subject))
        assert.ok(["read", "create", "update"].includes(rule.action))
      }
      for (const p of after.tables.Permission) {
        grantSchema.parse(p.rule)
        assert.equal(
          createHash("sha256").update(canonical(p.rule)).digest("hex"),
          p.ruleHash
        )
      }
      const oldTables = new Set(before.columns.map((r) => r.table_name))
      assert.deepEqual(
        after.columns.filter((r) => oldTables.has(r.table_name)),
        before.columns,
        "OLD_ACLS_UNCHANGED"
      )
      const owners = (
        await db.query(
          "SELECT c.relname,pg_get_userbyid(c.relowner) owner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='vamotors' AND c.relname=ANY($1::text[]) ORDER BY c.relname",
          [
            [
              "ImportBatch",
              "UploadIntent",
              "UploadAttempt",
              "Attachment",
              "UploadEvent",
            ],
          ]
        )
      ).rows
      assert.equal(owners.length, 5)
      assert.ok(owners.every((o) => o.owner === "vamotors_migrator"))
      if (mode === "repeat")
        assert.deepEqual(
          after,
          JSON.parse(await readFile(afterPath, "utf8")).snapshot,
          "REPEAT_SETUP_RETENTION"
        )
      else
        await writeFile(
          afterPath,
          JSON.stringify(
            {
              parent,
              sha: execFileSync("git", ["rev-parse", "HEAD"], {
                encoding: "utf8",
              }).trim(),
              owners,
              snapshot: after,
            },
            null,
            2
          ),
          { mode: 0o600, flag: "wx" }
        )
      console.log(
        `PASS ${mode}: exact-parent ${parent} NONEMPTY rows/checksums/old universes/ACLs retained; six protected-admin-only additions; no reset.`
      )
    }
  }
} catch {
  // Driver and browser exceptions can contain connection/cookie headers.
  console.error(
    `FAIL import attachment upgrade ${mode}; private state retained, no secret diagnostics emitted.`
  )
  process.exitCode = 1
} finally {
  await browser?.close()
  if (server && server.exitCode === null && server.signalCode === null) {
    const exited = once(server, "exit")
    server.kill("SIGTERM")
    await exited
  }
  await db.end()
}
