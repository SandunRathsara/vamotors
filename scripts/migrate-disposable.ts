import { spawnSync } from "node:child_process"
import { authorizedMigration, privateEnvironment } from "./private-environment"
async function main() {
  const env = await privateEnvironment(process.argv[2] ?? "")
  const url = authorizedMigration(env)
  // Prisma 6 migration engine only; never pass this custom option to pg.
  const migrationURL = new URL(url)
  migrationURL.searchParams.set("schema", "vamotors")
  const result = spawnSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", "migrate", "deploy"],
    {
      env: {
        ...process.env,
        DATABASE_URL: migrationURL.href,
        DIRECT_URL: migrationURL.href,
      },
      stdio: "pipe",
      timeout: 60000,
    }
  )
  if (result.status !== 0) {
    const codes =
      `${result.stdout}\n${result.stderr}`.match(/\bP\d{4}\b/g) ?? []
    console.error(
      `Migration engine failure codes: ${codes.join(",") || "none"}`
    )
    throw new Error("MIGRATION_FAILED")
  }
  console.log("Committed migrations installed on explicitly authorized target.")
}
main().catch(() => {
  console.error(
    "Disposable migration failed/unauthorized; no connection diagnostics emitted."
  )
  process.exitCode = 1
})
