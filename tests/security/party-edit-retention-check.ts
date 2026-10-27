/** Focused T04c corrections: own production Chromium/server and isolated real PG. */
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { spawn } from "node:child_process"
import { once } from "node:events"
import { createServer } from "node:net"
import { join } from "node:path"
import { writeFile } from "node:fs/promises"
import { chromium, expect, type Page } from "@playwright/test"
import pg from "pg"
import { privateEnvironment } from "../../scripts/private-environment"
import type {
  Applied,
  PartyDTO,
  QueryData,
  Dependency,
} from "../../.planning/implementation/contracts/api"

process.umask(0o077)
const directory = process.argv[2]
assert.ok(directory)
const runtime = await privateEnvironment(join(directory, "runtime.env"))
const migration = await privateEnvironment(join(directory, "migration.env"))
const accounts = await privateEnvironment(join(directory, "accounts.env"))
const cluster = await privateEnvironment(join(directory, "cluster.env"))
assert.equal(cluster.PROJECT, process.cwd())
assert.equal(runtime.APP_ENV, "local")
for (const url of [runtime.DATABASE_URL!, migration.DIRECT_URL!]) {
  assert.equal(new URL(url).hostname, "127.0.0.1")
  assert.equal(new URL(url).port, cluster.PORT)
}
const db = new pg.Pool({ connectionString: migration.DIRECT_URL, max: 2 })
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
const browser = await chromium.launch({ headless: true })
const a = await browser.newContext({ baseURL: origin })
const b = await browser.newContext({
  baseURL: origin,
  viewport: { width: 360, height: 800 },
})
const page = await a.newPage(),
  second = await b.newPage()
const results: string[] = []
const privacyChecks: (() => Promise<void>)[] = []
let stage = "start"
const group = async (name: string, fn: () => Promise<void>) => {
  stage = name
  await fn()
  results.push(name)
  console.log(`PASS ${name}`)
}
const ref = (
  type: Dependency["type"],
  row: { id: string; revision: number }
): Dependency => ({ type, id: row.id, revision: row.revision })
const envelope = (input: unknown, expected: Dependency[] = []) => ({
  schemaVersion: 1,
  idempotencyKey: randomUUID(),
  expected,
  input,
})
async function login(p: Page, which: "ADMIN" | "SECOND") {
  await p.goto("/login")
  await p
    .getByLabel("Email Address")
    .fill(accounts[`BOOTSTRAP_${which}_EMAIL`]!)
  await p
    .getByLabel("Password", { exact: true })
    .fill(accounts[`BOOTSTRAP_${which}_PASSWORD`]!)
  await p.getByRole("button", { name: "Sign In", exact: true }).click()
  try {
    await p.waitForURL("**/dashboard", { timeout: 10000 })
  } catch {
    throw Error(
      `LOGIN_${which}_FAILED path=${new URL(p.url()).pathname} alerts=${await p
        .getByRole("alert")
        .innerText()
        .catch(() => "none")}`
    )
  }
}
async function query<T>(name: string, params = ""): Promise<T> {
  const r = await a.request.get(`/api/v1/queries/${name}${params}`)
  assert.equal(r.status(), 200)
  return (await r.json()).data
}
const party = (id: string, kind: string) =>
  query<PartyDTO>("party", `?type=${kind}&id=${id}`)
const post = (name: string, body: unknown, client = a.request) =>
  client.post(`/api/v1/commands/${name}`, { headers: { origin }, data: body })
async function applied(
  name: string,
  body: unknown,
  client = a.request
): Promise<Applied> {
  const r = await post(name, body, client)
  assert.ok(r.ok(), `${name}:${r.status()}`)
  return r.json()
}
const policy = {
  path: "APPLICATION",
  commission: { basis: "FINANCED_PRINCIPAL", rateBps: 150 },
  processingFee: "12345",
  reconciliationMethod: "PER_DEAL",
}
const counts = async () =>
  (
    await db.query(`SELECT
  (SELECT count(*) FROM vamotors."FinanceCompany")::text companies,
  (SELECT count(*) FROM vamotors."FinanceContact")::text contacts,
  (SELECT count(*) FROM vamotors."FinancePolicyVersion")::text policies,
  (SELECT count(*) FROM vamotors."CommandReceipt")::text receipts,
  (SELECT count(*) FROM vamotors."AuditEntry")::text audits,
  (SELECT count(*) FROM vamotors."EntityReadVersion")::text versions,
  (SELECT value::text FROM vamotors."BusinessSequence" WHERE id=1) sequence`)
  ).rows[0]
