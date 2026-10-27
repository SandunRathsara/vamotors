/** Own isolated production Next/Chromium/real-PG campaign. No cloud or mocks. */
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { spawn, execFileSync, type ChildProcess } from "node:child_process"
import { once } from "node:events"
import { createServer } from "node:net"
import { join } from "node:path"
import { writeFile, readFile } from "node:fs/promises"
import {
  chromium,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test"
import pg from "pg"
import { privateEnvironment } from "../../scripts/private-environment"
import type {
  Applied,
  PartyDTO,
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
const admin = await privateEnvironment(join(directory, "admin.env"))
const monitorURL = new URL(admin.ADMIN_URL!)
monitorURL.pathname = new URL(migration.DIRECT_URL!).pathname
assert.equal(monitorURL.hostname, "127.0.0.1")
let monitor = new pg.Pool({ connectionString: monitorURL.href, max: 1 })
assert.equal(cluster.PROJECT, process.argv[3] ?? process.cwd())
assert.equal(runtime.APP_ENV, "local")
assert.equal(new URL(runtime.DATABASE_URL!).hostname, "127.0.0.1")
let db = new pg.Pool({ connectionString: migration.DIRECT_URL, max: 3 })
let restricted = new pg.Pool({
  connectionString: runtime.DATABASE_URL,
  max: 2,
})
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
const a = await browser.newContext({ baseURL: origin }),
  b = await browser.newContext({
    baseURL: origin,
    viewport: { width: 360, height: 800 },
  }),
  staff = await browser.newContext({ baseURL: origin }),
  anonymous = await browser.newContext({ baseURL: origin })
const page = await a.newPage(),
  second = await b.newPage(),
  limited = await staff.newPage()
const suffix = randomUUID().slice(0, 8)
let stage = "initialize",
  passed = 0
const results: string[] = []
async function group(name: string, run: () => Promise<void>) {
  stage = name
  await run()
  passed++
  results.push(name)
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
const ref = (
  type: Dependency["type"],
  row: { id: string; revision: number }
): Dependency => ({ type, id: row.id, revision: row.revision })
const policy = {
  path: "APPLICATION",
  commission: { basis: "FINANCED_PRINCIPAL", rateBps: 150 },
  processingFee: "123450",
  reconciliationMethod: "PERIOD_NOTICE",
}
const contact = {
  name: "Synthetic finance contact",
  phone: "0112345678",
  role: "Agent",
  primary: true,
}
const createValues = (name: string) => ({
  name,
  contacts: [contact, { ...contact, name: "Secondary", primary: false }],
  policy,
})
function envelope(
  input: unknown,
  expected: Dependency[] = [],
  key = randomUUID()
) {
  return { schemaVersion: 1, idempotencyKey: key, expected, input }
}
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
    `${name}: ${r.status()} ${(await r.text()).slice(0, 500)}`
  )
  return r.json()
}
async function denied(
  response: Awaited<ReturnType<typeof post>>,
  status: number,
  code: string
) {
  assert.equal(response.status(), status)
  const body = await response.json()
  assert.equal(body.error.code, code)
  assert.equal(body.ok, false)
}
const party = (id: string, type = "FINANCE_COMPANY", client = a.request) =>
  query<
    PartyDTO & {
      contributions?: Record<string, { state: string; links: unknown[] }>
      redactedFields?: string[]
    }
  >(client, "party", `?type=${type}&id=${id}`)
const settings = () => query<QueryData["settings"]>(a.request, "settings")
let currentSettings: QueryData["settings"],
  company: PartyDTO,
  staffId = "",
  roleId = ""
const counts = async () =>
  (
    await db.query(
      `SELECT (SELECT count(*) FROM vamotors."FinanceCompany")::text AS companies,(SELECT count(*) FROM vamotors."FinanceContact")::text AS contacts,(SELECT count(*) FROM vamotors."FinancePolicyVersion")::text AS policies,(SELECT count(*) FROM vamotors."CommandReceipt")::text AS receipts,(SELECT count(*) FROM vamotors."AuditEntry")::text AS audits,(SELECT count(*) FROM vamotors."EntityReadVersion")::text AS versions,(SELECT value::text FROM vamotors."BusinessSequence" WHERE id=1) AS sequence`
    )
  ).rows[0]
async function waitForBusinessWaiters(count: number) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const waiting = (
      await monitor.query(
        "SELECT count(*)::integer AS n FROM pg_stat_activity WHERE usename='vamotors_runtime' AND wait_event_type='Lock' AND query LIKE '%BusinessSequence%'"
      )
    ).rows[0].n
    if (waiting >= count) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error("EXPECTED_BUSINESS_LOCK_WAITERS")
}
async function updateCompany(
  row: PartyDTO,
  patch: Record<string, unknown> = {}
) {
  assert.ok(row.policy)
  return applied(
    a.request,
    "updateFinanceCompany",
    envelope(
      {
        id: row.id,
        name: row.name,
        contacts: row.contacts.map((c) => ({
          name: c.name,
          phone: c.phone,
          ...(c.email !== undefined ? { email: c.email } : {}),
          role: c.role,
          primary: c.primary,
        })),
        policy: row.policy,
        reason: "Synthetic correction",
        ...patch,
      },
      [ref("FinanceCompany", row), ref("Settings", await settings())]
    )
  )
}
// Owner-generated version is a concurrency fixture, NOT updateSettings/API proof.
async function ownerSettingsVersion() {
  const client = await db.connect()
  try {
    await client.query("BEGIN")
    await client.query(
      'SELECT value FROM vamotors."BusinessSequence" WHERE id=1 FOR UPDATE'
    )
    await client.query("SELECT vamotors.lock_admin_guard()")
    const row = (
      await client.query(
        'SELECT s.*,v.version,v.values FROM vamotors."Settings" s JOIN vamotors."SettingsVersion" v ON v.id=s."currentVersionId" WHERE singleton=1'
      )
    ).rows[0]
    const id = randomUUID()
    await client.query(
      'INSERT INTO vamotors."SettingsVersion"(id,version,values) VALUES($1,$2,$3)',
      [id, row.version + 7, { ...row.values, processingFee: "250001" }]
    )
    await client.query(
      'UPDATE vamotors."Settings" SET revision=revision+1,"currentVersionId"=$1 WHERE id=$2',
      [id, row.id]
    )
    await client.query("COMMIT")
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
  }
}
try {
  // Restore only this disposable campaign's restricted account assignments on
  // retry; retain every business row, version, contact, policy and receipt.
  const setup = await db.connect()
  try {
    await setup.query("BEGIN")
    await setup.query("SELECT vamotors.lock_admin_guard()")
    await setup.query(
      "DELETE FROM vamotors.\"UserRole\" WHERE \"userId\"='03000000-0000-4000-8000-000000000013' AND \"roleId\" NOT IN ('03000000-0000-4000-8000-000000000002','03000000-0000-4000-8000-000000000003')"
    )
    await setup.query(
      'UPDATE vamotors."user" SET "authzRevision"="authzRevision"+1 WHERE id=\'03000000-0000-4000-8000-000000000013\''
    )
    await setup.query("SET CONSTRAINTS ALL IMMEDIATE")
    await setup.query("COMMIT")
  } catch (error) {
    await setup.query("ROLLBACK")
    throw error
  } finally {
    setup.release()
  }
  await start()
  await group(
    "two independent real sessions and persisted strict Settings read",
    async () => {
      await Promise.all([
        login(page, "ADMIN"),
        login(second, "SECOND"),
        login(limited, "STAFF"),
      ])
      currentSettings = await settings()
      assert.ok(currentSettings.id && currentSettings.revision > 0)
      assert.ok(["250000", "250001"].includes(currentSettings.processingFee))
      assert.equal(currentSettings.currency, "LKR")
      assert.equal(currentSettings.company.identity, "SYNTHETIC-DEV")
      await denied(
        await anonymous.request.get("/api/v1/queries/settings"),
        401,
        "UNAUTHENTICATED"
      )
      await denied(
        await staff.request.get("/api/v1/queries/settings"),
        404,
        "NOT_FOUND"
      )
      await denied(
        await a.request.get("/api/v1/queries/settings?fake=1"),
        422,
        "INVALID_INPUT"
      )
      await denied(
        await post(
          a.request,
          "updateSettings",
          envelope({ ...currentSettings, reason: "Not enabled" })
        ),
        404,
        "NOT_FOUND"
      )
    }
  )
  await group(
    "finance strict DTO, required Settings ref, create and exactly-once replay",
    async () => {
      const before = await counts()
      const input = createValues(`Finance API ${suffix}`)
      await denied(
        await post(a.request, "createFinanceCompany", envelope(input)),
        428,
        "REVISION_REQUIRED"
      )
      await denied(
        await post(
          a.request,
          "createFinanceCompany",
          envelope({ ...input, contacts: [{ ...contact, id: randomUUID() }] }, [
            ref("Settings", currentSettings),
          ])
        ),
        422,
        "INVALID_INPUT"
      )
      await denied(
        await post(
          a.request,
          "createFinanceCompany",
          envelope({ ...input, policy: { ...policy, processingFee: "01" } }, [
            ref("Settings", currentSettings),
          ])
        ),
        422,
        "INVALID_INPUT"
      )
      await denied(
        await post(
          a.request,
          "createFinanceCompany",
          envelope(input, [
            ref("Settings", currentSettings),
            ref("Settings", currentSettings),
          ])
        ),
        422,
        "INVALID_INPUT"
      )
      assert.deepEqual(await counts(), before)
      const body = envelope(input, [ref("Settings", currentSettings)])
      const [one, two] = await Promise.all([
        applied(a.request, "createFinanceCompany", body),
        applied(a.request, "createFinanceCompany", body),
      ])
      assert.equal(one.commandId, two.commandId)
      assert.notEqual(one.replayed, two.replayed)
      company = await party(one.result.id)
      assert.equal(company.contacts.length, 2)
      assert.equal(company.policy!.processingFee, "123450")
      await denied(
        await post(a.request, "createFinanceCompany", {
          ...body,
          input: { ...input, name: "Changed intent" },
        }),
        409,
        "IDEMPOTENCY_MISMATCH"
      )
      const after = await counts()
      assert.equal(BigInt(after.companies) - BigInt(before.companies), 1n)
      const replay = await applied(a.request, "createFinanceCompany", body)
      assert.equal(replay.replayed, true)
      assert.deepEqual(await counts(), after)
    }
  )
  await group(
    "typed detail strict selectors, wrong-type and hidden 404; static pending not fake empty",
    async () => {
      for (const params of [
        `?id=${company.id}`,
        `?id=bad&type=SUPPLIER`,
        `?id=${company.id}&type=FINANCE_COMPANY&type=SUPPLIER`,
        `?id=${company.id}&type=FINANCE_COMPANY&q=guess`,
      ])
        await denied(
          await a.request.get(`/api/v1/queries/party${params}`),
          422,
          "INVALID_INPUT"
        )
      await denied(
        await a.request.get(
          `/api/v1/queries/party?type=SUPPLIER&id=${company.id}`
        ),
        404,
        "NOT_FOUND"
      )
      await denied(
        await staff.request.get(
          `/api/v1/queries/party?type=FINANCE_COMPANY&id=${company.id}`
        ),
        404,
        "NOT_FOUND"
      )
      const detail = await party(company.id)
      assert.equal(Object.keys(detail.contributions!).length, 5)
      for (const contribution of Object.values(detail.contributions!)) {
        assert.equal(contribution.state, "PENDING_DOMAIN")
        assert.deepEqual(contribution.links, [])
      }
      await second.goto(`/third-parties/${company.id}?type=FINANCE_COMPANY`)
      await expect(
        second.getByRole("heading", { name: company.name, exact: true })
      ).toBeVisible()
      await expect(second.getByText(/History pending/)).toHaveCount(5)
      await expect(
        second.getByText(/No visible records in this domain/)
      ).toHaveCount(0)
      assert.ok(
        await second.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      )
    }
  )
  await group(
    "policy append/contact identity retention and archive/reactivate CAS",
    async () => {
      const originalContacts = company.contacts.map((c) => c.id)
      const oldPolicies = (
        await db.query(
          'SELECT id,values FROM vamotors."FinancePolicyVersion" WHERE "companyId"=$1',
          [company.id]
        )
      ).rows
      await updateCompany(company, { name: `${company.name} renamed` })
      company = await party(company.id)
      assert.deepEqual(
        company.contacts.map((c) => c.id).sort(),
        originalContacts.sort()
      )
      assert.equal(
        (
          await db.query(
            'SELECT count(*) FROM vamotors."FinancePolicyVersion" WHERE "companyId"=$1',
            [company.id]
          )
        ).rows[0].count,
        "1"
      )
      const replacement = { ...contact, name: "Replacement identity" }
      await updateCompany(company, {
        contacts: [replacement],
        policy: {
          path: "REFERRAL",
          commission: { basis: "FIXED", fixed: "500000", rateBps: 250 },
          processingFee: "0",
          reconciliationMethod: "PER_DEAL",
        },
      })
      company = await party(company.id)
      assert.equal(company.contacts.length, 1)
      assert.ok(!originalContacts.includes(company.contacts[0].id))
      assert.equal(
        (
          await db.query(
            'SELECT count(*) FROM vamotors."FinanceContact" WHERE id=ANY($1::uuid[]) AND NOT active',
            [originalContacts]
          )
        ).rows[0].count,
        "2"
      )
      assert.deepEqual(
        (
          await db.query(
            'SELECT id,values FROM vamotors."FinancePolicyVersion" WHERE id=$1',
            [oldPolicies[0].id]
          )
        ).rows,
        oldPolicies
      )
      const stale = envelope(
        {
          type: "FINANCE_COMPANY",
          id: company.id,
          active: false,
          reason: "Archive old revision",
        },
        [ref("FinanceCompany", { ...company, revision: company.revision - 1 })]
      )
      await denied(
        await post(a.request, "archiveParty", stale),
        409,
        "STALE_REVISION"
      )
      for (const active of [false, true]) {
        await applied(
          a.request,
          "archiveParty",
          envelope(
            {
              type: "FINANCE_COMPANY",
              id: company.id,
              active,
              reason: "Synthetic archive test",
            },
            [ref("FinanceCompany", company)]
          )
        )
        company = await party(company.id)
        assert.equal(company.active, active)
        assert.equal(company.contacts[0].name, replacement.name)
      }
    }
  )
  await group(
    "Settings CAS differs from policyVersion and stale finance has zero effects",
    async () => {
      const stale = await settings(),
        input = createValues(`Settings stale ${suffix}`)
      await ownerSettingsVersion()
      currentSettings = await settings()
      assert.notEqual(currentSettings.revision, currentSettings.policyVersion)
      const before = await counts()
      await denied(
        await post(
          a.request,
          "createFinanceCompany",
          envelope(input, [ref("Settings", stale)])
        ),
        409,
        "STALE_REVISION"
      )
      await denied(
        await post(
          a.request,
          "createFinanceCompany",
          envelope(input, [
            ref("Settings", {
              ...currentSettings,
              revision: currentSettings.policyVersion,
            }),
          ])
        ),
        409,
        "STALE_REVISION"
      )
      assert.deepEqual(await counts(), before)
      await applied(
        a.request,
        "createFinanceCompany",
        envelope(input, [ref("Settings", currentSettings)])
      )
    }
  )
  await group(
    "atomic company/contact/policy/audit/version/receipt/final-constraint faults recover with same key",
    async () => {
      for (const table of [
        "FinanceCompany",
        "FinanceContact",
        "FinancePolicyVersion",
        "AuditEntry",
        "EntityReadVersion",
        "CommandReceipt",
        "FINAL_CONSTRAINT",
      ]) {
        const body = envelope(createValues(`Rollback ${table} ${suffix}`), [
          ref("Settings", currentSettings),
        ])
        const before = await counts()
        await db.query(
          "CREATE FUNCTION vamotors.t04c_test_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'SYNTHETIC_T04C_FAULT' USING ERRCODE='23514'; END $$"
        )
        const target = table === "FINAL_CONSTRAINT" ? "FinanceCompany" : table
        await db.query(
          table === "FINAL_CONSTRAINT"
            ? `CREATE CONSTRAINT TRIGGER t04c_fault AFTER INSERT ON vamotors."${target}" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vamotors.t04c_test_fault()`
            : `CREATE TRIGGER t04c_fault BEFORE INSERT ON vamotors."${target}" FOR EACH ROW EXECUTE FUNCTION vamotors.t04c_test_fault()`
        )
        try {
          assert.equal(
            (await post(a.request, "createFinanceCompany", body)).status(),
            500
          )
          assert.deepEqual(await counts(), before)
        } finally {
          await db.query(`DROP TRIGGER t04c_fault ON vamotors."${target}"`)
          await db.query("DROP FUNCTION vamotors.t04c_test_fault()")
        }
        const appliedResult = await applied(
          a.request,
          "createFinanceCompany",
          body
        )
        const replay = await applied(a.request, "createFinanceCompany", body)
        assert.equal(replay.commandId, appliedResult.commandId)
        assert.equal(replay.replayed, true)
      }
    }
  )
  await group(
    "company CAS race and primary uniqueness produce no partial losers",
    async () => {
      company = await party(company.id)
      const input = {
        id: company.id,
        name: company.name,
        contacts: [contact],
        policy: company.policy,
        reason: "Race test",
      }
      const refs = [
        ref("FinanceCompany", company),
        ref("Settings", currentSettings),
      ]
      const responses = await Promise.all([
        post(a.request, "updateFinanceCompany", envelope(input, refs)),
        post(
          b.request,
          "updateFinanceCompany",
          envelope({ ...input, name: `${company.name} race` }, refs)
        ),
      ])
      assert.deepEqual(responses.map((r) => r.status()).sort(), [200, 409])
      company = await party(company.id)
      assert.equal(company.contacts.filter((c) => c.primary).length, 1)
      const before = await counts()
      await denied(
        await post(
          a.request,
          "updateFinanceCompany",
          envelope(
            {
              ...input,
              contacts: [contact, { ...contact, name: "Second primary" }],
            },
            [ref("FinanceCompany", company), ref("Settings", currentSettings)]
          )
        ),
        422,
        "INVALID_INPUT"
      )
      assert.deepEqual(await counts(), before)
    }
  )
  await group(
    "exact runtime privileges: no owner/DDL/future tables/history edits or deletes",
    async () => {
      for (const sql of [
        'UPDATE vamotors."Settings" SET revision=revision+1',
        "INSERT INTO vamotors.\"SettingsVersion\"(id,version,values) VALUES(gen_random_uuid(),999,'{}')",
        'UPDATE vamotors."FinanceCompany" SET "createdBy"=\'03000000-0000-4000-8000-000000000013\'',
        "UPDATE vamotors.\"FinanceContact\" SET name='impersonated'",
        'DELETE FROM vamotors."FinanceCompany"',
        'DELETE FROM vamotors."FinanceContact"',
        'DELETE FROM vamotors."FinancePolicyVersion"',
        "UPDATE vamotors.\"FinancePolicyVersion\" SET values='{}'",
        "UPDATE vamotors.\"EntityReadVersion\" SET payload='{}'",
        'UPDATE vamotors."AuditEntry" SET "fieldDiff"=\'{}\'',
        'ALTER TABLE vamotors."FinanceCompany" ADD COLUMN unauthorized text',
        "CREATE TABLE vamotors.unauthorized(id int)",
      ])
        await assert.rejects(restricted.query(sql))
      await db.query('CREATE TABLE vamotors."T04cFutureTable"(id integer)')
      try {
        await assert.rejects(
          restricted.query('SELECT * FROM vamotors."T04cFutureTable"')
        )
        await assert.rejects(
          restricted.query('INSERT INTO vamotors."T04cFutureTable" VALUES(1)')
        )
      } finally {
        await db.query('DROP TABLE vamotors."T04cFutureTable"')
      }
      const versions = (
        await db.query(
          'SELECT id,values FROM vamotors."SettingsVersion" ORDER BY version DESC LIMIT 1'
        )
      ).rows[0]
      await assert.rejects(
        db.query(
          'UPDATE vamotors."SettingsVersion" SET values=values WHERE id=$1',
          [versions.id]
        )
      )
      await assert.rejects(
        db.query(
          'INSERT INTO vamotors."SettingsVersion"(id,version,values) VALUES($1,99999,$2)',
          [randomUUID(), { ...versions.values, currency: "USD" }]
        ),
        /IMMUTABLE_CURRENCY/
      )
      await assert.rejects(
        restricted.query(
          'INSERT INTO vamotors."FinancePolicyVersion"(id,"companyId",version,values) VALUES($1,$2,99999,$3)',
          [randomUUID(), company.id, {}]
        ),
        /valid_policy/
      )
    }
  )
  await group(
    "field/record/count/contact/policy/audit privacy and immediate revocation",
    async () => {
      const users = await query<{
        data: {
          id: string
          revision: number
          email: string
          name: string
          active: boolean
          roles: { id: string }[]
        }[]
      }>(a.request, "users", "?pageSize=100")
      const user = users.data.find(
        (u) => u.email === accounts.BOOTSTRAP_STAFF_EMAIL
      )!
      staffId = user.id
      const retainedRoles = user.roles.filter((r) =>
        [
          "03000000-0000-4000-8000-000000000002",
          "03000000-0000-4000-8000-000000000003",
        ].includes(r.id)
      )
      const grants: Grant[] = [
        {
          subject: "FinanceCompany",
          action: "read",
          fields: ["id", "revision", "name", "active", "policy.path"],
          conditions: { createdBy: "$actor.id" },
        },
        { subject: "FinanceCompany", action: "create", fields: ["*"] },
        { subject: "FinanceCompany", action: "update", fields: ["name"] },
        { subject: "Settings", action: "read", fields: ["id", "revision"] },
        { subject: "AuditLog", action: "read", fields: ["*"] },
      ]
      const role = await applied(
        a.request,
        "saveRole",
        envelope({
          name: `T04c restricted ${suffix}`,
          grants,
          reason: "Privacy campaign",
        })
      )
      roleId = role.result.id
      await applied(
        a.request,
        "updateUser",
        envelope(
          {
            id: user.id,
            name: user.name,
            active: true,
            roleIds: [...retainedRoles.map((r) => r.id), roleId],
            reason: "Privacy grant",
          },
          [
            ref("User", user),
            ref("Role", role.result),
            ...(await Promise.all(
              retainedRoles.map(async (r) =>
                ref(
                  "Role",
                  await query<{ id: string; revision: number }>(
                    a.request,
                    "role",
                    `?id=${r.id}`
                  )
                )
              )
            )),
          ]
        )
      )
      const projected = await query<Record<string, unknown>>(
        staff.request,
        "settings"
      )
      assert.deepEqual(Object.keys(projected).sort(), [
        "id",
        "redactedFields",
        "revision",
      ])
      const ownBody = envelope(createValues(`Private own ${suffix}`), [
        ref("Settings", currentSettings),
      ])
      const own = await applied(staff.request, "createFinanceCompany", ownBody)
      const visible = await party(
        own.result.id,
        "FINANCE_COMPANY",
        staff.request
      )
      assert.equal(visible.contacts, undefined)
      assert.deepEqual(visible.policy, { path: "APPLICATION" })
      assert.deepEqual(visible.contributions, {})
      assert.ok(!JSON.stringify(visible).includes("123450"))
      assert.ok(!JSON.stringify(visible).includes(contact.name))
      const list = await query<{ total: number; data: PartyDTO[] }>(
        staff.request,
        "parties",
        "?type=FINANCE_COMPANY"
      )
      assert.equal(
        list.total,
        Number(
          (
            await db.query(
              'SELECT count(*) FROM vamotors."FinanceCompany" WHERE "createdBy"=$1',
              [staffId]
            )
          ).rows[0].count
        )
      )
      assert.ok(list.data.some((row) => row.id === own.result.id))
      assert.ok(!list.data.some((row) => row.id === company.id))
      await denied(
        await staff.request.get(
          `/api/v1/queries/party?type=FINANCE_COMPANY&id=${company.id}`
        ),
        404,
        "NOT_FOUND"
      )
      const audit = await query<unknown>(
        staff.request,
        "audit",
        `?type=FinanceCompany&id=${own.result.id}`
      )
      assert.ok(!JSON.stringify(audit).includes("123450"))
      assert.ok(!JSON.stringify(audit).includes(contact.name))
      const before = await counts()
      for (const patch of [
        { policy: { ...policy, processingFee: "99" } },
        { contacts: [{ ...contact, name: "Forbidden replacement" }] },
      ])
        await denied(
          await post(
            staff.request,
            "updateFinanceCompany",
            envelope(
              {
                ...createValues(`Private own ${suffix}`),
                ...patch,
                id: own.result.id,
                reason: "Denied field change despite name-update authority",
              },
              [
                ref("FinanceCompany", own.result),
                ref("Settings", currentSettings),
              ]
            )
          ),
          403,
          "FIELD_FORBIDDEN"
        )
      assert.deepEqual(await counts(), before)
      await limited.goto(`/third-parties/${own.result.id}?type=FINANCE_COMPANY`)
      await expect(
        limited.getByRole("heading", {
          name: `Private own ${suffix}`,
          exact: true,
        })
      ).toBeVisible()
      const currentRole = await query<{ id: string; revision: number }>(
        a.request,
        "role",
        `?id=${roleId}`
      )
      const blocker = await db.connect()
      let waiting: Promise<Awaited<ReturnType<typeof post>>>[] = []
      const revocationCounts = await counts()
      try {
        await blocker.query("BEGIN")
        await blocker.query(
          'SELECT value FROM vamotors."BusinessSequence" WHERE id=1 FOR UPDATE'
        )
        waiting = [
          post(staff.request, "createFinanceCompany", ownBody),
          post(
            staff.request,
            "createFinanceCompany",
            envelope(createValues(`Revoked waiter ${suffix}`), [
              ref("Settings", currentSettings),
            ])
          ),
        ]
        await waitForBusinessWaiters(2)
        await blocker.query("SELECT vamotors.lock_admin_guard()")
        await blocker.query(
          'UPDATE vamotors."Role" SET active=false,revision=revision+1 WHERE id=$1 AND revision=$2',
          [roleId, currentRole.revision]
        )
        await blocker.query("SET CONSTRAINTS ALL IMMEDIATE")
        await blocker.query("COMMIT")
      } catch (error) {
        await blocker.query("ROLLBACK")
        await Promise.allSettled(waiting)
        throw error
      } finally {
        blocker.release()
      }
      for (const response of await Promise.all(waiting))
        assert.ok([403, 404].includes(response.status()))
      assert.deepEqual(await counts(), revocationCounts)
      await denied(
        await post(staff.request, "createFinanceCompany", ownBody),
        404,
        "NOT_FOUND"
      )
      await limited.bringToFront()
      await limited.evaluate(() => window.dispatchEvent(new Event("focus")))
      await limited.reload()
      await expect(
        limited.getByRole("heading", {
          name: `Private own ${suffix}`,
          exact: true,
        })
      ).toHaveCount(0)
    }
  )
  await group(
    "real finance UI create/edit and lost-response immutable envelope across refetch",
    async () => {
      await page.setViewportSize({ width: 360, height: 800 })
      await page.goto("/third-parties")
      await page
        .getByRole("button", { name: "Finance companies", exact: true })
        .click()
      await page.getByRole("button", { name: "New entry", exact: true }).click()
      await page
        .getByLabel("Name *", { exact: true })
        .fill(`Finance UI ${suffix}`)
      await page.getByLabel("Name *", { exact: true }).focus()
      await page.keyboard.press("Tab")
      await expect(
        page.getByLabel("Processing path", { exact: true })
      ).toBeFocused()
      await page
        .getByLabel("Processing path", { exact: true })
        .selectOption("REFERRAL")
      await page
        .getByLabel("Commission basis", { exact: true })
        .selectOption("FIXED")
      await page
        .getByLabel("Reconciliation method", { exact: true })
        .selectOption("PER_DEAL")
      await page
        .getByLabel("Fixed commission *", { exact: true })
        .fill("5000.00")
      await page.getByLabel("Commission rate", { exact: false }).fill("200")
      await page.getByLabel("Processing fee *", { exact: true }).fill("321.45")
      for (let index = 1; index <= 2; index++) {
        await page
          .getByRole("button", { name: "Add contact", exact: true })
          .click()
        const fields = page.getByRole("group", {
          name: `Contact ${index}`,
          exact: true,
        })
        await fields
          .getByLabel("name *", { exact: true })
          .fill(`Finance browser contact ${index}`)
        await fields.getByLabel("phone *", { exact: true }).fill("0112345678")
        await fields.getByLabel("role *", { exact: true }).fill("Agent")
        if (index === 1) await fields.getByLabel("Primary contact").check()
      }
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      )
      const bodies: string[] = []
      let lost = false
      await page.route(
        "**/api/v1/commands/createFinanceCompany",
        async (route) => {
          bodies.push(route.request().postData()!)
          if (!lost) {
            lost = true
            await route.fetch()
            await route.abort("failed")
          } else await route.continue()
        }
      )
      await page
        .getByRole("button", { name: "Create directory entry", exact: true })
        .click()
      await expect(
        page.getByRole("button", {
          name: "Retry unchanged command",
          exact: true,
        })
      ).toBeVisible()
      await page.evaluate(() => window.dispatchEvent(new Event("focus")))
      await page
        .getByRole("button", { name: "Retry unchanged command", exact: true })
        .click()
      await expect(
        page.getByRole("heading", {
          name: `Finance UI ${suffix} · Active`,
          exact: true,
        })
      ).toBeVisible()
      assert.equal(bodies.length, 2)
      assert.equal(bodies[0], bodies[1])
      await page.unroute("**/api/v1/commands/createFinanceCompany")
      const rows = await query<{ data: PartyDTO[] }>(
        a.request,
        "parties",
        `?type=FINANCE_COMPANY&q=${encodeURIComponent(`Finance UI ${suffix}`)}`
      )
      const ui = rows.data[0]
      assert.equal(ui.policy!.processingFee, "32145")
      assert.equal(ui.policy!.path, "REFERRAL")
      assert.deepEqual(ui.policy!.commission, {
        basis: "FIXED",
        fixed: "500000",
        rateBps: 200,
      })
      assert.equal(ui.contacts.length, 2)
      await page.goto(`/third-parties/${ui.id}?type=FINANCE_COMPANY`)
      await page
        .getByRole("button", { name: "Edit entry", exact: true })
        .click()
      await page
        .getByLabel("Name *", { exact: true })
        .fill(`Finance UI corrected ${suffix}`)
      await page
        .getByLabel("Correction reason *", { exact: true })
        .fill("Retained synthetic correction")
      await updateCompany(ui, { name: `Concurrent ${suffix}` })
      await page
        .getByRole("button", { name: "Save directory changes", exact: true })
        .click()
      await expect(
        page.getByRole("alert").filter({ hasText: "STALE_REVISION" })
      ).toBeVisible()
      await expect(page.getByLabel("Name *", { exact: true })).toHaveValue(
        `Finance UI corrected ${suffix}`
      )
      await page
        .getByRole("button", {
          name: "Reload current directory entry",
          exact: true,
        })
        .click()
      await expect(
        page.getByRole("button", {
          name: /Reconfirm retained draft against revision/,
        })
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
        page.getByRole("heading", {
          name: `Finance UI corrected ${suffix}`,
          exact: true,
        })
      ).toBeVisible()
      await second.goto(`/third-parties/${ui.id}?type=FINANCE_COMPANY`)
      await expect(
        second.getByRole("heading", {
          name: `Finance UI corrected ${suffix}`,
          exact: true,
        })
      ).toBeVisible()
      await second.screenshot({
        path: join(directory, "t04c-finance-360px.png"),
        fullPage: true,
      })
      await page.goto("/third-parties")
      await page
        .getByRole("button", { name: "Finance companies", exact: true })
        .click()
      await page
        .getByLabel("Search name", { exact: true })
        .fill(`Finance UI corrected ${suffix}`)
      await page.getByRole("button", { name: "Search", exact: true }).click()
      for (const active of [false, true]) {
        await page
          .getByRole("button", {
            name: `${active ? "Reactivate" : "Archive"} Finance UI corrected ${suffix}`,
            exact: true,
          })
          .click()
        await page
          .getByLabel("Reason *", { exact: true })
          .fill("Synthetic finance browser lifecycle")
        await page
          .getByRole("button", { name: "Confirm status change", exact: true })
          .click()
        await expect(
          page.getByRole("heading", {
            name: `Finance UI corrected ${suffix} · ${active ? "Active" : "Archived"}`,
            exact: true,
          })
        ).toBeVisible()
        assert.equal((await party(ui.id)).active, active)
      }
    }
  )
  await group(
    "real read failures propagate, never successful pending/default policy",
    async () => {
      for (const [table, name, params] of [
        ["SettingsVersion", "settings", ""],
        [
          "FinancePolicyVersion",
          "party",
          `?type=FINANCE_COMPANY&id=${company.id}`,
        ],
      ] as const) {
        await db.query(
          `REVOKE SELECT ON vamotors."${table}" FROM vamotors_runtime`
        )
        try {
          const r = await a.request.get(`/api/v1/queries/${name}${params}`)
          assert.equal(r.status(), 500)
          assert.equal((await r.json()).ok, false)
        } finally {
          await db.query(
            `GRANT SELECT ON vamotors."${table}" TO vamotors_runtime`
          )
        }
      }
    }
  )
  await group(
    "stale finance create retains draft and explicitly reconfirms actual Settings with a new key",
    async () => {
      await page.goto("/third-parties")
      await page
        .getByRole("button", { name: "Finance companies", exact: true })
        .click()
      await page.getByRole("button", { name: "New entry", exact: true }).click()
      const name = `Stale create UI ${suffix}`
      await page.getByLabel("Name *", { exact: true }).fill(name)
      await page.getByLabel("Commission rate", { exact: false }).fill("200")
      await page.getByLabel("Processing fee *", { exact: true }).fill("321.45")
      // The open form holds the pre-change actual ref. No focus/refetch between
      // this owner-only concurrency fixture and submission.
      await ownerSettingsVersion()
      const bodies: string[] = []
      await page.route(
        "**/api/v1/commands/createFinanceCompany",
        async (route) => {
          bodies.push(route.request().postData()!)
          await route.continue()
        }
      )
      await page
        .getByRole("button", { name: "Create directory entry", exact: true })
        .click()
      await expect(
        page.getByRole("alert").filter({ hasText: "STALE_REVISION" })
      ).toBeVisible()
      await expect(page.getByLabel("Name *", { exact: true })).toHaveValue(name)
      await page
        .getByRole("button", {
          name: "Reload current Settings reference",
          exact: true,
        })
        .click()
      await page
        .getByRole("button", {
          name: /Reconfirm retained draft against Settings revision/,
        })
        .click()
      await page
        .getByRole("button", { name: "Create directory entry", exact: true })
        .click()
      await expect(
        page.getByRole("heading", { name: `${name} · Active`, exact: true })
      ).toBeVisible()
      assert.equal(bodies.length, 2)
      const first = JSON.parse(bodies[0]),
        second = JSON.parse(bodies[1])
      assert.deepEqual(first.input, second.input)
      assert.notEqual(first.idempotencyKey, second.idempotencyKey)
      currentSettings = await settings()
      assert.deepEqual(second.expected, [ref("Settings", currentSettings)])
      await page.unroute("**/api/v1/commands/createFinanceCompany")
    }
  )
  await group(
    "all 111 known purchase links, independent target fields/record scope, denied versus pending",
    async () => {
      const supplier = await applied(
        a.request,
        "createDirectoryParty",
        envelope({
          type: "SUPPLIER",
          values: {
            name: `Typed linked supplier ${suffix}`,
            category: "COMPANY",
            contacts: [contact],
          },
        })
      )
      // Persisted constraint fixtures exercise link authorization/population only;
      // they do NOT certify the unimplemented T05 purchase command or full history.
      const owner = await db.connect()
      try {
        await owner.query("BEGIN")
        await owner.query(
          'SELECT value FROM vamotors."BusinessSequence" WHERE id=1 FOR UPDATE'
        )
        await owner.query("SELECT vamotors.lock_admin_guard()")
        for (let index = 0; index < 111; index++) {
          const vehicle = randomUUID(),
            cycle = randomUUID(),
            key = vehicle.toUpperCase()
          await owner.query(
            'INSERT INTO vamotors."Vehicle"(id,"engineNumber","chassisNumber","normalizedEngine","normalizedChassis",make,model,year,colour,"fuelType",transmission,"createdBy","updatedAt","activePurchaseId") VALUES($1,$2,$3,$2,$3,\'Synthetic\',\'Contribution fixture\',2026,\'Test\',\'OTHER\',\'OTHER\',\'03000000-0000-4000-8000-000000000011\',CURRENT_TIMESTAMP,$4)',
            [vehicle, `E-${key}`, `C-${key}`, cycle]
          )
          await owner.query(
            'INSERT INTO vamotors."PurchaseRecord"(id,"vehicleId","cycleNumber","purchaseType","acquisitionKind","supplierId","purchaseDate","purchasePrice","createdBy","updatedAt") VALUES($1,$2,1,\'CASH\',\'SUPPLIER\',$3,\'2026-01-01\',10000,\'03000000-0000-4000-8000-000000000011\',CURRENT_TIMESTAMP)',
            [cycle, vehicle, supplier.result.id]
          )
        }
        await owner.query("SET CONSTRAINTS ALL IMMEDIATE")
        await owner.query("COMMIT")
      } catch (error) {
        await owner.query("ROLLBACK")
        throw error
      } finally {
        owner.release()
      }
      const detail = await party(supplier.result.id, "SUPPLIER")
      assert.equal(detail.contributions!.purchases.links.length, 111)
      assert.equal(detail.contributions!.purchases.state, "PENDING_DOMAIN")
      const grants: Grant[] = [
        {
          subject: "Supplier",
          action: "read",
          fields: ["id", "name", "contributions.purchases"],
        },
        { subject: "PurchaseRecord", action: "read", fields: ["purchaseDate"] },
      ]
      const linkRole = await applied(
        a.request,
        "saveRole",
        envelope({
          name: `T04c link projection ${suffix}`,
          grants,
          reason: "Independent target projection",
        })
      )
      const user = await query<{
        id: string
        revision: number
        name: string
        active: boolean
      }>(a.request, "user", `?id=${staffId}`)
      const bases = await Promise.all(
        [
          "03000000-0000-4000-8000-000000000002",
          "03000000-0000-4000-8000-000000000003",
        ].map((id) =>
          query<{ id: string; revision: number }>(
            a.request,
            "role",
            `?id=${id}`
          )
        )
      )
      await applied(
        a.request,
        "updateUser",
        envelope(
          {
            id: user.id,
            name: user.name,
            active: true,
            roleIds: [...bases.map((r) => r.id), linkRole.result.id],
            reason: "Link projection fixture",
          },
          [
            ref("User", user),
            ...bases.map((r) => ref("Role", r)),
            ref("Role", linkRole.result),
          ]
        )
      )
      const projected = await party(
        supplier.result.id,
        "SUPPLIER",
        staff.request
      )
      assert.equal(projected.contributions!.purchases.links.length, 111)
      for (const link of projected.contributions!.purchases.links as Record<
        string,
        unknown
      >[])
        assert.deepEqual(Object.keys(link).sort(), ["date", "type"])
      assert.ok(
        projected.redactedFields!.includes("contributions.purchases.links.id")
      )
      assert.ok(
        !JSON.stringify(projected).includes(
          (detail.contributions!.purchases.links[0] as { id: string }).id
        )
      )
      const scoped = await applied(
        a.request,
        "saveRole",
        envelope(
          {
            id: linkRole.result.id,
            name: `T04c link projection ${suffix}`,
            grants: [
              grants[0],
              { ...grants[1], conditions: { createdBy: "$actor.id" } },
            ],
            reason: "Target records hidden",
          },
          [ref("Role", linkRole.result)]
        )
      )
      const hidden = await party(supplier.result.id, "SUPPLIER", staff.request)
      assert.deepEqual(hidden.contributions!.purchases, {
        state: "PENDING_DOMAIN",
        links: [],
      })
      assert.ok(
        !hidden.redactedFields!.some((path) =>
          path.startsWith("contributions.purchases.links.")
        )
      )
      const deniedRole = await applied(
        a.request,
        "saveRole",
        envelope(
          {
            id: linkRole.result.id,
            name: `T04c link projection ${suffix}`,
            grants: [{ ...grants[0], fields: ["id", "name"] }],
            reason: "Contribution denied",
          },
          [ref("Role", scoped.result)]
        )
      )
      const noContribution = await party(
        supplier.result.id,
        "SUPPLIER",
        staff.request
      )
      assert.deepEqual(noContribution.contributions, {})
      assert.ok(
        noContribution.redactedFields!.includes("contributions.purchases")
      )
      await applied(
        a.request,
        "archiveRole",
        envelope(
          { id: linkRole.result.id, reason: "End link projection fixture" },
          [ref("Role", deniedRole.result)]
        )
      )
    }
  )
  await group(
    "typed direct reload beyond list page one and archived historical detail",
    async () => {
      const created: string[] = []
      for (let index = 0; index < 21; index++)
        created.push(
          (
            await applied(
              a.request,
              "createFinanceCompany",
              envelope(createValues(`Off-page ${suffix} ${index}`), [
                ref("Settings", currentSettings),
              ])
            )
          ).result.id
        )
      const first = await query<{ data: PartyDTO[] }>(
        a.request,
        "parties",
        `?type=FINANCE_COMPANY&pageSize=10&q=${encodeURIComponent(`Off-page ${suffix}`)}`
      )
      const offPage = created.find(
        (id) => !first.data.some((row) => row.id === id)
      )!
      let row = await party(offPage)
      await applied(
        a.request,
        "archiveParty",
        envelope(
          {
            type: "FINANCE_COMPANY",
            id: offPage,
            active: false,
            reason: "Retain off-page identity",
          },
          [ref("FinanceCompany", row)]
        )
      )
      row = await party(offPage)
      assert.equal(row.active, false)
      await second.goto(`/third-parties/${offPage}?type=FINANCE_COMPANY`)
      await expect(
        second.getByRole("heading", { name: row.name, exact: true })
      ).toBeVisible()
      await second.reload()
      await expect(
        second.getByText("Archived — retained historical identity", {
          exact: true,
        })
      ).toBeVisible()
    }
  )
  await group(
    "known parent purchase references pending, independently projected; app and DB restart persistence",
    async () => {
      const inventoryPath = join(directory, "t04c-parent-inventory.json")
      let parent: { supplier: string; purchase: string } | null = null
      try {
        parent = JSON.parse(await readFile(inventoryPath, "utf8"))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      }
      if (parent) {
        const detail = await party(parent.supplier, "SUPPLIER")
        assert.equal(detail.contributions!.purchases.state, "PENDING_DOMAIN")
        assert.ok(
          JSON.stringify(detail.contributions!.purchases.links).includes(
            parent.purchase
          )
        )
      }
      const before = await party(company.id),
        persisted = await settings()
      await stop()
      await db.end()
      await restricted.end()
      await monitor.end()
      for (const action of ["stop", "start"])
        execFileSync(
          process.execPath,
          ["--import", "tsx", "scripts/local-postgres.ts", action],
          {
            cwd: cluster.PROJECT,
            env: { ...process.env, VAMOTORS_LOCAL_DIR: directory },
            stdio: "pipe",
          }
        )
      db = new pg.Pool({ connectionString: migration.DIRECT_URL, max: 3 })
      restricted = new pg.Pool({
        connectionString: runtime.DATABASE_URL,
        max: 2,
      })
      monitor = new pg.Pool({ connectionString: monitorURL.href, max: 1 })
      await start()
      assert.deepEqual(await party(company.id), before)
      assert.deepEqual(await settings(), persisted)
    }
  )
  await writeFile(
    join(directory, "t04c-results.json"),
    JSON.stringify(
      {
        base: "08d17063bfe3cbec37cd995bdb7c44bf057412ba",
        source: execFileSync("git", ["rev-parse", "HEAD"], {
          encoding: "utf8",
        }).trim(),
        passed,
        results,
        limitations: [
          "Settings writes/UI remain disabled; owner version changes here are concurrency fixtures only",
          "Downstream selection/snapshots/history readiness remain pending",
          "No independent acceptance",
        ],
      },
      null,
      2
    ),
    { mode: 0o600 }
  )
  console.log(
    `PASS ${passed} Settings/finance production groups; author evidence only.`
  )
} catch (error) {
  console.error(
    `FAIL ${stage}: ${error instanceof Error ? error.message.split("\n")[0] : "unknown"}`
  )
  process.exitCode = 1
} finally {
  await browser.close()
  await stop()
  await db.end()
  await restricted.end()
  await monitor.end()
}
