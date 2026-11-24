import "server-only"
import { randomUUID } from "node:crypto"
import type { InvoiceVersion, Prisma } from "@prisma/client"
import type { Authority as Actor } from "./actor"
import type { Tx } from "./db"
import { runtimeConfig } from "./config"
import { CommandError, fail } from "./errors"
import { canonical } from "./idempotency"
import { audit } from "./audit"
import { requireFields } from "./permissions"
import { formatDate, purchaseAuth, purchaseVehicleAuth } from "./purchases"
import { newPrivateFinalKey } from "./private-files"
import type {
  InvoicePaymentLine,
  SaleInvoicePdfInput,
  SaleInvoiceTransaction,
} from "./pdf"
import { lenderPaid, type SaleRow } from "./sales"
import type { currentSettings } from "./settings"

type InvoiceSnapshot = {
  templateVersion: 1 | 2
  settingsVersion: number
  scale: 2
  remittanceIds?: string[]
  customerId: string
  saleFields: string[]
  pdf: Omit<
    SaleInvoicePdfInput,
    "invoiceNumber" | "version" | "issuedDate" | "issuedBy"
  >
}

type SaleTypeAdapter = {
  fields: readonly string[]
  transaction: (sale: SaleRow) => SaleInvoiceTransaction
}

const receiptFields = [
  "payments.amount",
  "payments.date",
  "payments.method",
  "payments.reference",
]

function paymentLines(sale: SaleRow, category: string): InvoicePaymentLine[] {
  const reversed = new Set(sale.receipts.map((receipt) => receipt.reversalOf))
  return sale.receipts.flatMap((receipt) => {
    if (
      receipt.category !== category ||
      receipt.direction !== "IN" ||
      receipt.reversalOf ||
      reversed.has(receipt.id)
    )
      return []
    if (receipt.method !== "CASH" && receipt.method !== "BANK_TRANSFER")
      fail("INVALID_STATE")
    return [
      {
        amount: receipt.amount.toString(),
        date: formatDate(receipt.occurredDate),
        method: receipt.method,
        reference: receipt.reference,
      },
    ]
  })
}

function singlePayment(sale: SaleRow, category = "SALE") {
  const lines = paymentLines(sale, category)
  if (lines.length > 1) fail("INVALID_STATE")
  return lines[0] ?? null
}

async function lenderRemittances(tx: Tx, sale: SaleRow) {
  if (!sale.inventoryLease || !sale.entitlement?.allocations.length) return []
  const allocations = await tx.commissionAllocation.findMany({
    where: {
      entitlement: { saleCaseId: sale.id },
      reversalOf: null,
      reversal: null,
    },
    include: {
      discrepancies: { where: { resolution: "CARRY_CREDIT" } },
      remittance: {
        include: {
          payments: {
            where: {
              category: "REMITTANCE_RECEIPT",
              reversalOf: null,
              reversal: null,
            },
          },
        },
      },
    },
    orderBy: [{ recordedAt: "asc" }, { id: "asc" }],
  })
  return allocations.flatMap(({ amount, discrepancies, remittance }) => {
    const payment = remittance.payments[0]
    const applied = discrepancies.reduce(
      (total, discrepancy) => total + discrepancy.expectedMinusAllocated,
      amount
    )
    if (!payment || applied <= 0n) return []
    if (payment.method !== "CASH" && payment.method !== "BANK_TRANSFER")
      fail("INVALID_STATE")
    return [
      {
        id: remittance.id,
        line: {
          amount: applied.toString(),
          date: formatDate(payment.occurredDate),
          method: payment.method,
          reference: payment.reference,
          label: "Lender Remittance Allocation",
        } satisfies InvoicePaymentLine,
      },
    ]
  })
}

