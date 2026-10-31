/** Reach A/C with real invoices/cash and exact reversals, never seeded totals.
 * 100 returned invoices of A + actual acquisition99 == C exactly. */
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import type {
  Dependency,
  Pending,
  PurchaseCycleDTO,
} from "../../.planning/implementation/contracts/api"
import { fixture, envelope, purchaseInput, ref } from "./cycle-edits-fixture"

process.umask(0o077)
const root = process.argv[2]
assert.ok(root)
const f = await fixture(root),
  suffix = randomUUID().slice(0, 8)
const A = "99999999999999",
  C = "9999999999999999"
const tables = [
  "Vehicle",
  "PurchaseRecord",
  "RepairRecord",
  "RepairPayment",
  "PurchasePayment",
  "VehicleCost",
  "CostPayment",
  "CycleBasisVersion",
  "MileageReading",
  "ApprovalRequest",
  "Disposal",
  "DisposalReceipt",
  "StatusEvent",
  "CommandReceipt",
  "AuditEntry",
  "EntityReadVersion",
  "Notification",
  "BusinessSequence",
]
const groups: string[] = []
let stage = "initialize",
  cycleId = "",
  repairId = ""
async function group(name: string, run: () => Promise<void>) {
  stage = name
  await run()
  groups.push(name)
  console.log(`PASS ${name}`)
}
try {
  await f.start()
  const admin = await f.login("ADMIN"),
    reviewer = await f.login("SECOND")
  const cmd = (
    name: string,
    input: unknown,
    expected: Dependency[] = [],
    status = 200
  ) => f.command(admin, name, envelope(input, expected), status)
  const current = () =>
    f.query<PurchaseCycleDTO>(admin, "purchase", `?cycleId=${cycleId}`)
  const repairRefs = (r: PurchaseCycleDTO) => [
    ref(r),
    ref(r.repairs.find((r) => r.id === repairId)!, "RepairRecord"),
  ]
  async function denied(
    name: string,
    input: unknown,
    expected: Dependency[],
    code: string,
    client = admin
  ) {
    const before = await f.snapshot(tables)
    const response = await client.post(`/api/v1/commands/${name}`, {
      headers: { Origin: f.origin },
      data: envelope(input, expected),
    })
    const value = await response.json()
    assert.equal(response.status(), 422, JSON.stringify(value))
    assert.equal(value.error.code, code)
    assert.equal(await f.snapshot(tables), before)
  }
  const supplier = await cmd(
    "createDirectoryParty",
    {
      type: "SUPPLIER",
      values: {
        name: `Bound supplier ${suffix}`,
        category: "COMPANY",
        contacts: [],
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
        name: `Bound actual workshop ${suffix}`,
        category: "COMPANY",
        contacts: [],
      },
    },
    [],
    201
  )
  cycleId = (
    await cmd(
      "recordPurchase",
      {
        ...purchaseInput(supplier.result.id, suffix, "repair-bounds"),
        purchasePrice: "99",
      },
      [ref(supplier.result, "Supplier")],
      201
    )
  ).result.id
  let row = await current()
  await cmd(
    "receiveStock",
    {
      cycleId,
      date: "2026-10-02",
      disposition: { kind: "HOLD", reason: "Actual inspection" },
    },
    [ref(row)]
  )
  row = await current()
  await group(
    "date and per-invoice A+1 reject with no durable effects",
    async () => {
      await denied(
        "sendRepair",
        {
          cycleId,
          vendorId: vendor.result.id,
          request: "Invalid chronology",
          sentDate: "2026-09-30",
        },
        [ref(row), ref(vendor.result, "RepairVendor")],
        "INVALID_INPUT"
      )
      repairId = (
        await cmd(
          "sendRepair",
          {
            cycleId,
            vendorId: vendor.result.id,
            request: "Actual boundary work 1",
            sentDate: "2026-10-03",
          },
          [ref(row), ref(vendor.result, "RepairVendor")],
          201
        )
      ).result.id
      row = await current()
      const terms = {
        repairId,
        invoiceAmount: "100000000000000",
        invoiceDate: "2026-10-04",
        returnedDate: "2026-10-04",
        summary: "Actual invoice boundary",
      }
      await denied("returnRepair", terms, repairRefs(row), "MONEY_OVERFLOW")
      await denied(
        "returnRepair",
        { ...terms, invoiceAmount: "0", invoiceDate: "2026-10-05" },
        repairRefs(row),
        "INVALID_INPUT"
      )
      await denied(
        "returnRepair",
        {
          ...terms,
          invoiceAmount: "0",
          payment: { amount: "1", date: "2026-09-25", method: "CASH" },
        },
        repairRefs(row),
        "BALANCE_MISMATCH"
      )
    }
  )
  await group(
    "100 actual consecutive returns/payments reach basisC and gross cashOutC without fake histories",
    async () => {
      for (let n = 0; n < 100; n++) {
        if (n > 0) {
          repairId = (
            await cmd(
              "sendRepair",
              {
                cycleId,
                vendorId: vendor.result.id,
                request: `Actual boundary work ${n + 1}`,
                sentDate: "2026-10-04",
              },
              [ref(row), ref(vendor.result, "RepairVendor")],
              201
            )
          ).result.id
          row = await current()
        }
        await cmd(
          "returnRepair",
          {
            repairId,
            invoiceAmount: A,
            invoiceDate: "2026-10-04",
            returnedDate: "2026-10-04",
            summary: `Actual boundary invoice ${n + 1}`,
            payment: { amount: A, date: "2026-09-25", method: "CASH" },
          },
          repairRefs(row)
        )
        row = await current()
      }
      assert.equal(row.repairs.length, 100)
      assert.equal(row.financial!.repairs, "9999999999999900")
      assert.equal(row.financial!.basis, C)
      assert.equal(row.financial!.cashOut, C)
      assert.equal(row.available, false)
    }
  )
  await group(
    "actual next invoice/addCost C+1 reject atomically; an actual zero invoice is lawful and remains held",
    async () => {
      await denied(
        "addCost",
        {
          cycleId,
          category: "Actual",
          description: "Would exceed current basis",
          amount: "1",
          incurredDate: "2026-10-04",
        },
        [ref(row)],
        "MONEY_OVERFLOW"
      )
      repairId = (
        await cmd(
          "sendRepair",
          {
            cycleId,
            vendorId: vendor.result.id,
            request: "Actual zero invoice work",
            sentDate: "2026-10-04",
          },
          [ref(row), ref(vendor.result, "RepairVendor")],
          201
        )
      ).result.id
      row = await current()
      const terms = {
        repairId,
        invoiceAmount: "1",
        invoiceDate: "2026-10-04",
        returnedDate: "2026-10-04",
        summary: "Actual no-charge return",
      }
      await denied("returnRepair", terms, repairRefs(row), "MONEY_OVERFLOW")
      await cmd(
        "returnRepair",
        { ...terms, invoiceAmount: "0" },
        repairRefs(row)
      )
      row = await current()
      assert.equal(row.financial!.basis, C)
      assert.equal(
        row.repairs.find((r) => r.id === repairId)!.invoiceAmount,
        "0"
      )
      assert.equal(row.holdReason, "RETURNED_AWAITING_RELEASE")
    }
  )
  await group(
    "cash-only exact reversal frees net liability, not gross history; next grossOut C+1 rejects",
    async () => {
      const target = row.repairs.find((r) => r.payments.length)!
      repairId = target.id
      await cmd(
        "reversePayment",
        {
          sourceType: "REPAIR",
          sourceId: target.id,
          paymentId: target.payments[0].id,
          reason: "Actual original-entry correction for gross cap",
        },
        repairRefs(row)
      )
      row = await current()
      await denied(
        "payRepair",
        {
          repairId,
          payment: { amount: "1", date: "2026-10-05", method: "CASH" },
        },
        repairRefs(row),
        "MONEY_OVERFLOW"
      )
      assert.equal(row.financial!.basis, C)
      assert.equal(row.financial!.cashOut, C)
    }
  )
  await group(
    "real immutable opposites reach grossIn C; actual disposal proceeds C+1 review fails without closing or cash",
    async () => {
      const targets = row.repairs.filter((r) => r.payments.length === 1)
      for (const target of targets) {
        repairId = target.id
        await cmd(
          "reversePayment",
          {
            sourceType: "REPAIR",
            sourceId: target.id,
            paymentId: target.payments[0].id,
            reason: "Actual original-entry correction, no refund",
          },
          repairRefs(row)
        )
        row = await current()
      }
      await cmd(
        "reversePayment",
        {
          sourceType: "PURCHASE",
          sourceId: row.id,
          paymentId: row.payments[0].id,
          reason: "Actual acquisition cash correction",
        },
        [ref(row)]
      )
      row = await current()
      assert.equal(row.financial!.cashIn, C)
      assert.equal(row.financial!.cashOut, C)
      const refs: Dependency[] = [
        ref(row),
        { type: "Vehicle", id: row.vehicleId, revision: row.identityRevision },
      ]
      const pending = (await f.command(
        admin,
        "requestApproval",
        envelope(
          {
            proposal: {
              kind: "WRITE_OFF",
              input: {
                cycleId,
                date: "2026-10-06",
                reason: "Actual proposed disposal at gross boundary",
                method: "SCRAPPED",
                proceeds: "1",
                receipt: { amount: "1", date: "2026-10-06", method: "CASH" },
              },
            },
            reason: "Actual independent gross review",
          },
          refs
        ),
        202
      )) as unknown as Pending
      await denied(
        "reviewApproval",
        { approvalId: pending.approvalId, decision: "APPROVE" },
        [
          ref(
            { id: pending.approvalId, revision: pending.revision },
            "ApprovalRequest"
          ),
          ...refs,
        ],
        "MONEY_OVERFLOW",
        reviewer
      )
      assert.equal((await current()).status, "IN_STOCK")
      assert.equal(
        (
          await f.db.query(
            'SELECT count(*) n FROM vamotors."Disposal" WHERE "cycleId"=$1',
            [cycleId]
          )
        ).rows[0].n,
        "0"
      )
    }
  )
} catch (error) {
  console.error(
    `FAIL ${stage}: ${error instanceof Error ? error.message : "unknown"}`
  )
  process.exitCode = 1
} finally {
  await writeFile(
    join(root, `repair-bounds-${suffix}-summary.json`),
    JSON.stringify(
      {
        stage,
        groups,
        cycleId,
        repairId,
        source: process.cwd(),
        scope:
          "Actual repair invoice/net/gross A/C/C+1 and source dates only; no blanket final acceptance",
      },
      null,
      2
    ),
    { mode: 0o600, flag: "wx" }
  )
  await f.close()
}
