import "server-only"
import { z } from "zod"
import { database, assertEnvironment } from "./db"
import { currentActor, actorDTO, type Identity, type Actor } from "./actor"
import { fail } from "./errors"
import { userDTO, roleDTO, userInclude, roleInclude } from "./admin"
import {
  project,
  readScope,
  requireFields,
  configurableRegistry,
  type EnabledSubject,
} from "./permissions"
import { id, listParams } from "./validators"
import { adminList } from "./admin-list"
import { subject } from "@casl/ability"
import type { Tx } from "./db"
import { customerQuery } from "./customers"
import { partiesQuery, partyQuery } from "./parties"
import { settingsQuery } from "./settings"
import { purchaseQuery } from "./purchases"
import { rateQuery } from "./rates"
import { importQuery } from "./import-staging"
import { downloadQuery } from "./attachments"
import { approvalQuery, approvalReplay, approvalAudit } from "./approvals"
import { notificationQuery, notificationReplay } from "./notifications"
import { repairReplay } from "./repairs"
import { brokerageQuery, brokerageAudit, brokerageReplay } from "./brokerage"
import { commitmentReplay } from "./reservation-sales"
import { expiryHealth } from "./reservation-expiry"
import { saleQuery, saleReplay, saleAudit, commitmentList } from "./sales"
import { runtimeConfig } from "./config"

const canAdminister = (actor: Actor) =>
  ["create", "update"].some((a) => actor.ability.can(a, subject("User", {})))
function visibleRoleLink(
  actor: Actor,
  row: object | undefined,
  link: Record<string, unknown>,
  redactions: string[],
  prefix: string
) {
  if (!row || !actor.ability.can("read", subject("Role", row))) {
    redactions.push(prefix)
    return []
  }
  return [
    Object.fromEntries(
      ["id", "revision", "name"]
        .filter((field) => {
          const allowed = actor.ability.can("read", subject("Role", row), field)
          if (!allowed) redactions.push(`${prefix}.${field}`)
          return allowed
        })
        .map((field) => [field, link[field]])
    ),
  ]
}
async function visibleUser(
  tx: Tx,
  actor: Actor,
  row: Parameters<typeof userDTO>[0]
) {
  const dto = userDTO(row)
  const projected = project(actor.ability, "User", dto)
  if ("roles" in projected) {
    projected.roles = row.roles.flatMap(({ role }) =>
      visibleRoleLink(actor, role, role, projected.redactedFields, "roles")
    )
  }
  if (
    canAdminister(actor) &&
    actor.ability.can("read", subject("User", dto), "adminProtection")
  ) {
    const isAdministrator = row.roles.some(
      (m) => m.role.systemKey === "ADMINISTRATOR" && m.role.active
    )
    const activeAdmins = await tx.user.count({
      where: {
        active: true,
        roles: { some: { role: { systemKey: "ADMINISTRATOR", active: true } } },
      },
    })
    projected.adminProtection = {
      isAdministrator,
      lastActiveAdministrator:
        isAdministrator && row.active && activeAdmins === 1,
    }
  } else projected.redactedFields.push("adminProtection")
  return projected
}

