import { reconciliationRead, reconciliationQueries, reconciliationReplay } from "./reconciliation"
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
import { withImportProvenance } from "./import-provenance"
import { importQuery } from "./import-staging"
import { downloadQuery, loadTarget, type UploadTarget } from "./attachments"
import { approvalQuery, approvalReplay, approvalAudit } from "./approvals"
import { notificationQuery, notificationReplay, visibleTargets } from "./notifications"
import { repairReplay } from "./repairs"
import { brokerageQuery, brokerageAudit, brokerageReplay } from "./brokerage"
import { invoiceQuery, invoiceReplay } from "./invoices"
import { commitmentReplay } from "./reservation-sales"
import { expiryHealth } from "./reservation-expiry"
import { saleQuery, saleReplay, saleAudit, commitmentList, loadSale } from "./sales"
import { runtimeConfig } from "./config"

import { auditFilterInputs, auditScope, joinAuditFields } from "./audit"
import { authorizeInvoice, snapshotOf } from "./invoice-data"
import { documentSubject } from "./import-staging"
import { fieldsFor } from "./permissions"
import type { Prisma } from "@prisma/client"

const simpleAuditTypes = [
  "User", "Role", "Customer", "Supplier", "RepairVendor", "FinanceCompany", "Settings",
  "Document", "ImportBatch", "Quote", "RateSheet", "Reservation", "Notification",
  "Remittance", "CommissionEntitlement", "ReconciliationRun", "DispatchBatch",
  "InvoiceVersion", "UserRole", "RolePermission",
] as const
export const auditRecordTypes = [
  "PurchaseRecord", "Vehicle", "VehicleCost", "RepairRecord", "SaleCase", "SaleCompletion",
  "ApprovalRequest", "Disposal", "BrokerageDeal", "CashFacility", ...simpleAuditTypes,
] as const
type SimpleAuditType = (typeof simpleAuditTypes)[number]

