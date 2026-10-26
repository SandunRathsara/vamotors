/** Independently runnable: build, local:setup, then node --import tsx this.ts PRIVATE_DIRECTORY.
 * Own isolated cluster only. Synthetic fixtures/faults; no service-manager/cloud access.
 */
import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { spawn, execFileSync, type ChildProcess } from "node:child_process"
import { once } from "node:events"
import { createServer } from "node:net"
import { join } from "node:path"
import { readFile, writeFile } from "node:fs/promises"
import {
  chromium,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test"
import pg from "pg"
import { privateEnvironment } from "../../scripts/private-environment"
import { runtimeConfig } from "../../lib/server/config"
import { canonical } from "../../lib/server/idempotency"
import {
  abilityFor,
  attenuation,
  grantSchema,
} from "../../lib/server/permissions"
import type {
  Applied,
  CustomerDTO,
  CustomerInput,
  CurrentActorDTO,
  Grant,
  RoleDTO,
  UserAdminDTO,
} from "../../.planning/implementation/contracts/api"

process.umask(0o077)
const passed: string[] = []
let stage = "initialize"
async function group(name: string, run: () => Promise<void>) {
  stage = name
  await run()
  passed.push(name)
  console.log(`PASS ${name}`)
}
async function main() {
  const directory = process.argv[2]
  assert.ok(directory)
  const runtime = runtimeConfig(
    await privateEnvironment(join(directory, "runtime.env"))
  )
  const migration = await privateEnvironment(join(directory, "migration.env"))
  const accounts = await privateEnvironment(join(directory, "accounts.env"))
  const cluster = await privateEnvironment(join(directory, "cluster.env"))
  assert.equal(runtime.APP_ENV, "local")
  assert.equal(cluster.PROJECT, process.cwd())
  const runtimeURL = new URL(runtime.DATABASE_URL)
  const migrationURL = new URL(migration.DIRECT_URL!)
  assert.equal(runtimeURL.hostname, "127.0.0.1")
  assert.equal(runtimeURL.port, cluster.PORT)
  assert.equal(migrationURL.port, cluster.PORT)
  assert.equal(migrationURL.pathname, runtimeURL.pathname)
  const db = new pg.Pool({ connectionString: migration.DIRECT_URL, max: 3 })
  const restricted = new pg.Pool({
    connectionString: runtime.DATABASE_URL,
    max: 1,
  })
  const socket = createServer().listen(0, "127.0.0.1")
  await once(socket, "listening")
  const address = socket.address()
  assert.ok(address && typeof address !== "string")
  const origin = `http://127.0.0.1:${address.port}`
  await new Promise<void>((resolve) => socket.close(() => resolve()))
  const port = address.port
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
  const b = await browser.newContext({ baseURL: origin })
  const staff = await browser.newContext({
    baseURL: origin,
    viewport: { width: 375, height: 812 },
  })
  const anonymous = await browser.newContext({ baseURL: origin })
  const page = await a.newPage()
  const mobile = await staff.newPage()
  const suffix = randomUUID().slice(0, 8)
  const values = (tag: string): CustomerInput => ({
    fullName: `Customer ${tag} ${suffix}`,
    callingName: `Caller ${tag}`,
    nicOrPassport: `CUST-${suffix}-${tag}`,
    address: "Synthetic address, Colombo",
    phone: "+94 77 123 4567",
    email: `${tag.toLowerCase()}-${suffix}@example.test`,
    drivingLicence: `LIC-${suffix}`,
    notes: "Synthetic private customer notes",
  })
  const ref = (
    type: "Customer" | "Role" | "User",
    row: { id: string; revision: number }
  ) => ({ type, id: row.id, revision: row.revision })
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
  async function post(
    client: APIRequestContext,
    name: string,
    input: unknown,
    expected: unknown[] = [],
    key: string = randomUUID()
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
    key: string = randomUUID()
  ) {
    const response = await post(client, name, input, expected, key)
    assert.ok(
      [200, 201].includes(response.status()),
      `POST_${name}_${response.status()}`
    )
    return (await response.json()) as Applied
  }
  async function denied(
    response: Awaited<ReturnType<typeof post>>,
    status: number,
    code: string
  ) {
    assert.equal(response.status(), status)
    assert.match(response.headers()["cache-control"], /no-store/)
    const body = await response.json()
    assert.equal(body.error.code, code)
    assert.ok(!JSON.stringify(body).includes("vamotors."))
  }
  async function login(page: Page, which: "ADMIN" | "SECOND" | "STAFF") {
    await page.goto("/login")
    await page
      .getByLabel("Email Address")
      .fill(accounts[`BOOTSTRAP_${which}_EMAIL`]!)
    await page
      .getByLabel("Password", { exact: true })
      .fill(accounts[`BOOTSTRAP_${which}_PASSWORD`]!)
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/auth/sign-in/email") &&
        r.request().method() === "POST"
    )
    await page.getByRole("button", { name: "Sign In", exact: true }).click()
    assert.equal((await response).status(), 200)
    await page.waitForURL("**/dashboard")
  }
  const role = (id: string) => query<RoleDTO>(a.request, "role", `?id=${id}`)
  const user = (id: string) =>
    query<UserAdminDTO>(a.request, "user", `?id=${id}`)
  const customer = (id: string, client = a.request) =>
    query<CustomerDTO & { redactedFields: string[] }>(
      client,
      "customer",
      `?id=${id}`
    )
  async function saveRole(id: string, grants: Grant[]) {
    const current = await role(id)
    await applied(
      a.request,
      "saveRole",
      {
        id,
        name: current.name,
        grants,
        reason: "Synthetic customer permissions",
      },
      [ref("Role", current)]
    )
  }
  async function assign(staffId: string, roleId: string) {
    const current = await user(staffId)
    const assigned = await role(roleId)
    await applied(
      a.request,
      "updateUser",
      {
        id: current.id,
        name: current.name,
        active: true,
        roleIds: [roleId],
        reason: "Synthetic customer scope",
      },
      [ref("User", current), ref("Role", assigned)]
    )
  }
  async function snapshot() {
    return (
      await db.query(
        `SELECT (SELECT count(*) FROM vamotors."Customer")::int AS customers,(SELECT count(*) FROM vamotors."AuditEntry")::int AS audit,(SELECT count(*) FROM vamotors."CommandReceipt")::int AS receipts,(SELECT count(*) FROM vamotors."EntityReadVersion")::int AS versions,(SELECT value::text FROM vamotors."BusinessSequence" WHERE id=1) AS sequence`
      )
    ).rows[0]
  }
  let created!: CustomerDTO
  let staffActor: CurrentActorDTO
  let scopedRoleId = ""
  let own: CustomerDTO
  let replayKey = ""
  let replayInput: CustomerInput
  try {
    await group(
      "existing-grant inventory / migration revalidation / protected policy",
      async () => {
        const legacyRole = randomUUID()
        const rule: Grant = {
          subject: "Customer",
          action: "read",
          fields: ["*"],
          conditions: { createdBy: "$actor.id" },
        }
        const hash = createHash("sha256").update(canonical(rule)).digest("hex")
        await db.query('INSERT INTO vamotors."Role" (id,name) VALUES ($1,$2)', [
          legacyRole,
          `Legacy customer reader ${suffix}`,
        ])
        await db.query(
          'INSERT INTO vamotors."Permission" (id,"ruleHash",rule) VALUES ($1,$2,$3) ON CONFLICT ("ruleHash") DO NOTHING',
          [randomUUID(), hash, rule]
        )
        await db.query(
          'INSERT INTO vamotors."RolePermission" ("roleId","permissionId") SELECT $1,id FROM vamotors."Permission" WHERE "ruleHash"=$2',
          [legacyRole, hash]
        )
        const inventory = async () =>
          (
            await db.query(
              'SELECT r.id,r."systemKey",r.revision,p.rule,p."ruleHash" FROM vamotors."Role" r JOIN vamotors."RolePermission" rp ON rp."roleId"=r.id JOIN vamotors."Permission" p ON p.id=rp."permissionId" ORDER BY r.id,p."ruleHash"'
            )
          ).rows
        // Restore the exact old protected capability shape as an owner-only
        // upgrade fixture: old Customer.read wildcard, no new Customer writes
        // or PurchaseRecord subject. Immutable permission rows remain intact.
        await db.query(`BEGIN;
          SELECT value FROM vamotors."BusinessSequence" WHERE id=1 FOR UPDATE;
          SELECT vamotors.lock_admin_guard();
          ALTER TABLE vamotors."RolePermission" DISABLE TRIGGER protected_permissions;
          DELETE FROM vamotors."RolePermission" rp USING vamotors."Role" r, vamotors."Permission" p
          WHERE rp."roleId"=r.id AND rp."permissionId"=p.id AND r."systemKey"='ADMINISTRATOR'
            AND ((p.rule->>'subject'='Customer' AND (p.rule->>'action'<>'read' OR p.rule->'fields' ?| ARRAY['provenance','links'])) OR p.rule->>'subject'='PurchaseRecord');
          ALTER TABLE vamotors."RolePermission" ENABLE TRIGGER protected_permissions;
          COMMIT;`)
        const before = await inventory()
        assert.ok(
          !before
            .filter((r) => r.systemKey === "ADMINISTRATOR")
            .some(
              (r) =>
                (r.rule.subject === "Customer" && r.rule.action !== "read") ||
                r.rule.subject === "PurchaseRecord"
            )
        )
        // Reproduce the ordered upgrade against actual persisted wildcard rows;
        // no trigger/constraint is relaxed by the test beyond migration's own DDL.
        await db.query(
          await readFile(
            "prisma/migrations/202610260001_customer_directory/migration.sql",
            "utf8"
          )
        )
        await db.query(
          await readFile(
            "prisma/migrations/202610260002_customer_purchase_links/migration.sql",
            "utf8"
          )
        )
        const after = await inventory()
        const legacy = after
          .filter((r) => r.id === legacyRole)
          .map((r) => grantSchema.parse(r.rule) as Grant)
        assert.equal(legacy.length, 1)
        assert.ok(!legacy[0].fields.includes("*"))
        assert.ok(!legacy[0].fields.includes("provenance"))
        assert.ok(!legacy[0].fields.includes("links"))
        for (const subject of ["Customer", "PurchaseRecord"] as const)
          assert.equal(
            attenuation(
              legacy,
              [],
              [
                {
                  subject,
                  action: subject === "Customer" ? "create" : "read",
                  fields: subject === "Customer" ? ["fullName"] : ["id"],
                },
              ],
              randomUUID()
            ).covered,
            false
          )
        const admin = after
          .filter((r) => r.systemKey === "ADMINISTRATOR")
          .map((r) => r.rule as Grant)
        assert.equal(
          abilityFor(admin, randomUUID()).can("create", "Customer"),
          true
        )
        const adminBefore = before.find((r) => r.systemKey === "ADMINISTRATOR")!
        assert.ok(
          after.find((r) => r.systemKey === "ADMINISTRATOR")!.revision >
            adminBefore.revision
        )
        const triggerRows = await db.query(
          "SELECT tgenabled FROM pg_trigger WHERE tgname IN ('protected_permissions','protected_role')"
        )
        assert.equal(triggerRows.rows.length, 2)
        assert.ok(triggerRows.rows.every((r) => r.tgenabled === "O"))
        await assert.rejects(
          db.query(
            'UPDATE vamotors."Role" SET name=name WHERE "systemKey"=\'ADMINISTRATOR\''
          )
        )
        await writeFile(
          join(directory, `customer-grant-inventory-${suffix}.json`),
          JSON.stringify({ before, after }, null, 2),
          { mode: 0o600 }
        )
      }
    )
    await group(
      "runtime least privilege / no ownership update / no DELETE",
      async () => {
        for (const sql of [
          'DELETE FROM vamotors."Customer"',
          'UPDATE vamotors."Customer" SET "createdBy"="createdBy"',
          'TRUNCATE vamotors."Customer"',
          'UPDATE vamotors."AuditEntry" SET action=action',
        ])
          await assert.rejects(restricted.query(sql))
      }
    )
    await start()
    await group(
      "anonymous API / command / RSC / origin boundaries",
      async () => {
        await denied(
          await anonymous.request.get("/api/v1/queries/customers"),
          401,
          "UNAUTHENTICATED"
        )
        await denied(
          await post(anonymous.request, "createCustomer", values("anonymous")),
          401,
          "UNAUTHENTICATED"
        )
        await page.goto("/customers")
        await page.waitForURL(/\/login/)
        await login(page, "ADMIN")
        await login(await b.newPage(), "SECOND")
        await login(mobile, "STAFF")
        staffActor = await query(staff.request, "currentActor")
        await denied(
          await staff.request.get("/api/v1/queries/customers"),
          403,
          "FORBIDDEN"
        )
        const response = await a.request.post(
          "/api/v1/commands/createCustomer",
          { headers: { origin: "https://untrusted.example" }, data: {} }
        )
        assert.equal(response.status(), 403)
      }
    )
    await group(
      "keyboard/mobile-ready UI create / all optional fields / two contexts",
      async () => {
        await page.setViewportSize({ width: 375, height: 812 })
        const collision = values("FORMCOLLISION")
        await applied(b.request, "createCustomer", collision)
        await page.goto("/customers")
        await page
          .getByRole("button", { name: "New customer", exact: true })
          .click()
        const input = values("UI")
        for (const [field, value] of Object.entries(input))
          await page.locator(`[name="${field}"]`).fill(value)
        await page
          .locator('[name="nicOrPassport"]')
          .fill(collision.nicOrPassport)
        const failed = page.waitForResponse((r) =>
          r.url().endsWith("/commands/createCustomer")
        )
        await page
          .getByRole("button", { name: "Create customer", exact: true })
          .click()
        assert.equal((await failed).status(), 409)
        await expect(page.locator('[name="notes"]')).toHaveValue(input.notes!)
        await expect(
          page.getByRole("alert").filter({ hasText: "IDENTITY_CONFLICT" })
        ).toBeVisible()
        await page.locator('[name="nicOrPassport"]').fill(input.nicOrPassport)
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
          )
        )
        await page.screenshot({
          path: join(directory, `customer-mobile-form-${suffix}.png`),
          fullPage: true,
        })
        const submitted = page.waitForResponse((r) =>
          r.url().endsWith("/commands/createCustomer")
        )
        await page
          .getByRole("button", { name: "Create customer", exact: true })
          .focus()
        await page.keyboard.press("Enter")
        assert.equal((await submitted).status(), 201)
        await page.waitForURL(/\/customers\/[a-f0-9-]+$/)
        const id = page.url().split("/").at(-1)!
        created = await customer(id, b.request)
        for (const [key, value] of Object.entries(input))
          assert.equal(
            (created as unknown as Record<string, unknown>)[key],
            value
          )
        assert.equal(created.revision, 1)
        assert.deepEqual(created.provenance, { imported: false })
        assert.deepEqual(created.links, [])
        const persisted = await db.query(
          'SELECT "createdBy" FROM vamotors."Customer" WHERE id=$1',
          [created.id]
        )
        const actor = await query<CurrentActorDTO>(a.request, "currentActor")
        assert.equal(persisted.rows[0].createdBy, actor.user.id)
        await expect(
          page.getByRole("heading", { name: "Customer change history" })
        ).toBeVisible()
        const two = await applied(b.request, "createCustomer", values("SECOND"))
        assert.ok((await customer(two.result.id)).fullName.includes("SECOND"))
      }
    )
    await group(
      "persisted literal search / deterministic sort / invalid fields",
      async () => {
        for (const q of [suffix, created.nicOrPassport, created.phone]) {
          const list = await query<{ data: CustomerDTO[]; total: number }>(
            b.request,
            "customers",
            `?q=${encodeURIComponent(q)}`
          )
          assert.ok(list.data.some((r) => r.id === created.id))
          assert.ok(list.total >= 1)
        }
        const literal = await query<{ total: number }>(
          a.request,
          "customers",
          "?q=%25"
        )
        assert.equal(literal.total, 0)
        await denied(
          await a.request.get(
            "/api/v1/queries/customers?sort=" +
              encodeURIComponent('[{"field":"createdBy","direction":"asc"}]')
          ),
          403,
          "FIELD_FORBIDDEN"
        )
        await denied(
          await a.request.get("/api/v1/queries/customers?page=0"),
          422,
          "INVALID_INPUT"
        )
        await denied(
          await a.request.get("/api/v1/queries/customers?q=a&q=b"),
          422,
          "INVALID_INPUT"
        )
        await denied(
          await a.request.get("/api/v1/queries/customers?from=2026-10-26"),
          403,
          "FIELD_FORBIDDEN"
        )
      }
    )
    await group(
      "invalid / identity duplicate / actor spoof / zero-effects",
      async () => {
        const before = await snapshot()
        for (const patch of [
          { phone: "x" },
          { email: "bad" },
          { callingName: "" },
          { createdBy: staffActor.user.id },
          { fullName: "x".repeat(201) },
          { notes: null },
        ])
          await denied(
            await post(a.request, "createCustomer", {
              ...values("INVALID"),
              ...patch,
            }),
            422,
            "INVALID_INPUT"
          )
        await denied(
          await post(a.request, "createCustomer", {
            ...values("DUP"),
            nicOrPassport: created.nicOrPassport
              .toLowerCase()
              .replace(/-/g, " - "),
          }),
          409,
          "IDENTITY_CONFLICT"
        )
        assert.deepEqual(await snapshot(), before)
      }
    )
    await group(
      "changed-field authorization / own scope before count / hidden RSC",
      async () => {
        const grants: Grant[] = [
          {
            subject: "Customer",
            action: "read",
            fields: ["*"],
            conditions: { createdBy: "$actor.id" },
          },
          { subject: "Customer", action: "create", fields: ["*"] },
          {
            subject: "Customer",
            action: "update",
            fields: ["notes"],
            conditions: { createdBy: "$actor.id" },
          },
          {
            subject: "Customer",
            action: "archive",
            fields: ["active"],
            conditions: { createdBy: "$actor.id" },
          },
        ]
        const saved = await applied(a.request, "saveRole", {
          name: `Scoped customer ${suffix}`,
          grants,
          reason: "Synthetic scoped customer",
        })
        scopedRoleId = saved.result.id
        await assign(staffActor.user.id, scopedRoleId)
        replayInput = values("OWN")
        replayKey = randomUUID()
        const result = await applied(
          staff.request,
          "createCustomer",
          replayInput,
          [],
          replayKey
        )
        own = await customer(result.result.id, staff.request)
        const list = await query<{ data: CustomerDTO[]; total: number }>(
          staff.request,
          "customers",
          `?q=${suffix}`
        )
        assert.equal(list.total, 1)
        assert.deepEqual(
          list.data.map((r) => r.id),
          [own.id]
        )
        await denied(
          await staff.request.get(`/api/v1/queries/customer?id=${created.id}`),
          404,
          "NOT_FOUND"
        )
        await mobile.goto(`/customers/${created.id}`)
        await expect(
          mobile.getByText(created.nicOrPassport, { exact: true })
        ).toHaveCount(0)
        const before = await snapshot()
        await denied(
          await post(
            staff.request,
            "updateCustomer",
            { id: own.id, values: { ...replayInput, phone: "077 000 0000" } },
            [ref("Customer", own)]
          ),
          403,
          "FIELD_FORBIDDEN"
        )
        assert.deepEqual(await snapshot(), before)
        const noteKey = randomUUID()
        const noteExpected = [ref("Customer", own)]
        const noteInput = {
          id: own.id,
          values: { ...replayInput, notes: "Own authorized note" },
        }
        const note = await applied(
          staff.request,
          "updateCustomer",
          noteInput,
          noteExpected,
          noteKey
        )
        own = await customer(own.id, staff.request)
        await applied(
          a.request,
          "updateCustomer",
          {
            id: own.id,
            values: { ...noteInput.values, phone: "077 000 1234" },
          },
          [ref("Customer", own)]
        )
        const replayBefore = await snapshot()
        const replay = await applied(
          staff.request,
          "updateCustomer",
          noteInput,
          noteExpected,
          noteKey
        )
        assert.equal(replay.commandId, note.commandId)
        assert.equal(replay.result.revision, note.result.revision)
        assert.ok(replay.affected[0].revision > replay.result.revision)
        assert.deepEqual(await snapshot(), replayBefore)
        await saveRole(
          scopedRoleId,
          grants.map((g) =>
            g.action === "update" ? { ...g, fields: ["phone"] } : g
          )
        )
        const revokedBefore = await snapshot()
        await denied(
          await post(
            staff.request,
            "updateCustomer",
            noteInput,
            noteExpected,
            noteKey
          ),
          403,
          "FIELD_FORBIDDEN"
        )
        assert.deepEqual(await snapshot(), revokedBefore)
      }
    )
    await group(
      "unread-field query denial / projection / filtered registry / no escalation",
      async () => {
        await saveRole(scopedRoleId, [
          {
            subject: "Customer",
            action: "read",
            fields: ["id", "revision", "fullName"],
          },
          { subject: "Role", action: "read", fields: ["*"] },
          { subject: "Role", action: "create", fields: ["name", "grants"] },
          { subject: "Role", action: "update", fields: ["name", "grants"] },
        ])
        const visible = await customer(created.id, staff.request)
        assert.equal(visible.nicOrPassport, undefined)
        assert.equal(visible.phone, undefined)
        assert.ok(visible.redactedFields.includes("phone"))
        await denied(
          await staff.request.get("/api/v1/queries/customers?q=123"),
          403,
          "FIELD_FORBIDDEN"
        )
        await denied(
          await staff.request.get(
            "/api/v1/queries/customers?sort=" +
              encodeURIComponent('[{"field":"phone","direction":"asc"}]')
          ),
          403,
          "FIELD_FORBIDDEN"
        )
        const registry = await query<{
          subjects: {
            subject: string
            actions: { action: string; fields: { path: string }[] }[]
          }[]
        }>(staff.request, "permissionRegistry")
        assert.ok(
          !registry.subjects
            .find((s) => s.subject === "Customer")
            ?.actions.some((a) => a.action === "create")
        )
        const before = await snapshot()
        await denied(
          await post(staff.request, "saveRole", {
            name: `Escalation ${suffix}`,
            grants: [{ subject: "Customer", action: "create", fields: ["*"] }],
            reason: "Denied customer escalation",
          }),
          403,
          "FORBIDDEN"
        )
        assert.deepEqual(await snapshot(), before)
        await mobile.goto(`/customers/${created.id}`)
        await expect(
          mobile.getByRole("heading", { name: "Customer details", exact: true })
        ).toBeVisible()
        await expect(
          mobile.getByText(created.phone, { exact: true })
        ).toHaveCount(0)
        assert.ok(
          await mobile.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
          )
        )
      }
    )
    await group(
      "same-cookie revocation / replay reauthorization / cache purge",
      async () => {
        const beforeCookie = await staff.cookies()
        await saveRole(scopedRoleId, [])
        const before = await snapshot()
        await denied(
          await staff.request.get("/api/v1/queries/customers"),
          403,
          "FORBIDDEN"
        )
        await denied(
          await post(
            staff.request,
            "createCustomer",
            replayInput,
            [],
            replayKey
          ),
          403,
          "FORBIDDEN"
        )
        assert.deepEqual(await snapshot(), before)
        const afterCookie = await staff.cookies()
        assert.equal(
          afterCookie.find((c) => c.name.includes("session_token"))?.value,
          beforeCookie.find((c) => c.name.includes("session_token"))?.value
        )
        await mobile.bringToFront()
        await mobile.evaluate(() =>
          window.dispatchEvent(new Event("auth-check"))
        )
        await expect(
          mobile.getByText(created.fullName, { exact: true })
        ).toHaveCount(0)
      }
    )
    await group(
      "same-key replay / mismatch / concurrent duplicate / no extra versions",
      async () => {
        const key = randomUUID()
        const input = values("REPLAY")
        const first = await applied(a.request, "createCustomer", input, [], key)
        const before = await snapshot()
        const replay = await applied(
          a.request,
          "createCustomer",
          input,
          [],
          key
        )
        assert.equal(replay.commandId, first.commandId)
        assert.equal(replay.replayed, true)
        assert.deepEqual(await snapshot(), before)
        await denied(
          await post(
            a.request,
            "createCustomer",
            { ...input, notes: "Different" },
            [],
            key
          ),
          409,
          "IDEMPOTENCY_MISMATCH"
        )
        assert.deepEqual(await snapshot(), before)
        const concurrentKey = randomUUID()
        const responses = await Promise.all([
          post(a.request, "createCustomer", values("RACE"), [], concurrentKey),
          post(a.request, "createCustomer", values("RACE"), [], concurrentKey),
        ])
        for (const r of responses) assert.ok([200, 201].includes(r.status()))
        const bodies = await Promise.all(responses.map((r) => r.json()))
        assert.equal(bodies[0].commandId, bodies[1].commandId)
        assert.equal(bodies.filter((r) => !r.replayed).length, 1)
      }
    )
    await group(
      "missing/duplicate/stale revisions / identity correction reason / retained UI draft",
      async () => {
        const initial = await customer(created.id)
        const input = { id: created.id, values: values("UI") }
        const before = await snapshot()
        await denied(
          await post(a.request, "updateCustomer", input),
          428,
          "REVISION_REQUIRED"
        )
        await denied(
          await post(a.request, "updateCustomer", input, [
            ref("Customer", initial),
            ref("Customer", initial),
          ]),
          422,
          "INVALID_INPUT"
        )
        assert.deepEqual(await snapshot(), before)
        await page.goto(`/customers/${created.id}`)
        await page
          .getByRole("button", { name: "Edit customer", exact: true })
          .click()
        await page.locator('[name="notes"]').fill("Retained stale UI draft")
        await applied(
          b.request,
          "updateCustomer",
          {
            id: created.id,
            values: { ...values("UI"), notes: "Other context intervened" },
          },
          [ref("Customer", initial)]
        )
        const staleBefore = await snapshot()
        const response = page.waitForResponse((r) =>
          r.url().endsWith("/commands/updateCustomer")
        )
        await page
          .getByRole("button", { name: "Save customer changes", exact: true })
          .click()
        assert.equal((await response).status(), 409)
        await expect(page.locator('[name="notes"]')).toHaveValue(
          "Retained stale UI draft"
        )
        assert.deepEqual(await snapshot(), staleBefore)
        await page
          .getByRole("button", { name: "Reload current customer", exact: true })
          .click()
        await expect(
          page.getByText("Other context intervened", { exact: true })
        ).toBeVisible()
        await page
          .getByRole("button", {
            name: /Reconfirm retained draft against revision/,
          })
          .click()
        await page
          .getByRole("button", { name: "Save customer changes", exact: true })
          .click()
        await expect(page.locator('[name="notes"]')).toHaveCount(0)
        created = await customer(created.id)
        assert.equal(created.notes, "Retained stale UI draft")
        await denied(
          await post(
            a.request,
            "updateCustomer",
            {
              id: created.id,
              values: { ...values("UI"), nicOrPassport: `CHANGED-${suffix}` },
            },
            [ref("Customer", created)]
          ),
          422,
          "INVALID_INPUT"
        )
      }
    )
    await group(
      "archive/reactivate UI / revision / retained genuine history",
      async () => {
        await page
          .getByLabel("Reason", { exact: true })
          .fill("Synthetic archive reason")
        await page
          .getByRole("button", { name: "Confirm archive", exact: true })
          .click()
        await expect(
          page.getByRole("heading", {
            name: "Reactivate customer",
            exact: true,
          })
        ).toBeVisible()
        let current = await customer(created.id, b.request)
        assert.equal(current.active, false)
        assert.equal(current.id, created.id)
        const history = await query<{ data: { action: string }[] }>(
          b.request,
          "audit",
          `?type=Customer&id=${created.id}`
        )
        assert.ok(history.data.some((e) => e.action === "archive"))
        await page
          .getByLabel("Reason", { exact: true })
          .fill("Synthetic reactivation reason")
        await page
          .getByRole("button", { name: "Confirm reactivation", exact: true })
          .click()
        await expect(
          page.getByRole("heading", { name: "Archive customer", exact: true })
        ).toBeVisible()
        current = await customer(created.id)
        assert.equal(current.active, true)
        assert.ok(current.revision > created.revision)
      }
    )
    await group(
      "atomic rollback at receipt / audit / read version and same-key recovery",
      async () => {
        for (const table of [
          "CommandReceipt",
          "AuditEntry",
          "EntityReadVersion",
        ]) {
          const key = randomUUID()
          const input = values(table)
          const before = await snapshot()
          await db.query(
            `CREATE FUNCTION vamotors.customer_test_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'SYNTHETIC_CUSTOMER_FAULT'; END $$`
          )
          try {
            await db.query(
              `CREATE TRIGGER customer_test_fault BEFORE INSERT ON vamotors."${table}" FOR EACH ROW EXECUTE FUNCTION vamotors.customer_test_fault()`
            )
            await denied(
              await post(a.request, "createCustomer", input, [], key),
              500,
              "INTERNAL_ERROR"
            )
            assert.deepEqual(await snapshot(), before)
          } finally {
            await db.query(
              `DROP TRIGGER IF EXISTS customer_test_fault ON vamotors."${table}"`
            )
            await db.query("DROP FUNCTION vamotors.customer_test_fault()")
          }
          const first = await applied(
            a.request,
            "createCustomer",
            input,
            [],
            key
          )
          const replay = await applied(
            a.request,
            "createCustomer",
            input,
            [],
            key
          )
          assert.equal(first.commandId, replay.commandId)
        }
      }
    )
    await group(
      "current lifecycle guard retained / no fabricated seller history",
      async () => {
        const constraint = await db.query(
          "SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname='initial_cycle_capability'"
        )
        assert.match(constraint.rows[0].definition, /SUPPLIER/)
        assert.deepEqual((await customer(created.id)).links, [])
        const stored = await db.query(
          'SELECT "fieldDiff" FROM vamotors."AuditEntry" WHERE "entityType"=\'Customer\' AND "entityId"=$1 ORDER BY "recordedAt"',
          [created.id]
        )
        assert.ok(stored.rows.length >= 4)
      }
    )
    await group(
      "app and isolated PostgreSQL restart durability / same real sessions",
      async () => {
        const before = await customer(created.id, b.request)
        const counts = await snapshot()
        await stop()
        await db.end()
        await restricted.end()
        execFileSync(
          process.execPath,
          ["--import", "tsx", "scripts/local-postgres.ts", "stop"],
          {
            env: { ...process.env, VAMOTORS_LOCAL_DIR: directory },
            stdio: "pipe",
          }
        )
        execFileSync(
          process.execPath,
          ["--import", "tsx", "scripts/local-postgres.ts", "start"],
          {
            env: { ...process.env, VAMOTORS_LOCAL_DIR: directory },
            stdio: "pipe",
          }
        )
        await start()
        assert.deepEqual(await customer(created.id, b.request), before)
        assert.deepEqual(await customer(created.id, a.request), before)
        const probe = new pg.Client({ connectionString: migration.DIRECT_URL })
        await probe.connect()
        try {
          const marker = await probe.query(
            'SELECT count(*)::int AS total FROM vamotors."Customer"'
          )
          assert.equal(marker.rows[0].total, counts.customers)
        } finally {
          await probe.end()
        }
      }
    )
    await writeFile(
      join(directory, `customer-evidence-${suffix}.json`),
      JSON.stringify(
        {
          source: execFileSync("git", ["rev-parse", "HEAD"], {
            encoding: "utf8",
          }).trim(),
          workingTree: execFileSync("git", ["diff", "--name-only"], {
            encoding: "utf8",
          })
            .trim()
            .split("\n"),
          passed,
          customerId: created.id,
          origin,
          limitations: [
            "initial_cycle_capability forbids seller-customer acquisition; authorized-link path cannot be fixture-proven without relaxing a retained guard",
            "sale-inline/sale/brokerage history remain downstream",
          ],
        },
        null,
        2
      ),
      { mode: 0o600 }
    )
    console.log(
      `PRIVATE_EVIDENCE ${join(directory, `customer-evidence-${suffix}.json`)}`
    )
  } finally {
    await browser.close()
    await stop()
    if (!(db as unknown as { ended: boolean }).ended) await db.end()
    if (!(restricted as unknown as { ended: boolean }).ended)
      await restricted.end()
  }
}
main().catch(async (error: unknown) => {
  if (process.argv[2])
    await writeFile(
      join(process.argv[2], "customer-failure-private.txt"),
      error instanceof Error
        ? `${stage}\n${error.stack?.replace(/postgres(?:ql)?:\/\/\S+/g, "[REDACTED_CONNECTION]")}`
        : stage,
      { mode: 0o600 }
    )
  console.error(
    `FAIL customer campaign at ${stage}; no secret diagnostics emitted`
  )
  process.exitCode = 1
})
