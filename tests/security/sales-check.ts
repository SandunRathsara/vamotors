/** Real local PostgreSQL + production HTTP/Playwright checks for T09 Immediate Sales, Trade-In, Discount & Sale-Edit Approvals, Repurchase, and Inline Customer. */
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { chromium, request, type APIRequestContext, type Page } from "@playwright/test"
import type {
  Applied,
  ApprovalDTO,
  CustomerDTO,
  Dependency,
  NotificationDTO,
  Pending,
  PurchaseCycleDTO,
  SaleDTO,
  VehicleDTO,
} from "../../.planning/implementation/contracts/api"
import { envelope, fixture, purchaseInput, ref } from "./cycle-edits-fixture"

process.umask(0o077)
const root = process.argv[2]
assert.ok(root)
const f = await fixture(root)
const groups: { group: string; pass: boolean }[] = []

type SaleView = SaleDTO & { redactedFields?: string[] }

const allTables = [
  "Vehicle",
  "PurchaseRecord",
  "LeasePurchaseDetail",
  "MileageReading",
  "PurchasePayment",
  "VehicleCost",
  "CostPayment",
  "CycleBasisVersion",
  "StatusEvent",
  "RepairRecord",
  "ApprovalRequest",
  "Disposal",
  "DisposalReceipt",
  "SaleCase",
  "SaleReceipt",
  "SaleCompletion",
  "SaleCorrection",
  "TradeInConsideration",
  "Customer",
  "Notification",
  "AuditEntry",
  "EntityReadVersion",
  "CommandReceipt",
  "BusinessSequence",
]

const reviewDeps = (apv: ApprovalDTO): Dependency[] => [
  ref(apv, "ApprovalRequest"),
  ...apv.expected,
]

const currentCycle = (client: APIRequestContext, id: string) =>
  f.query<PurchaseCycleDTO>(client, "purchase", `?cycleId=${id}`)

const currentSale = (client: APIRequestContext, id: string) =>
  f.query<SaleView>(client, "sale", `?id=${id}`)

const currentCustomer = (client: APIRequestContext, id: string) =>
  f.query<CustomerDTO>(client, "customer", `?id=${id}`)

const currentApproval = (client: APIRequestContext, id: string) =>
  f
    .query<{ data: ApprovalDTO[] }>(client, "approvals", "?pageSize=100")
    .then((p) => {
      const found = p.data.find((a) => a.id === id)
      assert.ok(found, `Approval ${id} missing`)
      return found
    })

async function statusBody(
  client: APIRequestContext,
  name: string,
  body: unknown,
  status: number,
  code: string,
  checkNoResidue = true
) {
  const before = checkNoResidue ? await f.snapshot(allTables) : ""
  const r = await client.post(`/api/v1/commands/${name}`, {
    headers: { Origin: f.origin },
    data: body,
  })
  const value = await r.json()
  assert.equal(r.status(), status, `${name}: ${JSON.stringify(value)}`)
  assert.equal(value.error?.code, code, `${name}: ${JSON.stringify(value)}`)
  if (checkNoResidue) {
    assert.equal(
      await f.snapshot(allTables),
      before,
      `${name} ${code} must leave zero DB residue`
    )
  }
  return value
}

async function group(name: string, fn: () => Promise<void>) {
  await fn()
  groups.push({ group: name, pass: true })
}

const suffix = randomUUID().slice(0, 8)
const browser = await chromium.launch()
const context = await browser.newContext()

