import "server-only"
import type { Prisma } from "@prisma/client"
import type { Tx } from "./db"
import { fieldsFor, type EnabledSubject } from "./permissions"
import { canonical } from "./idempotency"
import { fail } from "./errors"

/** Audit only DTO fields; credentials/hashes/tokens can never be named. */
export function fieldDiff(
  type: EnabledSubject,
  before: Record<string, unknown> | null,
  after: Record<string, unknown>
) {
  const diff: Record<string, { before: unknown; after: unknown }> = {}
  for (const key of fieldsFor(type, "read")) {
    if (key.includes(".")) continue
    const old = before?.[key] ?? null
    const next = after[key] ?? null
    if (canonical(old) !== canonical(next))
      diff[key] = { before: old, after: next }
  }
  return diff as Prisma.InputJsonObject
}
export async function audit(
  tx: Tx,
  input: {
    commandId: string
    userId: string
    entityType: EnabledSubject
    entityId: string
    action: string
    reason?: string
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
      actorKind: "USER",
      action: input.action,
      reason: input.reason,
      fieldDiff: fieldDiff(input.entityType, input.before, input.after),
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
    entityType: "Vehicle" | "Customer" | "Supplier"
    entityId: string
    revision: number
    payload: Record<string, unknown>
  }
) {
  const allowed = fieldsFor(input.entityType, "read")
  if (Object.keys(input.payload).some((k) => !allowed.includes(k)))
    fail("INVALID_INPUT", 422)
  return tx.entityReadVersion.create({
    data: { ...input, payload: input.payload as Prisma.InputJsonObject },
  })
}
