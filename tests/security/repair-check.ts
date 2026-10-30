/** Focused PREBASE proof only: real UI/HTTP -> restricted adapter -> native PG.
 * No terminal fixtures, WRITE_OFF imports, upgrade or acceptance claim. */
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import {
  chromium,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test"
import type {
  Applied,
  Dependency,
  PurchaseCycleDTO,
  PartyDetailDTO,
} from "../../.planning/implementation/contracts/api"
import { fixture, envelope, ref, purchaseInput } from "./cycle-edits-fixture"

process.umask(0o077)
const root = process.argv[2]
assert.ok(root)
const f = await fixture(root)
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  baseURL: f.origin,
  viewport: { width: 360, height: 800 },
  serviceWorkers: "allow",
})
const page = await context.newPage()
const suffix = randomUUID().slice(0, 8),
  groups: string[] = []
let stage = "initialize",
  cycleId = "",
  repairId = ""
const tables = [
  "Vehicle",
  "PurchaseRecord",
  "RepairRecord",
  "RepairPayment",
  "PurchasePayment",
  "VehicleCost",
  "CostPayment",
  "MileageReading",
  "CycleBasisVersion",
  "StatusEvent",
  "CommandReceipt",
  "AuditEntry",
  "EntityReadVersion",
  "BusinessSequence",
  "Notification",
]
async function group(name: string, run: () => Promise<void>) {
  stage = name
  await run()
  groups.push(name)
  console.log(`PASS ${name}`)
}
const current = (client: APIRequestContext) =>
  f.query<PurchaseCycleDTO>(client, "purchase", `?cycleId=${cycleId}`)
