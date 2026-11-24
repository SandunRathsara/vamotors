/** Run against a dedicated local PG root and a production build. */
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { chromium, expect, type Page } from "@playwright/test"
import type {
  Applied,
  Dependency,
  PurchaseCycleDTO,
  Settlement,
} from "../../.planning/implementation/contracts/api"
import {
  envelope,
  fixture,
  purchaseInput,
  ref,
  refs,
} from "./cycle-edits-fixture"

const [root, selected] = process.argv.slice(2)
assert.ok(root)
const f = await fixture(root)
const browser = await chromium.launch()
const suffix = randomUUID().slice(0, 8)
const supplierName = `T18 supplier ${suffix}`
const companyName = `T18 finance ${suffix}`
const baseDate = "2026-10-01"

try {
  await f.start()
  const admin = await f.login("ADMIN")
  try {
    const context = await browser.newContext({
      baseURL: f.origin,
      storageState: await admin.storageState(),
      viewport: { width: 360, height: 900 },
      serviceWorkers: "block",
    })
    const page = await context.newPage()
    const button = (name: string, p: Page = page) =>
      p.getByRole("button", { name, exact: true })
    const submit = async (command: string, label: string, status = 200) => {
      const response = page.waitForResponse(
        (r) =>
          r.url().endsWith(`/api/v1/commands/${command}`) &&
          r.request().method() === "POST"
      )
      await page
        .locator("form")
        .getByRole("button", { name: label, exact: true })
        .click()
      const r = await response
      const result = await r.json()
      assert.equal(r.status(), status, `${command}: ${JSON.stringify(result)}`)
      return { result: result as Applied, body: r.request().postDataJSON() }
    }
    const cmd = (
      name: string,
      input: unknown,
      expected: Dependency[] = [],
      status = 200
    ) => f.command(admin, name, envelope(input, expected), status)
    const supplier = (
      await cmd(
        "createDirectoryParty",
        {
          type: "SUPPLIER",
          values: { name: supplierName, category: "COMPANY", contacts: [] },
        },
        [],
        201
      )
    ).result
    const current = (id: string) =>
      f.query<PurchaseCycleDTO>(admin, "purchase", `?cycleId=${id}`)
    const inputFor = (tag: string) =>
      purchaseInput(supplier.id, suffix, tag, 100)
    const acquire = async (tag: string) =>
      current(
        (
          await cmd(
            "recordPurchase",
            inputFor(tag),
            [ref(supplier, "Supplier")],
            201
          )
        ).result.id
      )
    const receive = async (row: PurchaseCycleDTO, kind: "RELEASE" | "HOLD") => {
      await cmd(
        "receiveStock",
        {
          cycleId: row.id,
          date: baseDate,
          disposition:
            kind === "HOLD" ? { kind, reason: "Awaiting checks" } : { kind },
        },
        [ref(row)]
      )
      return current(row.id)
    }

    const checks = {
      async settlement() {
        const settings = await f.query<{ id: string; revision: number }>(
          admin,
          "settings"
        )
        const company = (
          await cmd(
            "createFinanceCompany",
            {
              name: companyName,
              contacts: [
                {
                  name: "Finance contact",
                  phone: "0112345678",
                  role: "Settlement",
                  primary: true,
                },
              ],
              policy: {
                path: "APPLICATION",
                commission: { basis: "FIXED", fixed: "1", rateBps: 0 },
                processingFee: "0",
                reconciliationMethod: "PER_DEAL",
              },
            },
            [ref(settings, "Settings")],
            201
          )
        ).result
        const amounts = {
          amount: "6025",
          cashToSeller: "4075",
          reference: "T18 settlement",
        }
        const terms: Settlement[] = [
          { ...amounts, institutionType: "BANK", institutionName: "T18 bank" },
          {
            ...amounts,
            institutionType: "FINANCE_COMPANY",
            companyId: company.id,
          },
          {
            ...amounts,
            institutionType: "PRIVATE_PARTY",
            institutionName: "T18 private party",
          },
        ]
        const transitions = terms.flatMap((original, i) => [
          { original, corrected: terms[(i + 1) % terms.length], browser: true },
          {
            original,
            corrected: terms[(i + 2) % terms.length],
            browser: false,
          },
        ])
        for (const { original, corrected, browser } of transitions) {
          const { purchasePrice: unused, ...input } = inputFor(
            `${original.institutionType}-${corrected.institutionType}`
          )
          void unused
          const created = await cmd(
            "recordPurchase",
            {
              ...input,
              purchaseType: "LEASE_SETTLEMENT",
              settlement: original,
            },
            [
              ref(supplier, "Supplier"),
              ...(original.institutionType === "FINANCE_COMPANY"
                ? [ref(company, "FinanceCompany")]
                : []),
            ],
            201
          )
          const before = await current(created.result.id)
          const originalPayment = before.payments.find(
            (p) => p.category === "SETTLEMENT"
          )!
          const { result, body } = await (async () => {
            if (!browser) {
              const body = envelope(
                {
                  cycleId: before.id,
                  reason: "Correct the institution",
                  patch: { settlement: corrected },
                  cashCorrections: [
                    {
                      paymentId: originalPayment.id,
                      reason: "Reverse payment to original institution",
                    },
                  ],
                },
                [
                  ...refs(before, "addMileage"),
                  ...(corrected.institutionType === "FINANCE_COMPANY"
                    ? [ref(company, "FinanceCompany")]
                    : []),
                ]
              )
              const result = await f.command(admin, "editPurchase", body)
              return { result, body }
            }
            await page.goto(`/purchases/${before.id}`)
            await button("Correct purchase terms").click()
            await page.getByLabel("Correct full settlement terms").check()
            await page
              .getByLabel("Settlement institution type")
              .selectOption(corrected.institutionType)
            if (corrected.institutionType === "FINANCE_COMPANY") {
              await page
                .getByLabel("Search active finance companies")
                .fill(companyName)
              await page
                .getByLabel("Settlement finance company")
                .selectOption(company.id)
            } else {
              await page
                .getByLabel("Settlement institution name")
                .fill(corrected.institutionName)
            }
            await page
              .getByLabel("Mandatory correction reason")
              .fill("Correct the institution")
            await page.getByLabel(/Reverse SETTLEMENT recorded 60.25/).check()
            await page
              .getByLabel("Payment correction reason")
              .fill("Reverse payment to original institution")
            return submit("editPurchase", "Confirm cycle money change")
          })()
          const after = await current(before.id)
          assert.equal(
            after.settlement?.institutionType,
            corrected.institutionType
          )
          assert.equal(
            after.settlement?.institutionNameSnapshot,
            corrected.institutionType === "FINANCE_COMPANY"
              ? companyName
              : corrected.institutionName
          )
          assert.deepEqual(after.outstanding, {
            seller: "0",
            settlement: "6025",
          })
          assert.equal(after.financial?.basis, "10100")
          assert.equal(after.financial?.cashOut, "10100")
          assert.equal(after.financial?.cashIn, "6025")
          assert.equal(after.financial?.net, "-4075")
          assert.equal(after.basisVersions.length, before.basisVersions.length)
          const reversals = after.payments.filter(
            (p) => p.reversalOf === originalPayment.id
          )
          assert.equal(reversals.length, 1)
          assert.equal(reversals[0].amount, "6025")
          assert.equal(reversals[0].direction, "IN")
          const replay = await f.command(admin, "editPurchase", body)
          assert.equal(replay.commandId, result.commandId)
          assert.equal(replay.replayed, true)
          assert.deepEqual(await current(before.id), after)
        }
      },
      async revision() {
        const held = await receive(await acquire("stock"), "HOLD")
        await page.goto(`/purchases/${held.id}`)
        await button("Release stock").click()
        let release!: () => void
        const gate = new Promise<void>((resolve) => {
          release = resolve
        })
        const path = `**/api/v1/queries/purchase?cycleId=${held.id}`
        const refetch = page.waitForRequest(path)
        await page.route(path, async (route) => {
          await gate
          await route.continue()
        })
        const price = button("Set asking price")
        try {
          await submit("releaseStock", "Confirm release stock")
          await refetch
          await expect(price).toBeDisabled({ timeout: 2000 })
        } finally {
          release()
        }
        await price.click()
        await page.getByLabel("Asking price (major units)").fill("170.00")
        await page
          .getByLabel("Asking price reason")
          .fill("Price released stock")
        const { body } = await submit("setListedPrice", "Confirm cycle edit")
        assert.equal(body.expected[0].revision, held.revision + 1)
        assert.equal((await current(held.id)).listedPrice, "17000")
      },
      async mileage() {
        const input = inputFor("repurchase")
        const first = await receive(await acquire("repurchase"), "RELEASE")
        const customer = (
          await cmd(
            "createCustomer",
            {
              fullName: `T18 customer ${suffix}`,
              callingName: "T18",
              nicOrPassport: `T18-${suffix}`,
              address: "Synthetic address",
              phone: "0112345678",
            },
            [],
            201
          )
        ).result
        await cmd(
          "completeImmediate",
          {
            cycleId: first.id,
            customerId: customer.id,
            kind: "CASH",
            price: "15000",
            date: "2026-10-02",
            mileage: 100,
            method: "CASH",
          },
          [ref(first), ref(customer, "Customer")],
          201
        )
        await page.goto("/purchases")
        await button("New paid acquisition").click()
        await page
          .getByLabel("Search active suppliers by name")
          .fill(supplierName)
        await page
          .getByLabel("Supplier *", { exact: true })
          .selectOption(supplier.id)
        for (const [key, value] of Object.entries(input.vehicle)) {
          if (key !== "fuelType" && key !== "transmission")
            await page.locator(`#acquisition-${key}`).fill(String(value))
        }
        await page.locator("#acquisition-purchaseDate").fill("2026-10-03")
        await page.locator("#acquisition-mileageDate").fill("2026-10-03")
        await page.locator("#acquisition-purchasePrice").fill("100")
        const reading = page.locator("#acquisition-mileage")
        const reason = page.getByLabel("Reason for a mileage decrease")
        await reading.fill("80")
        await expect(reason).toBeVisible({ timeout: 5000 })
        await reading.fill("100")
        await expect(reason).toBeHidden()
        await reading.fill("80")
        await reason.fill("Odometer replaced at 80 km")
        const { result, body } = await submit(
          "recordPurchase",
          "Record fully paid acquisition",
          201
        )
        assert.equal(
          body.input.mileage.decreaseReason,
          "Odometer replaced at 80 km"
        )
        const row = await current(result.result.id)
        assert.equal(row.vehicleId, first.vehicleId)
        assert.equal(row.cycleNumber, 2)
        assert.equal(
          row.mileage[0].decreaseReason,
          "Odometer replaced at 80 km"
        )
        await page.goto(`/purchases/${row.id}`)
        await button("Append mileage").click()
        await page.getByLabel("Actual mileage date").fill("2026-10-04")
        await page.getByLabel("Actual mileage reading").fill("90")
        await expect(reason).toBeHidden()
        await page.getByLabel("Actual mileage reading").fill("70")
        await expect(reason).toBeVisible()
        await reason.fill("Documented second odometer change")
        await submit("addMileage", "Confirm cycle edit")
        assert.equal((await current(row.id)).mileage.at(-1)?.reading, 70)
      },
      async conversion() {
        const row = await receive(await acquire("conversion"), "RELEASE")
        const customer = (
          await cmd(
            "createCustomer",
            {
              fullName: `T18 conversion ${suffix}`,
              callingName: "T18",
              nicOrPassport: `T18-conv-${suffix}`,
              address: "Synthetic address",
              phone: "0112345678",
            },
            [],
            201
          )
        ).result
        const settings = await f.query<{ id: string; revision: number }>(
          admin,
          "settings"
        )
        const sale = (
          await cmd(
            "placeReservation",
            {
              cycleId: row.id,
              customerId: customer.id,
              price: "15000",
              receipt: {
                amount: "5000",
                method: "CASH",
                date: new Intl.DateTimeFormat("en-CA", {
                  timeZone: "Asia/Colombo",
                }).format(new Date()),
              },
            },
            [ref(row), ref(customer, "Customer"), ref(settings, "Settings")]
          )
        ).result
        await page.goto(`/sales/${sale.id}`)
        await button("Complete cash conversion").click()
        const reading = page.getByLabel("Handover mileage (km)")
        const reason = page.getByLabel("Reason for a mileage decrease")
        await expect(reason).toBeHidden()
        await reading.fill("85")
        await expect(reason).toBeVisible()
        await reason.fill("Replacement odometer verified at handover")
        const { body } = await submit(
          "convertReservation",
          "Complete cash conversion"
        )
        assert.equal(
          body.input.reason,
          "Replacement odometer verified at handover"
        )
        assert.equal(
          (await current(row.id)).mileage.at(-1)?.decreaseReason,
          body.input.reason
        )
      },
      async copy() {
        await page.goto("/purchases")
        await button("New paid acquisition").click()
        const acquisition = page.getByRole("region", {
          name: "New acquisition",
        })
        await expect(acquisition.getByRole("heading")).toBeVisible()
        await expect(acquisition).not.toContainText(
          /remain pending|in this slice/
        )
        const row = await acquire("copy")
        await page.goto(`/purchases/${row.id}`)
        await expect(
          page.getByRole("heading", { name: "Purchase detail" })
        ).toBeVisible()
        await expect(
          page.getByRole("button", { name: "Correct purchase terms" })
        ).toBeVisible()
        await expect(page.getByText(/remain pending/)).toHaveCount(0)
        await page.goto("/third-parties")
        await expect(
          page.getByRole("heading", { name: "Third parties" })
        ).toBeVisible()
        await expect(page.getByText(/histories remain pending/)).toHaveCount(0)
      },
    }
    assert.ok(!selected || Object.hasOwn(checks, selected))
    const failures = []
    for (const [name, run] of Object.entries(checks)) {
      if (selected && selected !== name) continue
      try {
        await run()
        console.log(`PASS ${name}`)
      } catch (error) {
        console.error(`FAIL ${name}`, error)
        failures.push(name)
      }
    }
    assert.deepEqual(failures, [])
  } finally {
    await admin.dispose()
  }
} finally {
  await browser.close()
  await f.close()
}
