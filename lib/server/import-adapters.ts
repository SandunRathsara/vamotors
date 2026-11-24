import "server-only"
import { randomUUID } from "node:crypto"
import type { z } from "zod"
import type {
  Applied,
  Dependency,
  ImportType,
  LegacyPayment,
  ImportPayloads,
  LegacyRef,
} from "../../.planning/implementation/contracts/api"
import type { Identity } from "./actor"
import type { Tx } from "./db"
import { CommandError } from "./errors"
import { executeCustomer } from "./customers"
import { executeBrokerage } from "./brokerage"
import { currentSettings } from "./settings"
import { executeParty } from "./parties"
import {
  executeCycleEdit,
  executeCycleMoney,
  executeStock,
  recordPurchase,
} from "./purchases"
import { executeRepair } from "./repairs"
import { executeSale } from "./sales"
import { normalizeVehicleIdentity, type TypedImportRow } from "./import-parsers"
import { settlementInput } from "./validators"

export class ImportRowError extends CommandError {
  constructor(
    public field: string,
    message: string,
    code = "IMPORT_INVALID"
  ) {
    super(code, 422, false, undefined, message)
  }
}

export function need(
  condition: unknown,
  field: string,
  message: string
): asserts condition {
  if (!condition) throw new ImportRowError(field, message)
}

export type ImportContext = {
  tx: Tx
  identity: Identity
  resolve(ref: LegacyRef, field: string): Promise<string>
  key(type: ImportType, sourceKey: string): string
  costIds: Map<string, string>
  cycleCloseDates: Map<string, string>
  releaseAfterRepair: Set<string>
}

export type ImportAdapter<K extends ImportType> = {
  keys?: (row: TypedImportRow<K>) => string[]
  dependencies?: (row: TypedImportRow<K>) => (LegacyRef | undefined)[]
  work?: (row: TypedImportRow<K>) => number
  apply(ctx: ImportContext, row: TypedImportRow<K>): Promise<Applied>
}

const env = (input: unknown, expected: Dependency[] = []) => ({
  schemaVersion: 1,
  idempotencyKey: randomUUID(),
  input,
  expected,
})

const ref = <T extends Dependency["type"]>(
  type: T,
  row: { id: string; revision: number }
) => ({ type, id: row.id, revision: row.revision })

function payment(input: LegacyPayment) {
  return {
    amount: input.amount,
    date: input.date,
    method: input.method,
    reference: input.reference,
  }
}

function outflows(rows: LegacyPayment[], category: string, field = "payments") {
  need(
    rows.every(
      (p) =>
        p.direction === "OUT" &&
        p.category === category &&
        !p.reversalOfSourceKey
    ),
    field,
    `Expected unreversed ${category} outflows`
  )
  return rows
}

function directory<K extends "SUPPLIERS" | "REPAIR_VENDORS">(
  kind: "SUPPLIER" | "REPAIR_VENDOR"
): ImportAdapter<K> {
  const adapter = {
    work: ({ payload }: { payload: ImportPayloads["SUPPLIERS"] }) =>
      1 + payload.contacts.length,
    async apply(
      { tx, identity }: ImportContext,
      { payload }: { payload: ImportPayloads["SUPPLIERS"] }
    ) {
      const where = payload.nicOrRegNumber
        ? {
            nicOrRegNumber: {
              equals: payload.nicOrRegNumber,
              mode: "insensitive" as const,
            },
          }
        : {
            name: { equals: payload.name, mode: "insensitive" as const },
            category: payload.category,
          }
      const existing =
        kind === "SUPPLIER"
          ? await tx.supplier.findFirst({ where, select: { id: true } })
          : await tx.repairVendor.findFirst({ where, select: { id: true } })
      if (existing)
        throw new ImportRowError(
          "nicOrRegNumber",
          "A matching directory record already exists. Use its existing ID.",
          "IMPORT_DUPLICATE"
        )
      return executeParty(
        identity,
        "createDirectoryParty",
        env({ type: kind, values: payload }),
        tx
      )
    },
  }
  return adapter as ImportAdapter<K>
}

async function cycleRef(tx: Tx, id: string) {
  const row = await tx.purchaseRecord.findUnique({
    where: { id },
    select: { id: true, revision: true },
  })
  need(row, "cycle", "Purchase cycle could not be resolved")
  return ref("PurchaseRecord", row)
}

