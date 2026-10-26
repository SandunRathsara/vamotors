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
    ],
  },
  Supplier: {
    read: ["id", "revision", "name", "category", "active", "contacts"],
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
export type EnabledSubject = keyof typeof registry
const conditionKeys: Record<EnabledSubject, readonly string[]> = {
  User: [],
  Role: [],
  Vehicle: ["createdBy", "status"],
  Customer: ["createdBy"],
  Supplier: ["createdBy"],
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
function expanded(grant: Grant) {
  const universe = fieldsFor(grant.subject as EnabledSubject, grant.action)
  return universe.filter(
    (f) =>
      grant.fields.includes("*") ||
      grant.fields.some((parent) => f === parent || f.startsWith(`${parent}.`))
  )
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
      fields: ["*"],
    }))
)

export function permissionRegistryDTO(): PermissionRegistryDTO {
  return {
    version: 1,
    subjects: Object.entries(registry).map(([type, actions]) => ({
      subject: type as Subject,
      actions: Object.entries(actions).map(([action, fields]) => ({
        action: action as Grant["action"],
        fields: (fields as readonly string[]).map((path) => ({
          path,
          readable: action === "read",
          writable: action !== "read",
          dataType: ["roles", "roleIds", "grants", "fields"].includes(path)
            ? "ARRAY"
            : ["active", "available"].includes(path)
              ? "BOOLEAN"
              : ["revision"].includes(path)
                ? "NUMBER"
                : [
                      "identity",
                      "financial",
                      "adminProtection",
                      "actor",
                      "target",
                    ].includes(path)
                  ? "OBJECT"
                  : path === "listedPrice" || path.startsWith("financial.")
                    ? "MONEY"
                    : ["createdAt", "updatedAt", "readAt", "at"].includes(path)
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
