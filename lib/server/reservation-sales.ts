import "server-only"
import { checkIndependentLenderReceipt, refreshLenderEntitlement } from "./reconciliation"
import { randomUUID } from "node:crypto"
import type { VehicleStatus } from "@prisma/client"
import type { z } from "zod"
import type {
  Applied,
  CancelFinanceError,
  CashInput,
  Dependency,
} from "../../.planning/implementation/contracts/api"
import { type Tx } from "./db"
import { currentActor, type Authority as Actor, type Identity } from "./actor"
import { audit, writeReadVersion } from "./audit"
import { transaction, nextBusinessSequence } from "./transactions"
import { runtimeConfig } from "./config"
import { inputDigest } from "./idempotency"
import {
  commitmentEnvelope,
  commitmentInputs,
  type CommitmentCommand,
  refundInput,
} from "./validators"
import { requireFields } from "./permissions"
import { fail } from "./errors"
import { currentSettings } from "./settings"
import { calculateAdvanceValidity, addCalendarDays, localMidnightToUtc } from "./domain-math"
import { C, commission } from "../money"
import {
  colomboToday,
  formatDate,
  loadPurchase,
  purchaseAuth,
  purchaseDTO,
  purchaseVehicleAuth,
  requireRef,
  vehicleDTO,
} from "./purchases"
import {
  lenderPaid,
  loadSale,
  reservationDTO,
  saleAuth,
  saleDTO,
  saleReplay,
  type SaleRow,
} from "./sales"
import { authorizedAttachment } from "./attachments"
import { queueInvoice } from "./invoice-data"

type Cycle = SaleRow["purchaseRecord"]
type Input<N extends CommitmentCommand> = z.infer<(typeof commitmentInputs)[N]>
type Context = {
  commandId: string
  sequence: bigint
  userId: string | null
  action: string
  reason?: string
  initiatedBy?: string
  approverId?: string
}
type HistoricalCommitment = {
  advance?: {
    listedBasis: string
    validThrough: string
    expiresAt: string
    policySnapshot: import("../../.planning/implementation/contracts/api").ImportPayloads["ADVANCES"]["policySnapshot"]
  }
  refund?: CashInput
  resolutionDate?: string
  missingDeliveryOrder?: boolean
  closedAt?: string
  approval?: { approverName: string; approvalReference?: string }
}

type Refund = z.infer<typeof refundInput>

const caseRef = (row: { id: string; revision: number }): Dependency => ({
  type: "SaleCase",
  id: row.id,
  revision: row.revision,
})
const cycleRef = (row: Cycle): Dependency => ({
  type: "PurchaseRecord",
  id: row.id,
  revision: row.revision,
})
const reservationRef = (
  row: NonNullable<SaleRow["reservation"]>
): Dependency => ({ type: "Reservation", id: row.id, revision: row.revision })
const openReservation = (sale: SaleRow) =>
  sale.reservation && ["RESERVED", "EXPIRED"].includes(sale.state)
function effectiveExpiry(row: NonNullable<SaleRow["reservation"]>, at = new Date()) {
  return (
    row.expiredAt ??
    (row.state === "ACTIVE" && row.expiresAt <= at
      ? row.expiresAt
      : undefined)
  )
}

const ensureUser = (context: Context) =>
  context.userId ?? fail("INTERNAL_ERROR", 500)

export async function lockCommitment(tx: Tx, cycleId: string, saleId?: string) {
  const target = await tx.purchaseRecord.findUnique({
    where: { id: cycleId },
    select: { vehicleId: true },
  })
  if (!target) fail("NOT_FOUND", 404)
  await tx.$queryRaw`SELECT id FROM vamotors."Vehicle" WHERE id=${target.vehicleId}::uuid FOR UPDATE`
  await tx.$queryRaw`SELECT id FROM vamotors."PurchaseRecord" WHERE id=${cycleId}::uuid FOR UPDATE`
  if (saleId)
    await tx.$queryRaw`SELECT id FROM vamotors."SaleCase" WHERE id=${saleId}::uuid FOR UPDATE`
}

async function findSaleTarget(
  tx: Tx,
  input: { saleCaseId?: string; reservationId?: string }
) {
  if (input.saleCaseId) {
    const sale = await tx.saleCase.findUnique({
      where: { id: input.saleCaseId },
    })
    if (sale) return sale
  }
  if (input.reservationId) {
    const row = await tx.reservation.findUnique({
      where: { id: input.reservationId },
      include: { saleCase: true },
    })
    if (row) return row.saleCase
  }
  fail("NOT_FOUND", 404)
}

function authorizeCycle(actor: Actor, row: Cycle) {
  requireFields(actor.ability, "PurchaseRecord", "read", purchaseAuth(row), [
    "id",
    "revision",
    "status",
    "available",
    "vehicleId",
    "closedAt",
    "listedPrice",
  ])
  requireFields(actor.ability, "Vehicle", "read", purchaseVehicleAuth(row), [
    "id",
    "identityRevision",
  ])
}

function authorizeSale(actor: Actor, row: SaleRow, operation: string) {
  authorizeCycle(actor, row.purchaseRecord)
  requireFields(actor.ability, "SaleCase", "read", saleAuth(row), [
    "id",
    "revision",
    "state",
  ])
  requireFields(actor.ability, "SaleCase", "update", saleAuth(row), [operation])
}

