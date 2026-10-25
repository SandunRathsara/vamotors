// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest"
import pg from "pg"
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { EventEmitter } from "node:events"
import { inspect } from "node:util"
import { createHmac } from "node:crypto"
import { runtimeConfig } from "../../lib/server/config"
import { authorizedMigration } from "../../scripts/private-environment"
import { transition, states } from "../../lib/state"

vi.mock("server-only", () => ({}))
const seam = vi.hoisted(() => ({
  db: undefined as unknown,
  environmentFailure: undefined as unknown,
}))
vi.mock("../../lib/server/db", () => ({
  database: () => seam.db,
  assertEnvironment: vi.fn(async () => {
    if (seam.environmentFailure) throw seam.environmentFailure
    return {}
  }),
}))
import { transaction } from "../../lib/server/transactions"
import { authentication } from "../../lib/server/auth"
import { POST } from "../../app/api/auth/[...all]/route"

const uid = "03000000-0000-4000-8000-000000000011"
const runtimeURL =
  "postgresql://vamotors_runtime:specimen-only@db.example.test:5432/isolated?sslmode=verify-full"
const migrationURL = runtimeURL.replace("vamotors_runtime", "vamotors_migrator")
const runtime = {
  APP_ENV: "disposable-test",
  ENVIRONMENT_ID: uid,
  DATABASE_URL: runtimeURL,
  APP_ORIGIN: "http://localhost:8000",
  BETTER_AUTH_URL: "http://localhost:8000",
  BETTER_AUTH_SECRET: "nonsecret-config-validation-specimen-only",
}
const migration = {
  APP_ENV: "disposable-test",
  ENVIRONMENT_ID: uid,
  T03_DISPOSABLE_AUTHORIZATION: uid,
  T03_DISPOSABLE_HOST: "db.example.test",
  T03_DISPOSABLE_DATABASE: "isolated",
  DIRECT_URL: migrationURL,
}
const marker = "SQL_DETAIL_PASSWORD_SESSION_TOKEN_CONNECTION_SPECIMEN"
function pgError(code: string) {
  const error = new pg.DatabaseError(`check constraint ${marker}`, 0, "error")
  error.code = code
  error.severity = "ERROR"
  error.detail = `Failing row contains (${marker}, password, session, token, postgresql://specimen).`
  return error
}

const clients: PrismaClient[] = []
// Only the wire transport is synthetic. Installed pg/PrismaPg/client generate
// every adapter/model/raw-query envelope; no database/socket is opened.
function client(fail: (sql: string) => unknown) {
  const pool = new pg.Pool()
  const query = vi.fn(async (query: { text: string }) => {
    const error = fail(query.text)
    if (error) throw error
    return { rows: [], fields: [], rowCount: 0, command: "", oid: 0 }
  })
  vi.spyOn(pool, "query").mockImplementation(query as never)
  const connection = Object.assign(new EventEmitter(), {
    query,
    release: vi.fn(),
  })
  vi.spyOn(pool, "connect").mockResolvedValue(connection as never)
  const db = new PrismaClient({
    adapter: new PrismaPg(pool, { schema: "vamotors" }),
  })
  clients.push(db)
  seam.db = db
  return db
}
afterEach(async () => {
  await Promise.all(clients.splice(0).map((db) => db.$disconnect()))
  vi.unstubAllEnvs()
  seam.environmentFailure = undefined
})