async function vehicleRef(
  tx: Tx,
  vehicle: TypedImportRow<"VEHICLES">["payload"]["vehicle"]
) {
  const existing = await tx.vehicle.findUnique({
    where: {
      normalizedEngine_normalizedChassis: {
        normalizedEngine: normalizeVehicleIdentity(vehicle.engineNumber),
        normalizedChassis: normalizeVehicleIdentity(vehicle.chassisNumber),
      },
    },
    select: { id: true, revision: true },
  })
  return existing ? [ref("Vehicle", existing)] : []
}

const vehicles: ImportAdapter<"VEHICLES"> = {
  keys: ({ payload }) => [payload.cycleSourceKey],
  dependencies: ({ payload }) => [
    payload.supplier,
    payload.sellerCustomer,
    payload.tradeInSale,
    payload.settlement?.institutionType === "FINANCE_COMPANY"
      ? payload.settlement.company
      : undefined,
  ],
  work: ({ payload: p }) =>
    4 +
    p.mileage.length +
    p.additionalCosts.reduce((n, c) => n + 1 + c.payments.length, 0),
  async apply(ctx, { payload: p }) {
    const { tx, identity } = ctx
    need(
      ["PURCHASED", "IN_STOCK", "IN_REPAIR", "SOLD"].includes(p.status),
      "status",
      "This historical cycle state is unavailable in this import"
    )
    need(
      p.mileage.length,
      "mileage",
      "At least one dated mileage reading is required"
    )
    const [mileage, ...history] = [...p.mileage].sort((a, b) =>
      a.date.localeCompare(b.date)
    )
    const common = { vehicle: p.vehicle, mileage, listedPrice: p.listedPrice }
    const expected: Dependency[] = await vehicleRef(tx, p.vehicle)
    let result: Applied
    let acquiredId: string | null = null
    if (p.tradeInSale) {
      const saleId = await ctx.resolve(p.tradeInSale, "tradeInSale")
      const sale = await tx.saleCase.findUnique({
        where: { id: saleId },
        include: { purchaseRecord: true, completion: true, tradeIn: true },
      })
      need(
        sale?.completion && sale.tradeIn,
        "tradeInSale",
        "Expected a completed trade-in sale"
      )
      need(
        p.sellerCustomer &&
          (await ctx.resolve(p.sellerCustomer, "sellerCustomer")) ===
            sale.customerId,
        "sellerCustomer",
        "Trade-in seller must be the sale customer"
      )
      need(
        p.purchaseType === "CASH" &&
          p.purchasePrice === sale.tradeIn.value.toString() &&
          p.purchaseDate ===
            sale.completion.saleDate.toISOString().slice(0, 10),
        "purchasePrice",
        "The trade-in acquisition date and value must match the trade-in sale"
      )
      result = await executeSale(
        identity,
        "intakeTradeIn",
        env({ saleId, ...common }, [
          ...expected,
          ref("SaleCase", sale),
          ref("PurchaseRecord", sale.purchaseRecord),
        ]),
        tx
      )
      const intake = await tx.tradeInConsideration.findUniqueOrThrow({
        where: { saleCaseId: sale.id },
        select: { acquiredPurchaseId: true },
      })
      acquiredId = intake.acquiredPurchaseId
      need(acquiredId, "tradeInSale", "Trade-in did not produce an acquisition")
    } else {
      need(p.supplier, "supplier", "A supplier is required")
      const supplierId = await ctx.resolve(p.supplier, "supplier")
      const supplier = await tx.supplier.findUnique({
        where: { id: supplierId },
        select: { id: true, revision: true },
      })
      need(supplier, "supplier", "Supplier could not be resolved")
      expected.push(ref("Supplier", supplier))
      let settlement: z.input<typeof settlementInput> | undefined
      if (p.settlement?.institutionType === "FINANCE_COMPANY") {
        const { company, ...terms } = p.settlement
        const companyId = await ctx.resolve(company, "settlementCompany")
        const finance = await tx.financeCompany.findUnique({
          where: { id: companyId },
          select: { id: true, revision: true },
        })
        need(
          finance,
          "settlementCompany",
          "Finance company could not be resolved"
        )
        expected.push(ref("FinanceCompany", finance))
        settlement = { ...terms, companyId }
      } else if (p.settlement) settlement = p.settlement
      const paymentParts = [
        ["SELLER", p.settlement?.cashToSeller ?? p.purchasePrice],
        ["SETTLEMENT", p.settlement?.amount ?? "0"],
      ].filter(([, amount]) => amount !== "0")
      need(
        p.payments.length === paymentParts.length &&
          paymentParts.every(([category, amount]) =>
            p.payments.some(
              (entry) =>
                entry.category === category &&
                entry.amount === amount &&
                entry.date === p.purchaseDate &&
                entry.direction === "OUT" &&
                !entry.reversalOfSourceKey &&
                entry.method === p.payments[0]?.method
            )
          ),
        "payments",
        "Supply one full acquisition payment per nonzero component, using the purchase date and a shared method"
      )
      result = await recordPurchase(
        identity,
        env(
          {
            ...common,
            supplierId,
            purchaseDate: p.purchaseDate,
            paymentMethod: p.payments[0].method,
            ...(p.purchaseType === "LEASE_SETTLEMENT"
              ? { purchaseType: p.purchaseType, settlement: settlement! }
              : {
                  purchaseType: p.purchaseType,
                  purchasePrice: p.purchasePrice,
                }),
          },
          expected
        ),
        tx,
        Object.fromEntries(
          p.payments.map((entry) => [entry.category, entry.reference])
        )
      )
    }

    const acquisition = result.affected.find(
      (r) =>
        r.type === "PurchaseRecord" && r.id === (acquiredId ?? result.result.id)
    )
    need(
      acquisition,
      "cycleSourceKey",
      "Acquisition did not produce a purchase cycle"
    )
    const cycle = await tx.purchaseRecord.findUniqueOrThrow({
      where: { id: acquisition.id },
      include: { vehicle: true },
    })
    need(
      cycle.cycleNumber === p.cycleNumber,
      "cycleNumber",
      "Cycle number conflicts with this vehicle’s acquisition history"
    )
    const cycleId = cycle.id
    if (p.closedAt) ctx.cycleCloseDates.set(cycleId, p.closedAt)
    if (p.available || p.status === "SOLD") ctx.releaseAfterRepair.add(cycleId)
    if (p.notes) {
      await executeCycleMoney(
        identity,
        "editPurchase",
        env(
          {
            cycleId,
            reason: "Historical purchase notes",
            patch: { notes: p.notes },
            cashCorrections: [],
          },
          [await cycleRef(tx, cycleId), ref("Vehicle", cycle.vehicle)]
        ),
        tx
      )
    }
    if (p.receivedDate) {
      const disposition =
        p.status === "IN_STOCK" && !p.available
          ? { kind: "HOLD", reason: p.holdReason }
          : { kind: "RELEASE" }
      await executeStock(
        identity,
        "receiveStock",
        env({ cycleId, date: p.receivedDate, disposition }, [
          await cycleRef(tx, cycleId),
        ]),
        tx
      )
    }
    for (const mileage of history) {
      const v = await tx.vehicle.findUniqueOrThrow({
        where: { id: cycle.vehicleId },
      })
      await executeCycleEdit(
        identity,
        "addMileage",
        env({ cycleId, mileage }, [
          await cycleRef(tx, cycleId),
          ref("Vehicle", v),
        ]),
        tx
      )
    }
    for (const cost of p.additionalCosts) {
      const { sourceKey, date, payments, ...values } = cost
      const [first, ...rest] = outflows(
        payments,
        "COST",
        "additionalCosts.payments"
      )
      const key = ctx.key("VEHICLES", sourceKey)
      need(
        !ctx.costIds.has(key),
        "additionalCosts.sourceKey",
        "Cost source key occurs more than once"
      )
      const created = await executeCycleMoney(
        identity,
        "addCost",
        env(
          {
            cycleId,
            ...values,
            incurredDate: date,
            payment: first && payment(first),
          },
          [await cycleRef(tx, cycleId)]
        ),
        tx
      )
      const costId = created.result.id
      for (const entry of rest) {
        const current = await tx.vehicleCost.findUniqueOrThrow({
          where: { id: costId },
        })
        await executeCycleMoney(
          identity,
          "payCost",
          env({ costId, payment: payment(entry) }, [
            await cycleRef(tx, cycleId),
            ref("VehicleCost", current),
          ]),
          tx
        )
      }
      ctx.costIds.set(key, costId)
    }
    return { ...result, result: acquisition }
  },
}

