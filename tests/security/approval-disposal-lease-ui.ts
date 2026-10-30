/** Real existing236 lease histories, actual keyboard request/separate review at1920/360. */
import assert from "node:assert/strict"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { chromium, expect, type Locator, type Page } from "@playwright/test"
import type {
  Pending,
  PurchaseCycleDTO,
} from "../../.planning/implementation/contracts/api"
import { privateEnvironment } from "../../scripts/private-environment"
import { fixture } from "./cycle-edits-fixture"

const root = process.argv[2],
  run = randomUUID(),
  channel = process.argv[3] ?? "LEASE"
assert.ok(["LEASE", "CASH"].includes(channel))
const { PROJECT } = await privateEnvironment(join(root, "cluster.env"))
const f = await fixture(root, PROJECT)
const retained = JSON.parse(
  await readFile(join(root, "approval-disposal-parent236-before.json"), "utf8")
)
const starter =
  channel === "CASH"
    ? JSON.parse(
        await readFile(
          join(
            root,
            "settlement-upgrade-2360cbb92658d8b0c4cd0a38e3de14ef38efdeaa.json"
          ),
          "utf8"
        )
      )
    : null
const browser = await chromium.launch({ headless: true }),
  groups: unknown[] = []
async function key(page: Page, target: Locator) {
  await target.focus()
  await expect(target).toBeFocused()
  await target.press("Enter")
}
async function type(page: Page, label: string, value: string) {
  const target = page.getByLabel(label, { exact: true })
  await target.focus()
  await expect(target).toBeFocused()
  await target.pressSequentially(value)
}
try {
  await f.start()
  const admin = await f.login("ADMIN"),
    second = await f.login("SECOND")
  try {
    const a = await browser.newContext({
      baseURL: f.origin,
      storageState: await admin.storageState(),
      viewport: { width: 1920, height: 1080 },
      serviceWorkers: "allow",
    })
    const b = await browser.newContext({
      baseURL: f.origin,
      storageState: await second.storageState(),
      viewport: { width: 360, height: 800 },
      serviceWorkers: "allow",
    })
    try {
      const page = await a.newPage(),
        mobile = await b.newPage()
      let index = 0
      for (const id of (channel === "CASH"
        ? [starter.fixture.purchaseId]
        : retained.retained.cycles) as string[]) {
        const row = await f.query<PurchaseCycleDTO>(
          admin,
          "purchase",
          `?cycleId=${id}`
        )
        if (channel === "LEASE" && row.purchaseType !== "LEASE_SETTLEMENT")
          continue
        if (channel === "LEASE") assert.ok(row.settlement)
        else assert.equal(row.purchaseType, "CASH")
        const label = row.settlement?.institutionType ?? row.purchaseType
        assert.equal(row.closedAt, null)
        const detailBefore = await f.snapshot([
          "LeasePurchaseDetail",
          "PurchasePayment",
          "CostPayment",
          "CycleBasisVersion",
          "MileageReading",
        ])
        const proceeds =
          channel === "CASH" ? "2000" : ["0", "2000", "12000"][index++]
        await page.goto(`/purchases/${id}`)
        await page.waitForFunction(
          () => navigator.serviceWorker.controller?.state === "activated"
        )
        await key(
          page,
          page.getByRole("button", { name: "Request write-off", exact: true })
        )
        await page
          .getByLabel("Disposal date", { exact: true })
          .fill(channel === "CASH" ? "2026-10-10" : "2026-10-04")
        await type(page, "Disposal reason", `Actual ${label} disposal ${run}`)
        await type(
          page,
          "Approval request reason",
          `Separate ${label} approval ${run}`
        )
        await type(
          page,
          "Actual proceeds (major currency; 0 if none)",
          proceeds === "0" ? "0" : proceeds === "2000" ? "20" : "120"
        )
        if (proceeds !== "0") {
          await page
            .getByLabel("Actual receipt date", { exact: true })
            .fill(channel === "CASH" ? "2026-10-11" : "2026-10-05")
          await type(
            page,
            "Receipt reference (optional)",
            `Actual ${label} funds`
          )
        }
        const requested = page.waitForResponse(
          (r) =>
            new URL(r.url()).pathname === "/api/v1/commands/requestApproval"
        )
        await key(
          page,
          page.getByRole("button", {
            name: "Submit approval request",
            exact: true,
          })
        )
        const response = await requested
        assert.equal(response.status(), 202)
        const pending = (await response.json()) as Pending
        assert.equal(pending.businessEffect, false)
        assert.equal(
          await f.snapshot([
            "LeasePurchaseDetail",
            "PurchasePayment",
            "CostPayment",
            "CycleBasisVersion",
            "MileageReading",
          ]),
          detailBefore
        )
        assert.equal(
          (await f.query<PurchaseCycleDTO>(admin, "purchase", `?cycleId=${id}`))
            .revision,
          row.revision
        )
        await mobile.goto(`/approvals/${pending.approvalId}`)
        await mobile.waitForFunction(
          () => navigator.serviceWorker.controller?.state === "activated"
        )
        await expect(
          mobile.getByLabel("Decision", { exact: true })
        ).toHaveValue("APPROVE")
        const reviewed = mobile.waitForResponse(
          (r) => new URL(r.url()).pathname === "/api/v1/commands/reviewApproval"
        )
        await key(
          mobile,
          mobile.getByRole("button", { name: "Commit review", exact: true })
        )
        const result = await reviewed
        assert.equal(result.status(), 200)
        const applied = await result.json()
        await expect(
          mobile.getByText("APPROVED", { exact: true })
        ).toBeVisible()
        await mobile.goto(`/purchases/${id}`)
        await expect(
          mobile.getByRole("heading", {
            name: "Committed current disposal",
            exact: true,
          })
        ).toBeVisible()
        assert.equal(
          await mobile.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
          ),
          true
        )
        const after = await f.query<PurchaseCycleDTO>(
          second,
          "purchase",
          `?cycleId=${id}`
        )
        assert.equal(after.status, "WRITTEN_OFF")
        assert.ok(after.closedAt)
        for (const field of [
          "settlement",
          "outstanding",
          "payments",
          "costs",
          "basisVersions",
          "mileage",
        ] as const)
          assert.deepEqual(after[field], row[field])
        assert.equal(after.disposal!.proceeds, proceeds)
        assert.equal(after.disposal!.payments.length, proceeds === "0" ? 0 : 1)
        assert.equal(
          await f.snapshot([
            "LeasePurchaseDetail",
            "PurchasePayment",
            "CostPayment",
            "CycleBasisVersion",
            "MileageReading",
          ]),
          detailBefore
        )
        await mobile.screenshot({
          path: join(
            root,
            `approval-disposal-lease-ui-${run}-${label}-360.png`
          ),
          fullPage: true,
        })
        groups.push({
          institutionType: label,
          cycleId: id,
          approvalId: pending.approvalId,
          requestCommandId: pending.commandId,
          reviewCommandId: applied.commandId,
          proceeds,
          preservedOutstanding: after.outstanding,
          status: "PASS",
        })
      }
      assert.equal(groups.length, channel === "CASH" ? 1 : 3)
    } finally {
      await a.close()
      await b.close()
    }
  } finally {
    await admin.dispose()
    await second.dispose()
  }
} finally {
  await browser.close()
  await f.close()
  await writeFile(
    join(root, `approval-disposal-lease-ui-${run}.json`),
    JSON.stringify({ source: PROJECT, groups }, null, 2),
    { mode: 0o600, flag: "wx" }
  )
}
console.log(
  `PASS actual ${channel === "CASH" ? "retained CASH" : "FINANCE_COMPANY/BANK/PRIVATE_PARTY lease"} keyboard request/separate review, 1920/360 active SW and retained lawful history`
)
