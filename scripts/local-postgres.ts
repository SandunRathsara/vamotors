/** Isolated project-owned PostgreSQL. No cloud files, service manager, or reset. */
import { createHash, randomBytes, randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  unlink,
  writeFile,
} from "node:fs/promises"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { createServer } from "node:net"
import { spawnSync } from "node:child_process"
import pg from "pg"
import { privateEnvironment, authorizedMigration } from "./private-environment"
import { runtimeConfig } from "../lib/server/config"
import { databaseURL } from "../lib/server/database-url"

process.umask(0o077)
const cwd = await realpath(process.cwd())
const key = createHash("sha256").update(cwd).digest("hex").slice(0, 12)
const root = resolve(
  process.env.VAMOTORS_LOCAL_DIR ??
    join(homedir(), ".config/vamotors", `local-${key}`)
)
if (root === cwd || root.startsWith(`${cwd}/`))
  throw new Error("OFF_GIT_DIRECTORY_REQUIRED")
const file = (name: string) => join(root, name)
const runtimeFile = file("runtime.env")
const migrationFile = file("migration.env")
const accountFile = file("accounts.env")
const adminFile = file("admin.env")
const cluster = file("postgres")
const action = process.argv[2] ?? "setup"
const env: NodeJS.ProcessEnv = {
  NODE_ENV: process.env.NODE_ENV ?? "development",
  ...Object.fromEntries(
    Object.entries(process.env).filter(
      ([k]) =>
        !k.startsWith("PG") &&
        !k.startsWith("BOOTSTRAP_") &&
        !["DATABASE_URL", "DIRECT_URL"].includes(k)
    )
  ),
}