const repairs: ImportAdapter<"REPAIRS"> = {
  dependencies: ({ payload }) => [payload.cycle, payload.vendor],
  work: ({ payload }) => 2 + payload.payments.length,
  async apply(ctx, { payload: p }) {
    const { identity, tx } = ctx
    const cycleId = await ctx.resolve(p.cycle, "cycle")
    const vendorId = await ctx.resolve(p.vendor, "vendor")
    const vendor = await tx.repairVendor.findUnique({
      where: { id: vendorId },
      select: { id: true, revision: true },
    })
    need(vendor, "vendor", "Repair vendor could not be resolved")
    const duplicate = await tx.repairRecord.findFirst({
      where: {
        cycleId,
        vendorId,
        request: p.request,
        sentDate: new Date(p.sentDate),
      },
      select: { id: true },
    })
    if (duplicate)
      throw new ImportRowError(
        "sentDate",
        "This cycle already has a matching repair.",
        "IMPORT_DUPLICATE"
      )
    const sent = await executeRepair(
      identity,
      "sendRepair",
      env(
        {
          cycleId,
          vendorId,
          request: p.request,
          sentDate: p.sentDate,
        },
        [await cycleRef(tx, cycleId), ref("RepairVendor", vendor)]
      ),
      tx
    )
    const repairId = sent.result.id
    if (p.returnedDate) {
      const [first, ...rest] = outflows(p.payments, "REPAIR")
      await executeRepair(
        identity,
        "returnRepair",
        env(
          {
            repairId,
            returnedDate: p.returnedDate,
            invoiceDate: p.invoiceDate,
            invoiceAmount: p.invoiceAmount,
            summary: p.summary,
            payment: first && payment(first),
          },
          [
            await cycleRef(tx, cycleId),
            { type: "RepairRecord", id: repairId, revision: 1 },
          ]
        ),
        tx
      )
      for (const entry of rest) {
        const repair = await tx.repairRecord.findUniqueOrThrow({
          where: { id: repairId },
        })
        await executeRepair(
          identity,
          "payRepair",
          env({ repairId, payment: payment(entry) }, [
            await cycleRef(tx, cycleId),
            ref("RepairRecord", repair),
          ]),
          tx
        )
      }
      if (ctx.releaseAfterRepair.has(cycleId))
        await executeStock(
          identity,
          "releaseStock",
          env({ cycleId }, [await cycleRef(tx, cycleId)]),
          tx
        )
    }
    return sent
  },
}

