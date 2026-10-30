/** Real local PostgreSQL + production HTTP; grows only from executed owner paths. */
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { APIRequestContext } from "@playwright/test"
import type {
  Applied,
  Pending,
  ApprovalDTO,
  PurchaseCycleDTO,
  Dependency,
} from "../../.planning/implementation/contracts/api"
import { envelope, fixture, purchaseInput, ref } from "./cycle-edits-fixture"

process.umask(0o077)
const root = process.argv[2]
assert.ok(root)
const f = await fixture(root),
  groups: unknown[] = []
const domainTables = [
  "Vehicle",
  "PurchaseRecord",
  "MileageReading",
  "PurchasePayment",
  "VehicleCost",
  "CostPayment",
  "CycleBasisVersion",
  "StatusEvent",
]
const allTables = [
  ...domainTables,
  "ApprovalRequest",
  "Disposal",
  "DisposalReceipt",
  "Notification",
  "AuditEntry",
  "EntityReadVersion",
  "CommandReceipt",
  "BusinessSequence",
]
const cycleRefs = (row: PurchaseCycleDTO): Dependency[] => [
  ref(row),
  { type: "Vehicle", id: row.vehicleId, revision: row.identityRevision },
]
const current = (client: APIRequestContext, id: string) =>
  f.query<PurchaseCycleDTO>(client, "purchase", `?cycleId=${id}`)
const approval = (client: APIRequestContext, id: string) =>
  f
    .query<{ data: ApprovalDTO[] }>(client, "approvals", "?pageSize=100")
    .then((p) => {
      const a = p.data.find((a) => a.id === id)
      assert.ok(a)
      return a
    })
