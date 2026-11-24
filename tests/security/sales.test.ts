import { describe, expect, it, vi } from "vitest"
import { subject } from "@casl/ability"
import { saleEnvelope, approvalEnvelope } from "@/lib/server/validators"
import {
  abilityFor,
  attenuation,
  grantSchema,
  registry,
  registryVersion,
} from "@/lib/server/permissions"
import { A, C, minor, sum, tradeInResidual } from "@/lib/money"

vi.mock("server-only", () => ({}))

const uuid1 = "00000000-0000-4000-8000-000000000001"
const uuid2 = "00000000-0000-4000-8000-000000000002"
const uuid3 = "00000000-0000-4000-8000-000000000003"

describe("T09 immediate sales, trade-in, discount/sale-edit permissions & validators", () => {
  it("registers v15 permissions with SaleCase and keeps strict subject/condition boundaries", () => {
    expect(registryVersion).toBe(20)
    expect(registry.SaleCase.read).toContain("price")
    expect(registry.SaleCase.read).toContain("tradeIn.acquiredCycleId")
    expect(registry.PurchaseRecord.read).toContain("tradeInSourceSaleId")
    expect(registry.PurchaseRecord.read).toContain("financial.originalBasis")
    expect(registry.PurchaseRecord.read).toContain("financial.restatedProfit")

    expect(
      grantSchema.safeParse({
        subject: "SaleCase",
        action: "read",
        fields: ["*"],
        conditions: { createdBy: "$actor.id", customerId: uuid2 },
      }).success
    ).toBe(true)

    expect(
      grantSchema.safeParse({
        subject: "SaleCase",
        action: "approve",
        fields: ["*"],
      }).success
    ).toBe(false)

    // Compound PurchaseRecord.sales cannot authorize SaleCase.read or SaleCase.create
    const cycleOnly = abilityFor(
      [{ subject: "PurchaseRecord", action: "read", fields: ["sales"] }],
      uuid1
    )
    expect(cycleOnly.can("read", "SaleCase", "price")).toBe(false)
    expect(
      attenuation(
        [{ subject: "PurchaseRecord", action: "read", fields: ["*"] }],
        [],
        [{ subject: "SaleCase", action: "read", fields: ["price"] }],
        uuid1
      ).covered
    ).toBe(false)

    // CustomerId condition enforcement
    const scoped = abilityFor(
      [
        {
          subject: "SaleCase",
          action: "read",
          fields: ["id", "price"],
          conditions: { customerId: uuid2 },
        },
      ],
      uuid1
    )
    expect(
      scoped.can("read", subject("SaleCase", { customerId: uuid2 }), "price")
    ).toBe(true)
    expect(
      scoped.can("read", subject("SaleCase", { customerId: uuid3 }), "price")
    ).toBe(false)
  })

  it("validates completeImmediate CASH and TRADE_IN envelopes strictly", () => {
    const cashEnv = {
      schemaVersion: 1,
      idempotencyKey: uuid1,
      expected: [
        { type: "PurchaseRecord", id: uuid2, revision: 1 },
        { type: "Customer", id: uuid3, revision: 1 },
      ],
      input: {
        cycleId: uuid2,
        customerId: uuid3,
        kind: "CASH",
        price: "500000",
        date: "2026-10-01",
        mileage: 12000,
        method: "BANK_TRANSFER",
        reference: "REF-101",
      },
    }
    expect(saleEnvelope("completeImmediate").safeParse(cashEnv).success).toBe(
      true
    )

    // Zero price or unknown keys rejected
    expect(
      saleEnvelope("completeImmediate").safeParse({
        ...cashEnv,
        input: { ...cashEnv.input, price: "0" },
      }).success
    ).toBe(false)
    expect(
      saleEnvelope("completeImmediate").safeParse({
        ...cashEnv,
        input: { ...cashEnv.input, extra: true },
      }).success
    ).toBe(false)

    // TRADE_IN with inline intake
    const tradeEnv = {
      ...cashEnv,
      input: {
        ...cashEnv.input,
        kind: "TRADE_IN",
        tradeIn: {
          description: "2019 Honda Vezel",
          value: "300000",
          intake: {
            vehicle: {
              engineNumber: "ENG-99",
              chassisNumber: "CHS-99",
              make: "Honda",
              model: "Vezel",
              year: 2019,
              colour: "Pearl White",
              fuelType: "HYBRID",
              transmission: "AUTOMATIC",
            },
            mileage: { reading: 45000, date: "2026-10-01" },
            listedPrice: "350000",
          },
        },
      },
    }
    expect(saleEnvelope("completeImmediate").safeParse(tradeEnv).success).toBe(
      true
    )
  })

  it("validates DISCOUNT and SALE_EDIT approval envelopes strictly", () => {
    const discountReq = {
      schemaVersion: 1,
      idempotencyKey: uuid1,
      expected: [
        { type: "PurchaseRecord", id: uuid2, revision: 2 },
        { type: "Customer", id: uuid3, revision: 1 },
      ],
      input: {
        proposal: {
          kind: "DISCOUNT",
          command: {
            name: "completeImmediate",
            input: {
              cycleId: uuid2,
              customerId: uuid3,
              kind: "CASH",
              price: "400000",
              date: "2026-10-02",
              mileage: 15000,
              method: "CASH",
            },
          },
        },
        reason: "Fleet buyer negotiated discount",
      },
    }
    expect(
      approvalEnvelope("requestApproval").safeParse(discountReq).success
    ).toBe(true)

    const editReq = {
      schemaVersion: 1,
      idempotencyKey: uuid1,
      expected: [
        { type: "SaleCase", id: uuid2, revision: 1 },
        { type: "PurchaseRecord", id: uuid3, revision: 3 },
      ],
      input: {
        proposal: {
          kind: "SALE_EDIT",
          operation: "EDIT_COMPLETION",
          input: {
            saleId: uuid2,
            reason: "Correct buyer reference and cash receipt",
            patch: { reference: "INV-2026-88", price: "450000" },
            cashCorrections: [
              {
                paymentId: uuid1,
                reason: "Wrong amount entered",
                replacement: {
                  amount: "450000",
                  date: "2026-10-02",
                  method: "BANK_TRANSFER",
                },
              },
            ],
          },
        },
        reason: "Manager review required",
      },
    }
    expect(approvalEnvelope("requestApproval").safeParse(editReq).success).toBe(
      true
    )

    // Empty SALE_EDIT patch & empty cashCorrections rejected
    expect(
      approvalEnvelope("requestApproval").safeParse({
        ...editReq,
        input: {
          ...editReq.input,
          proposal: {
            kind: "SALE_EDIT",
            operation: "EDIT_COMPLETION",
            input: {
              saleId: uuid2,
              reason: "Nothing changed",
              patch: {},
              cashCorrections: [],
            },
          },
        },
      }).success
    ).toBe(false)

    // T09 excludes lease finance edits from EDIT_COMPLETION.
    expect(
      approvalEnvelope("requestApproval").safeParse({
        ...editReq,
        input: {
          ...editReq.input,
          proposal: {
            kind: "SALE_EDIT",
            operation: "EDIT_COMPLETION",
            input: {
              ...editReq.input.proposal.input,
              patch: { finance: { companyId: uuid3 } },
            },
          },
        },
      }).success
    ).toBe(false)
  })

  it("keeps trade-in residual arithmetic and M1 money bounds exact", () => {
    expect(tradeInResidual(1500n, 500n)).toBe(1000n)
    expect(tradeInResidual(1500n, 1500n)).toBe(0n)
    expect(() => tradeInResidual(1500n, 1600n)).toThrow("OVERALLOWANCE")
    expect(minor("99999999999999")).toBe(A)
    expect(() => minor("100000000000000")).toThrow("MONEY_OVERFLOW")
    expect(() => sum([C, 1n], C)).toThrow("MONEY_OVERFLOW")
    expect(sum([A, 1n], C)).toBe(A + 1n)
  })
})
