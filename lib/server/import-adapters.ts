import "server-only"
import { randomUUID } from "node:crypto"
import type { z } from "zod"
import type {
  Applied,
  Dependency,
  ImportType,
  LegacyPayment,
  LegacyMetadata,
  LegacyApprovalEvidence,
  ImportPayloads,
  LegacyRef,
} from "../../.planning/implementation/contracts/api"
import type { Identity } from "./actor"
import type { Tx } from "./db"
import { CommandError } from "./errors"
import { executeCustomer } from "./customers"
import { dealChecklistHash, dealInclude, executeBrokerage } from "./brokerage"
import { currentSettings } from "./settings"
import { executeParty } from "./parties"
import {
  executeCycleEdit,
  executeCycleMoney,
  executeStock,
  recordPurchase,
} from "./purchases"
import { executeRepair } from "./repairs"
import { executeSale, loadSale } from "./sales"
import { executeCommitment } from "./reservation-sales"
import { executeReconciliation } from "./reconciliation"
import { processReservation } from "./reservation-expiry"
import { addCalendarDays, localMidnightToUtc } from "./domain-math"
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
  commitmentCycles: Set<string>
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

type PaymentOwner = {
  type: "PURCHASE" | "COST" | "REPAIR"
  id: string
  cycleId: string
}

async function applyHistoricalPayments(
  { tx, identity }: ImportContext,
  owner: PaymentOwner,
  rows: LegacyPayment[]
) {
  const payments = new Map<string, { id: string; source: LegacyPayment }>()
  const reversed = new Set<string>()
  for (const entry of [...rows].sort((a, b) => a.date.localeCompare(b.date))) {
    const field = `payments.${entry.sourceKey}`
    need(
      owner.type === "PURCHASE"
        ? ["SELLER", "SETTLEMENT"].includes(entry.category)
        : entry.category === owner.type,
      field,
      "Payment category does not match its owner"
    )
    const expected: Dependency[] = [await cycleRef(tx, owner.cycleId)]
    if (owner.type === "COST")
      expected.push(
        ref(
          "VehicleCost",
          await tx.vehicleCost.findUniqueOrThrow({ where: { id: owner.id } })
        )
      )
    if (owner.type === "REPAIR")
      expected.push(
        ref(
          "RepairRecord",
          await tx.repairRecord.findUniqueOrThrow({ where: { id: owner.id } })
        )
      )
    if (entry.reversalOfSourceKey) {
      const original = payments.get(entry.reversalOfSourceKey)
      need(
        original &&
          !reversed.has(entry.reversalOfSourceKey) &&
          entry.direction === "IN" &&
          entry.amount === original.source.amount &&
          entry.date === original.source.date &&
          entry.method === original.source.method &&
          entry.reference === original.source.reference &&
          entry.category === original.source.category,
        field,
        "A reversal must match an earlier unreversed outflow in this source"
      )
      const raw = env(
        {
          sourceType: owner.type,
          sourceId: owner.id,
          paymentId: original.id,
          reason: `Historical reversal of ${entry.reversalOfSourceKey}`,
        },
        expected
      )
      if (owner.type === "REPAIR")
        await executeRepair(identity, "reversePayment", raw, tx)
      else await executeCycleMoney(identity, "reversePayment", raw, tx)
      reversed.add(entry.reversalOfSourceKey)
      continue
    }
    need(
      entry.direction === "OUT",
      field,
      "An inflow must reference the source payment it reverses"
    )
    const applied =
      owner.type === "REPAIR"
        ? await executeRepair(
            identity,
            "payRepair",
            env({ repairId: owner.id, payment: payment(entry) }, expected),
            tx
          )
        : owner.type === "COST"
          ? await executeCycleMoney(
              identity,
              "payCost",
              env({ costId: owner.id, payment: payment(entry) }, expected),
              tx
            )
          : await executeCycleMoney(
              identity,
              "payPurchase",
              env(
                {
                  cycleId: owner.cycleId,
                  recipient: entry.category,
                  payment: payment(entry),
                },
                expected
              ),
              tx
            )
    const where = { commandId: applied.commandId }
    const recorded =
      owner.type === "REPAIR"
        ? await tx.repairPayment.findFirstOrThrow({ where })
        : owner.type === "COST"
          ? await tx.costPayment.findFirstOrThrow({ where })
          : await tx.purchasePayment.findFirstOrThrow({ where })
    payments.set(entry.sourceKey, { id: recorded.id, source: entry })
  }
}

