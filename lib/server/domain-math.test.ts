import { describe, it, expect } from "vitest"
import type { State } from "../../.planning/implementation/contracts/api"
import { A, C } from "../money"
import {
  COLOMBO_TIMEZONE,
  DEFAULT_ADVANCE_TIERS,
  LEGAL_TRANSITIONS,
  VEHICLE_STATES,
  addCalendarDays,
  calculateAdvanceValidity,
  calculateFacilityDisbursement,
  calculateFacilityRecovery,
  canTransitionVehicleState,
  computeEffectiveAvailable,
  computeNextWatermark,
  diffCalendarDays,
  isAdvanceExpired,
  isEntitlementOverdue,
  isWarningDue,
  localMidnightToUtc,
} from "./domain-math"

describe("10-state vehicle lifecycle & effective availability", () => {
  it("preserves all 10 canonical states", () => {
    expect(VEHICLE_STATES).toEqual([
      "PURCHASED",
      "IN_STOCK",
      "IN_REPAIR",
      "ADVANCE_PLACED",
      "ADVANCE_EXPIRED",
      "FINANCE_PENDING",
      "DO_RECEIVED",
      "DELIVERED",
      "SOLD",
      "WRITTEN_OFF",
    ])
    expect(VEHICLE_STATES).toHaveLength(10)
  })

  it("enforces the complete 10x10 matrix of legal and illegal transitions", () => {
    const expectedLegal = new Map<State, Set<State>>(
      VEHICLE_STATES.map((s) => [s, new Set(LEGAL_TRANSITIONS[s])])
    )

    for (const from of VEHICLE_STATES) {
      for (const to of VEHICLE_STATES) {
        const shouldBeLegal = expectedLegal.get(from)!.has(to)
        expect(canTransitionVehicleState(from, to)).toBe(shouldBeLegal)
      }
    }
  })

  it("ensures normal completion ends in SOLD and DELIVERED is never a transition target or bypass", () => {
    expect(canTransitionVehicleState("IN_STOCK", "SOLD")).toBe(true)
    expect(canTransitionVehicleState("ADVANCE_PLACED", "SOLD")).toBe(true)
    expect(canTransitionVehicleState("ADVANCE_EXPIRED", "SOLD")).toBe(true)
    expect(canTransitionVehicleState("DO_RECEIVED", "SOLD")).toBe(true)

    // No state may transition into DELIVERED
    for (const from of VEHICLE_STATES) {
      expect(canTransitionVehicleState(from, "DELIVERED")).toBe(false)
    }

    // DELIVERED only supports normalizeDelivered -> SOLD with completion & handover evidence
    expect(
      canTransitionVehicleState("DELIVERED", "SOLD", {
        action: "normalizeDelivered",
        hasCompletionEvidence: true,
        hasHandoverEvidence: true,
      })
    ).toBe(true)
    expect(
      canTransitionVehicleState("DELIVERED", "SOLD", {
        action: "normalizeDelivered",
        hasCompletionEvidence: false,
      })
    ).toBe(false)
    expect(
      canTransitionVehicleState("DELIVERED", "SOLD", {
        action: "completeImmediate",
      })
    ).toBe(false)
    expect(canTransitionVehicleState("DELIVERED", "IN_STOCK")).toBe(false)
    expect(canTransitionVehicleState("DELIVERED", "WRITTEN_OFF")).toBe(false)
  })

  it("blocks outgoing transitions from terminal states SOLD and WRITTEN_OFF and rejects prototype keys", () => {
    for (const to of VEHICLE_STATES) {
      expect(canTransitionVehicleState("SOLD", to)).toBe(false)
      expect(canTransitionVehicleState("WRITTEN_OFF", to)).toBe(false)
    }

    for (const bad of ["constructor", "toString", "__proto__", "UNKNOWN"]) {
      expect(canTransitionVehicleState(bad as State, "IN_STOCK")).toBe(false)
      expect(canTransitionVehicleState("IN_STOCK", bad as State)).toBe(false)
      expect(
        canTransitionVehicleState("IN_STOCK", "SOLD", { action: bad })
      ).toBe(false)
    }
  })

  it("enforces action and guard checks when opts are supplied", () => {
    // sendRepair can start from held IN_STOCK if no repair/commitment is open
    expect(
      canTransitionVehicleState("IN_STOCK", "IN_REPAIR", {
        action: "sendRepair",
        available: false,
        hasOpenRepair: false,
        hasOpenCommitment: false,
      })
    ).toBe(true)
    expect(
      canTransitionVehicleState("IN_STOCK", "IN_REPAIR", {
        action: "sendRepair",
        hasOpenCommitment: true,
      })
    ).toBe(false)

    // Sale / reservation / finance require available IN_STOCK
    for (const [to, action] of [
      ["ADVANCE_PLACED", "placeReservation"],
      ["FINANCE_PENDING", "startFinance"],
      ["SOLD", "completeImmediate"],
    ] as const) {
      expect(
        canTransitionVehicleState("IN_STOCK", to, {
          action,
          available: false,
        })
      ).toBe(false)
      expect(
        canTransitionVehicleState("IN_STOCK", to, {
          action,
          available: true,
        })
      ).toBe(true)
    }

    // Finance correction requires approval and no open obligation
    expect(
      canTransitionVehicleState("DO_RECEIVED", "IN_STOCK", {
        action: "approvedFinanceCorrection",
        hasApproval: false,
      })
    ).toBe(false)
    expect(
      canTransitionVehicleState("DO_RECEIVED", "IN_STOCK", {
        action: "approvedFinanceCorrection",
        hasApproval: true,
        hasOpenObligation: false,
      })
    ).toBe(true)

    // Direct write-off blocked while open repair or commitment exists
    expect(
      canTransitionVehicleState("IN_STOCK", "WRITTEN_OFF", {
        action: "approvedWriteOff",
        hasApproval: true,
        hasOpenCommitment: true,
      })
    ).toBe(false)
    expect(
      canTransitionVehicleState("PURCHASED", "WRITTEN_OFF", {
        action: "approvedWriteOff",
        hasApproval: true,
      })
    ).toBe(true)
  })

  it("computes effective availability strictly across all 10 states and flags", () => {
    for (const status of VEHICLE_STATES) {
      for (const held of [false, true]) {
        for (const hasOpenRepair of [false, true]) {
          for (const hasActiveCommitment of [false, true]) {
            const expected =
              status === "IN_STOCK" &&
              !held &&
              !hasOpenRepair &&
              !hasActiveCommitment
            expect(
              computeEffectiveAvailable({
                status,
                held,
                hasOpenRepair,
                hasActiveCommitment,
              })
            ).toBe(expected)
          }
        }
      }
    }

    // Expired unresolved advance stays unavailable even if flags are false
    expect(
      computeEffectiveAvailable({
        status: "ADVANCE_EXPIRED",
        held: false,
        hasOpenRepair: false,
        hasActiveCommitment: false,
      })
    ).toBe(false)

    // Closed cycle on IN_STOCK is unavailable
    expect(
      computeEffectiveAvailable({
        status: "IN_STOCK",
        held: false,
        hasOpenRepair: false,
        hasActiveCommitment: false,
        openCycle: false,
      })
    ).toBe(false)
  })
})