function authorizePayment(
  actor: Actor,
  sale: { createdBy: string; customerId: string },
  payment: CashInput
) {
  requireFields(actor.ability, "SaleCase", "pay", sale, [
    "amount",
    "date",
    "method",
    ...(payment.reference ? ["reference"] : []),
  ])
}

function checkDate(date: string, row: Cycle, minimum?: Date | null) {
  if (
    date > colomboToday() ||
    date < formatDate(row.purchaseDate) ||
    (minimum && date < formatDate(minimum)) ||
    (row.receivedDate && date < formatDate(row.receivedDate)) ||
    row.repairs.some(
      (repair) => repair.returnedDate && date < formatDate(repair.returnedDate)
    )
  )
    fail("INVALID_INPUT", 422)
}

function checkStock(row: Cycle) {
  if (
    !row.acquisitionCommandId ||
    row.closedAt ||
    row.vehicle.activePurchaseId !== row.id ||
    row.status !== "IN_STOCK" ||
    !row.available ||
    row.disposal ||
    row.repairs.some((repair) => !repair.returnedDate) ||
    row.sales.some((sale) => sale.state !== "CANCELLED")
  )
    fail("INVALID_STATE")
}

function checkMileage(
  input: { date: string; mileage: number; reason?: string },
  row: Cycle
) {
  const before = row.mileage
    .filter((reading) => formatDate(reading.recordedDate) <= input.date)
    .at(-1)
  const after = row.mileage.find(
    (reading) => formatDate(reading.recordedDate) > input.date
  )
  if (after && input.mileage > after.reading) fail("INVALID_INPUT", 422)
  const decreased = before && input.mileage < before.reading
  if (decreased && !input.reason) fail("INVALID_INPUT", 422)
  return decreased ? input.reason : undefined
}

async function recordPayment(
  tx: Tx,
  context: Context,
  saleId: string,
  cycleId: string,
  payment: CashInput,
  category: "ADVANCE" | "BALANCE" | "DOWN_PAYMENT" | "LENDER" | "REFUND",
  originalReceiptId?: string
) {
  const settings = await currentSettings(tx)
  const receipt = await tx.saleReceipt.create({
    data: {
      saleCaseId: saleId,
      purchaseRecordId: cycleId,
      amount: BigInt(payment.amount),
      occurredDate: new Date(payment.date),
      method: payment.method,
      reference: payment.reference,
      direction: category === "REFUND" ? "OUT" : "IN",
      category,
      currency: settings.currency,
      scale: settings.scale,
      createdBy: ensureUser(context),
      commandId: context.commandId,
      lineKey: originalReceiptId ? `REFUND:${originalReceiptId}` : category,
      ...(originalReceiptId ? { refundOf: originalReceiptId } : {}),
    },
  })
  return receipt
}

export async function transitionCommitment(
  tx: Tx,
  context: Context,
  row: Cycle,
  to: VehicleStatus,
  occurredAt: Date,
  disposition?: Input<"cancelRetained">["disposition"],
  closedAt = new Date()
) {
  const sold = to === "SOLD"
  const release = disposition?.kind === "RELEASE"
  await tx.purchaseRecord.update({
    where: { id: row.id },
    data: {
      status: to,
      available: release,
      holdReason: disposition?.kind === "HOLD" ? disposition.reason : null,
      closedAt: sold ? closedAt : null,
      revision: { increment: 1 },
    },
  })
  await tx.vehicle.update({
    where: { id: row.vehicleId },
    data: {
      revision: { increment: 1 },
      ...(sold ? { activePurchaseId: null } : {}),
    },
  })
  await tx.statusEvent.create({
    data: {
      cycleId: row.id,
      from: row.status,
      to,
      action: context.action,
      commandId: context.commandId,
      userId: context.userId,
      occurredAt,
    },
  })
}

export async function publishCommitment(
  tx: Tx,
  context: Context,
  row: Cycle,
  saleId: string,
  beforeSale: SaleRow | null
) {
  const afterSale = await loadSale(tx, saleId)
  if (!afterSale) fail("INTERNAL_ERROR", 500)
  const afterCycle = afterSale.purchaseRecord
  const beforeReservation = beforeSale?.reservation
  const afterReservation = afterSale.reservation
  const entities = [
    ...(afterSale.revision !== beforeSale?.revision
      ? ([
          [
            "SaleCase",
            saleId,
            afterSale.revision,
            beforeSale && saleDTO(beforeSale),
            saleDTO(afterSale),
          ],
        ] as const)
      : []),
    ...(afterCycle.revision !== row.revision
      ? ([
          [
            "PurchaseRecord",
            row.id,
            afterCycle.revision,
            purchaseDTO(row),
            purchaseDTO(afterCycle),
          ],
          [
            "Vehicle",
            row.vehicleId,
            afterCycle.vehicle.revision,
            vehicleDTO(row),
            vehicleDTO(afterCycle),
          ],
        ] as const)
      : []),
    ...(afterReservation &&
    afterReservation.revision !== beforeReservation?.revision
      ? ([
          [
            "Reservation",
            afterReservation.id,
            afterReservation.revision,
            beforeReservation ? reservationDTO(beforeReservation) : null,
            reservationDTO(afterReservation),
          ],
        ] as const)
      : []),
  ] as const
  for (const [entityType, entityId, revision, before, after] of entities) {
    await audit(tx, { ...context, entityType, entityId, before, after })
    await writeReadVersion(tx, {
      commandId: context.commandId,
      sequence: context.sequence,
      entityType,
      entityId,
      revision,
      payload: after,
    })
  }
  return afterSale
}

