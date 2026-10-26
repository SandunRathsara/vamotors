import "server-only"
import { randomUUID } from "node:crypto"
import { hashPassword } from "better-auth/crypto"
import type { Prisma } from "@prisma/client"
import type {
  Applied,
  Grant,
  UserAdminDTO,
  RoleDTO,
} from "../../.planning/implementation/contracts/api"
import { database, assertEnvironment, type Tx } from "./db"
import { currentActor, type Actor, type Identity } from "./actor"
import { runtimeConfig } from "./config"
import { fail } from "./errors"
import { commandInputs, envelopeSchema, type CommandName } from "./validators"
import { inputDigest, canonical } from "./idempotency"
import {
  attenuation,
  normalizedGrants,
  requireFields,
  grantSchema,
} from "./permissions"
import { transaction } from "./transactions"
import { audit } from "./audit"
import { createHash } from "node:crypto"

export const userInclude = {
  roles: {
    include: {
      role: { include: { permissions: { include: { permission: true } } } },
    },
  },
} satisfies Prisma.UserInclude
type UserRow = Prisma.UserGetPayload<{ include: typeof userInclude }>
export function userDTO(row: UserRow): UserAdminDTO {
  const roles = row.roles
    .map((m) => m.role)
    .filter((r) => r.active)
    .sort((a, b) => a.id.localeCompare(b.id))
  const authzRevision = createHash("sha256")
    .update(
      JSON.stringify([
        row.id,
        row.active,
        row.authzRevision,
        roles.map((r) => [
          r.id,
          r.revision,
          r.permissions.map((p) => p.permission.ruleHash).sort(),
        ]),
      ])
    )
    .digest("hex")
  return {
    id: row.id,
    revision: row.authzRevision,
    name: row.name,
    email: row.email,
    active: row.active,
    authzRevision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    roles: row.roles.map((m) => ({
      id: m.roleId,
      name: m.role.name,
      revision: m.role.revision,
    })),
  }
}
export const roleInclude = {
  permissions: { include: { permission: true } },
} satisfies Prisma.RoleInclude
type RoleRow = Prisma.RoleGetPayload<{ include: typeof roleInclude }>
export function roleDTO(row: RoleRow): RoleDTO {
  return {
    id: row.id,
    revision: row.revision,
    name: row.name,
    active: row.active,
    systemKey: row.systemKey as "ADMINISTRATOR" | null,
    grants: row.permissions.map(
      (p) => grantSchema.parse(p.permission.rule) as Grant
    ),
  }
}
function increment(revision: number) {
  if (revision >= 2147483647) fail("REVISION_EXHAUSTED")
  return revision + 1
}
type Expected = { type: "User" | "Role"; id: string; revision: number }[]
function expectRevision(
  expected: Expected,
  type: "User" | "Role",
  id: string,
  actual: number
) {
  const ref = expected.find((r) => r.type === type && r.id === id)
  if (!ref) fail("REVISION_REQUIRED", 428)
  if (ref.revision !== actual) fail("STALE_REVISION")
}
async function validateRoles(tx: Tx, actor: Actor, ids: string[]) {
  const roles = await tx.role.findMany({
    where: { id: { in: ids } },
    orderBy: { id: "asc" },
    include: roleInclude,
  })
  if (roles.length !== ids.length) fail("NOT_FOUND", 404)
  for (const role of roles)
    requireFields(actor.ability, "Role", "read", role, ["id", "revision"])
  return roles
}
function validateRoleRevisions(roles: RoleRow[], expected: Expected) {
  for (const role of roles) {
    if (!role.active) fail("INVALID_STATE")
    expectRevision(expected, "Role", role.id, role.revision)
  }
}

