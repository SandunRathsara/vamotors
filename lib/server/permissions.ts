import { createMongoAbility, subject } from "@casl/ability"
import { z } from "zod"
import type {
  Grant,
  Subject,
  PermissionRegistryDTO,
} from "../../.planning/implementation/contracts/api"
import { fail } from "./errors"
import { states } from "../state"

export const sourcePaymentFields = [
  "id",
  "owner.type",
  "owner.id",
  "commandId",
  "amount",
  "direction",
  "category",
  "date",
  "method",
  "recordedAt",
  "reference",
  "reversalOf",
  "reason",
] as const
export const repairReadFields = [
  "id",
  "revision",
  "vendorId",
  "request",
  "sentDate",
  "returnedDate",
  "summary",
  "invoiceAmount",
  "invoiceDate",
  "payments",
  ...sourcePaymentFields.map((p) => `payments.${p}`),
] as const
export const mileageReadFields = [
  "id",
  "reading",
  "date",
  "remark",
  "decreaseReason",
] as const
export const physicalFields = [
  "engineNumber",
  "chassisNumber",
  "make",
  "model",
  "year",
  "colour",
  "fuelType",
  "transmission",
  "vin",
  "crNumber",
  "notes",
] as const
export const costReadFields = [
  "id",
  "revision",
  "category",
  "description",
  "amount",
  "incurredDate",
  "payments",
  ...sourcePaymentFields.map((p) => `payments.${p}`),
  "outstanding",
  "provenance",
] as const
const paymentWriteFields = [
  "payment.amount",
  "payment.date",
  "payment.method",
  "payment.reference",
] as const
const correctionWriteFields = [
  "sourceType",
  "sourceId",
  "paymentId",
  "reason",
  "replacement.amount",
  "replacement.date",
  "replacement.method",
  "replacement.reference",
] as const
export const settlementFields = [
  "institutionType",
  "companyId",
  "institutionName",
  "reference",
  "amount",
  "cashToSeller",
] as const
const salePaymentFields = sourcePaymentFields.filter(
  (f) => !["owner.type", "owner.id", "commandId", "reason"].includes(f)
)
const immediateSaleWriteFields = [
  "cycleId",
  "customerId",
  "kind",
  "price",
  "date",
  "mileage",
  "method",
  "reference",
  "reason",
  "tradeIn",
  "tradeIn.description",
  "tradeIn.value",
  "tradeIn.intake",
  "tradeIn.intake.vehicle",
  "tradeIn.intake.mileage",
  "tradeIn.intake.listedPrice",
] as const
const saleEditWriteFields = [
  "saleId",
  "reason",
  "patch.customerId",
  "patch.price",
  "patch.reference",
  "patch.saleDate",
  "patch.handoverMileage",
  "patch.notes",
  "patch.tradeIn",
  "patch.tradeIn.description",
  "patch.tradeIn.value",
  "cashCorrections",
] as const

