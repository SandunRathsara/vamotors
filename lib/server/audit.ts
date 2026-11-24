import "server-only"
import type { Prisma } from "@prisma/client"
import type { Tx } from "./db"
import { fieldsFor, type EnabledSubject } from "./permissions"
import { canonical } from "./idempotency"
import { fail } from "./errors"

const saleCompletionFields = [
  "id",
  "saleCaseId",
  "purchaseRecordId",
  "date",
  "handoverMileage",
  "agreedPrice",
  "basisVersionId",
  "originalProfit",
] as const

/** Audit only DTO fields; credentials/hashes/tokens can never be named. */
function diffFields(
  fields: readonly string[],
  before: Record<string, unknown> | null,
  after: Record<string, unknown>
) {
  const diff: Record<string, { before: unknown; after: unknown }> = {}
  for (const key of fields) {
    const value = (row: Record<string, unknown> | null) =>
      key
        .split(".")
        .reduce<unknown>(
          (current, part) =>
            current && typeof current === "object"
              ? (current as Record<string, unknown>)[part]
              : undefined,
          row
        ) ?? null
    const old = value(before)
    const next = value(after)
    if (canonical(old) !== canonical(next))
      diff[key] = { before: old, after: next }
  }
  return diff as Prisma.InputJsonObject
}
export function fieldDiff(
  type: EnabledSubject,
  before: Record<string, unknown> | null,
  after: Record<string, unknown>
) {
  return diffFields(fieldsFor(type, "read"), before, after)
}
export async function audit(
  tx: Tx,
  input: {
    commandId: string
    userId: string | null
    entityType: EnabledSubject | "SaleCompletion"
    entityId: string
    action: string
    reason?: string
    initiatedBy?: string
    approverId?: string
    before: Record<string, unknown> | null
    after: Record<string, unknown>
  }
) {
  return tx.auditEntry.create({
    data: {
      commandId: input.commandId,
      userId: input.userId,
      entityType: input.entityType,
      entityId: input.entityId,
      actorKind: input.userId ? "USER" : "SYSTEM",
      systemScope: input.userId ? null : "RESERVATION_EXPIRY",
      action: input.action,
      reason: input.reason,
      initiatedBy: input.initiatedBy,
      approverId: input.approverId,
      fieldDiff:
        input.entityType === "SaleCompletion"
          ? diffFields(saleCompletionFields, input.before, input.after)
          : fieldDiff(input.entityType, input.before, input.after),
    },
  })
}

/** Five nonfinancial templates only; no caller-supplied message material. */
export async function notify(
  tx: Tx,
  input: {
    recipientUserId: string
    eventKey: string
    kind:
      | "ADVANCE_EXPIRING"
      | "ADVANCE_EXPIRED"
      | "REPAIR_RETURNED"
      | "APPROVAL_REQUIRED"
      | "APPROVAL_OUTCOME"
    targetType: string
    targetId: string
  }
) {
  await tx.notification.createMany({ data: input, skipDuplicates: true })
  return tx.notification.findUniqueOrThrow({
    where: {
      recipientUserId_eventKey: {
        recipientUserId: input.recipientUserId,
        eventKey: input.eventKey,
      },
    },
  })
}

/** Essential version writes use allowlisted report DTOs, never raw entities. */
export async function writeReadVersion(
  tx: Tx,
  input: {
    commandId: string
    sequence: bigint
    entityType:
      | "Vehicle"
      | "PurchaseRecord"
      | "Customer"
      | "Supplier"
      | "RepairVendor"
      | "FinanceCompany"
      | "Settings"
      | "RateSheet"
      | "Quote"
      | "ImportBatch"
      | "Document"
      | "RepairRecord"
      | "ApprovalRequest"
      | "BrokerageDeal"
      | "CashFacility"
      | "DispatchBatch"
      | "CommissionEntitlement"
      | "SaleCase"
      | "SaleCompletion"
      | "Reservation"
    entityId: string
    revision: number
    payload: Record<string, unknown>
  }
) {
  const allowed =
    input.entityType === "SaleCompletion"
      ? [
          "id",
          "saleCaseId",
          "purchaseRecordId",
          "date",
          "handoverMileage",
          "agreedPrice",
          "basisVersionId",
          "originalProfit",
        ]
      : fieldsFor(input.entityType, "read")
  if (
    Object.keys(input.payload).some(
      (k) =>
        !allowed.includes(k) &&
        !allowed.some((path) => path.startsWith(`${k}.`))
    )
  )
    fail("INVALID_INPUT", 422)
  return tx.entityReadVersion.create({
    data: { ...input, payload: input.payload as Prisma.InputJsonObject },
  })
}
