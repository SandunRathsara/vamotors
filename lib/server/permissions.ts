import { createMongoAbility, subject } from "@casl/ability"
import { z } from "zod"
import type {
  Grant,
  Subject,
  PermissionRegistryDTO,
} from "../../.planning/implementation/contracts/api"
import { fail } from "./errors"
import { states } from "../state"

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
  // Customer history links only; no purchase lifecycle command/query enabled.
  PurchaseRecord: { read: ["id", "purchaseDate", "status", "purchasePrice"] },
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
  Notification: {
    read: ["id", "revision", "kind", "target", "createdAt", "readAt"],
    update: ["readAt"],
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
} as const
export const registryVersion = 5
export type EnabledSubject = keyof typeof registry
const conditionKeys: Record<EnabledSubject, readonly string[]> = {
  User: [],
  Role: [],
  Vehicle: ["createdBy", "status"],
  Customer: ["createdBy"],
  PurchaseRecord: ["createdBy"],
  Supplier: ["createdBy"],
  RepairVendor: ["createdBy"],
  FinanceCompany: ["createdBy"],
  Settings: [],
  Notification: ["recipientUserId"],
  AuditLog: [],
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
) {
  const rules = grants.filter(
    (g) => g.subject === type && g.action === "read" && g.fields.length > 0
  )
  const scope = (candidates: typeof rules) => ({
    OR: candidates.map((g) =>
      Object.fromEntries(
        Object.entries(g.conditions ?? {}).map(([k, v]) => [
          k,
          v === "$actor.id" ? userId : v,
        ])
      )
    ),
  })
  for (const field of requiredFields)
    if (!fieldsFor(type, "read").includes(field)) fail("FIELD_FORBIDDEN", 403)
  // Never silently shrink population to hide a forbidden sort/filter input.
  // Initial lists support those fields only with an unconditional field grant.
  for (const field of requiredFields)
    if (
      !rules.some(
        (g) =>
          Object.keys(g.conditions ?? {}).length === 0 &&
          expanded(g).includes(field)
      )
    )
      fail("FIELD_FORBIDDEN", 403)
  return scope(rules)
}

export const administratorGrants: Grant[] = Object.entries(registry).flatMap(
  ([name, actions]) =>
    Object.keys(actions).map((action) => ({
      subject: name as Subject,
      action: action as Grant["action"],
      fields:
        name === "Settings" && action === "update"
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
                    ].includes(path)
                  ? "OBJECT"
                  : path === "listedPrice" ||
                      path === "purchasePrice" ||
                      path.startsWith("financial.")
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
          key: key as "createdBy" | "status" | "recipientUserId",
          operator: "EQ" as const,
          valueType:
            key === "status" ? ("STATUS" as const) : ("ACTOR_ID" as const),
          ...(key === "status" ? { allowedValues: [...states] } : {}),
        })),
      })),
    })),
  }
}
