import { describe, expect, it } from "vitest"
import { commitmentInputs } from "./validators"

describe("inventory finance input", () => {
  it("requires a positive new down payment even when applying an advance", () => {
    const record = "b60609e9-82a3-4a51-af63-b4db6f1d768f"
    const input = {
      reservationId: record,
      cycleId: record,
      customerId: record,
      companyId: record,
      price: "100",
      financeAmount: "85",
      termMonths: 12,
      downPayment: { amount: "10", date: "2026-11-24", method: "CASH" },
    }
    expect(commitmentInputs.startFinance.safeParse(input).success).toBe(true)
    expect(
      commitmentInputs.startFinance.safeParse({
        ...input,
        downPayment: { ...input.downPayment, amount: "0" },
      }).success
    ).toBe(false)
  })
})