// Deliberately closed initial capability registry. Downstream subjects stay
// ungrantable until their authoritative DTO/command mappings are implemented.
export const registry = {
  User: {
    read: [
      "id",
      "revision",
      "name",
      "email",
      "active",
      "roles",
      "authzRevision",
      "createdAt",
      "updatedAt",
      "adminProtection",
    ],
    create: ["name", "email", "password", "roleIds"],
    update: ["name", "active", "roleIds"],
  },
  Role: {
    read: ["id", "revision", "name", "active", "systemKey", "grants"],
    create: ["name", "grants"],
    update: ["name", "grants"],
    archive: ["active"],
  },
  Vehicle: {
    read: [
      "id",
      "identity",
      "status",
      "available",
      "cycleId",
      "revision",
      "listedPrice",
      "financial",
      "financial.purchase",
      "financial.repairs",
      "financial.additionalCosts",
      "financial.basis",
      "financial.originalProfit",
      "financial.restatedProfit",
      "identityRevision",
      "holdReason",
      "mileage",
      ...mileageReadFields.filter((f) => f !== "id").map((f) => `mileage.${f}`),
      "provenance",
      "identity.engineNumber",
      "identity.chassisNumber",
      "identity.make",
      "identity.model",
      "identity.year",
      "identity.colour",
      "identity.fuelType",
      "identity.transmission",
      "identity.vin",
      "identity.crNumber",
      "identity.notes",
      "financial.currency",
      "financial.scale",
      "financial.cashIn",
      "financial.cashOut",
      "financial.net",
    ],
    create: [
      "engineNumber",
      "chassisNumber",
      "make",
      "model",
      "year",
      "colour",
      "fuelType",
      "transmission",
      "vin",
      "crNumber",
      "notes",
    ],
    update: [
      "vehicleId",
      "reason",
      ...physicalFields.map((f) => `values.${f}`),
    ],
  },
  Customer: {
    read: [
      "id",
      "revision",
      "fullName",
      "callingName",
      "nicOrPassport",
      "address",
      "phone",
      "email",
      "drivingLicence",
      "notes",
      "active",
      "provenance",
      "links",
    ],
    create: [
      "fullName",
      "callingName",
      "nicOrPassport",
      "address",
      "phone",
      "email",
      "drivingLicence",
      "notes",
    ],
    update: [
      "fullName",
      "callingName",
      "nicOrPassport",
      "address",
      "phone",
      "email",
      "drivingLicence",
      "notes",
    ],
    archive: ["active"],
  },
  PurchaseRecord: {
    read: [
      "id",
      "revision",
      "vehicleId",
      "identity",
      "identityRevision",
      "cycleNumber",
      "purchaseType",
      "acquisitionKind",
      "seller",
      "tradeInSourceSaleId",
      "purchaseDate",
      "purchasePrice",
      "listedPrice",
      "status",
      "available",
      "holdReason",
      "receivedDate",
      "closedAt",
      "payments",
      "outstanding",
      "costs",
      "repairs",
      "mileage",
      ...mileageReadFields.map((f) => `mileage.${f}`),
      "financial",
      "basisVersions",
      "sales",
      "disposal",
      "provenance",
      "nextActions",
      "notes",
      ...sourcePaymentFields.map((p) => `payments.${p}`),
      ...[
        "institutionType",
        "companyId",
        "institutionName",
        "institutionNameSnapshot",
        "reference",
        "amount",
        "cashToSeller",
      ].map((p) => `settlement.${p}`),
      "outstanding.seller",
      "outstanding.settlement",
      ...costReadFields.map((p) => `costs.${p}`),
      "basisVersions.id",
      "basisVersions.version",
      "basisVersions.total",
      "basisVersions.reason",
      "identity.engineNumber",
      "identity.chassisNumber",
      "identity.make",
      "identity.model",
      "identity.year",
      "identity.colour",
      "identity.fuelType",
      "identity.transmission",
      "identity.vin",
      "identity.crNumber",
      "identity.notes",
      "financial.currency",
      "financial.scale",
      "financial.purchase",
      "financial.repairs",
      "financial.additionalCosts",
      "financial.basis",
      "financial.originalBasis",
      "financial.salePrice",
      "financial.originalProfit",
      "financial.restatedProfit",
      "financial.cashIn",
      "financial.cashOut",
      "financial.net",
    ],
    create: [
      "vehicle",
      "supplierId",
      "purchaseDate",
      "purchaseType",
      "purchasePrice",
      "listedPrice",
      "mileage",
      "paymentMethod",
      ...settlementFields.map((p) => `settlement.${p}`),
    ],
    receive: ["date", "disposition.kind", "disposition.reason"],
    update: [
      "reason",
      "cycleId",
      "amount",
      "mileage.reading",
      "mileage.date",
      "mileage.remark",
      "mileage.decreaseReason",
      "patch.purchaseDate",
      "patch.purchasePrice",
      "patch.notes",
      "patch.purchaseType",
      "patch.seller.type",
      "patch.seller.id",
      "patch.settlement",
      ...settlementFields.map((p) => `patch.settlement.${p}`),
    ],
    release: ["cycleId"],
    pay: [
      "cycleId",
      "recipient",
      ...paymentWriteFields,
      ...correctionWriteFields,
      "cashCorrections.paymentId",
      "cashCorrections.reason",
      "cashCorrections.replacement.amount",
      "cashCorrections.replacement.date",
      "cashCorrections.replacement.method",
      "cashCorrections.replacement.reference",
    ],
  },
  VehicleCost: {
    read: costReadFields,
    create: ["cycleId", "category", "description", "amount", "incurredDate"],
    update: [
      "costId",
      "category",
      "description",
      "amount",
      "incurredDate",
      "reason",
    ],
    pay: ["costId", ...paymentWriteFields, ...correctionWriteFields],
  },
  RepairRecord: {
    read: repairReadFields,
    create: ["cycleId", "vendorId", "request", "sentDate"],
    update: [
      "repairId",
      "invoiceAmount",
      "invoiceDate",
      "returnedDate",
      "summary",
    ],
    pay: ["repairId", ...paymentWriteFields, ...correctionWriteFields],
  },
  Supplier: {
    // category is retained only to validate immutable legacy permissions. The
    // wire DTO exposes it at directory.category, never as an extra DTO key.
    read: [
      "id",
      "revision",
      "type",
      "name",
      "category",
      "active",
      "contacts",
      "provenance",
      "directory.name",
      "directory.category",
      "directory.nicOrRegNumber",
      "directory.address",
      "directory.phone",
      "directory.hotline",
      "directory.recurring",
      "directory.notes",
      "directory.contacts",
      "contributions.purchases",
    ],
    create: [
      "name",
      "category",
      "nicOrRegNumber",
      "address",
      "phone",
      "hotline",
      "recurring",
      "notes",
      "contacts",
    ],
    update: [
      "name",
      "category",
      "nicOrRegNumber",
      "address",
      "phone",
      "hotline",
      "recurring",
      "notes",
      "contacts",
    ],
    archive: ["active"],
  },
  RepairVendor: {
    read: [
      "id",
      "revision",
      "type",
      "name",
      "active",
      "contacts",
      "provenance",
      "directory.name",
      "directory.category",
      "directory.nicOrRegNumber",
      "directory.address",
      "directory.phone",
      "directory.hotline",
      "directory.recurring",
      "directory.specialisation",
      "directory.notes",
      "directory.contacts",
      "contributions.repairs",
    ],
    create: [
      "name",
      "category",
      "nicOrRegNumber",
      "address",
      "phone",
      "hotline",
      "recurring",
      "specialisation",
      "notes",
      "contacts",
    ],
    update: [
      "name",
      "category",
      "nicOrRegNumber",
      "address",
      "phone",
      "hotline",
      "recurring",
      "specialisation",
      "notes",
      "contacts",
    ],
    archive: ["active"],
  },
  Settings: {
    read: [
      "id",
      "revision",
      "policyVersion",
      "company",
      "company.name",
      "company.identity",
      "company.address",
      "company.phone",
      "company.email",
      "declarations",
      "currency",
      "scale",
      "timezone",
      "tiers",
      "warningLeadDays",
      "processingFee",
      "dateFormat",
      "itemsPerPage",
      "theme",
    ],
    update: [
      "company",
      "company.name",
      "company.identity",
      "company.address",
      "company.phone",
      "company.email",
      "declarations",
      "currency",
      "scale",
      "timezone",
      "tiers",
      "warningLeadDays",
      "processingFee",
      "dateFormat",
      "itemsPerPage",
      "theme",
    ],
  },
  FinanceCompany: {
    read: [
      "id",
      "revision",
      "type",
      "name",
      "active",
      "contacts",
      "provenance",
      "policy",
      "policy.path",
      "policy.commission.basis",
      "policy.commission.rateBps",
      "policy.commission.fixed",
      "policy.processingFee",
      "policy.reconciliationMethod",
      "contributions.settlementPurchases",
      "contributions.leaseSales",
      "contributions.brokerage",
      "contributions.entitlements",
      "contributions.remittances",
    ],
    create: [
      "name",
      "contacts",
      "policy",
      "policy.path",
      "policy.commission.basis",
      "policy.commission.rateBps",
      "policy.commission.fixed",
      "policy.processingFee",
      "policy.reconciliationMethod",
    ],
    update: [
      "name",
      "contacts",
      "policy",
      "policy.path",
      "policy.commission.basis",
      "policy.commission.rateBps",
      "policy.commission.fixed",
      "policy.processingFee",
      "policy.reconciliationMethod",
    ],
    archive: ["active"],
  },
  ApprovalRequest: {
    read: [
      "id",
      "revision",
      "proposal.kind",
      "proposal.operation",
      "proposal.input.cycleId",
      "proposal.input.date",
      "proposal.input.reason",
      "proposal.input.method",
      "proposal.input.proceeds",
      "proposal.input.receipt.amount",
      "proposal.input.receipt.date",
      "proposal.input.receipt.method",
      "proposal.input.receipt.reference",
      "proposal.command",
      "proposal.command.name",
      "proposal.command.input",
      ...immediateSaleWriteFields.map((f) => `proposal.command.input.${f}`),
      ...saleEditWriteFields
        .filter((f) => f !== "reason")
        .map((f) => `proposal.input.${f}`),
      "expected",
      "payloadHash",
      "reason",
      "requestedBy",
      "requestedAt",
      "state",
      "reviewedBy",
      "reviewedAt",
      "reviewNote",
      "appliedCommandId",
    ],
    create: [
      "proposal",
      "proposal.kind",
      "proposal.operation",
      "proposal.input.cycleId",
      "proposal.input.date",
      "proposal.input.reason",
      "proposal.input.method",
      "proposal.input.proceeds",
      "proposal.input.receipt.amount",
      "proposal.input.receipt.date",
      "proposal.input.receipt.method",
      "proposal.input.receipt.reference",
      "proposal.command",
      "proposal.command.name",
      "proposal.command.input",
      ...immediateSaleWriteFields.map((f) => `proposal.command.input.${f}`),
      ...saleEditWriteFields
        .filter((f) => f !== "reason")
        .map((f) => `proposal.input.${f}`),
      "reason",
    ],
    approve: ["approvalId", "decision", "note"],
  },
  SaleCase: {
    read: [
      "id",
      "cycleId",
      "customerId",
      "revision",
      "kind",
      "state",
      "price",
      "reference",
      "tradeIn",
      "tradeIn.description",
      "tradeIn.value",
      "tradeIn.acquiredCycleId",
      "completion",
      "completion.id",
      "completion.date",
      "completion.mileage",
      "completion.basisVersionId",
      "payments",
      ...salePaymentFields.map((p) => `payments.${p}`),
      "timeline",
      "nextActions",
      "invoices",
      "provenance",
    ],
    create: [...immediateSaleWriteFields],
    update: [...saleEditWriteFields, "vehicle", "mileage", "listedPrice"],
    pay: ["amount", "date", "method", "reference"],
  },
  Disposal: {
    read: [
      "id",
      "date",
      "reason",
      "method",
      "proceeds",
      "basisVersionId",
      "approval.kind",
      "approval.approvalId",
      "approval.reviewerId",
      "approval.reviewerName",
      "approval.reviewedAt",
      "payments",
      ...sourcePaymentFields.map((f) => `payments.${f}`),
    ],
    create: [
      "cycleId",
      "date",
      "reason",
      "method",
      "proceeds",
      "receipt.amount",
      "receipt.date",
      "receipt.method",
      "receipt.reference",
    ],
    pay: [
      "receipt.amount",
      "receipt.date",
      "receipt.method",
      "receipt.reference",
    ],
  },
  Notification: {
    read: ["id", "revision", "kind", "target", "createdAt", "readAt"],
    update: ["readAt"],
  },
  RateSheet: {
    read: [
      "id",
      "revision",
      "companyId",
      "version",
      "make",
      "model",
      "year",
      "maximum",
      "validFrom",
      "validThrough",
      "publishedAt",
      "cards",
    ],
    create: [
      "companyId",
      "make",
      "model",
      "year",
      "maximum",
      "validFrom",
      "validThrough",
      "cards",
    ],
  },
  Quote: {
    read: [
      "id",
      "revision",
      "createdBy",
      "vehicle",
      "vehicle.make",
      "vehicle.model",
      "vehicle.year",
      "vehicle.description",
      "vehicle.engineNumber",
      "vehicle.chassisNumber",
      "sheetId",
      "sheetRevision",
      "cardId",
      "companyId",
      "companyRevision",
      "principal",
      "months",
      "installment",
      "maximum",
      "charges",
      "policy",
      "policy.path",
      "policy.commission.basis",
      "policy.commission.fixed",
      "policy.commission.rateBps",
      "policy.processingFee",
      "policy.reconciliationMethod",
      "expiresAt",
    ],
    create: ["sheetId", "cardId", "vehicle", "charges"],
  },
  AuditLog: {
    read: [
      "id",
      "entityType",
      "entityId",
      "action",
      "at",
      "actor",
      "reason",
      "fields",
    ],
  },
  ImportBatch: {
    create: ["types", "namespace"],
    read: [
      "id",
      "revision",
      "state",
      "types",
      "namespace",
      "createdAt",
      "uploads",
      "uploads.uploadId",
      "uploads.revision",
      "uploads.filename",
      "uploads.expiresAt",
      "uploads.state",
      "uploads.attachmentId",
      "uploads.claimExpiresAt",
    ],
    update: ["uploads"],
  },
  Document: {
    create: ["target", "purpose", "filename", "contentType", "size", "sha256"],
    read: [
      "uploadId",
      "revision",
      "filename",
      "expiresAt",
      "state",
      "attachmentId",
      "claimExpiresAt",
      "contentType",
      "size",
      "sha256",
      "bytes",
    ],
    update: ["uploadId"],
  },
} as const
// Registry v15: adds SaleCase + DISCOUNT/SALE_EDIT proposals + PurchaseRecord sales/profit/trade-in provenance.
export const registryVersion = 15
export type EnabledSubject = keyof typeof registry
const conditionKeys: Record<EnabledSubject, readonly string[]> = {
  ApprovalRequest: ["createdBy"],
  Disposal: ["createdBy"],
  SaleCase: ["createdBy", "customerId"],
  User: [],
  Role: [],
  Vehicle: ["createdBy", "status"],
  Customer: ["createdBy"],
  PurchaseRecord: ["createdBy"],
  VehicleCost: ["createdBy"],
  RepairRecord: ["createdBy"],
  Supplier: ["createdBy"],
  RepairVendor: ["createdBy"],
  FinanceCompany: ["createdBy"],
  Settings: [],
  Notification: ["recipientUserId"],
  AuditLog: [],
  RateSheet: ["createdBy", "financeCompanyId"],
  Quote: ["createdBy", "financeCompanyId"],
  ImportBatch: ["createdBy"],
  Document: ["createdBy"],
}
const conditionSchema = z
  .object({
    createdBy: z.literal("$actor.id").optional(),
    customerId: z.string().uuid().optional(),
    financeCompanyId: z.string().uuid().optional(),
    status: z.enum(states).optional(),
    recipientUserId: z.literal("$actor.id").optional(),
  })
  .strict()
