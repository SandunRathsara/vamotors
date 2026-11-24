import { describe, expect, it, vi } from "vitest"
import type { CommandReceipt } from "@prisma/client"
import type { Grant } from "../../.planning/implementation/contracts/api"
import type { Actor } from "../../lib/server/actor"
import type { Tx } from "../../lib/server/db"
import { abilityFor, registry } from "../../lib/server/permissions"
import { repairReplay } from "../../lib/server/repairs"
import { notificationQuery } from "../../lib/server/notifications"
import { visiblePurchase, type loadPurchase } from "../../lib/server/purchases"

vi.mock("server-only", () => ({}))

const uid = "03000000-0000-4000-8000-000000000001"
const rid = "03000000-0000-4000-8000-000000000002"
const cid = "03000000-0000-4000-8000-000000000003"
const command = "03000000-0000-4000-8000-000000000004"
const at = new Date("2026-10-01T00:00:00Z")
const grants = Object.entries(registry).flatMap(([subject, actions]) =>
  Object.keys(actions).map((action) => ({ subject, action, fields: ["*"] }))
) as Grant[]
const actor = (rules = grants) =>
  ({ userId: uid, grants: rules, ability: abilityFor(rules, uid) }) as Actor

function fixture(name: string, withCash = true) {
  const payment = {
    id: "03000000-0000-4000-8000-000000000005",
    repairId: rid,
    cycleId: cid,
    commandId: command,
    amount: 400n,
    direction: "OUT",
    category: "REPAIR",
    occurredDate: at,
    recordedAt: at,
    method: "CASH",
    reference: "Actual original reference",
    reversalOf: null,
    reason: null,
    lineKey: "payment",
  }
  const repair = {
    id: rid,
    cycleId: cid,
    vendorId: "03000000-0000-4000-8000-000000000006",
    vendor: { active: false, revision: 9 },
    createdBy: uid,
    revision: 12,
    commandId: name === "sendRepair" ? command : "earlier-send",
    returnCommandId: name === "returnRepair" ? command : "earlier-return",
    sentDate: at,
    returnedDate: at,
    invoiceDate: at,
    invoiceAmount: 1000n,
    request: "Original dispatch",
    summary: "Actual return",
    payments:
      name === "sendRepair" || !withCash
        ? []
        : name === "reversePayment"
          ? [
              {
                ...payment,
                direction: "IN",
                reversalOf: "03000000-0000-4000-8000-000000000007",
                reason: "Actual correction",
                lineKey: "reverse:03000000-0000-4000-8000-000000000007",
              },
              { ...payment, id: "replacement", lineKey: "replace:original" },
            ]
          : [payment],
  }
  const row = {
    id: cid,
    revision: 30,
    createdBy: uid,
    vehicleId: "03000000-0000-4000-8000-000000000008",
    vehicle: { revision: 4, createdBy: uid, activePurchaseId: null },
    supplier: { id: "supplier", name: "Original supplier", active: false },
    purchaseDate: at,
    receivedDate: at,
    closedAt: at,
    status: "WRITTEN_OFF",
    available: false,
    purchaseType: "CASH",
    purchasePrice: 10000n,
    listedPrice: null,
    notes: null,
    holdReason: null,
    payments: [],
    mileage: [],
    costs: [],
    repairs: [repair],
    disposal: null,
    basisVersions: [{ id: "basis", version: 3, total: 11000n }],
  } as unknown as NonNullable<Awaited<ReturnType<typeof loadPurchase>>>
  // Deliberately no session, CAS, lock, sequence or write methods. Receipt
  // recovery must only read immutable intent and evaluate fresh supplied grants.
  const tx = {
    repairRecord: { findUnique: vi.fn().mockResolvedValue(repair) },
    purchaseRecord: { findUnique: vi.fn().mockResolvedValue(row) },
  } as unknown as Tx
  const receipt = {
    id: command,
    actorKey: `USER:${uid}`,
    commandName: name,
    result: { type: "RepairRecord", id: rid, revision: 1 },
  } as unknown as CommandReceipt
  return { tx, receipt, row, repair }
}

