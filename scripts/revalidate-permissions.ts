/** Read-only fail-closed validation after an owner-serialized registry migration. */
import { createHash } from "node:crypto"
import { createDatabase } from "../lib/server/db"
import { canonical } from "../lib/server/idempotency"
import { grantSchema } from "../lib/server/permissions"
import { authorizedMigration, privateEnvironment } from "./private-environment"
const env = await privateEnvironment(process.argv[2] ?? "")
const db = createDatabase(authorizedMigration(env))
try {
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