async function complete(
  tx: Tx,
  context: Context,
  sale: SaleRow,
  input: { date: string; mileage: number; reason?: string },
  historical?: HistoricalCommitment
) {
  const row = sale.purchaseRecord
  const userId = ensureUser(context)
  requireHandoverBasis(row)
  const decreaseReason = checkMileage(input, row)
  const basis = row.basisVersions.at(-1)!
  const date = new Date(input.date)
  const originalProfit = sale.agreedPrice - basis.total
  const id = randomUUID()
  const snapshot = {
    kind: sale.kind,
    agreedPrice: sale.agreedPrice.toString(),
    listedPrice: sale.listedSnapshot?.toString() ?? null,
    basis: basis.total.toString(),
    customerId: sale.customerId,
    customerName: sale.customer.fullName,
    vehicleId: row.vehicleId,
    ...(sale.reference ? { reference: sale.reference } : {}),
    ...(sale.reservation
      ? { advance: sale.reservation.amount.toString() }
      : {}),
    ...(sale.inventoryLease
      ? {
          finance: {
            companyId: sale.inventoryLease.companyId,
            companyName: sale.inventoryLease.companyName,
            downPayment: sale.inventoryLease.down.toString(),
            principal: sale.inventoryLease.principal.toString(),
            termMonths: sale.inventoryLease.termMonths,
            doAttachmentId: sale.inventoryLease.doAttachmentId,
            doIssueDate:
              sale.inventoryLease.issueDate &&
              formatDate(sale.inventoryLease.issueDate),
          },
        }
      : {}),
  }
  await tx.saleCompletion.create({
    data: {
      id,
      saleCaseId: sale.id,
      purchaseRecordId: row.id,
      saleDate: date,
      handoverMileage: input.mileage,
      agreedPrice: sale.agreedPrice,
      basisVersionId: basis.id,
      originalProfit,
      snapshot,
      commandId: context.commandId,
      createdBy: userId,
    },
  })
  await tx.mileageReading.create({
    data: {
      vehicleId: row.vehicleId,
      cycleId: row.id,
      reading: input.mileage,
      recordedDate: date,
      remark: "Handover odometer reading",
      decreaseReason,
      sourceSaleCompletionId: id,
      commandId: context.commandId,
    },
  })
  await tx.saleCase.update({
    where: { id: sale.id },
    data: { state: "COMPLETED", revision: { increment: 1 } },
  })
  const closedAt = historical ? new Date(historical.closedAt ?? input.date) : undefined
  if (closedAt && (closedAt > new Date() || closedAt < new Date(`${input.date}T00:00:00+05:30`)))
    fail("INVALID_INPUT", 422)
  await transitionCommitment(tx, context, row, "SOLD", date, undefined, closedAt)
  if (sale.reservation)
    await tx.reservation.update({
      where: { id: sale.reservation.id },
      data: {
        state: "CONVERTED",
        expiredAt: effectiveExpiry(sale.reservation, historical ? date : undefined),
        revision: { increment: 1 },
        resolvedAt: historical ? date : new Date(),
        resolutionReason: input.reason,
      },
    })
  const payload = {
    id,
    saleCaseId: sale.id,
    purchaseRecordId: row.id,
    date: input.date,
    handoverMileage: input.mileage,
    agreedPrice: sale.agreedPrice.toString(),
    basisVersionId: basis.id,
    originalProfit: originalProfit.toString(),
  }
  await audit(tx, {
    ...context,
    entityType: "SaleCompletion",
    entityId: id,
    before: null,
    after: payload,
  })
  await writeReadVersion(tx, {
    commandId: context.commandId,
    sequence: context.sequence,
    entityType: "SaleCompletion",
    entityId: id,
    revision: 1,
    payload,
  })
  if (sale.inventoryLease) {
    const lease = sale.inventoryLease
    const snapshot = lease.policySnapshot as {
      commission: { basis: string; fixed?: string; rateBps: number }
    }
    const expectedAmount =
      snapshot.commission.basis === "FIXED"
        ? BigInt(snapshot.commission.fixed!)
        : commission(lease.principal, snapshot.commission.rateBps)
    const entitlement = await tx.commissionEntitlement.create({
      data: {
        saleCaseId: sale.id,
        companyId: lease.companyId,
        sourceType: "VEHICLE_SALE",
        expectedAmount,
        policySnapshot: lease.policySnapshot!,
        eligibleAt: date,
        sentDate: date,
        sentDateSource: "HANDOVER",
        createdBy: userId,
        commandId: context.commandId,
      },
    })
    const payload = {
      id: entitlement.id,
      revision: 1,
      saleCaseId: sale.id,
      companyId: lease.companyId,
      sourceType: entitlement.sourceType,
      expectedAmount: expectedAmount.toString(),
      policySnapshot: lease.policySnapshot,
      eligibleAt: entitlement.eligibleAt.toISOString(),
      sentDate: input.date,
      sentDateSource: "HANDOVER",
      state: entitlement.state,
    }
    await audit(tx, {
      ...context,
      entityType: "CommissionEntitlement",
      entityId: entitlement.id,
      before: null,
      after: payload,
    })
    await writeReadVersion(tx, {
      commandId: context.commandId,
      sequence: context.sequence,
      entityType: "CommissionEntitlement",
      entityId: entitlement.id,
      revision: 1,
      payload,
    })
  }
  const completed = await loadSale(tx, sale.id)
  if (!completed) fail("INTERNAL_ERROR", 500)
  await queueInvoice(tx, completed, await currentSettings(tx), userId, context.commandId, context.sequence)
}

