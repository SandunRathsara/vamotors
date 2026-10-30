import { describe, expect, it } from "vitest"
import { cycleEditEnvelope, cycleEditInputs } from "../../lib/server/validators"
import { abilityFor, grantSchema } from "../../lib/server/permissions"

const id = "03000000-0000-4000-8000-000000000011"
const values = {
  engineNumber: " e-1 ",
  chassisNumber: "c-1",
  make: "Test",
  model: "Actual",
  year: 2026,
  colour: "Blue",
  fuelType: "PETROL",
  transmission: "AUTOMATIC",
}
describe("open-cycle mileage, asking price and physical wire boundaries", () => {
  it("retains zero and maximum canonical asking price, rejects unsafe wire money", () => {
    for (const amount of ["0", "99999999999999"])
      expect(
        cycleEditInputs.setListedPrice.parse({ cycleId: id, amount }).amount
      ).toBe(amount)
    for (const amount of [
      0,
      "01",
      "-1",
      "1.00",
      "1e2",
      "100000000000000",
      null,
    ])
      expect(
        cycleEditInputs.setListedPrice.safeParse({ cycleId: id, amount })
          .success
      ).toBe(false)
  })
  it("requires actual Gregorian dates and integer bounded mileage; no empty reasons", () => {
    for (const reading of [0, 99999999])
      expect(
        cycleEditInputs.addMileage.parse({
          cycleId: id,
          mileage: { reading, date: "2026-10-01" },
        }).mileage.reading
      ).toBe(reading)
    for (const mileage of [
      { reading: -1, date: "2026-10-01" },
      { reading: 1.5, date: "2026-10-01" },
      { reading: 100000000, date: "2026-10-01" },
      { reading: "0", date: "2026-10-01" },
      { reading: 0, date: "2026-02-30" },
      { reading: 0, date: "2026-10-01", decreaseReason: " " },
    ])
      expect(
        cycleEditInputs.addMileage.safeParse({ cycleId: id, mileage }).success
      ).toBe(false)
  })
  it("uses full physical values with optional omission, never wire null or arbitrary patches", () => {
    expect(
      cycleEditInputs.editVehicle.parse({
        vehicleId: id,
        values,
        reason: "Correct source transcription",
      }).values.engineNumber
    ).toBe("e-1")
    for (const input of [
      { vehicleId: id, values, reason: " " },
      { vehicleId: id, values: { ...values, vin: null }, reason: "Correction" },
      {
        vehicleId: id,
        values: { ...values, activePurchaseId: id },
        reason: "Correction",
      },
      {
        vehicleId: id,
        values: { ...values, fuelType: "STEAM" },
        reason: "Correction",
      },
      {
        vehicleId: id,
        values: { ...values, year: 1885 },
        reason: "Correction",
      },
      {
        vehicleId: id,
        values: { ...values, engineNumber: " \t " },
        reason: "Correction",
      },
    ])
      expect(cycleEditInputs.editVehicle.safeParse(input).success).toBe(false)
    expect(
      cycleEditEnvelope("setListedPrice").safeParse({
        schemaVersion: 1,
        idempotencyKey: id,
        expected: [],
        input: { cycleId: id, amount: "0", actor: "ADMIN" },
      }).success
    ).toBe(false)
  })
  it("keeps read leaf grants separate from operational write paths", () => {
    const ability = abilityFor(
      [
        { subject: "Vehicle", action: "read", fields: ["mileage.reading"] },
        {
          subject: "PurchaseRecord",
          action: "update",
          fields: ["cycleId", "mileage.reading", "mileage.date"],
        },
      ],
      id
    )
    expect(ability.can("read", "Vehicle", "mileage.decreaseReason")).toBe(false)
    expect(ability.can("update", "PurchaseRecord", "amount")).toBe(false)
    expect(ability.can("update", "Vehicle", "values.engineNumber")).toBe(false)
    expect(
      grantSchema.safeParse({
        subject: "Mileage",
        action: "append",
        fields: ["*"],
      }).success
    ).toBe(false)
  })
})