export const grantSchema = z
  .object({
    action: z.enum([
      "create",
      "read",
      "update",
      "archive",
      "approve",
      "export",
      "receive",
      "release",
      "pay",
      "dispatch",
      "reconcile",
      "import",
      "run",
    ]),
    subject: z.string(),
    fields: z.array(z.string().min(1).max(100)).max(100),
    conditions: conditionSchema.optional(),
  })
  .strict()
  .superRefine((grant, ctx) => {
    const actions = registry[grant.subject as EnabledSubject] as
      | Record<string, readonly string[]>
      | undefined
    const fields = actions?.[grant.action]
    if (
      !fields ||
      grant.fields.some((f) => f !== "*" && !fields.includes(f)) ||
      Object.keys(grant.conditions ?? {}).some(
        (k) => !conditionKeys[grant.subject as EnabledSubject]?.includes(k)
      )
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Unsupported grant",
      })
  })

export function fieldsFor(
  type: EnabledSubject,
  action: string
): readonly string[] {
  return (registry[type] as Record<string, readonly string[]>)[action] ?? []
}
export function expanded(grant: Grant) {
  const universe = fieldsFor(grant.subject as EnabledSubject, grant.action)
  return universe.filter(
    (f) =>
      grant.fields.includes("*") ||
      grant.fields.some((parent) => f === parent || f.startsWith(`${parent}.`))
  )
}