function directory<K extends "SUPPLIERS" | "REPAIR_VENDORS">(
  kind: "SUPPLIER" | "REPAIR_VENDOR"
): ImportAdapter<K> {
  const adapter = {
    work: ({ payload }: { payload: ImportPayloads["SUPPLIERS"] }) =>
      1 + payload.contacts.length + Number(payload.isActive === false),
    async apply(
      { tx, identity }: ImportContext,
      { payload }: { payload: ImportPayloads["SUPPLIERS"] }
    ) {
      const values = { ...payload }
      delete values.isActive
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
        env({ type: kind, values }),
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
    Number(!!p.disposal) * 3 +
    p.mileage.length +
    p.payments.length +
    p.additionalCosts.reduce((n, c) => n + 1 + c.payments.length, 0),
  async apply(ctx, { payload: p }) {
    const { tx, identity } = ctx
    need(
      [
        "PURCHASED",
        "IN_STOCK",
        "IN_REPAIR",
        "SOLD",
        "DELIVERED",
        "WRITTEN_OFF",
        "ADVANCE_PLACED",
        "ADVANCE_EXPIRED",
        "FINANCE_PENDING",
        "DO_RECEIVED",
      ].includes(p.status),
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
      const ordinaryPayment =
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
        )
      result = await recordPurchase(
        identity,
        env(
          {
            ...common,
            supplierId,
            purchaseDate: p.purchaseDate,
            paymentMethod: p.payments[0]?.method ?? "CASH",
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
        ),
        !ordinaryPayment
      )
      if (!ordinaryPayment)
        await applyHistoricalPayments(
          ctx,
          { type: "PURCHASE", id: result.result.id, cycleId: result.result.id },
          p.payments
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
        p.status === "IN_STOCK" &&
        !p.available &&
        !ctx.commitmentCycles.has(p.cycleSourceKey)
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
          },
          [await cycleRef(tx, cycleId)]
        ),
        tx
      )
      const costId = created.result.id
      await applyHistoricalPayments(
        ctx,
        { type: "COST", id: costId, cycleId },
        payments
      )
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
          },
          [
            await cycleRef(tx, cycleId),
            { type: "RepairRecord", id: repairId, revision: 1 },
          ]
        ),
        tx
      )
      await applyHistoricalPayments(
        ctx,
        { type: "REPAIR", id: repairId, cycleId },
        p.payments
      )
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

async function customerRef(tx: Tx, id: string) {
  const customer = await tx.customer.findUnique({ where: { id } })
  need(customer, "customer", "Customer could not be resolved")
  return ref("Customer", customer)
}

async function releaseRepairHold(ctx: ImportContext, cycleId: string) {
  const { tx, identity } = ctx
  const cycle = await tx.purchaseRecord.findUnique({ where: { id: cycleId } })
  need(cycle, "cycle", "Purchase cycle could not be resolved")
  if (!cycle.available && cycle.holdReason === "RETURNED_AWAITING_RELEASE")
    await executeStock(
      identity,
      "releaseStock",
      env({ cycleId }, [ref("PurchaseRecord", cycle)]),
      tx
    )
}

