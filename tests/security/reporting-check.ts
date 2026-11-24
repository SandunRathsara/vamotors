/** Run after pnpm build against a private cluster provisioned by pnpm local:setup. */
import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { chromium, expect, request } from "@playwright/test"
import type {
  ApprovalDTO,
  BrokerageDTO,
  PartyDTO,
  CustomerDTO,
  Dependency,
  Grant,
  NotificationDTO,
  Pending,
  PurchaseCycleDTO,
} from "../../.planning/implementation/contracts/api"
import type { ReportExportStatus } from "../../lib/server/report-http"
import { reportKinds, reportPages } from "../../lib/report-kinds"
import { fixture, envelope, purchaseInput, ref } from "./cycle-edits-fixture"

const root = process.argv[2]
assert.ok(root)
const f = await fixture(root)
const suffix = randomUUID().slice(0, 8)
const browser = await chromium.launch({
  executablePath: process.env.VAMOTORS_CHROMIUM_EXECUTABLE,
})
const tag = `Reports-${suffix}`
try {
  await f.start()
  const admin = await f.login("ADMIN")
  const reviewer = await f.login("SECOND")
  const cmd = (
    name: string,
    input: unknown,
    expected: Dependency[] = [],
    status = 200,
    client = admin
  ) => f.command(client, name, envelope(input, expected), status)
  const purchase = (id: string) =>
    f.query<PurchaseCycleDTO>(admin, "purchase", `?cycleId=${id}`)
  const directory = (type: "SUPPLIER" | "REPAIR_VENDOR", label: string) =>
    cmd(
      "createDirectoryParty",
      {
        type,
        values: { name: label, category: "COMPANY", contacts: [] },
      },
      [],
      201
    )
  const supplier = await directory("SUPPLIER", `${tag} supplier`)
  const vendor = await directory("REPAIR_VENDOR", `${tag} workshop`)
  const customer = await cmd(
    "createCustomer",
    {
      fullName: `${tag} buyer`,
      callingName: "Reporting",
      nicOrPassport: tag,
      address: "Synthetic address",
      phone: "0771111123",
    },
    [],
    201
  )
  const buyer = await f.query<CustomerDTO>(
    admin,
    "customer",
    `?id=${customer.result.id}`
  )
  async function acquire(
    label: string,
    disposition?: { kind: "RELEASE" } | { kind: "HOLD"; reason: string }
  ) {
    const input = purchaseInput(supplier.result.id, suffix, label, 1000)
    input.vehicle.make = tag
    const r = await cmd(
      "recordPurchase",
      input,
      [ref(supplier.result, "Supplier")],
      201
    )
    let cycle = await purchase(r.result.id)
    if (disposition) {
      await cmd(
        "receiveStock",
        { cycleId: cycle.id, date: "2026-10-02", disposition },
        [ref(cycle)]
      )
      cycle = await purchase(cycle.id)
    }
    return cycle
  }
  async function dispatch(cycle: PurchaseCycleDTO) {
    return cmd(
      "sendRepair",
      {
        cycleId: cycle.id,
        vendorId: vendor.result.id,
        request: "Inspect front brakes",
        sentDate: "2026-10-03",
      },
      [ref(cycle), ref(vendor.result, "RepairVendor")],
      201
    )
  }

  const roleName = `${tag} limited reporter`
  const grants: Grant[] = [
    { action: "read", subject: "Report", fields: ["INVENTORY", "SOLD"] },
    {
      action: "read",
      subject: "PurchaseRecord",
      fields: [
        "id",
        "purchaseDate",
        "status",
        "available",
        "identity",
        "repairs",
      ],
    },
    {
      action: "read",
      subject: "Vehicle",
      fields: ["id", "cycleId", "status", "available", "identity"],
    },
    {
      action: "read",
      subject: "SaleCase",
      fields: ["id", "kind", "state", "completion.date"],
    },
    { action: "read", subject: "RepairRecord", fields: ["id"] },
    { action: "release", subject: "PurchaseRecord", fields: ["cycleId"] },
    {
      action: "read",
      subject: "Notification",
      fields: ["*"],
      conditions: { recipientUserId: "$actor.id" },
    },
    {
      action: "update",
      subject: "Notification",
      fields: ["readAt"],
      conditions: { recipientUserId: "$actor.id" },
    },
  ]
  const role = await cmd(
    "saveRole",
    { name: roleName, grants, reason: "Limited reporting verification" },
    [],
    201
  )
  const password = `Report-${randomUUID()}-1`
  const email = `${tag.toLowerCase()}@example.test`
  await cmd(
    "createUser",
    { name: roleName, email, password, roleIds: [role.result.id] },
    [ref(role.result, "Role")],
    201
  )
  const limited = await request.newContext({ baseURL: f.origin })
  assert.equal(
    (
      await limited.post("/api/auth/sign-in/email", {
        headers: { Origin: f.origin },
        data: { email, password },
      })
    ).status(),
    200
  )

  let saleCycle = await acquire("sale", {
    kind: "HOLD",
    reason: "Repair before sale",
  })
  const repair = await dispatch(saleCycle)
  saleCycle = await purchase(saleCycle.id)
  await cmd(
    "returnRepair",
    {
      repairId: repair.result.id,
      invoiceAmount: "500",
      invoiceDate: "2026-10-04",
      returnedDate: "2026-10-04",
      summary: "Repaired front brakes",
      payment: { amount: "500", date: "2026-10-04", method: "CASH" },
    },
    [ref(saleCycle), ref(repair.result, "RepairRecord")]
  )
  saleCycle = await purchase(saleCycle.id)
  await cmd(
    "addCost",
    {
      cycleId: saleCycle.id,
      category: "TRANSPORT",
      description: "Transport to workshop",
      amount: "800",
      incurredDate: "2026-10-05",
      payment: { amount: "800", date: "2026-10-05", method: "CASH" },
    },
    [ref(saleCycle)],
    201
  )
  saleCycle = await purchase(saleCycle.id)
  if (!saleCycle.available) {
    await cmd("releaseStock", { cycleId: saleCycle.id }, [ref(saleCycle)])
    saleCycle = await purchase(saleCycle.id)
  }
  const sale = await cmd(
    "completeImmediate",
    {
      cycleId: saleCycle.id,
      customerId: buyer.id,
      kind: "CASH",
      price: "15000",
      date: "2026-10-06",
      mileage: 1020,
      method: "BANK_TRANSFER",
    },
    [ref(saleCycle), ref(buyer, "Customer")],
    201
  )
  const activeRepair = await dispatch(
    await acquire("active-repair", { kind: "RELEASE" })
  )
  const disposalCycle = await acquire("disposal")
  const pending = (await cmd(
    "requestApproval",
    {
      proposal: {
        kind: "WRITE_OFF",
        input: {
          cycleId: disposalCycle.id,
          date: "2026-10-05",
          reason: "Uneconomic restoration",
          method: "AUCTIONED",
          proceeds: "2000",
          receipt: { amount: "2000", date: "2026-10-06", method: "CASH" },
        },
      },
      reason: "Auction salvage approval",
    },
    [
      ref(disposalCycle),
      {
        type: "Vehicle",
        id: disposalCycle.vehicleId,
        revision: disposalCycle.identityRevision,
      },
    ],
    202
  )) as unknown as Pending
  const approvals = await f.query<{ data: ApprovalDTO[] }>(
    reviewer,
    "approvals",
    "?pageSize=100"
  )
  const approval = approvals.data.find(({ id }) => id === pending.approvalId)
  assert.ok(approval)
  await cmd(
    "reviewApproval",
    { approvalId: approval.id, decision: "APPROVE" },
    [ref(approval, "ApprovalRequest"), ...approval.expected],
    200,
    reviewer
  )
  for (let i = 0; i < 36; i++) await acquire(`stock-${i}`, { kind: "RELEASE" })

  const settings = await f.query<{ id: string; revision: number }>(
    admin,
    "settings"
  )
  const company = await cmd(
    "createFinanceCompany",
    {
      name: `${tag} finance`,
      contacts: [
        {
          name: "Facility agent",
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
    [ref(settings, "Settings")],
    201
  )
  const finance = await f.query<PartyDTO>(
    admin,
    "party",
    `?type=FINANCE_COMPANY&id=${company.result.id}`
  )
  const sheet = await cmd(
    "publishRates",
    {
      companyId: finance.id,
      make: "External",
      model: tag,
      year: 2026,
      validFrom: "2026-01-01",
      validThrough: "2027-12-31",
      maximum: "12000000",
      cards: [{ principal: "10000000", months: 12, installment: "900000" }],
    },
    [ref(finance, "FinanceCompany")],
    201
  )
  const rateCard = (
    await f.db.query(
      'SELECT id FROM vamotors."RateCardEntry" WHERE "sheetVersionId"=$1',
      [sheet.result.id]
    )
  ).rows[0]
  const quote = await cmd(
    "selectQuote",
    {
      sheetId: sheet.result.id,
      cardId: rateCard.id,
      vehicle: {
        make: "External",
        model: tag,
        year: 2026,
        description: "External vehicle",
      },
      charges: [],
    },
    [
      ref(sheet.result, "RateSheet"),
      ref(finance, "FinanceCompany"),
      ref(settings, "Settings"),
    ],
    201
  )
  const opening = await cmd(
    "openBrokerage",
    {
      customerId: buyer.id,
      guarantors: [
        {
          name: "Reporting Guarantor",
          identity: `G-${tag}`,
          address: "Synthetic address",
          phone: "0112345679",
        },
      ],
      quoteId: quote.result.id,
    },
    [
      ref(buyer, "Customer"),
      ref(quote.result, "Quote"),
      ref(finance, "FinanceCompany"),
      ref(settings, "Settings"),
    ],
    201
  )
  const dealId = opening.result.id
  const currentDeal = () =>
    f.query<BrokerageDTO>(admin, "brokerageDeal", `?id=${dealId}`)
  let deal = await currentDeal()
  for (const target of ["CUSTOMER", "GUARANTOR"]) {
    await cmd(
      "recordEligibility",
      {
        dealId,
        target,
        outcome: "CONFIRMED",
        contactId: finance.contacts[0].id!,
        ...(target === "GUARANTOR"
          ? { guarantorId: deal.guarantors[0].id }
          : {}),
        checkedAt: new Date().toISOString(),
        feedback: "Verified synthetic eligibility",
      },
      [ref(deal, "BrokerageDeal"), ref(finance, "FinanceCompany")]
    )
    deal = await currentDeal()
  }
  await cmd(
    "requestFacility",
    {
      dealId,
      reason: "Synthetic facility",
      terms: {
        gross: "10000000",
        deductions: [],
        fee: "0",
        feeMode: "WITHHELD",
        separatelyRecoverableCharges: "0",
      },
    },
    [ref(deal, "BrokerageDeal")]
  )
  deal = await currentDeal()
  const facility = (
    await f.db.query(
      'SELECT id, revision FROM vamotors."CashFacility" WHERE "dealId"=$1',
      [dealId]
    )
  ).rows[0]
  await cmd(
    "disburseFacility",
    {
      dealId,
      payment: {
        amount: "10000000",
        date: "2026-10-07",
        method: "BANK_TRANSFER",
      },
      separatelyPaidDeductions: [],
    },
    [ref(deal, "BrokerageDeal"), ref(facility, "CashFacility")]
  )
  deal = await currentDeal()
  await cmd(
    "recordBrokerageFee",
    {
      dealId,
      category: "PROCESSING",
      payment: { amount: "250000", date: "2026-10-07", method: "CASH" },
    },
    [ref(deal, "BrokerageDeal")]
  )
  console.log(
    "PASS real purchase, sale, repair, disposal and brokerage service fixtures"
  )

  const staff = await f.login("STAFF")
  const read = async (kind: string, params = "", client = admin) => {
    const started = performance.now()
    const value = await f.query<{
      total: number
      totals: Record<string, string>
      data: {
        cycleId?: string
        saleId?: string
        repairId?: string
        sourceType?: string
        financial?: Record<string, string>
        basis?: string
        netLoss?: string
        method?: string
        proceeds?: string
        approval?: { reviewerName?: string }
      }[]
      notice?: string
    }>(client, "report", `?kind=${kind}${params}`)
    assert.ok(performance.now() - started < 10000)
    return value
  }
  const inventory = await read(
    "INVENTORY",
    `&make=${tag}&status=IN_STOCK&available=true&pageSize=10`
  )
  assert.equal(inventory.total, 36)
  assert.equal(inventory.data.length, 10)
  assert.equal(inventory.totals.basis, "360000")

  const exportPath = "/api/v1/report-exports"
  const jobId = randomUUID()
  const startInput = {
    id: jobId,
    format: "pdf",
    query: `kind=INVENTORY&make=${tag}&status=IN_STOCK&page=99&pageSize=10`,
  }
  const openExport = () =>
    admin.post(exportPath, { headers: { Origin: f.origin }, data: startInput })
  const started = await openExport()
  assert.equal(started.status(), 201, await started.text())
  let job: ReportExportStatus = (await started.json()).data
  assert.equal(job.totalRows, 36)
  assert.equal(job.renderedRows, 0)
  assert.equal(job.complete, false)
  assert.equal((await openExport()).status(), 201)
  const step = async () => {
    const continued = await admin.post(`${exportPath}/${jobId}`, {
      headers: { Origin: f.origin },
      data: { revision: job.revision },
    })
    assert.equal(continued.status(), 200, await continued.text())
    job = (await continued.json()).data
  }
  const policyPath = f.runtime.PRIVATE_FILES_POLICY!
  const policy = await readFile(policyPath, "utf8")
  try {
    await writeFile(
      policyPath,
      JSON.stringify({ ...JSON.parse(policy), allowWrites: false })
    )
    await step()
    assert.equal(job.state, "PAUSED_QUOTA")
    assert.equal(job.error, "QUOTA_STOP")
    assert.deepEqual(job.parts, [])
  } finally {
    await writeFile(policyPath, policy)
  }
  await step()
  assert.equal(job.renderedRows, 35)
  assert.deepEqual(job.parts, [])
  const digest = job.digest
  await acquire("after-export-cutoff", { kind: "RELEASE" })
  assert.equal(
    (await read("INVENTORY", `&make=${tag}&status=IN_STOCK`)).total,
    37
  )
  await f.stop()
  await f.start()
  assert.equal((await staff.get(`${exportPath}/${jobId}`)).status(), 404)
  const resumed = await admin.get(`${exportPath}/${jobId}`)
  assert.equal(resumed.status(), 200, await resumed.text())
  job = (await resumed.json()).data
  assert.equal(job.renderedRows, 35)
  await step()
  assert.equal(job.complete, true)
  assert.equal(job.digest, digest)
  assert.equal(job.parts.length, 2)
  let through = 0
  for (const part of job.parts) {
    const url = `${exportPath}/${jobId}/${part.id}`
    const download = await admin.get(url)
    assert.equal(download.status(), 200, await download.text())
    assert.equal((await staff.get(url)).status(), 404)
    const bytes = await download.body()
    assert.equal(bytes.subarray(0, 5).toString(), "%PDF-")
    assert.equal(createHash("sha256").update(bytes).digest("hex"), part.sha256)
    assert.equal(part.firstRow, through + 1)
    through = part.lastRow
  }
  assert.equal(through, job.totalRows)
  console.log(
    "PASS retained export resumes after restart and quota pause, with exact verified part coverage and owner-only access"
  )
  const redacted = await read("INVENTORY", `&make=${tag}`, limited)
  assert.ok(redacted.data.length)
  assert.ok(redacted.data.every(({ financial }) => !financial))
  assert.equal(redacted.totals.basis, undefined)
  for (const [client, kind, format] of [
    [limited, "INVENTORY", "&format=csv"],
    [limited, "SOLD", ""],
    [staff, "SOLD", "&format=pdf"],
  ] as const)
    assert.equal(
      (
        await client.get(`/api/v1/queries/report?kind=${kind}${format}`)
      ).status(),
      403
    )

  const sold = await read(
    "SOLD",
    "&saleType=CASH&from=2026-10-06&through=2026-10-06&method=BANK_TRANSFER"
  )
  const soldRow = sold.data.find(({ saleId }) => saleId === sale.result.id)
  assert.equal(soldRow?.method, "BANK_TRANSFER")
  const dbSale = (
    await f.db.query(
      `
    SELECT s."agreedPrice" AS price, c."originalProfit" AS profit, b.total
    FROM vamotors."SaleCase" s JOIN vamotors."SaleCompletion" c ON c."saleCaseId"=s.id
    JOIN vamotors."CycleBasisVersion" b ON b.id=c."basisVersionId" WHERE s.id=$1
  `,
      [sale.result.id]
    )
  ).rows[0]
  assert.equal(soldRow?.financial?.salePrice, dbSale.price)
  assert.equal(soldRow?.financial?.originalProfit, dbSale.profit)
  assert.equal(soldRow?.financial?.basis, dbSale.total)
  const profit = await read(
    "PROFIT",
    `&make=${tag}&status=SOLD&profitOnly=true`
  )
  assert.equal(profit.total, 1)
  assert.deepEqual(
    ["purchase", "repairs", "additionalCosts", "basis", "restatedProfit"].map(
      (key) => profit.data[0].financial?.[key]
    ),
    ["10000", "500", "800", "11300", "3700"]
  )
  const repairs = await read(
    "REPAIRS",
    `&vendorId=${vendor.result.id}&from=2026-10-03&through=2026-10-03`
  )
  assert.deepEqual(
    repairs.data.map(({ repairId }) => repairId),
    [activeRepair.result.id]
  )
  const disposals = await read(
    "DISPOSALS",
    "&from=2026-10-05&through=2026-10-05"
  )
  const disposal = disposals.data.find(
    ({ cycleId }) => cycleId === disposalCycle.id
  )
  assert.equal(disposal?.basis, "10000")
  assert.equal(disposal?.proceeds, "2000")
  assert.equal(disposal?.netLoss, "8000")
  assert.ok(disposal?.approval?.reviewerName)
  assert.equal((await read("ADVANCES")).notice, undefined)

  for (const period of [
    {
      filter: "&from=2026-10-01&through=2026-10-31",
      from: "2026-10-01",
      through: "2026-10-31",
    },
    { filter: "", from: "0001-01-01", through: "9999-12-31" },
  ]) {
    const cash = await read("CASH_FLOW", period.filter + "&pageSize=10")
    const { cashIn, cashOut, total } = (
      await f.db.query(
        `
      SELECT count(*)::int total,
      sum(amount) FILTER (WHERE direction='IN')::text AS "cashIn",
      sum(amount) FILTER (WHERE direction='OUT')::text AS "cashOut"
      FROM vamotors."CashMovement" WHERE date BETWEEN $1 AND $2
    `,
        [period.from, period.through]
      )
    ).rows[0]
    assert.equal(cash.total, total)
    assert.deepEqual(cash.totals, {
      cashIn,
      cashOut,
      net: String(BigInt(cashIn) - BigInt(cashOut)),
    })
  }
  const brokerageCash = await f.db.query(
    "SELECT count(*)::int count FROM vamotors.\"CashMovement\" WHERE \"sourceType\" IN ('FACILITY','BROKERAGE_FEE')"
  )
  assert.ok(
    brokerageCash.rows[0].count >= 2,
    "Expected persisted facility and brokerage fee payments"
  )
  console.log(
    "PASS report populations, source reconciliation, field restrictions and unauthorized exports"
  )

  const inbox = (client = limited) =>
    f.query<{ data: NotificationDTO[]; unreadCount: number; asOf: string }>(
      client,
      "notifications",
      "?kind=REPAIR_RETURNED&pageSize=100"
    )
  const notification = (await inbox()).data.find(
    ({ target }) => target?.id === repair.result.id
  )
  assert.equal(notification?.target.href, `/repairs/${repair.result.id}`)
  assert.ok(notification)
  assert.equal(
    (await inbox(admin)).data.some(({ id }) => id === notification.id),
    false
  )
  await cmd(
    "saveRole",
    {
      id: role.result.id,
      name: roleName,
      reason: "Revoke repair target access",
      grants: grants.filter(({ subject }) => subject !== "RepairRecord"),
    },
    [ref(role.result, "Role")]
  )
  const revoked = (await inbox()).data.find(({ id }) => id === notification.id)
  assert.ok(revoked)
  assert.equal(revoked.target, undefined)
  assert.ok(
    [403, 404].includes(
      (await limited.get(`/repairs/${repair.result.id}`)).status()
    )
  )
  await cmd(
    "markNotificationRead",
    { notificationId: revoked.id },
    [ref(revoked, "Notification")],
    200,
    limited
  )
  assert.ok(
    (await inbox()).data.find(({ id }) => id === notification.id)?.readAt
  )
  const adminNotifications = await inbox(admin)
  await cmd("markAllNotificationsRead", { through: adminNotifications.asOf })
  assert.equal((await inbox(admin)).unreadCount, 0)
  console.log(
    "PASS recipient-only inbox, permission revocation, single read and read-all"
  )

  const page = await browser.newPage({
    storageState: await admin.storageState(),
    acceptDownloads: true,
  })
  await page.goto(`${f.origin}/dashboard`)
  await expect(
    page.getByRole("heading", { name: "Dashboard", exact: true })
  ).toBeVisible()
  await expect(
    page.getByRole("link", { name: /Vehicles in stock/ })
  ).toBeVisible()
  await page.getByRole("button", { name: "New purchase" }).click()
  await expect(page.getByLabel("Engine number")).toBeVisible()
  await page.getByRole("button", { name: "New purchase" }).click()
  await page.getByRole("button", { name: "New sale" }).click()
  await expect(
    page.getByRole("heading", { name: "Complete Immediate Sale" })
  ).toBeVisible()
  await page.getByRole("button", { name: "Close sale form" }).click()
  await page.getByLabel("Sales from").fill("2026-10-06")
  await page.getByLabel("Through").fill("2026-10-06")
  await page.getByRole("button", { name: "Apply dates" }).click()
  await expect(
    page.getByRole("link", { name: tag + " " + suffix })
  ).toHaveAttribute("href", `/sales/${sale.result.id}`)
  await page.getByRole("link", { name: "Send for repair" }).click()
  await expect(page).toHaveURL(/\/purchases\?status=IN_STOCK/)
  await page.getByRole("link", { name: "Reports", exact: true }).click()
  for (const kind of reportKinds) {
    await page
      .getByRole("link", { name: reportPages[kind].label, exact: true })
      .click()
    await expect(
      page.getByRole("heading", { name: reportPages[kind].label })
    ).toBeVisible()
    if (kind === "INVENTORY") {
      await page.getByLabel("Make", { exact: true }).fill(tag)
      await page.getByLabel("Status", { exact: true }).selectOption("IN_STOCK")
      await page.getByRole("button", { name: "Apply filters" }).click()
      await expect(
        page.getByText("37 matching records", { exact: false })
      ).toBeVisible()
    }
    for (const format of ["CSV", "PDF"]) {
      await page
        .getByRole("button", { name: `Export ${format}`, exact: true })
        .click()
      const link = page
        .getByRole("link", { name: `Download ${format}`, exact: false })
        .first()
      await expect(link).toBeVisible()
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        link.click(),
      ])
      assert.equal(await download.failure(), null)
      const bytes = await readFile((await download.path())!)
      if (format === "CSV") {
        assert.ok(bytes.length > 40)
        if (kind === "INVENTORY")
          assert.equal(bytes.toString().split(tag).length - 1, 37)
      } else {
        assert.equal(bytes.subarray(0, 5).toString(), "%PDF-")
        if (kind === "INVENTORY")
          await expect(
            page.getByRole("link", { name: "Download PDF part 2" })
          ).toBeVisible()
      }
    }
    await page.getByRole("link", { name: "All reports" }).click()
  }
  console.log(
    "PASS Chromium dashboard and every report with both export formats"
  )
} finally {
  await browser.close()
  await f.close()
}