const adapters: Partial<Record<string, SaleTypeAdapter>> = {
  CASH: {
    fields: receiptFields,
    transaction(sale) {
      const payment = singlePayment(sale)
      if (!payment) fail("INVALID_STATE")
      return {
        kind: "CASH",
        agreedPrice: sale.agreedPrice.toString(),
        payment,
        totalReceived: payment.amount,
      }
    },
  },
  ADVANCE: {
    fields: [...receiptFields, "payments.category"],
    transaction(sale) {
      const advanceReceipts = paymentLines(sale, "ADVANCE")
      const conversionBalance = singlePayment(sale, "BALANCE")
      return {
        kind: "ADVANCE",
        agreedPrice: sale.agreedPrice.toString(),
        advanceReceipts,
        conversionBalance,
        totalReceived: [
          ...advanceReceipts,
          ...(conversionBalance ? [conversionBalance] : []),
        ]
          .reduce((total, line) => total + BigInt(line.amount), 0n)
          .toString(),
      }
    },
  },
  LEASE: {
    fields: [
      ...receiptFields,
      "payments.category",
      "finance.companyName",
      "finance.principal",
      "finance.termMonths",
      "finance.issueDate",
      "finance.lenderOutstanding",
    ],
    transaction(sale) {
      const lease = sale.inventoryLease
      const downPayment = singlePayment(sale, "DOWN_PAYMENT")
      if (!lease?.issueDate || !downPayment) fail("INVALID_STATE")
      const received = lenderPaid(sale)
      const outstanding = lease.principal - received
      return {
        kind: "LEASE",
        agreedPrice: sale.agreedPrice.toString(),
        advanceReceipts: paymentLines(sale, "ADVANCE"),
        downPayment,
        financeCompanyName: lease.companyName,
        financedAmount: lease.principal.toString(),
        termMonths: lease.termMonths,
        doIssueDate: formatDate(lease.issueDate),
        lenderSettlementStatus:
          outstanding === 0n
            ? "Settled"
            : received === 0n
              ? "Pending"
              : "Partially settled",
        lenderReceived: received.toString(),
        lenderOutstanding: outstanding.toString(),
        lenderReceipts: paymentLines(sale, "LENDER"),
      }
    },
  },
  TRADE_IN: {
    fields: [...receiptFields, "tradeIn.description", "tradeIn.value"],
    transaction(sale) {
      if (!sale.tradeIn) fail("INVALID_STATE")
      const netBalance = singlePayment(sale)
      return {
        kind: "TRADE_IN",
        agreedPrice: sale.agreedPrice.toString(),
        tradeInDescription: sale.tradeIn.description,
        tradeInValue: sale.tradeIn.value.toString(),
        netBalance,
        totalCashReceived: netBalance?.amount ?? "0",
      }
    },
  },
}

async function invoiceTransaction(
  tx: Tx,
  sale: SaleRow,
  adapter: SaleTypeAdapter
) {
  const transaction = adapter.transaction(sale)
  const remittances =
    transaction.kind === "LEASE" ? await lenderRemittances(tx, sale) : []
  if (transaction.kind === "LEASE") {
    transaction.lenderReceipts = [
      ...(transaction.lenderReceipts ?? []),
      ...remittances.map(({ line }) => line),
    ].sort((a, b) => a.date.localeCompare(b.date))
  }
  return { transaction, remittances }
}

export async function pendingInvoiceCurrent(
  tx: Tx,
  sale: SaleRow,
  row: InvoiceVersion
) {
  if (sale.kind !== "LEASE" || row.generationAt) return true
  const snapshot = snapshotOf(row)
  const { transaction } = await invoiceTransaction(tx, sale, adapters.LEASE!)
  return canonical(snapshot.pdf.transaction) === canonical(transaction)
}

const vehicleFields = [
  "make",
  "model",
  "year",
  "colour",
  "engineNumber",
  "chassisNumber",
  "fuelType",
  "transmission",
  "vin",
  "crNumber",
] as const
const buyerFields = ["fullName", "nicOrPassport", "address", "phone"] as const
const pick = <T, K extends keyof T>(row: T, keys: readonly K[]) =>
  Object.fromEntries(keys.map((key) => [key, row[key]])) as Pick<T, K>

