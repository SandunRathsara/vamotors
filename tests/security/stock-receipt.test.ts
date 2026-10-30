import { describe, expect, it } from "vitest"
import { stockEnvelope } from "../../lib/server/validators"
import {
  abilityFor,
  attenuation,
  grantSchema,
  registry,
} from "../../lib/server/permissions"
const cycleId = "8b2495bf-3380-4d22-8f8e-af72c7f91792"
const body = {
  schemaVersion: 1,
  idempotencyKey: cycleId,
  expected: [{ type: "PurchaseRecord", id: cycleId, revision: 1 }],
  input: { cycleId, date: "2026-10-01", disposition: { kind: "RELEASE" } },
}
describe("bounded stock command boundary", () => {
  it("accepts the exact receive/hold/release contract shapes", () => {
    expect(stockEnvelope("receiveStock").safeParse(body).success).toBe(true)
    expect(
      stockEnvelope("holdStock").safeParse({
        ...body,
        input: { cycleId, reason: "Held" },
      }).success
    ).toBe(true)
    expect(
      stockEnvelope("releaseStock").safeParse({ ...body, input: { cycleId } })
        .success
    ).toBe(true)
  })
  it("rejects invented override, actor and disposition sibling fields", () => {
    for (const input of [
      { ...body.input, override: true },
      { ...body.input, actor: cycleId },
      { ...body.input, disposition: { kind: "RELEASE", reason: "extra" } },
    ])
      expect(
        stockEnvelope("receiveStock").safeParse({ ...body, input }).success
      ).toBe(false)
  })
  it("requires nonblank bounded hold reason", () => {
    for (const reason of [" ", "x".repeat(2001)])
      expect(
        stockEnvelope("holdStock").safeParse({
          ...body,
          input: { cycleId, reason },
        }).success
      ).toBe(false)
  })
  it("rejects year zero and impossible Gregorian dates", () => {
    for (const date of ["0000-01-01", "2026-02-29", "2026-13-01"])
      expect(
        stockEnvelope("receiveStock").safeParse({
          ...body,
          input: { ...body.input, date },
        }).success
      ).toBe(false)
  })
  it("rejects duplicate refs, unknown root fields and string revisions", () => {
    for (const candidate of [
      { ...body, expected: [...body.expected, ...body.expected] },
      { ...body, override: true },
      { ...body, expected: [{ ...body.expected[0], revision: "1" }] },
    ])
      expect(stockEnvelope("receiveStock").safeParse(candidate).success).toBe(
        false
      )
  })
  it("keeps stock operations separate from explicit bounded correction fields", () => {
    expect(registry.PurchaseRecord.update).toEqual([
      "reason",
      "cycleId",
      "amount",
      "mileage.reading",
      "mileage.date",
      "mileage.remark",
      "mileage.decreaseReason",
      "patch.purchaseDate",
      "patch.purchasePrice",
      "patch.notes",
      "patch.purchaseType",
      "patch.seller.type",
      "patch.seller.id",
      "patch.settlement",
      "patch.settlement.institutionType",
      "patch.settlement.companyId",
      "patch.settlement.institutionName",
      "patch.settlement.reference",
      "patch.settlement.amount",
      "patch.settlement.cashToSeller",
    ])
    expect(
      grantSchema.safeParse({
        subject: "PurchaseRecord",
        action: "update",
        fields: ["purchasePrice"],
      }).success
    ).toBe(false)
    expect(
      grantSchema.safeParse({
        subject: "Vehicle",
        action: "update",
        fields: ["make"],
      }).success
    ).toBe(false)
    const ability = abilityFor(
      [
        {
          subject: "PurchaseRecord",
          action: "receive",
          fields: ["date", "disposition.kind"],
        },
      ],
      cycleId
    )
    expect(ability.can("receive", "PurchaseRecord", "disposition.reason")).toBe(
      false
    )
    expect(ability.can("release", "PurchaseRecord")).toBe(false)
  })
  it("old read/create ceilings cannot delegate any new stock action", () => {
    for (const action of ["receive", "release", "update"] as const)
      expect(
        attenuation(
          [
            { subject: "PurchaseRecord", action: "create", fields: ["*"] },
            { subject: "PurchaseRecord", action: "read", fields: ["*"] },
          ],
          [],
          [{ subject: "PurchaseRecord", action, fields: ["*"] }],
          cycleId
        ).covered
      ).toBe(false)
  })
})
