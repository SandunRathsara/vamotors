/** Production HTTP/Chromium/PG Settings campaign. Own private local root only.
 * Run after pnpm build: node --conditions=react-server --import tsx
 * tests/security/settings-writes-check.ts <private-local-directory> */
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { spawn, execFileSync, type ChildProcess } from "node:child_process"
import { once } from "node:events"
import { createServer } from "node:net"
import { join } from "node:path"
import { writeFile } from "node:fs/promises"
import {
  chromium,
  expect,
  type Page,
  type APIRequestContext,
  type APIResponse,
} from "@playwright/test"
import pg from "pg"
import { privateEnvironment } from "../../scripts/private-environment"
import { settingsInput } from "../../lib/server/validators"
import type {
  Applied,
  QueryData,
  Dependency,
  Grant,
} from "../../.planning/implementation/contracts/api"

process.umask(0o077)
const directory = process.argv[2]
assert.ok(directory)
const runtime = await privateEnvironment(join(directory, "runtime.env"))
const migration = await privateEnvironment(join(directory, "migration.env"))
const accounts = await privateEnvironment(join(directory, "accounts.env"))
const cluster = await privateEnvironment(join(directory, "cluster.env"))
const clusterAdmin = await privateEnvironment(join(directory, "admin.env"))
const monitorURL = new URL(clusterAdmin.ADMIN_URL!)
monitorURL.pathname = new URL(migration.DIRECT_URL!).pathname
let monitor = new pg.Pool({ connectionString: monitorURL.href, max: 1 })
assert.equal(cluster.PROJECT, process.cwd())
assert.equal(runtime.APP_ENV, "local")
assert.equal(new URL(runtime.DATABASE_URL!).hostname, "127.0.0.1")
let db = new pg.Pool({ connectionString: migration.DIRECT_URL, max: 3 })
let restricted = new pg.Pool({ connectionString: runtime.DATABASE_URL, max: 1 })
const socket = createServer().listen(0, "127.0.0.1")
await once(socket, "listening")
const address = socket.address()
assert.ok(address && typeof address !== "string")
const port = address.port,
  origin = `http://127.0.0.1:${port}`
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
const a = await browser.newContext({
  baseURL: origin,
  viewport: { width: 1920, height: 1080 },
})
const b = await browser.newContext({
  baseURL: origin,
  viewport: { width: 360, height: 800 },
})
const staff = await browser.newContext({ baseURL: origin })
const anonymous = await browser.newContext({ baseURL: origin })
const page = await a.newPage(),
  second = await b.newPage(),
  limited = await staff.newPage()
let stage = "initialize"
const results: string[] = []
const suffix = randomUUID().slice(0, 8)
type Settings = QueryData["settings"]
const ref = (
  type: Dependency["type"],
  row: { id: string; revision: number }
): Dependency => ({ type, id: row.id, revision: row.revision })
const envelope = <T>(
  input: T,
  expected: Dependency[] = [],
  idempotencyKey = randomUUID()
) => ({ schemaVersion: 1, idempotencyKey, expected, input })
const values = (row: Settings) =>
  settingsInput.parse(
    Object.fromEntries(
      Object.entries(row).filter(
        ([key]) =>
          !["id", "revision", "policyVersion", "redactedFields"].includes(key)
      )
    )
  )
const bodyFor = (row: Settings, patch: Record<string, unknown> = {}) =>
  envelope(
    { ...values(row), ...patch, reason: "Synthetic Settings correction" },
    [ref("Settings", row)]
  )
const post = (client: APIRequestContext, name: string, body: unknown) =>
  client.post(`/api/v1/commands/${name}`, { headers: { origin }, data: body })
const save = (body: unknown, client = a.request) =>
  post(client, "updateSettings", body)
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
const settings = () => query<Settings>(a.request, "settings")
async function applied(response: Promise<APIResponse>): Promise<Applied> {
  const r = await response
  assert.ok(
    [200, 201].includes(r.status()),
    `${r.status()} ${(await r.text()).slice(0, 500)}`
  )
  return r.json()
}
async function denied(
  response: Promise<APIResponse>,
  status: number,
  code?: string
) {
  const r = await response
  assert.equal(r.status(), status, (await r.text()).slice(0, 500))
  if (code) assert.equal((await r.json()).error.code, code)
}
async function group(name: string, run: () => Promise<void>) {
  stage = name
  await run()
  results.push(name)
  console.log(`PASS ${name}`)
}
async function login(p: Page, which: "ADMIN" | "SECOND" | "STAFF") {
  await p.goto("/login")
  await p
    .getByLabel("Email Address")
    .fill(accounts[`BOOTSTRAP_${which}_EMAIL`]!)
  await p
    .getByLabel("Password", { exact: true })
    .fill(accounts[`BOOTSTRAP_${which}_PASSWORD`]!)
  const response = p.waitForResponse((r) =>
    r.url().endsWith("/api/auth/sign-in/email")
  )
  await p.getByRole("button", { name: "Sign In", exact: true }).click()
  assert.equal((await response).status(), 200, `SIGN_IN_${which}`)
  await p.waitForURL("**/dashboard")
}
type Stored = {
  id: string
  value: string
  commandId: string
  reason: string
  fieldDiff: Record<string, { before: unknown; after: unknown }>
}
const state = async (): Promise<Record<string, Stored[]>> =>
  Object.fromEntries(
    await Promise.all(
      [
        "Settings",
        "SettingsVersion",
        "FinanceCompany",
        "FinancePolicyVersion",
        "FinanceContact",
        "AuditEntry",
        "EntityReadVersion",
        "CommandReceipt",
        "BusinessSequence",
      ].map(async (table) => [
        table,
        (
          await db.query(
            `SELECT to_jsonb(t) AS row FROM vamotors."${table}" t ORDER BY id`
          )
        ).rows.map((r) => r.row),
      ])
    )
  )