try {
  await f.start()
  const admin = await f.login("ADMIN")
  const second = await f.login("SECOND")
  await context.addCookies((await admin.storageState()).cookies)

  const cmd = (
    name: string,
    input: unknown,
    expected: Dependency[] = [],
    status = 200,
    client: APIRequestContext = admin,
    key = randomUUID()
  ) => f.command(client, name, envelope(input, expected, key), status)

  const supplier = await cmd(
    "createDirectoryParty",
    {
      type: "SUPPLIER",
      values: {
        name: `Sales Supplier ${suffix}`,
        category: "COMPANY",
        contacts: [
          {
            name: "Supplier Lead",
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
  const vendor = await cmd(
    "createDirectoryParty",
    {
      type: "REPAIR_VENDOR",
      values: {
        name: `Sales Vendor ${suffix}`,
        category: "COMPANY",
        specialisation: "Mechanical",
        contacts: [
          {
            name: "Mechanic",
            phone: "0112345679",
            role: "Workshop",
            primary: true,
          },
        ],
      },
    },
    [],
    201
  )

  const customerA = await cmd(
    "createCustomer",
    {
      fullName: `Buyer Alpha ${suffix}`,
      callingName: "Alpha",
      nicOrPassport: `NIC-A-${suffix}`,
      address: "100 Galle Road, Colombo",
      phone: "0771111111",
    },
    [],
    201
  )
  const custADto = await currentCustomer(admin, customerA.result.id)

  // Purchase V1 (cash, listed 15000, basis 10000) & receive RELEASE -> IN_STOCK (available=true)
  const p1 = await cmd(
    "recordPurchase",
    purchaseInput(supplier.result.id, suffix, "s1", 1000),
    [ref(supplier.result, "Supplier")],
    201
  )
  let c1 = await currentCycle(admin, p1.result.id)
  await cmd(
    "receiveStock",
    {
      cycleId: c1.id,
      date: "2026-10-02",
      disposition: { kind: "RELEASE" },
    },
    [ref(c1)]
  )
  c1 = await currentCycle(admin, c1.id)
  assert.equal(c1.status, "IN_STOCK")
  assert.equal(c1.available, true)

  // Purchase V2 (listed 25000, basis 20000) for DISCOUNT approval
  const p2Input = {
    ...purchaseInput(supplier.result.id, suffix, "s2", 2000),
    purchasePrice: "20000",
    listedPrice: "25000",
  }
  const p2 = await cmd("recordPurchase", p2Input, [ref(supplier.result, "Supplier")], 201)
  let c2 = await currentCycle(admin, p2.result.id)
  await cmd(
    "receiveStock",
    {
      cycleId: c2.id,
      date: "2026-10-02",
      disposition: { kind: "RELEASE" },
    },
    [ref(c2)]
  )
  c2 = await currentCycle(admin, c2.id)

  // Purchase V3 (listed 35000, basis 30000) for even TRADE_IN + deferred intake + WROF-02
  const p3Input = {
    ...purchaseInput(supplier.result.id, suffix, "s3", 3000),
    purchasePrice: "30000",
    listedPrice: "35000",
  }
  const p3 = await cmd("recordPurchase", p3Input, [ref(supplier.result, "Supplier")], 201)
  let c3 = await currentCycle(admin, p3.result.id)
  await cmd(
    "receiveStock",
    {
      cycleId: c3.id,
      date: "2026-10-02",
      disposition: { kind: "RELEASE" },
    },
    [ref(c3)]
  )
  c3 = await currentCycle(admin, c3.id)

  // Purchase V4 (listed 40000, basis 20000) for inline TRADE_IN + netCash > 0 + SALE_EDIT
  const p4Input = {
    ...purchaseInput(supplier.result.id, suffix, "s4", 4000),
    purchasePrice: "20000",
    listedPrice: "40000",
  }
  const p4 = await cmd("recordPurchase", p4Input, [ref(supplier.result, "Supplier")], 201)
  let c4 = await currentCycle(admin, p4.result.id)
  await cmd(
    "receiveStock",
    {
      cycleId: c4.id,
      date: "2026-10-02",
      disposition: { kind: "RELEASE" },
    },
    [ref(c4)]
  )
  c4 = await currentCycle(admin, c4.id)

  let sale1Id = ""
  let sale1ReceiptId = ""
  let tradeInCycleId = ""
  let sale4Id = ""

  await group(
    "G1 Immediate CASH sale, below-listed 409 APPROVAL_REQUIRED, mileage bounds, Customer links & real UI pages",
    async () => {
      // Below listed fails cleanly with 409 APPROVAL_REQUIRED and zero residue
      await statusBody(
        admin,
        "completeImmediate",
        envelope(
          {
            cycleId: c1.id,
            customerId: custADto.id,
            kind: "CASH",
            price: "14999",
            date: "2026-10-05",
            mileage: 1200,
            method: "CASH",
          },
          [ref(c1), ref(custADto, "Customer")]
        ),
        409,
        "APPROVAL_REQUIRED"
      )

      // Mileage below prior cycle mileage (1000) fails with 422 INVALID_INPUT
      await statusBody(
        admin,
        "completeImmediate",
        envelope(
          {
            cycleId: c1.id,
            customerId: custADto.id,
            kind: "CASH",
            price: "15000",
            date: "2026-10-05",
            mileage: 999,
            method: "CASH",
          },
          [ref(c1), ref(custADto, "Customer")]
        ),
        422,
        "INVALID_INPUT"
      )

      // Inline customer creation followed immediately by completeImmediate CASH
      const custB = await cmd(
        "createCustomer",
        {
          fullName: `Buyer Inline ${suffix}`,
          callingName: "Inline",
          nicOrPassport: `NIC-B-${suffix}`,
          address: "200 Duplication Rd",
          phone: "0772222222",
        },
        [],
        201
      )
      const custBDto = await currentCustomer(admin, custB.result.id)

      const saleKey = randomUUID()
      const applied = await cmd(
        "completeImmediate",
        {
          cycleId: c1.id,
          customerId: custBDto.id,
          kind: "CASH",
          price: "15000",
          date: "2026-10-05",
          mileage: 1250,
          method: "BANK_TRANSFER",
          reference: `INV-CASH-${suffix}`,
        },
        [ref(c1), ref(custBDto, "Customer")],
        201,
        admin,
        saleKey
      )
      sale1Id = applied.result.id
      assert.equal(applied.result.type, "SaleCase")

      // Replay with exact key produces identical result and zero DB change
      const beforeReplay = await f.snapshot(allTables)
      const replayed = await cmd(
        "completeImmediate",
        {
          cycleId: c1.id,
          customerId: custBDto.id,
          kind: "CASH",
          price: "15000",
          date: "2026-10-05",
          mileage: 1250,
          method: "BANK_TRANSFER",
          reference: `INV-CASH-${suffix}`,
        },
        [ref(c1), ref(custBDto, "Customer")],
        200,
        admin,
        saleKey
      )
      assert.equal(replayed.replayed, true)
      assert.equal(replayed.commandId, applied.commandId)
      assert.equal(await f.snapshot(allTables), beforeReplay)

      // Verify SaleDTO, PurchaseCycleDTO, VehicleDTO, CustomerDTO
      const s1 = await currentSale(admin, sale1Id)
      assert.equal(s1.state, "COMPLETED")
      assert.equal(s1.kind, "CASH")
      assert.equal(s1.price, "15000")
      assert.ok(s1.completion)
      assert.equal(s1.payments?.length, 1)
      assert.equal(s1.payments?.[0].direction, "IN")
      assert.equal(s1.payments?.[0].amount, "15000")
      sale1ReceiptId = s1.payments![0].id

      c1 = await currentCycle(admin, c1.id)
      assert.equal(c1.status, "SOLD")
      assert.equal(c1.available, false)
      assert.equal(c1.financial?.originalBasis, "10000")
      assert.equal(c1.financial?.salePrice, "15000")
      assert.equal(c1.financial?.originalProfit, "5000")
      assert.equal(c1.financial?.restatedProfit, "5000")
      assert.equal(c1.sales.length, 1)

      const v1 = await f.query<VehicleDTO>(admin, "vehicle", `?id=${c1.vehicleId}`)
      assert.equal(v1.status, "SOLD")
      assert.equal(v1.available, false)
      assert.ok(v1.mileage.some((m) => m.reading === 1250))
      const v1Db = await f.db.query(
        'SELECT "activePurchaseId" FROM vamotors."Vehicle" WHERE id=$1',
        [c1.vehicleId]
      )
      assert.equal(v1Db.rows[0].activePurchaseId, null)

      const custBAfter = await currentCustomer(admin, custBDto.id)
      const saleLink = custBAfter.links.find(
        (l) => l.type === "SALE" && l.id === sale1Id
      )
      assert.ok(saleLink)
      assert.equal(saleLink.amount, "15000")

      // Direct reversePayment with sourceType=SALE rejected
      await statusBody(
        admin,
        "reversePayment",
        envelope(
          {
            sourceType: "SALE",
            sourceId: s1.id,
            paymentId: sale1ReceiptId,
            reason: "Should fail",
          },
          [ref(c1), ref(s1, "SaleCase")]
        ),
        422,
        "INVALID_INPUT"
      )

      // Double sell already-SOLD cycle -> 409 INVALID_STATE
      await statusBody(
        admin,
        "completeImmediate",
        envelope(
          {
            cycleId: c1.id,
            customerId: custADto.id,
            kind: "CASH",
            price: "15000",
            date: "2026-10-06",
            mileage: 1300,
            method: "CASH",
          },
          [ref(c1), ref(custADto, "Customer")]
        ),
        409,
        "INVALID_STATE"
      )

      // Render real UI pages in Playwright browser (no mock data, real DB data present)
      const page: Page = await context.newPage()
      try {
        for (const [path, text] of [
          ["/sales", `EDIT-E-${suffix}-s1`],
          [`/sales/${sale1Id}`, `INV-CASH-${suffix}`],
          [`/purchases/${c1.id}`, "Original profit"],
          [`/customers/${custBDto.id}`, `SALE · ${sale1Id}`],
        ] as const) {
          const resp = await page.goto(`${f.origin}${path}`, {
            waitUntil: "networkidle",
          })
          assert.equal(resp?.status(), 200, `${path} returned ${resp?.status()}`)
          await page.getByText(text).first().waitFor({ timeout: 10000 })
        }
      } finally {
        await page.close()
      }
    }
  )

  await group(
    "G2 DISCOUNT approval workflow, stale invalidation, reject, approve atomic completion & commandStatus replay",
    async () => {
      const c2Before = await currentCycle(admin, c2.id)
      const beforeSnapshot = await f.snapshot([
        "SaleCase",
        "SaleReceipt",
        "SaleCompletion",
      ])

      // Propose DISCOUNT sale (22000 < listed 25000)
      const proposeKey = randomUUID()
      const proposed = (await cmd(
        "requestApproval",
        {
          proposal: {
            kind: "DISCOUNT",
            command: {
              name: "completeImmediate",
              input: {
                cycleId: c2.id,
                customerId: custADto.id,
                kind: "CASH",
                price: "22000",
                date: "2026-10-06",
                mileage: 2100,
                method: "CASH",
                reference: `DISC-${suffix}`,
              },
            },
          },
          reason: "Repeat customer discount",
        },
        [ref(c2Before), ref(custADto, "Customer")],
        202,
        admin,
        proposeKey
      )) as unknown as Pending

      assert.equal(proposed.status, "PENDING_APPROVAL")
      assert.ok(proposed.approvalId)
      // Zero sale side effects while PENDING
      assert.equal(
        await f.snapshot(["SaleCase", "SaleReceipt", "SaleCompletion"]),
        beforeSnapshot
      )
      // Verify reviewer notification links to /approvals/:id
      const inbox = await f.query<{ data: NotificationDTO[] }>(
        second,
        "notifications",
        "?pageSize=100"
      )
      const notif = inbox.data.find((n) => n.target.id === proposed.approvalId)
      assert.ok(notif)
      assert.equal(notif.target.href, `/approvals/${proposed.approvalId}`)

      // Self-review -> 403 SELF_REVIEW
      const apv1 = await currentApproval(second, proposed.approvalId)
      await statusBody(
        admin,
        "reviewApproval",
        envelope(
          {
            approvalId: apv1.id,
            decision: "APPROVE",
            note: "Self approve attempt",
          },
          [ref(apv1, "ApprovalRequest")]
        ),
        403,
        "SELF_REVIEW"
      )

      // Mutate cycle (addCost) -> old DISCOUNT approval must fail APPROVAL_STALE
      await cmd(
        "addCost",
        {
          cycleId: c2Before.id,
          category: "Detailing",
          description: "Polish",
          amount: "500",
          incurredDate: "2026-10-03",
        },
        [ref(c2Before)],
        201
      )
      const apv1Refreshed = await currentApproval(second, apv1.id)
      await statusBody(
        second,
        "reviewApproval",
        envelope(
          {
            approvalId: apv1Refreshed.id,
            decision: "APPROVE",
            note: "Should be stale after cost added",
          },
          [ref(apv1Refreshed, "ApprovalRequest"), ...apv1Refreshed.expected]
        ),
        409,
        "APPROVAL_STALE",
        false
      )

      // Reject flow on a fresh DISCOUNT request -> 0 sale effects
      c2 = await currentCycle(admin, c2.id)
      const propReject = (await cmd(
        "requestApproval",
        {
          proposal: {
            kind: "DISCOUNT",
            command: {
              name: "completeImmediate",
              input: {
                cycleId: c2.id,
                customerId: custADto.id,
                kind: "CASH",
                price: "21500",
                date: "2026-10-06",
                mileage: 2100,
                method: "CASH",
              },
            },
          },
          reason: "Too low discount",
        },
        [ref(c2), ref(custADto, "Customer")],
        202
      )) as unknown as Pending
      const apvReject = await currentApproval(second, propReject.approvalId)
      await cmd(
        "reviewApproval",
        {
          approvalId: apvReject.id,
          decision: "REJECT",
          note: "Margin too thin",
        },
        reviewDeps(apvReject),
        200,
        second
      )
      c2 = await currentCycle(admin, c2.id)
      assert.equal(c2.status, "IN_STOCK")
      assert.equal(c2.sales.length, 0)

      // Approve flow on valid DISCOUNT request -> atomically creates SaleCase + Completion + Receipt
      const propApproveKey = randomUUID()
      const propApprove = (await cmd(
        "requestApproval",
        {
          proposal: {
            kind: "DISCOUNT",
            command: {
              name: "completeImmediate",
              input: {
                cycleId: c2.id,
                customerId: custADto.id,
                kind: "CASH",
                price: "23500",
                date: "2026-10-06",
                mileage: 2100,
                method: "CASH",
                reference: `DISC-OK-${suffix}`,
              },
            },
          },
          reason: "Approved discount",
        },
        [ref(c2), ref(custADto, "Customer")],
        202,
        admin,
        propApproveKey
      )) as unknown as Pending
      const apvOk = await currentApproval(second, propApprove.approvalId)
      const reviewKey = randomUUID()
      const approved = await cmd(
        "reviewApproval",
        {
          approvalId: apvOk.id,
          decision: "APPROVE",
          note: "Looks good",
        },
        reviewDeps(apvOk),
        200,
        second,
        reviewKey
      )
      const sale2Effect = approved.affected.find((e) => e.type === "SaleCase")
      assert.ok(sale2Effect)
      const s2 = await currentSale(admin, sale2Effect.id)
      assert.equal(s2.state, "COMPLETED")
      assert.equal(s2.price, "23500")
      c2 = await currentCycle(admin, c2.id)
      assert.equal(c2.status, "SOLD")
      assert.equal(c2.financial?.originalProfit, "3000") // 23500 - (20000 + 500 cost)
      assert.equal(c2.financial?.restatedProfit, "3000")

      // commandStatus query replay + IDEMPOTENCY_MISMATCH
      const statusRes = await f.query<Applied>(
        second,
        "commandStatus",
        `?name=reviewApproval&idempotencyKey=${reviewKey}`
      )
      assert.equal(statusRes.status, "APPLIED")
      assert.equal(statusRes.commandId, approved.commandId)

      await statusBody(
        second,
        "reviewApproval",
        envelope(
          {
            approvalId: apvOk.id,
            decision: "REJECT",
            note: "Changed decision on same key",
          },
          reviewDeps(apvOk),
          reviewKey
        ),
        409,
        "IDEMPOTENCY_MISMATCH",
        false
      )

      // Check /approvals/:id SSR/navigation works
      const page = await context.newPage()
      try {
        const resp = await page.goto(`${f.origin}/approvals/${apvOk.id}`, {
          waitUntil: "networkidle",
        })
        assert.equal(resp?.status(), 200)
        await page.getByText("Approved discount").first().waitFor({ timeout: 10000 })
      } finally {
        await page.close()
      }
    }
  )

  await group(
    "G3 TRADE_IN even trade (0 receipts), OVERALLOWANCE 422, standalone intakeTradeIn, inline intake & repair/resale, WROF-02",
    async () => {
      // OVERALLOWANCE -> 422
      await statusBody(
        admin,
        "completeImmediate",
        envelope(
          {
            cycleId: c3.id,
            customerId: custADto.id,
            kind: "TRADE_IN",
            price: "35000",
            date: "2026-10-06",
            mileage: 3100,
            method: "CASH",
            tradeIn: {
              description: "Overpriced trade",
              value: "35001",
            },
          },
          [ref(c3), ref(custADto, "Customer")]
        ),
        422,
        "OVERALLOWANCE"
      )

      // Even trade (netCash = 0, no inline intake) -> 0 SaleReceipt rows
      const evenSale = await cmd(
        "completeImmediate",
        {
          cycleId: c3.id,
          customerId: custADto.id,
          kind: "TRADE_IN",
          price: "35000",
          date: "2026-10-06",
          mileage: 3100,
          method: "CASH",
          reference: `EVEN-${suffix}`,
          tradeIn: {
            description: "2018 Toyota Aqua Trade",
            value: "35000",
          },
        },
        [ref(c3), ref(custADto, "Customer")],
        201
      )
      const s3 = await currentSale(admin, evenSale.result.id)
      assert.equal(s3.kind, "TRADE_IN")
      assert.equal(s3.payments?.length ?? 0, 0)
      assert.equal(s3.tradeIn?.value, "35000")
      assert.equal(s3.tradeIn?.acquiredCycleId, undefined)

      // WROF-02: WRITE_OFF proposal on cycle with active/completed SaleCase fails with OBLIGATION_OPEN
      c3 = await currentCycle(admin, c3.id)
      await statusBody(
        admin,
        "requestApproval",
        envelope(
          {
            proposal: {
              kind: "WRITE_OFF",
              input: {
                cycleId: c3.id,
                date: "2026-10-07",
                method: "SCRAPPED",
                proceeds: "0",
                reason: "Scrap attempt after sale",
              },
            },
            reason: "WROF-02 guard check",
          },
          [
            ref(c3),
            { type: "Vehicle", id: c3.vehicleId, revision: c3.identityRevision },
          ]
        ),
        409,
        "OBLIGATION_OPEN"
      )

      // Standalone intakeTradeIn + idempotent replay
      const custARefreshed = await currentCustomer(admin, custADto.id)
      const intakeKey = randomUUID()
      const intaken = await cmd(
        "intakeTradeIn",
        {
          saleId: s3.id,
          vehicle: {
            engineNumber: `TI-ENG-${suffix}`,
            chassisNumber: `TI-CHS-${suffix}`,
            make: "Toyota",
            model: "Aqua",
            year: 2018,
            colour: "Silver",
            fuelType: "HYBRID",
            transmission: "AUTOMATIC",
          },
          mileage: { reading: 42000, date: "2026-10-06" },
          listedPrice: "38000",
        },
        [ref(s3, "SaleCase"), ref(c3)],
        201,
        admin,
        intakeKey
      )
      assert.equal(intaken.result.type, "SaleCase")
      const acquiredEffect = intaken.affected.find((e) => e.type === "PurchaseRecord")!
      assert.ok(acquiredEffect)
      const intakeReplay = await cmd(
        "intakeTradeIn",
        {
          saleId: s3.id,
          vehicle: {
            engineNumber: `TI-ENG-${suffix}`,
            chassisNumber: `TI-CHS-${suffix}`,
            make: "Toyota",
            model: "Aqua",
            year: 2018,
            colour: "Silver",
            fuelType: "HYBRID",
            transmission: "AUTOMATIC",
          },
          mileage: { reading: 42000, date: "2026-10-06" },
          listedPrice: "38000",
        },
        [ref(s3, "SaleCase"), ref(c3)],
        200,
        admin,
        intakeKey
      )
      assert.equal(intakeReplay.replayed, true)
      assert.equal(intakeReplay.commandId, intaken.commandId)

      const s3AfterIntake = await currentSale(admin, s3.id)
      assert.equal(s3AfterIntake.tradeIn?.acquiredCycleId, acquiredEffect.id)
      const tiCycle = await currentCycle(admin, acquiredEffect.id)
      assert.equal(tiCycle.acquisitionKind, "TRADE_IN")
      assert.equal(tiCycle.purchasePrice, "35000")
      assert.equal(tiCycle.outstanding?.seller, "0")
      assert.equal(tiCycle.payments.length, 0)

      const custAAfter = await currentCustomer(admin, custARefreshed.id)
      assert.ok(
        custAAfter.links.some(
          (l) => l.type === "PURCHASE" && l.id === tiCycle.id
        )
      )

      // Inline intake TRADE_IN with netCash > 0 (40000 - 15000 = 25000)
      const custC = await cmd(
        "createCustomer",
        {
          fullName: `Buyer TradeIn ${suffix}`,
          callingName: "TradeIn",
          nicOrPassport: `NIC-C-${suffix}`,
          address: "300 Kandy Rd",
          phone: "0773333333",
        },
        [],
        201
      )
      const custCDto = await currentCustomer(admin, custC.result.id)
      const inlineSale = await cmd(
        "completeImmediate",
        {
          cycleId: c4.id,
          customerId: custCDto.id,
          kind: "TRADE_IN",
          price: "40000",
          date: "2026-10-06",
          mileage: 4200,
          method: "BANK_TRANSFER",
          reference: `INLINE-TI-${suffix}`,
          tradeIn: {
            description: "2020 Suzuki Swift Trade",
            value: "15000",
            intake: {
              vehicle: {
                engineNumber: `TI2-ENG-${suffix}`,
                chassisNumber: `TI2-CHS-${suffix}`,
                make: "Suzuki",
                model: "Swift",
                year: 2020,
                colour: "Red",
                fuelType: "PETROL",
                transmission: "AUTOMATIC",
              },
              mileage: { reading: 28000, date: "2026-10-06" },
              listedPrice: "22000",
            },
          },
        },
        [ref(c4), ref(custCDto, "Customer")],
        201
      )
      sale4Id = inlineSale.result.id
      const s4 = await currentSale(admin, sale4Id)
      assert.equal(s4.payments?.length, 1)
      assert.equal(s4.payments?.[0].amount, "25000")
      assert.ok(s4.tradeIn?.acquiredCycleId)
      tradeInCycleId = s4.tradeIn!.acquiredCycleId!

      // Put acquired trade-in cycle through addCost + sendRepair + returnRepair
      let acquired = await currentCycle(admin, tradeInCycleId)
      assert.equal(acquired.financial?.basis, "15000")
      await cmd(
        "addCost",
        {
          cycleId: acquired.id,
          category: "Service",
          description: "Full service",
          amount: "1000",
          incurredDate: "2026-10-06",
        },
        [ref(acquired)],
        201
      )
      acquired = await currentCycle(admin, tradeInCycleId)
      await cmd(
        "receiveStock",
        {
          cycleId: acquired.id,
          date: "2026-10-06",
          disposition: { kind: "HOLD", reason: "Awaiting trade-in repair" },
        },
        [ref(acquired)]
      )
      acquired = await currentCycle(admin, tradeInCycleId)
      const repSent = await cmd(
        "sendRepair",
        {
          cycleId: acquired.id,
          vendorId: vendor.result.id,
          request: "Bumper paint",
          sentDate: "2026-10-07",
        },
        [ref(acquired), ref(vendor.result, "RepairVendor")],
        201
      )
      acquired = await currentCycle(admin, tradeInCycleId)
      await cmd(
        "returnRepair",
        {
          repairId: repSent.result.id,
          invoiceAmount: "500",
          invoiceDate: "2026-10-07",
          returnedDate: "2026-10-07",
          summary: "Bumper painted",
        },
        [ref(acquired), ref(repSent.result, "RepairRecord")]
      )
      acquired = await currentCycle(admin, tradeInCycleId)
      assert.equal(acquired.financial?.basis, "16500") // 15000 + 1000 + 500
    }
  )

  await group(
    "G4 SALE_EDIT approval (immutable originalProfit, SaleCorrection, receipt reversal/replacement, open trade-in basis restatement, closed trade-in block) & post-close SOLD editCost",
    async () => {
      // Request SALE_EDIT on s4: change price 40000 -> 42000, tradeIn.value 15000 -> 16000, reverse old 25000 receipt and record 26000
      let s4 = await currentSale(admin, sale4Id)
      let soldCycle4 = await currentCycle(admin, s4.cycleId)
      let acqCycle = await currentCycle(admin, tradeInCycleId)
      const originalReceiptId = s4.payments![0].id

      const editProposal = (await cmd(
        "requestApproval",
        {
          proposal: {
            kind: "SALE_EDIT",
            operation: "EDIT_COMPLETION",
            input: {
              saleId: s4.id,
              reason: "Agreed updated invoice after trade appraisal",
              patch: {
                price: "42000",
                reference: `INLINE-TI-EDITED-${suffix}`,
                saleDate: "2026-10-06",
                handoverMileage: 4250,
                tradeIn: {
                  description: "2020 Suzuki Swift Trade Revised",
                  value: "16000",
                },
              },
              cashCorrections: [
                {
                  paymentId: originalReceiptId,
                  reason: "Correct price and trade-in value",
                  replacement: {
                    amount: "26000",
                    date: "2026-10-06",
                    method: "BANK_TRANSFER",
                    reference: `REPL-${suffix}`,
                  },
                },
              ],
            },
          },
          reason: "Agreed updated invoice after trade appraisal",
        },
        [ref(s4, "SaleCase"), ref(soldCycle4), ref(acqCycle)],
        202
      )) as unknown as Pending

      const apvEdit = await currentApproval(second, editProposal.approvalId)
      await cmd(
        "reviewApproval",
        {
          approvalId: apvEdit.id,
          decision: "APPROVE",
          note: "Confirmed updated contract",
        },
        reviewDeps(apvEdit),
        200,
        second
      )

      s4 = await currentSale(admin, sale4Id)
      assert.equal(s4.price, "42000")
      assert.equal(s4.reference, `INLINE-TI-EDITED-${suffix}`)
      assert.equal(s4.payments?.length, 3)
      assert.equal(s4.tradeIn?.value, "16000")

      soldCycle4 = await currentCycle(admin, s4.cycleId)
      assert.equal(soldCycle4.financial?.originalProfit, "20000") // immutable 40000 - 20000
      assert.equal(soldCycle4.financial?.restatedProfit, "22000") // 42000 - 20000

      // Acquired trade-in cycle basis restated (15000->16000 + 1000 cost + 500 repair = 17500)
      acqCycle = await currentCycle(admin, tradeInCycleId)
      assert.equal(acqCycle.purchasePrice, "16000")
      assert.equal(acqCycle.financial?.basis, "17500")

      // Sell acquired trade-in cycle -> then try SALE_EDIT mutating tradeIn.value -> 409 OBLIGATION_OPEN
      await cmd(
        "releaseStock",
        { cycleId: acqCycle.id },
        [ref(acqCycle)]
      )
      acqCycle = await currentCycle(admin, tradeInCycleId)
      const custADtoNow = await currentCustomer(admin, custADto.id)
      await cmd(
        "completeImmediate",
        {
          cycleId: acqCycle.id,
          customerId: custADtoNow.id,
          kind: "CASH",
          price: "22000",
          date: "2026-10-08",
          mileage: 28050,
          method: "CASH",
        },
        [ref(acqCycle), ref(custADtoNow, "Customer")],
        201
      )

      s4 = await currentSale(admin, sale4Id)
      soldCycle4 = await currentCycle(admin, s4.cycleId)
      acqCycle = await currentCycle(admin, tradeInCycleId)
      await statusBody(
        admin,
        "requestApproval",
        envelope(
          {
            proposal: {
              kind: "SALE_EDIT",
              operation: "EDIT_COMPLETION",
              input: {
                saleId: s4.id,
                reason: "Must fail since trade-in cycle already sold",
                patch: {
                  tradeIn: {
                    description: "Locked trade-in",
                    value: "17000",
                  },
                },
                cashCorrections: [],
              },
            },
            reason: "Must fail since trade-in cycle already sold",
          },
          [ref(s4, "SaleCase"), ref(soldCycle4), ref(acqCycle)]
        ),
        409,
        "OBLIGATION_OPEN"
      )

      // Post-close SOLD cycle editCost -> restatedProfit changes while originalProfit stays frozen
      c2 = await currentCycle(admin, c2.id)
      const c2Cost = c2.costs[0]!
      await cmd(
        "editCost",
        {
          costId: c2Cost.id,
          amount: "800",
          category: c2Cost.category,
          description: "Adjusted detailing invoice post-sale",
          incurredDate: c2Cost.incurredDate,
          reason: "Late supplier surcharge",
        },
        [ref(c2), ref(c2Cost, "VehicleCost")]
      )
      c2 = await currentCycle(admin, c2.id)
      assert.equal(c2.financial?.originalBasis, "20500")
      assert.equal(c2.financial?.basis, "20800")
      assert.equal(c2.financial?.originalProfit, "3000")
      assert.equal(c2.financial?.restatedProfit, "2700")

      // Post-close SOLD cycle blocks addCost / sendRepair
      await statusBody(
        admin,
        "addCost",
        envelope(
          {
            cycleId: c2.id,
            category: "Other",
            description: "Blocked",
            amount: "100",
            incurredDate: "2026-10-08",
          },
          [ref(c2)]
        ),
        409,
        "INVALID_STATE"
      )
      await statusBody(
        admin,
        "sendRepair",
        envelope(
          {
            cycleId: c2.id,
            vendorId: vendor.result.id,
            request: "Blocked post-sale repair",
            sentDate: "2026-10-08",
          },
          [ref(c2), ref(vendor.result, "RepairVendor")]
        ),
        409,
        "INVALID_STATE"
      )
    }
  )

  await group(
    "G5 Repurchase VPRC-05..09 & REPR-04 (recordPurchase + TRADE_IN repurchase, IDENTITY_CONFLICT, IDENTITY_WRITTEN_OFF, cycle-scoped vs vehicle repairs)",
    async () => {
      c1 = await currentCycle(admin, c1.id)
      const c1Base = purchaseInput(supplier.result.id, suffix, "s1")

      // Conflicting physical identity -> 409 IDENTITY_CONFLICT with Vehicle ref
      const conflictRes = await statusBody(
        admin,
        "recordPurchase",
        envelope(
          {
            ...c1Base,
            vehicle: { ...c1Base.vehicle, make: "WrongMake" },
            purchaseDate: "2026-10-09",
            mileage: { reading: 1300, date: "2026-10-09" },
          },
          [
            ref(supplier.result, "Supplier"),
            { type: "Vehicle", id: c1.vehicleId, revision: c1.identityRevision },
          ]
        ),
        409,
        "IDENTITY_CONFLICT"
      )
      assert.equal(conflictRes.error.current?.[0]?.type, "Vehicle")
      assert.equal(conflictRes.error.current?.[0]?.id, c1.vehicleId)

      // Date before prior saleDate (2026-10-05) -> 422 INVALID_INPUT
      await statusBody(
        admin,
        "recordPurchase",
        envelope(
          {
            ...c1Base,
            purchaseDate: "2026-10-04",
            mileage: { reading: 1300, date: "2026-10-04" },
          },
          [
            ref(supplier.result, "Supplier"),
            { type: "Vehicle", id: c1.vehicleId, revision: c1.identityRevision },
          ]
        ),
        422,
        "INVALID_INPUT"
      )

      // Valid repurchase of c1 (SOLD on 2026-10-05, mileage 1250) -> cycleNumber = 2
      const v1Before = await f.query<VehicleDTO>(admin, "vehicle", `?id=${c1.vehicleId}`)
      const repurchase = await cmd(
        "recordPurchase",
        {
          ...c1Base,
          purchasePrice: "12000",
          listedPrice: "17000",
          purchaseDate: "2026-10-09",
          mileage: {
            reading: 1200,
            date: "2026-10-09",
            decreaseReason: "Cluster swapped after prior sale",
          },
        },
        [
          ref(supplier.result, "Supplier"),
          { type: "Vehicle", id: v1Before.id, revision: v1Before.identityRevision },
        ],
        201
      )
      const c1Cycle2 = await currentCycle(admin, repurchase.result.id)
      assert.equal(c1Cycle2.vehicleId, c1.vehicleId)
      assert.equal(c1Cycle2.cycleNumber, 2)
      assert.equal(c1Cycle2.repairs.length, 0)

      // Acquired trade-in cycle had 1 repair (cycle 1); repurchase shows 0 repairs on cycle 2 while Vehicle DB has 1
      const tiSold = await currentCycle(admin, tradeInCycleId)
      const vTi = await f.query<VehicleDTO>(admin, "vehicle", `?id=${tiSold.vehicleId}`)
      assert.equal(tiSold.repairs.length, 1)
      const tiRepurchase = await cmd(
        "recordPurchase",
        {
          supplierId: supplier.result.id,
          vehicle: {
            engineNumber: `TI2-ENG-${suffix}`,
            chassisNumber: `TI2-CHS-${suffix}`,
            make: "Suzuki",
            model: "Swift",
            year: 2020,
            colour: "Red",
            fuelType: "PETROL",
            transmission: "AUTOMATIC",
          },
          purchaseType: "BRAND_NEW",
          purchasePrice: "18000",
          listedPrice: "23000",
          purchaseDate: "2026-10-09",
          mileage: { reading: 28100, date: "2026-10-09" },
          paymentMethod: "CASH",
        },
        [
          ref(supplier.result, "Supplier"),
          { type: "Vehicle", id: vTi.id, revision: vTi.identityRevision },
        ],
        201
      )
      const tiCycle2 = await currentCycle(admin, tiRepurchase.result.id)
      assert.equal(tiCycle2.cycleNumber, 2)
      assert.equal(tiCycle2.repairs.length, 0)
      const vTiRepairs = await f.db.query(
        'SELECT count(*)::int c FROM vamotors."RepairRecord" r JOIN vamotors."PurchaseRecord" p ON p.id=r."cycleId" WHERE p."vehicleId"=$1',
        [tiSold.vehicleId]
      )
      assert.equal(vTiRepairs.rows[0].c, 1)

      // Written-off vehicle cannot be repurchased -> 409 IDENTITY_WRITTEN_OFF
      const pWriteOff = await cmd(
        "recordPurchase",
        purchaseInput(supplier.result.id, suffix, "wo", 500),
        [ref(supplier.result, "Supplier")],
        201
      )
      let cWo = await currentCycle(admin, pWriteOff.result.id)
      await cmd(
        "receiveStock",
        {
          cycleId: cWo.id,
          date: "2026-10-02",
          disposition: { kind: "HOLD", reason: "Total loss test" },
        },
        [ref(cWo)]
      )
      cWo = await currentCycle(admin, cWo.id)
      const woProp = (await cmd(
        "requestApproval",
        {
          proposal: {
            kind: "WRITE_OFF",
            input: {
              cycleId: cWo.id,
              date: "2026-10-03",
              method: "SCRAPPED",
              proceeds: "0",
              reason: "Flood total loss",
            },
          },
          reason: "Flood damage",
        },
        [
          ref(cWo),
          { type: "Vehicle", id: cWo.vehicleId, revision: cWo.identityRevision },
        ],
        202
      )) as unknown as Pending
      const woApv = await currentApproval(second, woProp.approvalId)
      await cmd(
        "reviewApproval",
        { approvalId: woApv.id, decision: "APPROVE", note: "Verified total loss" },
        reviewDeps(woApv),
        200,
        second
      )
      const vWo = await f.query<VehicleDTO>(admin, "vehicle", `?id=${cWo.vehicleId}`)
      const woBase = purchaseInput(supplier.result.id, suffix, "wo")
      await statusBody(
        admin,
        "recordPurchase",
        envelope(
          {
            ...woBase,
            purchaseDate: "2026-10-09",
            mileage: { reading: 600, date: "2026-10-09" },
          },
          [
            ref(supplier.result, "Supplier"),
            { type: "Vehicle", id: vWo.id, revision: vWo.identityRevision },
          ]
        ),
        409,
        "IDENTITY_WRITTEN_OFF"
      )
    }
  )

  await group(
    "G6 Concurrency double-sell race, scoped SaleCase RBAC/redaction, and PostgreSQL trigger/vamotors_runtime checks",
    async () => {
      // Concurrency: two simultaneous completeImmediate requests on fresh IN_STOCK cycle -> 1x201, 1x409
      const pRace = await cmd(
        "recordPurchase",
        purchaseInput(supplier.result.id, suffix, "race", 100),
        [ref(supplier.result, "Supplier")],
        201
      )
      let cRace = await currentCycle(admin, pRace.result.id)
      await cmd(
        "receiveStock",
        {
          cycleId: cRace.id,
          date: "2026-10-02",
          disposition: { kind: "RELEASE" },
        },
        [ref(cRace)]
      )
      cRace = await currentCycle(admin, cRace.id)
      const custCur = await currentCustomer(admin, custADto.id)

      const makeRaceReq = () =>
        admin.post("/api/v1/commands/completeImmediate", {
          headers: { Origin: f.origin },
          data: envelope(
            {
              cycleId: cRace.id,
              customerId: custCur.id,
              kind: "CASH",
              price: "15000",
              date: "2026-10-09",
              mileage: 200,
              method: "CASH",
            },
            [ref(cRace), ref(custCur, "Customer")]
          ),
        })
      const [r1, r2] = await Promise.all([makeRaceReq(), makeRaceReq()])
      const statuses = [r1.status(), r2.status()].sort((a, b) => a - b)
      assert.deepEqual(statuses, [201, 409])

      // Scoped role & customer links amount redaction
      const limitedRole = await cmd(
        "saveRole",
        {
          name: `Sales Limited ${suffix}`,
          grants: [
            {
              subject: "SaleCase",
              action: "read",
              fields: ["id", "cycleId", "customerId", "kind", "state", "completion.date"],
            },
            {
              subject: "Customer",
              action: "read",
              fields: ["id", "fullName", "callingName", "links"],
            },
          ],
          reason: "Least privilege sales viewer",
        },
        [],
        201
      )
      const limitedEmail = `sales-limited-${suffix}@example.test`
      const limitedPass = `TestPass-${randomUUID()}`
      await cmd(
        "createUser",
        {
          name: "Limited Viewer",
          email: limitedEmail,
          password: limitedPass,
          roleIds: [limitedRole.result.id],
        },
        [ref(limitedRole.result, "Role")],
        201
      )
      const limitedClient = await request.newContext({ baseURL: f.origin })
      const loginResp = await limitedClient.post("/api/auth/sign-in/email", {
        headers: { Origin: f.origin },
        data: { email: limitedEmail, password: limitedPass },
      })
      assert.equal(loginResp.status(), 200)
      try {
        const sView = await currentSale(limitedClient, sale1Id)
        assert.equal(sView.price, undefined)
        assert.ok(sView.redactedFields?.includes("price"))

        const custView = await currentCustomer(limitedClient, sView.customerId)
        const sLink = custView.links.find((l) => l.id === sale1Id)
        assert.ok(sLink)
        assert.equal(sLink.amount, undefined)
        assert.ok((custView as CustomerDTO & { redactedFields?: string[] }).redactedFields?.includes("links.amount"))
      } finally {
        await limitedClient.dispose()
      }

      // Direct PostgreSQL vamotors_runtime checks: cannot DELETE/UPDATE append-only SaleReceipt or SaleCompletion
      for (const stmt of [
        `DELETE FROM vamotors."SaleReceipt" WHERE id = '${sale1ReceiptId}'`,
        `UPDATE vamotors."SaleReceipt" SET amount = 1 WHERE id = '${sale1ReceiptId}'`,
        `DELETE FROM vamotors."SaleCompletion" WHERE "saleCaseId" = '${sale1Id}'`,
      ]) {
        await assert.rejects(f.restricted.query(stmt))
      }

      // Trigger integrity check as migrator: forged zero SaleReceipt fails check constraint / trigger
      await assert.rejects(
        f.db.query(
          `INSERT INTO vamotors."SaleReceipt" (id,"saleCaseId","purchaseRecordId",amount,direction,category,"occurredDate",method,currency,scale,"createdBy","commandId","lineKey") VALUES ($1,$2,$3,0,'IN','SALE','2026-10-09','CASH','LKR',2,$4,$5,'test')`,
          [randomUUID(), sale1Id, c1.id, randomUUID(), randomUUID()]
        )
      )
    }
  )

  await second.dispose()
  await admin.dispose()
} finally {
  await context.close()
  await browser.close()
  await f.close()
  await writeFile(
    join(root, `sales-check-${Date.now()}.json`),
    JSON.stringify({ source: process.cwd(), groups }, null, 2) + "\n",
    { mode: 0o600 }
  )
}
console.log(JSON.stringify({ groups: groups.length, pass: true }))