async function commitmentRefs(tx: Tx, saleCaseId: string) {
  const sale = await loadSale(tx, saleCaseId)
  need(sale, "saleCaseSourceKey", "Sale case could not be resolved")
  return [
    ref("SaleCase", sale),
    ref("PurchaseRecord", sale.purchaseRecord),
    ...(sale.reservation ? [ref("Reservation", sale.reservation)] : []),
  ]
}

function receiptOf(
  rows: LegacyPayment[],
  category: string,
  direction: "IN" | "OUT" = "IN"
) {
  const matches = rows.filter((entry) => entry.category === category)
  need(
    matches.length <= 1 &&
      matches.every(
        (entry) => entry.direction === direction && !entry.reversalOfSourceKey
      ),
    "payments",
    `Expected at most one unreversed ${category} ${direction} payment`
  )
  return matches[0]
}

function discountEvidence(
  price: string,
  listed: bigint | null,
  legacy?: LegacyMetadata
) {
  if (listed === null || BigInt(price) >= listed) return undefined
  need(
    legacy?.approverName,
    "legacyApproverName",
    "A below-list transaction requires the historical approver name"
  )
  return {
    approverName: legacy.approverName,
    ...(legacy.approvalReference && {
      approvalReference: legacy.approvalReference,
    }),
  }
}

const advances: ImportAdapter<"ADVANCES"> = {
  keys: ({ payload }) => [payload.saleCaseSourceKey],
  dependencies: ({ payload }) => [payload.cycle, payload.customer],
  work: ({ payload }) => 3 + payload.payments.length,
  async apply(ctx, { payload: p, legacy }) {
    const { tx, identity } = ctx
    const cycleId = await ctx.resolve(p.cycle, "cycle")
    const customerId = await ctx.resolve(p.customer, "customer")
    const receipt = receiptOf(p.payments, "ADVANCE")
    const refund = receiptOf(p.payments, "REFUND", "OUT")
    need(
      receipt && receipt.amount === p.amount && receipt.date === p.placedDate,
      "payments",
      "Advance receipt must match the placement amount and date"
    )
    need(
      p.payments.length === (refund ? 2 : 1) &&
        !!refund === (p.state === "REFUNDED"),
      "payments",
      "Supply an advance receipt and a refund only for a refunded advance"
    )
    if (refund)
      need(
        refund.date === p.resolutionDate &&
          BigInt(refund.amount) + BigInt(p.retainedAmount!) ===
            BigInt(p.amount),
        "payments",
        "Refund and retained amount must match the deposit and resolution date"
      )
    const expiry = new Date(p.expiresAt)
    need(
      p.validThrough > p.placedDate &&
        +expiry ===
          +localMidnightToUtc(
            addCalendarDays(p.validThrough, 1),
            p.policySnapshot.timezone
          ),
      "expiresAt",
      "Expiry must be midnight after the last valid day in the recorded timezone"
    )
    if (p.state === "ACTIVE" || p.state === "EXPIRED")
      need(
        expiry <= new Date() === (p.state === "EXPIRED"),
        "state",
        "Advance state must match its expiry"
      )
    await releaseRepairHold(ctx, cycleId)
    const settings = await currentSettings(tx)
    const opened = await executeCommitment(
      identity,
      "placeReservation",
      env(
        {
          cycleId,
          customerId,
          price: p.agreed,
          receipt: payment(receipt),
        },
        [
          await cycleRef(tx, cycleId),
          await customerRef(tx, customerId),
          ref("Settings", settings),
        ]
      ),
      tx,
      {
        advance: p,
        approval: discountEvidence(p.agreed, BigInt(p.listedBasis), legacy),
      }
    )
    const reservation = opened.affected.find(
      (item) => item.type === "Reservation"
    )
    need(reservation, "state", "Reservation was not created")
    if (p.state === "EXPIRED") {
      need(
        (await processReservation(
          identity,
          opened.result.id,
          cycleId,
          expiry,
          tx
        )) === "expired",
        "state",
        "Advance could not be expired"
      )
    } else if (p.state === "REFUNDED" || p.state === "CANCELLED") {
      await executeCommitment(
        identity,
        "cancelRetained",
        env(
          {
            reservationId: reservation.id,
            reason: p.resolutionReason,
            disposition: p.disposition,
            retainedAmount: p.retainedAmount,
          },
          await commitmentRefs(tx, opened.result.id)
        ),
        tx,
        {
          resolutionDate: p.resolutionDate,
          refund: refund && payment(refund),
        }
      )
    }
    return { ...opened, result: reservation }
  },
}