async function auditRecord(tx: Tx, actor: Actor, type: SimpleAuditType, id: string) {
  const where = { id }
  const record = <T>(value: T | null): T => value ?? fail("NOT_FOUND", 404)
  const can = (subjectType: EnabledSubject, row: Record<string, unknown>, field: string) =>
    actor.ability.can("read", subject(subjectType, row), field)

  switch (type) {
    case "UserRole":
    case "User":
      return { type: "User", row: record(await tx.user.findUnique({ where, include: userInclude })) } as const
    case "RolePermission":
    case "Role":
      return { type: "Role", row: record(await tx.role.findUnique({ where, include: roleInclude })) } as const
    case "Customer":
      return { type, row: record(await tx.customer.findUnique({ where })) }
    case "Supplier":
      return { type, row: record(await tx.supplier.findUnique({ where })) }
    case "RepairVendor":
      return { type, row: record(await tx.repairVendor.findUnique({ where })) }
    case "FinanceCompany":
      return { type, row: record(await tx.financeCompany.findUnique({ where })) }
    case "Settings":
      return { type, row: record(await tx.settings.findUnique({ where })) }
    case "ImportBatch":
      return { type, row: record(await tx.importBatch.findUnique({ where })) }
    case "RateSheet":
    case "Quote": {
      const row = record(type === "RateSheet" ? await tx.rateSheetVersion.findUnique({ where }) : await tx.quote.findUnique({ where }))
      const company = record(await tx.financeCompany.findUnique({ where: { id: row.companyId } }))
      requireFields(actor.ability, "FinanceCompany", "read", company, ["id"])
      return { type, row: { ...row, financeCompanyId: row.companyId } }
    }
    case "Document": {
      // Both intent and finalized attachment IDs have retained audit entries.
      const upload = await tx.uploadIntent.findUnique({ where })
      const row = record(upload ?? await tx.attachment.findUnique({ where }))
      const target = row.batchId ?? row.saleCaseId ?? row.brokerageDealId ?? row.remittanceId
      if (!target) fail("NOT_FOUND", 404)
      const key = upload ? "uploadId" : "attachmentId"
      const auth = documentSubject(row)
      requireFields(actor.ability, type, "read", auth, [key])
      await loadTarget(tx, actor, row.targetType as UploadTarget["type"], target, false)
      return { type, row: auth, key }
    }
    case "Reservation": {
      const row = record(await tx.reservation.findUnique({ where, include: { saleCase: true } }))
      requireFields(actor.ability, "SaleCase", "read", row.saleCase, ["id", "reservation.id"])
      return { type, row, allows: (path: string) => can("SaleCase", row.saleCase, `reservation.${path}`) }
    }
    case "Notification": {
      const row = record(await tx.notification.findUnique({ where }))
      if (row.recipientUserId !== actor.userId) fail("NOT_FOUND", 404)
      const targets = await visibleTargets(tx, actor, [row])
      return { type, row, allows: (path: string) => path !== "target" || targets.has(`${row.targetType}:${row.targetId}`) }
    }
    case "InvoiceVersion": {
      const row = record(await tx.invoiceVersion.findUnique({ where, include: { completion: true } }))
      const sale = record(await loadSale(tx, row.completion.saleCaseId))
      await authorizeInvoice(tx, actor, sale, "read", snapshotOf(row))
      return { type: "SaleCase", row: sale, allows: () => true } as const
    }
    case "DispatchBatch": {
      const row = record(await tx.dispatchBatch.findUnique({
        where, include: { items: { include: { brokerageDeal: true } } },
      }))
      const visibleItems = row.items.every((item) =>
        item.brokerageDeal && can("BrokerageDeal", { ...item.brokerageDeal, financeCompanyId: item.brokerageDeal.companyId }, "id")
      )
      return {
        type, row,
        allows: (path: string) => path !== "items" || (
          visibleItems && fieldsFor(type, "read").filter((field) => field.startsWith("items.")).every((field) => can(type, row, field))
        ),
      }
    }
    case "Remittance":
    case "CommissionEntitlement":
    case "ReconciliationRun": {
      const row = record(
        type === "Remittance" ? await tx.remittance.findUnique({ where })
          : type === "CommissionEntitlement" ? await tx.commissionEntitlement.findUnique({ where })
            : await tx.reconciliationRun.findUnique({ where })
      )
      const scope = { financeCompanyId: row.companyId }
      requireFields(actor.ability, "ReconciliationRun", "read", scope, ["id", "company"])
      const canReadLedger = fieldsFor("Remittance", "read").every((f) => can("Remittance", scope, f)) &&
        fieldsFor("CommissionEntitlement", "read").every((f) => can("CommissionEntitlement", scope, f))
      return {
        type, row: { ...row, ...scope },
        allows: (path: string) =>
          !["snapshot", "allocations", "discrepancies", "balance"].includes(path) || canReadLedger,
      }
    }
  }
}

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
      if (name === "invoice") return invoiceQuery(tx, actor, args)
      if (name === "jobHealth") return expiryHealth(tx, actor)
      if (reconciliationQueries.has(name)) return reconciliationRead(tx, actor, name, args)
      if (name === "sales") return commitmentList(tx, actor, args)
      if (name === "sale") return withImportProvenance(tx, actor, "SaleCase", await saleQuery(tx, actor, args))
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
              "issueInvoice",
              "placeReservation", "startFinance", "convertReservation", "cancelRetained",
              "recordDO", "confirmDOAndHandover", "recordLenderReceipt",
              "stageRemittance", "recordRemittance", "reconcile", "reverseAllocation", "returnRemittanceOverpayment",
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
        if (parsed.data.name === "issueInvoice") return invoiceReplay(tx, actor, receipt)
        const resultType = (receipt.result as { type?: string }).type
        if (resultType === "Remittance" || resultType === "ReconciliationRun")
          return reconciliationReplay(tx, actor, receipt)
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
      if (name === "brokerageDeal") return withImportProvenance(tx, actor, "BrokerageDeal", await brokerageQuery(tx, actor, name, args) as Record<string, unknown>)
      if (["brokerage", "dispatchPreview"].includes(name))
        return brokerageQuery(tx, actor, name, args)
      if (
        name === "audit" &&
        ["Vehicle", "PurchaseRecord", "VehicleCost", "RepairRecord"].includes(
          args.type
        )
      )
        return purchaseQuery(tx, actor, name, args)
      if (name === "purchase" || name === "vehicle")
        return withImportProvenance(tx, actor, name === "purchase" ? "PurchaseRecord" : "Vehicle", await purchaseQuery(tx, actor, name, args) as Record<string, unknown>)
      if (
        [
          "purchases",
          "inventory",
          "vehicleIdentity",
        ].includes(name)
      )
        return purchaseQuery(tx, actor, name, args)
      if (name === "parties") return partiesQuery(tx, actor, args)
      if (name === "party") {
        const type = args.type === "SUPPLIER" ? "Supplier" : args.type === "REPAIR_VENDOR" ? "RepairVendor" : "FinanceCompany"
        return withImportProvenance(tx, actor, type, await partyQuery(tx, actor, args))
      }
      if (name === "settings") return settingsQuery(tx, actor, args)
      if (name === "customer") return withImportProvenance(tx, actor, "Customer", await customerQuery(tx, actor, name, args) as Record<string, unknown>)
      if (name === "customers")
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
            ...auditFilterInputs,
            type: z.enum(simpleAuditTypes),
            id,
            relatedId: id.optional(),
          })
          .strict()
          .safeParse(args)
        if (!parsed.success) fail("INVALID_INPUT", 422)
        const { type: entityType, id: entityId, page, pageSize, relatedId } = parsed.data
        const scope = auditScope(actor, parsed.data)
        const isJoin = entityType === "UserRole" || entityType === "RolePermission"
        if (isJoin !== !!relatedId) fail("INVALID_INPUT", 422)
        const target = await auditRecord(tx, actor, entityType, entityId)
        const { type, row } = target
        const key = target.key ?? "id"
        requireFields(actor.ability, type, "read", row, [key])
        const can = (field: string) => actor.ability.can("read", subject(type, row), field)
        const pairFilter: Prisma.AuditEntryWhereInput[] = []
        if (entityType === "UserRole" || entityType === "RolePermission") {
          requireFields(actor.ability, type, "read", row, [entityType === "UserRole" ? "roles" : "grants"])
          if (entityType === "UserRole") {
            const role = await tx.role.findUnique({ where: { id: relatedId } })
            if (!role) fail("NOT_FOUND", 404)
            requireFields(actor.ability, "Role", "read", role, ["id"])
          }
          const key = entityType === "UserRole" ? "roleId" : "permissionId"
          pairFilter.push({ OR: ["before", "after"].map((side) => ({
            fieldDiff: { path: [key, side], equals: relatedId! },
          })) })
        }
        const where = { AND: [{ entityType, entityId }, scope, ...pairFilter] }
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
                const allowed =
                  entityType === "InvoiceVersion"
                    ? true
                    : entityType === "UserRole" || entityType === "RolePermission"
                      ? joinAuditFields[entityType].some((field) => field === key)
                      : entityType === "FinanceCompany" && key === "reconciliationWatermark"
                        ? actor.ability.can("read", subject("ReconciliationRun", { financeCompanyId: entityId }), "newWatermarkDate")
                        : fieldsFor(type, "read").includes(key) && can(key) && (target.allows?.(key) ?? true)
                if (!allowed) redactions.push(`fields.${key}`)
                return allowed
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
              ...(redactions.some((field) => field.startsWith("fields.")) ? {} : { reason: entry.reason }),
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
