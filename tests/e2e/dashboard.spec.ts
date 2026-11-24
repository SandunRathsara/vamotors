import { randomUUID } from "node:crypto"
import type { Locator, Page } from "@playwright/test"
import type {
  CustomerDTO,
  PurchaseCycleDTO,
} from "@/.planning/implementation/contracts/api"
import { test, expect } from "../fixtures-local"
import { envelope, purchaseInput, ref } from "../security/cycle-edits-fixture"

async function activate(page: Page, target: Locator) {
  await page.bringToFront()
  await expect(target).toBeVisible()
  await expect(target).toBeEnabled()
  // Tab in document order. Wrapping through the browser chrome blurs the
  // window and correctly obscures the authenticated content.
  const direction = await target.evaluate((element) =>
    (document.activeElement?.compareDocumentPosition(element) ?? 0) &
    Node.DOCUMENT_POSITION_PRECEDING
      ? "Shift+Tab"
      : "Tab"
  )
  for (let tab = 0; tab < 80; tab++) {
    if (
      await target.evaluate((element) => element === document.activeElement)
    ) {
      await expect(target).toBeFocused()
      await page.keyboard.press("Enter")
      return
    }
    await page.keyboard.press(direction)
  }
  throw Error("Control was not reached by tabbing")
}

test("permission-aware navigation and purchase to invoice, reports and reconciliation", async ({
  local,
  browser,
  page,
  viewport,
}) => {
  const admin = await local.login("ADMIN")
  const staff = await local.login("STAFF")
  const tag = randomUUID().slice(0, 8)
  try {
    const supplier = await local.command(
      admin,
      "createDirectoryParty",
      envelope({
        type: "SUPPLIER",
        values: { name: `Supplier ${tag}`, category: "COMPANY", contacts: [] },
      }),
      201
    )
    const settings = await local.query<{ id: string; revision: number }>(
      admin,
      "settings"
    )
    const company = await local.command(
      admin,
      "createFinanceCompany",
      envelope(
        {
          name: `Finance ${tag}`,
          contacts: [
            {
              name: "Finance contact",
              phone: "0112345678",
              role: "Processing",
              primary: true,
            },
          ],
          policy: {
            path: "REFERRAL",
            commission: { basis: "FINANCED_PRINCIPAL", rateBps: 100 },
            processingFee: "250000",
            reconciliationMethod: "PERIOD_NOTICE",
          },
        },
        [ref(settings, "Settings")]
      ),
      201
    )
    const acquisition = await local.command(
      admin,
      "recordPurchase",
      envelope(purchaseInput(supplier.result.id, tag, tag, 100), [
        ref(supplier.result, "Supplier"),
      ]),
      201
    )
    const cycle = await local.query<PurchaseCycleDTO>(
      admin,
      "purchase",
      `?cycleId=${acquisition.result.id}`
    )
    await local.command(
      admin,
      "receiveStock",
      envelope(
        {
          cycleId: cycle.id,
          date: "2026-10-02",
          disposition: { kind: "RELEASE" },
        },
        [ref(cycle)]
      )
    )
    const customer = await local.command(
      admin,
      "createCustomer",
      envelope({
        fullName: `Browser buyer ${tag}`,
        callingName: "Browser",
        nicOrPassport: `UX-${tag}`,
        address: "Synthetic address",
        phone: "0771111123",
      }),
      201
    )
    const buyer = await local.query<CustomerDTO>(
      admin,
      "customer",
      `?id=${customer.result.id}`
    )
    await page.context().addCookies((await admin.storageState()).cookies)
    const mobile = viewport!.width === 360
    const toggle = page.getByRole("button", { name: "Toggle Sidebar" })
    const nav = page.getByRole("navigation", { name: "Main navigation" })
    const openNav = async () => {
      if (mobile) await activate(page, toggle)
    }
    await page.goto(local.origin + "/dashboard")
    await openNav()
    for (const name of [
      "Vehicles",
      "Purchases",
      "Repairs",
      "Sales & invoices",
      "Lease deals",
      "Dispatch",
      "Lease comparison",
      "Rate sheets",
      "Reconciliation",
      "Approvals",
      "Reports",
      "Import staging",
      "Settings",
      "Customers",
      "Third parties",
      "Users & roles",
      "Audit history",
    ]) {
      await expect(nav.getByRole("link", { name, exact: true })).toBeVisible()
    }
    if (mobile) {
      const dialog = page.getByRole("dialog", { name: "Sidebar" })
      await expect(dialog).toBeVisible()
      await page.keyboard.press("Shift+Tab")
      await expect
        .poll(() =>
          dialog.evaluate((element) => element.contains(document.activeElement))
        )
        .toBe(true)
      await page.keyboard.press("Tab")
      await expect
        .poll(() =>
          dialog.evaluate((element) => element.contains(document.activeElement))
        )
        .toBe(true)
      await page.keyboard.press("Escape")
      await expect(toggle).toBeFocused()
      await openNav()
    }
    await activate(page, nav.getByRole("link", { name: "Purchases" }))
    await expect(page).toHaveURL(/\/purchases$/)
    const search = page.getByLabel("Search make, model, engine or chassis")
    await search.fill(tag)
    await activate(
      page,
      page.getByRole("button", { name: "Search", exact: true })
    )
    await expect(page).toHaveURL(new RegExp(`q=${tag}`))
    await activate(page, page.getByRole("link", { name: "View purchase" }))
    await expect(page).toHaveURL(new RegExp(`/purchases/${cycle.id}$`))
    const saleButton = page.getByRole("button", {
      name: "Complete Immediate Sale",
      exact: true,
    })
    await activate(page, saleButton)
    await expect(page.getByLabel("Buyer Customer")).toContainText(
      buyer.fullName
    )
    await page.getByLabel("Buyer Customer").selectOption(buyer.id)
    await page.locator("#sale-price").fill("150")
    await page.locator("#sale-date").fill("2026-10-05")
    await page.locator("#sale-mileage").fill("350")
    await page.locator("#sale-ref").fill(`UX-${tag}`)
    await activate(page, saleButton)
    const salePath = /\/sales\/[a-f0-9-]+$/
    await page.waitForURL(salePath, { timeout: 15_000 }).catch(async () => {
      await activate(
        page,
        page.getByRole("link", { name: "Open completed sale detail" })
      )
      await expect(page).toHaveURL(salePath)
    })
    await expect(
      page.getByRole("heading", { level: 1, name: /^Sale / })
    ).toBeFocused()
    await activate(page, page.getByRole("button", { name: "Generate invoice" }))
    const [invoice] = await Promise.all([
      page.waitForEvent("download", { timeout: 30_000 }),
      activate(page, page.getByRole("link", { name: "Download version 1" })),
    ])
    expect(invoice.suggestedFilename()).toMatch(/\.pdf$/i)

    await openNav()
    await activate(
      page,
      nav.getByRole("link", { name: "Reports", exact: true })
    )
    await activate(
      page,
      page.getByRole("link", { name: "Vehicles sold per period" })
    )
    await activate(page, page.getByRole("button", { name: "Export CSV" }))
    const [exportCsv] = await Promise.all([
      page.waitForEvent("download", { timeout: 30_000 }),
      activate(page, page.getByRole("link", { name: "Download CSV" })),
    ])
    expect(exportCsv.suggestedFilename()).toMatch(/\.csv$/i)
    await openNav()
    await activate(page, nav.getByRole("link", { name: "Reconciliation" }))
    await expect(
      page.getByRole("heading", { name: /reconciliation/i, level: 1 })
    ).toBeVisible()
    await page.getByLabel("Finance company").selectOption(company.result.id)
    await expect(
      page.getByRole("heading", { name: "Entitlements" })
    ).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`company=${company.result.id}`))
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth)
    ).toBeLessThanOrEqual(viewport!.width)

    await page.waitForFunction(
      () => navigator.serviceWorker.controller?.state === "activated",
      undefined,
      { timeout: 30_000 }
    )
    const cachedPaths = await page.evaluate(async () =>
      Promise.all(
        (await caches.keys()).map(async (key) =>
          (await (await caches.open(key)).keys()).map(
            ({ url }) => new URL(url).pathname
          )
        )
      ).then((entries) => entries.flat().sort())
    )
    expect(cachedPaths).toEqual([
      "/apple-touch-icon.png",
      "/offline.html",
      "/pwa-icon-192.png",
      "/pwa-icon-512.png",
    ])

    const limited = await browser.newPage({
      storageState: await staff.storageState(),
      viewport,
    })
    try {
      await limited.goto(local.origin + "/dashboard")
      if (mobile)
        await activate(
          limited,
          limited.getByRole("button", { name: "Toggle Sidebar" })
        )
      await expect(
        limited
          .getByRole("navigation", { name: "Main navigation" })
          .getByRole("link")
      ).toHaveText(["Overview"])
      await expect(
        limited.getByRole("button", {
          name: /notifications|new purchase|new sale/i,
        })
      ).toHaveCount(0)
      await limited.goto(local.origin + "/sales")
      await expect(
        limited.getByRole("button", { name: "Complete Immediate Sale" })
      ).toHaveCount(0)
    } finally {
      await limited.close()
    }
  } finally {
    await admin.dispose()
    await staff.dispose()
  }
})
