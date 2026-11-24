import { createHash } from "node:crypto"
import { subject } from "@casl/ability"
import { describe, expect, it } from "vitest"
import {
  repairEnvelope,
  repairInputs,
  repairReversalInput,
  repairReversalEnvelope,
} from "../../lib/server/validators"
import {
  abilityFor,
  attenuation,
  registry,
  registryVersion,
  grantSchema,
} from "../../lib/server/permissions"
import { authorizedRepairBalance } from "../../components/repairs/repair-workspace"

const id = "03000000-0000-4000-8000-000000000011"
const other = "03000000-0000-4000-8000-000000000012"
const send = {
  cycleId: id,
  vendorId: other,
  request: "Actual repair",
  sentDate: "2026-10-01",
}
const returned = {
  repairId: id,
  invoiceAmount: "1000",
  invoiceDate: "2026-10-02",
  returnedDate: "2026-10-03",
  summary: "Work completed",
}
const payment = { amount: "400", date: "2026-09-30", method: "CASH" }

describe("T08 direct repair contract and unchanged accepted c462 ceilings", () => {
  it("allows only actual dispatch, absent-or-complete return and positive actual cash", () => {
    expect(repairInputs.sendRepair.parse(send)).toEqual(send)
    expect(
      repairInputs.returnRepair.parse({ ...returned, invoiceAmount: "0" })
        .payment
    ).toBeUndefined()
    expect(
      repairInputs.returnRepair.parse({ ...returned, payment }).payment
    ).toEqual(payment)
    expect(
      repairInputs.payRepair.parse({ repairId: id, payment }).payment.date
    ).toBe("2026-09-30")
    for (const field of [
      "invoiceAmount",
      "invoiceDate",
      "returnedDate",
      "summary",
    ])
      expect(
        repairInputs.returnRepair.safeParse(
          Object.fromEntries(
            Object.entries(returned).filter(([key]) => key !== field)
          )
        ).success
      ).toBe(false)
    for (const extra of [
      { invoiceAmount: "1" },
      { estimate: "1" },
      { payment },
      { approvalId: id },
    ])
      expect(
        repairInputs.sendRepair.safeParse({ ...send, ...extra }).success
      ).toBe(false)
    for (const amount of [
      "0",
      "01",
      "-1",
      "1.0",
      "1e3",
      "100000000000000",
      400,
    ])
      expect(
        repairInputs.payRepair.safeParse({
          repairId: id,
          payment: { ...payment, amount },
        }).success
      ).toBe(false)
    for (const sentDate of ["0000-01-01", "2026-02-30", "2026-1-01"])
      expect(
        repairInputs.sendRepair.safeParse({ ...send, sentDate }).success
      ).toBe(false)
  })

  it("retains the existing exact correction wire and rejects invented owners/patches", () => {
    const reversal = {
      sourceType: "REPAIR",
      sourceId: id,
      paymentId: other,
      reason: "Wrong actual entry",
      replacement: payment,
    }
    expect(repairReversalInput.parse(reversal)).toEqual(reversal)
    for (const extra of [
      { invoiceAmount: "1" },
      { repairId: id },
      { cashRefund: payment },
      { reason: " " },
      { sourceType: "COST" },
    ])
      expect(
        repairReversalInput.safeParse({ ...reversal, ...extra }).success
      ).toBe(false)
    const body = {
      schemaVersion: 1,
      idempotencyKey: id,
      expected: [
        { type: "PurchaseRecord", id, revision: 3 },
        { type: "RepairVendor", id: other, revision: 2 },
      ],
      input: send,
    }
    expect(repairEnvelope("sendRepair").safeParse(body).success).toBe(true)
    expect(
      repairEnvelope("sendRepair").safeParse({
        ...body,
        expected: [...body.expected, body.expected[0]],
      }).success
    ).toBe(false)
    expect(
      repairEnvelope("sendRepair").safeParse({
        ...body,
        input: { ...send, revision: 1 },
      }).success
    ).toBe(false)
  })

  it("keeps every accepted c462 non-sales subject/action/field universe byte-equivalent after sorting", () => {
    const old = Object.fromEntries(
      Object.entries(registry)
        .filter(
          ([s]) =>
            ![
              "RepairRecord",
              "SaleCase",
              "PurchaseRecord",
              "ApprovalRequest",
              "BrokerageDeal",
              "CashFacility",
              "DispatchBatch",
              "CommissionEntitlement",
            ].includes(s)
        )
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([s, actions]) => [
          s,
          Object.fromEntries(
            Object.entries(actions)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([a, fields]) => [a, [...fields].sort()])
          ),
        ])
    )
    expect(Object.keys(old)).toHaveLength(16)
    expect(createHash("sha256").update(JSON.stringify(old)).digest("hex")).toBe(
      "d8e294c777f211a134d2e0a006b8d061ab62bdfa7b92c9cff8c82387de420def"
    )
    expect(registryVersion).toBe(16)
    expect(
      attenuation(
        [{ subject: "PurchaseRecord", action: "read", fields: ["repairs"] }],
        [],
        [
          {
            subject: "RepairRecord",
            action: "read",
            fields: ["invoiceAmount"],
          },
        ],
        id
      ).covered
    ).toBe(false)
    expect(
      grantSchema.safeParse({
        subject: "RepairRecord",
        action: "approve",
        fields: ["*"],
      }).success
    ).toBe(false)
    expect(
      grantSchema.safeParse({
        subject: "RepairRecord",
        action: "update",
        fields: ["vendorId"],
      }).success
    ).toBe(false)
  })

  it("evaluates immutable repair ownership independently from parent/vendor grants", () => {
    const ability = abilityFor(
      [
        {
          subject: "RepairRecord",
          action: "read",
          fields: ["id", "invoiceAmount"],
          conditions: { createdBy: "$actor.id" },
        },
      ],
      id
    )
    expect(
      ability.can(
        "read",
        subject("RepairRecord", { createdBy: id }),
        "invoiceAmount"
      )
    ).toBe(true)
    expect(
      ability.can(
        "read",
        subject("RepairRecord", { createdBy: other }),
        "invoiceAmount"
      )
    ).toBe(false)
    expect(
      ability.can(
        "read",
        subject("PurchaseRecord", { createdBy: id }),
        "repairs"
      )
    ).toBe(false)
    expect(
      ability.can("pay", subject("RepairRecord", { createdBy: id }), "repairId")
    ).toBe(false)
  })

  it("rejects an explicitly different typed owner without conflating unknown IDs with invalid input", () => {
    const body = {
      schemaVersion: 1,
      idempotencyKey: id,
      expected: [{ type: "PurchaseRecord", id, revision: 1 }],
      input: {
        sourceType: "REPAIR",
        sourceId: id,
        paymentId: other,
        reason: "Original wrong-source negative",
      },
    }
    expect(repairReversalEnvelope.safeParse(body).success).toBe(false)
    expect(
      repairReversalEnvelope.safeParse({
        ...body,
        expected: [{ type: "PurchaseRecord", id: other, revision: 1 }],
      }).success
    ).toBe(true)
    expect(
      repairReversalEnvelope.safeParse({
        ...body,
        expected: [...body.expected, { type: "RepairRecord", id, revision: 1 }],
      }).success
    ).toBe(true)
  })

  it("uses bigint over complete authorized payment facts, never a hidden/partial zero", () => {
    expect(
      authorizedRepairBalance({
        invoiceAmount: "1000",
        payments: [
          { amount: "400", direction: "OUT" },
          { amount: "600", direction: "OUT" },
          { amount: "400", direction: "IN" },
        ],
      })
    ).toBe(400n)
    expect(
      authorizedRepairBalance({ invoiceAmount: "99999999999999", payments: [] })
    ).toBe(99999999999999n)
    for (const repair of [
      { payments: [] },
      { invoiceAmount: "1000" },
      { invoiceAmount: "1000", payments: [{ amount: "400" }] },
      { invoiceAmount: "1000", payments: [{ direction: "OUT" as const }] },
    ])
      expect(authorizedRepairBalance(repair)).toBeUndefined()
  })
})
