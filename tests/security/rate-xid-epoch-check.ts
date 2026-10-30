/** F1: one width-wrap expression witness + real publish and denied late append.
 * Does not simulate/force a cluster epoch or claim a post-wrap workflow. */
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { spawn, execFileSync, type ChildProcess } from "node:child_process"
import { once } from "node:events"
import { createServer } from "node:net"
import { join } from "node:path"
import { writeFile } from "node:fs/promises"
import { request } from "@playwright/test"
import pg from "pg"
import { privateEnvironment } from "../../scripts/private-environment"
import type { Applied } from "../../.planning/implementation/contracts/api"

process.umask(0o077)
const root = process.argv[2]
assert.ok(root)
const runtime = await privateEnvironment(join(root, "runtime.env")),
  migration = await privateEnvironment(join(root, "migration.env")),
  accounts = await privateEnvironment(join(root, "accounts.env")),
  cluster = await privateEnvironment(join(root, "cluster.env"))
assert.equal(cluster.PROJECT, process.cwd())
assert.equal(runtime.APP_ENV, "local")
assert.equal(new URL(runtime.DATABASE_URL!).hostname, "127.0.0.1")
const db = new pg.Pool({ connectionString: migration.DIRECT_URL, max: 1 })
let server: ChildProcess | undefined
const suffix = randomUUID().slice(0, 8),
  parent = "e9ba1a939667fc46178f89cccae1022a4bbcfb7e"