function requireHandoverBasis(row: Cycle) {
  const basis = row.basisVersions.at(-1)
  if (!basis || basis.total > C) fail("INVALID_STATE")
}

async function resolveCancellation(
  tx: Tx,
  context: Context,
  sale: SaleRow,
  input: Pick<Refund, "reason" | "disposition" | "retainedAmount"> & { refund?: CashInput },
  resolvedAt = new Date()
) {
  const refund = input.refund
  if (refund) {
    const deposits = sale.receipts.filter(
      (receipt) =>
        receipt.category === "ADVANCE" || receipt.category === "DOWN_PAYMENT"
    )
    if (!deposits.length) fail("INVALID_STATE")
    for (const receipt of deposits) {
      await recordPayment(
        tx,
        context,
        sale.id,
        sale.purchaseRecordId,
        sale.inventoryLease
          ? { ...refund, amount: receipt.amount.toString() }
          : refund,
        "REFUND",
        receipt.id
      )
    }
  }
  if (sale.reservation)
    await tx.reservation.update({
      where: { id: sale.reservation.id },
      data: {
        state: refund ? "REFUNDED" : "CANCELLED",
        expiredAt: effectiveExpiry(sale.reservation, resolvedAt),
        revision: { increment: 1 },
        retainedAmount: BigInt(input.retainedAmount),
        resolvedAt,
        resolutionReason: input.reason,
        disposition: input.disposition.kind,
      },
    })
  await tx.saleCase.update({
    where: { id: sale.id },
    data: { state: "CANCELLED", revision: { increment: 1 } },
  })
  await transitionCommitment(
    tx,
    context,
    sale.purchaseRecord,
    "IN_STOCK",
    resolvedAt,
    input.disposition
  )
}

export function refundAuthority(actor: Actor, sale: SaleRow, input: Refund) {
  authorizeSale(actor, sale, "refund")
  requireFields(actor.ability, "SaleCase", "read", saleAuth(sale), [
    "payments.amount",
    "payments.direction",
    "payments.date",
  ])
  authorizePayment(actor, sale, input.refund)
}
export async function prepareRefund(
  tx: Tx,
  actor: Actor,
  input: Refund,
  expected: Dependency[]
) {
  const target = await findSaleTarget(tx, input)
  await lockCommitment(tx, target.purchaseRecordId, target.id)
  const sale = (await loadSale(tx, target.id))!
  refundAuthority(actor, sale, input)
  const { reservation, inventoryLease } = sale
  const isAdvance = "reservationId" in input && openReservation(sale)
  const isLease =
    "saleCaseId" in input &&
    inventoryLease &&
    ["FINANCE_PENDING", "DO_RECEIVED"].includes(sale.state)
  if (!isAdvance && !isLease) fail("INVALID_STATE")
  const required = [
    caseRef(sale),
    cycleRef(sale.purchaseRecord),
    ...(reservation ? [reservationRef(reservation)] : []),
  ]
  for (const ref of required) requireRef(expected, ref)
  const credit = (reservation?.amount ?? 0n) + (inventoryLease?.down ?? 0n)
  const amount = BigInt(input.refund.amount)
  checkDate(
    input.refund.date,
    sale.purchaseRecord,
    isAdvance ? reservation!.placedDate : inventoryLease!.openedDate
  )
  if (
    amount > credit ||
    credit - amount !== BigInt(input.retainedAmount) ||
    (isLease && amount !== credit)
  )
    fail("BALANCE_MISMATCH", 422)
  return {
    sale,
    required,
    snapshot: {
      saleCaseId: sale.id,
      credit: credit.toString(),
      state: sale.state,
    },
  }
}

export async function applyRefund(
  tx: Tx,
  context: Context,
  sale: SaleRow,
  input: Refund
) {
  await resolveCancellation(tx, context, sale, input)
  return publishCommitment(tx, context, sale.purchaseRecord, sale.id, sale)
}

export function financeErrorAuthority(actor: Actor, sale: SaleRow) {
  authorizeSale(actor, sale, "cancelFinanceError")
  requireFields(actor.ability, "SaleCase", "read", saleAuth(sale), [
    "payments.id", "payments.amount", "payments.direction", "payments.date",
    "payments.method", "payments.category", "payments.reversalOf",
  ])
}

