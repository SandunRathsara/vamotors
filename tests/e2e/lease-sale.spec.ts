import { randomUUID } from "node:crypto"
import type { APIRequestContext, Page } from "@playwright/test"
import type {
  CustomerDTO,
  PurchaseCycleDTO,
} from "@/.planning/implementation/contracts/api"
import { test as base, expect } from "../fixtures-local"
import {
  envelope,
  fixture,
  purchaseInput,
  ref,
} from "../security/cycle-edits-fixture"

type LocalApp = Awaited<ReturnType<typeof fixture>>

const test = base.extend<object, { admin: APIRequestContext }>({
  admin: [
    async ({ local }, provide) => {
      const session = await local.login("ADMIN")
      try {
        await provide(session)
      } finally {
        await session.dispose()
      }
    },
    { scope: "worker" },
  ],
})

async function leaseFixture(
  local: LocalApp,
  page: Page,
  admin: APIRequestContext
) {
  const tag = randomUUID().slice(0, 8)
  const settings = await local.query<{ id: string; revision: number }>(
    admin,
    "settings"
  )
  const createLender = async (name: string, session = admin) =>
    (
      await local.command(
        session,
        "createFinanceCompany",
        envelope(
          {
            name,
            contacts: [
              {
                name: "Contact",
                phone: "0112345678",
                role: "Sales",
                primary: true,
              },
            ],
            policy: {
              path: "REFERRAL",
              commission: { basis: "FINANCED_PRINCIPAL", rateBps: 100 },
              processingFee: "0",
              reconciliationMethod: "PERIOD_NOTICE",
            },
          },
          [ref(settings, "Settings")]
        ),
        201
      )
    ).result
  const lender = await createLender(`Existing lender ${tag}`)
  const supplier = (
    await local.command(
      admin,
      "createDirectoryParty",
      envelope({
        type: "SUPPLIER",
        values: {
          name: `Supplier ${tag}`,
          category: "COMPANY",
          contacts: [],
        },
      }),
      201
    )
  ).result
  const purchase = (
    await local.command(
      admin,
      "recordPurchase",
      envelope(purchaseInput(supplier.id, tag, tag), [
        ref(supplier, "Supplier"),
      ]),
      201
    )
  ).result
  await local.command(
    admin,
    "receiveStock",
    envelope(
      {
        cycleId: purchase.id,
        date: "2026-10-02",
        disposition: { kind: "RELEASE" },
      },
      [ref(purchase)]
    )
  )
  const cycle = await local.query<PurchaseCycleDTO>(
    admin,
    "purchase",
    `?cycleId=${purchase.id}`
  )
  const buyer = (
    await local.command(
      admin,
      "createCustomer",
      envelope({
        fullName: `Buyer ${tag}`,
        callingName: "Buyer",
        nicOrPassport: tag,
        address: "Synthetic address",
        phone: "0771111123",
      }),
      201
    )
  ).result
  const customer = await local.query<CustomerDTO>(
    admin,
    "customer",
    `?id=${buyer.id}`
  )
  await page.context().addCookies((await admin.storageState()).cookies)
  return { cycle, customer, lender, settings, tag, createLender }
}

async function openDraft(page: Page) {
  await page.getByLabel("Sale Kind").selectOption("LEASE")
  await page.locator("#sale-price").fill("150")
  await page.locator("#sale-date").fill("2026-10-03")
  await page.locator("#sale-ref").fill("Lease reference")
  await page.getByLabel("Down payment").fill("20")
  await page.getByLabel("Term (months)").fill("12")
}

test("an open lease picker refreshes when focused in the same form", async ({
  local,
  page,
  admin,
}) => {
  const data = await leaseFixture(local, page, admin)
  const second = await local.login("SECOND")
  try {
    await page.goto(`${local.origin}/purchases/${data.cycle.id}`)
    await page
      .getByRole("button", { name: "Complete Immediate Sale", exact: true })
      .click()
    await openDraft(page)
    const picker = page.getByLabel("Finance company")
    await expect(picker).toContainText(`Existing lender ${data.tag}`)
    const lender = await data.createLender(`New lender ${data.tag}`, second)
    await picker.focus()
    await expect(picker.locator(`option[value="${lender.id}"]`)).toHaveCount(1)
    await expect(page.getByLabel("Down payment")).toHaveValue("20")
  } finally {
    await second.dispose()
  }
})

