import "server-only"
import { z } from "zod"
import { database, assertEnvironment } from "./db"
import { currentActor, actorDTO, type Identity } from "./actor"
import { fail } from "./errors"
import {
  requireAdministrator,
  userDTO,
  roleDTO,
  userInclude,
  roleInclude,
} from "./admin"
import {
  project,
  readScope,
  requireFields,
  permissionRegistryDTO,
  type EnabledSubject,
} from "./permissions"
import { id, listParams } from "./validators"
import { adminList } from "./admin-list"

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
      const actor = await currentActor(tx, identity)
      const args = Object.fromEntries(params)
      if (name === "currentActor") {
        if (params.size) fail("INVALID_INPUT", 422)
        return actorDTO(actor)
      }
      if (name === "permissionRegistry") {
        if (params.size) fail("INVALID_INPUT", 422)
        requireAdministrator(actor)
        const registry = permissionRegistryDTO()
        // This endpoint advertises implemented administration/audit capabilities
        // only; other foundation policy primitives are not live domain services.
        return {
          ...registry,
          subjects: registry.subjects.filter((s) =>
            ["User", "Role", "AuditLog"].includes(s.subject)
          ),
        }
      }
      if (["users", "roles", "user", "role"].includes(name)) {
        requireAdministrator(actor)
        const type = name.startsWith("user") ? "User" : "Role"
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
            const isAdministrator = row.roles.some(
              (m) => m.role.systemKey === "ADMINISTRATOR" && m.role.active
            )
            const activeAdmins = await tx.user.count({
              where: {
                active: true,
                roles: {
                  some: { role: { systemKey: "ADMINISTRATOR", active: true } },
                },
              },
            })
            return project(actor.ability, "User", {
              ...userDTO(row),
              adminProtection: {
                isAdministrator,
                lastActiveAdministrator:
                  isAdministrator && row.active && activeAdmins === 1,
              },
            })
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
        if (type === "User") {
          const [rows, total, activeAdministrators] = await Promise.all([
            tx.user.findMany({ where, ...paging, include: userInclude }),
            tx.user.count({ where }),
            tx.user.count({
              where: {
                active: true,
                roles: {
                  some: { role: { systemKey: "ADMINISTRATOR", active: true } },
                },
              },
            }),
          ])
          return {
            ok: true,
            data: rows.map((r) => {
              const isAdministrator = r.roles.some(
                (membership) =>
                  membership.role.systemKey === "ADMINISTRATOR" &&
                  membership.role.active
              )
              return project(actor.ability, "User", {
                ...userDTO(r),
                adminProtection: {
                  isAdministrator,
                  lastActiveAdministrator:
                    isAdministrator && r.active && activeAdministrators === 1,
                },
              })
            }),
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
        requireAdministrator(actor)
        const parsed = listParams
          .extend({ type: z.enum(["User", "Role"]), id })
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
            : await tx.role.findUnique({
                where: { id: entityId },
                include: roleInclude,
              })
        if (!row) fail("NOT_FOUND", 404)
        requireFields(actor.ability, entityType, "read", row, ["id"])
        const where = { entityType, entityId }
        const [entries, total] = await Promise.all([
          tx.auditEntry.findMany({
            where,
            orderBy: [{ recordedAt: "asc" }, { id: "asc" }],
            skip: (page - 1) * pageSize,
            take: pageSize,
          }),
          tx.auditEntry.count({ where }),
        ])
        const data = entries.map((entry) => {
          const fields = entry.fieldDiff as Record<string, unknown>
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
                return false
              }
            })
            .map(([path, value]) => ({
              path,
              ...(value as { before: unknown; after: unknown }),
            }))
          return project(actor.ability, "AuditLog", {
            id: entry.id,
            entityType,
            entityId,
            action: entry.action,
            at: entry.recordedAt.toISOString(),
            actor: { kind: entry.actorKind, userId: entry.userId },
            reason: entry.reason,
            fields: diff,
          })
        })
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
    { isolationLevel: "RepeatableRead", timeout: 5000 }
  )
}