export async function prepareFinanceError(
  tx: Tx, actor: Actor, input: CancelFinanceError, expected: Dependency[], lock = true
) {
  const target = await findSaleTarget(tx, input)
  if (lock) await lockCommitment(tx, target.purchaseRecordId, target.id)
  const sale = (await loadSale(tx, target.id))!
  financeErrorAuthority(actor, sale)
  if (!sale.inventoryLease || !["FINANCE_PENDING", "DO_RECEIVED"].includes(sale.state) ||
      sale.completion || await tx.commissionEntitlement.findUnique({ where: { saleCaseId: sale.id } }))
    fail("INVALID_STATE")
  // A converted advance was real customer credit. Resolve it through the refund path.
  if (sale.reservation || sale.receipts.some((r) => r.category !== "DOWN_PAYMENT"))
    fail("OBLIGATION_OPEN")
  const reversed = new Set(sale.receipts.map((r) => r.reversalOf))
  const receipts = sale.receipts.filter((r) => r.direction === "IN" && !reversed.has(r.id))
  if (!receipts.length || input.receiptReversals.length !== receipts.length ||
      new Set(input.receiptReversals).size !== receipts.length ||
      receipts.some((r) => !input.receiptReversals.includes(r.id)))
    fail("BALANCE_MISMATCH", 422)
  const deps = [caseRef(sale), cycleRef(sale.purchaseRecord)]
  for (const ref of deps) requireRef(expected, ref)
  if (deps.length !== expected.length) fail("INVALID_INPUT", 422)
  return {
    sale,
    cycle: sale.purchaseRecord,
    deps,
    snapshot: {
      saleCaseId: sale.id,
      state: sale.state,
      downPayment: sale.inventoryLease.down.toString(),
      receiptReversals: receipts.map(({ id }) => id).sort(),
      doAttachmentId: sale.inventoryLease.doAttachmentId,
    },
  }
}

export async function applyFinanceError(
  tx: Tx, context: Context, sale: SaleRow, input: CancelFinanceError
) {
  for (const id of input.receiptReversals) {
    const original = sale.receipts.find((r) => r.id === id)!
    await tx.saleReceipt.create({
      data: {
        saleCaseId: sale.id,
        purchaseRecordId: sale.purchaseRecordId,
        amount: original.amount,
        direction: "OUT",
        category: "DOWN_PAYMENT",
        occurredDate: original.occurredDate,
        method: original.method,
        currency: original.currency,
        scale: original.scale,
        reference: original.reference,
        reversalOf: original.id,
        reason: input.reason,
        commandId: context.commandId,
        createdBy: ensureUser(context),
        lineKey: `rev:${original.id}`,
      },
    })
  }
  await resolveCancellation(tx, context, sale, { ...input, retainedAmount: "0" })
  return publishCommitment(tx, context, sale.purchaseRecord, sale.id, sale)
}

type OpeningInput = Input<"placeReservation"> | Input<"startFinance">
export type CommitmentDiscount =
  | { name: "placeReservation"; input: Input<"placeReservation"> }
  | { name: "startFinance"; input: Input<"startFinance"> }

export async function commitmentDiscountAuthority(
  tx: Tx,
  actor: Actor,
  row: Cycle,
  command: CommitmentDiscount,
  requesterId: string
) {
  const { input, name } = command
  authorizeCycle(actor, row)
  const customer = await tx.customer.findUnique({
    where: { id: input.customerId },
  })
  if (!customer) fail("NOT_FOUND", 404)
  requireFields(actor.ability, "Customer", "read", customer, [
    "id",
    "revision",
    "active",
  ])
  const subject = { createdBy: requesterId, customerId: customer.id }
  requireFields(actor.ability, "SaleCase", "create", subject, [
    name,
    "cycleId",
    "customerId",
    "price",
  ])
  authorizePayment(
    actor,
    subject,
    "receipt" in input ? input.receipt : input.downPayment
  )
  const settings = await currentSettings(tx)
  requireFields(actor.ability, "Settings", "read", settings, [
    "id",
    "revision",
    "policyVersion",
  ])
  if ("companyId" in input) {
    const company = await tx.financeCompany.findUnique({
      where: { id: input.companyId },
    })
    if (!company) fail("NOT_FOUND", 404)
    requireFields(actor.ability, "FinanceCompany", "read", company, [
      "id",
      "revision",
      "active",
      "name",
      "policy",
    ])
  }
}