for (const surface of ["purchase", "dashboard"]) {
  test(`lease draft survives closing and reopening from ${surface}`, async ({
    local,
    page,
    admin,
  }) => {
    const data = await leaseFixture(local, page, admin)
    const dashboard = surface === "dashboard"
    await page.goto(
      local.origin + (dashboard ? "/dashboard" : `/purchases/${data.cycle.id}`)
    )
    const trigger = page.getByRole("button", {
      name: dashboard ? "New sale" : "Complete Immediate Sale",
      exact: true,
    })
    await trigger.click()
    if (dashboard)
      await page.getByLabel("Available Stock Cycle").selectOption(data.cycle.id)
    await openDraft(page)
    await page
      .getByLabel("Search customers", { exact: true })
      .fill(data.customer.fullName)
    await page.getByLabel("Buyer Customer").selectOption(data.customer.id)
    await page.getByLabel("Finance company").selectOption(data.lender.id)
    await page.getByRole("button", { name: "Close sale form" }).click()
    await trigger.click()
    await expect(page.getByLabel("Sale Kind")).toHaveValue("LEASE")
    await expect(page.getByLabel("Down payment")).toHaveValue("20")
    await expect(page.getByLabel("Term (months)")).toHaveValue("12")
    await expect(page.getByLabel("Finance company")).toHaveValue(data.lender.id)
    await expect(page.getByLabel("Buyer Customer")).toHaveValue(
      data.customer.id
    )
    await expect(page.locator("#sale-ref")).toHaveValue("Lease reference")
  })
}

test("lease detail links to the readable finance company, customer and source cycle", async ({
  local,
  page,
  admin,
  browser,
}) => {
  const data = await leaseFixture(local, page, admin)
  const sale = (
    await local.command(
      admin,
      "startFinance",
      envelope(
        {
          cycleId: data.cycle.id,
          customerId: data.customer.id,
          companyId: data.lender.id,
          price: "15000",
          financeAmount: "13000",
          termMonths: 12,
          downPayment: { amount: "2000", date: "2026-10-03", method: "CASH" },
        },
        [
          ref(data.cycle),
          ref(data.customer, "Customer"),
          ref(data.lender, "FinanceCompany"),
          ref(data.settings, "Settings"),
        ]
      )
    )
  ).result
  const href = `/third-parties/${data.lender.id}?type=FINANCE_COMPANY`
  const saleUrl = `${local.origin}/sales/${sale.id}`
  await page.goto(saleUrl)
  await expect(
    page.locator(`a[href="/customers/${data.customer.id}"]`)
  ).toBeVisible()
  await expect(
    page.locator(`a[href="/purchases/${data.cycle.id}"]`)
  ).toBeVisible()
  await page
    .getByRole("link", { name: `Existing lender ${data.tag}`, exact: true })
    .click()
  await expect(page).toHaveURL(local.origin + href)
  await expect(
    page.getByRole("heading", { name: `Existing lender ${data.tag}` })
  ).toBeVisible()

  const role = (
    await local.command(
      admin,
      "saveRole",
      envelope({
        name: `Sales viewer ${data.tag}`,
        reason: "Sales snapshot access only",
        grants: [
          {
            subject: "SaleCase",
            action: "read",
            fields: [
              "id",
              "cycleId",
              "customerId",
              "kind",
              "state",
              "finance.companyId",
              "finance.companyName",
              "finance.termMonths",
            ],
          },
        ],
      }),
      201
    )
  ).result
  const email = `lease-viewer-${data.tag}@example.test`
  const password = `Synthetic-${randomUUID()}`
  await local.command(
    admin,
    "createUser",
    envelope(
      {
        name: "Sales viewer",
        email,
        password,
        roleIds: [role.id],
      },
      [ref(role, "Role")]
    ),
    201
  )
  const limited = await browser.newContext({ viewport: page.viewportSize() })
  try {
    const response = await limited.request.post(
      local.origin + "/api/auth/sign-in/email",
      {
        headers: { Origin: local.origin },
        data: { email, password },
      }
    )
    expect(response.status()).toBe(200)
    const saleView = await limited.newPage()
    await saleView.bringToFront()
    await saleView.goto(saleUrl)
    await expect(
      saleView.getByRole("heading", { name: `Sale ${sale.id}` })
    ).toBeVisible()
    await expect(
      saleView.getByText(`Existing lender ${data.tag} · 12 months`)
    ).toBeVisible()
    await expect(saleView.locator(`a[href="${href}"]`)).toHaveCount(0)
    await expect(
      saleView.locator(`a[href="/customers/${data.customer.id}"]`)
    ).toHaveCount(0)
    await expect(
      saleView.locator(`a[href="/purchases/${data.cycle.id}"]`)
    ).toHaveCount(0)
    expect(
      (
        await limited.request.get(
          local.origin +
            `/api/v1/queries/party?type=FINANCE_COMPANY&id=${data.lender.id}`
        )
      ).status()
    ).toBe(404)
  } finally {
    await limited.close()
  }
})
