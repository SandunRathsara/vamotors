/** R1: real sessions, production HTTP/UI and immutable PostgreSQL audit rows. */
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { spawn, execFileSync, type ChildProcess } from "node:child_process"
import { once } from "node:events"
import { createServer } from "node:net"
import { join } from "node:path"
import { writeFile } from "node:fs/promises"
import { chromium, expect, type Page } from "@playwright/test"
import pg from "pg"
import { privateEnvironment } from "../../scripts/private-environment"
import type {
  Applied,
  CurrentActorDTO,
  Dependency,
  Grant,
  PurchaseCycleDTO,
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
const db = new pg.Pool({ connectionString: migration.DIRECT_URL, max: 1 })
const socket = createServer().listen(0, "127.0.0.1")
await once(socket, "listening")
const address = socket.address()
assert.ok(address && typeof address !== "string")
const origin = `http://127.0.0.1:${address.port}`
await new Promise<void>((resolve) => socket.close(() => resolve()))
let server: ChildProcess | undefined
const browser = await chromium.launch({ headless: true }),
  admin = await browser.newContext({ baseURL: origin }),
  staff = await browser.newContext({ baseURL: origin }),
  page = await admin.newPage(),
  limited = await staff.newPage()
const suffix = randomUUID().slice(0, 8),
  results: string[] = [],
  fixtures: { row: PurchaseCycleDTO; commandId: string; reason: string }[] = []
let original: CurrentActorDTO | undefined
const envelope = (input: unknown, expected: Dependency[] = []) => ({
  schemaVersion: 1,
  idempotencyKey: randomUUID(),
  expected,
  input,
})
const ref = (
  row: { id: string; revision: number },
  type: Dependency["type"] = "PurchaseRecord"
): Dependency => ({ type, id: row.id, revision: row.revision })
async function command(name: string, input: unknown, status = 200) {
  const response = await admin.request.post(`/api/v1/commands/${name}`, {
    data: input,
    headers: { Origin: origin },
  })
  assert.equal(response.status(), status, name)
  return (await response.json()) as Applied
}
async function query<T>(name: string, params = "", client = staff.request) {
  const response = await client.get(`/api/v1/queries/${name}${params}`)
  assert.equal(response.status(), 200, name)
  assert.match(response.headers()["cache-control"], /no-store/)
  return (await response.json()).data as T
}
const current = (id: string) =>
  query<PurchaseCycleDTO>("purchase", `?cycleId=${id}`, admin.request)
async function login(p: Page, who: "ADMIN" | "STAFF") {
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
async function setRoles(roleIds: string[]) {
  const user = await query<{ id: string; revision: number; name: string }>(
    "user",
    `?id=${original!.user.id}`,
    admin.request
  )
  const roles = await Promise.all(
    roleIds.map((id) =>
      query<{ id: string; revision: number }>(
        "role",
        `?id=${id}`,
        admin.request
      )
    )
  )
  await command(
    "updateUser",
    envelope(
      {
        id: user.id,
        name: user.name,
        active: true,
        roleIds,
        reason: "Synthetic R1 current authority",
      },
      [ref(user, "User"), ...roles.map((r) => ref(r, "Role"))]
    )
  )
}
async function assign(
  purchase: boolean,
  vehicle: boolean,
  auditReason = true,
  conditional = false
) {
  const grants: Grant[] = [
    {
      subject: "PurchaseRecord",
      action: "read",
      fields: [
        "id",
        "revision",
        "vehicleId",
        "identity",
        "status",
        "available",
      ],
    },
    {
      subject: "Vehicle",
      action: "read",
      fields: ["id", "revision", "identity", "cycleId", "status", "available"],
    },
    {
      subject: "AuditLog",
      action: "read",
      fields: auditReason
        ? ["*"]
        : ["id", "entityType", "entityId", "action", "actor", "at", "fields"],
    },
  ]
  for (const [subject, enabled] of [
    ["PurchaseRecord", purchase],
    ["Vehicle", vehicle],
  ] as const)
    if (enabled)
      grants.push({
        subject,
        action: "read",
        fields: ["holdReason"],
        ...(conditional ? { conditions: { createdBy: "$actor.id" } } : {}),
      })
  const role = await command(
    "saveRole",
    envelope({
      name: `R1-${suffix}-${randomUUID()}`,
      reason: "Synthetic R1 grants",
      grants,
    }),
    201
  )
  await setRoles([role.result.id])
}
type Audit = {
  id: string
  action: string
  reason?: string
  fields: { path: string; before: unknown; after: unknown }[]
  redactedFields: string[]
}
async function check(
  label: string,
  purchase: boolean,
  vehicle: boolean,
  auditReason = true,
  released = false
) {
  for (const fixture of fixtures) {
    for (const [type, id, readable, path] of [
      [
        "PurchaseRecord",
        fixture.row.id,
        purchase,
        `/purchases/${fixture.row.id}`,
      ],
      [
        "Vehicle",
        fixture.row.vehicleId,
        purchase && vehicle,
        `/vehicles/${fixture.row.vehicleId}`,
      ],
    ] as const) {
      const audit = await query<{ data: Audit[] }>(
        "audit",
        `?type=${type}&id=${id}`
      )
      const stored = await db.query(
        'SELECT id FROM vamotors."AuditEntry" WHERE "commandId"=$1 AND "entityType"=$2',
        [fixture.commandId, type]
      )
      assert.equal(stored.rowCount, 1)
      const entry = audit.data.find((e) => e.id === stored.rows[0].id)!
      assert.ok(entry, `${label}: audit entry missing`)
      const delta = entry.fields.find((f) => f.path === "holdReason")
      assert.equal(
        entry.reason,
        readable && auditReason ? fixture.reason : undefined,
        `${label}: ${type} duplicate reason`
      )
      if (readable)
        assert.equal(
          delta?.after,
          fixture.reason,
          `${label}: ${type} historical field`
        )
      else {
        assert.equal(delta, undefined)
        assert.ok(entry.redactedFields.includes("fields.holdReason"))
        assert.ok(entry.redactedFields.includes("reason"))
        assert.equal(JSON.stringify(audit).includes(fixture.reason), false)
      }
      const detail = await query<Record<string, unknown>>(
        type === "Vehicle" ? "vehicle" : "purchase",
        `?${type === "Vehicle" ? "id" : "cycleId"}=${id}`
      )
      assert.equal(
        detail.holdReason,
        readable && !released ? fixture.reason : undefined
      )
      await limited.goto(path)
      await expect(
        limited.getByRole("heading", {
          name: type === "Vehicle" ? "Physical vehicle" : "Purchase detail",
          exact: true,
        })
      ).toBeVisible()
      await expect(
        limited.getByText("Cycle revision", { exact: true })
      ).toBeVisible()
      // Vehicle detail includes independently PurchaseRecord-projected cycles.
      await expect(
        limited.getByText(fixture.reason, { exact: true })
      ).toHaveCount(purchase && !released ? 1 : 0)
      results.push(`${label}: ${fixture.row.id} ${type}`)
    }
  }
  console.log(
    `PASS ${label}: receive HOLD + holdStock, both roots, HTTP and UI`
  )
}
async function retained() {
  return (
    await db.query(
      'SELECT to_jsonb(a) AS row FROM vamotors."AuditEntry" a WHERE "entityId"=ANY($1::uuid[]) ORDER BY id',
      [fixtures.flatMap((f) => [f.row.id, f.row.vehicleId])]
    )
  ).rows
}
try {
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
  await login(page, "ADMIN")
  await login(limited, "STAFF")
  original = await query("currentActor")
  const supplier = await command(
    "createDirectoryParty",
    envelope({
      type: "SUPPLIER",
      values: {
        name: `R1 supplier ${suffix}`,
        category: "INDIVIDUAL",
        contacts: [],
      },
    }),
    201
  )
  for (const action of ["receiveStock", "holdStock"] as const) {
    const acquisition = await command(
      "recordPurchase",
      envelope(
        {
          vehicle: {
            engineNumber: `R1-E-${suffix}-${action}`,
            chassisNumber: `R1-C-${suffix}-${action}`,
            make: "Synthetic",
            model: "R1",
            year: 2026,
            colour: "Blue",
            fuelType: "PETROL",
            transmission: "AUTOMATIC",
          },
          supplierId: supplier.result.id,
          purchaseType: "CASH",
          purchasePrice: "10000",
          listedPrice: "15000",
          purchaseDate: "2026-10-01",
          mileage: { reading: 0, date: "2026-10-01" },
          paymentMethod: "CASH",
        },
        [{ type: "Supplier", id: supplier.result.id, revision: 1 }]
      ),
      201
    )
    let row = await current(acquisition.result.id)
    if (action === "holdStock") {
      await command(
        "receiveStock",
        envelope(
          {
            cycleId: row.id,
            date: "2026-10-02",
            disposition: { kind: "RELEASE" },
          },
          [ref(row)]
        )
      )
      row = await current(row.id)
    }
    const reason = `Private-${action}-${suffix}`
    await page.goto(`/purchases/${row.id}`)
    await page
      .getByRole("button", {
        name: action === "holdStock" ? "Hold stock" : "Receive stock",
        exact: true,
      })
      .click()
    if (action === "receiveStock") {
      await page.getByLabel("Actual received date").fill("2026-10-02")
      await page.getByLabel("Receipt disposition").selectOption("HOLD")
    }
    await page.getByLabel("Hold reason").fill(reason)
    const response = page.waitForResponse(
      (r) => new URL(r.url()).pathname === `/api/v1/commands/${action}`
    )
    await page
      .getByRole("button", {
        name:
          action === "holdStock"
            ? "Confirm hold stock"
            : "Confirm receive stock",
        exact: true,
      })
      .click()
    const committed = await response
    assert.equal(committed.status(), 200)
    const applied = (await committed.json()) as Applied
    await expect(
      page.getByRole("status").filter({ hasText: "Stock change committed" })
    ).toBeVisible()
    fixtures.push({
      row: await current(row.id),
      commandId: applied.commandId,
      reason,
    })
  }
  const originalAudit = await retained()
  await assign(false, false)
  await check("denied source fields", false, false)
  await assign(true, true)
  await check("allowed source fields", true, true)
  await assign(true, true, false)
  await check("AuditLog.reason independently denied", true, true, false)
  await assign(true, false)
  await check("Vehicle source field denied", true, false)
  await assign(false, true)
  await check("PurchaseRecord source field denied", false, true)
  await assign(true, true, true, true)
  await check("current record conditions deny old history", false, false)
  for (const fixture of fixtures) {
    await command(
      "holdStock",
      envelope({ cycleId: fixture.row.id, reason: `Changed-${suffix}` }, [
        ref(await current(fixture.row.id)),
      ])
    )
    await command(
      "releaseStock",
      envelope({ cycleId: fixture.row.id }, [
        ref(await current(fixture.row.id)),
      ])
    )
  }
  await assign(true, true)
  await check(
    "allowed historical reads after changed reason and release",
    true,
    true,
    true,
    true
  )
  const releasedAudit = await retained()
  await assign(false, false)
  await check(
    "current grant revocation after release",
    false,
    false,
    true,
    true
  )
  assert.deepEqual(
    await retained(),
    releasedAudit,
    "read/grant changes rewrote stored audit history"
  )
  for (const old of originalAudit)
    assert.deepEqual(
      releasedAudit.find((e) => e.row.id === old.row.id),
      old,
      "stock changes rewrote stored audit history"
    )
  await writeFile(
    join(root, `stock-audit-${suffix}.json`),
    JSON.stringify(
      {
        head: execFileSync("git", ["rev-parse", "HEAD"], {
          encoding: "utf8",
        }).trim(),
        dirty: !!execFileSync("git", ["status", "--porcelain"], {
          encoding: "utf8",
        }).trim(),
        results,
        fixtures,
        immutableHistory: true,
      },
      null,
      2
    ),
    { mode: 0o600 }
  )
} finally {
  try {
    if (original) await setRoles(original.roles.map((r) => r.id))
  } finally {
    await browser.close()
    if (server && server.exitCode === null) {
      const stopped = once(server, "exit")
      server.kill("SIGTERM")
      await stopped
    }
    await db.end()
  }
}