const declarations = [
  "The seller declares ownership of the vehicle described above.",
  "The seller declares that the vehicle is free from encumbrances except as disclosed in the transaction terms.",
  "Risk, liability and responsibility pass to the buyer upon handover of the vehicle.",
]

const adapterFor = (kind: string) =>
  Object.hasOwn(adapters, kind) ? adapters[kind] : undefined
export const invoiceSupported = (sale: SaleRow) =>
  sale.state === "COMPLETED" && !!sale.completion && !!adapterFor(sale.kind)

function sourceFields(sale: SaleRow) {
  return [
    "id",
    "revision",
    "invoices",
    "customerId",
    "state",
    "kind",
    "price",
    "reference",
    "completion.date",
    "completion.mileage",
    ...(adapterFor(sale.kind)?.fields ?? []),
  ]
}

export async function authorizeInvoice(
  tx: Tx,
  actor: Actor,
  sale: SaleRow,
  action: "read" | "create",
  snapshot?: InvoiceSnapshot
) {
  const saleScope = { createdBy: sale.createdBy, customerId: sale.customerId }
  requireFields(actor.ability, "SaleCase", "read", saleScope, [
    "id",
    "invoices",
  ])
  const documentScope = { createdBy: sale.createdBy }
  requireFields(actor.ability, "Document", "read", documentScope, [
    "filename",
    "contentType",
    "bytes",
  ])
  if (action === "create") {
    requireFields(actor.ability, "Document", "create", documentScope, [
      "target",
      "purpose",
    ])
    requireFields(
      actor.ability,
      "PurchaseRecord",
      "read",
      purchaseAuth(sale.purchaseRecord),
      ["id", "revision"]
    )
  }
  const remittanceIds = snapshot
    ? (snapshot.remittanceIds ?? [])
    : (await lenderRemittances(tx, sale)).map(({ id }) => id)
  if (remittanceIds.length) {
    const rows = await tx.remittance.findMany({
      where: { id: { in: remittanceIds } },
      select: { companyId: true },
    })
    if (rows.length !== new Set(remittanceIds).size) fail("NOT_FOUND", 404)
    for (const row of rows)
      requireFields(
        actor.ability,
        "Remittance",
        "read",
        { financeCompanyId: row.companyId },
        [
          "id",
          "allocations",
          "payments.date",
          "payments.method",
          "payments.reference",
        ]
      )
  }
  const buyerId = snapshot?.customerId ?? sale.customerId
  requireFields(
    actor.ability,
    "SaleCase",
    "read",
    { ...saleScope, customerId: buyerId },
    snapshot?.saleFields ?? sourceFields(sale)
  )
  const buyer =
    buyerId === sale.customerId
      ? sale.customer
      : await tx.customer.findUnique({ where: { id: buyerId } })
  if (!buyer) fail("NOT_FOUND", 404)
  requireFields(actor.ability, "Customer", "read", buyer, buyerFields)
  requireFields(
    actor.ability,
    "Vehicle",
    "read",
    purchaseVehicleAuth(sale.purchaseRecord),
    vehicleFields.map((field) => `identity.${field}`)
  )
}

export function snapshotOf(
  invoice: Pick<InvoiceVersion, "snapshot">
): InvoiceSnapshot {
  // This payload is generated exclusively by queueInvoice and retained as-is.
  return invoice.snapshot as unknown as InvoiceSnapshot
}

export function invoiceSummary(row: InvoiceVersion) {
  return {
    id: row.id,
    revision: row.revision,
    version: row.version,
    saleRevision: row.saleRevision,
    number: row.number,
    state: row.state as "PENDING" | "FAILED" | "READY",
  }
}

