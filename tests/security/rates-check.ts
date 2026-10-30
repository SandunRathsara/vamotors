/** Production UI → HTTP → real PostgreSQL. Own isolated local cluster only. */
import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { spawn, execFileSync } from "node:child_process"
import { once } from "node:events"
import { createServer } from "node:net"
import { join } from "node:path"
import {
  chromium,
  expect,
  type APIRequestContext,
  type Page as BrowserPage,
} from "@playwright/test"
import pg from "pg"
import { privateEnvironment } from "../../scripts/private-environment"
import { canonical } from "../../lib/server/idempotency"
import type {
  Applied,
  CompareResult,
  LoanMaximumDTO,
  PartyDTO,
  QuoteDTO,
  QueryData,
  Grant,
  Dependency,
  RoleDTO,
  UserAdminDTO,
} from "../../.planning/implementation/contracts/api"

process.umask(0o077)
const root = process.argv[2]
assert.ok(root)
const runtime = await privateEnvironment(join(root, "runtime.env")),
  migration = await privateEnvironment(join(root, "migration.env")),
  accounts = await privateEnvironment(join(root, "accounts.env")),
  cluster = await privateEnvironment(join(root, "cluster.env"))
assert.equal(cluster.PROJECT, process.cwd())
assert.equal(runtime.APP_ENV, "local")
assert.equal(new URL(runtime.DATABASE_URL!).hostname, "127.0.0.1")
const db = new pg.Pool({ connectionString: migration.DIRECT_URL, max: 3 }),
  restricted = new pg.Pool({ connectionString: runtime.DATABASE_URL, max: 1 })
