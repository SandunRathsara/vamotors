/** Seed and exercise reconciliation through production HTTP against isolated PostgreSQL. */
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { chromium, expect } from "@playwright/test"
import type {
  BrokerageDTO,
  ApprovalDTO,
  Pending,
  Dependency,
  PartyDTO,
  ReportResponse,
  SaleDTO,
  UploadReady,
} from "../../.planning/implementation/contracts/api"
import type {
  reconciliationView,
  reconciliationRead,
} from "../../lib/server/reconciliation"
import { envelope, fixture, purchaseInput, ref } from "./cycle-edits-fixture"

const [root, mode = "fresh", source] = process.argv.slice(2)
assert.ok(root && ["prepare", "upgrade", "fresh"].includes(mode))
const f = await fixture(root, source)
const suffix = randomUUID().slice(0, 8)
const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Colombo",
}).format()
const priorDate = new Date(+new Date(today) - 3 * 86400000)
  .toISOString()
  .slice(0, 10)
const mark = join(root, "t13-mixed-sources.json")
const evidence = await readFile("public/pwa-icon-192.png")
type View = Awaited<ReturnType<typeof reconciliationView>>
type Detail = Extract<
  Awaited<ReturnType<typeof reconciliationRead>>,
  { receipt: unknown }
>
type Entitlement = Extract<
  Awaited<ReturnType<typeof reconciliationRead>>,
  { entitlementId: string }
>
type Source = {
  companyId: string
  saleId: string
  dealId: string
  olderDate: string
  directReference: string
}

