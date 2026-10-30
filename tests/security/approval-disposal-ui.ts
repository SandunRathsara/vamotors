/** Production Chromium with real active SW; explicit keyboard actions, no mocked owner. */
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { chromium, expect, type Locator, type Page } from "@playwright/test"
import type {
  Pending,
  PurchaseCycleDTO,
} from "../../.planning/implementation/contracts/api"
import { envelope, fixture, purchaseInput, ref } from "./cycle-edits-fixture"

process.umask(0o077)
const root = process.argv[2]
assert.ok(root)
const f = await fixture(root),
  browser = await chromium.launch({ headless: true }),
  suffix = randomUUID().slice(0, 8),
  groups: unknown[] = []
const tables = [
  "Vehicle",
  "PurchaseRecord",
  "PurchasePayment",
  "CostPayment",
  "CycleBasisVersion",
  "StatusEvent",
  "ApprovalRequest",
  "Disposal",
  "DisposalReceipt",
  "Notification",
  "AuditEntry",
  "EntityReadVersion",
  "CommandReceipt",
  "BusinessSequence",
]
let stage = "initialize"
const pages: Page[] = [], responses: { path: string; status: number }[] = []
async function key(page: Page, control: Locator) {
  // Let the previous action's intentional alert-focus animation frame finish.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))
  await control.focus()
  await expect(control).toBeFocused()
  await control.press("Enter")
}
async function group(name: string, run: () => Promise<void>) {
  if (process.argv[3] && !name.includes(process.argv[3])) {
    groups.push({ group: name, skipped: true, reason: "Explicit diagnostic group filter" })
    return
  }
  stage = name
  await run()
  groups.push({ group: name, pass: true })
  console.log(`PASS ${name}`)
}
async function view(page: Page, label: string) {
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    ),
    true
  )
  await page.screenshot({
    path: join(root, `writeoff-ui-${suffix}-${label}.png`),
    fullPage: true,
  })
}
try {
  await f.start()
  const admin = await f.login("ADMIN"),
    second = await f.login("SECOND")
  try {
    const requester = await browser.newContext({
      baseURL: f.origin,
      storageState: await admin.storageState(),
      viewport: { width: 1920, height: 1080 },
      serviceWorkers: "allow",
    })
    const sameActor = await browser.newContext({
      baseURL: f.origin,
      storageState: await admin.storageState(),
      viewport: { width: 360, height: 800 },
      serviceWorkers: "allow",
    })
    const reviewer = await browser.newContext({
      baseURL: f.origin,
      storageState: await second.storageState(),
      viewport: { width: 360, height: 800 },
      serviceWorkers: "allow",
    })
    const page = await requester.newPage(),
      mobile = await reviewer.newPage(),
      other = await sameActor.newPage()
    pages.push(page, mobile, other)
    for (const p of pages) p.on("response", response => {
      const path = new URL(response.url()).pathname
      if (path.startsWith("/api/v1/commands/")) responses.push({ path, status: response.status() })
    })
    const supplier = await f.command(
      admin,
      "createDirectoryParty",
      envelope({
        type: "SUPPLIER",
        values: {
          name: `Writeoff UI ${suffix}`,
          category: "COMPANY",
          contacts: [],
        },
      }),
      201
    )
    const created = await f.command(
      admin,
      "recordPurchase",
      envelope(purchaseInput(supplier.result.id, suffix, "ui"), [
        ref(supplier.result, "Supplier"),
      ]),
      201
    )
    let row = await f.query<PurchaseCycleDTO>(
      admin,
      "purchase",
      `?cycleId=${created.result.id}`
    )
    await f.command(
      admin,
      "addCost",
      envelope(
        {
          cycleId: row.id,
          category: "Transport",
          description: "Actual UI basis cost",
          amount: "500",
          incurredDate: "2026-10-03",
        },
        [ref(row)]
      ),
      201
    )
    row = await f.query<PurchaseCycleDTO>(
      admin,
      "purchase",
      `?cycleId=${row.id}`
    )
    const requestBodies: string[] = [],
      reviewBodies: string[] = [],
      routeErrors: number[] = []
    let pending!: Pending
    await group(
      "P8 1920 keyboard request, committed response loss, route unmount and failed ordinary read preserve exact envelope",
      async () => {
        await page.goto(`/purchases/${row.id}`)
        await page.waitForFunction(
          () => navigator.serviceWorker.controller?.state === "activated"
        )
        await key(
          page,
          page.getByRole("button", { name: "Request write-off", exact: true })
        )
        await page
          .getByLabel("Disposal date", { exact: true })
          .fill("2026-10-04")
        await page.getByLabel("Disposal method", { exact: true }).focus()
        await page.keyboard.press("ArrowDown")
        await page
          .getByLabel("Disposal reason", { exact: true })
          .fill(`PRIVATE_UI_DISPOSAL_${suffix}`)
        await page
          .getByLabel("Approval request reason", { exact: true })
          .fill(`PRIVATE_UI_REQUEST_${suffix}`)
        await page.getByLabel("Actual proceeds", { exact: false }).fill("20.00")
        await page
          .getByLabel("Actual receipt date", { exact: true })
          .fill("2026-10-05")
        await page
          .getByLabel("Receipt reference (optional)", { exact: true })
          .fill(`PRIVATE_UI_RECEIPT_${suffix}`)
        await requester.route(
          "**/api/v1/commands/requestApproval",
          async (route) => {
            // A controlling active SW deliberately leaves POST on native network.
            requestBodies.push(route.request().postData()!)
            if (requestBodies.length === 1) {
              const response = await route.fetch()
              if (response.status() !== 202) routeErrors.push(response.status())
              pending = await response.json()
              await route.abort("failed")
            } else await route.continue()
          }
        )
        await key(
          page,
          page.getByRole("button", {
            name: "Submit approval request",
            exact: true,
          })
        )
        await expect(
          page.getByRole("button", {
            name: "Retry identical request",
            exact: true,
          })
        ).toBeVisible()
        assert.deepEqual(routeErrors, [])
        const committed = await f.snapshot(tables)
        await key(
          page,
          page.getByRole("link", { name: "Approvals", exact: true })
        )
        await expect(
          page.getByRole("heading", { name: "Approvals", exact: true })
        ).toBeVisible()
        await requester.route("**/api/v1/queries/purchase?**", (route) =>
          route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({
              ok: false,
              error: { code: "RETRYABLE_TRANSACTION", retryable: true },
            }),
          })
        )
        await page.goBack()
        await expect(
          page.getByRole("button", { name: "Retry detail", exact: true })
        ).toBeVisible()
        await requester.unroute("**/api/v1/queries/purchase?**")
        await key(
          page,
          page.getByRole("button", { name: "Retry detail", exact: true })
        )
        await key(
          page,
          page.getByRole("button", {
            name: "Recover unresolved write-off request",
            exact: true,
          })
        )
        await expect(
          page.getByLabel("Approval request reason", { exact: true })
        ).toHaveValue(`PRIVATE_UI_REQUEST_${suffix}`)
        await key(
          page,
          page.getByRole("button", {
            name: "Retry identical request",
            exact: true,
          })
        )
        await expect(
          page
            .getByRole("alert")
            .filter({ hasText: "Not written off; no funds recorded" })
        ).toBeVisible()
        assert.equal(requestBodies.length, 2)
        assert.equal(requestBodies[0], requestBodies[1])
        assert.equal(await f.snapshot(tables), committed)
        await requester.unroute("**/api/v1/commands/requestApproval")
        await other.goto(`/approvals/${pending.approvalId}`)
        await expect(
          other.getByText("A separate authorized reviewer is required.", {
            exact: false,
          })
        ).toBeVisible()
        await expect(
          other.getByRole("button", { name: "Commit review", exact: true })
        ).toHaveCount(0)
        await view(page, "requester-1920")
        await view(other, "same-actor-360")
      }
    )
    await group(
      "P8 separate 360 keyboard review, committed response loss and unmount recovery",
      async () => {
        await mobile.goto(`/approvals/${pending.approvalId}`)
        await mobile.waitForFunction(
          () => navigator.serviceWorker.controller?.state === "activated"
        )
        await expect(
          mobile.getByText(`PRIVATE_UI_REQUEST_${suffix}`, { exact: true })
        ).toBeVisible()
        await mobile
          .getByLabel("Review note (required for rejection)")
          .fill("Actual independent approval")
        await reviewer.route(
          "**/api/v1/commands/reviewApproval",
          async (route) => {
            reviewBodies.push(route.request().postData()!)
            if (reviewBodies.length === 1) {
              const response = await route.fetch()
              if (response.status() !== 200) routeErrors.push(response.status())
              await route.abort("failed")
            } else await route.continue()
          }
        )
        await key(
          mobile,
          mobile.getByRole("button", { name: "Commit review", exact: true })
        )
        await expect(
          mobile.getByRole("button", {
            name: "Retry identical review",
            exact: true,
          })
        ).toBeVisible()
        const committed = await f.snapshot(tables)
        await key(
          mobile,
          mobile.getByRole("link", {
            name: "Owning purchase cycle",
            exact: true,
          })
        )
        await expect(
          mobile.getByRole("heading", {
            name: "Committed current disposal",
            exact: true,
          })
        ).toBeVisible()
        await mobile.goBack()
        await key(
          mobile,
          mobile.getByRole("button", {
            name: "Retry identical review",
            exact: true,
          })
        )
        await expect(
          mobile.getByRole("alert").filter({ hasText: "Review committed once" })
        ).toBeVisible()
        assert.equal(reviewBodies.length, 2)
        assert.equal(reviewBodies[0], reviewBodies[1])
        assert.equal(await f.snapshot(tables), committed)
        await reviewer.unroute("**/api/v1/commands/reviewApproval")
        await view(mobile, "reviewer-terminal-360")
        await page.goto(`/vehicles/${row.vehicleId}`)
        await expect(
          page.getByRole("heading", {
            name: "Committed current disposal",
            exact: true,
          })
        ).toBeVisible()
        await expect(page.getByText("85.00", { exact: true })).toBeVisible()
        await view(page, "vehicle-terminal-1920")
      }
    )
    await group(
      "P8 real bell read controls and authenticated private-cache exclusion",
      async () => {
        await key(page, page.getByRole("button", { name: /^Notifications/ }))
        await expect(
          page.getByRole("heading", { name: "Notifications", exact: true })
        ).toBeVisible()
        await key(
          page,
          page
            .getByRole("button", {
              name: "Mark notification read",
              exact: true,
            })
            .first()
        )
        await expect(
          page.getByText("Read state committed.", { exact: true })
        ).toBeVisible()
        await key(
          page,
          page.getByRole("button", { name: "Mark all as read", exact: true })
        )
        await expect(page.getByText("0 unread", { exact: true })).toBeVisible()
        const cachesState = await page.evaluate(async () => {
          const entries: string[] = []
          for (const name of await caches.keys())
            for (const request of await (await caches.open(name)).keys())
              entries.push(request.url)
          return {
            controlled: navigator.serviceWorker.controller?.state,
            entries,
            local: JSON.stringify({ ...localStorage, ...sessionStorage }),
          }
        })
        assert.equal(cachesState.controlled, "activated")
        assert.ok(
          !cachesState.entries.some((url) =>
            /\/api\/|\/approvals|\/purchases|\/vehicles/.test(url)
          )
        )
        assert.ok(!cachesState.local.includes("PRIVATE_UI_"))
        groups.push({
          group: "active SW cache inventory",
          ...cachesState,
          local: undefined,
        })
        await view(page, "recipient-bell-1920")
      }
    )
    await group(
      "P8 unresolved private request is purged on logout across same-actor contexts",
      async () => {
        const created = await f.command(
          admin,
          "recordPurchase",
          envelope(purchaseInput(supplier.result.id, suffix, "logout"), [
            ref(supplier.result, "Supplier"),
          ]),
          201
        )
        await page.goto(`/purchases/${created.result.id}`)
        await key(
          page,
          page.getByRole("button", { name: "Request write-off", exact: true })
        )
        await page
          .getByLabel("Disposal date", { exact: true })
          .fill("2026-10-04")
        await page
          .getByLabel("Disposal reason", { exact: true })
          .fill(`PRIVATE_UI_LOGOUT_DISPOSAL_${suffix}`)
        await page
          .getByLabel("Approval request reason", { exact: true })
          .fill(`PRIVATE_UI_LOGOUT_REQUEST_${suffix}`)
        await page.getByLabel("Actual proceeds", { exact: false }).fill("0")
        await requester.route("**/api/v1/commands/requestApproval", (route) =>
          route.abort("failed")
        )
        await key(
          page,
          page.getByRole("button", {
            name: "Submit approval request",
            exact: true,
          })
        )
        await expect(
          page.getByRole("button", {
            name: "Retry identical request",
            exact: true,
          })
        ).toBeVisible()
        assert.ok(
          !(
            await page.evaluate(() =>
              JSON.stringify({ ...localStorage, ...sessionStorage })
            )
          ).includes("PRIVATE_UI_")
        )
        await key(
          page,
          page.getByRole("button", { name: "Logout", exact: true })
        )
        await page.waitForURL(/\/login(?:\?|$)/)
        await other.waitForURL(/\/login(?:\?|$)/)
        await expect(
          page.getByLabel("Approval request reason", { exact: true })
        ).toHaveCount(0)
        const denied = await requester.request.get(
          `/api/v1/queries/purchase?cycleId=${created.result.id}`
        )
        assert.equal(denied.status(), 401)
        assert.match(denied.headers()["cache-control"], /no-store/)
        await view(page, "logout-purge")
      }
    )
    await requester.close()
    await reviewer.close()
    await sameActor.close()
  } finally {
    await admin.dispose()
    await second.dispose()
  }
} catch (error) {
  for (const [index, page] of pages.entries()) if (!page.isClosed()) {
    await page.screenshot({ path: join(root, `writeoff-ui-${suffix}-failure-${index}.png`), fullPage: true }).catch(() => undefined)
    await writeFile(join(root, `writeoff-ui-${suffix}-failure-${index}.json`), JSON.stringify({ stage, url: page.url(), responses, bodyText: await page.locator("body").innerText().catch(() => "UNAVAILABLE") }, null, 2), { mode: 0o600 })
  }
  groups.push({
    group: stage,
    pass: false,
    error: error instanceof Error ? error.message : "UNKNOWN",
  })
  throw error
} finally {
  await browser.close()
  await f.close()
  await writeFile(
    join(root, `approval-disposal-ui-${Date.now()}.json`),
    JSON.stringify({ source: process.cwd(), groups }, null, 2) + "\n",
    { mode: 0o600 }
  )
}