describe("effective pinned pg configuration, no database", () => {
  it.each(["require", "verify-full"])(
    "retains target/role and certificate verification for %s",
    (mode) => {
      for (const [url, validate] of [
        [
          runtimeURL,
          (url: string) =>
            runtimeConfig({ ...runtime, DATABASE_URL: url }).DATABASE_URL,
        ],
        [
          migrationURL,
          (url: string) =>
            authorizedMigration({ ...migration, DIRECT_URL: url }),
        ],
      ] as const) {
        const accepted = validate(url.replace("verify-full", mode))
        const connection = new pg.Client({ connectionString: accepted })
        const parameters = (
          connection as unknown as { connectionParameters: pg.ClientConfig }
        ).connectionParameters
        expect(parameters).toMatchObject({
          host: "db.example.test",
          port: 5432,
          database: "isolated",
          user: url === runtimeURL ? "vamotors_runtime" : "vamotors_migrator",
        })
        expect(parameters.ssl).toBeTruthy()
        expect(parameters.ssl).not.toMatchObject({ rejectUnauthorized: false })
        expect(parameters.ssl).not.toHaveProperty("checkServerIdentity")
        expect(parameters.options).toBeFalsy()
        expect(parameters.statement_timeout).toBeFalsy()
        expect(parameters.lock_timeout).toBeFalsy()
      }
    }
  )
  it.each([
    "user=owner",
    "host=foreign.example.test",
    "port=6543",
    "password=override",
    "database=foreign",
    "ssl=false",
    "sslmode=no-verify",
    "uselibpqcompat=true",
    "sslrootcert=untrusted-file",
    "options=-c%20role%3Downer",
    "statement_timeout=5000",
    "lock_timeout=5000",
    "idle_in_transaction_session_timeout=5000",
    "replication=database",
    "application_name=unreviewed",
    "%75ser=owner",
    "sslmode=verify-full",
  ])("rejects query override/startup option %s in both paths", (query) => {
    expect(() =>
      runtimeConfig({ ...runtime, DATABASE_URL: `${runtimeURL}&${query}` })
    ).toThrow("ENVIRONMENT_UNAVAILABLE")
    expect(() =>
      authorizedMigration({
        ...migration,
        DIRECT_URL: `${migrationURL}&${query}`,
      })
    ).toThrow("MIGRATOR_TARGET_MISMATCH")
  })
  it("proves the installed driver would otherwise accept the dangerous overrides", () => {
    const connection = new pg.Client({
      connectionString: `${runtimeURL.replace("verify-full", "require")}&user=owner&host=foreign.example.test&uselibpqcompat=true&statement_timeout=5000&lock_timeout=1500`,
    })
    expect(
      (connection as unknown as { connectionParameters: unknown })
        .connectionParameters
    ).toMatchObject({
      user: "owner",
      host: "foreign.example.test",
      ssl: { rejectUnauthorized: false },
      statement_timeout: "5000",
      lock_timeout: "1500",
    })
  })
})

describe("installed Prisma raw/model envelopes and bounded command retries", () => {
  it.each(["40001", "40P01", "55P03"])(
    "reproduces actual P2010 nested %s",
    async (code) => {
      const db = client(() => pgError(code))
      await expect(
        db.$queryRawUnsafe("SELECT fixture_failure")
      ).rejects.toMatchObject({
        code: "P2010",
        meta: { driverAdapterError: { cause: { originalCode: code } } },
      })
    }
  )
  it.each(["40001", "40P01"])(
    "retries real raw %s then succeeds",
    async (code) => {
      let attempts = 0
      client((sql) =>
        sql.includes("fixture_failure") && ++attempts < 3
          ? pgError(code)
          : undefined
      )
      await expect(
        transaction(async (tx) => {
          await tx.$queryRawUnsafe("SELECT fixture_failure")
          return "committed"
        })
      ).resolves.toBe("committed")
      expect(attempts).toBe(3)
    }
  )
  it.each(["40001", "40P01"])(
    "exhausts real raw %s at exactly three attempts",
    async (code) => {
      let attempts = 0
      client((sql) => {
        if (sql.includes("fixture_failure")) {
          attempts++
          return pgError(code)
        }
      })
      await expect(
        transaction((tx) => tx.$queryRawUnsafe("SELECT fixture_failure"))
      ).rejects.toMatchObject({
        code: "RETRYABLE_TRANSACTION",
        status: 503,
        retryable: true,
      })
      expect(attempts).toBe(3)
    }
  )
  it("maps real raw lock contention once, without retry", async () => {
    let attempts = 0
    client((sql) => {
      if (sql.includes("fixture_failure")) {
        attempts++
        return pgError("55P03")
      }
    })
    await expect(
      transaction((tx) => tx.$queryRawUnsafe("SELECT fixture_failure"))
    ).rejects.toMatchObject({
      code: "COMMAND_IN_PROGRESS",
      status: 409,
      retryable: true,
    })
    expect(attempts).toBe(1)
  })
  it("recognizes actual model P2034 and P2002 envelopes", async () => {
    for (const [sqlCode, code] of [
      ["40001", "RETRYABLE_TRANSACTION"],
      ["23505", "IDENTITY_CONFLICT"],
    ]) {
      let attempts = 0
      const db = client((sql) => {
        if (sql.includes('"user"')) {
          attempts++
          return pgError(sqlCode)
        }
      })
      await expect(db.user.findMany()).rejects.toHaveProperty(
        "code",
        sqlCode === "40001" ? "P2034" : "P2002"
      )
      attempts = 0
      await expect(
        transaction((tx) => tx.user.findMany())
      ).rejects.toHaveProperty("code", code)
      expect(attempts).toBe(sqlCode === "40001" ? 3 : 1)
    }
  })
  it.each(["40001", "40P01", "55P03"])(
    "also handles direct driver %s",
    async (code) => {
      client(() => undefined)
      let attempts = 0
      await expect(
        transaction(async () => {
          attempts++
          throw pgError(code)
        })
      ).rejects.toHaveProperty(
        "code",
        code === "55P03" ? "COMMAND_IN_PROGRESS" : "RETRYABLE_TRANSACTION"
      )
      expect(attempts).toBe(code === "55P03" ? 1 : 3)
    }
  )
  it("does not retry or replace an unrelated actual SQL failure", async () => {
    client((sql) =>
      sql.includes("fixture_failure") ? pgError("23514") : undefined
    )
    await expect(
      transaction((tx) => tx.$queryRawUnsafe("SELECT fixture_failure"))
    ).rejects.toHaveProperty("code", "P2010")
  })
})

