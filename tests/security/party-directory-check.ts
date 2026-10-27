/** Production Chromium/UI/API/real-PG campaign. Own isolated local directory only. */
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { spawn, execFileSync, type ChildProcess } from "node:child_process"
import { once } from "node:events"
import { createServer } from "node:net"
import { join } from "node:path"
import {
  chromium,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test"
import pg from "pg"
import { privateEnvironment } from "../../scripts/private-environment"
import { runtimeConfig } from "../../lib/server/config"
import type {
  Applied,
  DirectoryInput,
  Grant,
  PartyDTO,
  RoleDTO,
  UserAdminDTO,
} from "../../.planning/implementation/contracts/api"

process.umask(0o077)
const directory = process.argv[2]
assert.ok(directory)
const runtime = runtimeConfig(
  await privateEnvironment(join(directory, "runtime.env"))
)
const migration = await privateEnvironment(join(directory, "migration.env"))
const accounts = await privateEnvironment(join(directory, "accounts.env"))
const cluster = await privateEnvironment(join(directory, "cluster.env"))
assert.equal(cluster.PROJECT, process.cwd())
assert.equal(runtime.APP_ENV, "local")
assert.equal(new URL(migration.DIRECT_URL!).hostname, "127.0.0.1")
assert.equal(new URL(runtime.DATABASE_URL).port, cluster.PORT)
let db = new pg.Pool({ connectionString: migration.DIRECT_URL, max: 3 })
let restricted = new pg.Pool({ connectionString: runtime.DATABASE_URL, max: 2 })
const socket = createServer().listen(0, "127.0.0.1")
await once(socket, "listening")
const address = socket.address()
assert.ok(address && typeof address !== "string")
const origin = `http://127.0.0.1:${address.port}`
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
      String(address && typeof address !== "string" ? address.port : 0),
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
    const timer = setTimeout(
      () => reject(new Error("SERVER_START_TIMEOUT")),
      20000
    )
    server!.once("exit", () => {
      clearTimeout(timer)
      reject(new Error("SERVER_EARLY_EXIT"))
    })
    server!.stdout!.on("data", (chunk) => {
      if (chunk.toString().includes("Ready")) {
        clearTimeout(timer)
        resolve()
      }
    })
  })
}
async function stop() {
  if (server && server.exitCode === null) {
    const ended = once(server, "exit")
    server.kill("SIGTERM")
    await ended
  }
  server = undefined
}
const browser = await chromium.launch({ headless: true })
const a = await browser.newContext({ baseURL: origin })
const b = await browser.newContext({
  baseURL: origin,
  viewport: { width: 375, height: 812 },
})
const staff = await browser.newContext({ baseURL: origin })
const anonymous = await browser.newContext({ baseURL: origin })
const page = await a.newPage(),
  second = await b.newPage(),
  limited = await staff.newPage()
const suffix = randomUUID().slice(0, 8)
let stage = "initialize",
  passed = 0