const statusBody = async (
  client: APIRequestContext,
  name: string,
  body: unknown,
  status: number,
  code: string
) => {
  const before = await f.snapshot(allTables)
  const r = await client.post(`/api/v1/commands/${name}`, {
    headers: { Origin: f.origin },
    data: body,
  })
  const value = await r.json()
  assert.equal(r.status(), status, JSON.stringify(value))
  assert.equal(value.error.code, code)
  assert.equal(
    await f.snapshot(allTables),
    before,
    `${name} ${code} leaves no business/receipt/sequence residue`
  )
  return value
}
try {
  await f.start()
  const requester = await f.login("ADMIN"),
    reviewer = await f.login("SECOND")
  try {
    const suffix = randomUUID().slice(0, 8)
    const supplier = await f.command(
      requester,
      "createDirectoryParty",
      envelope({
        type: "SUPPLIER",
        values: {
          name: `Writeoff ${suffix}`,
          category: "COMPANY",
          contacts: [],
        },
      }),
      201
    )
    for (const [index, origin] of ["PURCHASED", "HOLD", "RELEASE"].entries()) {
      const input = {
        ...purchaseInput(supplier.result.id, suffix, String(index)),
        purchaseType: index === 0 ? "CASH" : "BRAND_NEW",
      }
      const created = await f.command(
        requester,
        "recordPurchase",
        envelope(input, [ref(supplier.result, "Supplier")]),
        201
      )
      let row = await current(requester, created.result.id)
      if (origin !== "PURCHASED") {
        await f.command(
          requester,
          "receiveStock",
          envelope(
            {
              cycleId: row.id,
              date: "2026-10-03",
              disposition:
                origin === "HOLD"
                  ? { kind: "HOLD", reason: "Retained held origin" }
                  : { kind: "RELEASE" },
            },
            [ref(row)]
          )
        )
        row = await current(requester, row.id)
      }
      await f.command(
        requester,
        "addCost",
        envelope(
          {
            cycleId: row.id,
            category: "Transport",
            description: "Actual unpaid cost",
            amount: "500",
            incurredDate: "2026-10-03",
          },
          [ref(row)]
        ),
        201
      )
      row = await current(requester, row.id)
      assert.equal(row.financial!.basis, "10500")
      assert.ok(row.nextActions.includes("requestApproval"))
      const proceeds = index === 0 ? "0" : index === 1 ? "2000" : "12000"
      const writeOff = {
        cycleId: row.id,
        date: "2026-10-04",
        reason: `Actual disposal reason ${origin}`,
        method: index === 0 ? "DONATED" : "AUCTIONED",
        proceeds,
        ...(proceeds !== "0"
          ? {
              receipt: {
                amount: proceeds,
                date: "2026-10-05",
                method: index === 1 ? "BANK_TRANSFER" : "CASH",
                reference: `Actual receipt ${origin}`,
              },
            }
          : {}),
      }
      const body = envelope(
        {
          proposal: { kind: "WRITE_OFF", input: writeOff },
          reason: `Separate request reason ${origin}`,
        },
        cycleRefs(row)
      )
      const beforeDomain = await f.snapshot(domainTables)
      const pending = (await f.command(
        requester,
        "requestApproval",
        body,
        202
      )) as unknown as Pending
      assert.deepEqual(
        Object.keys(pending).sort(),
        [
          "ok",
          "status",
          "commandId",
          "approvalId",
          "revision",
          "replayed",
          "businessEffect",
        ].sort()
      )
      assert.equal(pending.businessEffect, false)
      assert.equal(pending.status, "PENDING_APPROVAL")
      assert.equal(await f.snapshot(domainTables), beforeDomain)
      const a = await approval(reviewer, pending.approvalId)
      assert.equal(a.reason, `Separate request reason ${origin}`)
      assert.equal(a.proposal.kind, "WRITE_OFF")
      if (a.proposal.kind !== "WRITE_OFF") throw Error("wrong stored owner")
      assert.equal(a.proposal.input.reason, writeOff.reason)
      assert.deepEqual(a.expected, cycleRefs(row))
      const review = envelope({ approvalId: a.id, decision: "APPROVE" }, [
        ref(a, "ApprovalRequest"),
        ...a.expected,
      ])
      await statusBody(requester, "reviewApproval", review, 403, "SELF_REVIEW")
      const applied = await f.command(reviewer, "reviewApproval", review)
      const after = await current(reviewer, row.id)
      assert.equal(after.status, "WRITTEN_OFF")
      assert.equal(after.available, false)
      assert.ok(after.closedAt)
      assert.equal(after.revision, row.revision + 1)
      assert.equal(after.identityRevision, row.identityRevision + 1)
      assert.equal(after.disposal!.proceeds, proceeds)
      assert.equal(after.disposal!.payments.length, proceeds === "0" ? 0 : 1)
      assert.equal(after.financial!.basis, "10500")
      assert.equal(after.financial!.cashIn, proceeds)
      if (proceeds !== "0")
        assert.equal(after.disposal!.payments[0].date, "2026-10-05")
      const source = await f.db.query(
        'SELECT "netLoss"::text loss,"commandId" FROM vamotors."Disposal" WHERE "cycleId"=$1',
        [row.id]
      )
      assert.equal(source.rows[0].loss, (10500n - BigInt(proceeds)).toString())
      assert.equal(source.rows[0].commandId, applied.commandId)
      const pointer = await f.db.query(
        'SELECT "activePurchaseId" FROM vamotors."Vehicle" WHERE id=$1',
        [row.vehicleId]
      )
      assert.equal(pointer.rows[0].activePurchaseId, null)
      const baseline = await f.snapshot(allTables)
      const replay = await f.command(reviewer, "reviewApproval", review)
      assert.equal(replay.replayed, true)
      assert.equal(replay.commandId, applied.commandId)
      const pendingAgain = (await f.command(
        requester,
        "requestApproval",
        body,
        202
      )) as unknown as Pending
      assert.equal(pendingAgain.approvalId, pending.approvalId)
      assert.equal(pendingAgain.commandId, pending.commandId)
      assert.equal(pendingAgain.businessEffect, false)
      assert.equal(await f.snapshot(allTables), baseline)
      const vehicle = await f.query<{
        status: string
        cycles: PurchaseCycleDTO[]
      }>(requester, "vehicle", `?id=${row.vehicleId}`)
      assert.equal(vehicle.status, "WRITTEN_OFF")
      assert.equal(vehicle.cycles[0].id, row.id)
      const altered = { ...review, idempotencyKey: randomUUID() }
      await statusBody(
        reviewer,
        "reviewApproval",
        altered,
        409,
        "ALREADY_REVIEWED"
      )
      await statusBody(
        requester,
        "recordPurchase",
        envelope(input, [
          ref(supplier.result, "Supplier"),
          {
            type: "Vehicle",
            id: row.vehicleId,
            revision: after.identityRevision,
          },
        ]),
        409,
        "IDENTITY_WRITTEN_OFF"
      )
      groups.push({
        group: `P1-P2 ${origin} ${input.purchaseType}`,
        cycleId: row.id,
        approvalId: a.id,
        requestCommandId: pending.commandId,
        reviewCommandId: applied.commandId,
        proceeds,
        loss: source.rows[0].loss,
        pass: true,
      })
    }
  } finally {
    await requester.dispose()
    await reviewer.dispose()
  }
} catch (error) {
  groups.push({
    pass: false,
    error: error instanceof Error ? error.message : "UNKNOWN",
  })
  throw error
} finally {
  await f.close()
  await writeFile(
    join(root, `approval-disposal-${Date.now()}.json`),
    JSON.stringify({ source: process.cwd(), groups }, null, 2) + "\n",
    { mode: 0o600 }
  )
}
console.log(JSON.stringify({ groups: groups.length, pass: true }))
