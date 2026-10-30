import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { canonical } from "../../lib/server/idempotency"
import { describe, expect, it } from "vitest"
import {
  cycleMoneyInputs,
  purchaseInput,
  settlementInput,
} from "../../lib/server/validators"
import {
  abilityFor,
  attenuation,
  expanded,
  registry,
  permissionRegistryDTO,
} from "../../lib/server/permissions"
import { A, C, sum } from "../../lib/money"

const id = "03000000-0000-4000-8000-000000000011"
const common = {
  vehicle: {
    engineNumber: "E",
    chassisNumber: "C",
    make: "Synthetic",
    model: "Settlement",
    year: 2026,
    colour: "Blue",
    fuelType: "PETROL",
    transmission: "AUTOMATIC",
  },
  supplierId: id,
  purchaseDate: "2026-10-01",
  mileage: { reading: 0, date: "2026-10-01" },
  paymentMethod: "BANK_TRANSFER",
}
const terms = {
  reference: "SYNTHETIC-SETTLEMENT",
  amount: "6000",
  cashToSeller: "4000",
}
const bank = {
  ...terms,
  institutionType: "BANK",
  institutionName: "Synthetic bank",
}
describe("T05c.2 exact settlement contract", () => {
  it("accepts the three strict institution variants and no extra purchase price/payment", () => {
    for (const settlement of [
      bank,
      { ...bank, institutionType: "PRIVATE_PARTY" },
      { ...terms, institutionType: "FINANCE_COMPANY", companyId: id },
    ]) {
      const input = { ...common, purchaseType: "LEASE_SETTLEMENT", settlement }
      expect(purchaseInput.parse(input)).toEqual(input)
      for (const extra of [
        { purchasePrice: "10000" },
        { payment: { amount: "10000" } },
        { notes: "Not a creation field" },
        { institutionNameSnapshot: "Client snapshot" },
      ])
        expect(purchaseInput.safeParse({ ...input, ...extra }).success).toBe(
          false
        )
    }
    for (const settlement of [
      { ...bank, companyId: id },
      {
        ...terms,
        institutionType: "FINANCE_COMPANY",
        institutionName: "Not a directory FK",
      },
      { ...terms, institutionType: "BANK" },
      { ...bank, institutionName: " " },
      { ...bank, reference: " " },
      { ...bank, institutionNameSnapshot: "Forged" },
    ])
      expect(settlementInput.safeParse(settlement).success).toBe(false)
  })
  it("allows either zero component, rejects both zero, keeps A components and derived A+A within C", () => {
    for (const [amount, cashToSeller] of [
      ["0", "1"],
      ["1", "0"],
      [A.toString(), A.toString()],
    ])
      expect(
        settlementInput.safeParse({ ...bank, amount, cashToSeller }).success
      ).toBe(true)
    expect(
      settlementInput.safeParse({ ...bank, amount: "0", cashToSeller: "0" })
        .success
    ).toBe(false)
    expect(sum([A, A], C)).toBe(199999999999998n)
    expect(() => sum([C, 1n], C)).toThrow("MONEY_OVERFLOW")
    for (const amount of [
      "-1",
      "01",
      "1.00",
      "1e2",
      "100000000000000",
      C.toString(),
      1,
    ])
      expect(settlementInput.safeParse({ ...bank, amount }).success).toBe(false)
    for (const purchaseDate of ["2026-02-30", "0000-01-01", "2026-1-01"])
      expect(
        purchaseInput.safeParse({
          ...common,
          purchaseType: "LEASE_SETTLEMENT",
          settlement: bank,
          purchaseDate,
        }).success
      ).toBe(false)
  })
  it("extends the existing correction envelopes without inventing recipient/source wire fields", () => {
    for (const patch of [
      { seller: { type: "SUPPLIER", id } },
      { purchaseType: "LEASE_SETTLEMENT", settlement: bank },
      { purchaseType: "CASH", settlement: null, purchasePrice: "10000" },
    ])
      expect(
        cycleMoneyInputs.editPurchase.safeParse({
          cycleId: id,
          reason: "Actual correction",
          patch,
          cashCorrections: [],
        }).success
      ).toBe(true)
    const payment = { amount: "1", date: "2026-10-02", method: "CASH" }
    for (const recipient of ["SELLER", "SETTLEMENT"])
      expect(
        cycleMoneyInputs.payPurchase.safeParse({
          cycleId: id,
          recipient,
          payment,
        }).success
      ).toBe(true)
    const reverse = {
      sourceType: "PURCHASE",
      sourceId: id,
      paymentId: id,
      reason: "Wrong entry",
      replacement: payment,
    }
    expect(cycleMoneyInputs.reversePayment.parse(reverse)).toEqual(reverse)
    expect(
      cycleMoneyInputs.reversePayment.safeParse({
        ...reverse,
        replacement: { ...payment, recipient: "SETTLEMENT" },
      }).success
    ).toBe(false)
  })
  it("freezes the actual accepted 16-subject/51-action v11 universe without dropping compound gates", () => {
    const sql = readFileSync(
      "prisma/migrations/202610300006_settlement_purchases/migration.sql",
      "utf8"
    )
    const frozen = JSON.parse(
      sql.match(/universe jsonb :=\s*\n'(.+)'::jsonb;/)![1]
    ) as Record<string, Record<string, string[]>>
    for (const match of sql.matchAll(
      /universe:=jsonb_set\(universe,'\{(\w+),(\w+)\}',(universe#>'\{\w+,\w+\}'\|\|)?'([^']+)'::jsonb\);/g
    )) {
      const [, subject, action, append, json] = match
      frozen[subject][action] = [
        ...(append ? frozen[subject][action] : []),
        ...JSON.parse(json),
      ]
    }
    expect(sql).toContain("DROP CONSTRAINT initial_cycle_capability")
    expect(sql).toContain("x.id=(initial #>> '{mileage,0,id}')::uuid")
    expect(sql).toContain(
      "x.reading=(initial #>> '{mileage,0,reading}')::integer"
    )
    expect(sql).toContain(
      "x.\"recordedDate\"=(initial #>> '{mileage,0,date}')::date"
    )
    expect(sql).not.toContain(
      'FROM vamotors."MileageReading" x WHERE x."cycleId"=cid)<>1'
    )
    expect(sql).toContain(
      "FUNCTION vamotors.check_acquisition_graph() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$"
    )
    expect(sql).toContain(
      `CHECK(status IN ('PURCHASED','IN_STOCK') AND "closedAt" IS NULL AND "purchaseType" IN ('CASH','BRAND_NEW','LEASE_SETTLEMENT') AND "acquisitionKind"='SUPPLIER')`
    )
    expect(Object.keys(frozen)).toHaveLength(16)
    expect(Object.values(frozen).flatMap(Object.keys)).toHaveLength(51)
    const sortedFields = Object.fromEntries(
      Object.entries(frozen).map(([subject, actions]) => [
        subject,
        Object.fromEntries(
          Object.entries(actions).map(([action, fields]) => [
            action,
            [...fields].sort(),
          ])
        ),
      ])
    )
    // Independently derived from exact accepted 555's registry v11, not v12.
    expect(
      createHash("sha256").update(canonical(sortedFields)).digest("hex")
    ).toBe("3cfdc4a900c02ce50fde95b5aa0179202e805b199621a75212b813aa31859b9a")
    expect(frozen.Vehicle.update).toContain("values.engineNumber")
    expect(frozen.PurchaseRecord.update).toContain("mileage.decreaseReason")
    expect(frozen.Vehicle.read).toContain("mileage.decreaseReason")
    expect(frozen.PurchaseRecord.read).toContain("mileage.id")
    for (const [subject, actions] of Object.entries(frozen))
      for (const [action, fields] of Object.entries(actions)) {
        expect(
          (registry as Record<string, Record<string, readonly string[]>>)[
            subject
          ][action]
        ).toEqual(expect.arrayContaining(fields))
        if (subject !== "PurchaseRecord")
          expect(
            [
              ...(
                registry as Record<string, Record<string, readonly string[]>>
              )[subject][action],
            ].sort()
          ).toEqual([...fields].sort())
      }
    expect(frozen.ImportBatch.update).toEqual(["uploads"])
    expect(frozen.Document.create).toContain("target")
    const old = {
      subject: "PurchaseRecord" as const,
      action: "create" as const,
      fields: frozen.PurchaseRecord.create,
    }
    expect(expanded(old)).not.toContain("settlement.amount")
    expect(
      attenuation([old], [], [{ ...old, fields: ["settlement.amount"] }], id)
        .covered
    ).toBe(false)
    const ability = abilityFor(
      [
        {
          subject: "ImportBatch",
          action: "update",
          fields: frozen.ImportBatch.update,
        },
      ],
      id
    )
    expect(ability.can("update", "ImportBatch", "uploads")).toBe(true)
    const dto = permissionRegistryDTO()
    expect(
      dto.subjects.some((s) => String(s.subject) === "LeasePurchaseDetail")
    ).toBe(false)
    for (const action of dto.subjects.find(
      (s) => s.subject === "PurchaseRecord"
    )!.actions)
      for (const field of action.fields.filter((f) =>
        /^(patch\.)?settlement\.(amount|cashToSeller)$/.test(f.path)
      ))
        expect(field.dataType).toBe("MONEY")
  })
})