async function group(name: string, run: () => Promise<void>) {
  stage = name
  await run()
  passed++
  console.log(`PASS ${name}`)
}
async function login(page: Page, which: "ADMIN" | "SECOND" | "STAFF") {
  await page.goto("/login")
  await page
    .getByLabel("Email Address")
    .fill(accounts[`BOOTSTRAP_${which}_EMAIL`]!)
  await page
    .getByLabel("Password", { exact: true })
    .fill(accounts[`BOOTSTRAP_${which}_PASSWORD`]!)
  await page.getByRole("button", { name: "Sign In", exact: true }).click()
  await page.waitForURL("**/dashboard")
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
async function post(
  client: APIRequestContext,
  name: string,
  input: unknown,
  expected: unknown[] = [],
  key = randomUUID()
) {
  return client.post(`/api/v1/commands/${name}`, {
    headers: { origin },
    data: { schemaVersion: 1, idempotencyKey: key, expected, input },
  })
}
async function applied(
  client: APIRequestContext,
  name: string,
  input: unknown,
  expected: unknown[] = [],
  key = randomUUID()
): Promise<Applied> {
  const r = await post(client, name, input, expected, key)
  assert.ok(
    [200, 201].includes(r.status()),
    `${name}_${r.status()}_${(await r.text()).slice(0, 100)}`
  )
  return r.json()
}
async function denied(
  r: Awaited<ReturnType<typeof post>>,
  status: number,
  code: string
) {
  assert.equal(r.status(), status)
  assert.equal((await r.json()).error.code, code)
  assert.match(r.headers()["cache-control"], /no-store/)
}
const ref = (type: string, row: { id: string; revision: number }) => ({
  type,
  id: row.id,
  revision: row.revision,
})
const contact = (name: string, primary = false) => ({
  name,
  phone: "+94 77 123 4567",
  email: `${name.toLowerCase()}@example.test`,
  role: "Manager",
  primary,
})
const values = (tag: string): DirectoryInput => ({
  name: `Party ${tag} ${suffix}`,
  category: "COMPANY",
  nicOrRegNumber: `REG-${suffix}`,
  address: "Synthetic Colombo",
  phone: "+94 11 123 4567",
  hotline: "+94 11 123 4568",
  recurring: true,
  notes: "Retained private notes",
  contacts: [contact("Alice", true), contact("Bob")],
})
const list = (kind = "SUPPLIER", client = a.request, q = suffix) =>
  query<{ data: PartyDTO[]; total: number }>(
    client,
    "parties",
    `?type=${kind}&page=1&pageSize=100${q ? `&q=${encodeURIComponent(q)}` : ""}`
  )
const party = async (id: string, kind = "SUPPLIER", client = a.request) => {
  const rows = await list(kind, client)
  const row = rows.data.find((r) => r.id === id)
  assert.ok(row, "PARTY_NOT_ON_PAGE")
  return row
}
let supplier: PartyDTO, vendor: PartyDTO
let staffBefore: UserAdminDTO | undefined, roleId: string | undefined
async function currentRole() {
  return query<RoleDTO>(a.request, "role", `?id=${roleId}`)
}
async function grants(rules: Grant[]) {
  const r = await currentRole()
  await applied(
    a.request,
    "saveRole",
    { id: r.id, name: r.name, grants: rules, reason: "Synthetic party scope" },
    [ref("Role", r)]
  )
}
const snapshots = async () => {
  const r = await db.query(
    `SELECT (SELECT count(*) FROM vamotors."Supplier") AS suppliers,(SELECT count(*) FROM vamotors."SupplierContact") AS contacts,(SELECT count(*) FROM vamotors."RepairVendor") AS vendors,(SELECT count(*) FROM vamotors."VendorContact") AS vendor_contacts,(SELECT count(*) FROM vamotors."AuditEntry") AS audits,(SELECT count(*) FROM vamotors."EntityReadVersion") AS versions,(SELECT count(*) FROM vamotors."CommandReceipt") AS receipts,(SELECT value FROM vamotors."BusinessSequence" WHERE id=1) AS sequence`
  )
  return r.rows[0]
}
try {
  await start()
  await login(page, "ADMIN")
  await login(second, "SECOND")
  await login(limited, "STAFF")
  await group(
    "UI individual supplier persists across second authenticated context",
    async () => {
      await page.goto("/third-parties")
      await page.getByLabel("Search name").fill(suffix)
      await page.getByRole("button", { name: "Search", exact: true }).click()
      await page.getByRole("button", { name: "New entry", exact: true }).click()
      await page
        .getByLabel("Name *", { exact: true })
        .fill(`Individual ${suffix}`)
      await page
        .getByRole("button", { name: "Create directory entry", exact: true })
        .click()
      await expect(
        page.getByRole("heading", {
          name: `Individual ${suffix} · Active`,
          exact: true,
        })
      ).toBeVisible()
      const individual = (await list()).data.find(
        (p) => p.name === `Individual ${suffix}`
      )!
      assert.equal(individual.directory!.category, "INDIVIDUAL")
      assert.equal(
        (await party(individual.id, "SUPPLIER", b.request)).name,
        individual.name
      )
    }
  )
  await group(
    "UI company supplier with two complete contacts and repair vendor",
    async () => {
      await page.getByRole("button", { name: "New entry", exact: true }).click()
      const v = values("Company")
      await page.getByLabel("Name *", { exact: true }).fill(v.name)
      await page.getByLabel("Category *").selectOption("COMPANY")
      await page
        .getByLabel("NIC or registration number")
        .fill(v.nicOrRegNumber!)
      await page.getByLabel("Address (optional)").fill(v.address!)
      await page.getByLabel("Phone (optional)", { exact: true }).fill(v.phone!)
      await page.getByLabel("Hotline (optional)").fill(v.hotline!)
      await page.getByLabel("Notes (optional)").fill(v.notes!)
      await page.getByLabel("Recurring", { exact: true }).check()
      for (let i = 0; i < 2; i++) {
        await page
          .getByRole("button", { name: "Add contact", exact: true })
          .click()
        const fieldset = page.getByRole("group", {
          name: `Contact ${i + 1}`,
          exact: true,
        })
        await fieldset
          .getByLabel("name *", { exact: true })
          .fill(v.contacts[i].name)
        await fieldset
          .getByLabel("phone *", { exact: true })
          .fill(v.contacts[i].phone)
        await fieldset.getByLabel("email (optional)").fill(v.contacts[i].email!)
        await fieldset
          .getByLabel("role *", { exact: true })
          .fill(v.contacts[i].role)
        if (i === 0) await fieldset.getByLabel("Primary contact").check()
      }
      await page
        .getByRole("button", { name: "Create directory entry", exact: true })
        .click()
      await expect(
        page.getByRole("heading", { name: `${v.name} · Active`, exact: true })
      ).toBeVisible()
      supplier = (await list()).data.find((p) => p.name === v.name)!
      assert.deepEqual(
        { ...supplier.directory, contacts: [] },
        { ...v, contacts: [] }
      )
      assert.deepEqual(
        [...supplier.directory!.contacts].sort((a, b) =>
          a.name.localeCompare(b.name)
        ),
        [...v.contacts].sort((a, b) => a.name.localeCompare(b.name))
      )
      assert.equal(new Set(supplier.contacts.map((c) => c.id)).size, 2)
      await page
        .getByRole("button", { name: "Repair vendors", exact: true })
        .click()
      await page.getByLabel("Search name").fill(suffix)
      await page.getByRole("button", { name: "Search", exact: true }).click()
      await page.getByRole("button", { name: "New entry", exact: true }).click()
      await page.getByLabel("Name *", { exact: true }).fill(`Vendor ${suffix}`)
      await page.getByLabel("Specialisation (optional)").fill("Body and paint")
      await page
        .getByRole("button", { name: "Create directory entry", exact: true })
        .click()
      await expect(
        page.getByRole("heading", {
          name: `Vendor ${suffix} · Active`,
          exact: true,
        })
      ).toBeVisible()
      vendor = (await list("REPAIR_VENDOR")).data.find(
        (p) => p.name === `Vendor ${suffix}`
      )!
      const updated = {
        ...vendor.directory!,
        contacts: values("vendor").contacts,
      }
      await applied(
        a.request,
        "updateDirectoryParty",
        { type: "REPAIR_VENDOR", id: vendor.id, values: updated },
        [ref("RepairVendor", vendor)]
      )
      vendor = await party(vendor.id, "REPAIR_VENDOR", b.request)
      assert.equal(vendor.directory!.specialisation, "Body and paint")
      assert.equal(vendor.contacts.length, 2)
      assert.ok(!(await list("SUPPLIER")).data.some((p) => p.id === vendor.id))
      await second.goto("/third-parties")
      await second
        .getByRole("button", { name: "Repair vendors", exact: true })
        .click()
      await second.getByLabel("Search name").fill(suffix)
      await second.getByRole("button", { name: "Search", exact: true }).click()
      await expect(
        second
          .getByRole("listitem")
          .filter({
            has: second.getByRole("heading", {
              name: `Vendor ${suffix} · Active`,
              exact: true,
            }),
          })
          .getByText("Body and paint", { exact: true })
      ).toBeVisible()
      assert.ok(
        await second.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth
        )
      )
    }
  )
  await group(
    "strict invalid contacts/category/actor/refs have no partial effects",
    async () => {
      const before = await snapshots()
      for (const field of ["name", "phone", "role"]) {
        const c = { ...contact("Invalid"), [field]: "" }
        await denied(
          await post(a.request, "createDirectoryParty", {
            type: "SUPPLIER",
            values: { ...values("Bad"), contacts: [c] },
          }),
          422,
          "INVALID_INPUT"
        )
      }
      for (const contacts of [
        [{ ...contact("Invalid"), email: "bad" }],
        [contact("One", true), contact("Two", true)],
      ])
        await denied(
          await post(a.request, "createDirectoryParty", {
            type: "SUPPLIER",
            values: { ...values("Bad"), contacts },
          }),
          422,
          "INVALID_INPUT"
        )
      await denied(
        await post(a.request, "createDirectoryParty", {
          type: "SUPPLIER",
          values: { ...values("Bad"), category: "INVALID" },
        }),
        422,
        "INVALID_INPUT"
      )
      await denied(
        await post(a.request, "createDirectoryParty", {
          type: "SUPPLIER",
          values: values("Bad"),
          actor: randomUUID(),
        }),
        422,
        "INVALID_INPUT"
      )
      await denied(
        await post(
          a.request,
          "updateDirectoryParty",
          { type: "SUPPLIER", id: supplier.id, values: supplier.directory },
          [ref("Supplier", supplier), ref("Supplier", supplier)]
        ),
        422,
        "INVALID_INPUT"
      )
      assert.deepEqual(await snapshots(), before)
    }
  )
  await group(
    "immutable contact identities: reuse unchanged, archive removed, typed FK and primary guard",
    async () => {
      const old = supplier.contacts.map((c) => c.id)
      const next = {
        ...supplier.directory!,
        notes: "Edited note",
        contacts: [
          supplier.directory!.contacts.find((c) => c.name === "Alice")!,
          contact("Carol"),
        ],
      }
      await applied(
        a.request,
        "updateDirectoryParty",
        {
          type: "SUPPLIER",
          id: supplier.id,
          values: next,
          reason: "Replace one contact",
        },
        [ref("Supplier", supplier)]
      )
      supplier = await party(supplier.id)
      assert.equal(
        supplier.contacts.find((c) => c.name === "Alice")!.id,
        old[0] === supplier.contacts.find((c) => c.name === "Alice")!.id
          ? old[0]
          : old[1]
      )
      const retained = await db.query(
        'SELECT id,active FROM vamotors."SupplierContact" WHERE "supplierId"=$1',
        [supplier.id]
      )
      assert.equal(retained.rows.length, 3)
      assert.equal(retained.rows.filter((c) => !c.active).length, 1)
      assert.ok(old.every((id) => retained.rows.some((r) => r.id === id)))
      await assert.rejects(
        restricted.query(
          "UPDATE vamotors.\"SupplierContact\" SET name='tampered' WHERE id=$1",
          [old[0]]
        )
      )
      await assert.rejects(
        db.query('DELETE FROM vamotors."SupplierContact" WHERE id=$1', [
          old[0],
        ]),
        /IMMUTABLE_DIRECTORY_CONTACT/
      )
      await assert.rejects(
        db.query(
          "INSERT INTO vamotors.\"VendorContact\"(id,\"vendorId\",name,phone,role) VALUES($1,$2,'Foreign','123','Manager')",
          [randomUUID(), supplier.id]
        )
      )
      await assert.rejects(
        db.query(
          "INSERT INTO vamotors.\"SupplierContact\"(id,\"supplierId\",name,phone,role,\"isPrimary\") VALUES($1,$2,'Second primary','123','Manager',true)",
          [randomUUID(), supplier.id]
        ),
        (error: unknown) => (error as { code?: string }).code === "23505"
      )
    }
  )
  await group(
    "exact key replay/mismatch, missing/stale CAS and concurrent edit/archive",
    async () => {
      const input = { type: "SUPPLIER", values: values("Replay") }
      const key = randomUUID()
      const first = await applied(
        a.request,
        "createDirectoryParty",
        input,
        [],
        key
      )
      const before = await snapshots()
      const replay = await applied(
        a.request,
        "createDirectoryParty",
        input,
        [],
        key
      )
      assert.equal(replay.commandId, first.commandId)
      assert.equal(replay.replayed, true)
      await denied(
        await post(
          a.request,
          "createDirectoryParty",
          { ...input, values: values("Changed") },
          [],
          key
        ),
        409,
        "IDEMPOTENCY_MISMATCH"
      )
      assert.deepEqual(await snapshots(), before)
      await denied(
        await post(a.request, "updateDirectoryParty", {
          type: "SUPPLIER",
          id: supplier.id,
          values: supplier.directory,
        }),
        428,
        "REVISION_REQUIRED"
      )
      await denied(
        await post(
          a.request,
          "updateDirectoryParty",
          { type: "SUPPLIER", id: supplier.id, values: supplier.directory },
          [
            {
              type: "Supplier",
              id: supplier.id,
              revision: supplier.revision - 1,
            },
          ]
        ),
        409,
        "STALE_REVISION"
      )
      const race = await Promise.all([
        post(
          a.request,
          "updateDirectoryParty",
          {
            type: "SUPPLIER",
            id: supplier.id,
            values: { ...supplier.directory, notes: "Race" },
          },
          [ref("Supplier", supplier)]
        ),
        post(
          b.request,
          "archiveParty",
          { type: "SUPPLIER", id: supplier.id, active: false, reason: "Race" },
          [ref("Supplier", supplier)]
        ),
      ])
      assert.deepEqual(race.map((r) => r.status()).sort(), [200, 409])
      supplier = await party(supplier.id)
      if (!supplier.active) {
        await applied(
          a.request,
          "archiveParty",
          {
            type: "SUPPLIER",
            id: supplier.id,
            active: true,
            reason: "Restore",
          },
          [ref("Supplier", supplier)]
        )
        supplier = await party(supplier.id)
      }
    }
  )
  await group(
    "archive/reactivate filters only new active selection, history rows retained",
    async () => {
      const ids = supplier.contacts.map((c) => c.id)
      await applied(
        a.request,
        "archiveParty",
        { type: "SUPPLIER", id: supplier.id, active: false, reason: "Archive" },
        [ref("Supplier", supplier)]
      )
      supplier = await party(supplier.id)
      const active = await query<{ data: PartyDTO[] }>(
        b.request,
        "parties",
        `?type=SUPPLIER&active=true&pageSize=100&q=${encodeURIComponent(supplier.name)}`
      )
      assert.ok(!active.data.some((r) => r.id === supplier.id))
      assert.equal(supplier.active, false)
      assert.deepEqual(
        supplier.contacts.map((c) => c.id),
        ids
      )
      await applied(
        a.request,
        "archiveParty",
        {
          type: "SUPPLIER",
          id: supplier.id,
          active: true,
          reason: "Reactivate",
        },
        [ref("Supplier", supplier)]
      )
      supplier = await party(supplier.id)
      assert.equal(supplier.active, true)
    }
  )
  await group(
    "anonymous/denied RSC, forbidden query predicates, real Settings/finance reads",
    async () => {
      await denied(
        await anonymous.request.get("/api/v1/queries/parties?type=SUPPLIER"),
        401,
        "UNAUTHENTICATED"
      )
      await denied(
        await staff.request.get("/api/v1/queries/parties?type=SUPPLIER"),
        403,
        "FORBIDDEN"
      )
      const r = await limited.goto("/third-parties")
      assert.ok([200, 404].includes(r!.status()))
      await expect(
        limited.getByRole("heading", { name: "Page not found", exact: true })
      ).toBeVisible()
      await expect(
        limited.getByText(supplier.name, { exact: true })
      ).toHaveCount(0)
      await denied(
        await a.request.get(
          "/api/v1/queries/parties?type=SUPPLIER&sort=" +
            encodeURIComponent(
              '[{"field":"directory.notes","direction":"asc"}]'
            )
        ),
        403,
        "FIELD_FORBIDDEN"
      )
      await denied(
        await a.request.get("/api/v1/queries/parties?type=INVALID"),
        422,
        "INVALID_INPUT"
      )
      await denied(
        await a.request.get(
          "/api/v1/queries/parties?type=SUPPLIER&type=REPAIR_VENDOR"
        ),
        422,
        "INVALID_INPUT"
      )
      assert.equal(
        (
          await a.request.get("/api/v1/queries/parties?type=FINANCE_COMPANY")
        ).status(),
        200
      )
      assert.equal(
        (await a.request.get("/api/v1/queries/settings")).status(),
        200
      )
      await denied(
        await post(a.request, "createFinanceCompany", {
          name: "Not implemented",
          contacts: [],
          policy: {},
        }),
        422,
        "INVALID_INPUT"
      )
    }
  )
  await group(
    "record/field SQL scope before query/count/sort and persisted revocation on replay",
    async () => {
      const users = await query<{ data: UserAdminDTO[] }>(
        a.request,
        "users",
        "?pageSize=100"
      )
      staffBefore = users.data.find(
        (u) => u.email === accounts.BOOTSTRAP_STAFF_EMAIL
      )!
      assert.ok(staffBefore)
      const created = await applied(a.request, "saveRole", {
        name: `Party scope ${suffix}`,
        grants: [
          {
            subject: "Supplier",
            action: "read",
            fields: ["*"],
            conditions: { createdBy: "$actor.id" },
          },
          { subject: "Supplier", action: "create", fields: ["*"] },
          { subject: "Supplier", action: "update", fields: ["*"] },
        ],
        reason: "Scope setup",
      })
      roleId = created.result.id
      const r = await currentRole()
      await applied(
        a.request,
        "updateUser",
        {
          id: staffBefore.id,
          name: staffBefore.name,
          active: true,
          roleIds: [roleId],
          reason: "Scope setup",
        },
        [ref("User", staffBefore), ref("Role", r)]
      )
      const body = { type: "SUPPLIER", values: values("Owned") }
      const key = randomUUID()
      const own = await applied(
        staff.request,
        "createDirectoryParty",
        body,
        [],
        key
      )
      let rows = await list("SUPPLIER", staff.request)
      assert.equal(rows.total, 1)
      assert.equal(rows.data[0].id, own.result.id)
      await denied(
        await post(
          staff.request,
          "archiveParty",
          {
            type: "SUPPLIER",
            id: supplier.id,
            active: false,
            reason: "Hidden",
          },
          [ref("Supplier", supplier)]
        ),
        404,
        "NOT_FOUND"
      )
      const ownRow = rows.data[0]
      const fingerprint = (
        await query<{ authzRevision: string }>(staff.request, "currentActor")
      ).authzRevision
      await grants([
        {
          subject: "Supplier",
          action: "read",
          fields: ["id", "revision", "name", "active"],
          conditions: { createdBy: "$actor.id" },
        },
        { subject: "Supplier", action: "update", fields: ["notes"] },
        { subject: "Supplier", action: "create", fields: ["name"] },
        { subject: "AuditLog", action: "read", fields: ["*"] },
      ])
      assert.notEqual(
        (await query<{ authzRevision: string }>(staff.request, "currentActor"))
          .authzRevision,
        fingerprint
      )
      const before = await snapshots()
      await denied(
        await post(staff.request, "createDirectoryParty", body, [], key),
        403,
        "FIELD_FORBIDDEN"
      )
      await denied(
        await post(
          staff.request,
          "updateDirectoryParty",
          {
            type: "SUPPLIER",
            id: ownRow.id,
            values: { ...ownRow.directory, name: "Forbidden change" },
          },
          [ref("Supplier", ownRow)]
        ),
        403,
        "FIELD_FORBIDDEN"
      )
      rows = await list("SUPPLIER", staff.request)
      assert.equal(rows.total, 1)
      assert.equal(rows.data[0].directory, undefined)
      const audit = await query<{ data: { fields?: unknown[] }[] }>(
        staff.request,
        "audit",
        `?type=Supplier&id=${ownRow.id}`
      )
      assert.ok(audit.data.length > 0)
      assert.ok(audit.data.every((entry) => entry.fields?.length === 0))
      assert.ok(!JSON.stringify(audit).includes("Retained private notes"))
      const fullAudit = await query<{
        data: { fields?: { path: string }[] }[]
      }>(a.request, "audit", `?type=Supplier&id=${ownRow.id}`)
      assert.ok(
        fullAudit.data.some((entry) =>
          entry.fields?.some((field) => field.path === "directory.notes")
        )
      )
      await grants([
        { subject: "Supplier", action: "read", fields: ["id"] },
        {
          subject: "Supplier",
          action: "read",
          fields: ["name"],
          conditions: { createdBy: "$actor.id" },
        },
      ])
      await denied(
        await staff.request.get(
          "/api/v1/queries/parties?type=SUPPLIER&q=Party"
        ),
        403,
        "FIELD_FORBIDDEN"
      )
      await denied(
        await staff.request.get(
          "/api/v1/queries/parties?type=SUPPLIER&sort=" +
            encodeURIComponent('[{"field":"name","direction":"asc"}]')
        ),
        403,
        "FIELD_FORBIDDEN"
      )
      await denied(
        await staff.request.get(
          "/api/v1/queries/parties?type=SUPPLIER&active=true"
        ),
        403,
        "FIELD_FORBIDDEN"
      )
      const after = await snapshots()
      assert.equal(after.suppliers, before.suppliers)
      assert.equal(after.contacts, before.contacts)
      assert.equal(after.versions, before.versions)
    }
  )
  await group(
    "party/contact/audit/version/receipt faults rollback all effects and same-key recovery",
    async () => {
      for (const table of [
        "Supplier",
        "SupplierContact",
        "RepairVendor",
        "VendorContact",
        "AuditEntry",
        "EntityReadVersion",
        "CommandReceipt",
      ]) {
        const kind =
          table === "RepairVendor" || table === "VendorContact"
            ? "REPAIR_VENDOR"
            : "SUPPLIER"
        const key = randomUUID(),
          input = { type: kind, values: values(`Fault${table}`) }
        const before = await snapshots()
        await db.query(
          `CREATE FUNCTION vamotors.party_test_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'SYNTHETIC_FAULT'; END $$; CREATE TRIGGER party_test_fault BEFORE INSERT ON vamotors."${table}" FOR EACH ROW EXECUTE FUNCTION vamotors.party_test_fault()`
        )
        try {
          await denied(
            await post(a.request, "createDirectoryParty", input, [], key),
            500,
            "INTERNAL_ERROR"
          )
          assert.deepEqual(await snapshots(), before)
        } finally {
          await db.query(
            `DROP TRIGGER party_test_fault ON vamotors."${table}"; DROP FUNCTION vamotors.party_test_fault()`
          )
        }
        const saved = await applied(
          a.request,
          "createDirectoryParty",
          input,
          [],
          key
        )
        assert.equal(
          (await applied(a.request, "createDirectoryParty", input, [], key))
            .commandId,
          saved.commandId
        )
      }
    }
  )
  await group(
    "fresh lock-waiter execution and replay observe committed revocation",
    async () => {
      const full: Grant[] = [
        {
          subject: "Supplier",
          action: "read",
          fields: ["*"],
          conditions: { createdBy: "$actor.id" },
        },
        { subject: "Supplier", action: "create", fields: ["*"] },
      ]
      for (const replay of [false, true]) {
        await grants(full)
        const input = {
            type: "SUPPLIER",
            values: values(replay ? "WaitReplay" : "WaitCreate"),
          },
          key = randomUUID()
        if (replay)
          await applied(staff.request, "createDirectoryParty", input, [], key)
        const before = await snapshots()
        const blocker = await db.connect()
        await blocker.query("BEGIN")
        await blocker.query(
          'SELECT value FROM vamotors."BusinessSequence" WHERE id=1 FOR UPDATE'
        )
        const waiting = post(
          staff.request,
          "createDirectoryParty",
          input,
          [],
          key
        )
        try {
          await expect
            .poll(
              async () =>
                Number(
                  (
                    await db.query(
                      "SELECT count(*) FROM pg_locks WHERE NOT granted"
                    )
                  ).rows[0].count
                ),
              { timeout: 1000 }
            )
            .toBeGreaterThan(0)
          await grants([
            {
              subject: "Supplier",
              action: "read",
              fields: ["*"],
              conditions: { createdBy: "$actor.id" },
            },
          ])
        } finally {
          await blocker.query("ROLLBACK")
          blocker.release()
        }
        await denied(await waiting, 403, "FORBIDDEN")
        const after = await snapshots()
        assert.equal(after.suppliers, before.suppliers)
        assert.equal(after.contacts, before.contacts)
        assert.equal(after.sequence, before.sequence)
      }
    }
  )
  await group(
    "deferred final-constraint fault rolls back receipt/audit/party graph",
    async () => {
      const before = await snapshots(),
        key = randomUUID(),
        input = { type: "SUPPLIER", values: values("Deferred") }
      await db.query(
        `CREATE FUNCTION vamotors.party_test_final() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'SYNTHETIC_FINAL_CONSTRAINT' USING ERRCODE='23514'; END $$; CREATE CONSTRAINT TRIGGER party_test_final AFTER INSERT ON vamotors."Supplier" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vamotors.party_test_final()`
      )
      try {
        await denied(
          await post(a.request, "createDirectoryParty", input, [], key),
          500,
          "INTERNAL_ERROR"
        )
        assert.deepEqual(await snapshots(), before)
      } finally {
        await db.query(
          'DROP TRIGGER party_test_final ON vamotors."Supplier"; DROP FUNCTION vamotors.party_test_final()'
        )
      }
      const saved = await applied(
        a.request,
        "createDirectoryParty",
        input,
        [],
        key
      )
      assert.equal(
        (await applied(a.request, "createDirectoryParty", input, [], key))
          .commandId,
        saved.commandId
      )
    }
  )
  await group(
    "runtime no DDL/ownership/delete/history mutation/future-table authority",
    async () => {
      for (const sql of [
        "CREATE TABLE vamotors.party_forbidden(id int)",
        'DELETE FROM vamotors."Supplier"',
        'DELETE FROM vamotors."SupplierContact"',
        'UPDATE vamotors."Supplier" SET "createdBy"=\'03000000-0000-4000-8000-000000000011\'',
        "UPDATE vamotors.\"AuditEntry\" SET reason='tamper'",
        'UPDATE vamotors."EntityReadVersion" SET revision=2',
        'DELETE FROM vamotors."CommandReceipt"',
      ])
        await assert.rejects(restricted.query(sql))
      await db.query("CREATE TABLE vamotors.party_future_probe(id int)")
      try {
        await assert.rejects(
          restricted.query("SELECT * FROM vamotors.party_future_probe")
        )
        await assert.rejects(
          restricted.query("INSERT INTO vamotors.party_future_probe VALUES(1)")
        )
      } finally {
        await db.query("DROP TABLE vamotors.party_future_probe")
      }
    }
  )
  await group(
    "response loss freezes exact create envelope across refetch and retry",
    async () => {
      await page.goto("/third-parties")
      await page.getByRole("button", { name: "New entry", exact: true }).click()
      await page
        .getByLabel("Name *", { exact: true })
        .fill(`Lost response ${suffix}`)
      let firstBody = "",
        retryBody = "",
        result: Applied | undefined
      await page.route(
        "**/api/v1/commands/createDirectoryParty",
        async (route) => {
          firstBody = route.request().postData()!
          const response = await route.fetch()
          assert.equal(response.status(), 201)
          result = await response.json()
          await route.abort("failed")
        },
        { times: 1 }
      )
      await page
        .getByRole("button", { name: "Create directory entry", exact: true })
        .click()
      await expect(
        page.getByRole("alert").filter({ hasText: "NETWORK_ERROR" })
      ).toBeVisible()
      assert.ok(result)
      await expect(page.getByLabel("Name *", { exact: true })).toBeDisabled()
      await page.getByLabel("Search name").fill("Lost response")
      await page.getByRole("button", { name: "Search", exact: true }).click()
      await expect(
        page.getByRole("heading", {
          name: `Lost response ${suffix} · Active`,
          exact: true,
        })
      ).toBeVisible()
      await page.route(
        "**/api/v1/commands/createDirectoryParty",
        async (route) => {
          retryBody = route.request().postData()!
          await route.continue()
        },
        { times: 1 }
      )
      await page
        .getByRole("button", { name: "Retry unchanged command", exact: true })
        .click()
      await expect(
        page.getByRole("button", { name: "New entry", exact: true })
      ).toBeVisible()
      assert.equal(retryBody, firstBody)
      assert.equal(
        (await list("SUPPLIER", b.request, `Lost response ${suffix}`)).total,
        1
      )
    }
  )
  await group(
    "response loss edit retains input/reason/expected/key after a later committed edit",
    async () => {
      await page.goto("/third-parties")
      await page.getByLabel("Search name").fill(`Lost response ${suffix}`)
      await page.getByRole("button", { name: "Search", exact: true }).click()
      const row = (await list("SUPPLIER", a.request, `Lost response ${suffix}`))
        .data[0]
      await page
        .getByRole("button", { name: `Edit ${row.name}`, exact: true })
        .click()
      await page.getByLabel("Notes (optional)").fill("Immutable uncertain edit")
      await page
        .getByLabel("Correction reason (optional)")
        .fill("Retained correction reason")
      let firstBody = "",
        retryBody = ""
      await page.route(
        "**/api/v1/commands/updateDirectoryParty",
        async (route) => {
          firstBody = route.request().postData()!
          const response = await route.fetch()
          assert.equal(response.status(), 200)
          await route.abort("failed")
        },
        { times: 1 }
      )
      await page
        .getByRole("button", { name: "Save directory changes", exact: true })
        .click()
      await expect(
        page.getByRole("alert").filter({ hasText: "NETWORK_ERROR" })
      ).toBeVisible()
      const current = await party(row.id)
      await applied(
        b.request,
        "updateDirectoryParty",
        {
          type: "SUPPLIER",
          id: row.id,
          values: { ...current.directory, notes: "Later second-context edit" },
        },
        [ref("Supplier", current)]
      )
      await page.getByLabel("Search name").fill("Lost response")
      await page.getByRole("button", { name: "Search", exact: true }).click()
      await expect(page.getByLabel("Notes (optional)")).toHaveValue(
        "Immutable uncertain edit"
      )
      await expect(page.getByLabel("Correction reason (optional)")).toHaveValue(
        "Retained correction reason"
      )
      const before = await snapshots()
      await page.route(
        "**/api/v1/commands/updateDirectoryParty",
        async (route) => {
          retryBody = route.request().postData()!
          await route.continue()
        },
        { times: 1 }
      )
      await page
        .getByRole("button", { name: "Retry unchanged command", exact: true })
        .click()
      await expect(
        page.getByRole("button", { name: "New entry", exact: true })
      ).toBeVisible()
      assert.equal(firstBody, retryBody)
      assert.deepEqual(await snapshots(), before)
      assert.equal(
        (await party(row.id)).directory!.notes,
        "Later second-context edit"
      )
    }
  )
  await group(
    "response loss archive keeps original target/status/reason across committed-status refetch",
    async () => {
      await page.goto("/third-parties")
      await page.getByLabel("Search name").fill(`Lost response ${suffix}`)
      await page.getByRole("button", { name: "Search", exact: true }).click()
      const row = (await list("SUPPLIER", a.request, `Lost response ${suffix}`))
        .data[0]
      await page
        .getByRole("button", { name: `Archive ${row.name}`, exact: true })
        .click()
      await page
        .getByLabel("Reason *", { exact: true })
        .fill("Immutable uncertain archive")
      let firstBody = "",
        retryBody = ""
      await page.route(
        "**/api/v1/commands/archiveParty",
        async (route) => {
          firstBody = route.request().postData()!
          const response = await route.fetch()
          assert.equal(response.status(), 200)
          await route.abort("failed")
        },
        { times: 1 }
      )
      await page
        .getByRole("button", { name: "Confirm status change", exact: true })
        .click()
      await expect(
        page.getByRole("alert").filter({ hasText: "NETWORK_ERROR" })
      ).toBeVisible()
      await page.getByLabel("Search name").fill("Lost response")
      await page.getByRole("button", { name: "Search", exact: true }).click()
      await expect(
        page.getByRole("heading", {
          name: `${row.name} · Archived`,
          exact: true,
        })
      ).toBeVisible()
      await expect(page.getByLabel("Reason *", { exact: true })).toHaveValue(
        "Immutable uncertain archive"
      )
      const before = await snapshots()
      await page.route(
        "**/api/v1/commands/archiveParty",
        async (route) => {
          retryBody = route.request().postData()!
          await route.continue()
        },
        { times: 1 }
      )
      await page
        .getByRole("button", {
          name: "Retry unchanged status command",
          exact: true,
        })
        .click()
      await expect(page.getByLabel("Reason *", { exact: true })).toHaveCount(0)
      assert.equal(firstBody, retryBody)
      assert.equal(JSON.parse(retryBody).input.active, false)
      assert.deepEqual(await snapshots(), before)
      assert.equal((await party(row.id)).active, false)
    }
  )
  await group(
    "UI stale edit retains draft and requires explicit current revision/new intent",
    async () => {
      await page.goto("/third-parties")
      await page.getByLabel("Search name").fill(supplier.name)
      await page.getByRole("button", { name: "Search", exact: true }).click()
      await page
        .getByRole("button", { name: `Edit ${supplier.name}`, exact: true })
        .click()
      await page
        .getByLabel("Notes (optional)")
        .fill("Retained UI conflict draft")
      supplier = await party(supplier.id)
      await applied(
        b.request,
        "updateDirectoryParty",
        {
          type: "SUPPLIER",
          id: supplier.id,
          values: { ...supplier.directory, notes: "Concurrent second context" },
        },
        [ref("Supplier", supplier)]
      )
      await page
        .getByRole("button", { name: "Save directory changes", exact: true })
        .click()
      await expect(
        page.getByRole("alert").filter({ hasText: "STALE_REVISION" })
      ).toBeVisible()
      await expect(page.getByLabel("Notes (optional)")).toHaveValue(
        "Retained UI conflict draft"
      )
      await page
        .getByRole("button", {
          name: "Reload current directory entry",
          exact: true,
        })
        .click()
      await expect(
        page
          .getByRole("region", { name: "Conflict resolution" })
          .getByText(/Concurrent second context/)
      ).toBeVisible()
      await page
        .getByRole("button", {
          name: /Reconfirm retained draft against revision/,
        })
        .click()
      await page
        .getByRole("button", { name: "Save directory changes", exact: true })
        .click()
      await expect(
        page.getByRole("button", { name: "New entry", exact: true })
      ).toBeVisible()
      supplier = await party(supplier.id)
      assert.equal(supplier.directory!.notes, "Retained UI conflict draft")
    }
  )
  await group(
    "production app and PostgreSQL restart preserve fields, contacts, revisions, audit and receipts",
    async () => {
      const before = await snapshots(),
        current = await party(supplier.id)
      await stop()
      await db.end()
      await restricted.end()
      const env = { ...process.env, VAMOTORS_LOCAL_DIR: directory }
      execFileSync(
        process.execPath,
        ["--import", "tsx", "scripts/local-postgres.ts", "stop"],
        { env, stdio: "pipe" }
      )
      execFileSync(
        process.execPath,
        ["--import", "tsx", "scripts/local-postgres.ts", "start"],
        { env, stdio: "pipe" }
      )
      db = new pg.Pool({ connectionString: migration.DIRECT_URL, max: 3 })
      restricted = new pg.Pool({
        connectionString: runtime.DATABASE_URL,
        max: 2,
      })
      await start()
      assert.deepEqual(await snapshots(), before)
      assert.deepEqual(await party(supplier.id, "SUPPLIER", b.request), current)
      await page.reload()
      await expect(
        page.getByRole("heading", { name: "Third parties", exact: true })
      ).toBeVisible()
    }
  )
  console.log(
    `Party production campaign: ${passed} groups passed. Finance/Settings/detail require their separate campaign; downstream histories not accepted.`
  )
} catch (error) {
  console.error(
    `FAIL ${stage}`,
    error instanceof Error ? error.message : "safe failure"
  )
  process.exitCode = 1
} finally {
  if (staffBefore && roleId) {
    try {
      const current = await query<UserAdminDTO>(
        a.request,
        "user",
        `?id=${staffBefore.id}`
      )
      const roles = await Promise.all(
        staffBefore.roles.map((r) =>
          query<RoleDTO>(a.request, "role", `?id=${r.id}`)
        )
      )
      await applied(
        a.request,
        "updateUser",
        {
          id: current.id,
          name: staffBefore.name,
          active: staffBefore.active,
          roleIds: roles.map((r) => r.id),
          reason: "Restore synthetic staff",
        },
        [ref("User", current), ...roles.map((r) => ref("Role", r))]
      )
    } catch {
      console.error("Synthetic staff restore failed")
      process.exitCode = 1
    }
  }
  await browser.close()
  await stop()
  await db.end()
  await restricted.end()
}