describe("actual Better Auth + Prisma adapter failure logging", () => {
  let requestNumber = 0
  function request(path = "sign-in/email", origin = runtime.APP_ORIGIN) {
    return new Request(`${runtime.APP_ORIGIN}/api/auth/${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin,
        "x-request-id": marker,
        "x-forwarded-for": `192.0.2.${++requestNumber}`,
      },
      body: JSON.stringify(
        path === "sign-in/email"
          ? { email: "specimen@example.test", password: marker }
          : {}
      ),
    })
  }
  function cookie() {
    const token = "specimen-session-token"
    const signature = createHmac("sha256", runtime.BETTER_AUTH_SECRET)
      .update(token)
      .digest("base64")
    return `better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`
  }
  async function fixture(failure: (sql: string) => unknown) {
    vi.resetModules()
    Object.entries(runtime).forEach(([key, value]) => vi.stubEnv(key, value))
    const seen: unknown[][] = []
    for (const method of [
      "error",
      "warn",
      "log",
      "info",
      "debug",
      "trace",
      "dir",
    ] as const)
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        seen.push(args)
      })
    client(failure)
    const { authentication } = await import("../../lib/server/auth")
    const { POST } = await import("../../app/api/auth/[...all]/route")
    const auth = authentication()
    // Better Auth skips origin checking under NODE_ENV=test by default.
    ;(await auth.$context).skipOriginCheck = false
    return { auth, POST, seen }
  }
  it("never logs SQL/failing rows through HTTP handler or server session API", async () => {
    Object.entries(runtime).forEach(([key, value]) => vi.stubEnv(key, value))
    const seen: unknown[] = []
    for (const method of [
      "error",
      "warn",
      "log",
      "info",
      "debug",
      "trace",
      "dir",
    ] as const)
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        seen.push(args)
      })
    const queries: string[] = []
    const db = client((sql) => {
      queries.push(sql)
      return pgError("23514")
    })
    await expect(db.user.findMany()).rejects.toThrow(marker)
    queries.length = 0
    const auth = authentication()
    const response = await auth.handler(
      new Request(`${runtime.APP_ORIGIN}/api/auth/sign-in/email`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: runtime.APP_ORIGIN,
        },
        body: JSON.stringify({
          email: "specimen@example.test",
          password: marker,
        }),
      })
    )
    expect(response.status).toBe(500)
    expect(await response.text()).not.toContain(marker)
    expect(queries.some((sql) => sql.includes('"user"'))).toBe(true)
    expect(seen).toHaveLength(1)
    expect(seen[0]).toEqual([
      "AUTHENTICATION_FAILURE",
      {
        operation: "http",
        requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      },
    ])
    seen.length = 0
    const publicResponse = await POST(
      new Request(`${runtime.APP_ORIGIN}/api/auth/sign-in/email`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: runtime.APP_ORIGIN,
          "x-request-id": marker,
        },
        body: JSON.stringify({
          email: "specimen@example.test",
          password: marker,
        }),
      })
    )
    expect(publicResponse.status).toBe(500)
    expect(await publicResponse.text()).not.toContain(marker)
    expect(seen).toHaveLength(1)
    seen.length = 0
    // A valid signed cookie makes getSession reach the installed Prisma adapter.
    const token = "specimen-session-token"
    const signature = createHmac("sha256", runtime.BETTER_AUTH_SECRET)
      .update(token)
      .digest("base64")
    queries.length = 0
    const sessionFailure = await auth.api
      .getSession({
        headers: new Headers({
          cookie: `better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`,
        }),
      })
      .catch((error: unknown) => error)
    expect(sessionFailure).toMatchObject({ statusCode: 500 })
    expect(inspect(sessionFailure)).not.toContain(marker)
    expect(queries.some((sql) => sql.includes('"session"'))).toBe(true)
    expect(inspect(seen)).not.toMatch(
      /SQL_DETAIL|Failing row|password|session-token|postgresql:\/\//
    )
    expect(seen).toHaveLength(1)
    expect(seen[0]).toEqual([
      "AUTHENTICATION_FAILURE",
      {
        operation: "session",
        requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      },
    ])
  })
  it("records a swallowed sign-out SQL failure once even when the library returns success", async () => {
    const queries: string[] = []
    const { auth, seen } = await fixture((sql) => {
      queries.push(sql)
      return pgError("23514")
    })
    const input = request("sign-out")
    input.headers.set("cookie", cookie())
    const response = await auth.handler(input)
    expect(response.status).toBe(200)
    expect(await response.text()).not.toContain(marker)
    expect(queries.some((sql) => sql.includes('"session"'))).toBe(true)
    expect(seen).toEqual([
      [
        "AUTHENTICATION_FAILURE",
        {
          operation: "http",
          requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        },
      ],
    ])
    expect(inspect(seen)).not.toMatch(/SQL_DETAIL|Failing row|postgresql:\/\//)
  })
  it("does not log successful calls, missing sessions, or expected client denials", async () => {
    const { auth, POST, seen } = await fixture(() => undefined)
    expect((await POST(request("sign-out"))).status).toBe(200)
    await expect(
      auth.api.getSession({ headers: new Headers() })
    ).resolves.toBeNull()
    const headers = new Headers({ cookie: cookie() })
    await expect(auth.api.getSession({ headers })).resolves.toBeNull()
    expect((await POST(request())).status).toBe(401)
    const denied = request("sign-out", `https://${marker}.invalid`)
    denied.headers.set("cookie", cookie())
    expect((await auth.handler(denied)).status).toBe(403)
    expect(
      (await POST(request("sign-out", `https://${marker}.invalid`))).status
    ).toBe(403)
    expect((await POST(request("not-allowed"))).status).toBe(404)
    expect(seen).toEqual([])
  })
  it("bounds duplicate library/router/boundary reports to one per concurrent call and covers preflight failures", async () => {
    const { auth, POST, seen } = await fixture(() => pgError("23514"))
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => auth.handler(request()))
    )
    expect(responses.map((response) => response.status)).toEqual([
      500, 500, 500, 500, 500,
    ])
    expect(seen).toHaveLength(5)
    const ids = seen.map((entry) => {
      expect(entry).toEqual([
        "AUTHENTICATION_FAILURE",
        {
          operation: "http",
          requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        },
      ])
      return (entry[1] as { requestId: string }).requestId
    })
    expect(new Set(ids).size).toBe(5)
    seen.length = 0
    seam.environmentFailure = pgError("23514")
    const response = await POST(request())
    expect(response.status).toBe(500)
    expect(await response.text()).not.toContain(marker)
    expect(seen).toHaveLength(1)
    expect(inspect(seen)).not.toMatch(/SQL_DETAIL|Failing row|postgresql:\/\//)
  })
})

describe("state edges require own membership", () => {
  it.each([
    "constructor",
    "toString",
    "__proto__",
    "valueOf",
    "hasOwnProperty",
  ])("rejects inherited action %s in every state", (action) => {
    for (const state of states)
      expect(() => transition(state, action)).toThrow("INVALID_STATE")
  })
})
