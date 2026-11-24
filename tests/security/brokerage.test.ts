import { describe, expect, it } from "vitest"
import { checklistHashFor } from "../../lib/server/brokerage-math"
import {
  calculateFacilityDisbursement,
  calculateFacilityRecovery,
} from "../../lib/server/domain-math"
import {
  brokerageInputs,
  dispatchInput,
  facilityTerms,
} from "../../lib/server/validators"
import {
  administratorGrants,
  registry,
  registryVersion,
  expanded,
} from "../../lib/server/permissions"

const item = (overrides: Partial<Parameters<typeof checklistHashFor>[0][number]> = {}) => ({
  uniqueKey: "CUSTOMER_ID:",
  kind: "CUSTOMER_ID",
  label: null,
  participantId: null,
  applicability: "REQUIRED",
  applicabilityReason: null,
  collected: true,
  quantity: 0,
  attachments: ["b", "a"],
  ...overrides,
})

describe("brokerage checklist hash", () => {
  it("is deterministic regardless of row and attachment order", () => {
    const first = checklistHashFor(
      [item(), item({ uniqueKey: "EXTRA_KEY:", kind: "EXTRA_KEY", attachments: [] })],
      1
    )
    const second = checklistHashFor(
      [item({ uniqueKey: "EXTRA_KEY:", kind: "EXTRA_KEY", attachments: [] }), item()],
      1
    )
    expect(first).toMatch(/^[a-f0-9]{64}$/)
    expect(second).toBe(first)
  })

  it("binds the quote selection version and evidence changes", () => {
    expect(checklistHashFor([item()], 2)).not.toBe(checklistHashFor([item()], 1))
    expect(
      checklistHashFor([item({ quantity: 4 })], 1)
    ).not.toBe(checklistHashFor([item({ quantity: 5 })], 1))
    expect(
      checklistHashFor([item({ attachments: ["a"] })], 1)
    ).not.toBe(checklistHashFor([item({ attachments: ["a", "b"] })], 1))
  })
})

describe("cash facility math", () => {
  it("gross 1000 minus withheld 100 and withheld fee 20 yields 880", () => {
    const result = calculateFacilityDisbursement({
      gross: 100000n,
      deductions: [{ label: "Doc", amount: 10000n, handling: "WITHHELD" }],
      fee: 2000n,
      feeMode: "WITHHELD",
    })
    expect(result.netDisbursed).toBe(88000n)
    expect(result.recoverablePrincipal).toBe(88000n)
    expect(result.recoverableFee).toBe(0n)
    expect(result.withheldFee).toBe(2000n)
  })

  it("SEPARATE fee is not deducted but is separately recoverable", () => {
    const result = calculateFacilityDisbursement({
      gross: 100000n,
      deductions: [{ amount: 10000n, handling: "WITHHELD" }],
      fee: 2000n,
      feeMode: "SEPARATE",
    })
    expect(result.netDisbursed).toBe(90000n)
    expect(result.recoverableFee).toBe(2000n)
  })

  it("PAID_BY_DEALERSHIP deductions are separate outflows, not net deductions", () => {
    const result = calculateFacilityDisbursement({
      gross: 100000n,
      deductions: [
        { amount: 10000n, handling: "PAID_BY_DEALERSHIP" },
        { amount: 10000n, handling: "WITHHELD" },
      ],
      fee: 0n,
      separatelyRecoverableCharges: 10000n,
    })
    expect(result.netDisbursed).toBe(90000n)
    expect(result.paidByDealershipTotal).toBe(10000n)
    expect(result.totalCashOut).toBe(100000n)
  })

  it("rejects negative net and over-declared charge recovery", () => {
    expect(() =>
      calculateFacilityDisbursement({
        gross: 10000n,
        deductions: [{ amount: 20000n, handling: "WITHHELD" }],
        fee: 0n,
      })
    ).toThrow()
    expect(() =>
      calculateFacilityDisbursement({
        gross: 100000n,
        deductions: [{ amount: 1000n, handling: "PAID_BY_DEALERSHIP" }],
        fee: 0n,
        separatelyRecoverableCharges: 2000n,
      })
    ).toThrow()
  })

  it("caps each recovery component and rejects over-recovery", () => {
    const obligations = { principal: 88000n, charges: 0n, fee: 0n }
    const partial = calculateFacilityRecovery({
      obligations,
      payment: { principal: 40000n },
    })
    expect(partial.remainingAfter.principal).toBe(48000n)
    expect(partial.fullyRecovered).toBe(false)
    const full = calculateFacilityRecovery({
      obligations,
      alreadyRecovered: { principal: 40000n },
      payment: { principal: 48000n },
    })
    expect(full.fullyRecovered).toBe(true)
    expect(() =>
      calculateFacilityRecovery({
        obligations,
        alreadyRecovered: { principal: 40000n },
        payment: { principal: 48001n },
      })
    ).toThrow()
  })
})