try {
  const witness = (
    await db.query(
      "SELECT ('3'::xid)::text=('4294967299'::xid8)::text AS old_text_width_mismatch, ('3'::xid)=('4294967299'::xid8)::xid AS normalized_width_match"
    )
  ).rows[0]
  assert.deepEqual(witness, {
    old_text_width_mismatch: false,
    normalized_width_match: true,
  })
  const source = execFileSync(
      "git",
      [
        "show",
        `${parent}:prisma/migrations/202610300001_exact_rates_quotes/migration.sql`,
      ],
      { encoding: "utf8" }
    ),
    body = source.match(
      /CREATE FUNCTION vamotors\.rate_graph_guard\(\)[\s\S]*?AS \$\$([\s\S]*?)\$\$;/
    )![1]
  const actual = (
    await db.query(
      "SELECT p.prosrc,pg_get_userbyid(p.proowner) AS owner,p.prosecdef,p.proconfig FROM pg_proc p WHERE p.oid='vamotors.rate_graph_guard()'::regprocedure"
    )
  ).rows[0]
  assert.equal(
    actual.prosrc,
    body.replace(
      "c.xmin::text=pg_current_xact_id()::text",
      "c.xmin=pg_current_xact_id()::xid"
    )
  )
  assert.equal(actual.owner, "vamotors_migrator")
  assert.equal(actual.prosecdef, false)
  assert.deepEqual(actual.proconfig, ["search_path=pg_catalog"])
  const previousQuotes = (
    await db.query(
      'SELECT to_jsonb(q) AS row FROM vamotors."Quote" q ORDER BY id'
    )
  ).rows
  const socket = createServer().listen(0, "127.0.0.1")
  await once(socket, "listening")
  const address = socket.address()
  assert.ok(address && typeof address !== "string")
  const port = address.port,
    origin = `http://127.0.0.1:${port}`
  await new Promise<void>((r) => socket.close(() => r()))
  server = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      env: {
        ...process.env,
        ...runtime,
        NODE_ENV: "production",
        APP_ORIGIN: origin,
        BETTER_AUTH_URL: origin,
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  )
  server.stderr!.resume()
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("START_TIMEOUT")), 20000)
    server!.once("exit", () => {
      clearTimeout(timer)
      reject(new Error("EARLY_EXIT"))
    })
    server!.stdout!.on("data", (c) => {
      if (c.toString().includes("Ready")) {
        clearTimeout(timer)
        resolve()
      }
    })
  })
  const client = await request.newContext({ baseURL: origin })
  let publication!: Applied
  try {
    const login = await client.post("/api/auth/sign-in/email", {
      data: {
        email: accounts.BOOTSTRAP_ADMIN_EMAIL,
        password: accounts.BOOTSTRAP_ADMIN_PASSWORD,
      },
      headers: { Origin: origin },
    })
    assert.equal(login.status(), 200)
    const command = async (
      name: string,
      input: unknown,
      expected: unknown[]
    ) => {
      const response = await client.post(`/api/v1/commands/${name}`, {
        data: {
          schemaVersion: 1,
          idempotencyKey: randomUUID(),
          expected,
          input,
        },
        headers: { Origin: origin },
      })
      const value = await response.json()
      assert.equal(response.status(), 201, `${name}:${JSON.stringify(value)}`)
      return value as Applied
    }
    const settingsResponse = await client.get("/api/v1/queries/settings"),
      settings = (await settingsResponse.json()).data
    assert.equal(settingsResponse.status(), 200)
    const finance = await command(
      "createFinanceCompany",
      {
        name: `F1 synthetic ${suffix}`,
        contacts: [],
        policy: {
          path: "APPLICATION",
          commission: { basis: "FIXED", fixed: "5000", rateBps: 0 },
          processingFee: "250000",
          reconciliationMethod: "PER_DEAL",
        },
      },
      [{ type: "Settings", id: settings.id, revision: settings.revision }]
    )
    publication = await command(
      "publishRates",
      {
        companyId: finance.result.id,
        make: "F1Synthetic",
        model: suffix,
        year: 2026,
        validFrom: "2026-01-01",
        validThrough: "2027-12-31",
        maximum: "120000",
        cards: [{ principal: "100000", months: 12, installment: "9000" }],
      },
      [
        {
          type: "FinanceCompany",
          id: finance.result.id,
          revision: finance.result.revision,
        },
      ]
    )
  } finally {
    await client.dispose()
  }
  const card = (
    await db.query(
      'SELECT * FROM vamotors."RateCardEntry" WHERE "sheetVersionId"=$1',
      [publication.result.id]
    )
  ).rows
  assert.equal(card.length, 1)
  assert.equal(card[0].principal, "100000")
  const before = (
    await db.query(
      'SELECT to_jsonb(c) AS row FROM vamotors."RateCardEntry" c ORDER BY id'
    )
  ).rows
  await assert.rejects(
    db.query(
      'INSERT INTO vamotors."RateCardEntry"(id,"sheetVersionId",principal,months,installment) VALUES($1,$2,100000,36,3500)',
      [randomUUID(), publication.result.id]
    ),
    (error: unknown) =>
      error instanceof Error && error.message.includes("IMMUTABLE_RATE_CARDS")
  )
  assert.deepEqual(
    (
      await db.query(
        'SELECT to_jsonb(c) AS row FROM vamotors."RateCardEntry" c ORDER BY id'
      )
    ).rows,
    before
  )
  assert.deepEqual(
    (
      await db.query(
        'SELECT to_jsonb(q) AS row FROM vamotors."Quote" q ORDER BY id'
      )
    ).rows,
    previousQuotes
  )
  await writeFile(
    join(root, `rate-xid-epoch-${suffix}.json`),
    JSON.stringify(
      {
        head: execFileSync("git", ["rev-parse", "HEAD"], {
          encoding: "utf8",
        }).trim(),
        dirty: !!execFileSync("git", ["status", "--porcelain"], {
          encoding: "utf8",
        }).trim(),
        acceptedParent: parent,
        witness,
        originalMigrationUnchanged: true,
        onlyRateGuardChange: "c.xmin=pg_current_xact_id()::xid",
        lawfulPublicationCommandId: publication.commandId,
        sameTransactionPublish: "PASS",
        lateCardAppend: "DENIED_UNCHANGED",
        previousQuoteCount: previousQuotes.length,
        independentVerification: "PENDING",
        notPostWrapWorkflow: true,
      },
      null,
      2
    ),
    { mode: 0o600 }
  )
  console.log(
    `PASS F1 focused width expression, exact minimal function replacement, lawful publication and denied late append; rate-xid-epoch-${suffix}.json; not a post-wrap workflow`
  )
} finally {
  if (server?.exitCode === null) {
    const end = once(server, "exit")
    server.kill("SIGTERM")
    await end
  }
  await db.end()
}