describe("advance tier & Asia/Colombo date math", () => {
  it("resolves exact 5%, 10%, 15% boundaries and ±1 minor unit thresholds", () => {
    const cases: [bigint, number][] = [
      [1n, 7],
      [499n, 7],
      [500n, 7],
      [501n, 14],
      [999n, 14],
      [1000n, 14],
      [1001n, 21],
      [1499n, 21],
      [1500n, 21],
      [1501n, 31],
      [10000n, 31],
    ]
    for (const [advanceAmount, expectedDays] of cases) {
      const res = calculateAdvanceValidity({
        advanceAmount,
        listedPrice: 10000n,
        placedDate: "2026-10-01",
      })
      expect(res.days).toBe(expectedDays)
    }
  })

  it("never infers tier from rounded display percentage (5004 / 100000 displays 5.00% but gets 14 days)", () => {
    const res = calculateAdvanceValidity({
      advanceAmount: 5004n,
      listedPrice: 100000n,
      placedDate: "2026-10-01",
    })
    expect(res.percentDisplay).toBe("5.00%")
    expect(res.days).toBe(14)
  })

  it("uses listedPrice for tier selection while allowing agreedPrice to differ", () => {
    // Listed 100,000, agreed discounted to 80,000, advance 5,000:
    // 5,000 / 100,000 = 5.00% -> 7 days (even though 5,000 / 80,000 = 6.25%)
    const res = calculateAdvanceValidity({
      advanceAmount: 5000n,
      listedPrice: 100000n,
      agreedPrice: 80000n,
      placedDate: "2026-10-01",
    })
    expect(res.days).toBe(7)
    expect(res.percentDisplay).toBe("5.00%")

    // Advance exceeding agreedPrice is rejected
    expect(() =>
      calculateAdvanceValidity({
        advanceAmount: 80001n,
        listedPrice: 100000n,
        agreedPrice: 80000n,
        placedDate: "2026-10-01",
      })
    ).toThrow("INVALID_INPUT")
  })

  it("handles huge bigint values safely beyond Number.MAX_SAFE_INTEGER and enforces M1 bounds", () => {
    // 5% of 90_000_000_000_000n = 4_500_000_000_000n
    const listedPrice = 90_000_000_000_000n
    expect(
      calculateAdvanceValidity({
        advanceAmount: 4_500_000_000_000n,
        listedPrice,
        placedDate: "2026-05-01",
      }).days
    ).toBe(7)
    expect(
      calculateAdvanceValidity({
        advanceAmount: 4_500_000_000_001n,
        listedPrice,
        placedDate: "2026-05-01",
      }).days
    ).toBe(14)

    expect(() =>
      calculateAdvanceValidity({
        advanceAmount: A + 1n,
        listedPrice: A,
        placedDate: "2026-05-01",
      })
    ).toThrow("MONEY_OVERFLOW")
  })

  it("rejects zero/negative denominators and invalid inputs", () => {
    for (const [advanceAmount, listedPrice] of [
      [0n, 10000n],
      [-1n, 10000n],
      [100n, 0n],
      [100n, -100n],
    ] as const) {
      expect(() =>
        calculateAdvanceValidity({
          advanceAmount,
          listedPrice,
          placedDate: "2026-10-01",
        })
      ).toThrow("INVALID_INPUT")
    }
  })

  it("supports configurable Settings tiers and rejects invalid tier configs", () => {
    const customTiers = [
      { upperBps: 1000, days: 10 },
      { upperBps: null, days: 25 },
    ] as const
    expect(
      calculateAdvanceValidity({
        advanceAmount: 1000n,
        listedPrice: 10000n,
        placedDate: "2026-10-01",
        tiers: customTiers,
      }).days
    ).toBe(10)
    expect(
      calculateAdvanceValidity({
        advanceAmount: 1001n,
        listedPrice: 10000n,
        placedDate: "2026-10-01",
        tiers: customTiers,
      }).days
    ).toBe(25)

    // Non-increasing or missing null final tier rejected
    expect(() =>
      calculateAdvanceValidity({
        advanceAmount: 100n,
        listedPrice: 10000n,
        placedDate: "2026-10-01",
        tiers: [
          { upperBps: 1000, days: 10 },
          { upperBps: 500, days: 20 },
          { upperBps: null, days: 30 },
        ],
      })
    ).toThrow("INVALID_INPUT")
    expect(() =>
      calculateAdvanceValidity({
        advanceAmount: 100n,
        listedPrice: 10000n,
        placedDate: "2026-10-01",
        tiers: [{ upperBps: 1000, days: 10 }],
      })
    ).toThrow("INVALID_INPUT")
    expect(DEFAULT_ADVANCE_TIERS).toHaveLength(4)
  })

  it("computes exact Gregorian dates across leap years, non-leap centuries, and year-end Colombo expiry", () => {
    // M3 canonical example: placed 2026-12-25, 7 days -> validThrough 2027-01-01, expiresAt 2027-01-01T18:30:00.000Z
    const yearEnd = calculateAdvanceValidity({
      advanceAmount: 500n,
      listedPrice: 10000n,
      placedDate: "2026-12-25",
    })
    expect(yearEnd.timezone).toBe(COLOMBO_TIMEZONE)
    expect(yearEnd.validThrough).toBe("2027-01-01")
    expect(yearEnd.expiresAt.toISOString()).toBe("2027-01-01T18:30:00.000Z")
    expect(yearEnd.warningDate).toBe("2026-12-29")
    expect(yearEnd.warningAt.toISOString()).toBe("2026-12-28T18:30:00.000Z")

    // Exact due boundary: 1ms before expiry is NOT expired; at expiry IS expired
    expect(
      isAdvanceExpired(yearEnd.expiresAt, new Date("2027-01-01T18:29:59.999Z"))
    ).toBe(false)
    expect(
      isAdvanceExpired(yearEnd.expiresAt, new Date("2027-01-01T18:30:00.000Z"))
    ).toBe(true)

    // Leap year 2024: Feb 24 + 7 -> Mar 2; Feb 29 valid
    expect(addCalendarDays("2024-02-24", 7)).toBe("2024-03-02")
    expect(addCalendarDays("2024-02-28", 1)).toBe("2024-02-29")
    expect(
      calculateAdvanceValidity({
        advanceAmount: 500n,
        listedPrice: 10000n,
        placedDate: "2024-02-29",
      }).validThrough
    ).toBe("2024-03-07")

    // Non-leap 2025 and century non-leap 2100: Feb 28 + 1 -> Mar 1
    expect(addCalendarDays("2025-02-28", 1)).toBe("2025-03-01")
    expect(addCalendarDays("2100-02-28", 1)).toBe("2100-03-01")
    expect(diffCalendarDays("2100-03-01", "2100-02-28")).toBe(1)
    expect(() => addCalendarDays("2025-02-29", 1)).toThrow("INVALID_INPUT")
    expect(() => addCalendarDays("2100-02-29", 1)).toThrow("INVALID_INPUT")
    expect(() => addCalendarDays("0000-01-01", 1)).toThrow("INVALID_INPUT")

    // Colombo midnight conversion
    expect(localMidnightToUtc("2027-01-02", "Asia/Colombo").toISOString()).toBe(
      "2027-01-01T18:30:00.000Z"
    )
  })

  it("evaluates approaching-expiry warning window and suppresses obsolete warning once expired", () => {
    const validThrough = "2027-01-01"
    const expiresAt = new Date("2027-01-01T18:30:00.000Z")

    // Default leadDays=3 -> warning starts 2026-12-29 00:00+05:30 = 2026-12-28T18:30:00.000Z
    expect(
      isWarningDue({
        validThrough,
        expiresAt,
        now: new Date("2026-12-28T18:29:59.999Z"),
      })
    ).toBe(false)
    expect(
      isWarningDue({
        validThrough,
        expiresAt,
        now: new Date("2026-12-28T18:30:00.000Z"),
      })
    ).toBe(true)
    expect(
      isWarningDue({
        validThrough,
        expiresAt,
        now: new Date("2027-01-01T18:29:59.999Z"),
      })
    ).toBe(true)
    // At expiry instant, warning is suppressed (late job emits expiry only)
    expect(
      isWarningDue({
        validThrough,
        expiresAt,
        now: new Date("2027-01-01T18:30:00.000Z"),
      })
    ).toBe(false)

    // Configurable leadDays = 0 -> warning on validThrough day only
    expect(
      isWarningDue({
        validThrough,
        leadDays: 0,
        now: new Date("2026-12-31T18:29:59.999Z"),
      })
    ).toBe(false)
    expect(
      isWarningDue({
        validThrough,
        leadDays: 0,
        now: new Date("2026-12-31T18:30:00.000Z"),
      })
    ).toBe(true)
  })
})

