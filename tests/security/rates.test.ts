import { describe, it, expect } from "vitest"
import {
  rateCommands,
  compareInput,
  maximaInput,
} from "@/lib/server/validators"
import {
  abilityFor,
  grantSchema,
  project,
  readScope,
} from "@/lib/server/permissions"
import type { Grant } from "@/.planning/implementation/contracts/api"
const companyId = "03000000-0000-4000-8000-000000000011"
const vehicle = {
  make: "Demo",
  model: "Demo100",
  year: 2026,
  description: "Synthetic external vehicle",
}
const input = {
  companyId,
  make: vehicle.make,
  model: vehicle.model,
  year: vehicle.year,
  maximum: "120000",
  validFrom: "2026-10-01",
  validThrough: "2026-12-31",
  cards: [{ principal: "100000", months: 12, installment: "9000" }],
}
describe("exact rates trust boundary", () => {
  it("rejects duplicates, bounds, malformed money/dates and unknown authority without throwing", () => {
    expect(rateCommands.publishRates.safeParse(input).success).toBe(true)
    for (const patch of [
      { maximum: "bad" },
      { maximum: "0" },
      { maximum: 120000 },
      { actor: "forged" },
      { validFrom: "2026-02-30" },
      { validFrom: "2027-01-01" },
      { cards: [] },
      { cards: [...input.cards, ...input.cards] },
      { cards: [{ principal: "120001", months: 12, installment: "9000" }] },
      ...["bad", "01", "1.2", "100000000000000", "-1"].map((principal) => ({
        cards: [{ principal, months: 12, installment: "9000" }],
      })),
      { cards: [{ principal: "1", months: 121, installment: "0" }] },
    ]) {
      expect(() =>
        rateCommands.publishRates.safeParse({ ...input, ...patch })
      ).not.toThrow()
      expect(
        rateCommands.publishRates.safeParse({ ...input, ...patch }).success
      ).toBe(false)
    }
  })
  it("requires exactly one known term and maxima needs neither principal nor terms", () => {
    expect(
      maximaInput.safeParse({
        vehicle: { make: "Demo", model: "Demo100", year: 2026 },
        asOf: "2026-10-30",
      }).success
    ).toBe(true)
    for (const term of [{ months: 12 }, { installment: "9000" }])
      expect(
        compareInput.safeParse({
          vehicle,
          asOf: "2026-10-30",
          principal: "100000",
          ...term,
        }).success
      ).toBe(true)
    for (const term of [
      {},
      { months: 12, installment: "9000" },
      { months: 0 },
      { installment: 9000 },
    ])
      expect(
        compareInput.safeParse({
          vehicle,
          asOf: "2026-10-30",
          principal: "100000",
          ...term,
        }).success
      ).toBe(false)
  })
  it("keeps Quote immutable, owner/company scoped and policy/charges independently private", () => {
    for (const rule of [
      { subject: "Quote", action: "update", fields: ["policy"] },
      { subject: "Quote", action: "create", fields: ["policy"] },
      {
        subject: "Quote",
        action: "read",
        fields: ["*"],
        conditions: { customerId: companyId },
      },
    ])
      expect(grantSchema.safeParse(rule).success).toBe(false)
    const grants: Grant[] = [
      {
        subject: "Quote",
        action: "read",
        fields: ["id", "policy.path"],
        conditions: { financeCompanyId: companyId },
      },
    ]
    const ability = abilityFor(grants, companyId)
    const row = {
      id: companyId,
      companyId,
      financeCompanyId: companyId,
      policy: {
        path: "APPLICATION",
        processingFee: "250000",
        commission: { rateBps: 100 },
      },
      charges: [{ category: "DOCUMENT", amount: "1" }],
    }
    expect(project(ability, "Quote", row)).toMatchObject({
      id: companyId,
      policy: { path: "APPLICATION" },
      redactedFields: expect.arrayContaining([
        "charges",
        "policy.processingFee",
      ]),
    })
    expect(readScope(grants, companyId, "Quote")).toEqual({
      OR: [{ companyId }],
    })
    expect(() =>
      project(ability, "Quote", { ...row, financeCompanyId: "foreign" })
    ).toThrow("NOT_FOUND")
  })
})