try {
  await f.start()
  const admin = await f.login("ADMIN")
  const cmd = (
    name: string,
    input: unknown,
    expected: Dependency[] = [],
    status = 200
  ) => f.command(admin, name, envelope(input, expected), status)
  const get = <T>(name: string, params = "") => f.query<T>(admin, name, params)
  async function upload(
    type: "SALE_CASE" | "REMITTANCE",
    owner: Dependency,
    purpose: string
  ) {
    const init = await admin.post("/api/v1/commands/initUpload", {
      headers: { Origin: f.origin },
      data: envelope(
        {
          target: { type, id: owner.id },
          purpose,
          filename: "bank-evidence.png",
          contentType: "image/png",
          size: evidence.length,
          sha256: createHash("sha256").update(evidence).digest("hex"),
        },
        [owner]
      ),
    })
    assert.equal(init.status(), 201, await init.text())
    const ready = (await init.json()) as UploadReady
    const written = await admin.put(ready.putUrl, {
      headers: { Origin: f.origin, ...ready.requiredHeaders },
      data: evidence,
    })
    assert.ok(written.ok(), await written.text())
    return (
      await cmd("completeUpload", { uploadId: ready.uploadId }, [
        owner,
        { type: "UploadIntent", id: ready.uploadId, revision: ready.revision },
      ])
    ).result.id
  }
  const sale = (id: string) => get<SaleDTO>("sale", `?id=${id}`)

  async function seed(): Promise<Source> {
    const label = `T13-${suffix}`
    const settings = ref(
      await get<{ id: string; revision: number }>("settings"),
      "Settings"
    )
    const supplier = await cmd(
      "createDirectoryParty",
      {
        type: "SUPPLIER",
        values: {
          name: `${label} supplier`,
          category: "COMPANY",
          contacts: [],
        },
      },
      [],
      201
    )
    const contact = {
      name: "Finance contact",
      phone: "0112345678",
      role: "Processing",
      primary: true,
    }
    const company = (
      await cmd(
        "createFinanceCompany",
        {
          name: label,
          contacts: [contact],
          policy: {
            path: "REFERRAL",
            commission: { basis: "FINANCED_PRINCIPAL", rateBps: 100 },
            processingFee: "250000",
            reconciliationMethod: "PERIOD_NOTICE",
          },
        },
        [settings],
        201
      )
    ).result
    const companyRef = ref(company, "FinanceCompany")
    const contactId = (
      await f.db.query<{ id: string }>(
        'SELECT id FROM vamotors."FinanceContact" WHERE "companyId"=$1',
        [company.id]
      )
    ).rows[0].id
    const buyer = (
      await cmd(
        "createCustomer",
        {
          fullName: `${label} buyer`,
          callingName: label,
          nicOrPassport: label,
          address: "Synthetic address",
          phone: "0771234567",
        },
        [],
        201
      )
    ).result
    const customer = ref(buyer, "Customer")
    const acquired = (
      await cmd(
        "recordPurchase",
        {
          ...purchaseInput(supplier.result.id, suffix, "finance", 1000),
          listedPrice: "100000",
        },
        [ref(supplier.result, "Supplier")],
        201
      )
    ).result
    const stock = (
      await cmd(
        "receiveStock",
        {
          cycleId: acquired.id,
          date: "2026-10-02",
          disposition: { kind: "RELEASE" },
        },
        [ref(acquired)]
      )
    ).result
    const opened = (
      await cmd(
        "startFinance",
        {
          cycleId: stock.id,
          customerId: buyer.id,
          companyId: company.id,
          price: "100000",
          financeAmount: "80000",
          termMonths: 12,
          downPayment: {
            amount: "20000",
            date: priorDate,
            method: "BANK_TRANSFER",
          },
        },
        [ref(stock), customer, settings, companyRef]
      )
    ).result
    const sourceRefs = async () => {
      const row = await sale(opened.id)
      return [
        ref(row, "SaleCase"),
        ref(
          await get<{ id: string; revision: number }>(
            "purchase",
            `?cycleId=${row.cycleId}`
          )
        ),
      ]
    }
    const attachmentId = await upload(
      "SALE_CASE",
      ref(await sale(opened.id), "SaleCase"),
      "DO"
    )
    await cmd(
      "recordDO",
      { saleCaseId: opened.id, attachmentId, issueDate: priorDate },
      await sourceRefs()
    )
    await cmd(
      "confirmDOAndHandover",
      { saleCaseId: opened.id, date: priorDate, mileage: 1000 },
      await sourceRefs()
    )
    const directReference = `T13 independent ${suffix}`
    await cmd(
      "recordLenderReceipt",
      {
        saleCaseId: opened.id,
        payment: {
          amount: "5000",
          date: priorDate,
          method: "BANK_TRANSFER",
          reference: directReference,
        },
      },
      await sourceRefs()
    )
    const vehicle = { make: "Broker", model: label, year: 2026 }
    const sheet = (
      await cmd(
        "publishRates",
        {
          companyId: company.id,
          ...vehicle,
          validFrom: "2026-01-01",
          validThrough: "2099-12-31",
          maximum: "100000",
          cards: [{ principal: "100000", months: 12, installment: "10000" }],
        },
        [companyRef],
        201
      )
    ).result
    const card = (
      await f.db.query<{ id: string }>(
        'SELECT id FROM vamotors."RateCardEntry" WHERE "sheetVersionId"=$1',
        [sheet.id]
      )
    ).rows[0]
    const quote = (
      await cmd(
        "selectQuote",
        {
          sheetId: sheet.id,
          cardId: card.id,
          vehicle: { ...vehicle, description: "External brokerage vehicle" },
          charges: [],
        },
        [ref(sheet, "RateSheet"), companyRef, settings],
        201
      )
    ).result
    const deal = (
      await cmd(
        "openBrokerage",
        {
          customerId: buyer.id,
          quoteId: quote.id,
          guarantors: [
            {
              name: "Synthetic guarantor",
              identity: `G-${label}`,
              address: "Synthetic address",
              phone: "0771234568",
            },
          ],
        },
        [customer, ref(quote, "Quote"), companyRef, settings],
        201
      )
    ).result
    const detail = () => get<BrokerageDTO>("brokerageDeal", `?id=${deal.id}`)
    const checkedAt = `${priorDate}T09:00:00.000Z`
    for (const target of ["CUSTOMER", "GUARANTOR"] as const) {
      const current = await detail()
      await cmd(
        "recordEligibility",
        {
          dealId: deal.id,
          target,
          outcome: "CONFIRMED",
          contactId,
          checkedAt,
          feedback: "Verified",
          ...(target === "GUARANTOR"
            ? { guarantorId: current.guarantors![0].id }
            : {}),
        },
        [ref(current, "BrokerageDeal"), companyRef]
      )
    }
    await cmd(
      "referDeal",
      {
        dealId: deal.id,
        contactId,
        referredAt: checkedAt,
        sentContact: { name: label, phone: "0771234567" },
        feedback: "Referred",
      },
      [ref(await detail(), "BrokerageDeal"), companyRef]
    )
    return {
      companyId: company.id,
      saleId: opened.id,
      dealId: deal.id,
      olderDate: priorDate,
      directReference,
    }
  }

  if (mode === "prepare") {
    assert.equal(
      (await admin.get("/api/v1/queries/reconciliationCompanies")).status(),
      404,
      "Missing directory before T13"
    )
    const ids = await seed()
    await writeFile(mark, JSON.stringify(ids), { mode: 0o600 })
    console.log("PASS populated pre-reconciliation lease and referral sources")
  } else {
    const ids =
      mode === "fresh"
        ? await seed()
        : (JSON.parse(await readFile(mark, "utf8")) as Source)
    const { companyId, saleId, dealId } = ids
    const live = () =>
      get<View>("reconciliation", `?companyId=${companyId}&asOfDate=${today}`)
    const remittance = (id: string) => get<Detail>("remittance", `?id=${id}`)
    const items = (view: View) => {
      assert.equal(view.data.length, 2)
      const vehicle = view.data.find((item) => item.sourceId === saleId)!
      const brokerage = view.data.find((item) => item.sourceId === dealId)!
      assert.equal(vehicle.source, "VEHICLE_SALE")
      assert.equal(brokerage.source, "BROKERAGE")
      return { vehicle, brokerage }
    }
    const owner = (row: View["data"][number]) =>
      ref(
        { id: row.entitlementId, revision: row.revision },
        "CommissionEntitlement"
      )
    const initial = items(await live())
    assert.equal(initial.vehicle.principal, "80000")
    assert.equal(initial.vehicle.commission, "800")
    assert.equal(initial.vehicle.directReceipts, "5000")
    assert.equal(initial.vehicle.outstanding, "75800")
    assert.equal(initial.brokerage.outstanding, "1000")
    assert.ok(initial.vehicle.overdue && initial.brokerage.overdue)
    const directCash = await get<ReportResponse>(
      "report",
      `?kind=CASH_FLOW&from=${ids.olderDate}&through=${ids.olderDate}&pageSize=100`
    )
    assert.equal(
      directCash.data.filter(
        (row) =>
          "sourceId" in row &&
          row.sourceId === saleId &&
          "category" in row &&
          row.category === "LENDER" &&
          row.amount === "5000"
      ).length,
      1
    )
    if (mode === "upgrade")
      console.log(
        "PASS migrated preexisting entitlements and lender receipts exactly once"
      )
    const directDraft = (
      await cmd(
        "stageRemittance",
        { companyId, reference: ids.directReference },
        [(await live()).company],
        201
      )
    ).result
    await cmd(
      "recordRemittance",
      {
        companyId,
        draftId: directDraft.id,
        payment: {
          amount: "5000",
          date: ids.olderDate,
          method: "BANK_TRANSFER",
          reference: ids.directReference,
        },
        lines: [],
      },
      [(await live()).company, ref(directDraft, "Remittance")],
      409
    )
    const staff = await f.login("STAFF")
    assert.equal(
      (await staff.get("/api/v1/queries/reconciliationCompanies")).status(),
      403
    )
    assert.equal(
      (
        await staff.get(`/api/v1/queries/reconciliation?companyId=${companyId}`)
      ).status(),
      404
    )
    const deniedPage = await staff.get("/lease-reconciliation")
    assert.ok([200, 404].includes(deniedPage.status()))
    assert.ok(
      (await deniedPage.text()).includes("NEXT_HTTP_ERROR_FALLBACK;404"),
      "Finance page denied"
    )

    const client = await chromium.launch({
      executablePath: process.env.VAMOTORS_CHROMIUM_EXECUTABLE,
    })
    try {
      const context = await client.newContext({
        storageState: await admin.storageState(),
        viewport: { width: 1320, height: 900 },
      })
      const page = await context.newPage()
      await page.goto(`${f.origin}/dashboard`)
      await page
        .getByRole("link", { name: "Reconciliation", exact: true })
        .click()
      await page.getByLabel("Finance company").selectOption(companyId)
      await expect(
        page.getByRole("heading", { name: "Entitlements" })
      ).toBeVisible()
      await expect(
        page.getByRole("link", { name: /Vehicle Sale ·/ })
      ).toBeVisible()
      await expect(
        page.getByRole("link", { name: /Brokerage ·/ })
      ).toBeVisible()
      await page.getByLabel("Bank reference").fill(`T13 UI ${suffix}`)
      const stagedResponse = page.waitForResponse((response) =>
        response.url().endsWith("/api/v1/commands/stageRemittance")
      )
      await page.getByRole("button", { name: "Stage remittance" }).click()
      const stagedInBrowser = await stagedResponse
      assert.equal(stagedInBrowser.status(), 201, await stagedInBrowser.text())
      await expect(page.getByText("Remittance draft created.")).toBeVisible()
      await page.getByLabel("Private document").setInputFiles({
        name: "notice.png",
        mimeType: "image/png",
        buffer: evidence,
      })
      const uploadResponse = page.waitForResponse((response) =>
        response.url().endsWith("/api/v1/commands/completeUpload")
      )
      await page.getByRole("button", { name: "Upload document" }).click()
      const uploadedInBrowser = await uploadResponse
      assert.equal(
        uploadedInBrowser.status(),
        200,
        await uploadedInBrowser.text()
      )
      await expect(page.getByText("Private document uploaded.")).toBeVisible()
      await page.getByLabel("Transfer amount").fill("205.00")
      await page.getByLabel("Verified notice").selectOption({ index: 1 })
      for (const [index, key, amount] of [
        [1, "sale", "200.00"],
        [2, "brokerage", "5.00"],
      ] as const) {
        await page.getByRole("button", { name: "Add notice line" }).click()
        await page.getByLabel(`Line ${index} reference`).fill(key)
        await page
          .getByLabel("Line description")
          .nth(index - 1)
          .fill(`Notice for ${key}`)
        await page
          .getByLabel("Line amount")
          .nth(index - 1)
          .fill(amount)
      }
      const recordResponse = page.waitForResponse((response) =>
        response.url().endsWith("/api/v1/commands/recordRemittance")
      )
      await page.getByRole("button", { name: "Record transfer" }).click()
      const recordedInBrowser = await recordResponse
      assert.equal(
        recordedInBrowser.status(),
        200,
        await recordedInBrowser.text()
      )
      await expect(page.getByText("Bank transfer recorded.")).toBeVisible()
      const row = (await live()).remittances.find(
        (r) => r.reference === `T13 UI ${suffix}`
      )!
      assert.ok(row.noticeAttachmentId)
      const attachment = await get<{ url: string }>(
        "download",
        `?attachmentId=${row.noticeAttachmentId}`
      )
      assert.deepEqual(await (await admin.get(attachment.url)).body(), evidence)
      assert.equal((await staff.get(attachment.url)).status(), 404)
      for (const [index, source, key, amount] of [
        [1, initial.vehicle, "sale", "200.00"],
        [2, initial.brokerage, "brokerage", "5.00"],
      ] as const) {
        await page
          .getByRole("button", { name: "Add allocation", exact: true })
          .click()
        await page
          .getByLabel(`Allocation ${index} remittance`)
          .selectOption(row.id)
        await page
          .getByLabel(`Allocation ${index} entitlement`)
          .selectOption(source.entitlementId)
        await page
          .getByLabel(`Allocation ${index} notice line`)
          .selectOption(row.lines.find((l) => l.key === key)!.id)
        await page.getByLabel(`Allocation ${index} amount`).fill(amount)
      }
      await page
        .getByRole("button", { name: "Save reconciliation run" })
        .click()
      await expect(page.getByText("Reconciliation run saved.")).toBeVisible()
      await expect(page.getByText(/Saved run ·/)).toBeVisible()
      await context.close()
    } finally {
      await client.close()
    }
    console.log(
      "PASS Chromium Finance navigation, verified notice, bank transfer and mixed partial allocation"
    )
    const partial = await live()
    const partialRun = partial.runs[0].id
    const pending = items(partial)
    assert.equal(pending.vehicle.outstanding, "55800")
    assert.equal(pending.brokerage.outstanding, "500")
    assert.equal(partial.watermarkDate, null)
    assert.equal((await sale(saleId)).finance?.lenderOutstanding, "55000")
    const partialSnapshot = items(
      await get<View>(
        "reconciliation",
        `?companyId=${companyId}&runId=${partialRun}`
      )
    )
    assert.ok(
      partialSnapshot.vehicle.overdue && partialSnapshot.brokerage.overdue
    )
    const firstReceipt = partial.remittances[0]
    assert.equal(firstReceipt.unallocated, "0")
    assert.equal((await remittance(firstReceipt.id)).allocations.length, 2)
    const leaseForInvoice = await sale(saleId)
    const cycleForInvoice = await get<{ id: string; revision: number }>(
      "purchase",
      `?cycleId=${leaseForInvoice.cycleId}`
    )
    const pendingInvoice = leaseForInvoice.invoices.find(
      (row) =>
        row.saleRevision === leaseForInvoice.revision && row.state !== "READY"
    )
    const issued = await admin.post("/api/v1/commands/issueInvoice", {
      headers: { Origin: f.origin },
      data: envelope(
        { saleId, saleRevision: leaseForInvoice.revision, regenerate: false },
        [
          ref(leaseForInvoice, "SaleCase"),
          ref(cycleForInvoice),
          ...(pendingInvoice ? [ref(pendingInvoice, "InvoiceVersion")] : []),
        ]
      ),
    })
    assert.equal(issued.status(), 200, await issued.text())
    const invoice = (await sale(saleId)).invoices.find(
      (row) => row.state === "READY"
    )!
    const invoiceResponse = await admin.get(
      `/api/v1/sales/${saleId}/invoices/${invoice.version}`
    )
    assert.equal(invoiceResponse.status(), 200)
    const invoiceText = execFileSync("pdftotext", ["-layout", "-", "-"], {
      input: await invoiceResponse.body(),
      encoding: "utf8",
    })
    assert.match(invoiceText, /Lender Remittance Allocation/)
    assert.ok(invoiceText.includes(firstReceipt.reference))
    console.log("PASS lease invoice itemizes the mixed remittance receipt")

    const bankRef = `T13 final ${suffix}`
    const staged = (
      await cmd(
        "stageRemittance",
        { companyId, reference: bankRef },
        [partial.company],
        201
      )
    ).result
    const stagedDetail = await remittance(staged.id)
    const payment = {
      amount: "56300",
      date: today,
      method: "BANK_TRANSFER",
      reference: bankRef,
    }
    await cmd(
      "recordRemittance",
      { draftId: staged.id, companyId, payment, lines: [] },
      [stagedDetail.company, ref(staged, "Remittance")],
      422
    )
    const noticeAttachmentId = await upload(
      "REMITTANCE",
      ref(staged, "Remittance"),
      "RECONCILIATION_NOTICE"
    )
    await cmd(
      "recordRemittance",
      {
        draftId: staged.id,
        companyId,
        payment,
        noticeAttachmentId,
        lines: [
          {
            key: "sale",
            amount: "55700",
            description: "Lender principal and commission",
            source: { type: "VEHICLE_SALE", id: saleId },
          },
          {
            key: "brokerage",
            amount: "600",
            description: "Broker commission",
            source: { type: "BROKERAGE", id: dealId },
          },
        ],
      },
      [stagedDetail.company, ref(staged, "Remittance")]
    )
    const beforeFinal = await live()
    const last = await remittance(staged.id)
    const expected = [
      beforeFinal.company,
      ref(last, "Remittance"),
      ref(firstReceipt, "Remittance"),
      owner(items(beforeFinal).vehicle),
      owner(items(beforeFinal).brokerage),
    ]
    const finalInput = {
      companyId,
      asOfDate: today,
      allocations: [
        {
          remittanceId: last.id,
          entitlementId: pending.vehicle.entitlementId,
          amount: "55700",
          noticeLineId: last.lines.find((l) => l.key === "sale")!.id,
        },
        {
          remittanceId: last.id,
          entitlementId: pending.brokerage.entitlementId,
          amount: "600",
          noticeLineId: last.lines.find((l) => l.key === "brokerage")!.id,
        },
      ],
      resolutions: [
        {
          entitlementId: pending.vehicle.entitlementId,
          kind: "ACCEPT_SHORTFALL",
          reason: "Approved commission write-down",
        },
        {
          entitlementId: pending.brokerage.entitlementId,
          kind: "RETURN_OVERPAYMENT",
          reason: "Lender requested surplus returned",
        },
      ],
    }
    await cmd("reconcile", { ...finalInput, resolutions: [] }, expected, 422)
    const attempts = [
      envelope(finalInput, expected),
      envelope(finalInput, expected),
    ]
    const post = (data: unknown) =>
      admin.post("/api/v1/commands/reconcile", {
        headers: { Origin: f.origin },
        data,
      })
    const raced = await Promise.all(attempts.map(post))
    assert.deepEqual(
      raced.map((r) => r.status()).sort(),
      [200, 409],
      await Promise.all(raced.map((r) => r.text())).then((r) => r.join("\n"))
    )
    const winnerIndex = raced.findIndex((response) => response.ok())
    const winner = await raced[winnerIndex].json()
    const replay = await post(attempts[winnerIndex])
    assert.equal(replay.status(), 200)
    assert.deepEqual(
      ((await replay.json()) as { commandId: string; replayed: boolean })
        .commandId,
      winner.commandId
    )
    assert.equal((await replay.json()).replayed, true)
    const saved = items(await live())
    assert.equal(saved.vehicle.outstanding, "0")
    assert.equal(saved.vehicle.discrepancy, "100")
    assert.equal(saved.vehicle.state, "RESOLVED")
    assert.equal(saved.brokerage.discrepancy, "-100")
    assert.equal(saved.brokerage.state, "RESOLVED")
    assert.equal((await sale(saleId)).finance?.lenderOutstanding, "0")
    const auditView = await get<{
      data: { fields: { path: string; before: unknown; after: unknown }[] }[]
    }>("audit", `?type=FinanceCompany&id=${companyId}&action=reconcile`)
    assert.ok(
      auditView.data.some((entry) =>
        entry.fields.some(
          (field) =>
            field.path === "reconciliationWatermark" &&
            field.before === null &&
            field.after === ids.olderDate
        )
      )
    )
    for (const [type, id] of [
      ["ReconciliationRun", winner.result.id],
      ["CommissionEntitlement", pending.vehicle.entitlementId],
      ["Remittance", last.id],
    ]) {
      const result = await get<{ total: number }>(
        "audit",
        `?type=${type}&id=${id}`
      )
      assert.ok(result.total > 0, type)
    }
    assert.equal((await live()).watermarkDate, ids.olderDate)
    assert.deepEqual(
      items(
        await get<View>(
          "reconciliation",
          `?companyId=${companyId}&runId=${partialRun}`
        )
      ),
      partialSnapshot
    )
    const run = await get<View>(
      "reconciliation",
      `?companyId=${companyId}&runId=${winner.result.id}`
    )
    assert.equal(run.view, "RUN_SNAPSHOT")
    assert.equal(run.watermarkDate, ids.olderDate)
    const completed = await remittance(last.id)
    assert.equal(completed.unallocated, "0")
    const discrepancy = completed.discrepancies.find(
      (d) => d.classification === "OVERPAYMENT"
    )!
    assert.equal(discrepancy.returnOutstanding, "100")
    const prior = await get<Entitlement>(
      "reconciliationEntitlement",
      `?id=${saved.brokerage.entitlementId}`
    )
    assert.ok(
      prior.allocations.every((a) => a.entitlement.revision === prior.revision)
    )
    await cmd(
      "returnRemittanceOverpayment",
      {
        remittanceId: last.id,
        discrepancyId: discrepancy.id,
        reason: "Bank return",
        payment: {
          amount: "100",
          date: today,
          method: "BANK_TRANSFER",
          reference: `Return ${suffix}`,
        },
      },
      [completed.company, ref(completed, "Remittance"), discrepancy.entitlement]
    )
    const returned = await remittance(last.id)
    assert.equal(
      returned.discrepancies.find((d) => d.id === discrepancy.id)
        ?.returnOutstanding,
      "0"
    )
    const blocked = returned.allocations.find(
      (row) => row.id === discrepancy.allocationId
    )!
    await cmd(
      "reverseAllocation",
      { allocationId: blocked.id, reason: "Cannot orphan return" },
      [returned.company, blocked.remittance, blocked.entitlement],
      422
    )
    const returnedPayment = returned.payments.find(
      (p) => p.category === "REMITTANCE_RETURN"
    )!
    await cmd(
      "reversePayment",
      {
        sourceType: "REMITTANCE",
        sourceId: last.id,
        paymentId: returnedPayment.id,
        date: today,
        reason: "Corrected bank return",
      },
      [returned.company, ref(returned, "Remittance"), blocked.entitlement]
    )
    const reversed = await remittance(last.id)
    assert.equal(
      reversed.discrepancies.find((d) => d.id === discrepancy.id)
        ?.returnOutstanding,
      "100"
    )

    const report = await get<ReportResponse>(
      "report",
      `?kind=CASH_FLOW&from=${today}&through=${today}&pageSize=100`
    )
    const cash = report.data.filter(
      (row) =>
        "sourceId" in row &&
        [firstReceipt.id, last.id].includes(row.sourceId ?? "")
    )
    assert.equal(cash.length, 4)
    assert.deepEqual(cash.map((p) => ("amount" in p ? p.amount : "")).sort(), [
      "100",
      "100",
      "20500",
      "56300",
    ])
    const actual = await f.db.query(
      'SELECT count(*)::int AS n FROM vamotors."CashMovement" WHERE "sourceType"=\'REMITTANCE\' AND "sourceId" IN ($1,$2)',
      [firstReceipt.id, last.id]
    )
    assert.equal(actual.rows[0].n, 4)
    console.log(
      "PASS shortfall write-down, explicit overpayment, return and reversal, saved cutoff, concurrent allocation, and once-only cash"
    )

    // Reverse the overpaid allocation after its bank return has been reversed.
    const undo = reversed.allocations.find((row) => row.id === blocked.id)!
    await cmd(
      "reverseAllocation",
      { allocationId: undo.id, reason: "Reassign corrected bank notice" },
      [reversed.company, undo.remittance, undo.entitlement]
    )
    assert.equal(items(await live()).brokerage.outstanding, "500")

    // Change the company's method. Posted period notices retain their policy.
    const directory = await get<PartyDTO>(
      "party",
      `?type=FINANCE_COMPANY&id=${companyId}`
    )
    assert.ok(directory.policy)
    await cmd(
      "updateFinanceCompany",
      {
        id: companyId,
        name: directory.name,
        contacts: directory.contacts.map(
          ({ name, phone, email, role, primary }) => ({
            name,
            phone,
            email,
            role,
            primary,
          })
        ),
        policy: { ...directory.policy, reconciliationMethod: "PER_DEAL" },
        reason: "Company now reports per deal",
      },
      [
        ref(directory, "FinanceCompany"),
        ref(
          await get<{ id: string; revision: number }>("settings"),
          "Settings"
        ),
      ]
    )
    const perDealReference = `T13 carry ${suffix}`
    const perDealDraft = (
      await cmd(
        "stageRemittance",
        { companyId, reference: perDealReference },
        [(await live()).company],
        201
      )
    ).result
    const draft = await remittance(perDealDraft.id)
    assert.equal(draft.method, "PER_DEAL")
    assert.equal((await remittance(last.id)).method, "PERIOD_NOTICE")
    await cmd(
      "recordRemittance",
      {
        companyId,
        draftId: draft.id,
        lines: [],
        payment: {
          amount: "600",
          date: today,
          method: "BANK_TRANSFER",
          reference: perDealReference,
        },
      },
      [draft.company, ref(draft, "Remittance")]
    )

    const beforeCarry = await live()
    const reopened = items(beforeCarry)
    const credit = await remittance(draft.id)
    await cmd(
      "reconcile",
      {
        companyId,
        asOfDate: today,
        allocations: [
          {
            remittanceId: credit.id,
            entitlementId: reopened.brokerage.entitlementId,
            amount: "600",
          },
        ],
        resolutions: [
          {
            entitlementId: reopened.brokerage.entitlementId,
            kind: "CARRY_CREDIT",
            reason: "Reserve excess against next balance",
          },
          {
            entitlementId: reopened.vehicle.entitlementId,
            kind: "KEEP_OPEN",
            reason: "Dispute resolved. Collect remaining commission.",
          },
        ],
      },
      [
        beforeCarry.company,
        owner(reopened.brokerage),
        owner(reopened.vehicle),
        ...beforeCarry.remittances.map((row) => ref(row, "Remittance")),
      ]
    )
    const carryReady = await remittance(draft.id)
    assert.equal(carryReady.carriedCredit, "100")
    assert.equal(carryReady.unallocated, "100")
    const due = items(await live()).vehicle
    assert.equal(due.outstanding, "100")
    await cmd(
      "reconcile",
      {
        companyId,
        asOfDate: today,
        allocations: [
          {
            remittanceId: carryReady.id,
            entitlementId: due.entitlementId,
            amount: "100",
          },
        ],
        resolutions: [],
      },
      [carryReady.company, ref(carryReady, "Remittance"), owner(due)]
    )
    assert.equal(items(await live()).vehicle.state, "SETTLED")
    assert.equal((await remittance(draft.id)).unallocated, "0")
    assert.equal((await remittance(draft.id)).payments.length, 1)
    const settled = items(await live()).vehicle
    const completedLease = await sale(saleId)
    const lenderReceipt = completedLease.payments!.find(
      (payment) => payment.category === "LENDER"
    )!
    const cycle = await get<{ id: string; revision: number }>(
      "purchase",
      `?cycleId=${completedLease.cycleId}`
    )
    const requested = (await cmd(
      "requestApproval",
      {
        proposal: {
          kind: "SALE_EDIT",
          operation: "EDIT_COMPLETION",
          input: {
            saleId,
            patch: {},
            reason: "Correct independent lender entry",
            cashCorrections: [
              { paymentId: lenderReceipt.id, reason: "Entered in error" },
            ],
          },
        },
        reason: "Correct independent lender entry",
      },
      [ref(completedLease, "SaleCase"), ref(cycle)],
      202
    )) as unknown as Pending
    const reviewer = await f.login("SECOND")
    const approvals = await f.query<{ data: ApprovalDTO[] }>(
      reviewer,
      "approvals",
      "?pageSize=100"
    )
    const approval = approvals.data.find(
      (row) => row.id === requested.approvalId
    )!
    await f.command(
      reviewer,
      "reviewApproval",
      envelope(
        {
          approvalId: approval.id,
          decision: "APPROVE",
        },
        [ref(approval, "ApprovalRequest"), ...approval.expected]
      )
    )
    const correctedBalance = items(await live()).vehicle
    assert.equal(correctedBalance.revision, settled.revision + 1)
    assert.equal(correctedBalance.directReceipts, "0")
    assert.equal(correctedBalance.outstanding, "5000")
    const restoredCash = await f.db.query(
      "SELECT sum(CASE direction WHEN 'IN' THEN amount ELSE -amount END)::text AS amount FROM vamotors.\"CashMovement\" WHERE \"sourceId\"=$1 AND category='LENDER'",
      [saleId]
    )
    assert.equal(restoredCash.rows[0].amount, "0")
    console.log(
      "PASS approved lender correction reopens reconciliation and nets the original direct cash"
    )
    console.log(
      "PASS per-deal policy, explicit dispute and reuse of carried credit without duplicate cash"
    )
  }
} finally {
  await f.close()
}
