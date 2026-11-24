import { describe, expect, it } from "vitest"
import {
  purchaseEnvelope,
  purchaseInput,
  vehicleInput,
} from "../../lib/server/validators"
import {
  abilityFor,
  attenuation,
  registryVersion,
  readScope,
} from "../../lib/server/permissions"
import { parseMajor } from "../../lib/money"
const input = {
  vehicle: {
    engineNumber: " e-1 ",
    chassisNumber: "c 1",
    make: "Synthetic",
    model: "Test",
    year: 2026,
    colour: "Blue",
    fuelType: "PETROL",
    transmission: "AUTOMATIC",
  },
  supplierId: "03000000-0000-4000-8000-000000000011",
  purchaseDate: "2026-10-01",
  purchaseType: "CASH",
  purchasePrice: "2147483648",
  listedPrice: "99999999999999",
  mileage: { reading: 0, date: "2026-10-01" },
  paymentMethod: "BANK_TRANSFER",
}
describe("bounded T05a acquisition boundary", () => {
  const searchLeaves = [
    "identity.make",
    "identity.model",
    "identity.engineNumber",
    "identity.chassisNumber",
  ]
  it("authorizes exact identity leaves across grants for the same record population", () => {
    for (const type of ["Vehicle", "PurchaseRecord"] as const) {
      const grants = searchLeaves.map((field) => ({
        subject: type,
        action: "read" as const,
        fields: ["id", field],
        conditions: { createdBy: "$actor.id" as const },
      }))
      expect(readScope(grants, input.supplierId, type, searchLeaves)).toEqual({
        OR: searchLeaves.map(() => ({ createdBy: input.supplierId })),
      })
      expect(() =>
        readScope(grants, input.supplierId, type, ["identity"])
      ).toThrow("FIELD_FORBIDDEN")
      for (const field of searchLeaves)
        expect(() =>
          readScope(
            grants.filter((g) => !g.fields.includes(field)),
            input.supplierId,
            type,
            searchLeaves
          )
        ).toThrow("FIELD_FORBIDDEN")
    }
  })
  it("does not expand a public record population with private identity leaf grants", () => {
    for (const type of ["Vehicle", "PurchaseRecord"] as const)
      expect(() =>
        readScope(
          [
            { subject: type, action: "read", fields: ["id", "identity.make"] },
            {
              subject: type,
              action: "read",
              fields: searchLeaves,
              conditions: { createdBy: "$actor.id" },
            },
          ],
          input.supplierId,
          type,
          searchLeaves
        )
      ).toThrow("FIELD_FORBIDDEN")
  })
  it("keeps unconditional SQL scopes true and permits only fully covered scoped predicates", () => {
    expect(readScope([], input.supplierId, "PurchaseRecord")).toEqual({
      id: { in: [] },
    })
    expect(
      readScope(
        [{ subject: "PurchaseRecord", action: "read", fields: ["*"] }],
        input.supplierId,
        "PurchaseRecord",
        ["id"]
      )
    ).toEqual({})
    expect(
      readScope(
        [
          {
            subject: "PurchaseRecord",
            action: "read",
            fields: ["id"],
            conditions: { createdBy: "$actor.id" },
          },
        ],
        input.supplierId,
        "PurchaseRecord",
        ["id"]
      )
    ).toEqual({ OR: [{ createdBy: input.supplierId }] })
    expect(() =>
      readScope(
        [
          { subject: "PurchaseRecord", action: "read", fields: ["id"] },
          {
            subject: "PurchaseRecord",
            action: "read",
            fields: ["purchasePrice"],
            conditions: { createdBy: "$actor.id" },
          },
        ],
        input.supplierId,
        "PurchaseRecord",
        ["purchasePrice"]
      )
    ).toThrow("FIELD_FORBIDDEN")
  })
  it("preserves zero mileage, optional VIN/CR and exact >32-bit currency", () => {
    const result = purchaseInput.parse(input)
    expect(result.mileage.reading).toBe(0)
    expect(result.vehicle.vin).toBeUndefined()
    if (result.purchaseType === "LEASE_SETTLEMENT")
      throw new Error("Expected cash acquisition")
    expect(result.purchasePrice).toBe(parseMajor("21474836.48"))
    const maximum = purchaseInput.parse({
      ...input,
      purchasePrice: "99999999999999",
    })
    if (maximum.purchaseType === "LEASE_SETTLEMENT")
      throw new Error("Expected cash acquisition")
    expect(maximum.purchasePrice).toBe("99999999999999")
  })
  it("rejects noncanonical, zero and overflow money before execution", () => {
    for (const purchasePrice of [
      "0",
      "01",
      "-0",
      "1.0",
      "1e5",
      "100000000000000",
      100,
    ])
      expect(purchaseInput.safeParse({ ...input, purchasePrice }).success).toBe(
        false
      )
  })
  it("rejects invalid dates, identity, extras and unsupported lanes", () => {
    for (const patch of [
      { purchaseDate: "2026-02-30" },
      { purchaseDate: "0000-01-01" },
      { purchaseType: "LEASE_SETTLEMENT" },
      { purchaseType: "TRADE_IN" },
      { actor: "admin" },
      { available: true },
    ])
      expect(purchaseInput.safeParse({ ...input, ...patch }).success).toBe(
        false
      )
    expect(
      vehicleInput.safeParse({ ...input.vehicle, engineNumber: " \t " }).success
    ).toBe(false)
  })
  it("strict immutable envelope rejects duplicate refs and extra authority", () => {
    const envelope = {
      schemaVersion: 1,
      idempotencyKey: input.supplierId,
      expected: [{ type: "Supplier", id: input.supplierId, revision: 1 }],
      input,
    }
    expect(purchaseEnvelope.safeParse(envelope).success).toBe(true)
    expect(
      purchaseEnvelope.safeParse({
        ...envelope,
        expected: [...envelope.expected, ...envelope.expected],
      }).success
    ).toBe(false)
    expect(
      purchaseEnvelope.safeParse({ ...envelope, actor: "admin" }).success
    ).toBe(false)
  })
  it("enables only acquisition capability, not pay/settlement/receipt shortcuts", () => {
    const ability = abilityFor(
      [{ subject: "PurchaseRecord", action: "create", fields: ["*"] }],
      input.supplierId
    )
    expect(registryVersion).toBe(15)
    expect(ability.can("create", "PurchaseRecord", "purchasePrice")).toBe(true)
    expect(ability.can("pay", "PurchaseRecord")).toBe(false)
    expect(ability.can("receive", "PurchaseRecord")).toBe(false)
  })
  it("old explicit ceilings cannot delegate new purchase fields", () => {
    expect(
      attenuation(
        [
          {
            subject: "PurchaseRecord",
            action: "read",
            fields: ["id", "purchaseDate", "status", "purchasePrice"],
          },
        ],
        [],
        [{ subject: "PurchaseRecord", action: "read", fields: ["payments"] }],
        input.supplierId
      ).covered
    ).toBe(false)
  })
})
