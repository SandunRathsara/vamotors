/** Fail-closed grant validation and once-only owner initialization for local Settings. */
import { createHash, randomUUID } from "node:crypto"
import { createDatabase } from "../lib/server/db"
import { canonical } from "../lib/server/idempotency"
import { grantSchema } from "../lib/server/permissions"
import { authorizedMigration, privateEnvironment } from "./private-environment"
import { settingsInput } from "../lib/server/validators"
import { nextBusinessSequence } from "../lib/server/transactions"
import { audit, writeReadVersion } from "../lib/server/audit"
const env = await privateEnvironment(process.argv[2] ?? "")
const db = createDatabase(authorizedMigration(env))
try {
  // Owner-only local initialization, once, after private actors exist. This is
  // explicit synthetic development data, not dealership/legal policy. No runtime
  // insert/update privilege and no startup reseeding or missing-row fallback.
  if (env.APP_ENV === "local")
    await db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT value FROM vamotors."BusinessSequence" WHERE id=1 FOR UPDATE`
        await tx.$queryRaw`SELECT vamotors.lock_admin_guard()`
        if (await tx.settings.findUnique({ where: { singleton: 1 } })) return
        if (await tx.settingsVersion.count())
          throw new Error("MISSING_SETTINGS_SINGLETON")
        const user = await tx.user.findFirst({
          where: {
            roles: {
              some: { role: { systemKey: "ADMINISTRATOR", active: true } },
            },
            active: true,
          },
          orderBy: { id: "asc" },
        })
        if (!user || !env.ENVIRONMENT_ID)
          throw new Error("SETTINGS_INITIALIZATION_UNAVAILABLE")
        const values = settingsInput.parse({
          company: {
            name: "Synthetic local dealership",
            identity: "SYNTHETIC-DEV",
            address: "Synthetic development address",
            phone: "0112345678",
            email: "synthetic@example.invalid",
          },
          declarations: [
            "Synthetic development declaration only — not legal or business policy.",
          ],
          currency: "LKR",
          scale: 2,
          timezone: "Asia/Colombo",
          tiers: [
            { upperBps: 500, days: 7 },
            { upperBps: 1000, days: 14 },
            { upperBps: 1500, days: 21 },
            { upperBps: null, days: 31 },
          ],
          warningLeadDays: 3,
          processingFee: "250000",
          dateFormat: "YYYY-MM-DD",
          itemsPerPage: 20,
          theme: "SYSTEM",
        })
        const version = await tx.settingsVersion.create({
          data: { version: 1, values },
        })
        const row = await tx.settings.create({
          data: { currentVersionId: version.id },
        })
        const sequence = await nextBusinessSequence(tx)
        const commandId = randomUUID()
        const after = {
          ...values,
          id: row.id,
          revision: row.revision,
          policyVersion: version.version,
        }
        await tx.commandReceipt.create({
          data: {
            id: commandId,
            environmentId: env.ENVIRONMENT_ID,
            actorKey: `USER:${user.id}`,
            commandName: "initializeSyntheticSettings",
            idempotencyKey: commandId,
            inputHash: createHash("sha256")
              .update(canonical(values))
              .digest("hex"),
            result: { type: "Settings", id: row.id, revision: row.revision },
            businessSequence: sequence,
          },
        })
        await audit(tx, {
          commandId,
          userId: user.id,
          entityType: "Settings",
          entityId: row.id,
          action: "create",
          before: null,
          after,
        })
        await writeReadVersion(tx, {
          commandId,
          sequence,
          entityType: "Settings",
          entityId: row.id,
          revision: row.revision,
          payload: after,
        })
        await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE")
      },
      { isolationLevel: "Serializable" }
    )
  const rows = await db.permission.findMany()
  for (const row of rows) {
    grantSchema.parse(row.rule)
    if (
      createHash("sha256").update(canonical(row.rule)).digest("hex") !==
      row.ruleHash
    )
      throw new Error("INVALID_PERMISSION_HASH")
  }
  console.log(
    `Revalidated ${rows.length} immutable permissions against current registry.`
  )
} finally {
  await db.$disconnect()
}