const repairRefs = (row: PurchaseCycleDTO): Dependency[] => [
  ref(row),
  ref(row.repairs.find((r) => r.id === repairId)!, "RepairRecord"),
]
async function submit(p: Page, name: string) {
  const response = p.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === `/api/v1/commands/${name}` &&
      r.request().method() === "POST"
  )
  await p.getByRole("button", { name: `Commit ${name}`, exact: true }).click()
  const r = await response,
    value = await r.json()
  assert.equal(
    r.status(),
    name === "sendRepair" ? 201 : 200,
    JSON.stringify(value)
  )
  return value as Applied
}
try {
  await f.start()
  const admin = await f.login("ADMIN"),
    second = await f.login("SECOND")
  await context.addCookies((await admin.storageState()).cookies)
  const cmd = (
    name: string,
    input: unknown,
    expected: Dependency[] = [],
    status = 200
  ) => f.command(admin, name, envelope(input, expected), status)
  const supplier = await cmd(
    "createDirectoryParty",
    {
      type: "SUPPLIER",
      values: {
        name: `Repair supplier ${suffix}`,
        category: "COMPANY",
        contacts: [
          {
            name: "Contact",
            phone: "0112345678",
            role: "Sales",
            primary: true,
          },
        ],
      },
    },
    [],
    201
  )
  let vendor = await cmd(
    "createDirectoryParty",
    {
      type: "REPAIR_VENDOR",
      values: {
        name: `Repair vendor ${suffix}`,
        category: "COMPANY",
        specialisation: "Mechanical",
        contacts: [
          {
            name: "Mechanic",
            phone: "0112345678",
            role: "Workshop",
            primary: true,
          },
        ],
      },
    },
    [],
    201
  )
  const purchase = await cmd(
    "recordPurchase",
    purchaseInput(supplier.result.id, suffix, "repair"),
    [ref(supplier.result, "Supplier")],
    201
  )
  cycleId = purchase.result.id
  let row = await current(admin)
  const physical = (
    await f.db.query(
      'SELECT to_jsonb(v) v FROM vamotors."Vehicle" v WHERE id=$1',
      [row.vehicleId]
    )
  ).rows
  const mileage = (
    await f.db.query(
      'SELECT to_jsonb(m) m FROM vamotors."MileageReading" m WHERE "cycleId"=$1',
      [cycleId]
    )
  ).rows
  await group(
    "real acquisition100 and received held stock; unreceived send has no effects",
    async () => {
      assert.equal(row.financial?.basis, "10000")
      const before = await f.snapshot(tables)
      await cmd(
        "sendRepair",
        {
          cycleId,
          vendorId: vendor.result.id,
          request: "Actual work",
          sentDate: "2026-10-03",
        },
        [ref(row), ref(vendor.result, "RepairVendor")],
        409
      )
      assert.equal(await f.snapshot(tables), before)
      await cmd(
        "receiveStock",
        {
          cycleId,
          date: "2026-10-02",
          disposition: { kind: "HOLD", reason: "Awaiting inspection" },
        },
        [ref(row)]
      )
      row = await current(admin)
      assert.equal(row.available, false)
    }
  )
  await group(
    "360px actual send UI and persisted direct repair graph",
    async () => {
      await page.goto(`/purchases/${cycleId}`)
      await page.waitForFunction(
        () => navigator.serviceWorker.controller?.state === "activated"
      )
      await page
        .getByRole("button", { name: "Send for repair", exact: true })
        .click()
      await expect(
        page
          .getByLabel("Active repair vendor", { exact: true })
          .getByRole("option", { name: new RegExp(`Repair vendor ${suffix}`) })
      ).toBeAttached()
      await page
        .getByLabel("Active repair vendor", { exact: true })
        .selectOption(vendor.result.id)
      await page.getByLabel("Sent date", { exact: true }).fill("2026-10-03")
      await page
        .getByLabel("Repair request", { exact: true })
        .fill("Actual mechanical work")
      repairId = (await submit(page, "sendRepair")).result.id
      row = await current(second)
      assert.equal(row.status, "IN_REPAIR")
      assert.equal(row.available, false)
      assert.equal(row.repairs[0].revision, 1)
      assert.equal(row.repairs[0].invoiceAmount, undefined)
      assert.deepEqual(row.repairs[0].payments, [])
      assert.equal(row.financial?.basis, "10000")
      assert.equal(
        (
          await f.db.query(
            'SELECT count(*) n FROM vamotors."StatusEvent" WHERE "cycleId"=$1 AND action=\'sendRepair\'',
            [cycleId]
          )
        ).rows[0].n,
        "1"
      )
      await page.screenshot({
        path: join(root, `repair-${suffix}-sent360.png`),
        fullPage: true,
      })
    }
  )
  await group(
    "vendor archived after dispatch; actual unpaid return UI adds invoice10 and holds stock",
    async () => {
      vendor = await cmd(
        "archiveParty",
        {
          type: "REPAIR_VENDOR",
          id: vendor.result.id,
          active: false,
          reason: "Retain old liability and history",
        },
        [ref(vendor.result, "RepairVendor")]
      )
      await page.goto(`/repairs/${repairId}`)
      await page
        .getByRole("button", {
          name: "Record actual return and invoice",
          exact: true,
        })
        .click()
      await page
        .getByLabel("Actual invoice (major currency; zero allowed)", {
          exact: true,
        })
        .fill("10")
      await page
        .getByLabel("Actual invoice date", { exact: true })
        .fill("2026-10-03")
      await page
        .getByLabel("Actual returned date", { exact: true })
        .fill("2026-10-04")
      await page
        .getByLabel("Actual return summary", { exact: true })
        .fill("Completed actual mechanical repair")
      await submit(page, "returnRepair")
      row = await current(admin)
      assert.equal(row.status, "IN_STOCK")
      assert.equal(row.available, false)
      assert.equal(row.holdReason, "RETURNED_AWAITING_RELEASE")
      assert.equal(row.financial?.basis, "11000")
      assert.equal(row.financial?.cashOut, "10000")
      assert.equal(row.repairs[0].invoiceAmount, "1000")
      assert.equal(row.repairs[0].revision, 2)
      assert.deepEqual(row.repairs[0].payments, [])
      const notifications = (
        await f.db.query(
          'SELECT "recipientUserId",kind,"eventKey","targetId" FROM vamotors."Notification" WHERE "targetId"=$1 ORDER BY "recipientUserId"',
          [repairId]
        )
      ).rows
      assert.equal(notifications.length, 2)
      assert.ok(
        notifications.every(
          (n) =>
            n.kind === "REPAIR_RETURNED" &&
            n.eventKey === `repair:returned:${repairId}:2`
        )
      )
      const party = await f.query<PartyDetailDTO>(
        admin,
        "party",
        `?type=REPAIR_VENDOR&id=${vendor.result.id}`
      )
      assert.ok(party.type === "REPAIR_VENDOR")
      assert.ok(
        party.contributions.repairs.links.some((l) => l.id === repairId)
      )
      assert.equal(party.contributions.repairs.state, "PENDING_DOMAIN")
    }
  )
  await group(
    "cost5 rebuild retains unpaid repair invoice; listed edit changes neither basis nor cash",
    async () => {
      await cmd(
        "addCost",
        {
          cycleId,
          category: "Transport",
          description: "Actual incurred cost",
          amount: "500",
          incurredDate: "2026-10-04",
        },
        [ref(row)],
        201
      )
      row = await current(admin)
      assert.equal(row.financial?.basis, "11500")
      assert.equal(row.financial?.repairs, "1000")
      const basis = row.basisVersions,
        cash = row.financial?.cashOut
      await cmd(
        "setListedPrice",
        { cycleId, amount: "16000", reason: "Actual asking update" },
        [ref(row)]
      )
      row = await current(admin)
      assert.deepEqual(row.basisVersions, basis)
      assert.equal(row.financial?.cashOut, cash)
    }
  )
  await group(
    "actual cash4 independent date through UI then cash6; immutable exact reversal leaves basis115",
    async () => {
      assert.equal((await page.goto(`/repairs/${repairId}`))?.status(), 200)
      await page.getByRole("button", { name: /^Record repair payment/ }).click()
      await page
        .getByLabel("Actual payment (major currency)", { exact: true })
        .fill("4")
      await page
        .getByLabel("Actual cash date", { exact: true })
        .fill("2026-09-25")
      await submit(page, "payRepair")
      row = await current(admin)
      const first = row.repairs[0].payments[0]
      assert.equal(first.date, "2026-09-25")
      assert.equal(first.amount, "400")
      const basis = row.basisVersions
      const body = envelope(
        {
          repairId,
          payment: {
            amount: "600",
            date: "2026-10-05",
            method: "BANK_TRANSFER",
          },
        },
        repairRefs(row)
      )
      const paid = await f.command(admin, "payRepair", body)
      assert.equal((await f.command(admin, "payRepair", body)).replayed, true)
      row = await current(admin)
      assert.deepEqual(row.basisVersions, basis)
      assert.equal(row.repairs[0].payments.length, 2)
      assert.equal(row.financial?.cashOut, "11000")
      const before = await f.snapshot(tables)
      await cmd(
        "payRepair",
        {
          repairId,
          payment: { amount: "1", date: "2026-10-05", method: "CASH" },
        },
        repairRefs(row),
        422
      )
      assert.equal(await f.snapshot(tables), before)
      await cmd(
        "reversePayment",
        {
          sourceType: "REPAIR",
          sourceId: repairId,
          paymentId: first.id,
          reason: "Correct mistaken cash entry, not an actual refund",
        },
        repairRefs(row)
      )
      row = await current(admin)
      assert.deepEqual(row.basisVersions, basis)
      assert.equal(row.financial?.basis, "11500")
      assert.equal(row.financial?.cashIn, "400")
      assert.deepEqual(
        row.repairs[0].payments.find((p) => p.id === first.id),
        first
      )
      const reversal = row.repairs[0].payments.find(
        (p) => p.reversalOf === first.id
      )!
      assert.equal(reversal.date, first.date)
      assert.equal(reversal.amount, first.amount)
      assert.equal(reversal.direction, "IN")
      assert.equal(
        (
          await f.db.query(
            'SELECT count(*) n FROM vamotors."RepairPayment" WHERE "commandId"=$1',
            [paid.commandId]
          )
        ).rows[0].n,
        "1"
      )
      assert.equal(row.repairs[0].invoiceDate, "2026-10-03")
    }
  )
  await group(
    "release is separate; archived new dispatch denied; physical identity and mileage untouched",
    async () => {
      assert.equal(row.available, false)
      await cmd("releaseStock", { cycleId }, [ref(row)])
      row = await current(admin)
      assert.equal(row.available, true)
      const before = await f.snapshot(tables)
      await cmd(
        "sendRepair",
        {
          cycleId,
          vendorId: vendor.result.id,
          request: "No new archived dispatch",
          sentDate: "2026-10-06",
        },
        [ref(row), ref(vendor.result, "RepairVendor")],
        409
      )
      assert.equal(await f.snapshot(tables), before)
      assert.deepEqual(
        (
          await f.db.query(
            'SELECT to_jsonb(v) v FROM vamotors."Vehicle" v WHERE id=$1',
            [row.vehicleId]
          )
        ).rows,
        physical
      )
      assert.deepEqual(
        (
          await f.db.query(
            'SELECT to_jsonb(m) m FROM vamotors."MileageReading" m WHERE "cycleId"=$1',
            [cycleId]
          )
        ).rows,
        mileage
      )
      assert.equal((await admin.get(`/repairs/${randomUUID()}`)).status(), 404)
      await page.setViewportSize({ width: 1920, height: 1080 })
      await page.goto(`/repairs/${repairId}`)
      await expect(
        page.getByRole("heading", { name: "Persisted repair detail" })
      ).toBeVisible()
      await page
        .getByRole("link", {
          name: "Repair vendor and retained history",
          exact: true,
        })
        .click()
      await expect(page).toHaveURL(
        new RegExp(`/third-parties/${vendor.result.id}\\?type=REPAIR_VENDOR$`)
      )
      await expect(
        page.getByRole("heading", {
          name: `Repair vendor ${suffix}`,
          exact: true,
        })
      ).toBeVisible()
      await page.getByRole("link", { name: "View repair", exact: true }).click()
      await expect(
        page.getByRole("heading", {
          name: "Persisted repair detail",
          exact: true,
        })
      ).toBeVisible()
      await page.screenshot({
        path: join(root, `repair-${suffix}-history1920.png`),
        fullPage: true,
      })
    }
  )
} catch (error) {
  await page
    .screenshot({
      path: join(root, `repair-${suffix}-FAILED.png`),
      fullPage: true,
    })
    .catch(() => undefined)
  console.error(
    `FAIL ${stage}: ${error instanceof Error ? error.message : "unknown"}`
  )
  process.exitCode = 1
} finally {
  await writeFile(
    join(root, `repair-${suffix}-summary.json`),
    JSON.stringify(
      {
        stage,
        groups,
        cycleId,
        repairId,
        source: process.cwd(),
        scope:
          "Focused PREBASE only; NOT final upgrade/restart/security/full UI acceptance",
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