/** One conjunction witness per field. Symbols keep eventual holders distinct
 * from the grantor; textual $actor.id equality is not transferable authority.
 * Registry expansion changes require stored-grant revalidation/migration. */
export function attenuation(
  ceiling: readonly Grant[],
  before: readonly Grant[],
  proposed: readonly Grant[],
  grantorId: string,
  recipientId?: string,
  universe: (
    type: EnabledSubject,
    action: string
  ) => readonly string[] = fieldsFor
) {
  const holder = Symbol("arbitrary eventual holder")
  const atoms = (grants: readonly Grant[], identity: string | symbol) =>
    grants.flatMap((g) =>
      universe(g.subject as EnabledSubject, g.action)
        .filter((field) =>
          g.fields.some(
            (p) => p === "*" || field === p || field.startsWith(`${p}.`)
          )
        )
        .map((field) => ({
          subject: g.subject,
          action: g.action,
          field,
          conditions: Object.fromEntries(
            Object.entries(g.conditions ?? {}).map(([k, v]) => [
              k,
              v === "$actor.id" ? identity : v,
            ])
          ),
        }))
    )
  type Atom = ReturnType<typeof atoms>[number]
  const same = (a: Atom, b: Atom) =>
    a.subject === b.subject && a.action === b.action && a.field === b.field
  const covered = (a: Atom, witnesses: Atom[]) =>
    witnesses.some(
      (b) =>
        same(a, b) &&
        Object.entries(b.conditions).every(([k, v]) => a.conditions[k] === v)
    )
  const old = atoms(before, holder)
  const next = atoms(proposed, holder)
  const changed = next.filter((a) => {
    const oldScope = old.filter((b) => same(a, b))
    const nextScope = next.filter((b) => same(a, b))
    return !nextScope.every((b) => covered(b, oldScope))
  })
  const authority = atoms(ceiling, grantorId)
  return {
    reduction: next.every((a) => covered(a, old)),
    covered:
      changed.every((a) => covered(a, authority)) &&
      (recipientId === undefined ||
        atoms(proposed, recipientId)
          .filter((a) => changed.some((b) => same(a, b)))
          .every((a) => covered(a, authority))),
  }
}