export async function invoiceDetail(
  tx: Tx,
  actor: Actor,
  sale: SaleRow,
  projected: Record<string, unknown>
) {
  if (!invoiceSupported(sale) || !("invoices" in projected)) return projected
  const permits = async (
    action: "read" | "create",
    snapshot?: InvoiceSnapshot
  ) => {
    try {
      await authorizeInvoice(tx, actor, sale, action, snapshot)
      return true
    } catch (error) {
      if (error instanceof CommandError && [403, 404].includes(error.status))
        return false
      throw error
    }
  }
  const canReadCurrent = await permits("read")
  const versions = await tx.invoiceVersion.findMany({
    where: { completionId: sale.completion!.id },
    orderBy: { version: "desc" },
  })
  const invoices = []
  for (const version of versions) {
    const snapshot = snapshotOf(version)
    if (
      (snapshot.customerId === sale.customerId &&
        version.saleRevision === sale.revision &&
        canReadCurrent) ||
      (await permits("read", snapshot))
    )
      invoices.push(invoiceSummary(version))
  }
  if ("nextActions" in projected && canReadCurrent && (await permits("create")))
    (projected.nextActions as string[]).push("issueInvoice")
  return { ...projected, invoices }
}

export async function queueInvoice(
  tx: Tx,
  sale: SaleRow,
  settings: Awaited<ReturnType<typeof currentSettings>>,
  actorId: string,
  commandId: string,
  sequence: bigint,
  prior?: InvoiceVersion | null,
  invoiceId: string = randomUUID()
) {
  const adapter = adapterFor(sale.kind)
  if (sale.state !== "COMPLETED" || !sale.completion || !adapter) return null
  const completion = sale.completion
  const correction = sale.corrections.at(-1)
  const corrected = correction?.correctedSnapshot as
    | { saleDate?: string; handoverMileage?: number }
    | undefined
  const saleDate = corrected?.saleDate ?? formatDate(completion.saleDate)
  const version = (prior?.version ?? 0) + 1
  const numberRoot =
    prior?.number.replace(/-v\d+$/, "") ??
    `DEV-${saleDate.slice(0, 4)}-${sequence.toString().padStart(6, "0")}`
  const { transaction, remittances } = await invoiceTransaction(
    tx,
    sale,
    adapter
  )
  const snapshot: InvoiceSnapshot = {
    templateVersion: 2,
    settingsVersion: settings.policyVersion,
    scale: settings.scale,
    ...(remittances.length
      ? { remittanceIds: [...new Set(remittances.map(({ id }) => id))] }
      : {}),
    customerId: sale.customerId,
    saleFields: sourceFields(sale),
    pdf: {
      saleDate,
      currency: settings.currency,
      saleReference: sale.reference,
      seller: settings.company,
      buyer: pick(sale.customer, buyerFields),
      vehicle: {
        ...pick(sale.purchaseRecord.vehicle, vehicleFields),
        handoverMileage:
          corrected?.handoverMileage ?? completion.handoverMileage,
      },
      transaction,
      declarations: [
        ...declarations,
        ...settings.declarations.map((line) => line.replace(/\s+/g, " ")),
      ],
      ...(prior
        ? {
            restatement: {
              priorVersion: prior.version,
              priorInvoiceNumber: prior.number,
              reason:
                correction && correction.id !== prior.correctionId
                  ? "Approved sale correction"
                  : "Invoice regenerated",
            },
          }
        : {}),
    },
  }
  const row = await tx.invoiceVersion.create({
    data: {
      id: invoiceId,
      completionId: completion.id,
      correctionId: correction?.id,
      version,
      saleRevision: sale.revision,
      number: `${numberRoot}-v${version}`,
      snapshot: snapshot as unknown as Prisma.InputJsonObject,
      finalKey: newPrivateFinalKey(
        runtimeConfig().ENVIRONMENT_ID,
        invoiceId,
        commandId
      ),
    },
  })
  await auditInvoice(tx, actorId, commandId, "queueInvoice", null, row)
  return row
}

export function auditInvoice(
  tx: Tx,
  actorId: string,
  commandId: string,
  action: string,
  before: InvoiceVersion | null,
  after: InvoiceVersion
) {
  return audit(tx, {
    commandId,
    userId: actorId,
    entityType: "InvoiceVersion",
    entityId: after.id,
    action,
    before: before && invoiceSummary(before),
    after: invoiceSummary(after),
  })
}
