/** Focused production HTTP/Chromium regression on an owned genuine-parent upgrade. */
import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { spawn, execFileSync } from "node:child_process"
import { once } from "node:events"
import { createServer } from "node:net"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { chromium, expect } from "@playwright/test"
import pg from "pg"
import { privateEnvironment } from "../../scripts/private-environment"
import { canonical } from "../../lib/server/idempotency"
import { expanded, grantSchema } from "../../lib/server/permissions"
import type { Grant } from "../../.planning/implementation/contracts/api"

process.umask(0o077)
const root = process.argv[2]
assert.ok(root)
const runtime = await privateEnvironment(join(root, "runtime.env")),
  migration = await privateEnvironment(join(root, "migration.env")),
  accounts = await privateEnvironment(join(root, "accounts.env")),
  parent = JSON.parse(
    await readFile(join(root, "t05a-parent-before.json"), "utf8")
  )
assert.equal(runtime.APP_ENV, "local")
assert.equal(new URL(runtime.DATABASE_URL!).hostname, "127.0.0.1")
assert.equal(new URL(migration.DIRECT_URL!).hostname, "127.0.0.1")
assert.equal(parent.parent, "7573c54532c5f80edef3d8eaa452720d018f5d1b")
assert.equal(parent.inventory.migrations.length, 7)
assert.ok(
  parent.ids.identityRole,
  "prepare must include the old compound identity role"
)
const db = new pg.Client({ connectionString: migration.DIRECT_URL })
await db.connect()
const user = "03000000-0000-4000-8000-000000000013",
  originalRoles = (
    await db.query(
      'SELECT "roleId","assignedBy","assignedAt"::text AS "assignedAt" FROM vamotors."UserRole" WHERE "userId"=$1 ORDER BY "roleId"',
      [user]
    )
  ).rows,
  run = randomUUID(),
  results: string[] = [],
  observations: {
    role: string
    name: string
    params: string
    status: number
  }[] = []
const snapshot = async () => {
  const rows: Record<string, unknown> = {}
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
  ])
    rows[table] = (
      await db.query(
        `SELECT to_jsonb(t) AS row FROM vamotors."${table}" t ORDER BY id`
      )
    ).rows
  return canonical(rows)
}
const before = await snapshot()
async function assign(roleIds: string[], restore = false) {
  await db.query("BEGIN")
  try {
    await db.query(
      'SELECT value FROM vamotors."BusinessSequence" WHERE id=1 FOR UPDATE'
    )
    await db.query("SELECT vamotors.lock_admin_guard()")
    await db.query('DELETE FROM vamotors."UserRole" WHERE "userId"=$1', [user])
    for (const roleId of roleIds) {
      const original = restore
        ? originalRoles.find((r) => r.roleId === roleId)
        : undefined
      await db.query(
        'INSERT INTO vamotors."UserRole"("userId","roleId","assignedBy","assignedAt") VALUES($1,$2,$3,COALESCE($4,CURRENT_TIMESTAMP))',
        [
          user,
          roleId,
          original?.assignedBy ?? "03000000-0000-4000-8000-000000000011",
          original?.assignedAt ?? null,
        ]
      )
    }
    await db.query(
      'UPDATE vamotors."user" SET "authzRevision"="authzRevision"+1 WHERE id=$1',
      [user]
    )
    await db.query("SET CONSTRAINTS ALL IMMEDIATE")
    await db.query("COMMIT")
  } catch (error) {
    await db.query("ROLLBACK")
    throw error
  }
}
async function role(grants: Grant[]) {
  const id = randomUUID()
  await db.query("BEGIN")
  try {
    await db.query("SELECT vamotors.lock_admin_guard()")
    await db.query('INSERT INTO vamotors."Role"(id,name) VALUES($1,$2)', [
      id,
      `R1 ${id}`,
    ])
    for (const raw of grants) {
      const rule = grantSchema.parse(raw),
        hash = createHash("sha256").update(canonical(rule)).digest("hex")
      await db.query(
        'INSERT INTO vamotors."Permission"(id,"ruleHash",rule) VALUES($1,$2,$3) ON CONFLICT("ruleHash") DO NOTHING',
        [randomUUID(), hash, rule]
      )
      await db.query(
        'INSERT INTO vamotors."RolePermission" SELECT $1,id FROM vamotors."Permission" WHERE "ruleHash"=$2',
        [id, hash]
      )
    }
    await db.query("COMMIT")
  } catch (error) {
    await db.query("ROLLBACK")
    throw error
  }
  await assign([id])
}
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
const browser = await chromium.launch({ headless: true }),
  context = await browser.newContext({ baseURL: origin }),
  page = await context.newPage()