/** Canonical positive sets; rule/field order and duplicate rules confer no change. */
export function normalizedGrants(grants: readonly Grant[]) {
  return [
    ...new Set(
      grants
        .filter((g) => g.fields.length)
        .map((g) =>
          JSON.stringify([
            g.subject,
            g.action,
            [...new Set(expanded(g))].sort(),
            Object.entries(g.conditions ?? {}).sort(([a], [b]) =>
              a.localeCompare(b)
            ),
          ])
        )
    ),
  ]
    .sort()
    .join("\n")
}

export function configurableRegistry(
  grants: readonly Grant[],
  userId: string,
  administrator: boolean
) {
  const dto = permissionRegistryDTO()
  if (administrator) return dto
  return {
    ...dto,
    subjects: dto.subjects.flatMap((s) => {
      const actions = s.actions.flatMap((a) => {
        // The existing DTO cannot couple predicates to fields. Only advertise
        // unconditional field coverage; all advertised conditions then narrow it.
        const fields = a.fields.filter(
          (f) =>
            attenuation(
              grants,
              [],
              [{ subject: s.subject, action: a.action, fields: [f.path] }],
              userId
            ).covered
        )
        return fields.length ? [{ ...a, fields }] : []
      })
      return actions.length ? [{ ...s, actions }] : []
    }),
  }
}
export function abilityFor(grants: readonly Grant[], userId: string) {
  return createMongoAbility(
    grants
      .map((g) => grantSchema.parse(g) as Grant)
      .filter((g) => g.fields.length > 0)
      .map((g) => ({
        action: g.action,
        subject: g.subject,
        fields: expanded(g),
        conditions: g.conditions
          ? Object.fromEntries(
              Object.entries(g.conditions).map(([k, v]) => [
                k,
                v === "$actor.id" ? userId : v,
              ])
            )
          : undefined,
      }))
  )
}
export type Ability = ReturnType<typeof abilityFor>
export function requireFields(
  ability: Ability,
  type: EnabledSubject,
  action: string,
  row: Record<string, unknown>,
  fields: readonly string[]
) {
  const record = subject(type, row)
  if (!ability.can(action, record))
    fail(
      action === "read" ? "NOT_FOUND" : "FORBIDDEN",
      action === "read" ? 404 : 403
    )
  for (const field of fields)
    if (
      !fieldsFor(type, action).includes(field) ||
      !ability.can(action, record, field)
    )
      fail("FIELD_FORBIDDEN", 403)
}