async function openCommitment(
  tx: Tx,
  actor: Actor,
  options: {
    row: Cycle
    sale: SaleRow | null
    saleId: string
    name: string
    input: OpeningInput
    expected: Dependency[]
    context: Context
    dryRun?: boolean
    approvalId?: string
    historical?: HistoricalCommitment
  }
) {
  const {
    row,
    sale,
    saleId,
    name,
    input,
    expected,
    context,
    dryRun,
    approvalId,
    historical,
  } = options
  const initiatedBy = context.initiatedBy ?? actor.userId
  const customer = await tx.customer.findUnique({
    where: { id: input.customerId },
  })
  if (!customer) fail("NOT_FOUND", 404)
  requireFields(actor.ability, "Customer", "read", customer, [
    "id",
    "revision",
    "active",
  ])
  requireRef(expected, {
    type: "Customer",
    id: customer.id,
    revision: customer.revision,
  })
  if (!customer.active) fail("INVALID_STATE")
  const price = BigInt(input.price)
  const settings = await currentSettings(tx)
  requireFields(actor.ability, "Settings", "read", settings, [
    "id",
    "revision",
    "policyVersion",
  ])
  requireRef(expected, {
    type: "Settings",
    id: settings.id,
    revision: settings.revision,
  })
  if (sale) {
    if (
      !openReservation(sale) ||
      sale.customerId !== customer.id ||
      sale.agreedPrice !== price ||
      row.id !== input.cycleId
    )
      fail("INVALID_STATE")
    if (input.reference !== undefined && input.reference !== sale.reference) {
      requireFields(actor.ability, "SaleCase", "update", saleAuth(sale), [
        "patch.reference",
        "reason",
      ])
      if (!input.reason) fail("INVALID_INPUT", 422)
    }
  } else {
    checkStock(row)
    requireFields(
      actor.ability,
      "SaleCase",
      "create",
      { createdBy: initiatedBy, customerId: customer.id },
      [name, "cycleId", "customerId", "price"]
    )
    if (
      row.listedPrice !== null &&
      price < row.listedPrice &&
      !approvalId &&
      !historical?.approval &&
      !dryRun
    )
      fail("APPROVAL_REQUIRED")
    if (!dryRun)
      await tx.saleCase.create({
        data: {
          id: saleId,
          purchaseRecordId: row.id,
          customerId: customer.id,
          agreedPrice: price,
          listedSnapshot: row.listedPrice,
          legacyApproval: historical?.approval,
          kind: "receipt" in input ? "ADVANCE" : "LEASE",
          state: "receipt" in input ? "RESERVED" : "FINANCE_PENDING",
          reference: input.reference,
          openedAt: historical ? new Date(("receipt" in input ? input.receipt : input.downPayment).date) : new Date(),
          createdBy: initiatedBy,
          commandId: context.commandId,
          approvalId,
        },
      })
  }
  const payee = sale ?? { createdBy: initiatedBy, customerId: customer.id }
  const required: Dependency[] = [
    cycleRef(row),
    { type: "Customer", id: customer.id, revision: customer.revision },
    { type: "Settings", id: settings.id, revision: settings.revision },
  ]
  const snapshot = {
    cycleId: row.id,
    customerId: customer.id,
    listedPrice: row.listedPrice?.toString() ?? null,
    price: input.price,
  }
  if ("receipt" in input) {
    checkDate(input.receipt.date, row)
    authorizePayment(actor, payee, input.receipt)
    const amount = BigInt(input.receipt.amount)
    if (!row.listedPrice || amount > price ||
      (historical?.advance && BigInt(historical.advance.listedBasis) !== row.listedPrice))
      fail("INVALID_INPUT", 422)
    const { percentHundredths, expiresAt, warningAt, validThrough, ...tier } =
      calculateAdvanceValidity({
        advanceAmount: amount,
        listedPrice: row.listedPrice,
        agreedPrice: price,
        placedDate: input.receipt.date,
        timezone: historical?.advance?.policySnapshot.timezone ?? settings.timezone,
        leadDays: historical?.advance?.policySnapshot.leadDays ?? settings.warningLeadDays,
        tiers: historical?.advance?.policySnapshot.tiers ?? settings.tiers,
      })
    if (dryRun) return { row, required, snapshot }
    await tx.reservation.create({
      data: {
        saleCaseId: saleId,
        amount,
        placedDate: new Date(input.receipt.date),
        listedBasis: row.listedPrice,
        policySnapshot: {
          ...tier,
          ...historical?.advance?.policySnapshot,
          percentHundredths: percentHundredths.toString(),
          version: settings.policyVersion,
        },
        validThrough: new Date(historical?.advance?.validThrough ?? validThrough),
        expiresAt: historical?.advance ? new Date(historical.advance.expiresAt) : expiresAt,
        warningAt: historical?.advance
          ? localMidnightToUtc(addCalendarDays(historical.advance.validThrough, -tier.leadDays), tier.timezone)
          : warningAt,
        state: "ACTIVE",
      },
    })
    await recordPayment(tx, context, saleId, row.id, input.receipt, "ADVANCE")
    await transitionCommitment(
      tx,
      context,
      row,
      "ADVANCE_PLACED",
      new Date(input.receipt.date)
    )
  } else {
    const company = await tx.financeCompany.findUnique({
      where: { id: input.companyId },
      include: { currentPolicy: true },
    })
    if (!company) fail("NOT_FOUND", 404)
    requireFields(actor.ability, "FinanceCompany", "read", company, [
      "id",
      "revision",
      "active",
      "name",
      "policy",
    ])
    requireRef(expected, {
      type: "FinanceCompany",
      id: company.id,
      revision: company.revision,
    })
    if (!company.active || !company.currentPolicy) fail("INVALID_STATE")
    required.push({
      type: "FinanceCompany",
      id: company.id,
      revision: company.revision,
    })
    const down = BigInt(input.downPayment.amount),
      principal = BigInt(input.financeAmount)
    if (down + principal + (sale?.reservation?.amount ?? 0n) !== price)
      fail("BALANCE_MISMATCH", 422)
    checkDate(input.downPayment.date, row, sale?.reservation?.placedDate)
    authorizePayment(actor, payee, input.downPayment)
    if (dryRun) return { row, required, snapshot }
    if (sale) {
      await tx.saleCase.update({
        where: { id: saleId },
        data: {
          kind: "LEASE",
          state: "FINANCE_PENDING",
          reference: input.reference ?? sale.reference,
          revision: { increment: 1 },
        },
      })
      await tx.reservation.update({
        where: { id: sale.reservation!.id },
        data: {
          state: "CONVERTING",
          expiredAt: effectiveExpiry(sale.reservation!, historical ? new Date(input.downPayment.date) : undefined),
          revision: { increment: 1 },
        },
      })
    }
    await tx.inventoryLease.create({
      data: {
        saleCaseId: saleId,
        companyId: company.id,
        companyName: company.name,
        policySnapshot: {
          ...(company.currentPolicy.values as object),
          version: company.currentPolicy.version,
          policyVersionId: company.currentPolicy.id,
        },
        down,
        principal,
        termMonths: input.termMonths,
        openedDate: new Date(input.downPayment.date),
      },
    })
    await recordPayment(
      tx,
      context,
      saleId,
      row.id,
      input.downPayment,
      "DOWN_PAYMENT"
    )
    await transitionCommitment(
      tx,
      context,
      row,
      "FINANCE_PENDING",
      new Date(input.downPayment.date)
    )
  }
  return { row, required, snapshot }
}

