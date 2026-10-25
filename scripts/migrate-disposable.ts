import { spawnSync } from "node:child_process"
import { authorizedMigration, privateEnvironment } from "./private-environment"
async function main() {
  const env = await privateEnvironment(process.argv[2] ?? "")
  const url = authorizedMigration(env)
  const result = spawnSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", "migrate", "deploy"],
    {
      env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
      stdio: "pipe",
      timeout: 60000,
    }
  )
  if (result.status !== 0) throw new Error("MIGRATION_FAILED")
  console.log(
    "Committed migrations installed on explicitly authorized disposable target."
  )
}
main().catch(() => {
  console.error(
    "Disposable migration failed/unauthorized; no connection diagnostics emitted."
  )
  process.exitCode = 1
})
