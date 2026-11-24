/** Disposable Docker PostgreSQL + production Next.js. No mocks, no shared DB. */
import assert from "node:assert/strict"
import { randomBytes, randomUUID } from "node:crypto"
import { execFileSync, spawn, type ChildProcess } from "node:child_process"
import { once } from "node:events"
import { mkdir, writeFile } from "node:fs/promises"
import { createWriteStream, type WriteStream } from "node:fs"
import { createServer } from "node:net"
import { join } from "node:path"
import { request, type APIRequestContext } from "@playwright/test"
import pg from "pg"
import type {
  Applied,
  Dependency,
} from "../../.planning/implementation/contracts/api"

export const envelope = (
  input: unknown,
  expected: Dependency[] = [],
  idempotencyKey = randomUUID()
) => ({ schemaVersion: 1, idempotencyKey, expected, input })
export const ref = (
  row: { id: string; revision: number },
  type: Dependency["type"]
): Dependency => ({ type, id: row.id, revision: row.revision })

const docker = (args: string[]) =>
  execFileSync("docker", args, { encoding: "utf8" }).trim()

export async function fixture(
  root: string,
  source = process.cwd(),
  baseSource?: string
) {
  process.umask(0o077)
  await mkdir(root, { recursive: true, mode: 0o700 })
  const runId = randomUUID().slice(0, 8)
  const name = `vamotors-brokerage-${runId}`
  const envId = randomUUID()
  const runtimePassword = randomBytes(32).toString("hex")
  const migrationPassword = randomBytes(32).toString("hex")
  const secret = randomBytes(32).toString("hex")
  const adminPassword = `Pw-${randomBytes(12).toString("hex")}`
  const secondPassword = `Pw-${randomBytes(12).toString("hex")}`
  const staffPassword = `Pw-${randomBytes(12).toString("hex")}`
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
  const file = (suffix: string) => join(root, suffix)
  const origin = await freeOrigin()
  const privateRoot = file("private-files")
  await mkdir(privateRoot, { mode: 0o700 })
  const policy = file("policy.json")
  await writeFile(
    policy,
    JSON.stringify({
      environmentId: envId,
      allowWrites: true,
      reviewedThrough: new Date(Date.now() + 86_400_000).toISOString(),
      maxBytes: 256 * 1024 * 1024,
      minFreeBytes: 128 * 1024 * 1024,
      maxEntries: 10000,
    }),
    { mode: 0o600 }
  )
  const runtimeURL = `postgresql://vamotors_runtime:${runtimePassword}@127.0.0.1:${port}/vamotors_local?sslmode=disable`
  const migrationURL = `postgresql://vamotors_migrator:${migrationPassword}@127.0.0.1:${port}/vamotors_local?sslmode=disable`
  const runtime = {
    APP_ENV: "local",
    ENVIRONMENT_ID: envId,
    DATABASE_URL: runtimeURL,
    APP_ORIGIN: origin,
    BETTER_AUTH_URL: origin,
    BETTER_AUTH_SECRET: secret,
    PRIVATE_FILES_ROOT: privateRoot,
    PRIVATE_FILES_POLICY: policy,
  }
  const migration = {
    APP_ENV: "local",
    ENVIRONMENT_ID: envId,
    DIRECT_URL: migrationURL,
    LOCAL_DATABASE_AUTHORIZATION: envId,
  }
  const accounts = {
    BOOTSTRAP_TOKEN: secret,
    BOOTSTRAP_ADMIN_EMAIL: "brokerage-admin@example.test",
    BOOTSTRAP_ADMIN_PASSWORD: adminPassword,
    BOOTSTRAP_SECOND_EMAIL: "brokerage-second@example.test",
    BOOTSTRAP_SECOND_PASSWORD: secondPassword,
    BOOTSTRAP_STAFF_EMAIL: "brokerage-staff@example.test",
    BOOTSTRAP_STAFF_PASSWORD: staffPassword,
  }
  const writeEnv = async (suffix: string, values: Record<string, string>) => {
    await writeFile(
      file(suffix),
      Object.entries(values)
        .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
        .join("\n") + "\n",
      { mode: 0o600, flag: "wx" }
    )
  }
  await writeEnv("runtime.env", runtime)
  await writeEnv("migration.env", migration)
  await writeEnv("accounts.env", accounts)
  const script = (name: string, args: string[], cwd = source) =>
    execFileSync(
      process.execPath,
      [
        "--conditions=react-server",
        "--import",
        "tsx",
        `scripts/${name}.ts`,
        ...args,
      ],
      { cwd, env: { ...process.env, ...runtime }, encoding: "utf8" }
    )
  try {
    const initial = baseSource ?? source
    script("migrate-disposable", [file("migration.env")], initial)
    script(
      "initialize-test-environment",
      [file("migration.env"), file("accounts.env")],
      initial
    )
    script(
      "bootstrap-security",
      [file("migration.env"), file("accounts.env")],
      initial
    )
    if (baseSource) {
      script("revalidate-permissions", [file("migration.env")], baseSource)
      script("migrate-disposable", [file("migration.env")])
    }
    script("revalidate-permissions", [file("migration.env")])
    execFileSync(
      "docker",
      [
        "cp",
        join(source, "scripts/local-runtime-grants.sql"),
        `${name}:/tmp/grants.sql`,
      ],
      { stdio: "ignore" }
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
        "/tmp/grants.sql",
      ],
      { stdio: "pipe" }
    )
  } catch (error) {
    docker(["rm", "-f", name])
    throw error
  }
  const db = new pg.Pool({ connectionString: migrationURL, max: 3 })
  const restricted = new pg.Pool({ connectionString: runtimeURL, max: 1 })
  let app: ChildProcess | undefined
  let logs: WriteStream[] = []
  const transcript: unknown[] = []
  async function start() {
    app = spawn(
      process.execPath,
      [
        "node_modules/next/dist/bin/next",
        "start",
        "--hostname",
        "127.0.0.1",
        "--port",
        String(new URL(origin).port),
      ],
      {
        cwd: source,
        env: { ...process.env, ...runtime, NODE_ENV: "production" },
        stdio: ["ignore", "pipe", "pipe"],
      }
    )
    logs = ["stdout", "stderr"].map((stream) =>
      createWriteStream(file(`app-${app!.pid}.${stream}`), {
        mode: 0o600,
        flags: "wx",
      })
    )
    app.stdout!.pipe(logs[0])
    app.stderr!.pipe(logs[1])
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error("START_TIMEOUT")), 25_000)
      app!.once("exit", () => {
        clearTimeout(timer)
        reject(Error("EARLY_EXIT"))
      })
      app!.stdout!.on("data", (chunk) => {
        if (chunk.toString().includes("Ready")) {
          clearTimeout(timer)
          resolve()
        }
      })
    })
  }
  async function stop() {
    if (app && app.exitCode === null) {
      const child = app,
        closed = once(child, "exit")
      child.kill("SIGTERM")
      const timer = setTimeout(() => child.kill("SIGKILL"), 5000)
      await closed
      clearTimeout(timer)
      await Promise.all(
        logs.map((stream) =>
          stream.writableFinished ? undefined : once(stream, "finish")
        )
      )
    }
    app = undefined
  }
  async function login(email: string, password: string) {
    const client = await request.newContext({ baseURL: origin })
    const response = await client.post("/api/auth/sign-in/email", {
      headers: { Origin: origin },
      data: { email, password },
    })
    assert.equal(response.status(), 200)
    return client
  }
  async function query<T>(
    client: APIRequestContext,
    name: string,
    params = ""
  ) {
    const response = await client.get(`/api/v1/queries/${name}${params}`)
    const value = await response.json()
    transcript.push({
      kind: "query",
      name,
      params,
      status: response.status(),
      value,
    })
    assert.equal(response.status(), 200, `${name}: ${JSON.stringify(value)}`)
    assert.match(response.headers()["cache-control"], /no-store/)
    return value.data as T
  }
  async function command(
    client: APIRequestContext,
    name: string,
    body: unknown,
    status = 200,
    errorCode?: string
  ) {
    const response = await client.post(`/api/v1/commands/${name}`, {
      data: body,
      headers: { Origin: origin },
    })
    const value = await response.json()
    transcript.push({
      kind: "command",
      name,
      body,
      status: response.status(),
      value,
    })
    assert.equal(response.status(), status, `${name}: ${JSON.stringify(value)}`)
    assert.match(response.headers()["cache-control"], /no-store/)
    if (errorCode) assert.equal(value.error?.code, errorCode)
    return value as Applied
  }
  async function upload(
    client: APIRequestContext,
    input: {
      type: "BROKERAGE_DEAL" | "IMPORT_BATCH"
      id: string
      revision: number
      purpose: string
      filename: string
      contentType: string
      bytes: Buffer
      category?: string
    }
  ) {
    const { createHash } = await import("node:crypto")
    const sha256 = createHash("sha256").update(input.bytes).digest("hex")
    const init = await client.post("/api/v1/commands/initUpload", {
      headers: { Origin: origin },
      data: envelope(
        {
          target: { type: input.type, id: input.id },
          purpose: input.purpose,
          filename: input.filename,
          contentType: input.contentType,
          size: input.bytes.length,
          sha256,
          ...(input.category ? { category: input.category } : {}),
        },
        [
          {
            type:
              input.type === "BROKERAGE_DEAL" ? "BrokerageDeal" : "ImportBatch",
            id: input.id,
            revision: input.revision,
          },
        ]
      ),
    })
    const ready = await init.json()
    assert.equal(init.status(), 201, JSON.stringify(ready))
    const put = await client.put(ready.putUrl, {
      headers: { ...ready.requiredHeaders, Origin: origin },
      data: input.bytes,
    })
    assert.equal(put.status(), 204)
    const done = await client.post("/api/v1/commands/completeUpload", {
      headers: { Origin: origin },
      data: envelope({ uploadId: ready.uploadId }, [
        { type: "UploadIntent", id: ready.uploadId, revision: ready.revision },
        {
          type:
            input.type === "BROKERAGE_DEAL" ? "BrokerageDeal" : "ImportBatch",
          id: input.id,
          revision: input.revision,
        },
      ]),
    })
    const attached = await done.json()
    assert.equal(done.status(), 200, JSON.stringify(attached))
    return {
      uploadId: ready.uploadId as string,
      attachmentId: attached.result.id as string,
    }
  }
  try {
    await start()
  } catch (error) {
    await close()
    throw error
  }
  async function restart() {
    await stop()
    await start()
  }
  async function close() {
    await stop()
    await writeFile(
      file(`transcript-${runId}.json`),
      JSON.stringify({ origin, source, transcript }, null, 2),
      { mode: 0o600 }
    )
    await db.end()
    await restricted.end()
    try {
      docker(["rm", "-f", name])
    } catch {
      // already gone
    }
  }
  return {
    root,
    source,
    name,
    origin,
    db,
    restricted,
    start,
    stop,
    restart,
    login,
    query,
    command,
    upload,
    close,
    runtime,
    migration,
    accounts,
  }
}

function freeOrigin() {
  return new Promise<string>((resolve, reject) => {
    const server = createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") return reject(Error("PORT"))
      server.close(() => resolve(`http://127.0.0.1:${address.port}`))
    })
  })
}
