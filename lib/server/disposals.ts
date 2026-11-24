import "server-only"
import { randomUUID } from "node:crypto"
import { subject } from "@casl/ability"
import type { Prisma, PurchaseRecord, Vehicle } from "@prisma/client"
import type {
  ApprovalProvenance,
  PurchaseCycleDTO,
  WriteOff,
} from "../../.planning/implementation/contracts/api"
import type { Tx } from "./db"
import type { Authority } from "./actor"
import { project, sourcePaymentFields, requireFields } from "./permissions"
import { fail } from "./errors"
import { bounded, C } from "../money"

export const writeOffFields = (input: WriteOff) => [
  "cycleId",
  "date",
  "reason",
  "method",
  "proceeds",
  ...Object.keys(input.receipt ?? {}).map((f) => `receipt.${f}`),
]
export const valueAt = (value: unknown, path: string) =>
  path
    .split(".")
    .reduce<unknown>(
      (v, k) =>
        v && typeof v === "object"
          ? (v as Record<string, unknown>)[k]
          : undefined,
      value
    )
export function requireWriteOffRead(
  purchase: Record<string, unknown>,
  visible: Record<string, unknown>
) {
  for (const f of [
    "id",
    "revision",
    "vehicleId",
    "identityRevision",
    "status",
    "available",
    "closedAt",
    "purchaseDate",
    "purchasePrice",
    "purchaseType",
    "financial.basis",
    "financial.currency",
    "financial.scale",
    "financial.cashIn",
    "financial.cashOut",
    ...Object.keys((purchase.settlement as object | undefined) ?? {}).map(
      (key) => `settlement.${key}`
    ),
    ...(purchase.listedPrice !== undefined ? ["listedPrice"] : []),
  ]) {
    if (valueAt(visible, f) === undefined) fail("FIELD_FORBIDDEN", 403)
  }
  const basis = visible.basisVersions as Record<string, unknown>[] | undefined
  if (!basis?.length || !basis.every((b) => b.id && b.total !== undefined))
    fail("FIELD_FORBIDDEN", 403)
  const cashReadable = (source: unknown, projected: unknown) => {
    const payments = source as unknown[]
    const shown = projected as Record<string, unknown>[] | undefined
    if (
      payments.length &&
      (shown?.length !== payments.length ||
        !shown.every(
          (p) => p.amount !== undefined && p.direction !== undefined
        ))
    )
      fail("FIELD_FORBIDDEN", 403)
  }
  cashReadable(purchase.payments, visible.payments)
  ;(purchase.costs as Record<string, unknown>[]).forEach((cost, index) =>
    cashReadable(
      cost.payments,
      (visible.costs as Record<string, unknown>[] | undefined)?.[index]
        ?.payments
    )
  )
  const repairs = (purchase.repairs ?? []) as Record<string, unknown>[]
  const shown = visible.repairs as Record<string, unknown>[] | undefined
  if (repairs.length && shown?.length !== repairs.length)
    fail("FIELD_FORBIDDEN", 403)
  for (const repair of repairs) {
    const current = shown?.find((r) => r.id === repair.id)
    if (
      !current ||
      (repair.returnedDate !== undefined &&
        (current.returnedDate === undefined ||
          current.invoiceAmount === undefined))
    )
      fail("FIELD_FORBIDDEN", 403)
    cashReadable(repair.payments, current.payments)
  }
}
/** Shared execution/nextActions capability check; state/CAS stay with the owner. */
export function requireWriteOffAuthority(
  actor: Authority,
  purchase: Record<string, unknown>,
  vehicle: Record<string, unknown>,
  visible: Record<string, unknown>,
  input: WriteOff,
  request = false
) {
  requireFields(actor.ability, "PurchaseRecord", "read", purchase, [
    "id",
    "revision",
    "vehicleId",
    "identityRevision",
  ])
  requireFields(actor.ability, "Vehicle", "read", vehicle, [
    "id",
    "identityRevision",
  ])
  requireWriteOffRead(purchase, visible)
  requireFields(actor.ability, "PurchaseRecord", "update", purchase, [
    "cycleId",
  ])
  const candidate = { ...input, createdBy: actor.userId }
  requireFields(
    actor.ability,
    "Disposal",
    "create",
    candidate,
    writeOffFields(input)
  )
  if (input.receipt)
    requireFields(
      actor.ability,
      "Disposal",
      "pay",
      candidate,
      Object.keys(input.receipt).map((f) => `receipt.${f}`)
    )
  if (request)
    requireFields(
      actor.ability,
      "ApprovalRequest",
      "create",
      { createdBy: actor.userId },
      [
        "proposal",
        "proposal.kind",
        ...writeOffFields(input).map((f) => `proposal.input.${f}`),
        "reason",
      ]
    )
}

export const disposalInclude = {
  approval: { include: { reviewer: true } },
  payments: {
    orderBy: [{ occurredDate: "asc" as const }, { id: "asc" as const }],
  },
} satisfies Prisma.DisposalInclude
export type DisposalRow = Prisma.DisposalGetPayload<{
  include: typeof disposalInclude
}>
/** Only an actual approved CURRENT write-off supports old financial owners.
 * This is not a terminal-state waiver, and never reopens its physical pointer. */
