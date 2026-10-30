/** Real inline vendor/contact creation and active-SW exact-intent recovery UI.
 * Tab/Enter navigation is observed; native date fields use Playwright fill. */
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { chromium, expect, type Locator } from "@playwright/test"
import type {
  Applied,
  Dependency,
  PurchaseCycleDTO,
} from "../../.planning/implementation/contracts/api"
import { fixture, envelope, ref, purchaseInput } from "./cycle-edits-fixture"

process.umask(0o077)
const root = process.argv[2]
assert.ok(root)
const f = await fixture(root),
  suffix = randomUUID().slice(0, 8)
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  baseURL: f.origin,
  viewport: { width: 360, height: 800 },
  serviceWorkers: "allow",
})
const page = await context.newPage(),
  groups: string[] = [],
  tabTargets: string[] = []
const bodies: { name: string; body: string }[] = []
let stage = "initialize",
  cycleId = "",
  repairId = "",
  vendorId = ""
async function group(name: string, run: () => Promise<void>) {
  stage = name
  await run()
  groups.push(name)
  console.log(`PASS ${name}`)
}
async function tabTo(target: Locator, label: string) {
  await expect(target).toBeVisible()
  await expect(target).toBeEnabled()
  for (let step = 0; step < 150; step++) {
    if (await target.evaluate((el) => el === document.activeElement)) {
      tabTargets.push(label)
      return
    }
    // Stay inside the document instead of wrapping through browser chrome,
    // which intentionally activates AuthBoundary's blur concealment.
    const backwards = await target.evaluate((el) =>
      Boolean(
        document.activeElement &&
        el.compareDocumentPosition(document.activeElement) &
          Node.DOCUMENT_POSITION_FOLLOWING
      )
    )
    await page.keyboard.press(backwards ? "Shift+Tab" : "Tab")
  }
  assert.fail(`KEYBOARD_UNREACHABLE_${label}`)
}
async function enter(target: Locator, label: string) {
  await tabTo(target, label)
  await page.keyboard.press("Enter")
}
async function text(target: Locator, label: string, value: string) {
  await tabTo(target, label)
  await page.keyboard.press("ControlOrMeta+A")
  await page.keyboard.type(value)
}
try {
  await f.start()
  const admin = await f.login("ADMIN")
  await context.addCookies((await admin.storageState()).cookies)
  const cmd = (
    name: string,
    input: unknown,
    expected: Dependency[] = [],
    status = 200
  ) => f.command(admin, name, envelope(input, expected), status)
  const current = () =>
    f.query<PurchaseCycleDTO>(admin, "purchase", `?cycleId=${cycleId}`)
  const refs = (row: PurchaseCycleDTO) => [
    ref(row),
    ref(row.repairs.find((r) => r.id === repairId)!, "RepairRecord"),
  ]
  const supplier = await cmd(
    "createDirectoryParty",
    {
      type: "SUPPLIER",
      values: {
        name: `Recovery supplier ${suffix}`,
        category: "COMPANY",
        contacts: [],
      },
    },
    [],
    201
  )
  const purchased = await cmd(
    "recordPurchase",
    purchaseInput(supplier.result.id, suffix, "recovery"),
    [ref(supplier.result, "Supplier")],
    201
  )
  cycleId = purchased.result.id
  let row = await current()
  await cmd(
    "receiveStock",
    {
      cycleId,
      date: "2026-10-02",
      disposition: { kind: "HOLD", reason: "Await actual repair" },
    },
    [ref(row)]
  )
  await group(
    "360px Tab/Enter inline vendor/contact creation, failed reference read and explicit recovery",
    async () => {
      await page.goto(`/purchases/${cycleId}`)
      await page.waitForFunction(
        () => navigator.serviceWorker.controller?.state === "activated"
      )
      await enter(
        page.getByRole("button", { name: "Send for repair", exact: true }),
        "send repair"
      )
      await text(
        page.getByLabel("Repair request", { exact: true }),
        "repair request",
        "Retained actual repair request"
      )
      await tabTo(page.getByLabel("Sent date", { exact: true }), "sent date")
      await page.getByLabel("Sent date", { exact: true }).fill("2026-10-03")
      await enter(
        page.getByRole("button", {
          name: "Create repair vendor inline",
          exact: true,
        }),
        "inline vendor"
      )
      const form = page
        .getByRole("heading", { name: "New directory entry" })
        .locator("..")
      await text(
        form.getByLabel("Name *", { exact: true }),
        "vendor name",
        `Inline workshop ${suffix}`
      )
      await text(
        form.getByLabel("Specialisation (optional)", { exact: true }),
        "specialisation",
        "Actual mechanical work"
      )
      await enter(
        form.getByRole("button", { name: "Add contact", exact: true }),
        "add contact"
      )
      const contact = form.getByRole("group", {
        name: "Contact 1",
        exact: true,
      })
      await text(
        contact.getByLabel("name *", { exact: true }),
        "contact name",
        "Actual workshop contact"
      )
      await text(
        contact.getByLabel("phone *", { exact: true }),
        "contact phone",
        "0112345678"
      )
      await text(
        contact.getByLabel("role *", { exact: true }),
        "contact role",
        "Mechanic"
      )
      let reads = 0
      await context.route(
        "**/api/v1/queries/party?type=REPAIR_VENDOR&id=*",
        async (route) => {
          if (++reads === 1)
            await route.fulfill({
              status: 503,
              contentType: "application/json",
              body: JSON.stringify({
                ok: false,
                error: { code: "ENVIRONMENT_UNAVAILABLE" },
              }),
            })
          else await route.continue()
        }
      )
      const create = page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname ===
            "/api/v1/commands/createDirectoryParty" &&
          r.request().method() === "POST"
      )
      await enter(
        form.getByRole("button", {
          name: "Create directory entry",
          exact: true,
        }),
        "commit vendor"
      )
      const response = await create
      assert.equal(response.status(), 201)
      vendorId = ((await response.json()) as Applied).result.id
      await enter(
        page.getByRole("button", {
          name: "Retry created vendor reference read",
          exact: true,
        }),
        "retry created vendor read"
      )
      await expect(
        page.getByLabel("Active repair vendor", { exact: true })
      ).toHaveValue(vendorId)
      await expect(
        page.getByLabel("Repair request", { exact: true })
      ).toHaveValue("Retained actual repair request")
      await expect(page.getByLabel("Sent date", { exact: true })).toHaveValue(
        "2026-10-03"
      )
      const actual = (
        await f.db.query(
          'SELECT specialisation,(SELECT count(*) FROM vamotors."VendorContact" c WHERE c."vendorId"=v.id) contacts FROM vamotors."RepairVendor" v WHERE id=$1',
          [vendorId]
        )
      ).rows[0]
      assert.equal(actual.specialisation, "Actual mechanical work")
      assert.equal(actual.contacts, "1")
      await context.unroute("**/api/v1/queries/party?type=REPAIR_VENDOR&id=*")
    }
  )
  await group(
    "committed send response loss survives linked route unmount and retries byte-identical body/key",
    async () => {
      let requests = 0
      await context.route("**/api/v1/commands/sendRepair", async (route) => {
        bodies.push({ name: "sendRepair", body: route.request().postData()! })
        if (++requests === 1) {
          const response = await route.fetch()
          assert.equal(response.status(), 201)
          repairId = ((await response.json()) as Applied).result.id
          await route.abort("failed")
        } else await route.continue()
      })
      await enter(
        page.getByRole("button", { name: "Commit sendRepair", exact: true }),
        "commit send"
      )
      await expect(
        page.getByRole("button", {
          name: "Retry identical sendRepair",
          exact: true,
        })
      ).toBeEnabled()
      await enter(
        page.getByRole("link", { name: "Current repair cycles", exact: true }),
        "repair list navigation"
      )
      await expect(
        page.getByRole("heading", {
          name: "Current repair cycles",
          exact: true,
        })
      ).toBeVisible()
      await enter(
        page.locator(`a[href="/purchases/${cycleId}"]`).first(),
        "owning cycle navigation"
      )
      await expect(
        page.getByRole("button", {
          name: "Retry identical sendRepair",
          exact: true,
        })
      ).toBeEnabled()
      const retry = page.waitForResponse(
        (r) => new URL(r.url()).pathname === "/api/v1/commands/sendRepair"
      )
      await enter(
        page.getByRole("button", {
          name: "Retry identical sendRepair",
          exact: true,
        }),
        "retry unchanged send"
      )
      const result = await retry
      assert.equal(result.status(), 200)
      assert.equal((await result.json()).replayed, true)
      assert.equal(bodies.length, 2)
      assert.equal(bodies[0].body, bodies[1].body)
      assert.equal(
        (
          await f.db.query(
            'SELECT count(*) n FROM vamotors."RepairRecord" WHERE "cycleId"=$1',
            [cycleId]
          )
        ).rows[0].n,
        "1"
      )
      await context.unroute("**/api/v1/commands/sendRepair")
      row = await current()
      await cmd(
        "returnRepair",
        {
          repairId,
          invoiceAmount: "500",
          invoiceDate: "2026-10-03",
          returnedDate: "2026-10-04",
          summary: "Actual return for recovery proof",
        },
        refs(row)
      )
    }
  )
  await group(
    "stale payment retains draft; failed reload sends nothing; explicit reconfirmation uses new refs/key",
    async () => {
      await page.goto(`/repairs/${repairId}`)
      await enter(
        page.getByRole("button", { name: /^Record repair payment/ }),
        "payment form"
      )
      await text(
        page.getByLabel("Actual payment (major currency)", { exact: true }),
        "actual payment",
        "0.50"
      )
      await tabTo(
        page.getByLabel("Actual cash date", { exact: true }),
        "cash date"
      )
      await page
        .getByLabel("Actual cash date", { exact: true })
        .fill("2026-09-25")
      row = await current()
      await cmd(
        "payRepair",
        {
          repairId,
          payment: { amount: "100", date: "2026-10-05", method: "CASH" },
        },
        refs(row)
      )
      await context.route("**/api/v1/commands/payRepair", async (route) => {
        bodies.push({ name: "payRepair", body: route.request().postData()! })
        await route.continue()
      })
      const stale = page.waitForResponse(
        (r) => new URL(r.url()).pathname === "/api/v1/commands/payRepair"
      )
      await enter(
        page.getByRole("button", { name: "Commit payRepair", exact: true }),
        "submit stale payment"
      )
      assert.equal((await stale).status(), 409)
      const count = bodies.length
      let reloads = 0
      await context.route(
        `**/api/v1/queries/purchase?cycleId=${cycleId}`,
        async (route) => {
          if (++reloads === 1)
            await route.fulfill({
              status: 503,
              contentType: "application/json",
              body: JSON.stringify({
                error: { code: "ENVIRONMENT_UNAVAILABLE" },
              }),
            })
          else await route.continue()
        }
      )
      await enter(
        page.getByRole("button", {
          name: "Load current source for reconfirmation",
          exact: true,
        }),
        "failed current-source reload"
      )
      await expect(
        page.getByRole("alert").filter({ hasText: "Reload failed" })
      ).toBeVisible()
      assert.equal(bodies.length, count)
      await expect(
        page.getByLabel("Actual payment (major currency)", { exact: true })
      ).toHaveValue("0.50")
      await enter(
        page.getByRole("button", {
          name: "Load current source for reconfirmation",
          exact: true,
        }),
        "reload current source"
      )
      await expect(
        page.getByRole("button", { name: "Commit payRepair", exact: true })
      ).toHaveCount(0)
      await enter(
        page.getByRole("button", {
          name: "Confirm current refs as a new repair intent",
          exact: true,
        }),
        "explicit current-ref confirmation"
      )
      const paid = page.waitForResponse(
        (r) => new URL(r.url()).pathname === "/api/v1/commands/payRepair"
      )
      await enter(
        page.getByRole("button", { name: "Commit payRepair", exact: true }),
        "commit reconfirmed payment"
      )
      assert.equal((await paid).status(), 200)
      const payments = bodies
        .filter((b) => b.name === "payRepair")
        .map((b) => JSON.parse(b.body))
      assert.equal(payments.length, 2)
      assert.notEqual(payments[0].idempotencyKey, payments[1].idempotencyKey)
      assert.notDeepEqual(payments[0].expected, payments[1].expected)
      assert.deepEqual(payments[0].input, payments[1].input)
      row = await current()
      assert.equal(row.repairs[0].payments.length, 2)
      assert.equal(row.repairs[0].invoiceDate, "2026-10-03")
      await context.unroute(`**/api/v1/queries/purchase?cycleId=${cycleId}`)
      await context.unroute("**/api/v1/commands/payRepair")
    }
  )
  await group(
    "logout purges an unresolved repair intent; active SW retains no private API entries",
    async () => {
      await page.goto(`/repairs/${repairId}`)
      await enter(
        page.getByRole("button", { name: /^Record repair payment/ }),
        "second payment form"
      )
      await text(
        page.getByLabel("Actual payment (major currency)", { exact: true }),
        "unresolved amount",
        "0.25"
      )
      await page
        .getByLabel("Actual cash date", { exact: true })
        .fill("2026-10-06")
      await context.route("**/api/v1/commands/payRepair", (route) =>
        route.abort("failed")
      )
      await enter(
        page.getByRole("button", { name: "Commit payRepair", exact: true }),
        "unresolved submission"
      )
      await expect(
        page.getByRole("button", {
          name: "Retry identical payRepair",
          exact: true,
        })
      ).toBeEnabled()
      await enter(
        page.getByRole("button", { name: "Logout", exact: true }),
        "logout purge"
      )
      await expect(page).toHaveURL(/\/login(?:\?|$)/)
      await expect(
        page.getByLabel("Email Address", { exact: true })
      ).toBeVisible()
      await context.unroute("**/api/v1/commands/payRepair")
      const login = await f.login("ADMIN")
      await context.addCookies((await login.storageState()).cookies)
      await page.goto(`/repairs/${repairId}`)
      await expect(
        page.getByRole("heading", { name: "Persisted repair detail" })
      ).toBeVisible()
      await expect(
        page.getByRole("button", {
          name: "Retry identical payRepair",
          exact: true,
        })
      ).toHaveCount(0)
      assert.equal(
        (
          await f.db.query(
            'SELECT count(*) n FROM vamotors."RepairPayment" WHERE "repairId"=$1',
            [repairId]
          )
        ).rows[0].n,
        "2"
      )
      const urls = await page.evaluate(async () =>
        (
          await Promise.all(
            (await caches.keys()).map(async (key) =>
              (await (await caches.open(key)).keys()).map(
                (request) => request.url
              )
            )
          )
        ).flat()
      )
      assert.ok(urls.every((url) => !url.includes("/api/")))
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth
        )
      )
      await page.screenshot({
        path: join(root, `repair-recovery-${suffix}-360.png`),
        fullPage: true,
      })
      await page.setViewportSize({ width: 1920, height: 1080 })
      await page.screenshot({
        path: join(root, `repair-recovery-${suffix}-1920.png`),
        fullPage: true,
      })
    }
  )
} catch (error) {
  await page
    .screenshot({
      path: join(root, `repair-recovery-${suffix}-FAILED.png`),
      fullPage: true,
    })
    .catch(() => undefined)
  console.error(
    `FAIL ${stage}: ${error instanceof Error ? error.message : "unknown"}`
  )
  process.exitCode = 1
} finally {
  await writeFile(
    join(root, `repair-recovery-${suffix}-summary.json`),
    JSON.stringify(
      {
        stage,
        groups,
        tabTargets,
        bodies,
        cycleId,
        repairId,
        vendorId,
        source: process.cwd(),
        scope:
          "Focused PREBASE real UI recovery, native date fill (not a pure-keyboard date-entry claim)",
      },
      null,
      2
    ),
    { mode: 0o600, flag: "wx" }
  )
  await context.close()
  await browser.close()
  await f.close()
}