/** Plain DTOs only; unknown keys never pass through, including nested objects. */
export function project(
  ability: Ability,
  type: EnabledSubject,
  row: Record<string, unknown>
): Record<string, unknown> & { redactedFields: string[] } {
  const record = subject(type, row)
  if (!ability.can("read", record)) fail("NOT_FOUND", 404)
  const redactedFields: string[] = []
  const visit = (
    value: Record<string, unknown>,
    prefix = ""
  ): Record<string, unknown> =>
    Object.fromEntries(
      Object.entries(value).flatMap(([key, data]) => {
        const path = prefix ? `${prefix}.${key}` : key
        const registered = fieldsFor(type, "read").includes(path)
        if (registered && ability.can("read", record, path))
          return [[key, data]]
        const hasChildren = fieldsFor(type, "read").some((f) =>
          f.startsWith(`${path}.`)
        )
        if (
          hasChildren &&
          data &&
          typeof data === "object" &&
          !Array.isArray(data)
        ) {
          const visible = visit(data as Record<string, unknown>, path)
          if (Object.keys(visible).length) return [[key, visible]]
        }
        redactedFields.push(path)
        return []
      })
    )
  return { ...visit(row), redactedFields }
}

/** Feed this into Prisma WHERE before count/order/page. Equality only, no SQL. */
export function readScope(
  grants: readonly Grant[],
  userId: string,
  type: EnabledSubject,
  requiredFields: readonly string[] = []
): { OR?: Record<string, string>[]; id?: { in: string[] } } {
  const rules = grants.filter(
    (g) => g.subject === type && g.action === "read" && g.fields.length > 0
  )
  const scope = (candidates: typeof rules) => ({
    OR: candidates.map((g) =>
      Object.fromEntries(
        Object.entries(g.conditions ?? {}).map(([k, v]) => [
          (type === "RateSheet" || type === "Quote") && k === "financeCompanyId"
            ? "companyId"
            : type === "ApprovalRequest" && k === "createdBy"
              ? "requestedBy"
              : k,
          v === "$actor.id" ? userId : v,
        ])
      )
    ),
  })
  for (const field of requiredFields)
    if (!fieldsFor(type, "read").includes(field)) fail("FIELD_FORBIDDEN", 403)
  // Every readable population needs a covering field witness. This permits
  // own-record lists without silently shrinking a mixed public/private union.
  for (const field of requiredFields)
    if (
      !rules.length ||
      !rules.every((population) =>
        rules.some(
          (g) =>
            expanded(g).includes(field) &&
            Object.entries(g.conditions ?? {}).every(
              ([key, value]) =>
                (
                  population.conditions as Record<string, unknown> | undefined
                )?.[key] === value
            )
        )
      )
    )
      fail("FIELD_FORBIDDEN", 403)
  // Empty OR is optimized away inside some nested AND shapes in Prisma 6.
  // Empty IN remains false under composition: default deny must be composable.
  if (!rules.length) return { id: { in: [] } }
  // Prisma treats OR:[{}] as an empty disjunction in some query shapes. An
  // unconditional positive grant means no row predicate, not an empty OR arm.
  return rules.some((g) => Object.keys(g.conditions ?? {}).length === 0)
    ? {}
    : scope(rules)
}