export function currentWrittenOff(
  row: Pick<PurchaseRecord, "id" | "status" | "closedAt" | "available"> & {
    vehicle: Pick<Vehicle, "activePurchaseId">
    disposal: DisposalRow | null
  }
) {
  const d = row.disposal,
    a = d?.approval
  return !!(
    row.status === "WRITTEN_OFF" &&
    row.closedAt &&
    !row.available &&
    row.vehicle.activePurchaseId === null &&
    d?.approvalKind === "CURRENT" &&
    d.cycleId === row.id &&
    a?.kind === "WRITE_OFF" &&
    a.state === "APPROVED" &&
    a.cycleId === row.id &&
    a.appliedCommandId === d.commandId &&
    a.reviewCommandId === d.commandId &&
    a.reviewedAt?.getTime() === row.closedAt.getTime()
  )
}
export function disposalDTO(
  row: DisposalRow
): NonNullable<PurchaseCycleDTO["disposal"]> {
  const a = row.approval
  let approval: ApprovalProvenance
  if (row.approvalKind === "IMPORTED" && row.importedApproval) {
    approval = row.importedApproval as Extract<
      ApprovalProvenance,
      { kind: "IMPORTED" }
    >
  } else {
    if (!a?.reviewedBy || !a.reviewedAt || !a.reviewer)
      fail("INTERNAL_ERROR", 500)
    approval = {
      kind: "CURRENT",
      approvalId: a.id,
      reviewerId: a.reviewedBy,
      reviewerName: a.reviewerName!,
      reviewedAt: a.reviewedAt.toISOString(),
    }
  }
  return {
    id: row.id,
    date: row.occurredDate.toISOString().slice(0, 10),
    reason: row.reason,
    method: row.method as WriteOff["method"],
    proceeds: row.proceeds.toString(),
    basisVersionId: row.basisVersionId,
    approval,
    payments: row.payments.map((p) => ({
      id: p.id,
      owner: { type: "DISPOSAL", id: row.id },
      commandId: p.commandId,
      amount: p.amount.toString(),
      direction: "IN",
      category: p.category,
      date: p.occurredDate.toISOString().slice(0, 10),
      method: p.method as "CASH" | "BANK_TRANSFER",
      recordedAt: p.recordedAt.toISOString(),
      ...(p.reference !== null ? { reference: p.reference } : {}),
    })),
  }
}
export const disposalAuth = (row: DisposalRow) => ({
  ...disposalDTO(row),
  createdBy: row.createdBy,
})
export function visibleDisposal(actor: Authority, row: DisposalRow) {
  const auth = disposalAuth(row),
    record = subject("Disposal", auth)
  if (!actor.ability.can("read", record)) return null
  const result = project(actor.ability, "Disposal", auth)
  const dto = disposalDTO(row)
  if (
    sourcePaymentFields.some((f) =>
      actor.ability.can("read", record, `payments.${f}`)
    )
  )
    result.payments = dto.payments.map((p) => {
      const output: Record<string, unknown> = {}
      for (const f of sourcePaymentFields) {
        if (!actor.ability.can("read", record, `payments.${f}`)) continue
        const [first, second] = f.split(".")
        const value = second
          ? (p[first as keyof typeof p] as Record<string, unknown>)[second]
          : p[first as keyof typeof p]
        if (value === undefined) continue
        if (second)
          output[first] = { ...(output[first] as object), [second]: value }
        else output[first] = value
      }
      return output
    })
  else {
    delete result.payments
    result.redactedFields.push("payments")
  }
  result.redactedFields = result.redactedFields.filter((f) => f !== "createdBy")
  return result
}

/** Only reviewApproval calls this owner, with its caller transaction and locked saved input. */
export async function applyApprovedWriteOff(
  tx: Tx,
  context: {
    cycleId: string
    vehicleId: string
    approvalId?: string
    importedApproval?: Extract<ApprovalProvenance, { kind: "IMPORTED" }>
    disposalId?: string
    commandId: string
    reviewerId: string
    input: WriteOff
    basisVersionId: string
    basis: bigint
    cashIn: bigint
    cashOut: bigint
    currency: string
    scale: number
    reviewedAt: Date
  }
) {
  const { input, reviewerId, commandId } = context
  const now = context.reviewedAt,
    id = context.disposalId ?? randomUUID()
  bounded(context.basis, C)
  bounded(context.cashIn + BigInt(input.proceeds), C)
  bounded(context.cashOut, C)
  await tx.purchaseRecord.update({
    where: { id: context.cycleId },
    data: {
      status: "WRITTEN_OFF",
      available: false,
      holdReason: null,
      closedAt: now,
      revision: { increment: 1 },
    },
  })
  await tx.vehicle.update({
    where: { id: context.vehicleId },
    data: { activePurchaseId: null, revision: { increment: 1 } },
  })
  await tx.disposal.create({
    data: {
      id,
      cycleId: context.cycleId,
      approvalId: context.approvalId,
      approvalKind: context.importedApproval ? "IMPORTED" : "CURRENT",
      importedApproval: context.importedApproval,
      occurredDate: new Date(input.date),
      reason: input.reason,
      method: input.method,
      proceeds: BigInt(input.proceeds),
      basisVersionId: context.basisVersionId,
      netLoss: context.basis - BigInt(input.proceeds),
      createdBy: reviewerId,
      commandId,
    },
  })
  if (input.receipt)
    await tx.disposalReceipt.create({
      data: {
        id: randomUUID(),
        disposalId: id,
        cycleId: context.cycleId,
        amount: BigInt(input.receipt.amount),
        direction: "IN",
        category: "DISPOSAL",
        occurredDate: new Date(input.receipt.date),
        method: input.receipt.method,
        reference: input.receipt.reference,
        currency: context.currency,
        scale: context.scale,
        commandId,
        lineKey: "proceeds",
      },
    })
  return id
}
