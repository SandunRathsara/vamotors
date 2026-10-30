import { describe, expect, it } from "vitest"
import {
  cycleMoneyEnvelope,
  cycleMoneyInputs,
} from "../../lib/server/validators"
import {
  abilityFor,
  attenuation,
  grantSchema,
  registryVersion,
  sourcePaymentFields,
} from "../../lib/server/permissions"
import { C, sum, cashTotals, parseMajor } from "../../lib/money"

const id = "03000000-0000-4000-8000-000000000011"
const cost = {
  cycleId: id,
  category: "Transport",
  description: "Actual invoice",
  amount: "500",
  incurredDate: "2026-10-02",
}
const payment = { amount: "200", date: "2026-10-03", method: "CASH" }
describe("T05c bounded costs and immutable source corrections", () => {
  it("accepts zero/unpaid/partial/full cost without inventing a payment", () => {
    expect(
      cycleMoneyInputs.addCost.parse({ ...cost, amount: "0" }).payment
    ).toBeUndefined()
    expect(
      cycleMoneyInputs.addCost.parse({ ...cost, payment }).payment?.amount
    ).toBe("200")
    expect(sum([10000n, 500n], C)).toBe(10500n)
    expect(
      cashTotals([
        { direction: "OUT", amount: "10000" },
        { direction: "OUT", amount: "200" },
      ]).outgoing
    ).toBe("10200")
    expect(parseMajor("999999999999.99")).toBe("99999999999999")
  })
  it("rejects noncanonical/unsafe/zero payment input", () => {
    for (const amount of [
      "01",
      "-0",
      "-1",
      "1.0",
      "1e2",
      "100000000000000",
      200,
    ])
      expect(
        cycleMoneyInputs.addCost.safeParse({ ...cost, amount }).success
      ).toBe(false)
    for (const amount of ["0", "01", "1.001", "100000000000000"])
      expect(
        cycleMoneyInputs.payCost.safeParse({
          costId: id,
          payment: { ...payment, amount },
        }).success
      ).toBe(false)
    expect(() => sum([C, 1n], C)).toThrow("MONEY_OVERFLOW")
  })
  it("preserves accepted DTOs: no cost cashCorrections or generic term patch", () => {
    expect(
      cycleMoneyInputs.editCost.safeParse({
        ...cost,
        cycleId: undefined,
        costId: id,
        reason: "Correct invoice",
        cashCorrections: [],
      }).success
    ).toBe(false)
    for (const patch of [
      { supplierId: id },
      { seller: { type: "SUPPLIER", id, recipient: "SELLER" } },
      { purchaseType: "LEASE_SETTLEMENT", settlement: { amount: "1" } },
      { listedPrice: "1" },
      { vehicleId: id },
    ])
      expect(
        cycleMoneyInputs.editPurchase.safeParse({
          cycleId: id,
          reason: "Correction",
          patch,
          cashCorrections: [],
        }).success
      ).toBe(false)
    expect(
      cycleMoneyInputs.editPurchase.safeParse({
        cycleId: id,
        reason: "Correction",
        patch: { purchasePrice: "12000", notes: null },
        cashCorrections: [],
      }).success
    ).toBe(true)
  })
  it("requires Gregorian dates and bounded nonblank reasons", () => {
    for (const incurredDate of ["2026-02-30", "0000-01-01", "2026-2-02"])
      expect(
        cycleMoneyInputs.addCost.safeParse({ ...cost, incurredDate }).success
      ).toBe(false)
    for (const reason of [" ", "x".repeat(2001)])
      expect(
        cycleMoneyInputs.reversePayment.safeParse({
          sourceType: "COST",
          sourceId: id,
          paymentId: id,
          reason,
        }).success
      ).toBe(false)
    for (const sourceType of [
      "REPAIR",
      "SALE",
      "FACILITY",
      "BROKERAGE_FEE",
      "REMITTANCE",
    ])
      expect(
        cycleMoneyInputs.reversePayment.safeParse({
          sourceType,
          sourceId: id,
          paymentId: id,
          reason: "Not implemented",
        }).success
      ).toBe(false)
  })
  it("requires distinct refs and explicit cash correction identities", () => {
    const body = {
      schemaVersion: 1,
      idempotencyKey: id,
      expected: [{ type: "PurchaseRecord", id, revision: 1 }],
      input: cost,
    }
    expect(cycleMoneyEnvelope("addCost").safeParse(body).success).toBe(true)
    expect(
      cycleMoneyEnvelope("addCost").safeParse({
        ...body,
        expected: [...body.expected, ...body.expected],
      }).success
    ).toBe(false)
    const correction = {
      paymentId: id,
      replacement: payment,
      reason: "Wrong entry",
    }
    expect(
      cycleMoneyInputs.editPurchase.safeParse({
        cycleId: id,
        reason: "Correction",
        patch: {},
        cashCorrections: [correction, correction],
      }).success
    ).toBe(false)
  })
  it("does not launder root/child actions or old delegation ceilings", () => {
    const ability = abilityFor(
      [
        { subject: "PurchaseRecord", action: "update", fields: ["reason"] },
        { subject: "VehicleCost", action: "read", fields: ["id", "revision"] },
      ],
      id
    )
    expect(registryVersion).toBe(14)
    expect(ability.can("update", "PurchaseRecord", "cycleId")).toBe(false)
    expect(ability.can("pay", "VehicleCost")).toBe(false)
    expect(
      attenuation(
        [{ subject: "PurchaseRecord", action: "update", fields: ["reason"] }],
        [],
        [
          {
            subject: "PurchaseRecord",
            action: "update",
            fields: ["patch.purchasePrice"],
          },
        ],
        id
      ).covered
    ).toBe(false)
    expect(
      grantSchema.safeParse({
        subject: "VehicleCost",
        action: "reverse",
        fields: ["*"],
      }).success
    ).toBe(false)
    for (const field of sourcePaymentFields)
      expect(
        grantSchema.safeParse({
          subject: "VehicleCost",
          action: "read",
          fields: [`payments.${field}`],
        }).success
      ).toBe(true)
  })
})