describe("cash facility disbursement & recovery math (W12F)", () => {
  it("matches W12F canonical WITHHELD and SEPARATE fee examples", () => {
    // W12F example 1: gross 1000, withheld deduction 100, withheld fee 20 -> net 880, totalRecoverable 880
    const withheld = calculateFacilityDisbursement({
      gross: 100000n,
      deductions: [{ amount: 10000n, handling: "WITHHELD" }],
      fee: 2000n,
      feeMode: "WITHHELD",
      separatelyRecoverableCharges: 0n,
    })
    expect(withheld).toEqual({
      gross: 100000n,
      withheldDeductions: 10000n,
      paidByDealershipTotal: 0n,
      withheldFee: 2000n,
      netDisbursed: 88000n,
      separatelyRecoverableCharges: 0n,
      recoverablePrincipal: 88000n,
      recoverableCharges: 0n,
      recoverableFee: 0n,
      totalRecoverable: 88000n,
      totalCashOut: 88000n,
      feeMode: "WITHHELD",
    })

    // W12F example 2: gross 1000, withheld deduction 100, separate fee 20 -> net 900, fee owed 20, totalRecoverable 920
    const separate = calculateFacilityDisbursement({
      gross: 100000n,
      deductions: [{ amount: 10000n, handling: "WITHHELD" }],
      fee: 2000n,
      feeMode: "SEPARATE",
      separatelyRecoverableCharges: 0n,
    })
    expect(separate).toEqual({
      gross: 100000n,
      withheldDeductions: 10000n,
      paidByDealershipTotal: 0n,
      withheldFee: 0n,
      netDisbursed: 90000n,
      separatelyRecoverableCharges: 0n,
      recoverablePrincipal: 90000n,
      recoverableCharges: 0n,
      recoverableFee: 2000n,
      totalRecoverable: 92000n,
      totalCashOut: 90000n,
      feeMode: "SEPARATE",
    })
  })

  it("handles PAID_BY_DEALERSHIP deductions without subtracting them from netDisbursed", () => {
    const res = calculateFacilityDisbursement({
      gross: 100000n,
      deductions: [
        { amount: 10000n, handling: "WITHHELD" },
        { amount: 5000n, handling: "PAID_BY_DEALERSHIP" },
        { amount: 3000n, handling: "PAID_BY_DEALERSHIP" },
      ],
      fee: 2000n,
      feeMode: "WITHHELD",
      separatelyRecoverableCharges: 5000n,
    })
    expect(res.withheldDeductions).toBe(10000n)
    expect(res.paidByDealershipTotal).toBe(8000n)
    expect(res.netDisbursed).toBe(88000n)
    expect(res.totalCashOut).toBe(96000n)
    expect(res.recoverablePrincipal).toBe(88000n)
    expect(res.recoverableCharges).toBe(5000n)
    expect(res.recoverableFee).toBe(0n)
    expect(res.totalRecoverable).toBe(93000n)
  })

  it("allows zero netDisbursed and rejects negative netDisbursed and out-of-bounds recoverables", () => {
    const zeroNet = calculateFacilityDisbursement({
      gross: 10000n,
      deductions: [{ amount: 8000n, handling: "WITHHELD" }],
      fee: 2000n,
      feeMode: "WITHHELD",
    })
    expect(zeroNet.netDisbursed).toBe(0n)
    expect(zeroNet.totalRecoverable).toBe(0n)

    // Negative net rejected
    expect(() =>
      calculateFacilityDisbursement({
        gross: 10000n,
        deductions: [{ amount: 9000n, handling: "WITHHELD" }],
        fee: 2000n,
        feeMode: "WITHHELD",
      })
    ).toThrow("BALANCE_MISMATCH")

    // separatelyRecoverableCharges > paidByDealershipTotal rejected
    expect(() =>
      calculateFacilityDisbursement({
        gross: 10000n,
        deductions: [{ amount: 1000n, handling: "PAID_BY_DEALERSHIP" }],
        fee: 0n,
        separatelyRecoverableCharges: 1001n,
      })
    ).toThrow("BALANCE_MISMATCH")

    // Negative separatelyRecoverableCharges rejected
    expect(() =>
      calculateFacilityDisbursement({
        gross: 10000n,
        deductions: [],
        fee: 0n,
        separatelyRecoverableCharges: -1n,
      })
    ).toThrow("INVALID_INPUT")

    // M1 A/C bounds enforced
    expect(() =>
      calculateFacilityDisbursement({
        gross: A + 1n,
        deductions: [],
        fee: 0n,
      })
    ).toThrow("MONEY_OVERFLOW")
    expect(() =>
      calculateFacilityDisbursement({
        gross: A,
        deductions: Array.from({ length: 101 }, () => ({
          amount: A,
          handling: "WITHHELD" as const,
        })),
        fee: 0n,
      })
    ).toThrow("MONEY_OVERFLOW")
  })

  it("computes remaining recovery per component and rejects over-recovery", () => {
    // Partial recovery 40000 on principal 90000 + fee 2000 leaves 50000 principal, 2000 fee
    const step1 = calculateFacilityRecovery({
      obligations: { principal: 90000n, charges: 5000n, fee: 2000n },
      payment: { principal: 40000n },
    })
    expect(step1.remainingBefore).toEqual({
      principal: 90000n,
      charges: 5000n,
      fee: 2000n,
      total: 97000n,
    })
    expect(step1.remainingAfter).toEqual({
      principal: 50000n,
      charges: 5000n,
      fee: 2000n,
      total: 57000n,
    })
    expect(step1.fullyRecovered).toBe(false)

    // Final exact recovery
    const step2 = calculateFacilityRecovery({
      obligations: { principal: 90000n, charges: 5000n, fee: 2000n },
      alreadyRecovered: { principal: 40000n },
      payment: { principal: 50000n, charges: 5000n, fee: 2000n },
    })
    expect(step2.remainingAfter.total).toBe(0n)
    expect(step2.fullyRecovered).toBe(true)

    // Over-recovery in any bucket rejected with BALANCE_MISMATCH (no borrowing from other buckets)
    expect(() =>
      calculateFacilityRecovery({
        obligations: { principal: 90000n, charges: 5000n, fee: 0n },
        payment: { fee: 1n },
      })
    ).toThrow("BALANCE_MISMATCH")
    expect(() =>
      calculateFacilityRecovery({
        obligations: { principal: 90000n, charges: 0n, fee: 0n },
        alreadyRecovered: { principal: 40000n },
        payment: { principal: 50001n },
      })
    ).toThrow("BALANCE_MISMATCH")

    expect(C > A).toBe(true)
  })
})

