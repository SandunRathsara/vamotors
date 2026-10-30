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
  NotificationDTO,
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
    const settings = await f.query<{ id: string; revision: number }>(
      requester,
      "settings"
    )
    const finance = await f.command(
      requester,
      "createFinanceCompany",
      envelope(
        {
          name: `Writeoff finance ${suffix}`,
          contacts: [],
          policy: {
            path: "APPLICATION",
            commission: { basis: "FINANCED_PRINCIPAL", rateBps: 100 },
            processingFee: "250000",
            reconciliationMethod: "PERIOD_NOTICE",
          },
        },
        [ref(settings, "Settings")]
      ),
      201
    )
    for (const [index, [origin, channel]] of [
      ["PURCHASED", "CASH"],
      ["HOLD", "BRAND_NEW"],
      ["RELEASE", "BRAND_NEW"],
      ["PURCHASED", "FINANCE_COMPANY"],
      ["HOLD", "BANK"],
      ["RELEASE", "PRIVATE_PARTY"],
    ].entries()) {
      const lease = !["CASH", "BRAND_NEW"].includes(channel)
      const input = {
        ...purchaseInput(supplier.result.id, suffix, String(index)),
        purchaseType: lease ? "LEASE_SETTLEMENT" : channel,
        ...(lease
          ? {
              purchasePrice: undefined,
              settlement: {
                institutionType: channel,
                ...(channel === "FINANCE_COMPANY"
                  ? { companyId: finance.result.id }
                  : { institutionName: `Actual ${channel} ${suffix}` }),
                reference: `Actual ${channel} terms`,
                amount: "6000",
                cashToSeller: "4000",
              },
            }
          : {}),
      }
      const created = await f.command(
        requester,
        "recordPurchase",
        envelope(input, [
          ref(supplier.result, "Supplier"),
          ...(channel === "FINANCE_COMPANY"
            ? [ref(finance.result, "FinanceCompany")]
            : []),
        ]),
        201
      )
      let row = await current(requester, created.result.id)
      if (lease) {
        const payment = row.payments.find((p) => p.category === "SETTLEMENT")!
        await f.command(
          requester,
          "reversePayment",
          envelope(
            {
              sourceType: "PURCHASE",
              sourceId: row.id,
              paymentId: payment.id,
              reason:
                "Actual settled payment correction preserves remaining credit",
              replacement: {
                amount: "5000",
                date: "2026-10-01",
                method: "BANK_TRANSFER",
              },
            },
            [ref(row)]
          )
        )
        row = await current(requester, row.id)
        assert.equal(row.outstanding.settlement, "1000")
        assert.equal(row.financial!.cashIn, "6000")
      }
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
      const savedSnapshot = (
        await f.db.query(
          'SELECT snapshot FROM vamotors."ApprovalRequest" WHERE id=$1',
          [pending.approvalId]
        )
      ).rows[0].snapshot
      assert.deepEqual(savedSnapshot.settlement, row.settlement)
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
      assert.equal(
        after.financial!.cashIn,
        (BigInt(row.financial!.cashIn) + BigInt(proceeds)).toString()
      )
      assert.equal(after.financial!.cashOut, row.financial!.cashOut)
      assert.deepEqual(after.settlement, row.settlement)
      assert.deepEqual(after.outstanding, row.outstanding)
      assert.deepEqual(after.payments, row.payments)
      assert.deepEqual(after.costs, row.costs)
      assert.deepEqual(after.mileage, row.mileage)
      assert.deepEqual(after.basisVersions, row.basisVersions)
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
          ...(channel === "FINANCE_COMPANY"
            ? [ref(finance.result, "FinanceCompany")]
            : []),
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
        group: `P1-P2 ${origin} ${channel}`,
        cycleId: row.id,
        approvalId: a.id,
        requestCommandId: pending.commandId,
        reviewCommandId: applied.commandId,
        proceeds,
        loss: source.rows[0].loss,
        pass: true,
      })
    }
    const make = async (tag: string, purchaseType = "CASH") => {
      const created = await f.command(
        requester,
        "recordPurchase",
        envelope(
          {
            ...purchaseInput(supplier.result.id, suffix, tag),
            purchaseType,
          },
          [ref(supplier.result, "Supplier")]
        ),
        201
      )
      return current(requester, created.result.id)
    }
    const proposal = (row: PurchaseCycleDTO, proceeds = "0") => ({
      proposal: {
        kind: "WRITE_OFF",
        input: {
          cycleId: row.id,
          date: "2026-10-04",
          reason: "Retained disposal reason",
          method: "OTHER",
          proceeds,
          ...(proceeds !== "0"
            ? {
                receipt: {
                  amount: proceeds,
                  date: "2026-10-05",
                  method: "BANK_TRANSFER",
                  reference: "Actual received funds",
                },
              }
            : {}),
        },
      },
      reason: "Retained request reason",
    })
    const pendingFor = async (row: PurchaseCycleDTO, proceeds = "0") => {
      const body = envelope(proposal(row, proceeds), cycleRefs(row))
      const pending = (await f.command(
        requester,
        "requestApproval",
        body,
        202
      )) as unknown as Pending
      const a = await approval(reviewer, pending.approvalId)
      return {
        body,
        pending,
        a,
        review: envelope({ approvalId: a.id, decision: "APPROVE" }, [
          ref(a, "ApprovalRequest"),
          ...a.expected,
        ]),
      }
    }
    {
      const row = await make("strict"),
        p = proposal(row)
      for (const patch of [
        { date: "2026-02-30" },
        { date: "2026-09-30" },
        { date: "9999-01-01" },
        { proceeds: "-1" },
        { proceeds: "01" },
        { method: "CASH" },
        { reason: " " },
        { actorId: row.vehicleId },
      ])
        await statusBody(
          requester,
          "requestApproval",
          envelope(
            {
              ...p,
              proposal: {
                ...p.proposal,
                input: { ...p.proposal.input, ...patch },
              },
            },
            cycleRefs(row)
          ),
          422,
          "INVALID_INPUT"
        )
      for (const input of [
        { ...p.proposal.input, proceeds: "1" },
        {
          ...p.proposal.input,
          receipt: { amount: "1", date: "2026-10-05", method: "CASH" },
        },
        {
          ...p.proposal.input,
          proceeds: "2",
          receipt: { amount: "1", date: "2026-10-05", method: "CASH" },
        },
      ])
        await statusBody(
          requester,
          "requestApproval",
          envelope(
            { ...p, proposal: { kind: "WRITE_OFF", input } },
            cycleRefs(row)
          ),
          422,
          "BALANCE_MISMATCH"
        )
      await statusBody(
        requester,
        "requestApproval",
        envelope(
          {
            ...p,
            proposal: {
              ...p.proposal,
              input: { ...p.proposal.input, proceeds: "100000000000000" },
            },
          },
          cycleRefs(row)
        ),
        422,
        "MONEY_OVERFLOW"
      )
      await statusBody(
        requester,
        "requestApproval",
        envelope(p, []),
        428,
        "REVISION_REQUIRED"
      )
      await statusBody(
        requester,
        "requestApproval",
        envelope(
          p,
          cycleRefs(row).map((r) => ({ ...r, revision: r.revision + 1 }))
        ),
        409,
        "STALE_REVISION"
      )
      await statusBody(
        requester,
        "requestApproval",
        envelope(p, [ref(row), ref(row)]),
        422,
        "INVALID_INPUT"
      )
      await statusBody(
        requester,
        "requestApproval",
        envelope(p, [...cycleRefs(row), ref(supplier.result, "Supplier")]),
        422,
        "INVALID_INPUT"
      )
      groups.push({
        group: "P2/P4 strict input and exact request references",
        pass: true,
      })
    }
    {
      const row = await make("reject"),
        before = await f.snapshot(domainTables),
        p = await pendingFor(row)
      await statusBody(
        reviewer,
        "reviewApproval",
        envelope(
          { approvalId: p.a.id, decision: "REJECT", note: " " },
          p.review.expected
        ),
        422,
        "INVALID_INPUT"
      )
      await statusBody(
        reviewer,
        "reviewApproval",
        { ...p.review, expected: [] },
        428,
        "REVISION_REQUIRED"
      )
      await statusBody(
        reviewer,
        "reviewApproval",
        { ...p.review, expected: [ref(p.a, "ApprovalRequest")] },
        428,
        "REVISION_REQUIRED"
      )
      await statusBody(
        reviewer,
        "reviewApproval",
        {
          ...p.review,
          expected: p.review.expected.map((r) =>
            r.type === "ApprovalRequest" ? { ...r, revision: 2 } : r
          ),
        },
        409,
        "STALE_REVISION"
      )
      await statusBody(
        reviewer,
        "reviewApproval",
        {
          ...p.review,
          expected: [...p.review.expected, ref(supplier.result, "Supplier")],
        },
        422,
        "INVALID_INPUT"
      )
      const reject = envelope(
        {
          approvalId: p.a.id,
          decision: "REJECT",
          note: "Separate reviewer rejects retained intent",
        },
        p.review.expected
      )
      const result = await f.command(reviewer, "reviewApproval", reject)
      assert.equal(await f.snapshot(domainTables), before)
      const a = await approval(requester, p.a.id)
      assert.equal(a.state, "REJECTED")
      assert.equal(a.reviewNote, "Separate reviewer rejects retained intent")
      const unchanged = await f.snapshot(allTables)
      assert.equal(
        (await f.command(reviewer, "reviewApproval", reject)).commandId,
        result.commandId
      )
      assert.equal(await f.snapshot(allTables), unchanged)
      await statusBody(
        reviewer,
        "reviewApproval",
        p.review,
        409,
        "ALREADY_REVIEWED"
      )
      const fresh = await pendingFor(await current(requester, row.id))
      await f.command(reviewer, "reviewApproval", fresh.review)
      groups.push({
        group:
          "P2 rejection immutable proposal, zero domain effects, replay and fresh approval",
        pass: true,
      })
    }
    for (const name of [
      "setListedPrice",
      "addCost",
      "addMileage",
      "editVehicle",
      "payPurchase",
      "editPurchase",
      "receiveStock",
    ]) {
      let row = await make(`stale-${name}`)
      if (name === "payPurchase") {
        await f.command(
          requester,
          "reversePayment",
          envelope(
            {
              sourceType: "PURCHASE",
              sourceId: row.id,
              paymentId: row.payments[0].id,
              reason: "Actual refund opens a lawful outstanding balance",
            },
            [ref(row)]
          )
        )
        row = await current(requester, row.id)
      }
      const p = await pendingFor(row)
      const input =
        name === "setListedPrice"
          ? { cycleId: row.id, amount: "0", reason: "New asking price" }
          : name === "addCost"
            ? {
                cycleId: row.id,
                category: "Other",
                description: "Changed actual cost",
                amount: "1",
                incurredDate: "2026-10-03",
              }
            : name === "addMileage"
              ? { cycleId: row.id, mileage: { reading: 1, date: "2026-10-03" } }
              : name === "editVehicle"
                ? {
                    vehicleId: row.vehicleId,
                    values: { ...row.identity, colour: "Red" },
                    reason: "Current physical correction",
                  }
                : name === "payPurchase"
                  ? {
                      cycleId: row.id,
                      recipient: "SELLER",
                      payment: {
                        amount: "1",
                        date: "2026-10-03",
                        method: "CASH",
                      },
                    }
                  : name === "editPurchase"
                    ? {
                        cycleId: row.id,
                        patch: { notes: "Current source correction" },
                        cashCorrections: [],
                        reason: "Actual correction",
                      }
                    : {
                        cycleId: row.id,
                        date: "2026-10-03",
                        disposition: { kind: "RELEASE" },
                      }
      await f.command(
        requester,
        name,
        envelope(
          input,
          name === "editVehicle"
            ? [cycleRefs(row)[1]]
            : ["addMileage", "editPurchase"].includes(name)
              ? cycleRefs(row)
              : [ref(row)]
        ),
        name === "addCost" ? 201 : 200
      )
      await statusBody(
        reviewer,
        "reviewApproval",
        p.review,
        409,
        "APPROVAL_STALE"
      )
      assert.equal((await approval(reviewer, p.a.id)).state, "PENDING")
      groups.push({
        group: `P4 actual ${name} changes saved business dependencies`,
        pass: true,
      })
    }
    {
      const row = await make("races"),
        p = await pendingFor(row, "2000")
      const results = await Promise.all(
        Array.from({ length: 2 }, () =>
          f.command(reviewer, "reviewApproval", p.review)
        )
      )
      assert.equal(results[0].commandId, results[1].commandId)
      assert.equal(results.filter((r) => !r.replayed).length, 1)
      const snapshot = await f.snapshot(allTables)
      const status = await f.query<Applied>(
        reviewer,
        "commandStatus",
        `?name=reviewApproval&idempotencyKey=${p.review.idempotencyKey}`
      )
      assert.equal(status.commandId, results[0].commandId)
      const prior = await f.query<Pending>(
        requester,
        "commandStatus",
        `?name=requestApproval&idempotencyKey=${p.body.idempotencyKey}`
      )
      assert.equal(prior.approvalId, p.a.id)
      assert.equal(prior.businessEffect, false)
      assert.equal(await f.snapshot(allTables), snapshot)
      await statusBody(
        requester,
        "requestApproval",
        {
          ...p.body,
          input: {
            ...(p.body.input as object),
            reason: "Different authorized intent",
          },
        },
        409,
        "IDEMPOTENCY_MISMATCH"
      )
      groups.push({
        group:
          "P5 identical concurrent review, current-authority commandStatus and request replay after application",
        pass: true,
      })
    }
    {
      const inbox = await f.query<{
        data: NotificationDTO[]
        unreadCount: number
        asOf: string
      }>(reviewer, "notifications", "?pageSize=100")
      const notification = inbox.data.find((n) => n.readAt === null)
      assert.ok(notification)
      assert.ok(notification.target.href.startsWith("/approvals/"))
      await statusBody(
        requester,
        "markNotificationRead",
        envelope({ notificationId: notification.id }, [
          ref(notification, "Notification"),
        ]),
        404,
        "NOT_FOUND"
      )
      const beforeSequence = await f.snapshot(["BusinessSequence"])
      const body = envelope({ notificationId: notification.id }, [
        ref(notification, "Notification"),
      ])
      const result = await f.command(reviewer, "markNotificationRead", body)
      const baseline = await f.snapshot(allTables)
      assert.equal(
        (await f.command(reviewer, "markNotificationRead", body)).commandId,
        result.commandId
      )
      assert.equal(await f.snapshot(allTables), baseline)
      const one = await f.query<{ unreadCount: number }>(
        reviewer,
        "notifications",
        "?pageSize=10"
      )
      assert.equal(one.unreadCount, inbox.unreadCount - 1)
      const all = envelope({ through: "9999-01-01T00:00:00.000Z" })
      const marked = await f.command(reviewer, "markAllNotificationsRead", all)
      assert.equal(
        (await f.query<{ unreadCount: number }>(reviewer, "notifications"))
          .unreadCount,
        0
      )
      assert.equal(await f.snapshot(["BusinessSequence"]), beforeSequence)
      const complete = await f.snapshot(allTables)
      assert.equal(
        (await f.command(reviewer, "markAllNotificationsRead", all)).commandId,
        marked.commandId
      )
      assert.equal(await f.snapshot(allTables), complete)
      groups.push({
        group:
          "P2/P3 recipient inbox, monotone read-one/all, future cutoff clamp, no business sequence",
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
