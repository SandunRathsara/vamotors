import { createHash, timingSafeEqual } from "node:crypto"
import { hashPassword } from "better-auth/crypto"
import { z } from "zod"
import type { Prisma } from "@prisma/client"
import { createDatabase } from "../lib/server/db"
import {
  administratorGrants,
  type EnabledSubject,
} from "../lib/server/permissions"
import { canonical, inputDigest } from "../lib/server/idempotency"
import { audit } from "../lib/server/audit"
import { authorizedMigration, privateEnvironment } from "./private-environment"

export const seedIds = {
  administratorRole: "03000000-0000-4000-8000-000000000001",
  readerRole: "03000000-0000-4000-8000-000000000002",
  financeRole: "03000000-0000-4000-8000-000000000003",
  admin: "03000000-0000-4000-8000-000000000011",
  second: "03000000-0000-4000-8000-000000000012",
  staff: "03000000-0000-4000-8000-000000000013",
  bootstrapCommand: "03000000-0000-4000-8000-000000000021",
} as const

async function main() {
  const migration = await privateEnvironment(process.argv[2] ?? "")
  const privateInput = await privateEnvironment(process.argv[3] ?? "")
  const url = authorizedMigration(migration)
  const input = z
    .object({
      BOOTSTRAP_TOKEN: z.string().regex(/^[a-f0-9]{64}$/),
      BOOTSTRAP_ADMIN_EMAIL: z
        .string()
        .email()
        .max(254)
        .transform((s) => s.toLowerCase()),
      BOOTSTRAP_ADMIN_PASSWORD: z.string().min(12).max(128),
      BOOTSTRAP_SECOND_EMAIL: z
        .string()
        .email()
        .max(254)
        .transform((s) => s.toLowerCase()),
      BOOTSTRAP_SECOND_PASSWORD: z.string().min(12).max(128),
      BOOTSTRAP_STAFF_EMAIL: z
        .string()
        .email()
        .max(254)
        .transform((s) => s.toLowerCase()),
      BOOTSTRAP_STAFF_PASSWORD: z.string().min(12).max(128),
    })
    .parse(privateInput)
  if (
    new Set([
      input.BOOTSTRAP_ADMIN_EMAIL,
      input.BOOTSTRAP_SECOND_EMAIL,
      input.BOOTSTRAP_STAFF_EMAIL,
    ]).size !== 3 ||
    new Set([
      input.BOOTSTRAP_ADMIN_PASSWORD,
      input.BOOTSTRAP_SECOND_PASSWORD,
      input.BOOTSTRAP_STAFF_PASSWORD,
    ]).size !== 3
  )
    throw new Error("DISTINCT_PRIVATE_ACCOUNTS_REQUIRED")
  const users = [
    {
      id: seedIds.admin,
      name: "Synthetic Administrator A",
      email: input.BOOTSTRAP_ADMIN_EMAIL,
      password: input.BOOTSTRAP_ADMIN_PASSWORD,
      roles: [seedIds.administratorRole],
    },
    {
      id: seedIds.second,
      name: "Synthetic Administrator B",
      email: input.BOOTSTRAP_SECOND_EMAIL,
      password: input.BOOTSTRAP_SECOND_PASSWORD,
      roles: [seedIds.administratorRole],
    },
    {
      id: seedIds.staff,
      name: "Synthetic Restricted Staff",
      email: input.BOOTSTRAP_STAFF_EMAIL,
      password: input.BOOTSTRAP_STAFF_PASSWORD,
      roles: [seedIds.readerRole, seedIds.financeRole],
    },
  ]
  const hashed = await Promise.all(
    users.map(async (u) => ({ ...u, hash: await hashPassword(u.password) }))
  )
  const db = createDatabase(url)
  try {
    await db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT vamotors.lock_admin_guard()`
        const environment = await tx.environment.findUnique({
          where: { singleton: 1 },
        })
        const digest = createHash("sha256")
          .update(input.BOOTSTRAP_TOKEN)
          .digest("hex")
        if (
          !environment ||
          environment.id !== migration.ENVIRONMENT_ID ||
          environment.name !== "disposable-test" ||
          !environment.disposableTest ||
          environment.bootstrappedAt ||
          !environment.bootstrapExpiresAt ||
          environment.bootstrapExpiresAt <= new Date() ||
          !environment.bootstrapTokenHash ||
          !timingSafeEqual(
            Buffer.from(environment.bootstrapTokenHash, "hex"),
            Buffer.from(digest, "hex")
          ) ||
          (await tx.user.count()) !== 0
        )
          throw new Error("BOOTSTRAP_UNAVAILABLE")
        const roles = [
          {
            id: seedIds.administratorRole,
            name: "Administrator",
            systemKey: "ADMINISTRATOR",
            grants: administratorGrants,
          },
          {
            id: seedIds.readerRole,
            name: "Stock Reader",
            systemKey: null,
            grants: [
              {
                subject: "Vehicle" as const,
                action: "read" as const,
                fields: [
                  "id",
                  "identity",
                  "status",
                  "available",
                  "cycleId",
                  "revision",
                ],
              },
            ],
          },
          {
            id: seedIds.financeRole,
            name: "Own Stock Finance",
            systemKey: null,
            grants: [
              {
                subject: "Vehicle" as const,
                action: "read" as const,
                fields: ["listedPrice", "financial"],
                conditions: { createdBy: "$actor.id" as const },
              },
            ],
          },
        ]
        for (const role of roles) {
          await tx.role.create({
            data: { id: role.id, name: role.name, systemKey: role.systemKey },
          })
          for (const rule of role.grants) {
            const ruleHash = createHash("sha256")
              .update(canonical(rule))
              .digest("hex")
            const permission = await tx.permission.upsert({
              where: { ruleHash },
              create: { ruleHash, rule: rule as Prisma.InputJsonObject },
              update: {},
            })
            await tx.rolePermission.create({
              data: { roleId: role.id, permissionId: permission.id },
            })
          }
        }
        for (const user of hashed) {
          await tx.user.create({
            data: {
              id: user.id,
              name: user.name,
              email: user.email,
              accounts: {
                create: {
                  accountId: user.id,
                  providerId: "credential",
                  password: user.hash,
                },
              },
            },
          })
        }
        for (const user of users)
          for (const roleId of user.roles)
            await tx.userRole.create({
              data: { userId: user.id, roleId, assignedBy: seedIds.admin },
            })
        await tx.commandReceipt.create({
          data: {
            id: seedIds.bootstrapCommand,
            environmentId: environment.id,
            actorKey: "OPERATOR:BOOTSTRAP",
            commandName: "bootstrap",
            idempotencyKey: seedIds.bootstrapCommand,
            inputHash: inputDigest(
              { environmentId: environment.id },
              input.BOOTSTRAP_TOKEN
            ),
            result: { type: "User", id: seedIds.admin, revision: 1 },
          },
        })
        for (const user of users)
          await audit(tx, {
            commandId: seedIds.bootstrapCommand,
            userId: seedIds.admin,
            entityType: "User",
            entityId: user.id,
            action: "create",
            before: null,
            after: {
              id: user.id,
              revision: 1,
              name: user.name,
              email: user.email,
              active: true,
              roles: user.roles.map((id) => ({
                id,
                name: roles.find((r) => r.id === id)!.name,
                revision: 1,
              })),
            },
          })
        for (const role of roles)
          await audit(tx, {
            commandId: seedIds.bootstrapCommand,
            userId: seedIds.admin,
            entityType: "Role" as EnabledSubject,
            entityId: role.id,
            action: "create",
            before: null,
            after: {
              id: role.id,
              revision: 1,
              name: role.name,
              active: true,
              grants: role.grants,
              systemKey: role.systemKey,
            },
          })
        await tx.environment.update({
          where: { singleton: 1 },
          data: {
            bootstrappedAt: new Date(),
            bootstrapTokenHash: null,
            bootstrapExpiresAt: null,
          },
        })
        await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE")
      },
      { isolationLevel: "Serializable", timeout: 20000 }
    )
    console.log(
      "Private deterministic synthetic seed committed: two administrators and one restricted staff; no credentials printed."
    )
  } finally {
    await db.$disconnect()
  }
}
if (process.argv[1]?.endsWith("bootstrap-security.ts")) {
  main().catch(() => {
    console.error("Bootstrap failed; no secret diagnostics emitted.")
    process.exitCode = 1
  })
}