describe("repair receipt recovery shares current authority, not old state", () => {
  it("keeps empty repair release legacy-readable while authorizing every real repair independently", () => {
    const f = fixture("sendRepair", false)
    f.row.acquisitionCommandId = command
    f.row.closedAt = null
    f.row.status = "IN_STOCK"
    f.row.vehicle.activePurchaseId = f.row.id
    const repairs = f.row.repairs
    f.row.repairs = []
    const limited: Grant[] = [
      {
        subject: "PurchaseRecord",
        action: "read",
        fields: [
          "id",
          "revision",
          "status",
          "available",
          "receivedDate",
          "holdReason",
          "nextActions",
        ],
      },
      {
        subject: "Vehicle",
        action: "read",
        fields: ["id", "identityRevision"],
      },
      { subject: "PurchaseRecord", action: "release", fields: ["cycleId"] },
    ]
    expect(visiblePurchase(actor(limited), f.row).nextActions).toContain(
      "releaseStock"
    )
    f.row.repairs = repairs
    expect(visiblePurchase(actor(limited), f.row).nextActions).not.toContain(
      "releaseStock"
    )
    const repairReads: Grant[] = [
      ...limited,
      { subject: "PurchaseRecord", action: "read", fields: ["repairs"] },
      { subject: "RepairRecord", action: "read", fields: ["returnedDate"] },
    ]
    expect(visiblePurchase(actor(repairReads), f.row).nextActions).toContain(
      "releaseStock"
    )
    f.row.repairs[0].returnedDate = null
    expect(
      visiblePurchase(actor(repairReads), f.row).nextActions
    ).not.toContain("releaseStock")
  })

  it.each(["sendRepair", "returnRepair", "payRepair", "reversePayment"])(
    "recovers %s after later revisions/closure/vendor archival without any old session or business write",
    async (name) => {
      const f = fixture(name)
      const result = await repairReplay(f.tx, actor(), f.receipt)
      expect(result.replayed).toBe(true)
      expect(result.result).toEqual(f.receipt.result)
      expect(result.affected).toEqual([
        { type: "PurchaseRecord", id: cid, revision: 30 },
        { type: "RepairRecord", id: rid, revision: 12 },
      ])
    }
  )

  it("reauthorizes the original optional cash fields, even when their current permission was revoked", async () => {
    const restricted = grants.map((g) =>
      g.subject === "RepairRecord" && g.action === "pay"
        ? {
            ...g,
            fields: registry.RepairRecord.pay.filter(
              (f) => f !== "payment.reference"
            ),
          }
        : g
    )
    for (const name of ["returnRepair", "payRepair"]) {
      const f = fixture(name)
      await expect(
        repairReplay(f.tx, actor(restricted), f.receipt)
      ).rejects.toMatchObject({ code: "FIELD_FORBIDDEN" })
    }
    const unpaid = fixture("returnRepair", false)
    await expect(
      repairReplay(unpaid.tx, actor(restricted), unpaid.receipt)
    ).resolves.toMatchObject({ replayed: true })
  })

  it("does not borrow another actor's receipt or parent-only repair access", async () => {
    const f = fixture("payRepair")
    await expect(
      repairReplay(
        f.tx,
        actor(grants.filter((g) => g.subject !== "RepairRecord")),
        f.receipt
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
    await expect(
      repairReplay(f.tx, actor(), { ...f.receipt, actorKey: "USER:other" })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" })
  })

  it("uses the accepted notification reader and exact repair href without financial message material", async () => {
    const tx = {
      approvalRequest: { findMany: vi.fn().mockResolvedValue([]) },
      purchaseRecord: { findMany: vi.fn().mockResolvedValue([]) },
      vehicle: { findMany: vi.fn().mockResolvedValue([]) },
      repairRecord: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { id: rid, createdBy: uid, cycle: { createdBy: uid } },
          ]),
      },
      saleCase: { findMany: vi.fn().mockResolvedValue([]) },
      customer: { findMany: vi.fn().mockResolvedValue([]) },
      notification: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "notice",
            revision: 1,
            recipientUserId: uid,
            kind: "REPAIR_RETURNED",
            targetType: "RepairRecord",
            targetId: rid,
            createdAt: at,
            readAt: null,
          },
        ]),
        count: vi.fn().mockResolvedValue(1),
      },
    } as unknown as Tx
    const result = await notificationQuery(tx, actor(), {})
    expect(result.data[0].target).toEqual({
      type: "RepairRecord",
      id: rid,
      href: `/repairs/${rid}`,
    })
    expect(result.data[0].title).toBe("Repair returned")
    expect(result.data[0].body).toBe(
      "Open the record to view its current details."
    )
  })
})