describe("brokerage validators", () => {
  const guarantor = {
    name: "Guarantor",
    identity: "900000000V",
    address: "Address",
    phone: "0112345678",
  }
  it("rejects zero guarantors", () => {
    expect(
      brokerageInputs.openBrokerage.safeParse({
        customerId: crypto.randomUUID(),
        guarantors: [],
        quoteId: crypto.randomUUID(),
      }).success
    ).toBe(false)
  })

  it("accepts exactly two guarantors and optional facility", () => {
    expect(
      brokerageInputs.openBrokerage.safeParse({
        customerId: crypto.randomUUID(),
        guarantors: [guarantor, { ...guarantor, identity: "800000000V" }],
        quoteId: crypto.randomUUID(),
      }).success
    ).toBe(true)
  })

  it("rejects duplicate inspection categories", () => {
    expect(
      brokerageInputs.recordInspection.safeParse({
        dealId: crypto.randomUUID(),
        photos: [
          { category: "FRONT", attachmentId: crypto.randomUUID() },
          { category: "FRONT", attachmentId: crypto.randomUUID() },
        ],
      }).success
    ).toBe(false)
  })

  it("requires a blocked step for BLOCKER and forbids it otherwise", () => {
    const base = {
      dealId: crypto.randomUUID(),
      text: "Issue",
      at: new Date().toISOString(),
    }
    expect(
      brokerageInputs.openIssue.safeParse({ ...base, kind: "BLOCKER" }).success
    ).toBe(false)
    expect(
      brokerageInputs.openIssue.safeParse({
        ...base,
        kind: "DELAY_INQUIRY",
        blocksStep: "DISPATCH",
      }).success
    ).toBe(false)
  })

  it("validates facility charge recovery bounds", () => {
    expect(
      facilityTerms.safeParse({
        gross: "100000",
        deductions: [{ label: "X", amount: "1000", recipient: "R", handling: "WITHHELD" }],
        fee: "0",
        feeMode: "WITHHELD",
        separatelyRecoverableCharges: "1000",
      }).success
    ).toBe(false)
  })

  it("caps dispatch members at 50 unique sources", () => {
    const member = () => ({
      type: "BROKERAGE" as const,
      id: crypto.randomUUID(),
      revision: 1,
      checklistHash: "a".repeat(64),
    })
    expect(
      dispatchInput.safeParse({
        sourceIds: Array.from({ length: 51 }, member),
        handedOverAt: new Date().toISOString(),
        courier: "Courier",
      }).success
    ).toBe(false)
    const duplicate = member()
    expect(
      dispatchInput.safeParse({
        sourceIds: [duplicate, duplicate],
        handedOverAt: new Date().toISOString(),
        courier: "Courier",
      }).success
    ).toBe(false)
  })
})

describe("permission registry v16", () => {
  it("publishes brokerage subjects and the administrator ceiling", () => {
    expect(registryVersion).toBe(17)
    expect(Object.keys(registry)).toEqual(
      expect.arrayContaining([
        "BrokerageDeal",
        "CashFacility",
        "DispatchBatch",
        "CommissionEntitlement",
      ])
    )
    const subjects = new Set(administratorGrants.map((grant) => grant.subject))
    for (const subject of [
      "BrokerageDeal",
      "CashFacility",
      "DispatchBatch",
      "CommissionEntitlement",
    ] as const) {
      expect(subjects.has(subject)).toBe(true)
    }
    const dispatch = administratorGrants.find(
      (grant) => grant.subject === "BrokerageDeal" && grant.action === "dispatch"
    )!
    expect(expanded(dispatch)).toContain("sourceIds")
  })
})