async function historicalCommitmentSale(
  ctx: ImportContext,
  p: ImportPayloads["SALES"],
  cycleId: string,
  customerId: string,
  approval?: LegacyApprovalEvidence
) {
  const { tx, identity } = ctx
  const reservationId =
    p.reservation && (await ctx.resolve(p.reservation, "reservation"))
  const reservation = reservationId
    ? await tx.reservation.findUnique({
        where: { id: reservationId },
        include: { saleCase: true },
      })
    : null
  if (p.reservation)
    need(
      reservation &&
        reservation.saleCase.customerId === customerId &&
        reservation.saleCase.purchaseRecordId === cycleId &&
        reservation.saleCase.agreedPrice === BigInt(p.price),
      "reservation",
      "Reservation must match this cycle, customer and agreed price"
    )
  if (p.kind === "ADVANCE") {
    const balance = receiptOf(p.payments, "BALANCE")
    need(
      p.completion && reservation && p.payments.length === (balance ? 1 : 0),
      "payments",
      "Converted advances require completion and a balance receipt when money is due"
    )
    return executeCommitment(
      identity,
      "convertReservation",
      env(
        {
          reservationId,
          date: p.completion.date,
          mileage: p.completion.mileage,
          balance: balance ? payment(balance) : null,
        },
        await commitmentRefs(tx, reservation.saleCaseId)
      ),
      tx,
      { closedAt: ctx.cycleCloseDates.get(cycleId) }
    )
  }
  const finance = p.finance
  need(
    finance && p.state !== "CANCELLED",
    "state",
    "Expected pending, DO received or completed lease"
  )
  const companyId = await ctx.resolve(finance.company, "financeCompany")
  const company = await tx.financeCompany.findUnique({
    where: { id: companyId },
  })
  need(company, "financeCompany", "Finance company could not be resolved")
  const down = receiptOf(p.payments, "DOWN_PAYMENT")
  const lender = p.payments.filter((entry) => entry.category === "LENDER")
  need(
    down?.amount === finance.downPayment &&
      p.payments.length === 1 + lender.length &&
      lender.every(
        (entry) => entry.direction === "IN" && !entry.reversalOfSourceKey
      ) &&
      (!lender.length || p.completion),
    "payments",
    "Supply the matching down payment and unreversed lender receipts on completed leases"
  )
  const settings = await currentSettings(tx)
  let result = await executeCommitment(
    identity,
    "startFinance",
    env(
      {
        cycleId,
        customerId,
        price: p.price,
        reference: p.reference,
        reservationId,
        downPayment: payment(down),
        companyId,
        financeAmount: finance.financeAmount,
        termMonths: finance.termMonths,
      },
      [
        ...(reservation
          ? await commitmentRefs(tx, reservation.saleCaseId)
          : [await cycleRef(tx, cycleId)]),
        await customerRef(tx, customerId),
        ref("FinanceCompany", company),
        ref("Settings", settings),
      ]
    ),
    tx,
    { approval }
  )
  const saleCaseId = result.result.id
  if (finance.doIssueDate) {
    result = await executeCommitment(
      identity,
      "recordDO",
      env(
        {
          saleCaseId,
          issueDate: finance.doIssueDate,
          ...(finance.doAttachmentId
            ? { attachmentId: finance.doAttachmentId }
            : {}),
        },
        await commitmentRefs(tx, saleCaseId)
      ),
      tx,
      {
        missingDeliveryOrder: !finance.doAttachmentId,
      }
    )
  }
  if (p.completion) {
    result = await executeCommitment(
      identity,
      "confirmDOAndHandover",
      env(
        {
          saleCaseId,
          date: p.completion.date,
          mileage: p.completion.mileage,
        },
        await commitmentRefs(tx, saleCaseId)
      ),
      tx,
      { closedAt: ctx.cycleCloseDates.get(cycleId) }
    )
    for (const entry of [...lender].sort((a, b) =>
      a.date.localeCompare(b.date)
    ))
      result = await executeCommitment(
        identity,
        "recordLenderReceipt",
        env(
          {
            saleCaseId,
            payment: payment(entry),
          },
          await commitmentRefs(tx, saleCaseId)
        ),
        tx
      )
  }
  return result
}

