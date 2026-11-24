import { createHash } from "node:crypto"
import { describe, expect, it, vi } from "vitest"
import { subject } from "@casl/ability"
import { approvalEnvelope, approvalInputs } from "@/lib/server/validators"
import {
  abilityFor,
  attenuation,
  grantSchema,
  registry,
  registryVersion,
} from "@/lib/server/permissions"
import {
  requireWriteOffRead,
  applyApprovedWriteOff,
} from "@/lib/server/disposals"
import { A, C } from "@/lib/money"

vi.mock("server-only", () => ({}))

const id = "00000000-0000-4000-8000-000000000001"
const input = {
  proposal: {
    kind: "WRITE_OFF",
    input: {
      cycleId: id,
      date: "2026-10-01",
      reason: "Actual disposal",
      method: "SCRAPPED",
      proceeds: "0",
    },
  },
  reason: "Independent request",
}

describe("bounded WRITE_OFF protocol and accepted236 permissions", () => {
  it("keeps every accepted236 subject/action/field byte-identical outside v15 sale extensions", () => {
    const old = Object.fromEntries(
      Object.entries(registry).filter(
        ([name]) =>
          ![
            "ApprovalRequest",
            "Disposal",
            "RepairRecord",
            "Reservation",
            "ReservationExpiryJob",
            "SaleCase",
            "PurchaseRecord",
            "BrokerageDeal",
            "CashFacility",
            "DispatchBatch",
            "CommissionEntitlement",
            "Report",
          ].includes(name)
      )
    )
    // Exact accepted236 baseline for every subject that T09 did not expand.
    // (PurchaseRecord/ApprovalRequest expansions and SaleCase are asserted below.)
    expect(Object.keys(old)).toHaveLength(15)
    expect(createHash("sha256").update(JSON.stringify(old)).digest("hex")).toBe(
      "49e1efcb68f307ff0c7ffe4d55e62570db81705f8047f5482584665525ef7f83"
    )
    expect(registryVersion).toBe(19)
    expect(registry.PurchaseRecord.read).toEqual(
      expect.arrayContaining([
        "tradeInSourceSaleId",
        "financial.originalBasis",
        "financial.salePrice",
        "financial.originalProfit",
        "financial.restatedProfit",
      ])
    )
    expect(registry.SaleCase.pay).toEqual([
      "amount",
      "date",
      "method",
      "reference",
    ])
    expect(
      registry.PurchaseRecord.read.filter((f) => f.startsWith("disposal"))
    ).toEqual(["disposal"])
  })
  it("does not infer new child grants or delegation from the existing compound parent", () => {
    const grants = [
      {
        subject: "PurchaseRecord" as const,
        action: "read" as const,
        fields: ["*"],
      },
    ]
    const ability = abilityFor(grants, id)
    expect(ability.can("read", "PurchaseRecord", "disposal")).toBe(true)
    expect(ability.can("read", "Disposal", "proceeds")).toBe(false)
    expect(
      attenuation(
        grants,
        [],
        [{ subject: "Disposal", action: "read", fields: ["proceeds"] }],
        id
      ).covered
    ).toBe(false)
    const own = abilityFor(
      [
        {
          subject: "Disposal",
          action: "read",
          fields: ["proceeds"],
          conditions: { createdBy: "$actor.id" },
        },
      ],
      id
    )
    expect(
      own.can("read", subject("Disposal", { createdBy: id }), "proceeds")
    ).toBe(true)
    expect(
      own.can("read", subject("Disposal", { createdBy: "foreign" }), "proceeds")
    ).toBe(false)
    expect(
      grantSchema.safeParse({
        subject: "ApprovalRequest",
        action: "approve",
        fields: ["decision"],
        conditions: { state: "PENDING" },
      }).success
    ).toBe(false)
  })
  it("enables only strict WRITE_OFF input and requires a real rejection note", () => {
    expect(approvalInputs.requestApproval.safeParse(input).success).toBe(true)
    for (const proposal of [
      { kind: "REPAIR" },
      { kind: "DISCOUNT" },
      { kind: "REFUND" },
      { kind: "SALE_EDIT" },
      { ...input.proposal, actorId: id },
    ])
      expect(
        approvalInputs.requestApproval.safeParse({ ...input, proposal }).success
      ).toBe(false)
    for (const patch of [
      { proceeds: "-1" },
      { proceeds: "00" },
      { date: "2026-02-30" },
      { method: "CASH" },
      { bypass: true },
    ])
      expect(
        approvalInputs.requestApproval.safeParse({
          ...input,
          proposal: {
            ...input.proposal,
            input: { ...input.proposal.input, ...patch },
          },
        }).success
      ).toBe(false)
    expect(
      approvalInputs.reviewApproval.safeParse({
        approvalId: id,
        decision: "REJECT",
        note: "   ",
      }).success
    ).toBe(false)
    expect(
      approvalInputs.reviewApproval.parse({
        approvalId: id,
        decision: "REJECT",
        note: " Actual rejection ",
      }).note
    ).toBe("Actual rejection")
    const body = {
      schemaVersion: 1,
      idempotencyKey: id,
      expected: [{ type: "PurchaseRecord", id, revision: 1 }],
      input,
    }
    expect(approvalEnvelope("requestApproval").safeParse(body).success).toBe(
      true
    )
    expect(
      approvalEnvelope("requestApproval").safeParse({
        ...body,
        expected: [...body.expected, ...body.expected],
      }).success
    ).toBe(false)
  })
  it("requires each snapshotted lease leaf and each actual gross-cash source", () => {
    for (const institution of [
      { institutionType: "FINANCE_COMPANY", companyId: id },
      { institutionType: "BANK", institutionName: "Actual bank" },
      { institutionType: "PRIVATE_PARTY", institutionName: "Actual lender" },
    ]) {
      const purchase = {
        id,
        revision: 1,
        vehicleId: id,
        identityRevision: 1,
        status: "PURCHASED",
        available: false,
        closedAt: null,
        purchaseDate: "2026-10-01",
        purchasePrice: "10000",
        purchaseType: "LEASE_SETTLEMENT",
        listedPrice: "0",
        settlement: {
          ...institution,
          institutionNameSnapshot: "Retained name",
          reference: "Actual reference",
          amount: "6000",
          cashToSeller: "4000",
        },
        financial: {
          basis: "10500",
          currency: "LKR",
          scale: 2,
          cashIn: "200",
          cashOut: "10200",
        },
        basisVersions: [{ id, total: "10500" }],
        payments: [{ amount: "10000", direction: "OUT" }],
        costs: [{ payments: [{ amount: "200", direction: "OUT" }] }],
      }
      expect(() => requireWriteOffRead(purchase, purchase)).not.toThrow()
      for (const field of Object.keys(purchase.settlement)) {
        const visible = structuredClone(purchase)
        Reflect.deleteProperty(visible.settlement, field)
        expect(() => requireWriteOffRead(purchase, visible)).toThrow(
          "FIELD_FORBIDDEN"
        )
      }
      for (const path of ["cashIn", "cashOut"]) {
        const visible = structuredClone(purchase)
        Reflect.deleteProperty(visible.financial, path)
        expect(() => requireWriteOffRead(purchase, visible)).toThrow(
          "FIELD_FORBIDDEN"
        )
      }
      for (const cost of [false, true])
        for (const leaf of ["amount", "direction"]) {
          const visible = structuredClone(purchase)
          Reflect.deleteProperty(
            cost ? visible.costs[0].payments[0] : visible.payments[0],
            leaf
          )
          expect(() => requireWriteOffRead(purchase, visible)).toThrow(
            "FIELD_FORBIDDEN"
          )
        }
    }
  })
  it("bounds gross proceeds at C rather than B before any owner mutation", async () => {
    const update = vi.fn(),
      create = vi.fn()
    const tx = {
      purchaseRecord: { update },
      vehicle: { update },
      disposal: { create },
      disposalReceipt: { create },
    } as unknown as Parameters<typeof applyApprovedWriteOff>[0]
    const context = {
      cycleId: id,
      vehicleId: id,
      approvalId: id,
      commandId: id,
      reviewerId: id,
      basisVersionId: id,
      basis: A,
      cashIn: C,
      cashOut: C,
      currency: "LKR",
      scale: 2,
      reviewedAt: new Date(),
      input: {
        cycleId: id,
        date: "2026-10-01",
        reason: "Actual",
        method: "OTHER" as const,
        proceeds: "1",
        receipt: { amount: "1", date: "2026-10-01", method: "CASH" as const },
      },
    }
    await expect(applyApprovedWriteOff(tx, context)).rejects.toThrow(
      "MONEY_OVERFLOW"
    )
    expect(update).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
    await applyApprovedWriteOff(tx, { ...context, cashIn: C - 1n })
    expect(create).toHaveBeenCalledTimes(2)
  })
})