const histories = async (): Promise<Record<string, Stored[]>> =>
  Object.fromEntries(
    await Promise.all(
      [
        "SettingsVersion",
        "FinancePolicyVersion",
        "FinanceContact",
        "PurchaseRecord",
      ].map(async (table) => [
        table,
        (
          await db.query(
            `SELECT to_jsonb(t) AS row FROM vamotors."${table}" t ORDER BY id`
          )
        ).rows.map((r) => r.row),
      ])
    )
  )
let baselineHistory: Awaited<ReturnType<typeof histories>>
let roleId = "",
  roleRevision = 0
const staffId = "03000000-0000-4000-8000-000000000013"
const grants: Grant[] = [
  { subject: "Settings", action: "read", fields: ["*"] },
  { subject: "Settings", action: "update", fields: ["company.name"] },
  { subject: "AuditLog", action: "read", fields: ["*"] },
]
async function roleRules(rules: Grant[]) {
  const result = await applied(
    post(
      a.request,
      "saveRole",
      envelope(
        {
          ...(roleId ? { id: roleId } : {}),
          name: `Settings scoped ${suffix}`,
          grants: rules,
          reason: "Synthetic Settings field test",
        },
        roleId ? [{ type: "Role", id: roleId, revision: roleRevision }] : []
      )
    )
  )
  roleId = result.result.id
  roleRevision = result.result.revision
}
async function attachRole() {
  const users = await query<{
    data: {
      id: string
      revision: number
      name: string
      roles: { id: string }[]
    }[]
  }>(a.request, "users", "?pageSize=100")
  const user = users.data.find((u) => u.id === staffId)!
  const roleIds = [
    ...new Set([
      ...user.roles
        .map((r) => r.id)
        .filter((id) =>
          [
            "03000000-0000-4000-8000-000000000002",
            "03000000-0000-4000-8000-000000000003",
          ].includes(id)
        ),
      roleId,
    ]),
  ]
  const roles = await Promise.all(
    roleIds.map((id) =>
      query<{ id: string; revision: number }>(a.request, "role", `?id=${id}`)
    )
  )
  await applied(
    post(
      a.request,
      "updateUser",
      envelope(
        {
          id: user.id,
          name: user.name,
          active: true,
          roleIds,
          reason: "Synthetic Settings scoped actor",
        },
        [ref("User", user), ...roles.map((r) => ref("Role", r))]
      )
    )
  )
}
async function openEditor(p = page) {
  await p.bringToFront()
  await p.goto("/settings")
  await p.getByRole("button", { name: "Edit settings", exact: true }).click()
  await expect(p.getByLabel("Company name", { exact: true })).toBeVisible()
}
async function waitForBusinessWaiter() {
  for (let i = 0; i < 200; i++) {
    const result = await monitor.query(
      "SELECT count(*)::int AS n FROM pg_stat_activity WHERE usename='vamotors_runtime' AND wait_event_type='Lock' AND query LIKE '%BusinessSequence%'"
    )
    if (result.rows[0].n > 0) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error("BUSINESS_LOCK_WAITER_NOT_OBSERVED")
}
const financeInput = () => ({
  name: `Settings finance ${randomUUID()}`,
  contacts: [
    {
      name: "Synthetic contact",
      phone: "0112345678",
      role: "Agent",
      primary: true,
    },
  ],
  policy: {
    path: "APPLICATION",
    commission: { basis: "FIXED", fixed: "12345", rateBps: 25 },
    processingFee: "123",
    reconciliationMethod: "PER_DEAL",
  },
})
try {
  const setup = await db.connect()
  try {
    await setup.query("BEGIN")
    await setup.query("SELECT vamotors.lock_admin_guard()")
    await setup.query(
      'DELETE FROM vamotors."UserRole" WHERE "userId"=$1 AND "roleId" NOT IN (\'03000000-0000-4000-8000-000000000002\',\'03000000-0000-4000-8000-000000000003\')',
      [staffId]
    )
    await setup.query(
      'UPDATE vamotors."user" SET "authzRevision"="authzRevision"+1 WHERE id=$1',
      [staffId]
    )
    await setup.query("COMMIT")
  } finally {
    await setup.query("ROLLBACK")
    setup.release()
  }
  await start()
  await group(
    "two authorized sessions, anonymous API/RSC and strict persisted read",
    async () => {
      await Promise.all([
        login(page, "ADMIN"),
        login(second, "SECOND"),
        login(limited, "STAFF"),
      ])
      const row = await settings()
      assert.ok(row.id && row.revision && row.policyVersion)
      await denied(
        anonymous.request.get("/api/v1/queries/settings"),
        401,
        "UNAUTHENTICATED"
      )
      await denied(
        save(bodyFor(row), anonymous.request),
        401,
        "UNAUTHENTICATED"
      )
      const rsc = await anonymous.request.get("/settings?_rsc=negative", {
        headers: { RSC: "1" },
        maxRedirects: 0,
      })
      const rscBody = await rsc.text()
      assert.ok(
        [200, 303, 307, 308].includes(rsc.status()),
        `RSC status ${rsc.status()}`
      )
      if (rsc.status() === 200) assert.match(rscBody, /NEXT_REDIRECT|\/login/)
      assert.ok(!rscBody.includes(row.company.identity))
      await denied(save(bodyFor(row), staff.request), 404, "NOT_FOUND")
      baselineHistory = await histories()
    }
  )
  await group(
    "strict full input, malformed JSON/money, missing duplicate wrong stale refs: zero effects",
    async () => {
      const row = await settings(),
        before = await state()
      const invalid: unknown[] = [
        null,
        [],
        {},
        { ...values(row), reason: "" },
        { ...values(row), reason: "  " },
      ]
      for (const key of Object.keys(values(row))) {
        const input: Record<string, unknown> = {
          ...values(row),
          reason: "Required",
        }
        delete input[key]
        invalid.push(input)
      }
      for (const key of [
        "id",
        "revision",
        "policyVersion",
        "effectiveAt",
        "currentVersionId",
        "createdBy",
        "extra",
      ])
        invalid.push({ ...values(row), reason: "Strict", [key]: row.id })
      for (const processingFee of [
        "abc",
        "01",
        "1e2",
        "-1",
        "1.2",
        "1\n",
        "100000000000000",
        1,
        null,
      ])
        invalid.push({ ...values(row), reason: "Money", processingFee })
      for (const patch of [
        { timezone: "No/SuchZone" },
        { currency: "XXX" },
        { currency: "JPY" },
        { scale: 3 },
        { warningLeadDays: 8 },
        { theme: "OTHER" },
        { itemsPerPage: 5 },
        { dateFormat: "US" },
        { tiers: [{ upperBps: 500, days: 7 }] },
        { tiers: [{ upperBps: null, days: 32 }] },
        {
          tiers: [
            { upperBps: 500, days: 7 },
            { upperBps: 500, days: 14 },
            { upperBps: null, days: 31 },
          ],
        },
      ])
        invalid.push({ ...values(row), reason: "Strict policy", ...patch })
      for (const input of invalid)
        await denied(
          save(envelope(input, [ref("Settings", row)])),
          422,
          "INVALID_INPUT"
        )
      await denied(
        a.request.post("/api/v1/commands/updateSettings", {
          headers: { origin, "content-type": "application/json" },
          data: Buffer.from("{"),
        }),
        400,
        "INVALID_INPUT"
      )
      await denied(
        save(envelope({ ...values(row), reason: "Missing" })),
        428,
        "REVISION_REQUIRED"
      )
      await denied(
        save(
          envelope({ ...values(row), reason: "Duplicate" }, [
            ref("Settings", row),
            ref("Settings", row),
          ])
        ),
        422
      )
      await denied(
        save(
          envelope({ ...values(row), reason: "Wrong" }, [
            { type: "Settings", id: randomUUID(), revision: 1 },
          ])
        ),
        428
      )
      await denied(
        save(
          envelope({ ...values(row), reason: "Stale" }, [
            { type: "Settings", id: row.id, revision: row.revision + 1 },
          ])
        ),
        409,
        "STALE_REVISION"
      )
      assert.deepEqual(await state(), before)
    }
  )
  await group(
    "complete HTTP replacement, distinct policy/CAS versions and exactly-once replay",
    async () => {
      let row = await settings()
      if (row.revision === row.policyVersion) {
        // Deliberately different fixture before exercising the command; genuine
        // parent-upgrade root already has this fixture from its prepare runner.
        await db.query(
          'UPDATE vamotors."Settings" SET revision=revision+10 WHERE id=$1',
          [row.id]
        )
        row = await settings()
      }
      const patch = {
        company: {
          name: `HTTP company ${suffix}`,
          identity: `DEV-${suffix}`,
          address: "Synthetic changed address",
          phone: "0117654321",
          email: "changed@example.invalid",
        },
        declarations: ["Synthetic changed declaration", "Second declaration"],
        timezone: "UTC",
        tiers: [
          { upperBps: 600, days: 8 },
          { upperBps: null, days: 30 },
        ],
        warningLeadDays: 4,
        processingFee: "54321",
        dateFormat: "DD/MM/YYYY",
        itemsPerPage: 50,
        theme: "DARK",
      }
      const body = bodyFor(row, patch),
        before = await state()
      const committed = await applied(save(body)),
        after = await settings()
      assert.equal(after.revision, row.revision + 1)
      assert.equal(after.policyVersion, row.policyVersion + 1)
      assert.notEqual(after.revision, after.policyVersion)
      assert.deepEqual(values(after), { ...values(row), ...patch })
      const stateAfter = await state()
      assert.equal(
        stateAfter.SettingsVersion.length,
        before.SettingsVersion.length + 1
      )
      assert.equal(stateAfter.AuditEntry.length, before.AuditEntry.length + 1)
      assert.equal(
        stateAfter.EntityReadVersion.length,
        before.EntityReadVersion.length + 1
      )
      assert.equal(
        stateAfter.CommandReceipt.length,
        before.CommandReceipt.length + 1
      )
      assert.equal(
        BigInt(stateAfter.BusinessSequence[0].value),
        BigInt(before.BusinessSequence[0].value) + 1n
      )
      const replay = await applied(save(body))
      assert.equal(replay.replayed, true)
      assert.equal(replay.commandId, committed.commandId)
      assert.deepEqual(replay.result, committed.result)
      await denied(
        save({ ...body, input: { ...body.input, reason: "Changed payload" } }),
        409,
        "IDEMPOTENCY_MISMATCH"
      )
      assert.deepEqual(await state(), stateAfter)
      const audit = stateAfter.AuditEntry.find(
        (r) => r.commandId === committed.commandId
      )
      assert.ok(audit)
      assert.ok(
        audit.reason &&
          audit.fieldDiff["company.identity"] &&
          !audit.fieldDiff.company
      )
      assert.deepEqual(audit.fieldDiff["company.name"].before, row.company.name)
    }
  )
  await group(
    "field-scoped exact changed-leaf authority, hidden read/audit fields and current revocation",
    async () => {
      await roleRules(grants)
      await attachRole()
      const row = await settings()
      const body = bodyFor(row, {
        company: { ...row.company, name: `Scoped company ${suffix}` },
      })
      const result = await applied(save(body, staff.request))
      const after = await settings(),
        beforeDenied = await state()
      await denied(
        save(
          bodyFor(after, {
            company: { ...after.company, phone: "0111111111" },
          }),
          staff.request
        ),
        403,
        "FIELD_FORBIDDEN"
      )
      await denied(
        save(bodyFor(after, { theme: "LIGHT" }), staff.request),
        403,
        "FIELD_FORBIDDEN"
      )
      assert.deepEqual(await state(), beforeDenied)
      await applied(save(bodyFor(after), staff.request)) // no business field changed
      await openEditor(limited)
      await expect(
        limited.getByLabel("Company name", { exact: true })
      ).toBeEnabled()
      await expect(
        limited.getByLabel("Company phone", { exact: true })
      ).toBeDisabled()
      await expect(
        limited.getByLabel("Timezone", { exact: true })
      ).toBeDisabled()
      await limited
        .getByRole("button", { name: "Discard draft", exact: true })
        .click()
      await roleRules([
        {
          subject: "Settings",
          action: "read",
          fields: ["id", "revision", "company.name"],
        },
        { subject: "Settings", action: "update", fields: ["company.name"] },
        { subject: "AuditLog", action: "read", fields: ["*"] },
      ])
      const visible = await query<Record<string, unknown>>(
        staff.request,
        "settings"
      )
      assert.deepEqual(visible.company, { name: after.company.name })
      assert.ok(!JSON.stringify(visible).includes(after.company.identity))
      const audit = await query<unknown>(
        staff.request,
        "audit",
        `?type=Settings&id=${row.id}&pageSize=100`
      )
      assert.ok(!JSON.stringify(audit).includes(row.company.identity))
      assert.ok(!JSON.stringify(audit).includes(row.company.email))
      // Direct full replacement may retain trusted-current unread values without
      // gaining authority to change them. A full-object UI must not fabricate them.
      const latest = await settings()
      await applied(
        save(
          bodyFor(latest, {
            company: { ...latest.company, name: `Hidden unchanged ${suffix}` },
          }),
          staff.request
        )
      )
      await limited.bringToFront()
      await limited.goto("/settings")
      await expect(
        limited.getByText(/Full-object editing unavailable/)
      ).toBeVisible()
      await expect(
        limited.getByRole("button", { name: "Edit settings", exact: true })
      ).toHaveCount(0)
      assert.ok(!(await limited.content()).includes(latest.company.identity))
      await roleRules([{ subject: "Settings", action: "read", fields: ["*"] }])
      const noEffects = await state()
      await denied(save(body, staff.request), 403, "FORBIDDEN")
      assert.deepEqual(await state(), noEffects)
      assert.ok(result.commandId)
    }
  )
  await group(
    "rollback at version, pointer, audit, read-version, receipt and deferred final constraint; exact retry once",
    async () => {
      for (const [table, event, deferred] of [
        ["SettingsVersion", "INSERT", false],
        ["Settings", "UPDATE", false],
        ["AuditEntry", "INSERT", false],
        ["EntityReadVersion", "INSERT", false],
        ["CommandReceipt", "INSERT", false],
        ["Settings", "UPDATE", true],
      ] as const) {
        const row = await settings(),
          body = bodyFor(row, {
            warningLeadDays: (row.warningLeadDays + 1) % 8,
          }),
          before = await state()
        await db.query(
          "CREATE FUNCTION vamotors.t04d_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic T04d rollback fault' USING ERRCODE='23514'; END $$"
        )
        try {
          await db.query(
            deferred
              ? `CREATE CONSTRAINT TRIGGER t04d_fault AFTER UPDATE ON vamotors."Settings" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vamotors.t04d_fault()`
              : `CREATE TRIGGER t04d_fault BEFORE ${event} ON vamotors."${table}" FOR EACH STATEMENT EXECUTE FUNCTION vamotors.t04d_fault()`
          )
          await denied(save(body), 500)
          assert.deepEqual(await state(), before)
        } finally {
          await db.query(
            `DROP TRIGGER IF EXISTS t04d_fault ON vamotors."${table}"`
          )
          await db.query("DROP FUNCTION vamotors.t04d_fault()")
        }
        const result = await applied(save(body)),
          replay = await applied(save(body))
        assert.equal(replay.commandId, result.commandId)
        assert.equal(replay.replayed, true)
        assert.equal((await settings()).revision, row.revision + 1)
      }
    }
  )
  await group(
    "two-session same-CAS race one winner and same-key replay under lock serialization",
    async () => {
      const row = await settings(),
        body = bodyFor(row, { theme: "SYSTEM" })
      const before = await state()
      const outcomes = await Promise.all([
        save(body),
        save(bodyFor(row, { theme: "LIGHT" }), b.request),
      ])
      assert.deepEqual(outcomes.map((r) => r.status()).sort(), [200, 409])
      assert.equal((await settings()).revision, row.revision + 1)
      assert.equal(
        (await state()).CommandReceipt.length,
        before.CommandReceipt.length + 1
      )
      const next = await settings(),
        same = bodyFor(next, { itemsPerPage: 100 })
      const sameResults = await Promise.all([
        applied(save(same)),
        applied(save(same)),
      ])
      assert.equal(sameResults[0].commandId, sameResults[1].commandId)
      assert.equal(sameResults.filter((r) => r.replayed).length, 1)
    }
  )
  await group(
    "finance create/update Settings races, explicit stale recovery, explicit policy retention",
    async () => {
      const old = await settings(),
        input = financeInput(),
        financeBody = envelope(input, [ref("Settings", old)])
      const outcomes = await Promise.all([
        save(bodyFor(old, { processingFee: "777" })),
        post(b.request, "createFinanceCompany", financeBody),
      ])
      assert.equal(outcomes[0].status(), 200)
      assert.ok([201, 409].includes(outcomes[1].status()))
      if (outcomes[1].status() === 409)
        assert.equal((await outcomes[1].json()).error.code, "STALE_REVISION")
      const after = await settings(),
        noEffects = await state()
      await denied(
        post(
          a.request,
          "createFinanceCompany",
          envelope(financeInput(), [ref("Settings", old)])
        ),
        409,
        "STALE_REVISION"
      )
      assert.deepEqual(await state(), noEffects)
      const created = await applied(
        post(
          a.request,
          "createFinanceCompany",
          envelope(input, [ref("Settings", after)])
        )
      )
      let company = await query<{
        id: string
        revision: number
        name: string
        contacts: unknown[]
        policy: unknown
      }>(a.request, "party", `?type=FINANCE_COMPANY&id=${created.result.id}`)
      assert.deepEqual(company.policy, input.policy)
      const updateSettingsRef = await settings(),
        historyBefore = await histories()
      const updateBody = envelope(
        {
          id: company.id,
          ...input,
          name: `Updated finance ${suffix}`,
          reason: "Synthetic race",
        },
        [ref("Settings", updateSettingsRef), ref("FinanceCompany", company)]
      )
      const updateOutcomes = await Promise.all([
        save(bodyFor(updateSettingsRef, { processingFee: "999" })),
        post(b.request, "updateFinanceCompany", updateBody),
      ])
      assert.equal(updateOutcomes[0].status(), 200)
      assert.ok([200, 409].includes(updateOutcomes[1].status()))
      const current = await settings(),
        beforeStale = await state()
      await denied(
        post(a.request, "updateFinanceCompany", {
          ...updateBody,
          idempotencyKey: randomUUID(),
        }),
        409,
        "STALE_REVISION"
      )
      assert.deepEqual(await state(), beforeStale)
      company = await query(
        a.request,
        "party",
        `?type=FINANCE_COMPANY&id=${company.id}`
      )
      await applied(
        post(
          a.request,
          "updateFinanceCompany",
          envelope(
            {
              id: company.id,
              ...input,
              name: `Reconciled finance ${suffix}`,
              reason: "Explicit recovered intent",
            },
            [ref("Settings", current), ref("FinanceCompany", company)]
          )
        )
      )
      assert.deepEqual(
        (await histories()).FinancePolicyVersion,
        historyBefore.FinancePolicyVersion
      )
      const beforeCurrency = await state()
      await denied(
        save(bodyFor(await settings(), { currency: "USD" })),
        409,
        "IMMUTABLE_CURRENCY"
      )
      assert.deepEqual(await state(), beforeCurrency)
    }
  )
  await group(
    "locked fresh/replay waiters recheck revoked grants and live session",
    async () => {
      await roleRules(grants)
      const row = await settings(),
        replayBody = bodyFor(row, {
          company: { ...row.company, name: `Waiter committed ${suffix}` },
        })
      await applied(save(replayBody, staff.request))
      for (const replay of [true, false]) {
        await roleRules(grants)
        const current = await settings()
        const request = replay
          ? replayBody
          : bodyFor(current, {
              company: { ...current.company, name: `Denied waiter ${suffix}` },
            })
        const lock = await db.connect()
        try {
          await lock.query("BEGIN")
          await lock.query(
            'SELECT value FROM vamotors."BusinessSequence" WHERE id=1 FOR UPDATE'
          )
          const waiting = save(request, staff.request)
          await waitForBusinessWaiter()
          await roleRules([
            { subject: "Settings", action: "read", fields: ["*"] },
          ])
          const before = await state()
          await lock.query("COMMIT")
          await denied(waiting, 403, "FORBIDDEN")
          assert.deepEqual(await state(), before)
        } finally {
          await lock.query("ROLLBACK")
          lock.release()
        }
      }
      await roleRules(grants)
      const lock = await db.connect()
      try {
        const current = await settings(),
          request = bodyFor(current, {
            company: { ...current.company, name: `Revoked cookie ${suffix}` },
          })
        await lock.query("BEGIN")
        await lock.query(
          'SELECT value FROM vamotors."BusinessSequence" WHERE id=1 FOR UPDATE'
        )
        const waiting = save(request, staff.request)
        await waitForBusinessWaiter()
        const logout = await staff.request.post("/api/auth/sign-out", {
          headers: { origin },
          data: {},
        })
        assert.equal(logout.status(), 200)
        const before = await state()
        await lock.query("COMMIT")
        await denied(waiting, 401, "UNAUTHENTICATED")
        assert.deepEqual(await state(), before)
      } finally {
        await lock.query("ROLLBACK")
        lock.release()
      }
      // Fourth loopback sign-in reaches the real per-process limiter. Restart our
      // own app (not policy/rate-limit settings) before a new credential session.
      await stop()
      await start()
      await login(limited, "STAFF")
    }
  )
  await group(
    "minimum runtime privileges, immutable history/owner/delete/future-table denial",
    async () => {
      const row = await settings()
      for (const sql of [
        'UPDATE vamotors."SettingsVersion" SET values=values',
        'DELETE FROM vamotors."SettingsVersion"',
        'DELETE FROM vamotors."Settings"',
        'UPDATE vamotors."Settings" SET singleton=1',
        `UPDATE vamotors."Settings" SET id='${randomUUID()}'`,
        'TRUNCATE vamotors."SettingsVersion"',
        "CREATE TABLE vamotors.t04d_illegal(id int)",
        'UPDATE vamotors."FinancePolicyVersion" SET values=values',
        'DELETE FROM vamotors."FinanceContact"',
        'UPDATE vamotors."FinanceContact" SET "companyId"="companyId"',
        "SET ROLE vamotors_migrator",
      ])
        await assert.rejects(
          restricted.query(sql),
          /permission denied|must be owner/
        )
      await db.query("CREATE TABLE vamotors.t04d_future(id integer)")
      try {
        await assert.rejects(
          restricted.query("SELECT * FROM vamotors.t04d_future"),
          /permission denied/
        )
      } finally {
        await db.query("DROP TABLE vamotors.t04d_future")
      }
      await assert.rejects(
        db.query('UPDATE vamotors."SettingsVersion" SET values=values'),
        /append.only|immutable/i
      )
      assert.equal((await settings()).revision, row.revision)
    }
  )
  await group(
    "desktop full normal-controls save, validation/error focus and persisted deep reload",
    async () => {
      await openEditor()
      await page
        .getByLabel("Company name", { exact: true })
        .fill(`UI company ${suffix}`)
      await page
        .getByLabel("Company identity", { exact: true })
        .fill(`UI-DEV-${suffix}`)
      await page
        .getByLabel("Company address", { exact: true })
        .fill("Synthetic UI address")
      await page.getByLabel("Company phone", { exact: true }).fill("0119876543")
      await page
        .getByLabel("Company email", { exact: true })
        .fill("ui@example.invalid")
      await page
        .getByLabel("Declaration 1", { exact: true })
        .fill("Synthetic UI declaration")
      await page.getByLabel("Timezone", { exact: true }).fill("Asia/Colombo")
      await page
        .getByLabel("Tier 1 upper bound (bps)", { exact: true })
        .fill("750")
      await page.getByLabel("Tier 1 days", { exact: true }).fill("9")
      await page.getByLabel("Warning lead days", { exact: true }).fill("5")
      await page
        .getByLabel("Processing fee (minor units)", { exact: true })
        .fill("abc")
      await page
        .getByRole("button", { name: "Save settings", exact: true })
        .click()
      await expect(page.locator("form [role=alert]")).toContainText(
        "processingFee"
      )
      await expect(
        page.getByLabel("Processing fee (minor units)", { exact: true })
      ).toBeFocused()
      await page
        .getByLabel("Processing fee (minor units)", { exact: true })
        .fill("45678")
      await page
        .getByLabel("Date format", { exact: true })
        .selectOption("YYYY-MM-DD")
      await page
        .getByLabel("Items per page", { exact: true })
        .selectOption("20")
      await page.getByLabel("Theme", { exact: true }).selectOption("LIGHT")
      await page
        .getByLabel("Reason (required)", { exact: true })
        .fill("Synthetic UI full-field correction")
      await page
        .getByRole("button", { name: "Save settings", exact: true })
        .click()
      await expect(
        page.getByText("Settings saved. Reload reads the committed policy.")
      ).toBeVisible()
      const row = await settings()
      assert.equal(row.company.name, `UI company ${suffix}`)
      assert.equal(row.processingFee, "45678")
      assert.equal(row.tiers[0].upperBps, 750)
      await page.reload()
      await expect(
        page.getByText(`UI-DEV-${suffix}`, { exact: true })
      ).toBeVisible()
    }
  )
  await group(
    "committed response-loss, focus/refetch absence and immutable exact retry without key rotation",
    async () => {
      await openEditor()
      await page
        .getByLabel("Company name", { exact: true })
        .fill(`Lost response ${suffix}`)
      await page
        .getByLabel("Reason (required)", { exact: true })
        .fill("Synthetic retained reason")
      const sent: string[] = []
      let lost = false
      await page.route("**/api/v1/commands/updateSettings", async (route) => {
        sent.push(route.request().postData()!)
        if (!lost) {
          lost = true
          const committed = await route.fetch()
          assert.equal(committed.status(), 200)
          await route.abort("connectionfailed")
        } else await route.continue()
      })
      await page
        .getByRole("button", { name: "Save settings", exact: true })
        .click()
      await expect(
        page.getByRole("button", {
          name: "Retry identical request",
          exact: true,
        })
      ).toBeVisible()
      const committedState = await state()
      await page.route("**/api/v1/queries/settings", (route) =>
        route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            ok: false,
            error: { code: "ENVIRONMENT_UNAVAILABLE" },
          }),
        })
      )
      await page.evaluate(() => window.dispatchEvent(new Event("blur")))
      await expect(
        page.getByLabel("Reason (required)", { exact: true })
      ).not.toBeVisible()
      await page.evaluate(() => window.dispatchEvent(new Event("focus")))
      await expect(
        page.getByLabel("Reason (required)", { exact: true })
      ).toBeVisible()
      await expect(
        page.getByLabel("Reason (required)", { exact: true })
      ).toHaveValue("Synthetic retained reason")
      await page
        .getByRole("button", { name: "Retry identical request", exact: true })
        .click()
      await expect(
        page.getByText("Settings saved. Reload reads the committed policy.")
      ).toBeVisible()
      assert.equal(sent.length, 2)
      assert.equal(sent[0], sent[1])
      assert.deepEqual(await state(), committedState)
      await page.unroute("**/api/v1/queries/settings")
      await page.unroute("**/api/v1/commands/updateSettings")
    }
  )
  await group(
    "stale intent retains draft/reason; explicit refetch/review/reconfirm creates a new key",
    async () => {
      await openEditor()
      await page
        .getByLabel("Company name", { exact: true })
        .fill(`Stale draft ${suffix}`)
      await page
        .getByLabel("Reason (required)", { exact: true })
        .fill("Synthetic stale reason")
      await applied(
        save(bodyFor(await settings(), { theme: "DARK" }), b.request)
      )
      const sent: string[] = []
      page.on("request", (request) => {
        if (request.url().endsWith("/commands/updateSettings"))
          sent.push(request.postData()!)
      })
      await page
        .getByRole("button", { name: "Save settings", exact: true })
        .click()
      await expect(page.locator("form [role=alert]")).toContainText(
        "STALE_REVISION"
      )
      await expect(
        page.getByLabel("Company name", { exact: true })
      ).toHaveValue(`Stale draft ${suffix}`)
      await page
        .getByRole("button", {
          name: "Refetch latest for reconciliation",
          exact: true,
        })
        .click()
      await page
        .getByRole("button", {
          name: "Reconfirm draft against reviewed revision",
          exact: true,
        })
        .click()
      await expect(
        page.getByLabel("Reason (required)", { exact: true })
      ).toHaveValue("Synthetic stale reason")
      await page
        .getByRole("button", { name: "Save settings", exact: true })
        .click()
      await expect(
        page.getByText("Settings saved. Reload reads the committed policy.")
      ).toBeVisible()
      assert.equal(sent.length, 2)
      assert.notEqual(
        JSON.parse(sent[0]).idempotencyKey,
        JSON.parse(sent[1]).idempotencyKey
      )
      assert.ok(
        JSON.parse(sent[1]).expected[0].revision >
          JSON.parse(sent[0]).expected[0].revision
      )
    }
  )
  await group(
    "360px keyboard draft retention, transient read failure and route isolation",
    async () => {
      await openEditor(second)
      await second
        .getByLabel("Company name", { exact: true })
        .fill(`Mobile draft ${suffix}`)
      await second
        .getByLabel("Reason (required)", { exact: true })
        .fill("Synthetic mobile reason")
      await second.getByLabel("Company name", { exact: true }).focus()
      await second.keyboard.press("Tab")
      await expect(
        second.getByLabel("Company identity", { exact: true })
      ).toBeFocused()
      assert.ok(
        await second.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      )
      await second.evaluate(() => window.dispatchEvent(new Event("blur")))
      await expect(
        second.getByLabel("Company name", { exact: true })
      ).not.toBeVisible()
      await second.evaluate(() => window.dispatchEvent(new Event("focus")))
      await expect(
        second.getByLabel("Company name", { exact: true })
      ).toHaveValue(`Mobile draft ${suffix}`)
      await second
        .getByRole("button", { name: "Discard draft", exact: true })
        .click()
      await second.goto("/third-parties")
      await second.goto("/settings")
      await expect(
        second.getByRole("button", { name: "Edit settings", exact: true })
      ).toBeVisible()
      assert.ok(!(await second.content()).includes(`Mobile draft ${suffix}`))
    }
  )
  await group(
    "current role revocation hides/discards open editor and prevents replay",
    async () => {
      await roleRules(grants)
      await openEditor(limited)
      await limited
        .getByLabel("Company name", { exact: true })
        .fill(`Private revoked ${suffix}`)
      const row = await settings(),
        body = bodyFor(row, {
          company: { ...row.company, name: `Scoped committed ${suffix}` },
        })
      await applied(save(body, staff.request))
      await roleRules([])
      const noEffects = await state()
      await denied(save(body, staff.request), 404, "NOT_FOUND")
      assert.deepEqual(await state(), noEffects)
      await limited.evaluate(() => window.dispatchEvent(new Event("focus")))
      await expect(
        limited.getByLabel("Company name", { exact: true })
      ).toHaveCount(0)
      assert.ok(
        !(await limited.content()).includes(`Private revoked ${suffix}`)
      )
    }
  )
  await group(
    "account switch and real logout discard private Settings drafts",
    async () => {
      await openEditor()
      await page
        .getByLabel("Company name", { exact: true })
        .fill(`Account private ${suffix}`)
      const originalCookies = await a.cookies()
      await a.clearCookies()
      await a.addCookies(await b.cookies())
      await page.evaluate(() => window.dispatchEvent(new Event("focus")))
      await expect(
        page.getByLabel("Company name", { exact: true })
      ).toHaveCount(0)
      await expect(
        page.getByRole("button", { name: "Edit settings", exact: true })
      ).toBeVisible()
      assert.ok(!(await page.content()).includes(`Account private ${suffix}`))
      await a.clearCookies()
      await a.addCookies(originalCookies)
      await page.reload()
      await openEditor(second)
      await second
        .getByLabel("Company name", { exact: true })
        .fill(`Logout private ${suffix}`)
      await second.getByRole("button", { name: "Logout", exact: true }).click()
      await second.waitForURL(/\/login(?:\?|$)/)
      assert.ok(!(await second.content()).includes(`Logout private ${suffix}`))
      await denied(
        b.request.get("/api/v1/queries/settings"),
        401,
        "UNAUTHENTICATED"
      )
    }
  )
  await group(
    "app/DB restart, repeated owner setup and immutable historical facts preserved",
    async () => {
      const current = await settings(),
        retained = await histories(),
        snapshot = await state()
      await stop()
      await db.end()
      await restricted.end()
      await monitor.end()
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
        ["--import", "tsx", "scripts/local-postgres.ts", "setup"],
        {
          env: { ...process.env, VAMOTORS_LOCAL_DIR: directory },
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
      assert.deepEqual(await settings(), current)
      assert.deepEqual(await histories(), retained)
      assert.deepEqual(await state(), snapshot)
      for (const [table, rows] of Object.entries(baselineHistory)) {
        const now = (await histories())[table]
        for (const row of rows)
          assert.deepEqual(
            now.find((r) => r.id === row.id),
            row
          )
      }
    }
  )
  await writeFile(
    join(directory, "t04d-settings-result.json"),
    JSON.stringify(
      {
        passed: results.length,
        results,
        retries: 0,
        source: execFileSync("git", ["rev-parse", "HEAD"], {
          encoding: "utf8",
        }).trim(),
        dirty:
          execFileSync("git", ["status", "--porcelain"], {
            encoding: "utf8",
          }).trim() !== "",
        fixture: directory,
        counts: Object.fromEntries(
          Object.entries(await state()).map(([key, rows]) => [key, rows.length])
        ),
      },
      null,
      2
    ),
    { mode: 0o600 }
  )
  console.log(
    `Settings production campaign: ${results.length} groups passed; no downstream snapshot acceptance implied.`
  )
} catch (error) {
  await writeFile(
    join(directory, "t04d-settings-failure.json"),
    JSON.stringify({ stage, passed: results, message: String(error) }, null, 2),
    { mode: 0o600 }
  )
  console.error(`FAIL ${stage}: ${String(error)}`)
  process.exitCode = 1
} finally {
  await browser.close()
  await stop()
  await db.end()
  await restricted.end()
  await monitor.end()
  // Keep retained data, stop only this campaign's explicitly owned cluster.
}