function run(command: string, args: string[], extra = env, visible = false) {
  const result = spawnSync(command, args, {
    cwd,
    env: extra,
    stdio: visible ? "inherit" : "pipe",
    timeout: args.includes("dev") ? undefined : 120000,
  })
  if (result.status !== 0) {
    if (!visible)
      console.error(
        `Failed local step: ${args.find((a) => a.startsWith("scripts/")) ?? args[0]}`
      )
    if (!visible && result.stderr) {
      const codes = result.stderr.toString().match(/\bP\d{4}\b/g) ?? []
      if (codes.length)
        console.error(`Migration failure codes: ${codes.join(",")}`)
    }
    throw new Error("LOCAL_STEP_FAILED")
  }
}
async function writeEnv(name: string, values: Record<string, string>) {
  await writeFile(
    file(name),
    Object.entries(values)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join("\n") + "\n",
    { mode: 0o600, flag: "wx" }
  )
}
const token = () => randomBytes(32).toString("hex")
const connection = (
  role: string,
  password: string,
  port: number,
  db = "vamotors_local"
) => `postgresql://${role}:${password}@127.0.0.1:${port}/${db}?sslmode=disable`
async function freshState() {
  const bin =
    process.env.PG_BIN ??
    [
      "/opt/homebrew/opt/postgresql@18/bin",
      "/usr/local/opt/postgresql@18/bin",
      "/usr/lib/postgresql/18/bin",
    ].find((p) => existsSync(join(p, "postgres")))
  if (!bin || !existsSync(join(bin, "postgres")))
    throw new Error("PG_BIN_REQUIRED")
  const server = createServer()
  const port = await new Promise<number>((ok, fail) => {
    server.once("error", fail).listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string")
        return fail(new Error("PORT_REQUIRED"))
      server.close(() => ok(address.port))
    })
  })
  await mkdir(root, { recursive: true, mode: 0o700 })
  await secureRoot()
  await writeEnv("cluster.env", {
    PROJECT: cwd,
    PG_BIN: bin,
    PORT: String(port),
  })
  const id = randomUUID()
  const common = { APP_ENV: "local", ENVIRONMENT_ID: id }
  // Dedicated retained local bytes, not the checkout, public tree or temp storage.
  const privateRoot = file("private-files"),
    policyPath = file("private-files-policy.json")
  await mkdir(privateRoot, { mode: 0o700 })
  await writeFile(
    policyPath,
    JSON.stringify({
      environmentId: id,
      allowWrites: true,
      reviewedThrough: new Date(Date.now() + 86400000).toISOString(),
      maxBytes: 256 * 1024 * 1024,
      minFreeBytes: 128 * 1024 * 1024,
      maxEntries: 10000,
    }),
    { mode: 0o600, flag: "wx" }
  )
  await writeEnv("runtime.env", {
    ...common,
    DATABASE_URL: connection("vamotors_runtime", token(), port),
    APP_ORIGIN: "http://127.0.0.1:8000",
    BETTER_AUTH_URL: "http://127.0.0.1:8000",
    BETTER_AUTH_SECRET: token(),
    PRIVATE_FILES_ROOT: privateRoot,
    PRIVATE_FILES_POLICY: policyPath,
  })
  await writeEnv("migration.env", {
    ...common,
    DIRECT_URL: connection("vamotors_migrator", token(), port),
    LOCAL_DATABASE_AUTHORIZATION: id,
  })
  const password = token()
  await writeEnv("admin.env", {
    ADMIN_URL: connection("vamotors_local_admin", password, port, "postgres"),
  })
  await writeEnv("accounts.env", {
    BOOTSTRAP_TOKEN: token(),
    BOOTSTRAP_ADMIN_EMAIL: `admin-a-${token().slice(0, 12)}@example.test`,
    BOOTSTRAP_ADMIN_PASSWORD: token(),
    BOOTSTRAP_SECOND_EMAIL: `admin-b-${token().slice(0, 12)}@example.test`,
    BOOTSTRAP_SECOND_PASSWORD: token(),
    BOOTSTRAP_STAFF_EMAIL: `staff-${token().slice(0, 12)}@example.test`,
    BOOTSTRAP_STAFF_PASSWORD: token(),
  })
  await writeFile(file("init-password"), password, { mode: 0o600, flag: "wx" })
  try {
    run(join(bin, "initdb"), [
      "-D",
      cluster,
      "-U",
      "vamotors_local_admin",
      "-A",
      "scram-sha-256",
      "--pwfile",
      file("init-password"),
      "--encoding=UTF8",
      "--locale=C",
    ])
  } finally {
    await unlink(file("init-password"))
  }
  await writeFile(
    join(cluster, "pg_hba.conf"),
    "host all all 127.0.0.1/32 scram-sha-256\n",
    { mode: 0o600 }
  )
  await writeFile(
    join(cluster, "postgresql.auto.conf"),
    `listen_addresses = '127.0.0.1'\nport = ${port}\nunix_socket_directories = ''\nssl = off\nmax_connections = 32\nshared_buffers = '64MB'\nwork_mem = '4MB'\nmax_wal_size = '128MB'\nmin_wal_size = '32MB'\npassword_encryption = 'scram-sha-256'\n`,
    { mode: 0o600 }
  )
}
async function secureRoot() {
  const info = await lstat(root)
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    info.uid !== process.getuid?.() ||
    info.mode & 0o077
  )
    throw new Error("PRIVATE_DIRECTORY_REQUIRED")
  const tracked = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: root,
    env,
    stdio: "pipe",
  })
  if (tracked.stdout?.toString().trim() === "true")
    throw new Error("OFF_GIT_DIRECTORY_REQUIRED")
}
async function main() {
  if (action === "setup" && !existsSync(root)) await freshState()
  await secureRoot()
  const state = await privateEnvironment(file("cluster.env"))
  if (state.PROJECT !== cwd || !state.PG_BIN || !/^\d+$/.test(state.PORT ?? ""))
    throw new Error("PROJECT_CLUSTER_MISMATCH")
  const ctl = join(state.PG_BIN, "pg_ctl")
  const status = spawnSync(ctl, ["-D", cluster, "status"], {
    env,
    stdio: "pipe",
  })
  if (action === "stop") {
    if (status.status === 0)
      run(ctl, ["-D", cluster, "-m", "fast", "-w", "stop"])
    console.log("Project PostgreSQL stopped; persistent data retained.")
    return
  }
  if (!["setup", "start", "test", "http", "dev", "expiry"].includes(action))
    throw new Error("UNKNOWN_LOCAL_ACTION")
  if (status.status !== 0)
    run(ctl, ["-D", cluster, "-l", file("postgres.log"), "-w", "start"])
  const runtime = await privateEnvironment(runtimeFile)
  runtimeConfig(runtime)
  if (
    runtime.APP_ENV !== "local" ||
    new URL(runtime.DATABASE_URL!).port !== state.PORT
  )
    throw new Error("PROJECT_CLUSTER_MISMATCH")
  const expirySecretFile = file("expiry-scheduler.key")
  if (action === "setup") {
    if (!existsSync(expirySecretFile))
      await writeFile(expirySecretFile, token() + "\n", {
        mode: 0o600,
        flag: "wx",
      })
    const migration = await privateEnvironment(migrationFile)
    const admin = await privateEnvironment(adminFile)
    authorizedMigration(migration)
    const adminURL = databaseURL(
      admin.ADMIN_URL ?? "",
      "vamotors_local_admin",
      true
    )
    if (
      !adminURL ||
      adminURL.port !== state.PORT ||
      adminURL.pathname !== "/postgres" ||
      new URL(migration.DIRECT_URL!).port !== state.PORT ||
      migration.ENVIRONMENT_ID !== runtime.ENVIRONMENT_ID
    )
      throw new Error("PROJECT_CLUSTER_MISMATCH")
    // Only this freshly created cluster's admin. No user/cloud connection inputs.
    const client = new pg.Client({ connectionString: admin.ADMIN_URL })
    await client.connect()
    try {
      for (const [role, url] of [
        ["vamotors_runtime", runtime.DATABASE_URL],
        ["vamotors_migrator", migration.DIRECT_URL],
      ]) {
        if (
          !(
            await client.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [
              role,
            ])
          ).rowCount
        ) {
          const password = new URL(url!).password
          if (!/^[a-f0-9]{64}$/.test(password))
            throw new Error("INVALID_GENERATED_PASSWORD")
          await client.query(
            `CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`
          )
        }
      }
      if (
        !(
          await client.query(
            "SELECT 1 FROM pg_database WHERE datname='vamotors_local'"
          )
        ).rowCount
      )
        await client.query("CREATE DATABASE vamotors_local")
      await client.query("REVOKE ALL ON DATABASE vamotors_local FROM PUBLIC")
      await client.query(
        "GRANT CONNECT ON DATABASE vamotors_local TO vamotors_runtime, vamotors_migrator"
      )
    } finally {
      await client.end()
    }
    const target = new URL(admin.ADMIN_URL!)
    target.pathname = "/vamotors_local"
    const owner = new pg.Client({ connectionString: target.href })
    await owner.connect()
    try {
      await owner.query("REVOKE ALL ON SCHEMA public FROM PUBLIC")
      await owner.query(
        "CREATE SCHEMA IF NOT EXISTS vamotors AUTHORIZATION vamotors_migrator"
      )
      const script = (name: string, args: string[]) =>
        run(process.execPath, [
          "--conditions=react-server",
          "--import",
          "tsx",
          `scripts/${name}.ts`,
          ...args,
        ])
      // Prisma's CREATE SCHEMA IF NOT EXISTS still checks database CREATE.
      // Temporary migrator capability only; never granted to runtime.
      await owner.query(
        "GRANT CREATE ON DATABASE vamotors_local TO vamotors_migrator"
      )
      try {
        script("migrate-disposable", [migrationFile])
      } finally {
        await owner.query(
          "REVOKE CREATE ON DATABASE vamotors_local FROM vamotors_migrator"
        )
      }
      const initialized = await owner.query(
        'SELECT "bootstrappedAt" FROM vamotors."Environment" WHERE singleton=1'
      )
      if (!initialized.rowCount)
        script("initialize-test-environment", [migrationFile, accountFile])
      if (!initialized.rows[0]?.bootstrappedAt)
        script("bootstrap-security", [migrationFile, accountFile])
      script("revalidate-permissions", [migrationFile])
      await owner.query(
        await readFile(join(cwd, "scripts/local-runtime-grants.sql"), "utf8")
      )
    } finally {
      await owner.end()
    }
    console.log(
      "Local migrations, Environment, private synthetic accounts and restricted grants ready."
    )
  }
  console.log(`Private state (not values): ${root}`)
  if (action === "test")
    run(
      process.execPath,
      [
        "--conditions=react-server",
        "--import",
        "tsx",
        "scripts/security-db-check.ts",
        runtimeFile,
        migrationFile,
        accountFile,
      ],
      env,
      true
    )
  if (action === "http")
    run(
      process.execPath,
      [
        "--import",
        "tsx",
        "scripts/local-http-check.ts",
        runtimeFile,
        accountFile,
      ],
      env,
      true
    )
  if (action === "expiry") {
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "scripts/local-expiry-scheduler.ts",
        "--base-url",
        process.env.EXPIRY_BASE_URL ?? runtime.APP_ORIGIN!,
        "--secret-file",
        expirySecretFile,
        "--state-file",
        file("expiry-scheduler-health.json"),
        ...process.argv.slice(3),
      ],
      { cwd, env, stdio: "inherit" }
    )
    if (
      result.error ||
      (result.status !== 0 &&
        result.signal !== "SIGINT" &&
        result.signal !== "SIGTERM")
    )
      throw new Error("LOCAL_STEP_FAILED: expiry scheduler")
  }
  if (action === "dev")
    run(
      process.execPath,
      [
        "node_modules/next/dist/bin/next",
        "dev",
        "--hostname",
        "127.0.0.1",
        "--port",
        "8000",
      ],
      { ...env, ...runtime, EXPIRY_SECRET_FILE: expirySecretFile },
      true
    )
}
main().catch((error) => {
  // Original database/child errors may contain credentials or auth rows.
  console.error(
    "Local PostgreSQL action failed; private state retained, no secret diagnostics emitted."
  )
  if (
    error instanceof Error &&
    /^(PG_BIN_REQUIRED|PRIVATE_DIRECTORY_REQUIRED|PROJECT_CLUSTER_MISMATCH|UNKNOWN_LOCAL_ACTION|LOCAL_STEP_FAILED:)/.test(
      error.message
    )
  )
    console.error(error.message)
  process.exitCode = 1
})