export const administratorGrants: Grant[] = Object.entries(registry).flatMap(
  ([name, actions]) =>
    Object.keys(actions).map((action) => ({
      subject: name as Subject,
      action: action as Grant["action"],
      fields:
        name === "PurchaseRecord" &&
        ["receive", "update", "release"].includes(action)
          ? [...fieldsFor("PurchaseRecord", action)]
          : name === "Settings" && action === "update"
            ? registry.Settings.update.filter((field) => field !== "company")
            : ["*"],
    }))
)

export function permissionRegistryDTO(): PermissionRegistryDTO {
  return {
    version: registryVersion,
    subjects: Object.entries(registry).map(([type, actions]) => ({
      subject: type as Subject,
      actions: Object.entries(actions).map(([action, fields]) => ({
        action: action as Grant["action"],
        fields: (fields as readonly string[]).map((path) => ({
          path,
          readable: action === "read",
          writable: action !== "read",
          dataType: [
            "roles",
            "roleIds",
            "grants",
            "fields",
            "links",
            "contacts",
            "directory.contacts",
          ].includes(path)
            ? "ARRAY"
            : [
                  "active",
                  "available",
                  "recurring",
                  "directory.recurring",
                ].includes(path)
              ? "BOOLEAN"
              : ["revision"].includes(path)
                ? "NUMBER"
                : [
                      "identity",
                      "financial",
                      "adminProtection",
                      "actor",
                      "target",
                      "provenance",
                      "patch.settlement",
                    ].includes(path)
                  ? "OBJECT"
                  : path === "listedPrice" ||
                      path === "purchasePrice" ||
                      path.startsWith("financial.") ||
                      /^(patch\.)?settlement\.(amount|cashToSeller)$/.test(path)
                    ? "MONEY"
                    : [
                          "createdAt",
                          "updatedAt",
                          "readAt",
                          "at",
                          "purchaseDate",
                        ].includes(path)
                      ? "DATE"
                      : "STRING",
        })),
        conditions: conditionKeys[type as EnabledSubject].map((key) => ({
          key: key as
            | "createdBy"
            | "customerId"
            | "status"
            | "recipientUserId"
            | "financeCompanyId",
          operator: "EQ" as const,
          valueType:
            key === "status"
              ? ("STATUS" as const)
              : key === "financeCompanyId" || key === "customerId"
                ? ("UUID" as const)
                : ("ACTOR_ID" as const),
          ...(key === "status" ? { allowedValues: [...states] } : {}),
        })),
      })),
    })),
  }
}