function cover(
  actor: Actor,
  proposed: Grant[],
  before: Grant[] = [],
  recipient?: string
) {
  if (
    !actor.administrator &&
    !attenuation(actor.grants, before, proposed, actor.userId, recipient)
      .covered
  )
    fail("FORBIDDEN", 403)
}
function sameIds(a: string[], b: string[]) {
  return a.length === b.length && a.every((id) => b.includes(id))
}
function transfer(actor: Actor, roles: RoleRow[], recipient: string) {
  for (const role of roles) {
    requireFields(actor.ability, "Role", "read", role, ["grants"])
    if (role.systemKey && !actor.administrator) fail("FORBIDDEN", 403)
    cover(actor, roleDTO(role).grants, [], recipient)
  }
}
async function ensureAdmin(tx: Tx) {
  const count = await tx.user.count({
    where: {
      active: true,
      roles: { some: { role: { active: true, systemKey: "ADMINISTRATOR" } } },
    },
  })
  if (count < 1) fail("LAST_ADMIN")
}

export async function executeAdmin(
  identity: Identity,
  name: CommandName,
  raw: unknown
): Promise<Applied> {
  const preflight = await database().$transaction(async (tx) => {
    await assertEnvironment(tx)
    return currentActor(tx, identity)
  })
  const parsed = envelopeSchema(name).safeParse(raw)
  if (!parsed.success) fail("INVALID_INPUT", 422)
  const envelope = parsed.data
  const action =
    name === "createUser" ||
    (name === "saveRole" && !(envelope.input as { id?: string }).id)
      ? "create"
      : name === "archiveRole"
        ? "archive"
        : "update"
  const commandType =
    name === "createUser" || name === "updateUser" ? "User" : "Role"
  // Coarse denial only, before expensive credential hashing. This snapshot never
  // authorizes execution/replay: both reload actual records under the guard.
  if (!preflight.ability.can(action, commandType)) fail("FORBIDDEN", 403)
  const config = runtimeConfig()
  const digest = inputDigest(envelope, config.BETTER_AUTH_SECRET)
  // Hash outside DB transaction; after authentication and strict validation.
  const passwordHash =
    name === "createUser"
      ? await hashPassword(
          commandInputs.createUser.parse(envelope.input).password
        )
      : undefined
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
    // REPLAY-REFERENCE is deliberately separate: receipts contain no historical
    // grant/membership delta. Never compare today's graph to the old payload.
    if (prior) {
      const type =
        name === "createUser" || name === "updateUser" ? "User" : "Role"
      const input = envelope.input as { id?: string; roleIds?: string[] }
      const result = prior.result as {
        type: string
        id: string
        revision: number
      }
      if (
        result.type !== type ||
        !result.id ||
        !Number.isInteger(result.revision)
      )
        fail("INTERNAL_ERROR", 500)
      const row =
        type === "User"
          ? await tx.user.findUnique({
              where: { id: result.id },
              include: userInclude,
            })
          : await tx.role.findUnique({
              where: { id: result.id },
              include: roleInclude,
            })
      if (!row) fail("NOT_FOUND", 404)
      const current =
        type === "User" ? userDTO(row as UserRow) : roleDTO(row as RoleRow)
      requireFields(actor.ability, type, action, current, [])
      requireFields(actor.ability, type, "read", current, ["id", "revision"])
      if (input.roleIds) await validateRoles(tx, actor, input.roleIds)
      // Also authorize a changed supplied target before reporting a mismatch.
      if (input.id && input.id !== result.id) {
        const supplied =
          type === "User"
            ? await tx.user.findUnique({ where: { id: input.id } })
            : await tx.role.findUnique({ where: { id: input.id } })
        if (!supplied) fail("NOT_FOUND", 404)
        requireFields(actor.ability, type, action, supplied, [])
        requireFields(actor.ability, type, "read", supplied, ["id", "revision"])
      }
      if (prior.inputHash !== digest || (input.id && input.id !== result.id))
        fail("IDEMPOTENCY_MISMATCH")
      return {
        ok: true,
        status: "APPLIED",
        commandId: prior.id,
        replayed: true,
        result: { type, id: result.id, revision: result.revision },
        affected: [{ type, id: result.id, revision: current.revision }],
        invalidate: ["users"],
      } as Applied
    }
    let before: Record<string, unknown> | null = null
    let after: Record<string, unknown>
    let type: "User" | "Role"
    let entityId: string
    const commandId = randomUUID()
    let reason: string | undefined

    if (name === "createUser") {
      const input = commandInputs.createUser.parse(envelope.input)
      requireFields(
        actor.ability,
        "User",
        "create",
        { createdBy: actor.userId },
        ["name", "email", "password", "roleIds"]
      )
      const assigned = await validateRoles(tx, actor, input.roleIds)
      const recipientId = randomUUID()
      transfer(actor, assigned, recipientId)
      validateRoleRevisions(assigned, envelope.expected)
      type = "User"
      const userId = recipientId
      const row = await tx.user.create({
        data: {
          id: userId,
          name: input.name,
          email: input.email,
          accounts: {
            create: {
              id: randomUUID(),
              providerId: "credential",
              accountId: userId,
              password: passwordHash,
            },
          },
        },
        include: userInclude,
      })
      await tx.userRole.createMany({
        data: input.roleIds.map((roleId) => ({
          userId: row.id,
          roleId,
          assignedBy: actor.userId,
        })),
      })
      after = userDTO(
        (await tx.user.findUnique({
          where: { id: row.id },
          include: userInclude,
        }))!
      )
      entityId = row.id
    } else if (name === "updateUser") {
      const input = commandInputs.updateUser.parse(envelope.input)
      const row = await tx.user.findUnique({
        where: { id: input.id },
        include: userInclude,
      })
      if (!row) fail("NOT_FOUND", 404)
      before = userDTO(row)
      requireFields(actor.ability, "User", "read", before, ["id", "revision"])
      const oldIds = row.roles.map((r) => r.roleId)
      const membershipChanged = !sameIds(oldIds, input.roleIds)
      const changed = [
        ...(row.name !== input.name ? ["name"] : []),
        ...(row.active !== input.active ? ["active"] : []),
        ...(membershipChanged ? ["roleIds"] : []),
      ]
      requireFields(actor.ability, "User", "update", before, changed)
      // Read every required reference before any revision/state diagnostics.
      await validateRoles(tx, actor, [
        ...new Set([...oldIds, ...input.roleIds]),
      ])
      const assigned = await validateRoles(tx, actor, input.roleIds)
      const protectedBefore = row.roles.some(
        (r) => r.role.systemKey === "ADMINISTRATOR"
      )
      const protectedAfter = assigned.some(
        (r) => r.systemKey === "ADMINISTRATOR"
      )
      if (
        !actor.administrator &&
        ((protectedBefore && row.active !== input.active) ||
          protectedBefore !== protectedAfter)
      )
        fail("FORBIDDEN", 403)
      transfer(
        actor,
        assigned.filter(
          (r) => !oldIds.includes(r.id) || (!row.active && input.active)
        ),
        row.id
      )
      validateRoleRevisions(assigned, envelope.expected)
      type = "User"
      entityId = row.id
      reason = input.reason
      expectRevision(envelope.expected, "User", row.id, row.authzRevision)
      if (membershipChanged) {
        await tx.userRole.deleteMany({ where: { userId: row.id } })
        await tx.userRole.createMany({
          data: input.roleIds.map((roleId) => ({
            userId: row.id,
            roleId,
            assignedBy: actor.userId,
          })),
        })
      }
      await tx.user.update({
        where: { id: row.id },
        data: {
          name: input.name,
          active: input.active,
          authzRevision: increment(row.authzRevision),
        },
      })
      await ensureAdmin(tx)
      after = userDTO(
        (await tx.user.findUnique({
          where: { id: row.id },
          include: userInclude,
        }))!
      )
    } else if (name === "saveRole") {
      const input = commandInputs.saveRole.parse(envelope.input)
      const row = input.id
        ? await tx.role.findUnique({
            where: { id: input.id },
            include: roleInclude,
          })
        : null
      if (input.id && !row) fail("NOT_FOUND", 404)
      type = "Role"
      reason = input.reason
      before = row ? roleDTO(row) : null
      if (before)
        requireFields(actor.ability, "Role", "read", before, ["id", "revision"])
      const grantsChanged =
        !row ||
        normalizedGrants(roleDTO(row).grants) !==
          normalizedGrants(input.grants as Grant[])
      requireFields(
        actor.ability,
        "Role",
        row ? "update" : "create",
        before ?? {},
        [
          ...(!row || row.name !== input.name ? ["name"] : []),
          ...(grantsChanged ? ["grants"] : []),
        ]
      )
      if (row?.systemKey) fail("SYSTEM_ROLE_PROTECTED")
      if (grantsChanged) {
        if (row)
          requireFields(actor.ability, "Role", "read", before!, ["grants"])
        cover(actor, input.grants as Grant[], row ? roleDTO(row).grants : [])
      }
      if (row) expectRevision(envelope.expected, "Role", row.id, row.revision)
      entityId = row?.id ?? randomUUID()
      await tx.role.upsert({
        where: { id: entityId },
        create: { id: entityId, name: input.name },
        update: { name: input.name, revision: increment(row?.revision ?? 0) },
      })
      if (grantsChanged) {
        await tx.rolePermission.deleteMany({ where: { roleId: entityId } })
        for (const rule of input.grants) {
          const ruleHash = createHash("sha256")
            .update(canonical(rule))
            .digest("hex")
          const permission = await tx.permission.upsert({
            where: { ruleHash },
            create: { ruleHash, rule: rule as Prisma.InputJsonObject },
            update: {},
          })
          await tx.rolePermission.upsert({
            where: {
              roleId_permissionId: {
                roleId: entityId,
                permissionId: permission.id,
              },
            },
            create: { roleId: entityId, permissionId: permission.id },
            update: {},
          })
        }
      }
      after = roleDTO(
        (await tx.role.findUnique({
          where: { id: entityId },
          include: roleInclude,
        }))!
      )
    } else {
      const input = commandInputs.archiveRole.parse(envelope.input)
      const row = await tx.role.findUnique({
        where: { id: input.id },
        include: roleInclude,
      })
      if (!row) fail("NOT_FOUND", 404)
      before = roleDTO(row)
      requireFields(actor.ability, "Role", "read", before, ["id", "revision"])
      requireFields(
        actor.ability,
        "Role",
        "archive",
        before,
        row.active ? ["active"] : []
      )
      type = "Role"
      entityId = row.id
      reason = input.reason
      if (row.systemKey) fail("SYSTEM_ROLE_PROTECTED")
      expectRevision(envelope.expected, "Role", row.id, row.revision)
      await tx.role.update({
        where: { id: row.id },
        data: { active: false, revision: increment(row.revision) },
      })
      after = roleDTO(
        (await tx.role.findUnique({
          where: { id: row.id },
          include: roleInclude,
        }))!
      )
    }
    // The pre-change actor authorizes even a successful self-reduction response.
    requireFields(actor.ability, type, "read", after, ["id", "revision"])
    const result = { type, id: entityId, revision: after.revision as number }
    await tx.commandReceipt.create({
      data: { id: commandId, ...scope, inputHash: digest, result },
    })
    await audit(tx, {
      commandId,
      userId: actor.userId,
      entityType: type,
      entityId,
      action,
      reason,
      before,
      after,
    })
    return {
      ok: true,
      status: "APPLIED",
      commandId,
      replayed: false,
      result,
      affected: [{ type, id: entityId, revision: after.revision as number }],
      invalidate: ["users"],
    }
  })
}