if (["prepare-upgrade", "verify-upgrade"].includes(process.argv[3])) {
  const snapshot = async () => {
    const names = [
      "Settings",
      "SettingsVersion",
      "Customer",
      "Supplier",
      "SupplierContact",
      "FinanceCompany",
      "FinanceContact",
      "FinancePolicyVersion",
      "Vehicle",
      "PurchaseRecord",
      "PurchasePayment",
      "CycleBasisVersion",
      "MileageReading",
      "StatusEvent",
      "BusinessSequence",
      "CommandReceipt",
      "AuditEntry",
      "EntityReadVersion",
      "Permission",
      "Role",
      "RolePermission",
      "UserRole",
    ]
    const tables: Record<string, Record<string, unknown>[]> =
      Object.fromEntries(
        await Promise.all(
          names.map(async (name) => [
            name,
            (
              await db.query(
                `SELECT to_jsonb(t) AS row FROM vamotors."${name}" t ORDER BY to_jsonb(t)::text`
              )
            ).rows.map((r) => r.row),
          ])
        )
      )
    const migrations = (
      await db.query(
        "SELECT migration_name,checksum FROM vamotors._prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name"
      )
    ).rows as { migration_name: string; checksum: string }[]
    const columns = (
      await db.query(
        "SELECT table_name,column_name,privilege_type FROM information_schema.column_privileges WHERE grantee='vamotors_runtime' ORDER BY table_name,column_name,privilege_type"
      )
    ).rows as Record<string, string>[]
    return { tables, migrations, columns }
  }
  try {
    if (process.argv[3] === "prepare-upgrade") {
      assert.equal(
        execFileSync("git", ["rev-parse", "HEAD"], {
          cwd: cluster.PROJECT,
          encoding: "utf8",
        }).trim(),
        process.argv[4]
      )
      assert.equal(
        (
          await db.query(
            "SELECT to_regclass('vamotors.\"RateSheetVersion\"') AS t"
          )
        ).rows[0].t,
        null
      )
      const owner = (
        await db.query(
          'SELECT u.id FROM vamotors."user" u JOIN vamotors."UserRole" ur ON ur."userId"=u.id JOIN vamotors."Role" r ON r.id=ur."roleId" WHERE r."systemKey"=\'ADMINISTRATOR\' LIMIT 1'
        )
      ).rows[0].id
      const connection = await db.connect()
      try {
        await connection.query("BEGIN")
        await connection.query(
          'SELECT value FROM vamotors."BusinessSequence" WHERE id=1 FOR UPDATE'
        )
        await connection.query("SELECT vamotors.lock_admin_guard()")
        const id = randomUUID(),
          policyId = randomUUID(),
          roleId = randomUUID()
        await connection.query(
          'INSERT INTO vamotors."FinancePolicyVersion"(id,"companyId",version,values) VALUES($1,$2,1,$3)',
          [
            policyId,
            id,
            {
              path: "APPLICATION",
              commission: { basis: "FIXED", fixed: "5000", rateBps: 0 },
              processingFee: "250000",
              reconciliationMethod: "PER_DEAL",
            },
          ]
        )
        await connection.query(
          'INSERT INTO vamotors."FinanceCompany"(id,name,"currentPolicyId","createdBy","updatedAt") VALUES($1,$2,$3,$4,CURRENT_TIMESTAMP)',
          [id, `Retained synthetic parent ${id}`, policyId, owner]
        )
        await connection.query(
          'INSERT INTO vamotors."Role"(id,name) VALUES($1,$2)',
          [roleId, `Retained delegated ceiling ${roleId}`]
        )
        for (const rule of [
          { subject: "FinanceCompany", action: "read", fields: ["*"] },
          { subject: "Vehicle", action: "read", fields: ["*"] },
          { subject: "PurchaseRecord", action: "update", fields: ["*"] },
          { subject: "Role", action: "read", fields: ["*"] },
          { subject: "Role", action: "update", fields: ["name", "grants"] },
          {
            subject: "User",
            action: "read",
            fields: ["id", "revision", "roles"],
          },
          { subject: "User", action: "update", fields: ["roleIds"] },
          {
            subject: "Vehicle",
            action: "read",
            fields: ["financial"],
            conditions: { createdBy: "$actor.id" },
          },
        ]) {
          const hash = createHash("sha256")
            .update(canonical(rule))
            .digest("hex")
          await connection.query(
            'INSERT INTO vamotors."Permission"(id,"ruleHash",rule) VALUES($1,$2,$3) ON CONFLICT("ruleHash") DO NOTHING',
            [randomUUID(), hash, rule]
          )
          await connection.query(
            'INSERT INTO vamotors."RolePermission" SELECT $1,id FROM vamotors."Permission" WHERE "ruleHash"=$2',
            [roleId, hash]
          )
        }
        const staffId = (
          await connection.query(
            'SELECT u.id FROM vamotors."user" u WHERE NOT EXISTS(SELECT 1 FROM vamotors."UserRole" ur JOIN vamotors."Role" r ON r.id=ur."roleId" WHERE ur."userId"=u.id AND r."systemKey"=\'ADMINISTRATOR\') ORDER BY u.id LIMIT 1'
          )
        ).rows[0].id
        await connection.query(
          'INSERT INTO vamotors."UserRole"("userId","roleId","assignedBy") VALUES($1,$2,$3)',
          [staffId, roleId, owner]
        )
        await connection.query("SET CONSTRAINTS ALL IMMEDIATE")
        await connection.query("COMMIT")
      } catch (error) {
        await connection.query("ROLLBACK")
        throw error
      } finally {
        connection.release()
      }
      const parent = process.argv[4]
      assert.match(parent ?? "", /^[a-f0-9]{40}$/)
      const before = await snapshot()
      for (const name of [
        "FinanceCompany",
        "FinanceContact",
        "FinancePolicyVersion",
        "Supplier",
        "SupplierContact",
        "Customer",
        "PurchaseRecord",
        "PurchasePayment",
        "StatusEvent",
        "AuditEntry",
        "EntityReadVersion",
      ])
        assert.ok(before.tables[name].length > 0, `EMPTY_PARENT_${name}`)
      assert.ok(before.tables.FinancePolicyVersion.length >= 2)
      assert.ok(
        before.tables.PurchaseRecord.some(
          (r) =>
            r.status === "IN_STOCK" && r.available === false && !!r.holdReason
        ),
        "parent must contain received and held stock"
      )
      assert.equal(before.migrations.length, 10)
      await writeFile(
        join(root, "t11a-parent-snapshot.json"),
        JSON.stringify({ parent, ...before }),
        { mode: 0o600, flag: "wx" }
      )
      console.log(
        `PASS prepared exact-parent existing rows/grants at ${parent}; private isolated snapshot.`
      )
    } else {
      const before = JSON.parse(
        await readFile(join(root, "t11a-parent-snapshot.json"), "utf8")
      ) as Awaited<ReturnType<typeof snapshot>> & { parent: string }
      execFileSync(
        "git",
        ["merge-base", "--is-ancestor", before.parent, "HEAD"],
        { stdio: "pipe" }
      )
      const after = await snapshot()
      assert.equal(after.migrations.length, 11)
      assert.deepEqual(after.migrations.slice(0, -1), before.migrations)
      assert.equal(
        after.migrations.at(-1)!.migration_name,
        "202610300001_exact_rates_quotes"
      )
      const key = (row: unknown) => canonical(row)
      for (const [name, rows] of Object.entries(before.tables)) {
        if (!["Permission", "Role", "RolePermission"].includes(name))
          assert.deepEqual(after.tables[name], rows, `RETAIN_${name}`)
      }
      for (const row of before.tables.Permission)
        assert.ok(
          after.tables.Permission.some((r) => key(r) === key(row)),
          "immutable permission rewritten"
        )
      for (const row of before.tables.RolePermission)
        assert.ok(
          after.tables.RolePermission.some((r) => key(r) === key(row)),
          "existing ceiling/join lost"
        )
      for (const row of before.tables.Role) {
        const current = after.tables.Role.find((r) => r.id === row.id)
        assert.deepEqual(
          current,
          row.systemKey === "ADMINISTRATOR"
            ? { ...row, revision: Number(row.revision) + 1 }
            : row
        )
      }
      const oldJoins = new Set(before.tables.RolePermission.map(key)),
        additions = after.tables.RolePermission.filter(
          (r) => !oldJoins.has(key(r))
        )
      assert.equal(additions.length, 4)
      for (const row of additions) {
        assert.equal(
          after.tables.Role.find((r) => r.id === row.roleId)?.systemKey,
          "ADMINISTRATOR"
        )
        const rule = after.tables.Permission.find(
          (r) => r.id === row.permissionId
        )!.rule as Grant
        assert.ok(["RateSheet", "Quote"].includes(rule.subject))
        assert.ok(["create", "read"].includes(rule.action))
      }
      for (const acl of before.columns)
        assert.ok(
          after.columns.some((r) => key(r) === key(acl)),
          "old runtime ACL lost"
        )
      const oldTables = new Set(before.columns.map((r) => r.table_name))
      assert.deepEqual(
        after.columns.filter((r) => oldTables.has(r.table_name)),
        before.columns,
        "old runtime grants must not widen"
      )
      assert.equal(
        (
          await restricted.query(
            "SELECT has_schema_privilege(current_user,'vamotors','CREATE') AS create"
          )
        ).rows[0].create,
        false
      )
      const owners = (
        await db.query(
          "SELECT c.relname,pg_get_userbyid(c.relowner) AS owner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='vamotors' AND c.relname=ANY($1::text[]) ORDER BY c.relname",
          [["RateSheetVersion", "RateCardEntry", "Quote"]]
        )
      ).rows
      assert.equal(owners.length, 3)
      assert.ok(owners.every((r) => r.owner === "vamotors_migrator"))
      for (const table of ["RateSheetVersion", "RateCardEntry", "Quote"]) {
        const privileges = (
          await restricted.query(
            "SELECT has_table_privilege(current_user,$1,'SELECT') AS read,has_table_privilege(current_user,$1,'INSERT') AS create,has_table_privilege(current_user,$1,'UPDATE') AS edit,has_table_privilege(current_user,$1,'DELETE') AS remove,has_table_privilege(current_user,$1,'TRUNCATE') AS truncate",
            [`vamotors.\"${table}\"`]
          )
        ).rows[0]
        assert.deepEqual(privileges, {
          read: true,
          create: true,
          edit: false,
          remove: false,
          truncate: false,
        })
      }
      console.log(
        `PASS exact-parent ${before.parent} upgrade: old rows/permissions/joins/delegated ceilings/stock ACLs retained; only protected admin gains four capabilities.`
      )
      await writeFile(
        join(root, "t11a-upgrade-after.json"),
        JSON.stringify(
          {
            parent: before.parent,
            sha: execFileSync("git", ["rev-parse", "HEAD"], {
              encoding: "utf8",
            }).trim(),
            owners,
            ...after,
          },
          null,
          2
        ),
        { mode: 0o600 }
      )
    }
  } finally {
    await db.end()
    await restricted.end()
  }
  process.exit(0)
}
const monitorConfig = await privateEnvironment(join(root, "admin.env"))
const monitorURL = new URL(monitorConfig.ADMIN_URL!)
monitorURL.pathname = new URL(migration.DIRECT_URL!).pathname
const monitor = new pg.Pool({ connectionString: monitorURL.href, max: 1 })
const socket = createServer().listen(0, "127.0.0.1")
await once(socket, "listening")
const address = socket.address()
assert.ok(address && typeof address !== "string")
const origin = `http://127.0.0.1:${address.port}`
await new Promise<void>((resolve) => socket.close(() => resolve()))
const server = spawn(
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
server.stderr.resume()
await new Promise<void>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("START_TIMEOUT")), 20000)
  server.once("exit", () => {
    clearTimeout(timer)
    reject(new Error("EARLY_EXIT"))
  })
  server.stdout.on("data", (chunk) => {
    if (chunk.toString().includes("Ready")) {
      clearTimeout(timer)
      resolve()
    }
  })
})
const browser = await chromium.launch({ headless: true })
const a = await browser.newContext({
    baseURL: origin,
    serviceWorkers: "allow",
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
  staffPage = await staff.newPage()
const suffix = randomUUID().slice(0, 8)
const vehicle = {
  make: "Demo",
  model: `Demo100-${suffix}`,
  year: 2026,
  description: "Synthetic external vehicle",
}
const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Colombo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date())
const dateOffset = (days: number) =>
  new Date(new Date(`${today}T12:00:00Z`).valueOf() + days * 86400000)
    .toISOString()
    .slice(0, 10)
const policy = {
  path: "APPLICATION" as const,
  commission: { basis: "FINANCED_PRINCIPAL" as const, rateBps: 100 },
  processingFee: "250000",
  reconciliationMethod: "PER_DEAL" as const,
}
const contact = {
  name: "Synthetic agent",
  phone: "0112345678",
  role: "Agent",
  primary: true,
}
const env = (
  input: unknown,
  expected: Dependency[] = [],
  key = randomUUID()
) => ({ schemaVersion: 1, idempotencyKey: key, expected, input })
const post = (client: APIRequestContext, name: string, body: unknown) =>
  client.post(`/api/v1/commands/${name}`, { headers: { origin }, data: body })
async function applied(
  client: APIRequestContext,
  name: string,
  body: unknown
): Promise<Applied> {
  const r = await post(client, name, body)
  assert.ok(
    [200, 201].includes(r.status()),
    `${name} ${r.status()} ${(await r.text()).slice(0, 300)}`
  )
  return r.json()
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
async function read<T>(
  client: APIRequestContext,
  name: string,
  input: unknown
): Promise<T> {
  const r = await client.post(`/api/v1/queries/${name}`, {
    headers: { origin },
    data: input,
  })
  assert.equal(
    r.status(),
    200,
    `READ_${name}_${(await r.text()).slice(0, 150)}`
  )
  return (await r.json()).data
}
async function denied(
  r: Awaited<ReturnType<typeof post>>,
  status: number,
  code: string
) {
  assert.equal(r.status(), status, await r.text())
  assert.equal((await r.json()).error.code, code)
}
async function login(p: BrowserPage, who: "ADMIN" | "SECOND" | "STAFF") {
  await p.goto("/login")
  await p.getByLabel("Email Address").fill(accounts[`BOOTSTRAP_${who}_EMAIL`]!)
  await p
    .getByLabel("Password", { exact: true })
    .fill(accounts[`BOOTSTRAP_${who}_PASSWORD`]!)
  await p.getByRole("button", { name: "Sign In", exact: true }).click()
  await p.waitForURL("**/dashboard")
}
const company = (id: string) =>
  query<PartyDTO>(a.request, "party", `?type=FINANCE_COMPANY&id=${id}`)
const settings = () => query<QueryData["settings"]>(a.request, "settings")
const ref = (
  type: Dependency["type"],
  row: { id: string; revision: number }
): Dependency => ({ type, id: row.id, revision: row.revision })
const publishInput = (
  owner: PartyDTO,
  model = vehicle.model,
  maximum = "120000",
  through = dateOffset(30)
) => ({
  companyId: owner.id,
  make: vehicle.make,
  model,
  year: vehicle.year,
  validFrom: dateOffset(-1),
  validThrough: through,
  maximum,
  cards: [
    { principal: "100000", months: 12, installment: "9000" },
    { principal: "100000", months: 24, installment: "5000" },
  ],
})
const compare = (
  principal = "100000",
  term: { months: number } | { installment: string } = { months: 12 },
  model = vehicle.model,
  asOf = today
) => ({ vehicle: { ...vehicle, model }, principal, asOf, ...term })
const maxima = (model = vehicle.model, asOf = today) => ({
  vehicle: { make: vehicle.make, model, year: vehicle.year },
  asOf,
})
const counters = async () =>
  (
    await db.query(
      `SELECT (SELECT count(*)::text FROM vamotors."RateSheetVersion") AS sheets,(SELECT count(*)::text FROM vamotors."RateCardEntry") AS cards,(SELECT count(*)::text FROM vamotors."Quote") AS quotes,(SELECT count(*)::text FROM vamotors."AuditEntry") AS audits,(SELECT count(*)::text FROM vamotors."CommandReceipt") AS receipts,(SELECT count(*)::text FROM vamotors."EntityReadVersion") AS versions,(SELECT count(*)::text FROM vamotors."Vehicle") AS vehicles,(SELECT count(*)::text FROM vamotors."PurchaseRecord") AS purchases,(SELECT value::text FROM vamotors."BusinessSequence" WHERE id=1) AS sequence`
    )
  ).rows[0]
let stage = "initialize",
  groups = 0
const results: string[] = []
const sourceSHA = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim()
async function group(name: string, run: () => Promise<void>) {
  stage = name
  await run()
  groups++
  results.push(name)
  console.log(`PASS ${name}`)
}
let ca: PartyDTO,
  cb: PartyDTO,
  option: Extract<CompareResult, { status: "SUPPORTED" }>,
  quote: QuoteDTO,
  quoteRequest: ReturnType<typeof env>,
  quoteCommandId: string
try {
  if (process.argv[3] === "seed-parent") {
    assert.equal(sourceSHA, "b7ac9afb85218e7ec7fbaa0b006d0b165a19b3c3")
    await login(page, "ADMIN")
    const s = await settings()
    const created = await applied(
      a.request,
      "createFinanceCompany",
      env(
        {
          name: `Retained parent finance ${suffix}`,
          contacts: [contact],
          policy,
        },
        [ref("Settings", s)]
      )
    )
    const owner = await company(created.result.id)
    await applied(
      a.request,
      "updateFinanceCompany",
      env(
        {
          id: owner.id,
          name: owner.name,
          contacts: [contact],
          policy: {
            ...policy,
            processingFee: "123450",
            commission: { ...policy.commission, rateBps: 175 },
          },
          reason: "Retained second parent policy",
        },
        [ref("FinanceCompany", owner), ref("Settings", s)]
      )
    )
    await applied(
      a.request,
      "createDirectoryParty",
      env({
        type: "SUPPLIER",
        values: {
          name: `Retained parent supplier ${suffix}`,
          category: "COMPANY",
          contacts: [contact],
        },
      })
    )
    await applied(
      a.request,
      "createCustomer",
      env({
        fullName: `Retained parent customer ${suffix}`,
        callingName: "Retained",
        nicOrPassport: `PARENT-${suffix}`,
        address: "Synthetic Colombo",
        phone: "0771234567",
      })
    )
    console.log(
      `PASS exact-parent ${sourceSHA} real HTTP finance/policy/contact/customer/supplier fixtures`
    )
  } else {
    await group(
      "real administrator/staff browser sessions; anonymous/origin denial",
      async () => {
        await login(page, "ADMIN")
        await page.waitForFunction(
          () => navigator.serviceWorker.controller?.state === "activated",
          undefined,
          { timeout: 5000 }
        )
        assert.deepEqual(
          await page.evaluate(async () => {
            const r = await navigator.serviceWorker.ready
            return {
              scope: r.scope,
              active: r.active?.scriptURL,
              controller: navigator.serviceWorker.controller?.scriptURL,
            }
          }),
          {
            scope: `${origin}/`,
            active: `${origin}/sw.js`,
            controller: `${origin}/sw.js`,
          }
        )
        await login(mobile, "SECOND")
        await login(staffPage, "STAFF")
        assert.equal(
          (
            await anonymous.request.post("/api/v1/queries/loanMaxima", {
              headers: { origin },
              data: maxima(),
            })
          ).status(),
          401
        )
        assert.equal(
          (
            await a.request.post("/api/v1/queries/loanMaxima", {
              headers: { origin: "http://foreign.invalid" },
              data: maxima(),
            })
          ).status(),
          403
        )
        assert.equal(
          (await anonymous.request.get("/api/lease-rate-sheets")).status(),
          401
        )
      }
    )
    await group(
      "persistent finance directory and desktop/mobile UI publication exact synthetic A/B cards",
      async () => {
        const s = await settings()
        ca = await company(
          (
            await applied(
              a.request,
              "createFinanceCompany",
              env(
                { name: `Synthetic A ${suffix}`, contacts: [contact], policy },
                [ref("Settings", s)]
              )
            )
          ).result.id
        )
        cb = await company(
          (
            await applied(
              a.request,
              "createFinanceCompany",
              env(
                {
                  name: `Synthetic B ${suffix}`,
                  contacts: [contact],
                  policy: { ...policy, path: "REFERRAL" },
                },
                [ref("Settings", s)]
              )
            )
          ).result.id
        )
        for (const [p, owner, max, installments] of [
          [page, ca, "1200", ["90", "50"]],
          [mobile, cb, "1100", ["95", "55"]],
        ] as const) {
          await p.goto("/lease-rate-sheets")
          await p
            .getByLabel("Finance company", { exact: true })
            .selectOption(owner.id)
          for (const [label, value] of [
            ["Make", vehicle.make],
            ["Model", vehicle.model],
            ["Manufacture year", "2026"],
            ["Valid from", dateOffset(-1)],
            ["Valid through (inclusive)", dateOffset(30)],
            ["Maximum loan", max],
            ["Principal 1", "1000"],
            ["Months 1", "12"],
            ["Installment 1", installments[0]],
          ])
            await p.getByLabel(label, { exact: true }).fill(value)
          await p.getByRole("button", { name: "Add card", exact: true }).click()
          await p.getByLabel("Principal 2").fill("1000")
          await p.getByLabel("Months 2").fill("24")
          await p.getByLabel("Installment 2").fill(installments[1])
          const response = p.waitForResponse((r) =>
            r.url().endsWith("/commands/publishRates")
          )
          await p
            .getByRole("button", { name: "Publish rates", exact: true })
            .click()
          assert.equal((await response).status(), 201)
          await expect(
            p
              .getByRole("status")
              .filter({ hasText: "Published immutable sheet" })
          ).toBeVisible()
          assert.ok(
            await p.evaluate(
              () => document.documentElement.scrollWidth <= window.innerWidth
            ),
            "horizontal overflow"
          )
        }
        const rows = (
          await db.query(
            'SELECT s.maximum::text,c.principal::text,c.months,c.installment::text FROM vamotors."RateSheetVersion" s JOIN vamotors."RateCardEntry" c ON c."sheetVersionId"=s.id WHERE s."companyId"=ANY($1::uuid[]) ORDER BY s.maximum DESC,c.months',
            [[ca.id, cb.id]]
          )
        ).rows
        assert.deepEqual(rows, [
          {
            maximum: "120000",
            principal: "100000",
            months: 12,
            installment: "9000",
          },
          {
            maximum: "120000",
            principal: "100000",
            months: 24,
            installment: "5000",
          },
          {
            maximum: "110000",
            principal: "100000",
            months: 12,
            installment: "9500",
          },
          {
            maximum: "110000",
            principal: "100000",
            months: 24,
            installment: "5500",
          },
        ])
      }
    )
    await group(
      "maxima before principal is read-only; both directions identical exact cards; unsupported/over-limit/expired",
      async () => {
        const before = await counters()
        const max = await read<LoanMaximumDTO[]>(
          a.request,
          "loanMaxima",
          maxima()
        )
        assert.equal(max.find((r) => r.companyId === ca.id)?.maximum, "120000")
        assert.equal(max.find((r) => r.companyId === cb.id)?.maximum, "110000")
        for (const months of [12, 24]) {
          const byMonths = await read<CompareResult[]>(
            a.request,
            "compare",
            compare("100000", { months })
          )
          for (const result of byMonths.filter((r) =>
            [ca.id, cb.id].includes(r.companyId)
          )) {
            assert.equal(result.status, "SUPPORTED")
            if (result.status !== "SUPPORTED") throw new Error("NO_EXACT_CARD")
            const reverse = await read<CompareResult[]>(
              a.request,
              "compare",
              compare("100000", { installment: result.installment })
            )
            assert.deepEqual(
              reverse.find((r) => r.companyId === result.companyId),
              result
            )
            if (months === 12 && result.companyId === ca.id) option = result
          }
        }
        const unsupported = await read<CompareResult[]>(
          a.request,
          "compare",
          compare("100100")
        )
        assert.deepEqual(
          unsupported
            .filter((r) => [ca.id, cb.id].includes(r.companyId))
            .map((r) => r.status === "UNSUPPORTED" && r.reason),
          ["NO_CARD", "NO_CARD"]
        )
        const over = (
          await read<CompareResult[]>(a.request, "compare", compare("120100"))
        ).find((r) => r.companyId === ca.id)!
        assert.equal(over.maximum, "120000")
        assert.equal(over.status === "UNSUPPORTED" && over.reason, "OVER_LIMIT")
        assert.equal(over.sheetRevision, 1)
        const expired = (
          await read<CompareResult[]>(
            a.request,
            "compare",
            compare("100000", { months: 12 }, vehicle.model, dateOffset(31))
          )
        ).find((r) => r.companyId === ca.id)!
        assert.equal(
          expired.status === "UNSUPPORTED" && expired.reason,
          "EXPIRED"
        )
        assert.equal(expired.maximum, null)
        assert.deepEqual(await counters(), before)
        await mobile.goto("/lease-comparison")
        for (const [label, value] of [
          ["Make", vehicle.make],
          ["Model", vehicle.model],
          ["Manufacture year", "2026"],
        ])
          await mobile.getByLabel(label, { exact: true }).fill(value)
        await mobile
          .getByRole("button", { name: "Check loan maxima", exact: true })
          .click()
        await expect(
          mobile.getByRole("region", { name: "Company loan maxima" })
        ).toContainText("Maximum 1200.00")
        await expect(mobile.getByLabel("Requested principal")).toHaveValue("")
        await mobile.getByLabel("Requested principal").fill("1000")
        await mobile.getByLabel("Period (months)", { exact: true }).fill("12")
        await mobile
          .getByRole("button", { name: "Compare exact cards", exact: true })
          .click()
        await expect(
          mobile.getByRole("region", { name: "Exact comparison results" })
        ).toContainText("installment 90.00")
        assert.ok(
          await mobile.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth
          )
        )
        await mobile.getByLabel("Known term").selectOption("installment")
        await mobile
          .getByLabel("Installment amount", { exact: true })
          .fill("90")
        await mobile
          .getByRole("button", { name: "Compare exact cards", exact: true })
          .click()
        await expect(
          mobile.getByRole("region", { name: "Exact comparison results" })
        ).toContainText("12 months · installment 90.00")
      }
    )
    await group(
      "desktop keyboard quote selection → HTTP → immutable snapshot; same-key replay and snapshot policy retention",
      async () => {
        await page.goto("/lease-comparison")
        for (const [label, value] of [
          ["Make", vehicle.make],
          ["Model", vehicle.model],
          ["Manufacture year", "2026"],
          ["Requested principal", "1000"],
          ["Period (months)", "12"],
        ])
          await page.getByLabel(label, { exact: true }).fill(value)
        const compareButton = page.getByRole("button", {
          name: "Compare exact cards",
          exact: true,
        })
        await compareButton.focus()
        await page.keyboard.press("Enter")
        const card = page
          .getByRole("article")
          .filter({
            has: page.getByRole("heading", { name: ca.name, exact: true }),
          })
          .filter({ hasText: "installment 90.00" })
        await card.getByRole("button", { name: "Select exact option" }).click()
        await expect(
          page.getByText("Processing path", { exact: true })
        ).toBeVisible()
        await page.getByLabel("Document fees", { exact: true }).fill("25")
        await page.getByLabel("Government fees", { exact: true }).fill("10")
        const pending = page.waitForResponse((r) =>
          r.url().endsWith("/commands/selectQuote")
        )
        await page
          .getByRole("button", { name: "Save quote snapshot", exact: true })
          .click()
        const response = await pending
        assert.equal(response.status(), 201)
        quoteRequest = response.request().postDataJSON()
        const result = (await response.json()) as Applied
        quoteCommandId = result.commandId
        quote = await query<QuoteDTO>(
          a.request,
          "quote",
          `?id=${result.result.id}`
        )
        assert.equal(quote.principal, "100000")
        assert.equal(quote.maximum, "120000")
        assert.deepEqual(quote.charges, [
          { category: "DOCUMENT_FEES", amount: "2500" },
          { category: "GOVERNMENT_FEES", amount: "1000" },
        ])
        assert.deepEqual(quote.policy, policy)
        await expect(
          page.getByRole("heading", { name: "Saved quote handoff" })
        ).toBeVisible()
        await expect(
          page.getByRole("button", {
            name: "Open brokerage intake — not implemented",
          })
        ).toBeDisabled()
        const old = (
          await db.query(
            'SELECT to_jsonb(q) AS snapshot FROM vamotors."Quote" q WHERE id=$1',
            [quote.id]
          )
        ).rows[0].snapshot
        assert.equal(old.commissionExpected, 1000)
        assert.equal(old.companySnapshot.contacts[0].name, contact.name)
        assert.equal(old.settingsSnapshot.currency, "LKR")
        assert.ok(new Date(quote.expiresAt).valueOf() > Date.now())
        assert.ok(
          new Date(quote.expiresAt).valueOf() <=
            new Date(`${old.createdAt}Z`).valueOf() + 86400000,
          "expiry must not exceed UTC createdAt plus 24 hours"
        )
        const updated = await applied(
          a.request,
          "updateFinanceCompany",
          env(
            {
              id: ca.id,
              name: ca.name,
              contacts: [contact],
              policy: {
                ...policy,
                path: "REFERRAL",
                commission: { basis: "FINANCED_PRINCIPAL", rateBps: 300 },
                processingFee: "999900",
              },
              reason: "Synthetic future policy",
            },
            [ref("FinanceCompany", ca), ref("Settings", await settings())]
          )
        )
        ca = await company(updated.result.id)
        assert.deepEqual(
          (
            await db.query(
              'SELECT to_jsonb(q) AS snapshot FROM vamotors."Quote" q WHERE id=$1',
              [quote.id]
            )
          ).rows[0].snapshot,
          old
        )
        const loaded = await query<QuoteDTO>(
          a.request,
          "quote",
          `?id=${quote.id}`
        )
        assert.deepEqual(loaded.policy, policy)
        assert.equal(loaded.companyRevision, ca.revision)
        const before = await counters()
        const replay = await applied(a.request, "selectQuote", quoteRequest)
        assert.equal(replay.commandId, quoteCommandId)
        assert.equal(replay.replayed, true)
        assert.deepEqual(await counters(), before)
        await denied(
          await post(a.request, "selectQuote", {
            ...quoteRequest,
            idempotencyKey: randomUUID(),
          }),
          409,
          "STALE_REVISION"
        )
        await denied(
          await post(a.request, "selectQuote", {
            ...quoteRequest,
            input: { ...(quoteRequest.input as object), charges: [] },
          }),
          409,
          "IDEMPOTENCY_MISMATCH"
        )
        await mobile.goto(`/lease-comparison?quote=${quote.id}`)
        await expect(
          mobile.getByRole("heading", { name: "Saved quote handoff" })
        ).toBeVisible()
        await expect(
          mobile.getByText(`Quote ${quote.id}`, { exact: true })
        ).toBeVisible()
      }
    )
    await group(
      "strict duplicate/overlap/bounds/CAS/expiry/ambiguous negatives with zero writes",
      async () => {
        const before = await counters(),
          base = publishInput(ca)
        for (const patch of [
          { cards: [...base.cards, base.cards[0]] },
          { maximum: "99999" },
          { validFrom: dateOffset(40) },
          { actor: "forged" },
          { maximum: 120000 },
          { cards: [{ principal: "abc", months: 12, installment: "1" }] },
          { cards: [{ principal: "100000", months: 121, installment: "1" }] },
        ])
          await denied(
            await post(
              a.request,
              "publishRates",
              env({ ...base, ...patch }, [ref("FinanceCompany", ca)])
            ),
            422,
            "INVALID_INPUT"
          )
        await denied(
          await post(
            a.request,
            "publishRates",
            env(base, [ref("FinanceCompany", ca)])
          ),
          409,
          "IDENTITY_CONFLICT"
        )
        await denied(
          await post(
            a.request,
            "publishRates",
            env({ ...base, model: "missing-cas" })
          ),
          428,
          "REVISION_REQUIRED"
        )
        await denied(
          await post(
            a.request,
            "selectQuote",
            env(
              {
                sheetId: option.sheetId,
                cardId: randomUUID(),
                vehicle,
                charges: [],
              },
              [
                ref("FinanceCompany", ca),
                { type: "RateSheet", id: option.sheetId, revision: 1 },
                ref("Settings", await settings()),
              ]
            )
          ),
          422,
          "UNSUPPORTED_RATE"
        )
        assert.deepEqual(await counters(), before)
        const expiredModel = `expired-${suffix}`
        const expiredSheet = await applied(
          a.request,
          "publishRates",
          env(
            {
              ...base,
              model: expiredModel,
              validFrom: dateOffset(-3),
              validThrough: dateOffset(-1),
            },
            [ref("FinanceCompany", ca)]
          )
        )
        const expiredCard = (
          await db.query(
            'SELECT id FROM vamotors."RateCardEntry" WHERE "sheetVersionId"=$1 LIMIT 1',
            [expiredSheet.result.id]
          )
        ).rows[0].id
        await denied(
          await post(
            a.request,
            "selectQuote",
            env(
              {
                sheetId: expiredSheet.result.id,
                cardId: expiredCard,
                vehicle: { ...vehicle, model: expiredModel },
                charges: [],
              },
              [
                ref("FinanceCompany", ca),
                { type: "RateSheet", id: expiredSheet.result.id, revision: 1 },
                ref("Settings", await settings()),
              ]
            )
          ),
          409,
          "QUOTE_EXPIRED"
        )
        const ambiguousModel = `ambiguous-${suffix}`
        const closingModel = `closing-today-${suffix}`
        const closingSheet = await applied(
          a.request,
          "publishRates",
          env({ ...base, model: closingModel, validThrough: today }, [
            ref("FinanceCompany", ca),
          ])
        )
        const closingCard = (
          await db.query(
            'SELECT id FROM vamotors."RateCardEntry" WHERE "sheetVersionId"=$1 ORDER BY months LIMIT 1',
            [closingSheet.result.id]
          )
        ).rows[0].id
        const closing = await applied(
          a.request,
          "selectQuote",
          env(
            {
              sheetId: closingSheet.result.id,
              cardId: closingCard,
              vehicle: { ...vehicle, model: closingModel },
              charges: [],
            },
            [
              ref("FinanceCompany", ca),
              { type: "RateSheet", id: closingSheet.result.id, revision: 1 },
              ref("Settings", await settings()),
            ]
          )
        )
        assert.equal(
          new Date(
            (
              await query<QuoteDTO>(
                a.request,
                "quote",
                `?id=${closing.result.id}`
              )
            ).expiresAt
          ).valueOf(),
          new Date(`${today}T00:00:00+05:30`).valueOf() + 86400000
        )
        const nextDay = (
          await read<LoanMaximumDTO[]>(
            a.request,
            "loanMaxima",
            maxima(closingModel, dateOffset(1))
          )
        ).find((r) => r.companyId === ca.id)!
        assert.equal(
          nextDay.status === "UNAVAILABLE" && nextDay.reason,
          "EXPIRED"
        )
        assert.equal(nextDay.maximum, null)
        await applied(
          a.request,
          "publishRates",
          env(
            {
              ...base,
              model: ambiguousModel,
              cards: [
                { principal: "100000", months: 12, installment: "9000" },
                { principal: "100000", months: 24, installment: "9000" },
              ],
            },
            [ref("FinanceCompany", ca)]
          )
        )
        const result = (
          await read<CompareResult[]>(
            a.request,
            "compare",
            compare("100000", { installment: "9000" }, ambiguousModel)
          )
        ).find((r) => r.companyId === ca.id)!
        assert.equal(result.status, "UNSUPPORTED")
        if (result.status !== "UNSUPPORTED")
          throw new Error("AMBIGUITY_NOT_EXPLICIT")
        assert.equal(result.reason, "AMBIGUOUS")
        assert.equal(result.choices!.length, 2)
        assert.equal(result.maximum, "120000")
        assert.equal(result.sheetRevision, 1)
        const selected = await applied(
          a.request,
          "selectQuote",
          env(
            {
              sheetId: result.sheetId,
              cardId: result.choices![1].cardId,
              vehicle: { ...vehicle, model: ambiguousModel },
              charges: [],
            },
            [
              ref("FinanceCompany", ca),
              { type: "RateSheet", id: result.sheetId!, revision: 1 },
              ref("Settings", await settings()),
            ]
          )
        )
        assert.equal(
          (
            await query<QuoteDTO>(
              a.request,
              "quote",
              `?id=${selected.result.id}`
            )
          ).months,
          24
        )
      }
    )
    await group(
      "real permissions: own/foreign quote, company scoped rows, hidden policy/charges, explicit delegated handoff, immediate revocation",
      async () => {
        const actor = await query<QueryData["currentActor"]>(
          staff.request,
          "currentActor"
        )
        const baseGrants: Grant[] = [
          { subject: "FinanceCompany", action: "read", fields: ["*"] },
          { subject: "Settings", action: "read", fields: ["id", "revision"] },
          {
            subject: "RateSheet",
            action: "read",
            fields: ["*"],
            conditions: { financeCompanyId: ca.id },
          },
          { subject: "Quote", action: "create", fields: ["*"] },
          {
            subject: "Quote",
            action: "read",
            fields: ["*"],
            conditions: { createdBy: "$actor.id" },
          },
        ]
        const createdRole = await applied(
          a.request,
          "saveRole",
          env({
            name: `Rates scoped ${suffix}`,
            grants: baseGrants,
            reason: "Synthetic exact-rate proof",
          })
        )
        let role = await query<RoleDTO>(
          a.request,
          "role",
          `?id=${createdRole.result.id}`
        )
        const user = await query<UserAdminDTO>(
          a.request,
          "user",
          `?id=${actor.user.id}`
        )
        await applied(
          a.request,
          "updateUser",
          env(
            {
              id: user.id,
              name: user.name,
              active: true,
              roleIds: [role.id],
              reason: "Synthetic rate scope",
            },
            [ref("User", user), ref("Role", role)]
          )
        )
        const scoped = await read<CompareResult[]>(
          staff.request,
          "compare",
          compare()
        )
        assert.deepEqual(
          scoped.map((r) => r.companyId),
          [ca.id]
        )
        await denied(
          await staff.request.get(`/api/v1/queries/quote?id=${quote.id}`),
          404,
          "NOT_FOUND"
        )
        const s = await settings(),
          body = env(
            {
              sheetId: option.sheetId,
              cardId: option.cardId,
              vehicle,
              charges: [],
            },
            [
              ref("FinanceCompany", ca),
              { type: "RateSheet", id: option.sheetId, revision: 1 },
              ref("Settings", s),
            ]
          )
        const own = await applied(staff.request, "selectQuote", body)
        const ownQuote = await query<QuoteDTO>(
          staff.request,
          "quote",
          `?id=${own.result.id}`
        )
        assert.equal(ownQuote.createdBy, user.id)
        async function grants(next: Grant[]) {
          await applied(
            a.request,
            "saveRole",
            env(
              {
                id: role.id,
                name: role.name,
                grants: next,
                reason: "Synthetic current authority",
              },
              [ref("Role", role)]
            )
          )
          role = await query<RoleDTO>(a.request, "role", `?id=${role.id}`)
        }
        await grants(
          baseGrants.filter(
            (g) => !(g.subject === "Quote" && g.action === "read")
          )
        )
        const createOnly = await applied(
          staff.request,
          "selectQuote",
          env(body.input, body.expected)
        )
        await denied(
          await staff.request.get(
            `/api/v1/queries/quote?id=${createOnly.result.id}`
          ),
          404,
          "NOT_FOUND"
        )
        await grants(
          baseGrants.map((g) =>
            g.subject === "Quote" && g.action === "create"
              ? { ...g, fields: ["sheetId", "cardId", "vehicle"] }
              : g
          )
        )
        const noCharges = await counters()
        await denied(
          await post(
            staff.request,
            "selectQuote",
            env(
              {
                ...(body.input as object),
                charges: [{ category: "DOCUMENT_FEES", amount: "1" }],
              },
              body.expected
            )
          ),
          403,
          "FIELD_FORBIDDEN"
        )
        assert.deepEqual(await counters(), noCharges)
        await grants(baseGrants)
        await grants([
          ...baseGrants.filter(
            (g) => !(g.subject === "Quote" && g.action === "read")
          ),
          {
            subject: "Quote",
            action: "read",
            fields: [
              "id",
              "revision",
              "companyId",
              "companyRevision",
              "policy.path",
            ],
            conditions: { financeCompanyId: ca.id },
          },
        ])
        const partial = await query<Partial<QuoteDTO>>(
          staff.request,
          "quote",
          `?id=${quote.id}`
        )
        assert.equal(partial.policy?.path, "APPLICATION")
        assert.equal(partial.policy?.commission, undefined)
        assert.equal(partial.charges, undefined)
        await grants([
          ...baseGrants.filter((g) => g.subject !== "FinanceCompany"),
          {
            subject: "FinanceCompany",
            action: "read",
            fields: ["id", "name", "active"],
          },
          {
            subject: "Quote",
            action: "read",
            fields: ["*"],
            conditions: { financeCompanyId: ca.id },
          },
        ])
        const hiddenReference = await query<Partial<QuoteDTO>>(
          staff.request,
          "quote",
          `?id=${quote.id}`
        )
        assert.equal(hiddenReference.companyRevision, undefined)
        await denied(
          await post(
            staff.request,
            "selectQuote",
            env(body.input, body.expected)
          ),
          403,
          "FIELD_FORBIDDEN"
        )
        await grants([
          ...baseGrants,
          {
            subject: "Quote",
            action: "read",
            fields: ["*"],
            conditions: { financeCompanyId: ca.id },
          },
        ])
        assert.equal(
          (await query<QuoteDTO>(staff.request, "quote", `?id=${quote.id}`))
            .principal,
          "100000"
        )
        await staffPage.goto("/lease-comparison")
        for (const [label, value] of [
          ["Make", vehicle.make],
          ["Model", vehicle.model],
          ["Manufacture year", "2026"],
          ["Requested principal", "1000"],
          ["Period (months)", "12"],
        ])
          await staffPage.getByLabel(label, { exact: true }).fill(value)
        await staffPage
          .getByRole("button", { name: "Compare exact cards", exact: true })
          .click()
        await staffPage
          .getByRole("button", { name: "Select exact option" })
          .click()
        await staffPage.getByLabel("Document fees", { exact: true }).fill("25")
        await expect(
          staffPage.getByText("Processing path", { exact: true })
        ).toBeVisible()
        const blocker = await db.connect()
        try {
          await blocker.query("BEGIN")
          await blocker.query(
            'SELECT value FROM vamotors."BusinessSequence" WHERE id=1 FOR UPDATE'
          )
          const pending = staffPage.waitForResponse((r) =>
            r.url().endsWith("/commands/selectQuote")
          )
          await staffPage
            .getByRole("button", { name: "Save quote snapshot", exact: true })
            .click()
          let waiting = false
          for (let attempt = 0; attempt < 50; attempt++) {
            waiting =
              Number(
                (
                  await monitor.query(
                    "SELECT count(*) AS n FROM pg_stat_activity WHERE usename='vamotors_runtime' AND wait_event_type='Lock' AND query LIKE '%BusinessSequence%'"
                  )
                ).rows[0].n
              ) > 0
            if (waiting) break
            await new Promise((resolve) => setTimeout(resolve, 10))
          }
          assert.ok(
            waiting,
            "command must really wait before authority revocation"
          )
          await grants(
            baseGrants.filter(
              (g) => !(g.subject === "Quote" && g.action === "create")
            )
          )
          const counts = await counters()
          await blocker.query("COMMIT")
          assert.equal((await pending).status(), 403)
          await expect(
            staffPage.getByRole("alert").filter({ hasText: "FORBIDDEN" })
          ).toBeVisible()
          await expect(
            staffPage.getByLabel("Document fees", { exact: true })
          ).toHaveValue("25")
          await expect(
            staffPage.getByRole("region", { name: "Exact comparison results" })
          ).toHaveCount(0)
          await staffPage
            .getByRole("button", {
              name: "Retry identical quote request",
              exact: true,
            })
            .click()
          await expect(
            staffPage.getByRole("alert").filter({ hasText: "FORBIDDEN" })
          ).toBeVisible()
          assert.deepEqual(await counters(), counts)
        } finally {
          await blocker.query("ROLLBACK")
          blocker.release()
        }
        const before = await counters()
        await denied(
          await post(
            staff.request,
            "selectQuote",
            env(body.input, body.expected)
          ),
          403,
          "FORBIDDEN"
        )
        await denied(
          await post(staff.request, "selectQuote", body),
          403,
          "FORBIDDEN"
        )
        assert.deepEqual(await counters(), before)
        await grants([
          { subject: "FinanceCompany", action: "read", fields: ["*"] },
          {
            subject: "RateSheet",
            action: "read",
            fields: [
              "id",
              "revision",
              "companyId",
              "make",
              "model",
              "year",
              "validFrom",
              "validThrough",
            ],
          },
        ])
        await denied(
          await staff.request.post("/api/v1/queries/loanMaxima", {
            headers: { origin },
            data: maxima(),
          }),
          403,
          "FIELD_FORBIDDEN"
        )
        const extraResult = await applied(
          a.request,
          "saveRole",
          env({
            name: `Membership boundary ${suffix}`,
            grants: [],
            reason: "Synthetic changed-membership proof",
          })
        )
        const extra = await query<RoleDTO>(
          a.request,
          "role",
          `?id=${extraResult.result.id}`
        )
        const currentUser = await query<UserAdminDTO>(
          a.request,
          "user",
          `?id=${user.id}`
        )
        await applied(
          a.request,
          "updateUser",
          env(
            {
              id: user.id,
              name: currentUser.name,
              active: true,
              roleIds: [role.id, extra.id],
              reason: "Synthetic changed membership",
            },
            [ref("User", currentUser), ref("Role", role), ref("Role", extra)]
          )
        )
        const reload = staffPage.waitForEvent("domcontentloaded")
        await staffPage.evaluate(() =>
          window.dispatchEvent(new Event("auth-check"))
        )
        await reload
        await expect(
          staffPage.getByLabel("Document fees", { exact: true })
        ).toHaveCount(0)
        await expect(
          staffPage.getByLabel("Requested principal", { exact: true })
        ).toHaveValue("")
        await staffPage
          .getByLabel("Make", { exact: true })
          .fill(`Private identity draft ${suffix}`)
        await staff.clearCookies()
        await staff.addCookies(await b.cookies(origin))
        const identityReload = staffPage.waitForEvent("domcontentloaded")
        await staffPage.evaluate(() =>
          window.dispatchEvent(new Event("auth-check"))
        )
        await identityReload
        await expect(staffPage.getByLabel("Make", { exact: true })).toHaveValue(
          ""
        )
        assert.equal(
          (
            await query<QueryData["currentActor"]>(
              staff.request,
              "currentActor"
            )
          ).user.id,
          (await query<QueryData["currentActor"]>(b.request, "currentActor"))
            .user.id
        )
        assert.equal(
          await staffPage.evaluate(
            (marker) =>
              JSON.stringify({ ...localStorage, ...sessionStorage }).includes(
                marker
              ),
            suffix
          ),
          false
        )
      }
    )
    await group(
      "concurrent identical select exactly once; overlap race; essential audit fault atomic rollback; restricted grants",
      async () => {
        const s = await settings(),
          body = env(
            {
              sheetId: option.sheetId,
              cardId: option.cardId,
              vehicle,
              charges: [],
            },
            [
              ref("FinanceCompany", ca),
              { type: "RateSheet", id: option.sheetId, revision: 1 },
              ref("Settings", s),
            ]
          )
        const before = await counters(),
          results = await Promise.all([
            applied(a.request, "selectQuote", body),
            applied(a.request, "selectQuote", body),
          ])
        assert.equal(results[0].commandId, results[1].commandId)
        assert.equal(results[0].result.id, results[1].result.id)
        assert.equal(results.filter((r) => r.replayed).length, 1)
        const after = await counters()
        assert.equal(BigInt(after.quotes) - BigInt(before.quotes), 1n)
        assert.equal(BigInt(after.audits) - BigInt(before.audits), 1n)
        const overlap = publishInput(ca, `race-${suffix}`)
        const race = await Promise.all([
          post(
            a.request,
            "publishRates",
            env(overlap, [ref("FinanceCompany", ca)])
          ),
          post(
            b.request,
            "publishRates",
            env(overlap, [ref("FinanceCompany", ca)])
          ),
        ])
        assert.deepEqual(race.map((r) => r.status()).sort(), [201, 409])
        await db.query(
          `CREATE FUNCTION vamotors.t11a_audit_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."entityType" IN ('RateSheet','Quote') THEN RAISE EXCEPTION 'SYNTHETIC_AUDIT_FAULT'; END IF; RETURN NEW; END $$; CREATE TRIGGER t11a_audit_fault BEFORE INSERT ON vamotors."AuditEntry" FOR EACH ROW EXECUTE FUNCTION vamotors.t11a_audit_fault()`
        )
        try {
          const counts = await counters()
          assert.equal(
            (
              await post(
                a.request,
                "selectQuote",
                env(body.input, body.expected)
              )
            ).status(),
            500
          )
          assert.deepEqual(await counters(), counts)
          await page.goto("/lease-rate-sheets")
          await page
            .getByLabel("Finance company", { exact: true })
            .selectOption(ca.id)
          for (const [label, value] of [
            ["Make", vehicle.make],
            ["Model", `transient-${suffix}`],
            ["Manufacture year", "2026"],
            ["Valid from", dateOffset(-1)],
            ["Valid through (inclusive)", dateOffset(30)],
            ["Maximum loan", "1200"],
            ["Principal 1", "1000"],
            ["Months 1", "12"],
            ["Installment 1", "90"],
          ])
            await page.getByLabel(label, { exact: true }).fill(value)
          await page
            .getByRole("button", { name: "Publish rates", exact: true })
            .click()
          await expect(
            page.getByRole("alert").filter({ hasText: "INTERNAL_ERROR" })
          ).toBeVisible()
          await expect(
            page.getByLabel("Maximum loan", { exact: true })
          ).toHaveValue("1200")
          assert.deepEqual(await counters(), counts)
        } finally {
          await db.query(
            'DROP TRIGGER t11a_audit_fault ON vamotors."AuditEntry"; DROP FUNCTION vamotors.t11a_audit_fault()'
          )
        }
        const retry = page.waitForResponse((r) =>
          r.url().endsWith("/commands/publishRates")
        )
        await page
          .getByRole("button", {
            name: "Retry identical publication",
            exact: true,
          })
          .click()
        const retried = await retry
        assert.equal(retried.status(), 201)
        const retryBody = retried.request().postDataJSON() as {
          idempotencyKey: string
        }
        assert.equal(
          Number(
            (
              await db.query(
                'SELECT count(*) AS n FROM vamotors."CommandReceipt" WHERE "idempotencyKey"=$1',
                [retryBody.idempotencyKey]
              )
            ).rows[0].n
          ),
          1
        )
        await page
          .getByLabel("Model", { exact: true })
          .fill(`lost-response-${suffix}`)
        let committed: Applied | undefined,
          exactLostBody: string | null = null,
          workerOwned = false
        const lostPath = "**/api/v1/commands/publishRates"
        await a.route(lostPath, async (route) => {
          exactLostBody = route.request().postData()
          workerOwned = !!route.request().serviceWorker()
          const result = await route.fetch()
          assert.equal(result.status(), 201)
          committed = (await result.json()) as Applied
          await route.abort("failed")
        })
        try {
          await page
            .getByRole("button", { name: "Publish rates", exact: true })
            .click()
          await expect(
            page.getByRole("alert").filter({ hasText: "NETWORK_ERROR" })
          ).toBeVisible()
          assert.ok(committed)
          assert.equal(
            await page.evaluate(
              () => navigator.serviceWorker.controller?.scriptURL
            ),
            `${origin}/sw.js`
          )
          assert.equal(
            workerOwned,
            false,
            "accepted worker deliberately does not intercept or queue POST writes"
          )
        } finally {
          await a.unroute(lostPath)
        }
        const committedCounts = await counters()
        const lostReplay = page.waitForResponse((r) =>
          r.url().endsWith("/commands/publishRates")
        )
        await page
          .getByRole("button", {
            name: "Retry identical publication",
            exact: true,
          })
          .click()
        const replayResponse = await lostReplay
        assert.equal(replayResponse.status(), 200)
        assert.equal(replayResponse.request().postData(), exactLostBody)
        const replayed = (await replayResponse.json()) as Applied
        assert.equal(replayed.replayed, true)
        assert.equal(replayed.commandId, committed!.commandId)
        assert.equal(replayed.result.id, committed!.result.id)
        assert.deepEqual(await counters(), committedCounts)
        for (const sql of [
          'UPDATE vamotors."Quote" SET revision=2',
          'DELETE FROM vamotors."RateSheetVersion"',
          'TRUNCATE vamotors."RateCardEntry"',
          "CREATE TABLE vamotors.t11a_forbidden(id int)",
        ])
          await assert.rejects(restricted.query(sql))
        const cardSQL =
          'INSERT INTO vamotors."RateCardEntry"(id,"sheetVersionId",principal,months,installment) VALUES($1,$2,$3,$4,$5)'
        await assert.rejects(
          restricted.query(cardSQL, [
            randomUUID(),
            option.sheetId,
            "100000",
            36,
            "3000",
          ]),
          { code: "23514", message: "IMMUTABLE_RATE_CARDS" }
        )
        await assert.rejects(
          restricted.query(cardSQL, [
            randomUUID(),
            option.sheetId,
            "100000",
            12,
            "9000",
          ]),
          { code: "23505" }
        )
        await assert.rejects(
          restricted.query(cardSQL, [
            randomUUID(),
            option.sheetId,
            "120001",
            36,
            "3000",
          ]),
          { code: "23514", message: "RATE_BOUNDS" }
        )
        const evidence = (
          await db.query(
            'SELECT (SELECT count(*) FROM vamotors."AuditEntry" WHERE "commandId"=$1)::int AS audits,(SELECT count(*) FROM vamotors."EntityReadVersion" WHERE "commandId"=$1)::int AS versions',
            [quoteCommandId]
          )
        ).rows[0]
        assert.deepEqual(evidence, { audits: 1, versions: 1 })
        assert.equal(after.vehicles, before.vehicles)
        assert.equal(after.purchases, before.purchases)
      }
    )
    await group(
      "inactive company excluded and cannot publish; retained UI validation values and identical retry after server rejection",
      async () => {
        await applied(
          a.request,
          "archiveParty",
          env(
            {
              type: "FINANCE_COMPANY",
              id: cb.id,
              active: false,
              reason: "Synthetic inactive proof",
            },
            [ref("FinanceCompany", cb)]
          )
        )
        cb = await company(cb.id)
        assert.ok(
          !(
            await read<LoanMaximumDTO[]>(a.request, "loanMaxima", maxima())
          ).some((r) => r.companyId === cb.id)
        )
        assert.ok(
          !(await read<CompareResult[]>(a.request, "compare", compare())).some(
            (r) => r.companyId === cb.id
          )
        )
        await denied(
          await post(
            a.request,
            "publishRates",
            env(publishInput(cb, `inactive-${suffix}`), [
              ref("FinanceCompany", cb),
            ])
          ),
          409,
          "INVALID_STATE"
        )
        await page.goto("/lease-rate-sheets")
        await page
          .getByLabel("Finance company", { exact: true })
          .selectOption(ca.id)
        for (const [label, value] of [
          ["Make", vehicle.make],
          ["Model", vehicle.model],
          ["Manufacture year", "2026"],
          ["Valid from", dateOffset(-1)],
          ["Valid through (inclusive)", dateOffset(30)],
          ["Maximum loan", "1200"],
          ["Principal 1", "1000"],
          ["Months 1", "12"],
          ["Installment 1", "90"],
        ])
          await page.getByLabel(label, { exact: true }).fill(value)
        const requests: string[] = []
        page.on("request", (r) => {
          if (r.url().endsWith("/commands/publishRates"))
            requests.push(r.postData()!)
        })
        await page
          .getByRole("button", { name: "Publish rates", exact: true })
          .click()
        await expect(
          page.getByRole("alert").filter({ hasText: "IDENTITY_CONFLICT" })
        ).toBeVisible()
        await expect(
          page.getByLabel("Maximum loan", { exact: true })
        ).toHaveValue("1200")
        await page
          .getByRole("button", {
            name: "Retry identical publication",
            exact: true,
          })
          .click()
        await expect(
          page.getByRole("alert").filter({ hasText: "IDENTITY_CONFLICT" })
        ).toBeVisible()
        assert.equal(requests.length, 2)
        assert.equal(requests[0], requests[1])
        await page
          .getByRole("button", {
            name: "Confirm new request with refreshed references",
          })
          .click()
        await expect(
          page.getByLabel("Maximum loan", { exact: true })
        ).toHaveValue("1200")
        await page.getByLabel("Principal 1").fill("1201")
        await page
          .getByRole("button", { name: "Publish rates", exact: true })
          .click()
        await expect(
          page.getByRole("alert").filter({ hasText: "Check dates" })
        ).toBeVisible()
        await expect(page.getByLabel("Principal 1")).toHaveValue("1201")
      }
    )
    console.log(
      `PASS ${groups} T11a real production groups; Chromium ${browser.version()}; desktop1920/mobile360; local PostgreSQL ${cluster.PORT}; no mock invariant proof, brokerage or inventory intake.`
    )
    await writeFile(
      join(root, `rates-${suffix}.json`),
      JSON.stringify(
        {
          sourceSHA,
          dirty:
            execFileSync("git", ["status", "--porcelain"], {
              encoding: "utf8",
            }).trim().length > 0,
          groups,
          results,
          browser: browser.version(),
          activeServiceWorker: `${origin}/sw.js`,
          viewport: [1920, 360],
          counts: await counters(),
        },
        null,
        2
      ),
      { mode: 0o600 }
    )
  }
} catch (error) {
  console.error(
    `FAIL T11a stage=${stage} ${error instanceof Error ? error.message.slice(0, 1200) : "unknown"}`
  )
  process.exitCode = 1
} finally {
  await browser.close()
  const ended = once(server, "exit")
  server.kill("SIGTERM")
  await ended
  await db.end()
  await restricted.end()
  await monitor.end()
}