const sales: ImportAdapter<"SALES"> = {
  keys: ({ payload }) => [payload.saleCaseSourceKey],
  dependencies: ({ payload }) => [
    payload.cycle,
    payload.customer,
    payload.reservation,
    payload.finance?.company,
  ],
  work: ({ payload }) => 4 + payload.payments.length,
  async apply(ctx, { payload: p, legacy }) {
    const { tx, identity } = ctx
    const cycleId = await ctx.resolve(p.cycle, "cycle")
    const customerId = await ctx.resolve(p.customer, "customer")
    const customer = await customerRef(tx, customerId)
    await releaseRepairHold(ctx, cycleId)
    const cycle = await tx.purchaseRecord.findUnique({
      where: { id: cycleId },
      include: { costs: true, repairs: true },
    })
    need(cycle, "cycle", "Purchase cycle could not be resolved")
    const approval = p.reservation
      ? undefined
      : discountEvidence(p.price, cycle.listedPrice, legacy)
    if (!p.completion) {
      need(
        p.kind === "LEASE",
        "state",
        "Only pending lease sales can omit completion"
      )
      return historicalCommitmentSale(ctx, p, cycleId, customerId, approval)
    }
    const { basis, date, mileage } = p.completion
    need(
      cycle.purchasePrice.toString() === basis.purchase,
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
    if (p.kind === "LEASE" || p.kind === "ADVANCE")
      return historicalCommitmentSale(ctx, p, cycleId, customerId, approval)
    need(
      p.kind === "CASH" || p.kind === "TRADE_IN",
      "kind",
      "Unsupported sale kind"
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
        [await cycleRef(tx, cycleId), customer]
      ),
      tx,
      {
        receiptReference: receipt?.reference,
        notes: p.notes,
        approval,
        closedAt: ctx.cycleCloseDates.get(cycleId),
      }
    )
    return result
  },
}

