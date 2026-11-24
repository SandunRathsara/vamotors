type FixtureIds = {
  prefix: string
  supplierId: string
  customerId: string
  companyId: string
}

function receipt(
  category: string,
  amount: string,
  date: string,
  reference?: string
) {
  return {
    sourceKey: category.toLowerCase(),
    category,
    amount,
    date,
    method: reference ? "BANK_TRANSFER" : "CASH",
    reference,
    direction: category === "REFUND" ? "OUT" : "IN",
  }
}

export function historicalCommitmentRows(ids: FixtureIds) {
  const { prefix, supplierId, customerId, companyId } = ids
  const states = ["CONVERTED", "REFUNDED", "CANCELLED", "EXPIRED"]
  return {
    VEHICLES: states.map((state, i) => ({
      sourceKey: `vehicle-${i}`,
      cycleSourceKey: `cycle-${i}`,
      engineNumber: `${prefix}-engine-${i}`,
      chassisNumber: `${prefix}-chassis-${i}`,
      supplierSourceKey: "",
      supplierExistingId: supplierId,
      status: ["DELIVERED", "IN_STOCK", "IN_STOCK", "ADVANCE_EXPIRED"][i],
      available: String(i === 1 || i === 2),
      ...(i === 0 ? { listedPrice: "5600000.00" } : {}),
      closedAt: state === "CONVERTED" ? "2026-01-20T00:00:00.000Z" : "",
      additionalCosts: "[]",
    })),
    ADVANCES: states.map((state, i) => ({
      sourceKey: `deposit-${i}`,
      cycleSourceKey: `cycle-${i}`,
      customerSourceKey: "",
      customerExistingId: customerId,
      saleCaseSourceKey: `case-${i}`,
      state,
      ...(i === 0
        ? {
            listedBasis: "5600000.00",
            legacyApproverName: "Historical Sales Manager",
            legacyApprovalReference: "DISCOUNT-42",
          }
        : {}),
      ...(["REFUNDED", "CANCELLED"].includes(state)
        ? {
            retainedAmount: state === "REFUNDED" ? "100000.00" : "500000.00",
            resolutionDate: "2026-01-25",
            resolutionReason: "Historical cancellation",
            dispositionKind: "RELEASE",
          }
        : {}),
      ...(state === "CONVERTED"
        ? {
            completedSaleSourceKey: "lease-001",
            resolutionDate: "2026-01-20",
          }
        : {}),
      payments: JSON.stringify([
        receipt("ADVANCE", "500000.00", "2026-01-12"),
        ...(state === "REFUNDED"
          ? [receipt("REFUND", "400000.00", "2026-01-25")]
          : []),
      ]),
    })),
    SALES: [
      {
        sourceKey: "lease-001",
        kind: "LEASE",
        cycleSourceKey: "cycle-0",
        customerSourceKey: "",
        customerExistingId: customerId,
        reservationSourceKey: "deposit-0",
        saleCaseSourceKey: "case-0",
        financeCompanyExistingId: companyId,
        reference: `${prefix}-lease`,
        price: "5500000.00",
        downPayment: "500000.00",
        financeAmount: "4500000.00",
        termMonths: "36",
        doIssueDate: "2026-01-19",
        completionBasisCosts: "[]",
        payments: JSON.stringify([
          receipt("DOWN_PAYMENT", "500000.00", "2026-01-18"),
          receipt("LENDER", "1000000.00", "2026-01-22", `${prefix}-direct`),
        ]),
      },
    ],
    REMITTANCES: [
      {
        companySourceKey: "",
        companyExistingId: companyId,
        reference: `${prefix}-allocated`,
        amount: "500000.00",
        allocations:
          '[{"type":"SALES","sourceKey":"lease-001","amount":"500000.00"}]',
      },
    ],
  }
}
