import { createHash } from "node:crypto"
import { z } from "zod"
import { createDatabase } from "../lib/server/db"
import { authorizedMigration, privateEnvironment } from "./private-environment"

async function main() {
  const migration = await privateEnvironment(process.argv[2] ?? "")
  const secrets = await privateEnvironment(process.argv[3] ?? "")
  const url = authorizedMigration(migration)
  const id = z.string().uuid().parse(migration.ENVIRONMENT_ID)
  const token = z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .parse(secrets.BOOTSTRAP_TOKEN)
  const db = createDatabase(url)
  try {
    await db.environment.create({
      data: {
        singleton: 1,
        id,
        name: "disposable-test",
        disposableTest: true,
        allowBusinessWrites: true,
        bootstrapTokenHash: createHash("sha256").update(token).digest("hex"),
        bootstrapExpiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    })
    console.log(
      "Disposable Environment initialized; bootstrap expires within 30 minutes."
    )
  } finally {
    await db.$disconnect()
  }
}
main().catch(() => {
  console.error(
    "Environment initialization failed; no secret diagnostics emitted."
  )
  process.exitCode = 1
})
