import "server-only"
import { randomUUID } from "node:crypto"
import type { Notification, CommandReceipt } from "@prisma/client"
import type { Applied } from "../../.planning/implementation/contracts/api"
import { database, type Tx } from "./db"
import { currentActor, type Authority, type Identity } from "./actor"
import {
  notificationEnvelope,
  notificationInputs,
  type NotificationCommand,
  listParams,
} from "./validators"
import { transaction } from "./transactions"
import { runtimeConfig } from "./config"
import { inputDigest } from "./idempotency"
import { project, readScope, requireFields } from "./permissions"
import { fail, CommandError } from "./errors"
import { z } from "zod"
import { subject } from "@casl/ability"
import type { EnabledSubject } from "./permissions"
import { audit } from "./audit"

const labels = {
  ADVANCE_EXPIRING: "Advance approaching expiry",
  ADVANCE_EXPIRED: "Advance expired",
  REPAIR_RETURNED: "Repair returned",
  APPROVAL_REQUIRED: "Approval requested",
  APPROVAL_OUTCOME: "Approval reviewed",
} as const
function own(actor: Authority, row: Notification, action: "read" | "update") {
  if (row.recipientUserId !== actor.userId) fail("NOT_FOUND", 404)
  requireFields(
    actor.ability,
    "Notification",
    action,
    row,
    action === "read" ? ["id", "revision", "readAt"] : ["readAt"]
  )
}
const targetRoutes = {
  ApprovalRequest: "/approvals",
  PurchaseRecord: "/purchases",
  Vehicle: "/vehicles",
  RepairRecord: "/repairs",
  SaleCase: "/sales",
  Customer: "/customers",
} as const

type Target = keyof typeof targetRoutes
const canRead = (
  actor: Authority,
  type: EnabledSubject,
  row: object,
  fields = ["id"]
) =>
  fields.every((field) => actor.ability.can("read", subject(type, row), field))

async function visibleTargets(tx: Tx, actor: Authority, rows: Notification[]) {
  const keys = new Set<string>()
  const ids = (kind: Target) => [
    ...new Set(
      rows
        .filter(
          (row) =>
            row.targetType === kind &&
            canRead(actor, "Notification", row, ["target"])
        )
        .map((row) => row.targetId)
    ),
  ]
  const inIds = (kind: Target) => ({ in: ids(kind) })
  const [approvals, purchases, vehicles, repairs, sales, customers] =
    await Promise.all([
      tx.approvalRequest.findMany({
        where: { id: inIds("ApprovalRequest") },
        select: {
          id: true,
          requestedBy: true,
          cycle: {
            select: {
              createdBy: true,
              status: true,
              vehicle: { select: { createdBy: true } },
            },
          },
        },
      }),
      tx.purchaseRecord.findMany({
        where: { id: inIds("PurchaseRecord") },
        select: { id: true, createdBy: true },
      }),
      tx.vehicle.findMany({
        where: { id: inIds("Vehicle") },
        select: {
          id: true,
          createdBy: true,
          purchases: {
            where: readScope(actor.grants, actor.userId, "PurchaseRecord"),
            orderBy: { cycleNumber: "desc" },
            take: 1,
            select: { status: true, createdBy: true },
          },
        },
      }),
      tx.repairRecord.findMany({
        where: { id: inIds("RepairRecord") },
        select: {
          id: true,
          createdBy: true,
          cycle: { select: { createdBy: true } },
        },
      }),
      tx.saleCase.findMany({
        where: { id: inIds("SaleCase") },
        select: { id: true, createdBy: true, customerId: true },
      }),
      tx.customer.findMany({
        where: { id: inIds("Customer") },
        select: { id: true, createdBy: true },
      }),
    ])
  for (const row of approvals)
    if (
      canRead(actor, "ApprovalRequest", { createdBy: row.requestedBy }) &&
      canRead(actor, "PurchaseRecord", row.cycle, [
        "id",
        "revision",
        "vehicleId",
        "identityRevision",
      ]) &&
      canRead(
        actor,
        "Vehicle",
        { ...row.cycle.vehicle, status: row.cycle.status },
        ["id", "identityRevision"]
      )
    )
      keys.add(`ApprovalRequest:${row.id}`)
  for (const row of purchases)
    if (canRead(actor, "PurchaseRecord", row))
      keys.add(`PurchaseRecord:${row.id}`)
  for (const row of vehicles)
    if (
      row.purchases[0] &&
      canRead(actor, "PurchaseRecord", row.purchases[0]) &&
      canRead(actor, "Vehicle", { ...row, status: row.purchases[0].status })
    )
      keys.add(`Vehicle:${row.id}`)
  for (const row of repairs)
    if (
      canRead(actor, "RepairRecord", row) &&
      canRead(actor, "PurchaseRecord", row.cycle, ["id", "repairs"])
    )
      keys.add(`RepairRecord:${row.id}`)
  for (const row of sales)
    if (canRead(actor, "SaleCase", row)) keys.add(`SaleCase:${row.id}`)
  for (const row of customers)
    if (canRead(actor, "Customer", row)) keys.add(`Customer:${row.id}`)
  return keys
}