const sales: ImportAdapter<"SALES"> = {
  keys: ({ payload }) => [payload.saleCaseSourceKey],
  dependencies: ({ payload }) => [payload.cycle, payload.customer],
  work: () => 4,
  async apply(ctx, { payload: p }) {
    const { tx, identity } = ctx
    need(
      (p.kind === "CASH" || p.kind === "TRADE_IN") &&
        p.state === "COMPLETED" &&
        p.completion &&
        !p.reservation &&
        !p.finance,
      "kind",
      "Only completed cash and trade-in sales can be imported in this version"
    )
    const cycleId = await ctx.resolve(p.cycle, "cycle")
    const customerId = await ctx.resolve(p.customer, "customer")
    const customer = await tx.customer.findUnique({
      where: { id: customerId },
      select: { id: true, revision: true },
    })
    need(customer, "customer", "Customer could not be resolved")
    const { basis, date, mileage } = p.completion
    const cycle = await tx.purchaseRecord.findUnique({
      where: { id: cycleId },
      include: { costs: true, repairs: true },
    })
    need(
      cycle && cycle.purchasePrice.toString() === basis.purchase,
      "basis.purchase",
      "Sale basis does not match the acquisition price"
    )
    for (const kind of ["repairs", "costs"] as const) {
      const entries = await Promise.all(
        basis[kind].map(async (entry) => {
          let id = entry.sourceKey
          if (kind === "repairs" && !/^[0-9a-f-]{36}$/i.test(id))
            id = await ctx.resolve(
              { namespace: "", type: "REPAIRS", sourceKey: id },
              "basis.repairs"
            )
          if (kind === "costs")
            id = ctx.costIds.get(ctx.key("VEHICLES", id)) ?? id
          return { id, amount: entry.amount }
        })
      )
      const actual =
        kind === "costs"
          ? cycle.costs.map((c) => ({ id: c.id, amount: c.amount.toString() }))
          : cycle.repairs
              .filter((r) => r.invoiceAmount !== null)
              .map((r) => ({ id: r.id, amount: r.invoiceAmount!.toString() }))
      need(
        actual.length === entries.length &&
          actual.every((a) =>
            entries.some((b) => a.id === b.id && a.amount === b.amount)
          ),
        `basis.${kind}`,
        "Sale basis components must match the cycle’s recorded amounts"
      )
    }
    if (!cycle.available && cycle.holdReason === "RETURNED_AWAITING_RELEASE")
      await executeStock(
        identity,
        "releaseStock",
        env({ cycleId }, [await cycleRef(tx, cycleId)]),
        tx
      )
    const residual = BigInt(p.price) - BigInt(p.tradeIn?.value ?? "0")
    const [receipt] = p.payments
    need(
      residual === 0n
        ? p.payments.length === 0
        : p.payments.length === 1 &&
            receipt.direction === "IN" &&
            receipt.category === "SALE" &&
            !receipt.reversalOfSourceKey &&
            receipt.date === date &&
            BigInt(receipt.amount) === residual,
      "payments",
      "Supply one dated sale receipt for the cash portion, or no receipt for a fully noncash sale"
    )
    const result = await executeSale(
      identity,
      "completeImmediate",
      env(
        {
          cycleId,
          customerId,
          price: p.price,
          date,
          mileage,
          method: receipt?.method ?? "CASH",
          reference: p.reference,
          kind: p.kind,
          ...(p.tradeIn
            ? {
                tradeIn: {
                  description: p.tradeIn.description,
                  value: p.tradeIn.value,
                },
              }
            : {}),
        },
        [await cycleRef(tx, cycleId), ref("Customer", customer)]
      ),
      tx,
      {
        receiptReference: receipt?.reference,
        notes: p.notes,
        closedAt: ctx.cycleCloseDates.get(cycleId),
      }
    )
    return result
  },
}