const remittances: ImportAdapter<"REMITTANCES"> = {
  dependencies: ({ payload }) => [
    payload.company,
    ...payload.allocations.map((entry) => entry.source),
  ],
  work: ({ payload }) =>
    4 +
    2 * payload.allocations.length +
    (payload.noticeLines?.length ?? 0) +
    (payload.reversal ? 1 + payload.allocations.length : 0),
  async apply(ctx, { payload: p }) {
    const { tx, identity } = ctx
    const companyId = await ctx.resolve(p.company, "company")
    const currentCompany = async () => {
      const company = await tx.financeCompany.findUnique({
        where: { id: companyId },
      })
      need(company, "company", "Finance company could not be resolved")
      return ref("FinanceCompany", company)
    }
    const staged = p.draftId
      ? await tx.remittance.findUnique({ where: { id: p.draftId } })
      : (
          await executeReconciliation(
            identity,
            "stageRemittance",
            env(
              {
                companyId,
                reference: p.payment.reference,
              },
              [await currentCompany()]
            ),
            tx
          )
        ).result
    need(staged, "draftId", "Staged remittance could not be resolved")
    const remittanceId = staged.id
    const record = await executeReconciliation(
      identity,
      "recordRemittance",
      env(
        {
          draftId: remittanceId,
          companyId,
          payment: p.payment,
          noticeAttachmentId: p.noticeAttachmentId,
          lines: p.noticeLines ?? [],
        },
        [await currentCompany(), ref("Remittance", staged)]
      ),
      tx
    )
    const remittanceRef = async () =>
      ref(
        "Remittance",
        await tx.remittance.findUniqueOrThrow({ where: { id: remittanceId } })
      )
    const reverseReceipt = async (reconciliationCommandId?: string) => {
      if (!p.reversal) return record
      const { date, reason } = p.reversal
      if (reconciliationCommandId) {
        const applied = await tx.commissionAllocation.findMany({
          where: { remittanceId, commandId: reconciliationCommandId },
          orderBy: { id: "asc" },
        })
        for (const allocation of applied) {
          const entitlement = await tx.commissionEntitlement.findUniqueOrThrow({
            where: { id: allocation.entitlementId },
          })
          await executeReconciliation(
            identity,
            "reverseAllocation",
            env({ allocationId: allocation.id, reason }, [
              await currentCompany(),
              await remittanceRef(),
              ref("CommissionEntitlement", entitlement),
            ]),
            tx
          )
        }
      }
      const original = await tx.remittancePayment.findUniqueOrThrow({
        where: { commandId: record.commandId },
      })
      return executeReconciliation(
        identity,
        "reversePayment",
        env(
          {
            sourceType: "REMITTANCE",
            sourceId: remittanceId,
            paymentId: original.id,
            date,
            reason,
          },
          [await currentCompany(), await remittanceRef()]
        ),
        tx
      )
    }
    if (!p.allocations.length) return reverseReceipt()

    const lines = p.noticeLines?.length
      ? await tx.noticeLine.findMany({
          where: { remittanceId },
          select: { key: true, id: true },
        })
      : []
    const entitlements: Dependency[] = []
    const allocations = []
    for (const [index, entry] of p.allocations.entries()) {
      const field = `allocations[${index}]`
      const sourceId = await ctx.resolve(entry.source, field)
      const entitlement = await tx.commissionEntitlement.findFirst({
        where: {
          companyId,
          ...(entry.sourceType === "SALES"
            ? { saleCaseId: sourceId }
            : { brokerageDealId: sourceId }),
        },
      })
      need(
        entitlement,
        field,
        "This source has no commission entitlement for the finance company"
      )
      entitlements.push(ref("CommissionEntitlement", entitlement))
      allocations.push({
        remittanceId,
        entitlementId: entitlement.id,
        noticeLineId: lines.find((line) => line.key === entry.noticeLineKey)
          ?.id,
        amount: entry.amount,
      })
    }
    const run = await executeReconciliation(
      identity,
      "reconcile",
      env(
        {
          companyId,
          asOfDate: p.asOfDate,
          allocations,
          resolutions: [],
        },
        [
          await currentCompany(),
          ref("Remittance", record.result),
          ...entitlements,
        ]
      ),
      tx
    )
    return reverseReceipt(run.commandId)
  },
}

export async function archiveImportedParty(
  ctx: ImportContext,
  row: TypedImportRow,
  id: string
) {
  const { identity, tx } = ctx
  if (
    row.type !== "CUSTOMERS" &&
    row.type !== "SUPPLIERS" &&
    row.type !== "REPAIR_VENDORS"
  )
    return
  if (row.payload.isActive !== false) return
  const reason = row.legacy?.notes ?? "Archived in the historical source"
  if (row.type === "CUSTOMERS") {
    const current = await tx.customer.findUniqueOrThrow({ where: { id } })
    return executeCustomer(
      identity,
      "archiveParty",
      env(
        {
          type: "CUSTOMER",
          id,
          active: false,
          reason,
        },
        [ref("Customer", current)]
      ),
      tx
    )
  }
  const supplier = row.type === "SUPPLIERS"
  const current = supplier
    ? await tx.supplier.findUniqueOrThrow({ where: { id } })
    : await tx.repairVendor.findUniqueOrThrow({ where: { id } })
  return executeParty(
    identity,
    "archiveParty",
    env(
      {
        type: supplier ? "SUPPLIER" : "REPAIR_VENDOR",
        id,
        active: false,
        reason,
      },
      [ref(supplier ? "Supplier" : "RepairVendor", current)]
    ),
    tx
  )
}

