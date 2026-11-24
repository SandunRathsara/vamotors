/** Run against an isolated local:setup root and a production build.
 * Use prepare before migration and verify after migration for the populated upgrade.
 */
import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { chromium, request } from "@playwright/test"
import type {
  CustomerDTO,
  PurchaseCycleDTO,
  SaleDTO,
} from "../../.planning/implementation/contracts/api"
import { envelope, fixture, purchaseInput, ref } from "./cycle-edits-fixture"

const [root, mode = "fresh", source] = process.argv.slice(2)
assert.ok(root && ["fresh", "prepare", "verify"].includes(mode))
const f = await fixture(root, source)
const marker = join(root, "invoice-upgrade.json")
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex")

try {
  await f.start()
  const admin = await f.login("ADMIN")
  const staff = await f.login("STAFF")
  const issue = async (sale: SaleDTO, regenerate = false) => {
    const cycle = await f.query<PurchaseCycleDTO>(
      admin,
      "purchase",
      `?cycleId=${sale.cycleId}`
    )
    const pending = sale.invoices.find(
      (row) => row.saleRevision === sale.revision && row.state !== "READY"
    )
    return envelope(
      { saleId: sale.id, saleRevision: sale.revision, regenerate },
      [
        ref(sale, "SaleCase"),
        ref(cycle),
        ...(pending ? [ref(pending, "InvoiceVersion")] : []),
      ]
    )
  }
  const send = (body: Awaited<ReturnType<typeof issue>>) =>
    admin.post("/api/v1/commands/issueInvoice", {
      headers: { Origin: f.origin },
      data: body,
    })
  const details = (saleId: string) =>
    f.query<SaleDTO>(admin, "sale", `?id=${saleId}`)
  const url = (saleId: string, version: number) =>
    `/api/v1/sales/${saleId}/invoices/${version}`
  const text = (pdf: Buffer) =>
    execFileSync("pdftotext", ["-layout", "-", "-"], {
      input: pdf,
      encoding: "utf8",
    })
  async function bytes(saleId: string, version: number) {
    const response = await admin.get(url(saleId, version))
    assert.equal(response.status(), 200)
    assert.match(response.headers()["cache-control"], /no-store/)
    assert.equal(response.headers()["content-type"], "application/pdf")
    const pdf = await response.body()
    assert.match(
      execFileSync("pdfinfo", ["-"], { input: pdf, encoding: "utf8" }),
      /Page size:\s+595 x 842 pts \(A4\)/
    )
    return pdf
  }

  if (mode === "verify") {
    const before = JSON.parse(await readFile(marker, "utf8")) as {
      id: string
      rows: string
      invoices: string
      hash: string
    }
    assert.equal(
      await f.snapshot(["SaleCase", "SaleCompletion", "SaleReceipt"]),
      before.rows
    )
    assert.equal(await f.snapshot(["InvoiceVersion"]), before.invoices)
    assert.equal(sha(await bytes(before.id, 1)), before.hash)
    console.log(
      "PASS populated c2b19ed upgrade retained the invoice row and preserved identical PDF bytes."
    )
  } else {
    if (mode === "fresh" && process.env.VAMOTORS_TEST_CURRENCY) {
      const {
        id,
        revision,
        redactedFields: _redacted,
        policyVersion: _version,
        ...settings
      } = await f.query<
        import("../../.planning/implementation/contracts/api").SettingsInput & {
          id: string
          revision: number
          redactedFields: string[]
          policyVersion: number
        }
      >(admin, "settings")
      void _redacted
      void _version
      await f.command(
        admin,
        "updateSettings",
        envelope(
          {
            ...settings,
            currency: process.env.VAMOTORS_TEST_CURRENCY,
            reason: "Test configured output currency",
          },
          [ref({ id, revision }, "Settings")]
        )
      )
    }
    const suffix = randomUUID().slice(0, 8)
    const supplier = await f.command(
      admin,
      "createDirectoryParty",
      envelope({
        type: "SUPPLIER",
        values: {
          name: `Invoice supplier ${suffix}`,
          category: "COMPANY",
          contacts: [],
        },
      }),
      201
    )
    const customer = await f.command(
      admin,
      "createCustomer",
      envelope({
        fullName:
          mode === "fresh" ? "නිමල් පෙරේරා குமார்" : `Invoice buyer ${suffix}`,
        callingName: "Buyer",
        nicOrPassport: `TEST-${suffix}`,
        phone: "0771234567",
        address:
          "First line of the buyer address\nSecond line of the buyer address",
      }),
      201
    )
    const buyer = await f.query<CustomerDTO>(
      admin,
      "customer",
      `?id=${customer.result.id}`
    )
    async function stock(tag: string) {
      const purchase = await f.command(
        admin,
        "recordPurchase",
        envelope(purchaseInput(supplier.result.id, suffix, tag, 100), [
          ref(supplier.result, "Supplier"),
        ]),
        201
      )
      const current = () =>
        f.query<PurchaseCycleDTO>(
          admin,
          "purchase",
          `?cycleId=${purchase.result.id}`
        )
      await f.command(
        admin,
        "receiveStock",
        envelope(
          {
            cycleId: purchase.result.id,
            date: "2026-10-02",
            disposition: { kind: "RELEASE" },
          },
          [ref(await current())]
        )
      )
      return current()
    }
    const cashCycle = await stock("invoice-cash")
    const cash = await f.command(
      admin,
      "completeImmediate",
      envelope(
        {
          cycleId: cashCycle.id,
          customerId: buyer.id,
          kind: "CASH",
          method: "BANK_TRANSFER",
          date: "2026-10-04",
          mileage: 340,
          price: "16000",
          reference: "TRANSFER-123",
        },
        [ref(cashCycle), ref(buyer, "Customer")]
      ),
      201
    )
    if (mode === "prepare") {
      const sale = await details(cash.result.id)
      const response = await send(await issue(sale))
      assert.equal(response.status(), 200, await response.text())
      await writeFile(
        marker,
        JSON.stringify({
          id: cash.result.id,
          hash: sha(await bytes(sale.id, 1)),
          invoices: await f.snapshot(["InvoiceVersion"]),
          rows: await f.snapshot(["SaleCase", "SaleCompletion", "SaleReceipt"]),
        }),
        { mode: 0o600 }
      )
      console.log("Populated upgrade baseline recorded.")
    } else {
      const cashSale = await details(cash.result.id)
      assert.equal(
        cashSale.invoices[0]?.state,
        "PENDING",
        "completion must queue a snapshot"
      )
      const cashFacts = async () => ({
        sale: await f.snapshot(["SaleCase", "SaleCompletion", "SaleReceipt"]),
        movements: (
          await f.db.query(
            'SELECT * FROM vamotors."CashMovement" WHERE "sourceId"=$1 ORDER BY "paymentId"',
            [cashSale.id]
          )
        ).rows,
      })
      const purchaseFacts = await cashFacts()
      const policyPath = f.runtime.PRIVATE_FILES_POLICY!
      const policy = await readFile(policyPath, "utf8")
      const command = await issue(cashSale)
      try {
        await writeFile(
          policyPath,
          JSON.stringify({ ...JSON.parse(policy), allowWrites: false })
        )
        const blocked = await send(command)
        assert.equal(blocked.status(), 202, await blocked.text())
        assert.equal((await details(cashSale.id)).invoices[0].state, "FAILED")
      } finally {
        await writeFile(policyPath, policy)
      }
      const started = performance.now()
      const replays = await Promise.all([send(command), send(command)])
      for (const response of replays)
        assert.equal(response.status(), 200, await response.text())
      const elapsed = Math.round(performance.now() - started)
      assert.ok(elapsed < 10000, `Generating the PDF took ${elapsed}ms`)
      assert.equal((await details(cashSale.id)).invoices.length, 1)
      assert.deepEqual(await cashFacts(), purchaseFacts)
      const file = await bytes(cashSale.id, 1)
      const cashPdf = text(file)
      assert.match(cashPdf, /නිමල් පෙරේරා குமார்/u)
      execFileSync(
        "pdftoppm",
        [
          "-f",
          "1",
          "-l",
          "1",
          "-r",
          "120",
          "-png",
          "-",
          join(root, "unicode-invoice"),
        ],
        { input: file }
      )
      console.log(
        `PASS rendered and extracted Sinhala and Tamil from the invoice in ${elapsed}ms`
      )
      for (const fact of [
        "Bank Transfer",
        "TRANSFER-123",
        "340 km",
        "2026-10-04",
        "Second line of the buyer address",
        buyer.nicOrPassport,
        "VIN-invoice-cash",
        "CR-invoice-cash",
        "encumbrances",
        "ownership",
        "upon handover",
        "Buyer / Customer Signature",
        "Seller / Authorized Signatory",
        "DEV / DRAFT",
        "Synthetic Administrator A",
        `${process.env.VAMOTORS_TEST_CURRENCY ?? "LKR"} 160.00`,
      ]) {
        assert.ok(cashPdf.includes(fact), `Missing PDF text: ${fact}`)
      }
      assert.equal((await staff.get(url(cashSale.id, 1))).status(), 404)
      const issued = (await details(cashSale.id)).invoices[0]
      await assert.rejects(
        f.restricted.query(
          'UPDATE vamotors."InvoiceVersion" SET snapshot=$2::jsonb WHERE id=$1',
          [issued.id, "{}"]
        )
      )
      await assert.rejects(
        f.db.query(
          'UPDATE vamotors."InvoiceVersion" SET revision=revision+1 WHERE id=$1',
          [issued.id]
        ),
        /IMMUTABLE_INVOICE_VERSION/
      )
      await assert.rejects(
        f.db.query('DELETE FROM vamotors."InvoiceVersion" WHERE id=$1', [
          issued.id,
        ])
      )
      const anonymous = await request.newContext({ baseURL: f.origin })
      try {
        assert.equal((await anonymous.get(url(cashSale.id, 1))).status(), 401)
      } finally {
        await anonymous.dispose()
      }

      const tradeCycle = await stock("invoice-trade")
      const second = await f.login("SECOND")
      const browser = await chromium.launch({
        executablePath: process.env.VAMOTORS_CHROMIUM_EXECUTABLE,
      })
      try {
        const page = await browser.newPage({
          storageState: await admin.storageState(),
        })
        page.setDefaultTimeout(15000)
        await page.goto(`${f.origin}/sales`)
        await page
          .getByRole("button", { name: "Complete Immediate Sale", exact: true })
          .click()
        await page.locator("#sale-cycle").selectOption(tradeCycle.id)
        await page.locator("#sale-customer").selectOption(buyer.id)
        await page.locator("#sale-kind").selectOption("TRADE_IN")
        await page.locator("#sale-price").fill("150")
        await page.locator("#sale-date").fill("2026-10-05")
        await page.locator("#sale-mileage").fill("350")
        await page.locator("#sale-ref").fill(`TRADE-${suffix}`)
        await page
          .getByPlaceholder("Trade-in vehicle description *")
          .fill("Synthetic trade-in")
        await page.getByPlaceholder("Trade-in valuation (Major) *").fill("50")
        await page.locator("form button[type=submit]").click()
        await page
          .getByRole("link", { name: "Open completed sale detail" })
          .click()
        await page.waitForURL(/\/sales\/[a-f0-9-]+$/)
        const saleId = new URL(page.url()).pathname.split("/").at(-1)!
        const download = async (version: number) => {
          const [file] = await Promise.all([
            page.waitForEvent("download"),
            page
              .getByRole("link", {
                name: `Download version ${version}`,
                exact: true,
              })
              .click(),
          ])
          return readFile((await file.path())!)
        }
        const uiStart = performance.now()
        await page.getByRole("button", { name: "Generate invoice" }).click()
        await page
          .getByRole("link", { name: "Download version 1", exact: true })
          .waitFor()
        const uiElapsed = Math.round(performance.now() - uiStart)
        assert.ok(
          uiElapsed < 10000,
          `Generating the browser invoice took ${uiElapsed}ms`
        )
        const first = await download(1)
        assert.match(text(first), /Synthetic trade-in/)
        assert.match(text(first), /Trade-In Consideration \(Non-Cash\)/)
        const flow = await f.query<{
          currency: string
          data: { sourceId: string; amount: string }[]
          nonCashOffsets: { sourceId: string; amount: string }[]
        }>(
          admin,
          "report",
          "?kind=CASH_FLOW&from=2026-10-05&through=2026-10-05"
        )
        assert.equal(flow.currency, process.env.VAMOTORS_TEST_CURRENCY ?? "LKR")
        assert.equal(
          flow.data.find(({ sourceId }) => sourceId === saleId)?.amount,
          "10000"
        )
        assert.equal(
          flow.nonCashOffsets.find(({ sourceId }) => sourceId === saleId)
            ?.amount,
          "5000"
        )
        assert.match(text(first), /Net Cash \/ Transfer Balance/)
        await page
          .getByRole("button", { name: "Request Sale Edit Approval" })
          .click()
        await page.locator("#edit-ref").fill("CORRECTED-REFERENCE")
        await page.locator("#edit-mileage").fill("360")
        await page.locator("#edit-reason").fill("Correct handover details")
        await page
          .getByRole("button", { name: "Submit Sale Edit Approval" })
          .click()
        const pendingLink = page.getByRole("link", {
          name: "Open sale edit approval request",
        })
        const href = await pendingLink.getAttribute("href")
        assert.ok(href)
        const reviewer = await browser.newPage({
          storageState: await second.storageState(),
        })
        reviewer.setDefaultTimeout(15000)
        await reviewer.goto(`${f.origin}${href}`)
        await reviewer.getByRole("button", { name: "Commit review" }).click()
        await reviewer.getByText(/Review committed once/).waitFor()
        await page.reload()
        await page.getByRole("button", { name: "Regenerate invoice" }).click()
        const secondPdf = await download(2)
        assert.match(text(secondPdf), /CORRECTED-REFERENCE/)
        assert.match(text(secondPdf), /360 km/)
        assert.match(text(secondPdf), /Approved sale\s+correction/)
        assert.notEqual(sha(secondPdf), sha(first))
        assert.equal(sha(await download(1)), sha(first))
        assert.equal(sha(await bytes(saleId, 2)), sha(secondPdf))
        await f.restart()
        const restarted = await f.login("ADMIN")
        assert.equal(
          sha(await (await restarted.get(url(saleId, 1))).body()),
          sha(first)
        )
        assert.equal(
          sha(await (await restarted.get(url(saleId, 2))).body()),
          sha(secondPdf)
        )
        await restarted.dispose()
        console.log(
          `Chromium trade-in sale, approval, regeneration and restart hashes passed. Cash retry ${elapsed}ms, browser generation ${uiElapsed}ms.`
        )
      } finally {
        await browser.close()
        await second.dispose()
      }
    }
    await admin.dispose()
    await staff.dispose()
  }
} finally {
  await f.close()
}