export const importAdapters = {
  SUPPLIERS: directory<"SUPPLIERS">("SUPPLIER"),
  CUSTOMERS: {
    apply: ({ tx, identity }, { payload }) =>
      executeCustomer(identity, "createCustomer", env(payload), tx),
  },
  REPAIR_VENDORS: directory<"REPAIR_VENDORS">("REPAIR_VENDOR"),
  VEHICLES: vehicles,
  FINANCE_COMPANIES: {
    work: ({ payload }) => 2 + payload.contacts.length,
    async apply({ tx, identity }, { payload }) {
      const found = await tx.financeCompany.findFirst({
        where: { name: { equals: payload.name, mode: "insensitive" } },
        select: { id: true },
      })
      if (found)
        throw new ImportRowError(
          "name",
          "This finance company already exists. Use its existing ID.",
          "IMPORT_DUPLICATE"
        )
      const settings = await currentSettings(tx)
      return executeParty(
        identity,
        "createFinanceCompany",
        env(payload, [ref("Settings", settings)]),
        tx
      )
    },
  },
  BROKERAGE: {
    dependencies: ({ payload }) => [payload.customer],
    work: ({ payload }) => 4 + payload.guarantors.length,
    async apply(ctx, { payload }) {
      const { tx, identity } = ctx
      const customerId = await ctx.resolve(payload.customer, "customer")
      const customer = await tx.customer.findUnique({
        where: { id: customerId },
      })
      need(customer, "customer", "Customer could not be resolved")
      const quote = await tx.quote.findUnique({
        where: { id: payload.quoteId },
        include: { company: true },
      })
      need(quote, "quoteId", "Quote could not be resolved")
      const duplicate = await tx.brokerageDeal.findFirst({
        where: { customerId, originalQuoteId: quote.id },
        select: { id: true },
      })
      if (duplicate)
        throw new ImportRowError(
          "quoteId",
          "This customer and quote already have a brokerage deal.",
          "IMPORT_DUPLICATE"
        )
      const settings = await currentSettings(tx)
      return executeBrokerage(
        identity,
        "openBrokerage",
        env({ customerId, quoteId: quote.id, guarantors: payload.guarantors }, [
          ref("Customer", customer),
          ref("Quote", quote),
          ref("FinanceCompany", quote.company),
          ref("Settings", settings),
        ]),
        tx
      )
    },
  },
  SALES: sales,
  REPAIRS: repairs,
} satisfies { [K in ImportType]?: ImportAdapter<K> }

export function adapterFor<K extends ImportType>(
  type: K
): ImportAdapter<K> | undefined {
  return (importAdapters as { [T in ImportType]?: ImportAdapter<T> })[type]
}
