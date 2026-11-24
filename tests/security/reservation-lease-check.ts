/** Real loopback HTTP, private bytes, timer and Chromium against an isolated local setup. */
import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { join } from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import pg from "pg"
import { readFile } from "node:fs/promises"
import { chromium, request, type APIRequestContext } from "@playwright/test"
import type {
  Applied,
  ApprovalDTO,
  CustomerDTO,
  Pending,
  PurchaseCycleDTO,
  SaleDTO,
  UploadReady,
} from "../../.planning/implementation/contracts/api"
import { privateEnvironment } from "../../scripts/private-environment"
import { renderReportPdf } from "../../lib/server/pdf"
import { envelope, purchaseInput, ref } from "./cycle-edits-fixture"

const root = process.argv[2]
const origin = process.argv[3]
assert.ok(root && origin)
assert.match(origin, /^http:\/\/127\.0\.0\.1:(?!8000$)\d+$/)
const accounts = await privateEnvironment(join(root, "accounts.env"))
const suffix = randomUUID().slice(0, 8)
const clients: APIRequestContext[] = []
const now = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Colombo",
}).format(new Date())
const daysAgo = (days: number) =>
  new Date(+new Date(now) - days * 86400000).toISOString().slice(0, 10)
async function login(user: "ADMIN" | "SECOND" | "STAFF") {
  const c = await request.newContext({ baseURL: origin, timeout: 180000 })
  clients.push(c)
  const response = await c.post("/api/auth/sign-in/email", {
    headers: { Origin: origin },
    data: {
      email: accounts[`BOOTSTRAP_${user}_EMAIL`],
      password: accounts[`BOOTSTRAP_${user}_PASSWORD`],
    },
  })
  assert.equal(response.status(), 200)
  return c
}
async function command<T = Applied>(
  client: APIRequestContext,
  name: string,
  data: unknown,
  status = 200
): Promise<T> {
  const r = await client.post(`/api/v1/commands/${name}`, {
    headers: { Origin: origin },
    data,
  })
  const json = await r.json()
  assert.equal(r.status(), status, `${name} ${JSON.stringify(json)}`)
  return json as T
}
async function query<T>(client: APIRequestContext, route: string): Promise<T> {
  const r = await client.get(`/api/v1/queries/${route}`)
  const json = await r.json()
  assert.equal(r.status(), 200, `${route} ${JSON.stringify(json)}`)
  return json.data as T
}
const browser = await chromium.launch({
  executablePath:
    process.env.VAMOTORS_CHROMIUM_EXECUTABLE ?? "/usr/bin/chromium",
})
try {
  const [admin, second, staff] = await Promise.all([
    login("ADMIN"),
    login("SECOND"),
    login("STAFF"),
  ])
  await command(staff, "runExpiry", envelope({ limit: 10 }), 403)
  const badScheduler = await admin.post("/api/v1/jobs/reservation-expiry", {
    headers: { Origin: origin },
    data: envelope({ limit: 10 }),
  })
  assert.equal(badScheduler.status(), 401)
  const contact = {
    name: "Local tester",
    phone: "0112345678",
    role: "Sales",
    primary: true,
  }
  const supplier = (
    await command(
      admin,
      "createDirectoryParty",
      envelope({
        type: "SUPPLIER",
        values: {
          name: `T10 Supplier ${suffix}`,
          category: "COMPANY",
          contacts: [contact],
        },
      }),
      201
    )
  ).result
  const settings = await query<{ id: string; revision: number }>(
    admin,
    "settings"
  )
  const company = (
    await command(
      admin,
      "createFinanceCompany",
      envelope(
        {
          name: `T10 Lender ${suffix}`,
          contacts: [contact],
          policy: {
            path: "APPLICATION",
            commission: { basis: "FINANCED_PRINCIPAL", rateBps: 500 },
            processingFee: "0",
            reconciliationMethod: "PERIOD_NOTICE",
          },
        },
        [ref(settings, "Settings")]
      ),
      201
    )
  ).result
  const customer = await query<CustomerDTO>(
    admin,
    `customer?id=${
      (
        await command(
          admin,
          "createCustomer",
          envelope({
            fullName: `T10 Customer ${suffix}`,
            callingName: "T10",
            nicOrPassport: `T10-${suffix}`,
            phone: "0771234567",
            address: "Colombo",
          }),
          201
        )
      ).result.id
    }`
  )
  const cycle = (id: string) =>
    query<PurchaseCycleDTO>(admin, `purchase?cycleId=${id}`)
  const sale = (id: string) => query<SaleDTO>(admin, `sale?id=${id}`)
  async function stock(label: string) {
    const created = await command(
      admin,
      "recordPurchase",
      envelope(
        {
          ...purchaseInput(supplier.id, suffix, label, 1000),
          listedPrice: "100000",
        },
        [ref(supplier, "Supplier")]
      ),
      201
    )
    const row = await cycle(created.result.id)
    await command(
      admin,
      "receiveStock",
      envelope(
        {
          cycleId: row.id,
          date: "2026-10-02",
          disposition: { kind: "RELEASE" },
        },
        [ref(row)]
      )
    )
    return cycle(row.id)
  }
  const deps = async (row: SaleDTO) => [
    ref(row, "SaleCase"),
    ref(await cycle(row.cycleId)),
    ...(row.reservation ? [ref(row.reservation, "Reservation")] : []),
  ]
  async function advance(row: PurchaseCycleDTO, date: string) {
    const body = envelope(
      {
        cycleId: row.id,
        customerId: customer.id,
        price: "100000",
        receipt: { amount: "5000", date, method: "BANK_TRANSFER" },
      },
      [ref(row), ref(customer, "Customer"), ref(settings, "Settings")]
    )
    const placed = await command(admin, "placeReservation", body)
    const replay = await command(admin, "placeReservation", body)
    assert.equal(replay.result.id, placed.result.id)
    assert.equal(replay.replayed, true)
    return sale(placed.result.id)
  }

  const stockForBrowser = await stock("browser")
  const context = await browser.newContext()
  await context.addCookies((await admin.storageState()).cookies)
  const page = await context.newPage()
  page.setDefaultTimeout(180000)
  page.setDefaultNavigationTimeout(180000)
  const waitCommand = (name: string) =>
    page.waitForResponse(
      (r) =>
        r.url().endsWith(`/commands/${name}`) && r.request().method() === "POST"
    )
  async function submit(name: string, label: string) {
    const response = waitCommand(name)
    await page
      .locator("form")
      .getByRole("button", { name: label, exact: true })
      .click()
    const r = await response
    const data = await r.json()
    assert.ok(r.ok(), `${name} ${r.status()} ${JSON.stringify(data)}`)
    return data as Applied
  }
  await page.goto(`${origin}/vehicles/${stockForBrowser.vehicleId}`)
  await page
    .getByRole("button", { name: "Complete Immediate Sale", exact: true })
    .click()
  await page.getByLabel("Sale Kind").selectOption("ADVANCE")
  await page.getByLabel("Buyer Customer").selectOption(customer.id)
  await page.getByLabel("Agreed Sale Price").fill("1000")
  await page.getByLabel("Payment date").fill(daysAgo(3))
  await page.getByLabel("Advance amount").fill("50")
  const placed = await submit("placeReservation", "Place advance")
  await page.getByRole("link", { name: /open sale/i }).click()
  await page.getByRole("button", { name: "Convert to lease sale" }).click()
  await page.getByLabel("Finance company").selectOption(company.id)
  await page.getByLabel("Down payment").fill("150")
  await page.getByLabel("Term (months)").fill("12")
  await page.getByLabel("Payment date").fill(daysAgo(2))
  await submit("startFinance", "Convert to lease sale")
  let current = await sale(placed.result.id)
  assert.equal(current.state, "FINANCE_PENDING")
  assert.equal(current.finance?.principal, "80000")
  assert.equal(current.payments?.length, 2)
  await page.getByRole("button", { name: "Record delivery order" }).click()
  const pdf = renderReportPdf({
    title: "T10 delivery order",
    columns: [{ key: "id", label: "Order" }],
    rows: [{ id: "T10" }],
    totals: [],
  })
  await page.getByLabel("Delivery order file").setInputFiles({
    name: "delivery-order.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(pdf),
  })
  await page.getByLabel("DO issue date").fill(daysAgo(1))
  await submit("recordDO", "Record delivery order")
  current = await sale(placed.result.id)
  assert.equal(current.state, "DO_RECEIVED")
  assert.equal(current.payments?.length, 2)
  const attachment = current.finance?.doAttachmentId
  assert.ok(attachment)
  const { url } = await query<{ url: string }>(
    admin,
    `download?attachmentId=${attachment}`
  )
  const download = await admin.get(url)
  assert.equal(download.status(), 200)
  assert.deepEqual(await download.body(), Buffer.from(pdf))
  const denied = await staff.get(url)
  assert.ok([403, 404].includes(denied.status()))
  await page.getByRole("button", { name: "Confirm handover" }).click()
  await page.getByLabel("Handover date").fill(daysAgo(1))
  await submit("confirmDOAndHandover", "Confirm handover")
  current = await sale(placed.result.id)
  assert.equal(current.state, "COMPLETED")
  assert.equal(current.reservation?.effectiveStatus, "CONVERTED")
  assert.equal(current.finance?.lenderOutstanding, "80000")
  assert.equal(current.payments?.length, 2)
  await page.getByRole("button", { name: "Record lender receipt" }).click()
  await page.getByLabel("Received amount").fill("800")
  await submit("recordLenderReceipt", "Record lender receipt")
  current = await sale(placed.result.id)
  assert.equal(current.finance?.lenderOutstanding, "0")
  assert.equal(current.completion?.date, daysAgo(1))
  assert.equal(
    current.payments?.find((payment) => payment.category === "LENDER")?.date,
    now
  )
  assert.deepEqual(
    current.payments?.map((p) => p.category),
    ["ADVANCE", "DOWN_PAYMENT", "LENDER"]
  )
  console.log(
    "PASS Chromium advance → lease → private DO → handover → lender receipt"
  )

  const warnedSale = await advance(await stock("warned"), daysAgo(5))
  const expiredSale = await advance(await stock("timer"), daysAgo(15))
  const timer = await promisify(execFile)(
    process.execPath,
    [
      "--import",
      "tsx",
      "scripts/local-expiry-scheduler.ts",
      "--base-url",
      origin,
      "--secret-file",
      join(root, "expiry-scheduler.key"),
      "--interval-ms",
      "2500",
      "--max-ticks",
      "1",
      "--timeout-ms",
      "60000",
      "--defer-first-tick",
      "--state-file",
      join(root, `scheduler-${suffix}.json`),
    ],
    { timeout: 180000 }
  )
  assert.equal(timer.stderr.includes("HTTP_"), false)
  assert.equal((await sale(expiredSale.id)).state, "EXPIRED")
  assert.equal((await cycle(expiredSale.cycleId)).available, false)
  assert.equal((await sale(warnedSale.id)).state, "RESERVED")
  const health = await query<{ lastSuccess: unknown; stale: boolean }>(
    admin,
    "jobHealth"
  )
  assert.ok(health.lastSuccess)
  assert.equal(health.stale, false)
  const persistedScheduler = JSON.parse(
    await readFile(join(root, `scheduler-${suffix}.json`), "utf8")
  )
  assert.ok(persistedScheduler.lastSuccessAt)
  assert.ok(timer.stdout.includes("SCHEDULED"))
  const missed = await advance(await stock("missed"), daysAgo(20))
  const catchUp = envelope({ limit: 100 })
  const run = await command<{ expired: number; runId: string }>(
    admin,
    "runExpiry",
    catchUp
  )
  assert.ok(run.expired >= 1)
  const duplicate = await command<{ replayed: boolean; runId: string }>(
    admin,
    "runExpiry",
    catchUp
  )
  assert.equal(duplicate.replayed, true)
  assert.equal(duplicate.runId, run.runId)
  const notices = await query<{
    data: { kind: string; target: { id: string } }[]
  }>(admin, "notifications?pageSize=100")
  assert.equal(
    notices.data.filter(
      (n) => n.target.id === expiredSale.id && n.kind === "ADVANCE_EXPIRED"
    ).length,
    1
  )
  assert.equal(
    notices.data.filter(
      (n) => n.target.id === warnedSale.id && n.kind === "ADVANCE_EXPIRING"
    ).length,
    1
  )
  const expired = await sale(missed.id)
  const proposal = {
    kind: "REFUND",
    input: {
      reservationId: expired.reservation!.id,
      reason: "Partial refund",
      retainedAmount: "2000",
      refund: { amount: "3000", date: now, method: "BANK_TRANSFER" },
      disposition: { kind: "RELEASE" },
    },
  }
  const pending = await command<Pending>(
    admin,
    "requestApproval",
    envelope({ reason: "Partial refund", proposal }, await deps(expired)),
    202
  )
  const approverView = await query<{ data: ApprovalDTO[] }>(
    second,
    "approvals?pageSize=100"
  )
  const approval = approverView.data.find(
    (row) => row.id === pending.approvalId
  )!
  assert.ok(approval)
  const review = envelope({ approvalId: approval.id, decision: "APPROVE" }, [
    ref(approval, "ApprovalRequest"),
    ...approval.expected,
  ])
  await command(admin, "reviewApproval", review, 403)
  await command(second, "reviewApproval", review)
  await command(second, "reviewApproval", review)
  const refunded = await sale(expired.id)
  assert.equal(refunded.reservation?.retainedAmount, "2000")
  assert.deepEqual(
    refunded.payments?.map(({ category, amount, direction }) => [
      category,
      amount,
      direction,
    ]),
    [
      ["ADVANCE", "5000", "IN"],
      ["REFUND", "3000", "OUT"],
    ]
  )
  assert.equal((await cycle(expired.cycleId)).available, true)
  const retained = await advance(await stock("retained"), now)
  await command(
    admin,
    "cancelRetained",
    envelope(
      {
        reservationId: retained.reservation!.id,
        retainedAmount: "5000",
        reason: "Customer forfeited deposit",
        disposition: { kind: "HOLD", reason: "Inspect stock" },
      },
      await deps(retained)
    )
  )
  assert.equal((await sale(retained.id)).state, "CANCELLED")
  assert.equal((await cycle(retained.cycleId)).holdReason, "Inspect stock")
  const cash = await advance(await stock("cash-conversion"), now)
  const listedBefore = await cycle(cash.cycleId)
  await command(
    admin,
    "setListedPrice",
    envelope(
      {
        cycleId: cash.cycleId,
        amount: "120000",
        reason: "Revised listing after placement",
      },
      [ref(listedBefore)]
    )
  )
  assert.equal((await sale(cash.id)).reservation?.listedBasis, "100000")

  await command(
    admin,
    "convertReservation",
    envelope(
      {
        reservationId: cash.reservation!.id,
        date: now,
        mileage: 1001,
        balance: { amount: "95000", date: now, method: "CASH" },
      },
      await deps(cash)
    )
  )
  assert.deepEqual(
    (await sale(cash.id)).payments?.map(({ category, amount }) => [
      category,
      amount,
    ]),
    [
      ["ADVANCE", "5000"],
      ["BALANCE", "95000"],
    ]
  )

  const principalRefund = await advance(await stock("lease-refund"), now)
  await command(
    admin,
    "startFinance",
    envelope(
      {
        reservationId: principalRefund.reservation!.id,
        cycleId: principalRefund.cycleId,
        customerId: customer.id,
        price: "100000",
        companyId: company.id,
        financeAmount: "80000",
        termMonths: 12,
        downPayment: { amount: "15000", date: now, method: "BANK_TRANSFER" },
      },
      [
        ...(await deps(principalRefund)),
        ref(settings, "Settings"),
        ref(customer, "Customer"),
        ref(company, "FinanceCompany"),
      ]
    )
  )
  const pendingLease = await sale(principalRefund.id)
  const png = await readFile("public/pwa-icon-192.png")
  const image = await command<UploadReady>(
    admin,
    "initUpload",
    envelope(
      {
        target: { type: "SALE_CASE", id: pendingLease.id },
        purpose: "DO",
        filename: "scanned-do.png",
        contentType: "image/png",
        size: png.length,
        sha256: createHash("sha256").update(png).digest("hex"),
      },
      [ref(pendingLease, "SaleCase")]
    ),
    201
  )
  const putImage = await admin.put(image.putUrl, {
    headers: { ...image.requiredHeaders, Origin: origin },
    data: png,
  })
  assert.ok(putImage.ok(), await putImage.text())
  const completedUpload = await command(
    admin,
    "completeUpload",
    envelope({ uploadId: image.uploadId }, [
      ref(pendingLease, "SaleCase"),
      { type: "UploadIntent", id: image.uploadId, revision: image.revision },
    ])
  )
  await command(
    admin,
    "recordDO",
    envelope(
      {
        saleCaseId: pendingLease.id,
        attachmentId: completedUpload.result.id,
        issueDate: now,
      },
      await deps(pendingLease)
    )
  )
  const leaseToCancel = await sale(principalRefund.id)
  const leaseRequest = await command<Pending>(
    admin,
    "requestApproval",
    envelope(
      {
        reason: "Buyer cancelled pending delivery",
        proposal: {
          kind: "REFUND",
          input: {
            saleCaseId: leaseToCancel.id,
            reason: "Buyer cancelled pending delivery",
            retainedAmount: "0",
            refund: { amount: "20000", date: now, method: "BANK_TRANSFER" },
            disposition: { kind: "RELEASE" },
          },
        },
      },
      await deps(leaseToCancel)
    ),
    202
  )
  const leaseApproval = (
    await query<{ data: ApprovalDTO[] }>(second, "approvals?pageSize=100")
  ).data.find((row) => row.id === leaseRequest.approvalId)!
  assert.ok(leaseApproval)
  await command(
    second,
    "reviewApproval",
    envelope({ approvalId: leaseApproval.id, decision: "APPROVE" }, [
      ref(leaseApproval, "ApprovalRequest"),
      ...leaseApproval.expected,
    ])
  )
  const cancelledLease = await sale(leaseToCancel.id)
  assert.equal(cancelledLease.state, "CANCELLED")
  assert.equal(
    cancelledLease.finance?.doAttachmentId,
    completedUpload.result.id
  )
  assert.equal(cancelledLease.reservation?.effectiveStatus, "REFUNDED")
  const refundLines =
    cancelledLease.payments?.filter(
      (payment) => payment.category === "REFUND"
    ) ?? []
  assert.deepEqual(refundLines.map((line) => line.amount).sort(), [
    "15000",
    "5000",
  ])
  assert.equal(new Set(refundLines.map((line) => line.refundOf)).size, 2)
  assert.equal((await cycle(cancelledLease.cycleId)).available, true)

  const discountedCycle = await stock("discounted-advance")
  const discountedInput = {
    cycleId: discountedCycle.id,
    customerId: customer.id,
    price: "95000",
    receipt: { amount: "5000", date: now, method: "BANK_TRANSFER" },
  }
  const discountRefs = [
    ref(discountedCycle),
    ref(customer, "Customer"),
    ref(settings, "Settings"),
  ]
  await command(
    admin,
    "placeReservation",
    envelope(discountedInput, discountRefs),
    409
  )
  const discount = await command<Pending>(
    admin,
    "requestApproval",
    envelope(
      {
        reason: "Approved price adjustment",
        proposal: {
          kind: "DISCOUNT",
          command: { name: "placeReservation", input: discountedInput },
        },
      },
      discountRefs
    ),
    202
  )
  assert.equal((await cycle(discountedCycle.id)).available, true)
  const discountApproval = (
    await query<{ data: ApprovalDTO[] }>(second, "approvals?pageSize=100")
  ).data.find((row) => row.id === discount.approvalId)!
  assert.ok(discountApproval)
  await command(
    second,
    "reviewApproval",
    envelope({ approvalId: discountApproval.id, decision: "APPROVE" }, [
      ref(discountApproval, "ApprovalRequest"),
      ...discountApproval.expected,
    ])
  )
  const discounted = await cycle(discountedCycle.id)
  assert.equal(discounted.status, "ADVANCE_PLACED")
  assert.equal((await sale(discounted.sales.at(-1)!.saleCaseId)).price, "95000")

  const overdue = await advance(
    await stock("conversion-before-timer"),
    daysAgo(15)
  )
  assert.equal(overdue.reservation?.expiryFlagPending, true)
  await command(
    admin,
    "convertReservation",
    envelope(
      {
        reservationId: overdue.reservation!.id,
        date: now,
        mileage: 1001,
        balance: { amount: "95000", date: now, method: "BANK_TRANSFER" },
      },
      await deps(overdue)
    )
  )
  const convertedOverdue = await sale(overdue.id)
  assert.equal(convertedOverdue.reservation?.effectiveStatus, "CONVERTED")
  assert.equal(
    convertedOverdue.timeline.filter(
      (event) => event.action === "ADVANCE_EXPIRED"
    ).length,
    1
  )

  const retrySale = await advance(await stock("failed-expiry"), daysAgo(15))
  const migration = await privateEnvironment(join(root, "migration.env"))
  assert.ok(migration.DIRECT_URL)
  const owner = new pg.Client({ connectionString: migration.DIRECT_URL })
  await owner.connect()
  const failRun = envelope({ limit: 100 })
  const checkName = `"t10_test_${suffix}"`
  assert.match(retrySale.reservation!.id, /^[a-f0-9-]+$/)
  try {
    await owner.query(
      `ALTER TABLE vamotors."Reservation" ADD CONSTRAINT ${checkName} CHECK (id <> '${retrySale.reservation!.id}'::uuid OR state <> 'EXPIRED')`
    )
    const result = await command<{ runId: string; failures: { id: string }[] }>(
      admin,
      "runExpiry",
      failRun
    )
    assert.ok(
      result.failures.some(
        (failure) => failure.id === retrySale.reservation?.id
      )
    )
    assert.equal((await sale(retrySale.id)).state, "RESERVED")
    const job = await query<{ lastFailure: { id: string } }>(admin, "jobHealth")
    assert.equal(job.lastFailure.id, result.runId)
  } finally {
    await owner.query(
      `ALTER TABLE vamotors."Reservation" DROP CONSTRAINT IF EXISTS ${checkName}`
    )
    await owner.end()
  }
  const recovered = await command<{ expired: number; failures: unknown[] }>(
    admin,
    "runExpiry",
    failRun
  )
  assert.ok(recovered.expired > 0)
  assert.deepEqual(recovered.failures, [])
  assert.equal((await sale(retrySale.id)).state, "EXPIRED")
  console.log(
    "PASS scheduled warning/expiry, failed-run recovery, catch-up, cash conversion, forfeiture, discounts and approved cash/lease refunds"
  )
} finally {
  await browser.close()
  await Promise.all(clients.map((client) => client.dispose()))
}
