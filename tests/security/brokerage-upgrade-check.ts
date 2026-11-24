/** Genuine upgrade: 93843d42 (18 migrations, registry v14) -> integrated sales and brokerage (21, v16). */
import assert from "node:assert/strict"
import { execFileSync, execSync } from "node:child_process"
import { randomBytes, randomUUID } from "node:crypto"
import { mkdir, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import pg from "pg"
import { registryVersion } from "../../lib/server/permissions"

process.umask(0o077)
const root = process.argv[2]
assert.ok(root)
const source = process.cwd()
const baseCommit = "93843d42797cbb38b6d0b1243acf754f8dd3898a"
const runId = randomUUID().slice(0, 8)
const name = `vamotors-upgrade-${runId}`
const baseDir = join(root, "base-source")
const groups: string[] = []
let stage = "initialize"
async function group(label: string, run: () => Promise<void>) {
  stage = label
  await run()
  groups.push(label)
  console.log(`PASS ${label}`)
}
const docker = (args: string[]) =>
  execFileSync("docker", args, { encoding: "utf8" }).trim()

await mkdir(root, { recursive: true, mode: 0o700 })
await mkdir(baseDir, { recursive: true, mode: 0o700 })
execSync(`git archive ${baseCommit} | tar -x -C ${JSON.stringify(baseDir)}`, {
  cwd: source,
  shell: "/bin/bash",
  stdio: "pipe",
})
await symlink(join(source, "node_modules"), join(baseDir, "node_modules"))
const envId = randomUUID()
const runtimePassword = randomBytes(32).toString("hex")
const migrationPassword = randomBytes(32).toString("hex")
const secret = randomBytes(32).toString("hex")
docker([
  "run",
  "-d",
  "--rm",
  "--name",
  name,
  "-e",
  "POSTGRES_PASSWORD=disposable-only",
  "-e",
  "POSTGRES_DB=vamotors_local",
  "-p",
  "127.0.0.1:0:5432",
  "postgres:18.7-trixie",
])
const port = docker(["port", `${name}`, "5432/tcp"])
  .split(":")
  .at(-1)!
{
  let ready = 0
  for (let attempt = 0; attempt < 120 && ready < 2; attempt++) {
    try {
      execFileSync(
        "docker",
        [
          "exec",
          name,
          "psql",
          "-U",
          "postgres",
          "-d",
          "vamotors_local",
          "-tAc",
          "SELECT 1",
        ],
        { stdio: "ignore" }
      )
      ready++
    } catch {
      ready = 0
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
  if (ready < 2) throw new Error("DATABASE_NOT_READY")
}
const psql = (sql: string) =>
  execFileSync(
    "docker",
    [
      "exec",
      name,
      "psql",
      "-U",
      "postgres",
      "-d",
      "vamotors_local",
      "-v",
      "ON_ERROR_STOP=1",
      "-q",
      "-c",
      sql,
    ],
    { stdio: "pipe" }
  )
psql(
  `CREATE ROLE vamotors_runtime LOGIN PASSWORD '${runtimePassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
   CREATE ROLE vamotors_migrator LOGIN PASSWORD '${migrationPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
   REVOKE ALL ON DATABASE vamotors_local FROM PUBLIC;
   GRANT CONNECT, CREATE ON DATABASE vamotors_local TO vamotors_runtime, vamotors_migrator;
   CREATE SCHEMA vamotors AUTHORIZATION vamotors_migrator;
   REVOKE ALL ON SCHEMA public FROM PUBLIC;`
)
const migrationURL = `postgresql://vamotors_migrator:${migrationPassword}@127.0.0.1:${port}/vamotors_local?sslmode=disable`
const migrationEnv = {
  APP_ENV: "local",
  ENVIRONMENT_ID: envId,
  DIRECT_URL: migrationURL,
  LOCAL_DATABASE_AUTHORIZATION: envId,
}
const accounts = {
  BOOTSTRAP_TOKEN: secret,
  BOOTSTRAP_ADMIN_EMAIL: "upgrade-admin@example.test",
  BOOTSTRAP_ADMIN_PASSWORD: `Pw-${randomBytes(12).toString("hex")}`,
  BOOTSTRAP_SECOND_EMAIL: "upgrade-second@example.test",
  BOOTSTRAP_SECOND_PASSWORD: `Pw-${randomBytes(12).toString("hex")}`,
  BOOTSTRAP_STAFF_EMAIL: "upgrade-staff@example.test",
  BOOTSTRAP_STAFF_PASSWORD: `Pw-${randomBytes(12).toString("hex")}`,
}
const writeEnv = async (path: string, values: Record<string, string>) =>
  writeFile(
    path,
    Object.entries(values)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join("\n") + "\n",
    { mode: 0o600 }
  )
const envFile = join(root, "migration.env")
const accountFile = join(root, "accounts.env")
await writeEnv(envFile, migrationEnv)
await writeEnv(accountFile, accounts)
function script(cwd: string, scriptName: string, args: string[]) {
  return execFileSync(
    process.execPath,
    [
      "--conditions=react-server",
      "--import",
      "tsx",
      `scripts/${scriptName}.ts`,
      ...args,
    ],
    {
      cwd,
      env: {
        ...process.env,
        APP_ENV: "local",
        ENVIRONMENT_ID: envId,
        DATABASE_URL: migrationURL,
      },
      encoding: "utf8",
    }
  )
}
const db = new pg.Pool({ connectionString: migrationURL, max: 2 })
const permissionSet = async () =>
  (
    await db.query(
      'SELECT "ruleHash" AS rulehash, rule::text AS rule FROM vamotors."Permission" ORDER BY "ruleHash"'
    )
  ).rows as { rulehash: string; rule: string }[]
const roleState = async () =>
  (
    await db.query(
      'SELECT r."systemKey", r.revision, count(rp.*)::int AS grants FROM vamotors."Role" r LEFT JOIN vamotors."RolePermission" rp ON rp."roleId"=r.id GROUP BY r.id, r."systemKey", r.revision ORDER BY r."systemKey" NULLS LAST, r.id'
    )
  ).rows as { systemKey: string | null; revision: number; grants: number }[]

let before: { rulehash: string; rule: string }[] = []
let beforeRoles: Awaited<ReturnType<typeof roleState>> = []
try {
  await group(
    "base 93843d42 applies 18 migrations and registry v14 seeds",
    async () => {
      script(baseDir, "migrate-disposable", [envFile])
      script(baseDir, "initialize-test-environment", [envFile, accountFile])
      script(baseDir, "bootstrap-security", [envFile, accountFile])
      script(baseDir, "revalidate-permissions", [envFile])
      execFileSync(
        "docker",
        [
          "cp",
          join(baseDir, "scripts/local-runtime-grants.sql"),
          `${name}:/tmp/base-grants.sql`,
        ],
        { stdio: "pipe" }
      )
      execFileSync(
        "docker",
        [
          "exec",
          name,
          "psql",
          "-U",
          "postgres",
          "-d",
          "vamotors_local",
          "-v",
          "ON_ERROR_STOP=1",
          "-q",
          "-f",
          "/tmp/base-grants.sql",
        ],
        { stdio: "pipe" }
      )
      const migrations = await db.query(
        "SELECT migration_name FROM vamotors._prisma_migrations ORDER BY migration_name"
      )
      assert.equal(migrations.rows.length, 18)
      assert.ok(
        !migrations.rows.some((row) =>
          String(row.migration_name).includes("lease_brokerage")
        )
      )
      before = await permissionSet()
      beforeRoles = await roleState()
      const admin = beforeRoles.find(
        (row) => row.systemKey === "ADMINISTRATOR"
      )!
      assert.ok(admin.grants > 0)
      assert.ok(
        !before.some((row) => row.rule.includes('"BrokerageDeal"')),
        "base must not contain brokerage permissions"
      )
    }
  )

  await group(
    "integration applies both features and preserves seeded v14 permissions",
    async () => {
      script(source, "migrate-disposable", [envFile])
      const migrations = await db.query(
        "SELECT migration_name FROM vamotors._prisma_migrations ORDER BY migration_name"
      )
      assert.equal(migrations.rows.length, 21)
      assert.ok(
        migrations.rows.some((row) =>
          String(row.migration_name).includes("lease_brokerage")
        )
      )
      const after = await permissionSet()
      const oldHashes = new Set(before.map((row) => row.rulehash))
      const afterMap = new Map(after.map((row) => [row.rulehash, row.rule]))
      for (const permission of before) {
        assert.equal(
          afterMap.get(permission.rulehash),
          permission.rule,
          "old grant ceiling must be byte-identical"
        )
      }
      const added = after.filter((row) => !oldHashes.has(row.rulehash))
      const addedGrants = added.map(({ rule }) => JSON.parse(rule))
      const addedActions = Object.groupBy(addedGrants, (grant) => grant.subject)
      assert.deepEqual(
        Object.fromEntries(
          Object.entries(addedActions).map(([subject, grants]) => [
            subject,
            grants?.map((grant) => grant.action).sort(),
          ])
        ),
        {
          SaleCase: ["create", "pay", "read", "update"],
          BrokerageDeal: ["create", "dispatch", "read", "update"],
          CashFacility: ["create", "pay", "read", "update"],
          DispatchBatch: ["create", "dispatch", "read"],
          CommissionEntitlement: ["create", "read"],
        }
      )
      assert.ok(
        addedGrants.every(({ fields }) => JSON.stringify(fields) === '["*"]')
      )
      script(source, "revalidate-permissions", [envFile])
      const roles = await roleState()
      const adminBefore = beforeRoles.find(
        (row) => row.systemKey === "ADMINISTRATOR"
      )!
      const adminAfter = roles.find((row) => row.systemKey === "ADMINISTRATOR")!
      assert.equal(adminAfter.grants, adminBefore.grants + added.length)
      assert.equal(adminAfter.revision, adminBefore.revision + 2)
      for (const role of roles.filter(
        (row) => row.systemKey !== "ADMINISTRATOR"
      )) {
        const old = beforeRoles.find(
          (row) =>
            row.systemKey === role.systemKey &&
            row.revision === role.revision &&
            row.grants === role.grants
        )
        assert.ok(
          old,
          `non-administrator grants changed: ${JSON.stringify(role)}`
        )
      }
      const newSubjectGrants = await db.query(
        `SELECT count(*)::int AS n FROM vamotors."RolePermission" rp JOIN vamotors."Permission" p ON p.id=rp."permissionId" JOIN vamotors."Role" r ON r.id=rp."roleId" WHERE r."systemKey" IS DISTINCT FROM 'ADMINISTRATOR' AND p.rule->>'subject' IN ('BrokerageDeal','CashFacility','DispatchBatch','CommissionEntitlement')`
      )
      assert.equal(newSubjectGrants.rows[0].n, 0)
      assert.equal(registryVersion, 16)
    }
  )

  await group("repeat migration is a no-op", async () => {
    const beforeRepeat = await permissionSet()
    const rolesBefore = await roleState()
    script(source, "migrate-disposable", [envFile])
    const afterRepeat = await permissionSet()
    assert.deepEqual(
      afterRepeat.map((row) => [row.rulehash, row.rule]),
      beforeRepeat.map((row) => [row.rulehash, row.rule])
    )
    assert.deepEqual(await roleState(), rolesBefore)
  })
} catch (error) {
  console.error(
    `FAIL ${stage}: ${error instanceof Error ? error.message : "unknown"}`
  )
  process.exitCode = 1
} finally {
  await writeFile(
    join(root, `upgrade-${runId}-summary.json`),
    JSON.stringify({ stage, groups, baseCommit, source }, null, 2),
    { mode: 0o600 }
  ).catch(() => undefined)
  await db.end().catch(() => undefined)
  try {
    docker(["rm", "-f", name])
  } catch {
    // already gone
  }
}