async function restoreBrokerageProgress(
  { tx, identity }: ImportContext,
  dealId: string,
  history: NonNullable<ImportPayloads["BROKERAGE"]["history"]>,
  opened?: Applied
) {
  let result = opened
  for (const step of history) {
    const deal = await tx.brokerageDeal.findUnique({
      where: { id: dealId },
      include: dealInclude,
    })
    need(deal, "existingDealId", "Brokerage deal could not be resolved")
    const dealRef = ref("BrokerageDeal", deal)
    if (step.command === "dispatchBatch") {
      const dispatched = await executeBrokerage(
        identity,
        step.command,
        env(
          {
            ...step.input,
            sourceIds: [
              {
                type: "BROKERAGE",
                id: deal.id,
                revision: deal.revision,
                checklistHash: dealChecklistHash(deal),
              },
            ],
          },
          [dealRef]
        ),
        tx
      )
      const updated = dispatched.affected.find(
        (item) => item.type === "BrokerageDeal" && item.id === deal.id
      )
      need(updated, "history", "Dispatch did not update this deal")
      result = { ...dispatched, result: updated }
    } else {
      let input: unknown = { ...step.input, dealId }
      if (step.command === "recordEligibility") {
        const { guarantorIdentity, ...evidence } = step.input
        const guarantor = deal.guarantors.find(
          (item) => item.identity === guarantorIdentity
        )
        need(
          !guarantorIdentity || guarantor,
          "history",
          "Guarantor identity is not on the deal"
        )
        input = { ...evidence, dealId, guarantorId: guarantor?.id }
      }
      result = await executeBrokerage(
        identity,
        step.command,
        env(input, [
          dealRef,
          ref(
            "FinanceCompany",
            await tx.financeCompany.findUniqueOrThrow({
              where: { id: deal.companyId },
            })
          ),
        ]),
        tx
      )
    }
  }
  need(result, "history", "Expected at least one historical step")
  return result
}

export const importAdapters = {
  SUPPLIERS: directory<"SUPPLIERS">("SUPPLIER"),
  CUSTOMERS: {
    work: ({ payload }) => (payload.isActive === false ? 2 : 1),
    apply({ tx, identity }, { payload }) {
      const values = { ...payload }
      delete values.isActive
      return executeCustomer(identity, "createCustomer", env(values), tx)
    },
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
    work: ({ payload }) =>
      4 +
      (payload.guarantors?.length ?? 0) +
      3 * (payload.history?.length ?? 0),
    async apply(ctx, { payload }) {
      const { tx, identity } = ctx
      if (payload.existingDealId)
        return restoreBrokerageProgress(
          ctx,
          payload.existingDealId,
          payload.history ?? []
        )
      need(
        payload.customer,
        "customer",
        "Customer is required for a new brokerage deal"
      )
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
      const opened = await executeBrokerage(
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
      return restoreBrokerageProgress(
        ctx,
        opened.result.id,
        payload.history ?? [],
        opened
      )
    },
  },
  SALES: sales,
  ADVANCES: advances,
  REMITTANCES: remittances,
  REPAIRS: repairs,
} satisfies { [K in ImportType]?: ImportAdapter<K> }

export function adapterFor<K extends ImportType>(
  type: K
): ImportAdapter<K> | undefined {
  return (importAdapters as { [T in ImportType]?: ImportAdapter<T> })[type]
}