let label = "initialize",
  failure: string | undefined
async function query(name: string, params = "", status = 200) {
  const r = await context.request.get(`/api/v1/queries/${name}${params}`)
  observations.push({ role: label, name, params, status: r.status() })
  assert.equal(r.status(), status, `${label}: ${name}${params}`)
  assert.match(r.headers()["cache-control"], /no-store/)
  const body = await r.json()
  if (status === 403) {
    assert.deepEqual(Object.keys(body).sort(), ["error", "ok"])
    assert.equal(body.ok, false)
    assert.deepEqual(Object.keys(body.error).sort(), [
      "code",
      "message",
      "requestId",
      "retryable",
    ])
    assert.equal(body.error.code, "FIELD_FORBIDDEN")
    assert.equal(body.error.message, "FIELD_FORBIDDEN")
    assert.equal(body.error.retryable, false)
    assert.equal(typeof body.error.requestId, "string")
  }
  return body.data
}
const searchLeaves = [
    "identity.make",
    "identity.model",
    "identity.engineNumber",
    "identity.chassisNumber",
  ],
  vehicleGrant = (
    fields: string[],
    conditions?: Grant["conditions"]
  ): Grant => ({
    subject: "Vehicle",
    action: "read",
    fields: ["id", ...fields],
    ...(conditions ? { conditions } : {}),
  }),
  purchaseGrant = (conditions?: Grant["conditions"]): Grant => ({
    subject: "PurchaseRecord",
    action: "read",
    fields: ["id", ...searchLeaves],
    ...(conditions ? { conditions } : {}),
  }),
  own = { createdBy: "$actor.id" } as const,
  params = [
    "?make=Synthetic",
    "?model=Genuine%20parent%20fixture",
    "?q=Synthetic",
  ]
