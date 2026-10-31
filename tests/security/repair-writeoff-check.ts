/** Real repair -> stale proposal -> fresh approved write-off -> old liability.
 * Focused reconciliation evidence, never a synthetic terminal fixture or final
 * fresh/nonempty-upgrade/restart/files/full-security acceptance substitute. */
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { APIRequestContext } from "@playwright/test"
import type {
  Applied,
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
const tables = [
  "Vehicle",
  "PurchaseRecord",
  "RepairRecord",
  "RepairPayment",
  "PurchasePayment",
  "VehicleCost",
  "CostPayment",
  "LeasePurchaseDetail",
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
const groups: string[] = [],
  intents: {
    name: string
    body: ReturnType<typeof envelope>
    result: Applied
  }[] = []
let stage = "initialize",
  cycleId = "",
  repairId = ""
const current = (client: APIRequestContext) =>
  f.query<PurchaseCycleDTO>(client, "purchase", `?cycleId=${cycleId}`)
const cycleRefs = (row: PurchaseCycleDTO): Dependency[] => [
  ref(row),
  { type: "Vehicle", id: row.vehicleId, revision: row.identityRevision },
]
const repairRefs = (row: PurchaseCycleDTO): Dependency[] => [
  ref(row),
  ref(row.repairs.find((r) => r.id === repairId)!, "RepairRecord"),
]
async function group(name: string, run: () => Promise<void>) {
  stage = name
  await run()
  groups.push(name)
  console.log(`PASS ${name}`)
}
async function denied(
  client: APIRequestContext,
  name: string,
  body: unknown,
  status: number,
  code: string
) {
  const before = await f.snapshot(tables)
  const response = await client.post(`/api/v1/commands/${name}`, {
    headers: { Origin: f.origin },
    data: body,
  })
  const value = await response.json()
  assert.equal(response.status(), status, JSON.stringify(value))
  assert.equal(value.error.code, code)
  assert.equal(await f.snapshot(tables), before, `${name} ${code}: no effects`)
}
try {
  await f.start()
  let admin = await f.login("ADMIN")
  const reviewer = await f.login("SECOND")
  const cmd = (
    name: string,
    input: unknown,
    expected: Dependency[] = [],
    status = 200
  ) => f.command(admin, name, envelope(input, expected), status)
  const record = async (
    name: string,
    input: unknown,
    expected: Dependency[],
    status = 200
  ) => {
    const body = envelope(input, expected),
      result = await f.command(admin, name, body, status)
    intents.push({ name, body, result })
    return result
  }
  const supplier = await cmd(
    "createDirectoryParty",
    {
      type: "SUPPLIER",
      values: {
        name: `Repair close supplier ${suffix}`,
        category: "COMPANY",
        contacts: [],
      },
    },
    [],
    201
  )
  let vendor = await cmd(
    "createDirectoryParty",
    {
      type: "REPAIR_VENDOR",
      values: {
        name: `Repair close vendor ${suffix}`,
        category: "COMPANY",
        specialisation: "Mechanical",
        contacts: [],
      },
    },
    [],
    201
  )
  cycleId = (
    await cmd(
      "recordPurchase",
      purchaseInput(supplier.result.id, suffix, "close"),
      [ref(supplier.result, "Supplier")],
      201
    )
  ).result.id
  let row = await current(admin)
  await cmd(
    "receiveStock",
    {
      cycleId,
      date: "2026-10-02",
      disposition: { kind: "HOLD", reason: "Inspection" },
    },
    [ref(row)]
  )
  row = await current(admin)
  const proposal = () => ({
    proposal: {
      kind: "WRITE_OFF",
      input: {
        cycleId,
        date: "2026-10-06",
        reason: "Actual disposal following repair return",
        method: "SCRAPPED",
        proceeds: "200",
        receipt: { amount: "200", date: "2026-09-25", method: "CASH" },
      },
    },
    reason: "Independent review required",
  })
  const old = (await f.command(
    admin,
    "requestApproval",
    envelope(proposal(), cycleRefs(row)),
    202
  )) as unknown as Pending
  const oldReview = envelope(
    { approvalId: old.approvalId, decision: "APPROVE" },
    [
      ref({ id: old.approvalId, revision: old.revision }, "ApprovalRequest"),
      ...cycleRefs(row),
    ]
  )
  await group(
    "real pending write-off proposal, actual dispatch and open-repair write-off block",
    async () => {
      repairId = (
        await record(
          "sendRepair",
          {
            cycleId,
            vendorId: vendor.result.id,
            request: "Actual workshop work",
            sentDate: "2026-10-03",
          },
          [ref(row), ref(vendor.result, "RepairVendor")],
          201
        )
      ).result.id
      row = await current(admin)
      assert.equal(row.status, "IN_REPAIR")
      await denied(
        admin,
        "requestApproval",
        envelope(proposal(), cycleRefs(row)),
        409,
        "OBLIGATION_OPEN"
      )
      await denied(reviewer, "reviewApproval", oldReview, 409, "APPROVAL_STALE")
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
  await group(
    "archived vendor actual unpaid return stales old proposal; fresh actual approval closes the same cycle",
    async () => {
      vendor = await cmd(
        "archiveParty",
        {
          type: "REPAIR_VENDOR",
          id: vendor.result.id,
          active: false,
          reason: "Keep actual old vendor liability",
        },
        [ref(vendor.result, "RepairVendor")]
      )
      await record(
        "returnRepair",
        {
          repairId,
          invoiceAmount: "1000",
          invoiceDate: "2026-10-03",
          returnedDate: "2026-10-04",
          summary: "Actual completed work",
        },
        repairRefs(row)
      )
      row = await current(admin)
      assert.equal(row.holdReason, "RETURNED_AWAITING_RELEASE")
      assert.equal(row.financial!.basis, "11000")
      await denied(reviewer, "reviewApproval", oldReview, 409, "APPROVAL_STALE")
      await cmd(
        "addCost",
        {
          cycleId,
          category: "Transport",
          description: "Actual cost",
          amount: "500",
          incurredDate: "2026-10-04",
        },
        [ref(row)],
        201
      )
      row = await current(admin)
      assert.equal(row.financial!.basis, "11500")
      const before = row,
        pending = (await f.command(
          admin,
          "requestApproval",
          envelope(proposal(), cycleRefs(row)),
          202
        )) as unknown as Pending
      await f.command(
        reviewer,
        "reviewApproval",
        envelope({ approvalId: pending.approvalId, decision: "APPROVE" }, [
          ref(
            { id: pending.approvalId, revision: pending.revision },
            "ApprovalRequest"
          ),
          ...cycleRefs(row),
        ])
      )
      row = await current(admin)
      assert.equal(row.status, "WRITTEN_OFF")
      assert.equal(row.available, false)
      assert.ok(row.closedAt)
      assert.equal(
        row.disposal!.basisVersionId,
        before.basisVersions.at(-1)!.id
      )
      assert.equal(row.financial!.cashIn, "200")
      assert.equal(row.financial!.cashOut, "10000")
      assert.equal(
        (
          await f.db.query(
            'SELECT "activePurchaseId" FROM vamotors."Vehicle" WHERE id=$1',
            [row.vehicleId]
          )
        ).rows[0].activePurchaseId,
        null
      )
      const notices = await f.query<{
        data: {
          target?: { type: string; id: string; href: string }
          title?: string
          body?: string
        }[]
      }>(reviewer, "notifications", "?kind=REPAIR_RETURNED&pageSize=100")
      assert.ok(
        notices.data.some(
          (n) =>
            n.target?.type === "RepairRecord" &&
            n.target.id === repairId &&
            n.target.href === `/repairs/${repairId}` &&
            n.title === "Repair returned"
        )
      )
    }
  )
  const originalDisposal = (
    await f.db.query(
      'SELECT to_jsonb(d) row FROM vamotors."Disposal" d WHERE "cycleId"=$1',
      [cycleId]
    )
  ).rows[0].row
  const physical = (
    await f.db.query(
      'SELECT to_jsonb(v) row FROM vamotors."Vehicle" v WHERE id=$1',
      [row.vehicleId]
    )
  ).rows
  const mileage = (
    await f.db.query(
      'SELECT to_jsonb(m) row FROM vamotors."MileageReading" m WHERE "cycleId"=$1 ORDER BY id',
      [cycleId]
    )
  ).rows
  const closedAt = row.closedAt
  await group(
    "old vendor liability pays through actual repair-cycle FK after approved close; cash only with independent dates",
    async () => {
      const basis = row.basisVersions
      for (const [amount, date] of [
        ["400", "2026-09-20"],
        ["600", "2026-10-07"],
      ]) {
        await record(
          "payRepair",
          {
            repairId,
            payment: {
              amount,
              date,
              method: "BANK_TRANSFER",
              reference: "Actual old liability",
            },
          },
          repairRefs(row)
        )
        row = await current(admin)
        assert.equal(row.status, "WRITTEN_OFF")
        assert.equal(row.closedAt, closedAt)
        assert.deepEqual(row.basisVersions, basis)
      }
      assert.equal(row.financial!.cashIn, "200")
      assert.equal(row.financial!.cashOut, "11000")
      assert.ok(row.repairs[0].payments.some((p) => p.date === "2026-09-20"))
    }
  )
  await group(
    "named reasoned editCost/editPurchase restatements append current basis and preserve the original disposal",
    async () => {
      const cost = row.costs[0]
      await cmd(
        "editCost",
        {
          costId: cost.id,
          category: cost.category,
          description: "Correct actual cost",
          amount: "700",
          incurredDate: cost.incurredDate,
          reason: "Actual closed cost correction",
        },
        [ref(row), ref(cost, "VehicleCost")]
      )
      row = await current(admin)
      assert.equal(row.financial!.basis, "11700")
      await cmd(
        "editPurchase",
        {
          cycleId,
          patch: { purchasePrice: "10100" },
          cashCorrections: [],
          reason: "Actual closed purchase correction",
        },
        cycleRefs(row)
      )
      row = await current(admin)
      assert.equal(row.financial!.basis, "11800")
      assert.equal(row.financial!.repairs, "1000")
      assert.equal(
        row.basisVersions.find((b) => b.id === row.disposal!.basisVersionId)!
          .total,
        "11500"
      )
      assert.equal(
        row.basisVersions.at(-1)!.reason,
        "Actual closed purchase correction"
      )
      assert.deepEqual(
        (
          await f.db.query(
            'SELECT to_jsonb(d) row FROM vamotors."Disposal" d WHERE "cycleId"=$1',
            [cycleId]
          )
        ).rows[0].row,
        originalDisposal
      )
    }
  )
  await group(
    "closed old-liability exact opposite with distinct replacement keeps immutable invoice/basis and disposal receipt cash",
    async () => {
      const original = row.repairs[0].payments.find((p) => p.amount === "400")!,
        basis = row.basisVersions
      await record(
        "reversePayment",
        {
          sourceType: "REPAIR",
          sourceId: repairId,
          paymentId: original.id,
          reason: "Correct actual old vendor cash",
          replacement: { amount: "300", date: "2026-10-08", method: "CASH" },
        },
        repairRefs(row)
      )
      row = await current(admin)
      assert.deepEqual(row.basisVersions, basis)
      assert.deepEqual(
        row.repairs[0].payments.find((p) => p.id === original.id),
        original
      )
      assert.equal(
        row.repairs[0].payments.find((p) => p.reversalOf === original.id)!.date,
        original.date
      )
      assert.equal(row.financial!.cashIn, "600")
      assert.equal(row.financial!.cashOut, "11300")
    }
  )
  await group(
    "closed physical/listed/mileage/new cost and unrelated purchase terms remain unavailable; no runtime graph escape",
    async () => {
      for (const [name, input, expected] of [
        [
          "addCost",
          {
            cycleId,
            category: "No",
            description: "No closed new cost",
            amount: "1",
            incurredDate: "2026-10-04",
          },
          [ref(row)],
        ],
        [
          "editPurchase",
          {
            cycleId,
            patch: { notes: "No terminal note mutation" },
            cashCorrections: [],
            reason: "Not a supported financial correction",
          },
          cycleRefs(row),
        ],
        [
          "setListedPrice",
          { cycleId, amount: "20000", reason: "No closed asking edit" },
          [ref(row)],
        ],
      ] as [string, unknown, Dependency[]][])
        await denied(
          admin,
          name,
          envelope(input, expected),
          409,
          "INVALID_STATE"
        )
      const connection = await f.restricted.connect()
      try {
        await connection.query("BEGIN")
        await connection.query(
          'UPDATE vamotors."PurchaseRecord" SET revision=revision+1 WHERE id=$1',
          [cycleId]
        )
        await assert.rejects(
          connection.query("SET CONSTRAINTS ALL IMMEDIATE"),
          (e: unknown) => (e as { code?: string }).code === "23514"
        )
      } finally {
        await connection.query("ROLLBACK")
        connection.release()
      }
      assert.deepEqual(
        (
          await f.db.query(
            'SELECT to_jsonb(v) row FROM vamotors."Vehicle" v WHERE id=$1',
            [row.vehicleId]
          )
        ).rows,
        physical
      )
      assert.deepEqual(
        (
          await f.db.query(
            'SELECT to_jsonb(m) row FROM vamotors."MileageReading" m WHERE "cycleId"=$1 ORDER BY id',
            [cycleId]
          )
        ).rows,
        mileage
      )
    }
  )
  await group(
    "new authentication recovers every repair receipt by exact direct replay and shared commandStatus without rerunning old CAS/state",
    async () => {
      const logout = await admin.post("/api/auth/sign-out", {
        headers: { Origin: f.origin },
        data: {},
      })
      assert.equal(logout.status(), 200)
      admin = await f.login("ADMIN")
      const before = await f.snapshot(tables)
      for (const intent of intents) {
        assert.equal(
          (await f.command(admin, intent.name, intent.body)).commandId,
          intent.result.commandId
        )
        const result = await f.query<Applied>(
          admin,
          "commandStatus",
          `?name=${intent.name}&idempotencyKey=${intent.body.idempotencyKey}`
        )
        assert.equal(result.commandId, intent.result.commandId)
        assert.equal(result.replayed, true)
      }
      assert.equal(await f.snapshot(tables), before)
    }
  )
} catch (error) {
  console.error(
    `FAIL ${stage}: ${error instanceof Error ? error.message : "unknown"}`
  )
  process.exitCode = 1
} finally {
  await writeFile(
    join(root, `repair-writeoff-${suffix}-summary.json`),
    JSON.stringify(
      {
        stage,
        groups,
        cycleId,
        repairId,
        source: process.cwd(),
        scope:
          "Focused accepted-base reconciliation; NOT final full fresh/upgrade/restart/file acceptance",
      },
      null,
      2
    ),
    { mode: 0o600, flag: "wx" }
  )
  await f.close()
}