function dto(actor: Authority, row: Notification, targets: Set<string>) {
  own(actor, row, "read")
  const route = targetRoutes[row.targetType as Target]
  const href =
    route && targets.has(`${row.targetType}:${row.targetId}`)
      ? `${route}/${row.targetId}`
      : undefined
  const label = labels[row.kind as keyof typeof labels]
  if (!label) fail("INTERNAL_ERROR", 500)
  const projected = project(actor.ability, "Notification", {
    id: row.id,
    revision: row.revision,
    kind: row.kind,
    ...(href
      ? { target: { type: row.targetType, id: row.targetId, href } }
      : {}),
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt?.toISOString() ?? null,
    recipientUserId: row.recipientUserId,
  })
  if (projected.kind) {
    projected.title = label
    projected.body = projected.target
      ? "Open the record to view its current details."
      : "The linked record is unavailable."
  }
  projected.redactedFields = projected.redactedFields.filter(
    (f) => f !== "recipientUserId"
  )
  return projected
}
export async function notificationQuery(
  tx: Tx,
  actor: Authority,
  args: Record<string, string>
) {
  const parsed = listParams
    .extend({
      unread: z.enum(["true", "false"]).optional(),
      kind: z
        .enum([
          "ADVANCE_EXPIRING",
          "ADVANCE_EXPIRED",
          "REPAIR_RETURNED",
          "APPROVAL_REQUIRED",
          "APPROVAL_OUTCOME",
        ])
        .optional(),
      sort: z.string().max(1000).optional(),
      q: z.string().max(200).optional(),
      from: z.string().optional(),
      through: z.string().optional(),
    })
    .strict()
    .safeParse(args)
  if (!parsed.success) fail("INVALID_INPUT", 422)
  const input = parsed.data
  if (input.sort || input.q || input.from || input.through)
    fail("FIELD_FORBIDDEN", 403)
  const scope = readScope(actor.grants, actor.userId, "Notification", [
    "id",
    "revision",
    "createdAt",
    ...(input.kind ? ["kind"] : []),
    ...(input.unread ? ["readAt"] : []),
  ])
  const population = { AND: [{ recipientUserId: actor.userId }, scope] }
  const where = {
    AND: [
      population,
      ...(input.kind ? [{ kind: input.kind }] : []),
      ...(input.unread
        ? [{ readAt: input.unread === "true" ? null : { not: null } }]
        : []),
    ],
  }
  const [rows, total, unreadCount] = await Promise.all([
    tx.notification.findMany({
      where,
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    }),
    tx.notification.count({ where }),
    tx.notification.count({ where: { AND: [population, { readAt: null }] } }),
  ])
  // Counting unread is itself a readAt inference; require covering field access.
  readScope(actor.grants, actor.userId, "Notification", ["readAt"])
  const targets = await visibleTargets(tx, actor, rows)
  return {
    ok: true,
    data: rows.map((r) => dto(actor, r, targets)),
    total,
    unreadCount,
    page: input.page,
    pageSize: input.pageSize,
    asOf: new Date().toISOString(),
    redactedFields: [],
  }
}
export async function notificationReplay(
  tx: Tx,
  actor: Authority,
  prior: CommandReceipt
): Promise<Applied> {
  const stored = prior.result as Applied["result"]
  const result = { type: stored.type, id: stored.id, revision: stored.revision }
  if (prior.commandName === "markNotificationRead") {
    const row = await tx.notification.findUnique({ where: { id: result.id } })
    if (!row) fail("NOT_FOUND", 404)
    own(actor, row, "read")
    own(actor, row, "update")
    return {
      ok: true,
      status: "APPLIED",
      commandId: prior.id,
      replayed: true,
      result,
      affected: [{ type: "Notification", id: row.id, revision: row.revision }],
      invalidate: ["notifications"],
    }
  }
  if (result.type !== "NotificationRead" || result.id !== actor.userId)
    fail("INTERNAL_ERROR", 500)
  requireFields(
    actor.ability,
    "Notification",
    "update",
    { recipientUserId: actor.userId },
    ["readAt"]
  )
  requireFields(
    actor.ability,
    "Notification",
    "read",
    { recipientUserId: actor.userId },
    ["id", "revision", "readAt"]
  )
  return {
    ok: true,
    status: "APPLIED",
    commandId: prior.id,
    replayed: true,
    result,
    affected: [],
    invalidate: ["notifications"],
  }
}
export async function executeNotification(
  identity: Identity,
  name: NotificationCommand,
  raw: unknown
): Promise<Applied> {
  await database().$transaction((tx) => currentActor(tx, identity))
  const parsed = notificationEnvelope(name).safeParse(raw)
  if (!parsed.success) fail("INVALID_INPUT", 422)
  const envelope = parsed.data,
    config = runtimeConfig(),
    digest = inputDigest(envelope, config.BETTER_AUTH_SECRET)
  return transaction(async (tx) => {
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
      const response = await notificationReplay(tx, actor, prior)
      if (prior.inputHash !== digest) fail("IDEMPOTENCY_MISMATCH")
      return response
    }
    const commandId = randomUUID()
    let result: Applied["result"],
      affected: Applied["affected"] = [],
      cutoff: string | undefined
    const changes: { before: Notification; after: Notification }[] = []
    if (name === "markNotificationRead") {
      const input = notificationInputs.markNotificationRead.parse(
        envelope.input
      )
      const row = await tx.notification.findUnique({
        where: { id: input.notificationId },
      })
      if (!row) fail("NOT_FOUND", 404)
      own(actor, row, "read")
      own(actor, row, "update")
      const ref = envelope.expected.find(
        (r) => r.type === "Notification" && r.id === row.id
      )
      if (!ref) fail("REVISION_REQUIRED", 428)
      if (ref.revision !== row.revision)
        throw new CommandError("STALE_REVISION", 409, false, [
          { type: "Notification", id: row.id, revision: row.revision },
        ])
      if (!row.readAt && row.revision === 2147483647) fail("REVISION_EXHAUSTED")
      const after = row.readAt
        ? row
        : await tx.notification.update({
            where: { id: row.id },
            data: { readAt: new Date(), revision: { increment: 1 } },
          })
      result = { type: "Notification", id: row.id, revision: after.revision }
      if (!row.readAt) changes.push({ before: row, after })
      affected = [
        { type: "Notification", id: row.id, revision: after.revision },
      ]
    } else {
      const input = notificationInputs.markAllNotificationsRead.parse(
        envelope.input
      )
      const through = new Date(
        Math.min(new Date(input.through).valueOf(), Date.now())
      )
      cutoff = through.toISOString()
      const rows = await tx.notification.findMany({
        where: {
          recipientUserId: actor.userId,
          readAt: null,
          createdAt: { lte: through },
        },
      })
      requireFields(
        actor.ability,
        "Notification",
        "update",
        { recipientUserId: actor.userId },
        ["readAt"]
      )
      for (const row of rows) {
        own(actor, row, "read")
        own(actor, row, "update")
        if (row.revision === 2147483647) fail("REVISION_EXHAUSTED")
      }
      await tx.notification.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: { readAt: new Date(), revision: { increment: 1 } },
      })
      const updated = await tx.notification.findMany({
        where: { id: { in: rows.map((r) => r.id) } },
      })
      for (const before of rows)
        changes.push({
          before,
          after: updated.find((r) => r.id === before.id)!,
        })
      result = { type: "NotificationRead", id: actor.userId, revision: 1 }
      affected = rows.map((r) => ({
        type: "Notification",
        id: r.id,
        revision: r.revision + 1,
      }))
    }
    await tx.commandReceipt.create({
      data: {
        id: commandId,
        ...scope,
        inputHash: digest,
        result: { ...result, ...(cutoff ? { through: cutoff } : {}) },
      },
    })
    const snapshot = (row: Notification) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      readAt: row.readAt?.toISOString() ?? null,
    })
    for (const change of changes)
      await audit(tx, {
        commandId,
        userId: actor.userId,
        entityType: "Notification",
        entityId: change.after.id,
        action: name,
        before: snapshot(change.before),
        after: snapshot(change.after),
      })
    return {
      ok: true,
      status: "APPLIED",
      commandId,
      replayed: false,
      result,
      affected,
      invalidate: ["notifications"],
    }
  })
}