async function positive(name = "inventory") {
  const list = await query(name)
  assert.ok(list.total > 0)
  for (const p of name === "inventory" ? params : ["?q=Synthetic"]) {
    const data = await query(name, p)
    assert.equal(data.total, 1)
    assert.equal(data.data.length, 1)
    assert.equal(
      data.data[0].id,
      name === "inventory" ? parent.ids.vehicle : parent.ids.purchase
    )
  }
}
async function ui(denied = false) {
  await page.goto("/vehicles")
  await expect(
    page.getByRole("status").filter({ hasText: /\d+ records/ })
  ).toBeVisible()
  await page
    .getByLabel("Search make, model, engine or chassis")
    .fill("Synthetic")
  await page.getByRole("button", { name: "Search", exact: true }).click()
  if (denied) {
    // The shared private client clears cached private data and returns to login
    // on 403; do not weaken that boundary just to retain an inline list error.
    await page.waitForURL("**/login?reason=access-changed")
    await expect(
      page.getByRole("alert").filter({ hasText: "Access changed" })
    ).toBeVisible()
    await expect(
      page.getByRole("status").filter({ hasText: /\d+ records/ })
    ).toHaveCount(0)
    await expect(
      page.getByRole("heading", { name: "Synthetic Genuine parent fixture" })
    ).toHaveCount(0)
  } else {
    await expect(
      page.getByRole("status").filter({ hasText: "1 records" })
    ).toBeVisible()
    await expect(
      page.getByRole("heading", { name: "Synthetic Genuine parent fixture" })
    ).toBeVisible()
  }
}
try {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("START_TIMEOUT")), 20000)
    server.once("exit", () => {
      clearTimeout(timer)
      reject(new Error("EARLY_EXIT"))
    })
    server.stdout.on("data", (c) => {
      if (c.toString().includes("Ready")) {
        clearTimeout(timer)
        resolve()
      }
    })
  })
  await page.goto("/login")
  await page.getByLabel("Email Address").fill(accounts.BOOTSTRAP_STAFF_EMAIL!)
  await page
    .getByLabel("Password", { exact: true })
    .fill(accounts.BOOTSTRAP_STAFF_PASSWORD!)
  await page.getByRole("button", { name: "Sign In", exact: true }).click()
  await page.waitForURL("**/dashboard")
  for (const key of ["role", "identityRole"]) {
    label = `retained ${key}`
    const grants = (
      await db.query(
        'SELECT p.rule FROM vamotors."RolePermission" rp JOIN vamotors."Permission" p ON p.id=rp."permissionId" WHERE rp."roleId"=$1',
        [parent.ids[key]]
      )
    ).rows.map((r) => grantSchema.parse(r.rule) as Grant)
    assert.ok(grants.length)
    assert.ok(
      grants.every(
        (g) => !g.fields.includes("*") && !g.fields.includes("identity")
      )
    )
    for (const leaf of searchLeaves)
      assert.ok(
        grants.some(
          (g) => g.subject === "Vehicle" && expanded(g).includes(leaf)
        )
      )
    await assign([parent.ids[key]])
    // Collect all three exact baseline symptoms before asserting, not only the first failure.
    await query("inventory")
    const statuses = []
    for (const p of params) {
      const r = await context.request.get(`/api/v1/queries/inventory${p}`)
      observations.push({
        role: label,
        name: "inventory",
        params: p,
        status: r.status(),
      })
      statuses.push(r.status())
    }
    assert.deepEqual(statuses, [200, 200, 200], `${label}: make/model/q`)
    await positive()
    // Old PurchaseRecord '*' never covered identity: do not widen that ceiling.
    await query("purchases", "?q=Synthetic", 403)
    await ui()
    results.push(label)
  }
  label = "explicit make-only"
  await role([vehicleGrant(["identity.make"]), purchaseGrant()])
  assert.equal((await query("inventory", params[0])).total, 1)
  await query("inventory", params[1], 403)
  await query("inventory", params[2], 403)
  await ui(true)
  results.push(label)
  label = "explicit model-only"
  await role([vehicleGrant(["identity.model"]), purchaseGrant()])
  assert.equal((await query("inventory", params[1])).total, 1)
  await query("inventory", params[0], 403)
  await query("inventory", params[2], 403)
  results.push(label)
  label = "explicit exact search leaves"
  await role([vehicleGrant(searchLeaves), purchaseGrant()])
  await positive()
  await positive("purchases")
  await ui()
  for (const field of ["listedPrice", "status", "available"])
    await query(
      "inventory",
      `?sort=${encodeURIComponent(JSON.stringify([{ field, direction: "asc" }]))}`,
      403
    )
  for (const p of [
    '?statuses=["PURCHASED"]',
    "?available=false",
    "?from=2026-10-01",
  ])
    await query("inventory", p, 403)
  await query(
    "purchases",
    '?sort=[{"field":"purchasePrice","direction":"asc"}]',
    403
  )
  results.push(label)
  for (const leaf of searchLeaves) {
    label = `missing ${leaf}`
    await role([
      vehicleGrant(searchLeaves.filter((f) => f !== leaf)),
      purchaseGrant(),
    ])
    await query("inventory")
    for (const name of ["inventory", "purchases"])
      for (const p of [
        "?q=Synthetic",
        "?q=NoSuchHiddenValue&page=2&pageSize=10",
      ])
        await query(name, p, 403)
    if (leaf === "identity.make") await query("inventory", params[0], 403)
    if (leaf === "identity.model") await query("inventory", params[1], 403)
    results.push(label)
  }
  for (const leaf of searchLeaves) {
    label = `missing PurchaseRecord ${leaf}`
    await role([
      vehicleGrant(searchLeaves),
      {
        ...purchaseGrant(),
        fields: ["id", ...searchLeaves.filter((f) => f !== leaf)],
      },
    ])
    await query("purchases")
    await query("purchases", "?q=Synthetic", 403)
    // Inventory search consumes Vehicle identity, not PurchaseRecord identity.
    await positive()
    results.push(label)
  }
  label = "same-population per-field union"
  await role([...searchLeaves.map((f) => vehicleGrant([f])), purchaseGrant()])
  await positive("inventory")
  await positive("purchases")
  results.push(label)
  label = "disjoint per-field populations cannot expand records"
  await role([
    vehicleGrant(searchLeaves.slice(0, 2)),
    vehicleGrant(searchLeaves.slice(2), own),
    purchaseGrant(),
  ])
  await query("inventory", "?q=Synthetic", 403)
  await query("purchases", "?q=Synthetic", 403)
  results.push(label)
  for (const source of ["Vehicle", "PurchaseRecord"]) {
    label = `mixed public/private ${source}`
    await role(
      source === "Vehicle"
        ? [vehicleGrant([]), vehicleGrant(searchLeaves, own), purchaseGrant()]
        : [
            vehicleGrant(searchLeaves),
            purchaseGrant(),
            { ...purchaseGrant(own), fields: ["purchasePrice"] },
          ]
    )
    if (source === "Vehicle") {
      await query("inventory", "?q=Synthetic", 403)
      await query("purchases", "?q=Synthetic", 403)
    } else {
      await query(
        "purchases",
        '?sort=[{"field":"purchasePrice","direction":"asc"}]',
        403
      )
    }
    results.push(label)
  }
  for (const source of ["Vehicle", "PurchaseRecord", "both"]) {
    label = `own-record ${source} scope and count`
    await role([
      ...searchLeaves.map((f) =>
        vehicleGrant([f], source !== "PurchaseRecord" ? own : undefined)
      ),
      purchaseGrant(source !== "Vehicle" ? own : undefined),
    ])
    for (const name of ["inventory", "purchases"])
      for (const p of ["", "?q=Synthetic"]) {
        const data = await query(name, p)
        if (source === "Vehicle" && name === "purchases" && !p) {
          // An unfiltered purchase list has its own record scope. Its unreadable
          // physical identity must be redacted, not used to shrink that list.
          assert.equal(data.total, 1)
          assert.equal(data.data[0].id, parent.ids.purchase)
          assert.equal("identity" in data.data[0], false)
        } else {
          assert.equal(data.total, 0)
          assert.deepEqual(data.data, [])
        }
      }
    results.push(label)
  }
  assert.equal(await snapshot(), before, "no business data effects")
} catch (error) {
  failure =
    error instanceof assert.AssertionError
      ? error.message
      : error instanceof Error &&
          !/postgres|password|connection/i.test(error.message)
        ? error.message
        : "Private failure diagnostics withheld"
  process.exitCode = 1
} finally {
  try {
    await assign(
      originalRoles.map((r) => r.roleId),
      true
    )
    assert.deepEqual(
      (
        await db.query(
          'SELECT "roleId","assignedBy","assignedAt"::text AS "assignedAt" FROM vamotors."UserRole" WHERE "userId"=$1 ORDER BY "roleId"',
          [user]
        )
      ).rows,
      originalRoles,
      "exact staff assignments restored"
    )
  } finally {
    await browser.close()
    if (server.exitCode === null) {
      const end = once(server, "exit")
      server.kill("SIGTERM")
      await end
    }
  }
  const unchanged = (await snapshot()) === before
  await writeFile(
    join(root, `purchase-predicates-${run}.json`),
    JSON.stringify(
      {
        head: execFileSync("git", ["rev-parse", "HEAD"], {
          encoding: "utf8",
        }).trim(),
        dirty: !!execFileSync("git", ["status", "--porcelain"], {
          encoding: "utf8",
        }).trim(),
        origin,
        results,
        observations,
        failure,
        unchanged,
        restoredRoles: true,
        note: "Author evidence only; independent acceptance pending",
      },
      null,
      2
    ),
    { mode: 0o600 }
  )
  await db.end()
  console.log(
    `${failure ? "FAIL" : "PASS"} ${results.length} predicate groups; ${label}; unchanged=${unchanged}; evidence: ${root}/purchase-predicates-${run}.json`
  )
  if (failure) console.error(failure)
  assert.ok(unchanged)
}