describe("reconciliation overdue 2-day cutoff & watermark math (W13)", () => {
  it("enforces exact W13 2-day overdue cutoff and strict watermark comparison", () => {
    const asOfDate = "2026-10-25"

    // Without watermark: sent 23 is overdue (day 2), 24 is not (day 1), 25 is not (day 0), 26 future is not
    expect(
      isEntitlementOverdue({ sentOrEligibleDate: "2026-10-23", asOfDate })
    ).toBe(true)
    expect(
      isEntitlementOverdue({ sentOrEligibleDate: "2026-10-24", asOfDate })
    ).toBe(false)
    expect(
      isEntitlementOverdue({ sentOrEligibleDate: "2026-10-25", asOfDate })
    ).toBe(false)
    expect(
      isEntitlementOverdue({ sentOrEligibleDate: "2026-10-26", asOfDate })
    ).toBe(false)

    // With watermark 2026-10-25: sent 24 < 25 IS overdue; sent 25 === 25 is NOT overdue; future 26 is NOT overdue
    expect(
      isEntitlementOverdue({
        sentOrEligibleDate: "2026-10-24",
        asOfDate,
        lastReconciledSentDate: "2026-10-25",
      })
    ).toBe(true)
    expect(
      isEntitlementOverdue({
        sentOrEligibleDate: "2026-10-25",
        asOfDate,
        lastReconciledSentDate: "2026-10-25",
      })
    ).toBe(false)
    expect(
      isEntitlementOverdue({
        sentOrEligibleDate: "2026-10-26",
        asOfDate,
        lastReconciledSentDate: "2026-10-25",
      })
    ).toBe(false)

    // Non-pending states or zero outstanding are never overdue
    expect(
      isEntitlementOverdue({
        sentOrEligibleDate: "2026-10-20",
        asOfDate,
        state: "SETTLED",
      })
    ).toBe(false)
    expect(
      isEntitlementOverdue({
        sentOrEligibleDate: "2026-10-20",
        asOfDate,
        state: "RESOLVED",
      })
    ).toBe(false)
    expect(
      isEntitlementOverdue({
        sentOrEligibleDate: "2026-10-20",
        asOfDate,
        state: "PARTIAL",
        outstanding: 0n,
      })
    ).toBe(false)
    expect(
      isEntitlementOverdue({
        sentOrEligibleDate: "2026-10-23",
        asOfDate,
        state: "PARTIAL",
        outstanding: 4000n,
      })
    ).toBe(true)
  })

  it("advances watermark monotonically ONLY on SETTLED and RESOLVED closing items, never PARTIAL or KEEP_OPEN", () => {
    // PARTIAL and KEEP_OPEN alone never advance null or existing watermark
    expect(
      computeNextWatermark(null, [
        { sentDate: "2026-10-25", state: "OPEN" },
        { sentDate: "2026-10-26", state: "PARTIAL", resolution: "KEEP_OPEN" },
      ])
    ).toBeNull()

    expect(
      computeNextWatermark("2026-10-20", [
        { sentDate: "2026-10-25", state: "PARTIAL", resolution: "KEEP_OPEN" },
        { sentDate: "2026-10-27", state: "OPEN", resolution: "KEEP_OPEN" },
      ])
    ).toBe("2026-10-20")

    // Advances monotonically (GREATEST, not last iterated item) across SETTLED & RESOLVED
    expect(
      computeNextWatermark("2026-10-15", [
        { sentDate: "2026-10-25", state: "SETTLED" },
        {
          sentDate: "2026-10-26",
          state: "RESOLVED",
          resolution: "ACCEPT_SHORTFALL",
        },
        {
          sentDate: "2026-10-28",
          state: "PARTIAL",
          resolution: "KEEP_OPEN",
        },
        {
          sentDate: "2026-10-21",
          state: "RESOLVED",
          resolution: "CARRY_CREDIT",
        },
        {
          sentDate: "2026-10-24",
          state: "RESOLVED",
          resolution: "RETURN_OVERPAYMENT",
        },
      ])
    ).toBe("2026-10-26")

    // Never moves backward if currentWatermark is already newer
    expect(
      computeNextWatermark("2026-10-30", [
        { sentDate: "2026-10-25", state: "SETTLED" },
      ])
    ).toBe("2026-10-30")
  })
})