export async function securityQuery(
  identity: Identity,
  name: string,
  params: URLSearchParams
) {
  if (new Set(params.keys()).size !== [...params.keys()].length)
    fail("INVALID_INPUT", 422)
  return database().$transaction(
    async (tx) => {
      await assertEnvironment(tx)
      if (name === "commandStatus")
        await tx.$queryRaw`SELECT vamotors.lock_admin_guard()`
      const actor = await currentActor(tx, identity)
      const args = Object.fromEntries(params)
      if (name === "approvals") return approvalQuery(tx, actor, args)
      if (name === "notifications") return notificationQuery(tx, actor, args)
      if (name === "jobHealth") return expiryHealth(tx, actor)
      if (name === "sales") return commitmentList(tx, actor, args)
      if (name === "sale") return saleQuery(tx, actor, args)
      if (
        name === "audit" &&
        ["ApprovalRequest", "Disposal"].includes(args.type)
      )
        return approvalAudit(tx, actor, args)
      if (
        name === "audit" &&
        ["BrokerageDeal", "CashFacility"].includes(args.type)
      )
        return brokerageAudit(tx, actor, args)
      if (
        name === "audit" &&
        ["SaleCase", "SaleCompletion"].includes(args.type)
      )
        return saleAudit(tx, actor, args)
      if (name === "commandStatus") {
        const parsed = z
          .object({
            name: z.enum([
              "requestApproval",
              "reviewApproval",
              "markNotificationRead",
              "markAllNotificationsRead",
              "sendRepair",
              "returnRepair",
              "payRepair",
              "reversePayment",
              "openBrokerage",
              "recordEligibility",
              "recordInspection",
              "adjustLoan",
              "replaceDealQuote",
              "setChecklist",
              "verifyDocuments",
              "setProcessingFee",
              "informCompany",
              "dispatchBatch",
              "referDeal",
              "rejectDeal",
              "completeBrokerage",
              "openIssue",
              "recordIssueFeedback",
              "requestFacility",
              "disburseFacility",
              "recoverFacility",
              "recordBrokerageFee",
              "completeImmediate",
              "intakeTradeIn",
              "placeReservation", "startFinance", "convertReservation", "cancelRetained",
              "recordDO", "confirmDOAndHandover", "recordLenderReceipt",
            ]),
            idempotencyKey: id,
          })
          .strict()
          .safeParse(args)
        if (!parsed.success) fail("INVALID_INPUT", 422)
        const receipt = await tx.commandReceipt.findUnique({
          where: {
            environmentId_actorKey_commandName_idempotencyKey: {
              environmentId: runtimeConfig().ENVIRONMENT_ID,
              actorKey: `USER:${actor.userId}`,
              commandName: parsed.data.name,
              idempotencyKey: parsed.data.idempotencyKey,
            },
          },
        })
        if (!receipt) return { ok: true, status: "NOT_COMMITTED" }
        const resultType = (receipt.result as { type?: string }).type
        if (resultType === "BrokerageDeal" || resultType === "DispatchBatch")
          return brokerageReplay(tx, actor, receipt)
        if (["placeReservation", "startFinance", "convertReservation", "cancelRetained",
          "recordDO", "confirmDOAndHandover", "recordLenderReceipt"].includes(parsed.data.name))
          return commitmentReplay(tx, actor, receipt)
        return ["requestApproval", "reviewApproval"].includes(parsed.data.name)
          ? approvalReplay(tx, actor, receipt)
          : ["markNotificationRead", "markAllNotificationsRead"].includes(
                parsed.data.name
              )
            ? notificationReplay(tx, actor, receipt)
            : ["completeImmediate", "intakeTradeIn"].includes(parsed.data.name)
              ? saleReplay(tx, actor, receipt)
              : repairReplay(tx, actor, receipt)
      }
      if (name === "importBatches" || name === "importBatchFiles")
        return importQuery(tx, actor, name, args)
      if (name === "download") {
        const parsed = z.object({ attachmentId: id }).strict().safeParse(args)
        if (!parsed.success) fail("INVALID_INPUT", 422)
        return downloadQuery(tx, actor, parsed.data.attachmentId)
      }
      if (name === "quote") return rateQuery(tx, actor, name, args)
      if (["brokerage", "brokerageDeal", "dispatchPreview"].includes(name))
        return brokerageQuery(tx, actor, name, args)
      if (
        name === "audit" &&
        ["Vehicle", "PurchaseRecord", "VehicleCost", "RepairRecord"].includes(
          args.type
        )
      )
        return purchaseQuery(tx, actor, name, args)
      if (
        [
          "purchases",
          "purchase",
          "inventory",
          "vehicle",
          "vehicleIdentity",
        ].includes(name)
      )
        return purchaseQuery(tx, actor, name, args)
      if (name === "parties") return partiesQuery(tx, actor, args)
      if (name === "party") return partyQuery(tx, actor, args)
      if (name === "settings") return settingsQuery(tx, actor, args)
      if (name === "customers" || name === "customer")
        return customerQuery(tx, actor, name, args)
      if (name === "currentActor") {
        if (params.size) fail("INVALID_INPUT", 422)
        return actorDTO(actor)
      }
      if (name === "permissionRegistry") {
        if (params.size) fail("INVALID_INPUT", 422)
        const roleConfiguration =
          actor.ability.can("read", subject("Role", {})) &&
          actor.ability.can("update", subject("Role", {}))
        if (!roleConfiguration && !canAdminister(actor)) fail("FORBIDDEN", 403)
        const registry = configurableRegistry(
          actor.grants,
          actor.userId,
          actor.administrator
        )
        return canAdminister(actor) ||
          actor.ability.can("update", subject("Role", {}), "grants")
          ? registry
          : { ...registry, subjects: [] }
      }
      if (["users", "roles", "user", "role"].includes(name)) {
        const type = name.startsWith("user") ? "User" : "Role"
        requireFields(actor.ability, type, "read", {}, [])
        if (name === "user" || name === "role") {
          const input = z.object({ id }).strict().safeParse(args)
          if (!input.success) fail("INVALID_INPUT", 422)
          if (type === "User") {
            const row = await tx.user.findFirst({
              where: {
                AND: [
                  { id: input.data.id },
                  readScope(actor.grants, actor.userId, "User"),
                ],
              },
              include: userInclude,
            })
            if (!row) fail("NOT_FOUND", 404)
            return visibleUser(tx, actor, row)
          }
          const row = await tx.role.findFirst({
            where: {
              AND: [
                { id: input.data.id },
                readScope(actor.grants, actor.userId, "Role"),
              ],
            },
            include: roleInclude,
          })
          if (!row) fail("NOT_FOUND", 404)
          return project(actor.ability, "Role", roleDTO(row))
        }
        const { page, pageSize, paging, where } = adminList(actor, type, args)
        if (type === "User" && args.roleId) {
          const role = await tx.role.findUnique({ where: { id: args.roleId } })
          if (!role) fail("NOT_FOUND", 404)
          requireFields(actor.ability, "Role", "read", role, ["id"])
        }
        if (type === "User") {
          const [rows, total] = await Promise.all([
            tx.user.findMany({ where, ...paging, include: userInclude }),
            tx.user.count({ where }),
          ])
          return {
            ok: true,
            data: await Promise.all(rows.map((r) => visibleUser(tx, actor, r))),
            total,
            page,
            pageSize,
            asOf: new Date().toISOString(),
            redactedFields: [],
          }
        }
        const [rows, total] = await Promise.all([
          tx.role.findMany({ where, ...paging, include: roleInclude }),
          tx.role.count({ where }),
        ])
        return {
          ok: true,
          data: rows.map((r) => project(actor.ability, "Role", roleDTO(r))),
          total,
          page,
          pageSize,
          asOf: new Date().toISOString(),
          redactedFields: [],
        }
      }
      if (name === "audit") {
        requireFields(actor.ability, "AuditLog", "read", {}, [])
        const parsed = listParams
          .extend({
            type: z.enum([
              "User",
              "Role",
              "Customer",
              "Supplier",
              "RepairVendor",
              "FinanceCompany",
              "Settings",
            ]),
            id,
          })
          .strict()
          .safeParse(args)
        if (!parsed.success) fail("INVALID_INPUT", 422)
        const { type: entityType, id: entityId, page, pageSize } = parsed.data
        const row =
          entityType === "User"
            ? await tx.user.findUnique({
                where: { id: entityId },
                include: userInclude,
              })
            : entityType === "Settings"
              ? await tx.settings.findUnique({ where: { id: entityId } })
              : entityType === "FinanceCompany"
                ? await tx.financeCompany.findUnique({
                    where: { id: entityId },
                  })
                : entityType === "Supplier"
                  ? await tx.supplier.findUnique({ where: { id: entityId } })
                  : entityType === "RepairVendor"
                    ? await tx.repairVendor.findUnique({
                        where: { id: entityId },
                      })
                    : entityType === "Customer"
                      ? await tx.customer.findUnique({
                          where: { id: entityId },
                        })
                      : await tx.role.findUnique({
                          where: { id: entityId },
                          include: roleInclude,
                        })
        if (!row) fail("NOT_FOUND", 404)
        requireFields(actor.ability, entityType, "read", row, ["id"])
        // at is recordedAt in SQL; both ordering fields need unconditional read.
        const scope = readScope(actor.grants, actor.userId, "AuditLog", [
          "id",
          "at",
        ])
        const where = { AND: [{ entityType, entityId }, scope] }
        const [entries, total] = await Promise.all([
          tx.auditEntry.findMany({
            where,
            orderBy: [{ recordedAt: "asc" }, { id: "asc" }],
            skip: (page - 1) * pageSize,
            take: pageSize,
          }),
          tx.auditEntry.count({ where }),
        ])
        const data = await Promise.all(
          entries.map(async (entry) => {
            const fields = entry.fieldDiff as Record<string, unknown>
            const redactions: string[] = []
            const diff = Object.entries(fields)
              .filter(([key]) => {
                try {
                  requireFields(
                    actor.ability,
                    entityType as EnabledSubject,
                    "read",
                    row,
                    [key]
                  )
                  return true
                } catch {
                  redactions.push(`fields.${key}`)
                  return false
                }
              })
              .map(([path, value]) => ({
                path,
                ...(value as { before: unknown; after: unknown }),
              }))
            for (const change of diff) {
              if (entityType !== "User" || change.path !== "roles") continue
              for (const side of ["before", "after"] as const) {
                const value = change[side]
                if (value === null) continue
                const links = z
                  .array(
                    z
                      .object({
                        id,
                        name: z.string(),
                        revision: z.number().int(),
                      })
                      .strict()
                  )
                  .safeParse(value)
                if (!links.success) {
                  change[side] = []
                  redactions.push("fields.roles")
                  continue
                }
                const targets = await tx.role.findMany({
                  where: { id: { in: links.data.map((link) => link.id) } },
                })
                change[side] = links.data.flatMap((link) =>
                  visibleRoleLink(
                    actor,
                    targets.find((r) => r.id === link.id),
                    link,
                    redactions,
                    "fields.roles"
                  )
                )
              }
            }
            const auditActor = entry.userId
              ? await tx.user.findUnique({ where: { id: entry.userId } })
              : null
            const visibleActor =
              auditActor &&
              actor.ability.can("read", subject("User", auditActor), "id")
            if (entry.userId && !visibleActor) redactions.push("actor.userId")
            const projected = project(actor.ability, "AuditLog", {
              id: entry.id,
              entityType,
              entityId,
              action: entry.action,
              at: entry.recordedAt.toISOString(),
              actor: {
                kind: entry.actorKind,
                ...(visibleActor ? { userId: entry.userId } : {}),
              },
              reason: entry.reason,
              fields: diff,
            })
            projected.redactedFields.push(...redactions)
            return projected
          })
        )
        return {
          ok: true,
          data,
          total,
          page,
          pageSize,
          asOf: new Date().toISOString(),
          redactedFields: [],
        }
      }
      fail("NOT_FOUND", 404)
    },
    {
      // The guard serializes auth mutations; each post-wait statement must see
      // their committed grants, not an earlier repeatable-read auth snapshot.
      isolationLevel:
        name === "commandStatus" ? "ReadCommitted" : "RepeatableRead",
      timeout: 5000,
    }
  )
}
