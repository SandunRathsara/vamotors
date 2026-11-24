import "server-only"
import type { Prisma } from "@prisma/client"
import type { Tx } from "./db"
import { fieldsFor, readScope, type EnabledSubject } from "./permissions"
import { canonical } from "./idempotency"
import { fail } from "./errors"
import type { Authority } from "./actor"
import { dateOnly } from "./validators"
import { z } from "zod"

export const auditFilterInputs = {
  from: dateOnly.optional(),
  through: dateOnly.optional(),
  action: z.string().trim().min(1).max(100).optional(),
}

export function auditScope(
  actor: Authority,
  { from, through, action }: { from?: string; through?: string; action?: string }
): Prisma.AuditEntryWhereInput {
  if (from && through && from > through) fail("INVALID_INPUT", 422)
  const until = through ? new Date(through) : undefined
  if (until) until.setUTCDate(until.getUTCDate() + 1)
  return {
    ...readScope(actor.grants, actor.userId, "AuditLog", [
      "id",
      "at",
      ...(action ? ["action"] : []),
    ]),
    ...(action ? { action } : {}),
    ...(from || until
      ? { recordedAt: { gte: from ? new Date(from) : undefined, lt: until } }
      : {}),
  }
}

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

export const joinAuditFields = {
  UserRole: ["userId", "roleId", "assignedBy", "assignedAt"],
  RolePermission: ["roleId", "permissionId"],
} as const

/** Audit only DTO fields; credentials/hashes/tokens can never be named. */
function diffFields(
  fields: readonly string[],
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null
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
    entityType:
      | EnabledSubject
      | "SaleCompletion"
      | "InvoiceVersion"
      | "ExportJob"
      | keyof typeof joinAuditFields
    entityId: string
    action: string
    reason?: string
    initiatedBy?: string
    approverId?: string
    before: Record<string, unknown> | null
    after: Record<string, unknown> | null
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
      fieldDiff: diffFields(
        input.entityType === "SaleCompletion"
          ? saleCompletionFields
          : input.entityType === "InvoiceVersion"
            ? ["id", "revision", "version", "saleRevision", "number", "state"]
            : input.entityType === "ExportJob"
              ? ["revision", "state", "renderedRows"]
              : input.entityType === "UserRole" || input.entityType === "RolePermission"
                ? joinAuditFields[input.entityType]
                : input.entityType === "FinanceCompany"
                  ? [...fieldsFor("FinanceCompany", "read"), "reconciliationWatermark"]
                  : fieldsFor(input.entityType, "read"),
        input.before,
        input.after
      ),
    },
  })
}

/** Five nonfinancial templates only; no caller-supplied message material. */
export async function notify(
  tx: Tx,
  context: { commandId: string; userId: string | null },
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
  const [created] = await tx.notification.createManyAndReturn({
    data: input,
    skipDuplicates: true,
  })
  if (!created) return
  await audit(tx, {
    ...context,
    entityType: "Notification",
    entityId: created.id,
    action: "createNotification",
    before: null,
    after: {
      id: created.id,
      revision: created.revision,
      kind: created.kind,
      createdAt: created.createdAt.toISOString(),
      target: { type: created.targetType, id: created.targetId },
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