const button = (name: string | RegExp) =>
  page.getByRole("button", { name, exact: typeof name === "string" })
const nameField = () => page.getByLabel("Name *", { exact: true })
const reasonField = () => page.getByLabel("Correction reason", { exact: false })
async function focusWithPendingCheck() {
  // Hold only transport, never fabricate authority. The eventual answer is real.
  let release!: () => void, entered!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const checking = new Promise<void>((resolve) => {
    entered = resolve
  })
  await page.route("**/api/v1/queries/currentActor", async (route) => {
    entered()
    await gate
    await route.continue()
  })
  try {
    await page.evaluate(() => window.dispatchEvent(new Event("blur")))
    await expect(nameField()).toBeHidden()
    await page.evaluate(() => window.dispatchEvent(new Event("focus")))
    await checking
    await expect(
      page.getByText("Checking access…", { exact: true })
    ).toBeVisible()
    await expect(nameField()).toBeHidden()
  } finally {
    release()
  }
  await expect(nameField()).toBeVisible()
  await page.unroute("**/api/v1/queries/currentActor")
}
try {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("SERVER_START_TIMEOUT")), 20000)
    server.once("exit", () => {
      clearTimeout(timer)
      reject(Error("SERVER_EARLY_EXIT"))
    })
    server.stdout.on("data", (b) => {
      if (b.toString().includes("Ready")) {
        clearTimeout(timer)
        resolve()
      }
    })
  })
  await login(page, "ADMIN")
  await login(second, "SECOND")
  const settings = await query<QueryData["settings"]>("settings")
  const finance = await applied(
    "createFinanceCompany",
    envelope({ name: `Money fixture ${randomUUID()}`, contacts: [], policy }, [
      ref("Settings", settings),
    ])
  )
  const moneyCompany = await party(finance.result.id, "FINANCE_COMPANY")
  if (!process.argv.includes("--detail-only"))
    await group(
      "malformed money create/update, principal/fixed fee and fixed commission: HTTP 422, no effects",
      async () => {
        const before = await counts()
        for (const value of [
          "abc",
          "1.5",
          "1e2",
          "",
          " ",
          "+1",
          "-1",
          "-0",
          "01",
          "00",
          "1\n",
          "0x10",
          "100000000000000",
          "9".repeat(1000),
          1,
          null,
        ]) {
          for (const command of [
            "createFinanceCompany",
            "updateFinanceCompany",
          ]) {
            for (const variant of [
              "principal-fee",
              "fixed-fee",
              "fixed-commission",
            ]) {
              const p =
                variant === "principal-fee"
                  ? { ...policy, processingFee: value }
                  : {
                      ...policy,
                      processingFee: variant === "fixed-fee" ? value : "0",
                      commission: {
                        basis: "FIXED",
                        rateBps: 1,
                        fixed: variant === "fixed-commission" ? value : "1",
                      },
                    }
              const updating = command === "updateFinanceCompany"
              const r = await post(
                command,
                envelope(
                  {
                    name: "Invalid",
                    contacts: [],
                    policy: p,
                    ...(updating
                      ? { id: moneyCompany.id, reason: "Malformed money" }
                      : {}),
                  },
                  [
                    ref("Settings", settings),
                    ...(updating ? [ref("FinanceCompany", moneyCompany)] : []),
                  ]
                )
              )
              assert.equal(
                r.status(),
                422,
                `${command}/${variant}/${JSON.stringify(value)}`
              )
              assert.equal((await r.json()).error.code, "INVALID_INPUT")
              assert.deepEqual(await counts(), before)
              assert.deepEqual(
                await party(moneyCompany.id, "FINANCE_COMPANY"),
                moneyCompany
              )
            }
          }
        }
      }
    )
  if (!process.argv.includes("--money-only"))
    for (const kind of [
      "FINANCE_COMPANY",
      "SUPPLIER",
      "REPAIR_VENDOR",
    ] as const) {
      const isFinance = kind === "FINANCE_COMPANY"
      const type = isFinance
        ? "FinanceCompany"
        : kind === "SUPPLIER"
          ? "Supplier"
          : "RepairVendor"
      const command = isFinance
        ? "updateFinanceCompany"
        : "updateDirectoryParty"
      const created = await applied(
        isFinance ? "createFinanceCompany" : "createDirectoryParty",
        envelope(
          isFinance
            ? {
                name: `Retention ${kind} ${randomUUID()}`,
                contacts: [],
                policy,
              }
            : {
                type: kind,
                values: {
                  name: `Retention ${kind} ${randomUUID()}`,
                  category: "COMPANY",
                  contacts: [],
                },
              },
          isFinance ? [ref("Settings", settings)] : []
        )
      )
      const id = created.result.id
      async function concurrent(name: string) {
        const row = await party(id, kind)
        return applied(
          command,
          envelope(
            isFinance
              ? {
                  id,
                  name,
                  contacts: [],
                  policy: row.policy,
                  reason: "Other context correction",
                }
              : {
                  id,
                  type: kind,
                  values: { ...row.directory, name },
                  reason: "Other context correction",
                },
            [ref(type, row), ...(isFinance ? [ref("Settings", settings)] : [])]
          ),
          b.request
        )
      }
      await group(
        `${kind}: lost committed edit + concurrent edit + private focus/refetch preserves exact retry and reason`,
        async () => {
          await page.bringToFront()
          await page.goto(`/third-parties/${id}?type=${kind}`)
          await button("Edit entry").click()
          const draft = `Original immutable draft ${randomUUID()}`
          await nameField().fill(draft)
          await reasonField().fill("Original immutable correction reason")
          const bodies: string[] = [],
            replies: Applied[] = []
          const before = await counts()
          await page.route(`**/api/v1/commands/${command}`, async (route) => {
            bodies.push(route.request().postData()!)
            const response = await route.fetch({ maxRetries: 0 })
            assert.equal(response.status(), 200)
            replies.push(await response.json())
            if (bodies.length === 1) await route.abort("failed")
            else await route.fulfill({ response })
          })
          try {
            await button("Save directory changes").click()
            await expect(button("Retry unchanged command")).toBeVisible()
            const once = await counts()
            for (const field of ["receipts", "audits", "versions", "sequence"])
              assert.equal(BigInt(once[field]), BigInt(before[field]) + 1n)
            assert.equal((await party(id, kind)).name, draft)
            const newer = `Concurrent newer ${randomUUID()}`
            await concurrent(newer)
            const afterConcurrent = await counts()
            await focusWithPendingCheck()
            await expect(
              page.getByRole("heading", { name: newer, exact: true })
            ).toBeVisible()
            await expect(nameField()).toHaveValue(draft)
            await expect(reasonField()).toHaveValue(
              "Original immutable correction reason"
            )
            await expect(button("Retry unchanged command")).toBeVisible()
            await button("Retry unchanged command").click()
            await expect(nameField()).toHaveCount(0)
            assert.equal(bodies.length, 2)
            assert.equal(bodies[0], bodies[1])
            assert.equal(replies[1].replayed, true)
            assert.equal(replies[0].commandId, replies[1].commandId)
            assert.deepEqual(await counts(), afterConcurrent)
            assert.equal((await party(id, kind)).name, newer)
          } finally {
            await page.unroute(`**/api/v1/commands/${command}`)
          }
        }
      )
      await group(
        `${kind}: unsent draft survives refetch; stale edit requires explicit reconciliation/new key`,
        async () => {
          await button("Edit entry").click()
          const draft = `Retained stale draft ${randomUUID()}`
          await nameField().fill(draft)
          await reasonField().fill("Retained stale reason")
          await concurrent(`Later revision ${randomUUID()}`)
          await focusWithPendingCheck()
          await expect(nameField()).toHaveValue(draft)
          await expect(reasonField()).toHaveValue("Retained stale reason")
          const bodies: string[] = []
          await page.route(`**/api/v1/commands/${command}`, async (route) => {
            bodies.push(route.request().postData()!)
            await route.continue()
          })
          try {
            const before = await counts()
            await button("Save directory changes").click()
            await expect(
              page.getByRole("alert").filter({ hasText: "STALE_REVISION" })
            ).toBeVisible()
            assert.deepEqual(await counts(), before)
            await button("Reload current directory entry").click()
            await button(/Reconfirm retained draft against revision/).click()
            assert.equal(bodies.length, 1)
            await button("Save directory changes").click()
            await expect(nameField()).toHaveCount(0)
            assert.equal(bodies.length, 2)
            const first = JSON.parse(bodies[0]),
              next = JSON.parse(bodies[1])
            assert.notEqual(first.idempotencyKey, next.idempotencyKey)
            assert.deepEqual(first.input, next.input)
            assert.equal(
              next.expected.find((r: Dependency) => r.type === type).revision,
              first.expected.find((r: Dependency) => r.type === type).revision +
                1
            )
            assert.equal((await party(id, kind)).name, draft)
          } finally {
            await page.unroute(`**/api/v1/commands/${command}`)
          }
        }
      )
      if (isFinance)
        privacyChecks.push(async () => {
          const context = await browser.newContext({ baseURL: origin })
          const p = await context.newPage()
          let restoreRoles: (() => Promise<void>) | undefined
          async function assignRoles(userId: string, roleIds: string[]) {
            const user = await query<QueryData["user"]>("user", `?id=${userId}`)
            const roles = await Promise.all(
              roleIds.map((roleId) =>
                query<QueryData["role"]>("role", `?id=${roleId}`)
              )
            )
            await applied(
              "updateUser",
              envelope(
                {
                  id: user.id,
                  name: user.name,
                  active: true,
                  roleIds,
                  reason: "Own correction privacy fixture",
                },
                [ref("User", user), ...roles.map((role) => ref("Role", role))]
              )
            )
          }
          try {
            await login(p, "SECOND")
            for (const loss of ["revoke", "switch", "logout"] as const)
              await group(
                `finance unresolved edit: ${loss} discards private session, pending verification never exposes it`,
                async () => {
                  await p.bringToFront()
                  await p.goto(`/third-parties/${id}?type=${kind}`)
                  await p
                    .getByRole("button", { name: "Edit entry", exact: true })
                    .click()
                  const privateDraft = `Private unresolved ${randomUUID()}`
                  await p
                    .getByLabel("Name *", { exact: true })
                    .fill(privateDraft)
                  await p
                    .getByLabel("Correction reason *", { exact: true })
                    .fill("Private reason")
                  let retainedBody = ""
                  await p.route(
                    `**/api/v1/commands/${command}`,
                    async (route) => {
                      retainedBody = route.request().postData()!
                      await route.fetch({ maxRetries: 0 })
                      await route.abort("failed")
                    }
                  )
                  await p
                    .getByRole("button", {
                      name: "Save directory changes",
                      exact: true,
                    })
                    .click()
                  await expect(
                    p.getByRole("button", {
                      name: "Retry unchanged command",
                      exact: true,
                    })
                  ).toBeVisible()
                  await p.evaluate(() =>
                    window.dispatchEvent(new Event("blur"))
                  )
                  await expect(
                    p.getByLabel("Name *", { exact: true })
                  ).toBeHidden()
                  const actor = await context.request.get(
                    "/api/v1/queries/currentActor"
                  )
                  const actorId = (await actor.json()).data.user.id
                  if (loss === "revoke") {
                    const user = await query<QueryData["user"]>(
                      "user",
                      `?id=${actorId}`
                    )
                    const readOnly = await applied(
                      "saveRole",
                      envelope({
                        name: `Read only ${randomUUID()}`,
                        reason: "Own privacy fixture",
                        grants: [
                          {
                            subject: "FinanceCompany",
                            action: "read",
                            fields: ["*"],
                          },
                          {
                            subject: "Settings",
                            action: "read",
                            fields: ["*"],
                          },
                        ],
                      })
                    )
                    restoreRoles = () =>
                      assignRoles(
                        actorId,
                        user.roles.map((role) => role.id)
                      )
                    await assignRoles(actorId, [readOnly.result.id])
                    const beforeReplay = await counts()
                    const denied = await post(
                      command,
                      JSON.parse(retainedBody),
                      context.request
                    )
                    assert.equal(
                      denied.status(),
                      403,
                      "REPLAY_RECHECKS_CURRENT_AUTHORITY"
                    )
                    assert.deepEqual(await counts(), beforeReplay)
                  } else if (loss === "logout") {
                    assert.equal(
                      (
                        await context.request.post("/api/auth/sign-out", {
                          headers: { origin },
                          data: {},
                        })
                      ).status(),
                      200
                    )
                  } else {
                    // Real cookie identity switch to the other existing signed-in
                    // account; avoids extra sign-ins hitting the production limiter.
                    await context.clearCookies()
                    await context.addCookies(await a.cookies())
                  }
                  await p.bringToFront()
                  await p.evaluate(() =>
                    window.dispatchEvent(new Event("focus"))
                  )
                  if (loss === "logout") {
                    assert.equal(
                      (
                        await context.request.get(
                          "/api/v1/queries/currentActor"
                        )
                      ).status(),
                      401,
                      "SIGNED_OUT_CURRENT_ACTOR"
                    )
                    try {
                      await p.waitForURL(/\/login(?:\?|$)/, { timeout: 10000 })
                    } catch {
                      throw Error(
                        `LOGOUT_STATE ${JSON.stringify({ path: new URL(p.url()).pathname, hidden: await p.evaluate(() => document.hidden), checking: await p.getByText("Checking access…", { exact: true }).count(), inputs: await p.getByLabel("Name *", { exact: true }).count() })}`
                      )
                    }
                  } else
                    await expect(
                      p.getByRole("heading", {
                        name: privateDraft,
                        exact: true,
                      })
                    ).toBeVisible()
                  await expect(
                    p.getByLabel("Name *", { exact: true })
                  ).toHaveCount(0)
                  await expect(
                    p.getByRole("button", {
                      name: "Retry unchanged command",
                      exact: true,
                    })
                  ).toHaveCount(0)
                  if (loss === "revoke") {
                    await expect(
                      p.getByRole("button", { name: "Edit entry", exact: true })
                    ).toHaveCount(0)
                    await restoreRoles!()
                    restoreRoles = undefined
                  }
                  if (loss === "switch") {
                    await p
                      .getByRole("button", { name: "Edit entry", exact: true })
                      .click()
                    await expect(
                      p.getByLabel("Correction reason *", { exact: true })
                    ).toHaveValue("")
                    await expect(
                      p.getByRole("button", {
                        name: "Save directory changes",
                        exact: true,
                      })
                    ).toBeVisible()
                  }
                  await p.unroute(`**/api/v1/commands/${command}`)
                }
              )
          } finally {
            await restoreRoles?.()
            await context.close()
          }
        })
    }
  for (const check of privacyChecks) await check()
  await writeFile(
    join(
      directory,
      `corrections-${process.argv.includes("--money-only") ? "money" : process.argv.includes("--detail-only") ? "detail" : "all"}.json`
    ),
    JSON.stringify(
      {
        base: "4c97d48e6cd0ad2b4a3b4cdab727c57068dc26b5",
        results,
        verdict: "PASS",
        limitations: [
          "Author evidence; independent rerun required",
          "Full Settings/domain workflows excluded",
        ],
      },
      null,
      2
    ),
    { mode: 0o600 }
  )
  console.log(`PASS ${results.length} focused correction groups`)
} catch (error) {
  console.error(
    `FAIL ${stage}: ${error instanceof Error ? error.message.split("\n")[0] : "unknown"}`
  )
  process.exitCode = 1
} finally {
  await browser.close()
  if (server.exitCode === null) {
    const ended = once(server, "exit")
    server.kill("SIGTERM")
    await ended
  }
  await db.end()
}
