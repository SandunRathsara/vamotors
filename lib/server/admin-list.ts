import { z } from "zod"
import type { Prisma } from "@prisma/client"
import type { Actor } from "./actor"
import { fail } from "./errors"
import { readScope } from "./permissions"
import { id, listParams } from "./validators"

const boolean = z.enum(["true", "false"]).transform((v) => v === "true")
const sortSchema = z
  .array(
    z.object({ field: z.string(), direction: z.enum(["asc", "desc"]) }).strict()
  )
  .max(3)
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(`${s}T00:00:00.000Z`)
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s
  })

export function adminList(
  actor: Pick<Actor, "grants" | "userId">,
  type: "User" | "Role",
  args: Record<string, string>
) {
  const common = listParams.extend({
    q: z.string().trim().max(200).optional(),
    active: boolean.optional(),
    sort: z.string().max(1000).optional(),
  })
  const parsed = (
    type === "User"
      ? common.extend({
          roleId: id.optional(),
          from: date.optional(),
          through: date.optional(),
        })
      : common
  )
    .strict()
    .safeParse(args)
  if (!parsed.success) fail("INVALID_INPUT", 422)
  const input = parsed.data as z.infer<typeof common> & {
    roleId?: string
    from?: string
    through?: string
  }
  let raw: unknown = [{ field: "id", direction: "asc" }]
  try {
    if (input.sort) raw = JSON.parse(input.sort)
  } catch {
    fail("INVALID_INPUT", 422)
  }
  const sort = sortSchema.safeParse(raw)
  if (
    !sort.success ||
    new Set(sort.data.map((s) => s.field)).size !== sort.data.length
  )
    fail("INVALID_INPUT", 422)
  const sortable =
    type === "User"
      ? ["id", "name", "email", "active", "createdAt", "updatedAt"]
      : ["id", "name", "active"]
  const required = sort.data.map((s) => s.field)
  if (required.some((field) => !sortable.includes(field)))
    fail("FIELD_FORBIDDEN", 403)
  if (input.q)
    required.push(...(type === "User" ? ["name", "email"] : ["name"]))
  if (input.active !== undefined) required.push("active")
  if (input.roleId) required.push("roles")
  if (input.from || input.through) required.push("createdAt")
  if (input.from && input.through && input.from > input.through)
    fail("INVALID_INPUT", 422)
  const scope = readScope(actor.grants, actor.userId, type, [...required, "id"])
  // Escape LIKE metacharacters: q is literal text, not a caller-controlled pattern.
  const q = input.q?.replace(/[\\%_]/g, "\\$&")
  const filters = {
    ...(input.active !== undefined ? { active: input.active } : {}),
    ...(q
      ? {
          OR: (type === "User" ? ["name", "email"] : ["name"]).map((field) => ({
            [field]: { contains: q, mode: "insensitive" },
          })),
        }
      : {}),
    ...(input.roleId ? { roles: { some: { roleId: input.roleId } } } : {}),
    ...(input.from || input.through
      ? {
          createdAt: {
            ...(input.from
              ? { gte: new Date(`${input.from}T00:00:00+05:30`) }
              : {}),
            ...(input.through
              ? {
                  lt: new Date(
                    new Date(`${input.through}T00:00:00+05:30`).getTime() +
                      86400000
                  ),
                }
              : {}),
          },
        }
      : {}),
  }
  const orderBy = [
    ...sort.data.map((s) => ({ [s.field]: s.direction })),
    ...(required.includes("id") ? [] : [{ id: "asc" as const }]),
  ]
  return {
    page: input.page,
    pageSize: input.pageSize,
    where: { AND: [scope, filters] } as Prisma.UserWhereInput &
      Prisma.RoleWhereInput,
    paging: {
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      orderBy,
    },
  }
}
