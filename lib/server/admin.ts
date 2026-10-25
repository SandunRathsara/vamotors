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
import { project, requireFields } from "./permissions"
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
    grants: row.permissions.map((p) => p.permission.rule as unknown as Grant),
  }
}
export function requireAdministrator(actor: Actor) {
  // Initial admin surface cannot delegate/raise authority through a lesser role.
  if (!actor.administrator) fail("FORBIDDEN", 403)
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
async function validateRoles(
  tx: Tx,
  actor: Actor,
  ids: string[],
  expected: Expected,
  replay: boolean
) {
  const roles = await tx.role.findMany({
    where: { id: { in: ids } },
    orderBy: { id: "asc" },
  })
  if (roles.length !== ids.length) fail("NOT_FOUND", 404)
  for (const role of roles) {
    requireFields(actor.ability, "Role", "read", role, ["id", "revision"])
    if (!replay) {
      if (!role.active) fail("INVALID_STATE")
      expectRevision(expected, "Role", role.id, role.revision)
    }
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
  await database().$transaction(async (tx) => {
    await assertEnvironment(tx)
    requireAdministrator(await currentActor(tx, identity))
  })
  const parsed = envelopeSchema(name).safeParse(raw)
  if (!parsed.success) fail("INVALID_INPUT", 422)
  const envelope = parsed.data
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
    requireAdministrator(actor)
    const scope = {
      environmentId: config.ENVIRONMENT_ID,
      actorKey: `USER:${actor.userId}`,
      commandName: name,
      idempotencyKey: envelope.idempotencyKey,
    }
    const prior = await tx.commandReceipt.findUnique({
      where: { environmentId_actorKey_commandName_idempotencyKey: scope },
    })
    const replay = !!prior
    let before: Record<string, unknown> | null = null
    let after: Record<string, unknown>
    let type: "User" | "Role"
    let entityId: string
    const action =
      name === "createUser"
        ? "create"
        : name === "archiveRole"
          ? "archive"
          : name === "saveRole" && !(envelope.input as { id?: string }).id
            ? "create"
            : "update"
    const commandId = prior?.id ?? randomUUID()
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
      await validateRoles(tx, actor, input.roleIds, envelope.expected, replay)
      type = "User"
      if (prior) {
        const result = prior.result as { id: string }
        const row = await tx.user.findUnique({
          where: { id: result.id },
          include: userInclude,
        })
        if (!row) fail("NOT_FOUND", 404)
        after = userDTO(row)
        entityId = row.id
      } else {
        const userId = randomUUID()
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
      }
    } else if (name === "updateUser") {
      const input = commandInputs.updateUser.parse(envelope.input)
      const row = await tx.user.findUnique({
        where: { id: input.id },
        include: userInclude,
      })
      if (!row) fail("NOT_FOUND", 404)
      before = userDTO(row)
      requireFields(actor.ability, "User", "update", before, [
        "name",
        "active",
        "roleIds",
      ])
      await validateRoles(tx, actor, input.roleIds, envelope.expected, replay)
      type = "User"
      entityId = row.id
      reason = input.reason
      if (!replay) {
        expectRevision(envelope.expected, "User", row.id, row.authzRevision)
        await tx.userRole.deleteMany({ where: { userId: row.id } })
        await tx.userRole.createMany({
          data: input.roleIds.map((roleId) => ({
            userId: row.id,
            roleId,
            assignedBy: actor.userId,
          })),
        })
        await tx.user.update({
          where: { id: row.id },
          data: {
            name: input.name,
            active: input.active,
            authzRevision: increment(row.authzRevision),
          },
        })
        await ensureAdmin(tx)
      }
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
      requireFields(
        actor.ability,
        "Role",
        row ? "update" : "create",
        before ?? {},
        ["name", "grants"]
      )
      if (!replay && row?.systemKey) fail("SYSTEM_ROLE_PROTECTED")
      if (prior) {
        entityId = (prior.result as { id: string }).id
      } else {
        if (row) expectRevision(envelope.expected, "Role", row.id, row.revision)
        entityId = row?.id ?? randomUUID()
        await tx.role.upsert({
          where: { id: entityId },
          create: { id: entityId, name: input.name },
          update: { name: input.name, revision: increment(row?.revision ?? 0) },
        })
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
      requireFields(actor.ability, "Role", "archive", before, ["active"])
      type = "Role"
      entityId = row.id
      reason = input.reason
      if (!replay) {
        if (row.systemKey) fail("SYSTEM_ROLE_PROTECTED")
        expectRevision(envelope.expected, "Role", row.id, row.revision)
        await tx.role.update({
          where: { id: row.id },
          data: { active: false, revision: increment(row.revision) },
        })
      }
      after = roleDTO(
        (await tx.role.findUnique({
          where: { id: row.id },
          include: roleInclude,
        }))!
      )
    }
    // Reauthorize before exposing even the retained reference on every replay.
    project(actor.ability, type, after)
    requireFields(actor.ability, type, "read", after, ["id", "revision"])
    if (prior && prior.inputHash !== digest) fail("IDEMPOTENCY_MISMATCH")
    const result = { type, id: entityId, revision: after.revision as number }
    if (!replay) {
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
    }
    const original = prior ? (prior.result as typeof result) : result
    return {
      ok: true,
      status: "APPLIED",
      commandId,
      replayed: replay,
      result: original,
      affected: [{ type, id: entityId, revision: after.revision as number }],
      invalidate: ["users"],
    }
  })
}