export async function prepareCommitmentDiscount(
  tx: Tx,
  actor: Actor,
  command: CommitmentDiscount,
  expected: Dependency[],
  opts?: {
    context: Context
    approvalId: string
  }
) {
  const { input, name } = command
  if ("reservationId" in input && input.reservationId)
    fail("INVALID_INPUT", 422)
  await lockCommitment(tx, input.cycleId)
  const row = (await loadPurchase(tx, input.cycleId))!
  authorizeCycle(actor, row)
  requireRef(expected, cycleRef(row))
  if (row.listedPrice === null || BigInt(input.price) >= row.listedPrice)
    fail("INVALID_STATE")
  const saleId = randomUUID()
  const prepared = await openCommitment(tx, actor, {
    row,
    sale: null,
    saleId,
    name,
    input,
    expected,
    dryRun: !opts,
    approvalId: opts?.approvalId,
    context: opts?.context ?? {
      commandId: saleId,
      sequence: 0n,
      userId: actor.userId,
      action: name,
    },
  })
  if (opts) await publishCommitment(tx, opts.context, row, saleId, null)
  return { ...prepared, saleId }
}

export async function commitmentReplay(
  tx: Tx,
  actor: Actor,
  prior: Parameters<typeof saleReplay>[2]
) {
  const replay = await saleReplay(tx, actor, prior)
  const sale = (await loadSale(tx, replay.result.id))!
  const opening =
    ["placeReservation", "startFinance"].includes(prior.commandName) &&
    sale.commandId === prior.id
  requireFields(
    actor.ability,
    "SaleCase",
    opening ? "create" : "update",
    saleAuth(sale),
    [prior.commandName]
  )
  return replay
}
export async function executeCommitment<N extends CommitmentCommand>(
  identity: Identity,
  name: N,
  raw: unknown,
  existingTx?: Tx,
  historical?: HistoricalCommitment
): Promise<Applied> {
  if (historical && !existingTx) fail("INVALID_INPUT", 422)
  const envelopeSchema = name === "recordDO" && historical?.missingDeliveryOrder
    ? commitmentEnvelope("recordDO").extend({ input: commitmentInputs.recordDO.omit({ attachmentId: true }) })
    : commitmentEnvelope(name)
  const parsed = envelopeSchema.safeParse(raw)
  if (!parsed.success) fail("INVALID_INPUT", 422)
  const envelope = parsed.data
  const config = runtimeConfig()
  const digest = inputDigest(envelope, config.BETTER_AUTH_SECRET)
  return transaction(async (tx) => {
    const sequence = await nextBusinessSequence(tx)
    await tx.$queryRaw`SELECT vamotors.lock_admin_guard()`
    const actor = await currentActor(tx, identity)
    const scope = {
      environmentId: config.ENVIRONMENT_ID,
      actorKey: `USER:${actor.userId}`,
      commandName: name,
      idempotencyKey: envelope.idempotencyKey,
    }
    const prior = await tx.commandReceipt.findUnique({
      where: { environmentId_actorKey_commandName_idempotencyKey: scope },
    })
    if (prior) {
      if (prior.inputHash !== digest) fail("IDEMPOTENCY_MISMATCH")
      return commitmentReplay(tx, actor, prior)
    }
    const input = envelope.input as Input<CommitmentCommand>
    const target =
      "saleCaseId" in input || ("reservationId" in input && input.reservationId)
        ? await findSaleTarget(tx, input)
        : null
    const cycleId =
      target?.purchaseRecordId ??
      ("cycleId" in input ? input.cycleId : fail("NOT_FOUND", 404))
    await lockCommitment(tx, cycleId, target?.id)
    const row = (await loadPurchase(tx, cycleId))!
    const sale = target ? await loadSale(tx, target.id) : null
    const saleId = sale?.id ?? randomUUID()
    const expected = envelope.expected
    authorizeCycle(actor, row)
    requireRef(expected, cycleRef(row))
    if (sale) {
      authorizeSale(actor, sale, name)
      requireRef(expected, caseRef(sale))
      if (
        sale.reservation &&
        (openReservation(sale) || name === "confirmDOAndHandover")
      )
        requireRef(expected, reservationRef(sale.reservation))
    }
    const context: Context = {
      sequence,
      commandId: randomUUID(),
      userId: actor.userId,
      action: name,
      reason: "reason" in input ? input.reason : undefined,
    }
    const result = {
      type: "SaleCase" as const,
      id: saleId,
      revision: (sale?.revision ?? 0) + 1,
    }
    await tx.commandReceipt.create({
      data: {
        ...scope,
        id: context.commandId,
        inputHash: digest,
        businessSequence: sequence,
        result,
      },
    })
    if ("cycleId" in input) {
      await openCommitment(tx, actor, {
        row,
        sale,
        saleId,
        name,
        input,
        expected,
        context,
        historical,
      })
    } else {
      if (!sale) fail("NOT_FOUND", 404)
      switch (name) {
        case "convertReservation": {
          const conversion = input as Input<"convertReservation">
          if (!openReservation(sale)) fail("INVALID_STATE")
          checkDate(conversion.date, row, sale.reservation!.placedDate)
          const due = sale.agreedPrice - sale.reservation!.amount
          if (
            (conversion.balance ? BigInt(conversion.balance.amount) : 0n) !==
            due
          )
            fail("BALANCE_MISMATCH", 422)
          if (conversion.balance) {
            checkDate(
              conversion.balance.date,
              row,
              sale.reservation!.placedDate
            )
            if (conversion.balance.date > conversion.date)
              fail("INVALID_INPUT", 422)
            authorizePayment(actor, sale, conversion.balance)
            await recordPayment(
              tx,
              context,
              saleId,
              row.id,
              conversion.balance,
              "BALANCE"
            )
          }
          requireFields(
            actor.ability,
            "PurchaseRecord",
            "read",
            purchaseAuth(row),
            ["financial.basis", "mileage"]
          )
          await complete(tx, context, sale, conversion, historical)
          break
        }
        case "cancelRetained": {
          const cancellation = input as Input<"cancelRetained">
          if (!openReservation(sale)) fail("INVALID_STATE")
          const resolvedAt = historical?.resolutionDate
            ? new Date(historical.resolutionDate)
            : undefined
          if (historical?.resolutionDate)
            checkDate(historical.resolutionDate, row, sale.reservation!.placedDate)
          if (historical?.refund) {
            const refund = refundInput.parse({ ...cancellation, refund: historical.refund })
            await prepareRefund(tx, actor, refund, expected)
          } else if (BigInt(cancellation.retainedAmount) !== sale.reservation!.amount) {
            fail("BALANCE_MISMATCH", 422)
          }
          await resolveCancellation(tx, context, sale, {
            ...cancellation, refund: historical?.refund,
          }, resolvedAt)
          break
        }
        case "recordDO": {
          const delivery = input as Input<"recordDO">
          if (sale.state !== "FINANCE_PENDING" || !sale.inventoryLease)
            fail("INVALID_STATE")
          checkDate(delivery.issueDate, row, sale.inventoryLease.openedDate)
          let attachmentId: string | undefined
          if (!historical?.missingDeliveryOrder) {
            const attachment = await authorizedAttachment(tx, actor, delivery.attachmentId)
            if (attachment.saleCaseId !== sale.id || attachment.purpose !== "DO")
              fail("NOT_FOUND", 404)
            const upload = await tx.uploadIntent.findUniqueOrThrow({
              where: { id: attachment.uploadIntentId },
            })
            if (upload.capturedTargetRevision !== sale.revision)
              fail("STALE_REVISION")
            attachmentId = attachment.id
          }
          await tx.inventoryLease.update({
            where: { saleCaseId: sale.id },
            data: {
              doAttachmentId: attachmentId,
              issueDate: new Date(delivery.issueDate),
            },
          })
          await tx.saleCase.update({
            where: { id: sale.id },
            data: { state: "DO_RECEIVED", revision: { increment: 1 } },
          })
          await transitionCommitment(
            tx,
            context,
            row,
            "DO_RECEIVED",
            new Date(delivery.issueDate)
          )
          break
        }
        case "confirmDOAndHandover": {
          const handover = input as Input<"confirmDOAndHandover">
          if (sale.state !== "DO_RECEIVED" || !sale.inventoryLease?.issueDate)
            fail("INVALID_STATE")
          checkDate(handover.date, row, sale.inventoryLease.issueDate)
          requireFields(
            actor.ability,
            "PurchaseRecord",
            "read",
            purchaseAuth(row),
            ["financial.basis", "mileage"]
          )
          await complete(tx, context, sale, handover, historical)
          break
        }
        case "recordLenderReceipt": {
          const { payment } = input as Input<"recordLenderReceipt">
          if (
            sale.state !== "COMPLETED" ||
            !sale.inventoryLease ||
            !sale.completion
          )
            fail("INVALID_STATE")
          checkDate(payment.date, row, sale.inventoryLease.openedDate)
          if (payment.method === "CASH" && !payment.reference)
            fail("INVALID_INPUT", 422)
          if (
            lenderPaid(sale) + BigInt(payment.amount) >
            sale.inventoryLease.principal
          )
            fail("BALANCE_MISMATCH", 422)
          authorizePayment(actor, sale, payment)
          await checkIndependentLenderReceipt(tx, sale.inventoryLease.companyId, payment)
          await recordPayment(tx, context, sale.id, row.id, payment, "LENDER")
          await refreshLenderEntitlement(tx, sale.id, context)
          await tx.saleCase.update({
            where: { id: sale.id },
            data: { revision: { increment: 1 } },
          })
          break
        }
      }
    }
    const after = await publishCommitment(tx, context, row, saleId, sale)
    return {
      ok: true,
      status: "APPLIED",
      commandId: context.commandId,
      replayed: false,
      result,
      affected: [
        caseRef(after),
        cycleRef(after.purchaseRecord),
        ...(after.reservation ? [reservationRef(after.reservation)] : []),
      ],
      invalidate: [
        "sales",
        "inventory",
        "purchases",
        "customers",
        "notifications",
        ...(name === "recordLenderReceipt" ? (["finance", "reports"] as const) : []),
      ],
    }
  }, existingTx)
}
