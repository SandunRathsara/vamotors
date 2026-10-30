/** Own isolated production UI/HTTP/DB/files; no reset, secrets or cloud inputs.
 * Usage: node --import tsx tests/security/import-attachments-check.ts LOCAL_DIR PRIVATE_FILES_ROOT */
import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { spawn, execFileSync, type ChildProcess } from "node:child_process"
import { once } from "node:events"
import { createServer } from "node:net"
import { join } from "node:path"
import { lstat, readFile, writeFile, readdir, symlink } from "node:fs/promises"
import {
  chromium,
  expect,
  type BrowserContext,
  type Page,
  type APIRequestContext,
  type APIResponse,
} from "@playwright/test"
import pg from "pg"
import { privateEnvironment } from "../../scripts/private-environment"
import { validFixtures } from "../private-files/fixtures"
import type {
  Applied,
  Dependency,
  DownloadDTO,
  Grant,
  ImportBatchFilesDTO,
  Page as ResultPage,
  ImportBatchSummaryDTO,
  RoleDTO,
  UserAdminDTO,
  UploadReady,
} from "../../.planning/implementation/contracts/api"

process.umask(0o077)
const root = process.argv[2],
  filesRoot = process.argv[3]
assert.ok(root && filesRoot)
const runtime = await privateEnvironment(join(root, "runtime.env")),
  migration = await privateEnvironment(join(root, "migration.env")),
  accounts = await privateEnvironment(join(root, "accounts.env")),
  cluster = await privateEnvironment(join(root, "cluster.env"))
assert.equal(cluster.PROJECT, process.cwd())
assert.equal(runtime.APP_ENV, "local")
assert.equal(runtime.PRIVATE_FILES_ROOT, filesRoot)
assert.equal(new URL(runtime.DATABASE_URL!).hostname, "127.0.0.1")
const info = await lstat(filesRoot)
assert.ok(
  info.isDirectory() && !info.isSymbolicLink() && (info.mode & 0o777) === 0o700
)
const db = new pg.Pool({ connectionString: migration.DIRECT_URL, max: 3 }),
  restricted = new pg.Pool({ connectionString: runtime.DATABASE_URL, max: 1 })
const admin = await privateEnvironment(join(root, "admin.env")),
  monitorURL = new URL(admin.ADMIN_URL!)
monitorURL.pathname = new URL(migration.DIRECT_URL!).pathname
const monitor = new pg.Pool({ connectionString: monitorURL.href, max: 1 })
// Expected connection retirement during the owned PostgreSQL restart. Never dump
// pg pool/client configuration (it includes private connection material).
for (const pool of [db, restricted, monitor]) pool.on("error", () => {})
const socket = createServer().listen(0, "127.0.0.1")
await once(socket, "listening")
const address = socket.address()
assert.ok(address && typeof address !== "string")
const port = address.port,
  origin = `http://127.0.0.1:${port}`
await new Promise<void>((resolve) => socket.close(() => resolve()))
const sha = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim()
const suffix = randomUUID(),
  csv = Buffer.from("name,value\nSynthetic,123\n"),
  hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex")
const passed: string[] = [],
  workers = new Set<ChildProcess>()
let stage = "initialization",
  server: ChildProcess | undefined,
  browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
const manifestPath = join(root, `t06b-${suffix}-manifest.json`)
const evidence: Record<string, unknown> = {
  sha,
  root,
  filesRoot,
  origin,
  passed,
  PREBASE: true,
}
let a: BrowserContext,
  b: BrowserContext,
  staff: BrowserContext,
  anonymous: BrowserContext,
  page: Page,
  mobile: Page,
  staffPage: Page
async function group(name: string, run: () => Promise<void>) {
  stage = name
  await run()
  passed.push(name)
  await writeFile(
    manifestPath,
    JSON.stringify({ ...evidence, stage, status: "RUNNING" }, null, 2),
    { mode: 0o600 }
  )
  console.log(`PASS ${name}`)
}
async function start() {
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
        APP_ORIGIN: origin,
        BETTER_AUTH_URL: origin,
        NODE_ENV: "production",
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
    server!.stdout!.on("data", (data) => {
      if (data.toString().includes("Ready")) {
        clearTimeout(timer)
        resolve()
      }
    })
  })
}
async function stopServer() {
  if (server && server.exitCode === null && server.signalCode === null) {
    const exited = once(server, "exit")
    server.kill("SIGTERM")
    await exited
  }
  server = undefined
}
async function login(p: Page, who: "ADMIN" | "SECOND" | "STAFF") {
  await p.goto(`${origin}/login`)
  await p.getByLabel("Email Address").fill(accounts[`BOOTSTRAP_${who}_EMAIL`]!)
  await p
    .getByLabel("Password", { exact: true })
    .fill(accounts[`BOOTSTRAP_${who}_PASSWORD`]!)
  for (let attempt = 0; ; attempt++) {
    const response = p.waitForResponse(
      (r) =>
        r.url().endsWith("/api/auth/sign-in/email") &&
        r.request().method() === "POST"
    )
    await p.getByRole("button", { name: "Sign In", exact: true }).click()
    const result = await response
    if (result.status() !== 429 || attempt === 2) {
      assert.equal(result.status(), 200, `UI_LOGIN_HTTP_${result.status()}`)
      break
    }
    // Honor the real library limiter exactly; never disable it for verification.
    const seconds = Math.min(
      120,
      Math.max(1, Number(result.headers()["retry-after"] ?? 10))
    )
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000 + 100))
  }
  await p.waitForURL("**/dashboard")
}
const envelope = (
  input: unknown,
  expected: Dependency[] = [],
  key = randomUUID()
) => ({ schemaVersion: 1, idempotencyKey: key, expected, input })
const ref = (
  type: Dependency["type"],
  row: { id: string; revision: number }
): Dependency => ({ type, id: row.id, revision: row.revision })
const post = (client: APIRequestContext, name: string, body: unknown) =>
  client.post(`/api/v1/commands/${name}`, { headers: { origin }, data: body })
async function ok<T>(r: APIResponse): Promise<T> {
  assert.ok(
    [200, 201].includes(r.status()),
    `HTTP_${r.status()}_${(await r.json().catch(() => null))?.error?.code ?? "UNKNOWN"}`
  )
  assert.match(r.headers()["cache-control"], /no-store/)
  return r.json()
}
async function query<T>(client: APIRequestContext, name: string, params = "") {
  return (
    await ok<{ data: T }>(await client.get(`/api/v1/queries/${name}${params}`))
  ).data
}
async function denied(r: APIResponse, status: number, code?: string) {
  assert.equal(r.status(), status, `EXPECTED_${status}_ACTUAL_${r.status()}`)
  assert.match(r.headers()["cache-control"], /no-store/)
  const body = await r.json()
  if (code) assert.equal(body.error.code, code)
  assert.doesNotMatch(
    JSON.stringify(body),
    /postgresql:|stagingKey|finalKey|\.config\/|SQLSTATE|parser|session_token/
  )
  return body
}
const detail = (id: string, client = a.request) =>
  query<ImportBatchFilesDTO>(client, "importBatchFiles", `?id=${id}`)
async function stageBatch(
  client = a.request,
  namespace = `T06b-${randomUUID()}`
) {
  const r = await ok<Applied>(
    await post(
      client,
      "stageImport",
      envelope({ types: ["SUPPLIERS"], namespace })
    )
  )
  return detail(r.result.id, client)
}
async function init(
  batch: ImportBatchFilesDTO,
  bytes: Buffer = csv,
  client = a.request,
  filename = "synthetic.csv",
  contentType = "text/csv"
) {
  return ok<UploadReady>(
    await post(
      client,
      "initUpload",
      envelope(
        {
          target: { type: "IMPORT_BATCH", id: batch.id },
          purpose: "IMPORT_SOURCE",
          filename,
          contentType,
          size: bytes.length,
          sha256: hash(bytes),
        },
        [ref("ImportBatch", batch)]
      )
    )
  )
}
async function put(
  upload: UploadReady,
  bytes: Buffer = csv,
  client = a.request
) {
  const r = await client.put(upload.putUrl, {
    headers: { origin, ...upload.requiredHeaders },
    data: bytes,
  })
  assert.equal(
    r.status(),
    204,
    `PUT_${r.status()}_${(await r.json().catch(() => null))?.error?.code ?? "UNKNOWN"}`
  )
  assert.match(r.headers()["cache-control"], /no-store/)
}
function completeBody(
  batch: ImportBatchFilesDTO,
  uploadId: string,
  key = randomUUID()
) {
  const u = batch.uploads.find((u) => u.uploadId === uploadId)!
  return envelope(
    { uploadId },
    [
      ref("ImportBatch", batch),
      { type: "UploadIntent", id: uploadId, revision: u.revision },
    ],
    key
  )
}
async function retained(
  attachmentId: string,
  bytes: Buffer = csv,
  client = a.request
) {
  const dto = await query<DownloadDTO>(
      client,
      "download",
      `?attachmentId=${attachmentId}`
    ),
    response = await client.get(dto.url)
  assert.equal(response.status(), 200)
  assert.equal(response.headers()["x-content-type-options"], "nosniff")
  assert.match(response.headers()["content-disposition"], /^attachment;/)
  assert.match(response.headers()["cache-control"], /no-store/)
  const actual = await response.body()
  assert.equal(hash(actual), hash(bytes))
  assert.equal(dto.sha256, hash(bytes))
  assert.equal(dto.size, bytes.length)
  return dto
}
async function count(uploadId: string) {
  return (
    await db.query(
      'SELECT count(*)::integer AS n FROM vamotors."Attachment" WHERE "uploadIntentId"=$1',
      [uploadId]
    )
  ).rows[0].n as number
}
async function makeStaged(client = a.request, bytes: Buffer = csv) {
  const batch = await stageBatch(client),
    upload = await init(batch, bytes, client)
  await put(upload, bytes, client)
  return { batch: await detail(batch.id, client), upload }
}
async function worker(
  client: BrowserContext,
  body: unknown,
  mode: "final" | "validated" | "validating"
) {
  const child = spawn(
    process.execPath,
    [
      "--conditions=react-server",
      "--import",
      "tsx",
      "tests/security/import-attachments-worker.ts",
    ],
    {
      env: {
        ...process.env,
        ...runtime,
        APP_ORIGIN: origin,
        BETTER_AUTH_URL: origin,
        NODE_ENV: "production",
      },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    }
  )
  workers.add(child)
  child.stdout!.resume()
  child.stderr!.resume()
  type Message = {
    phase: "barrier" | "result"
    status: number
    code?: string
    result?: Applied
  }
  let resolveBarrier!: () => void, resolveResult!: (m: Message) => void
  const barrier = new Promise<void>((resolve) => {
      resolveBarrier = resolve
    }),
    result = new Promise<Message>((resolve) => {
      resolveResult = resolve
    })
  child.on("message", (m: Message) =>
    m.phase === "barrier" ? resolveBarrier() : resolveResult(m)
  )
  const exited = once(child, "exit").then((exit) => {
    workers.delete(child)
    return exit
  })
  const cookie = (await client.cookies(origin))
    .map((c) => `${c.name}=${c.value}`)
    .join("; ")
  child.send({ cookie, body, mode })
  await Promise.race([
    barrier,
    exited.then(() => {
      throw new Error("WORKER_EARLY_EXIT")
    }),
  ])
  return { child, exited, result, resume: () => child.send({ continue: true }) }
}

let primary: ImportBatchFilesDTO,
  primaryAttachment: string,
  originalComplete: ReturnType<typeof envelope>,
  staffRole: RoleDTO
const fullGrants: Grant[] = [
  {
    subject: "ImportBatch",
    action: "create",
    fields: ["*"],
    conditions: { createdBy: "$actor.id" },
  },
  {
    subject: "ImportBatch",
    action: "read",
    fields: ["*"],
    conditions: { createdBy: "$actor.id" },
  },
  {
    subject: "ImportBatch",
    action: "update",
    fields: ["uploads"],
    conditions: { createdBy: "$actor.id" },
  },
  {
    subject: "Document",
    action: "create",
    fields: ["*"],
    conditions: { createdBy: "$actor.id" },
  },
  {
    subject: "Document",
    action: "read",
    fields: ["*"],
    conditions: { createdBy: "$actor.id" },
  },
]
async function grants(next: Grant[]) {
  await ok(
    await post(
      a.request,
      "saveRole",
      envelope(
        {
          id: staffRole.id,
          name: staffRole.name,
          grants: next,
          reason: "Synthetic attachment authority test",
        },
        [ref("Role", staffRole)]
      )
    )
  )
  staffRole = await query<RoleDTO>(a.request, "role", `?id=${staffRole.id}`)
}
const recoveries: {
  batchId: string
  uploadId: string
  body: ReturnType<typeof envelope>
  expiresAt: string
  attachment?: boolean
}[] = []
let expiring: { batchId: string; upload: UploadReady }
try {
  await start()
  browser = await chromium.launch({ headless: true })
  a = await browser.newContext({
    baseURL: origin,
    viewport: { width: 1920, height: 1080 },
    serviceWorkers: "allow",
  })
  b = await browser.newContext({
    baseURL: origin,
    viewport: { width: 360, height: 800 },
    serviceWorkers: "allow",
  })
  staff = await browser.newContext({ baseURL: origin })
  anonymous = await browser.newContext({ baseURL: origin })
  page = await a.newPage()
  mobile = await b.newPage()
  staffPage = await staff.newPage()
  await group(
    "real sign-in, active SW, initial empty discovery and private/origin guards",
    async () => {
      await login(page, "ADMIN")
      await login(mobile, "SECOND")
      await login(staffPage, "STAFF")
      await page.waitForFunction(
        () => navigator.serviceWorker.controller?.state === "activated"
      )
      evidence.serviceWorker = await page.evaluate(
        () => navigator.serviceWorker.controller!.scriptURL
      )
      const empty = await query<ResultPage<ImportBatchSummaryDTO>>(
        a.request,
        "importBatches",
        `?namespace=${suffix}`
      )
      assert.equal(empty.total, 0)
      assert.equal(empty.data.length, 0)
      await denied(
        await anonymous.request.get("/api/v1/queries/importBatches"),
        401
      )
      await denied(
        await a.request.post("/api/v1/commands/stageImport", {
          headers: { origin: "http://foreign.invalid" },
          data: envelope({ types: ["VEHICLES"], namespace: suffix }),
        }),
        403
      )
      expiring = {
        batchId: (await stageBatch()).id,
        upload: undefined as unknown as UploadReady,
      }
      expiring.upload = await init(await detail(expiring.batchId))
    }
  )
  await group(
    "1920px keyboard STAGED metadata → bounded PUT → genuine response-loss exact-key finalize → authorized download",
    async () => {
      const businessCounts = async () =>
        (
          await db.query(
            'SELECT (SELECT count(*) FROM vamotors."PurchaseRecord")::text purchases,(SELECT count(*) FROM vamotors."PurchasePayment")::text payments,(SELECT count(*) FROM vamotors."Vehicle")::text vehicles'
          )
        ).rows[0]
      const beforeStage = await businessCounts()
      await page.goto("/imports")
      await page.getByLabel("Namespace", { exact: true }).fill(suffix)
      await page.keyboard.press("Tab")
      await expect(page.getByRole("checkbox").first()).toBeFocused()
      await page.keyboard.press("Space")
      await expect(page.getByRole("checkbox").first()).not.toBeChecked()
      await page.keyboard.press("Space")
      for (let i = 0; i < 7; i++) await page.keyboard.press("Tab")
      await expect(
        page.getByRole("button", { name: "Create STAGED batch", exact: true })
      ).toBeFocused()
      await page.keyboard.press("Enter")
      await page.waitForURL(/\/imports\/[a-f0-9-]{36}$/)
      primary = await detail(page.url().split("/").at(-1)!)
      assert.equal(primary.revision, 1)
      assert.equal(primary.state, "STAGED")
      assert.equal(primary.uploads.length, 0)
      assert.deepEqual(
        await businessCounts(),
        beforeStage,
        "STAGING_IS_NOT_BUSINESS_IMPORT"
      )
      const persisted = (
        await db.query(
          'SELECT state,revision,"createdBy",types,namespace FROM vamotors."ImportBatch" WHERE id=$1',
          [primary.id]
        )
      ).rows[0]
      assert.equal(persisted.createdBy, "03000000-0000-4000-8000-000000000011")
      assert.equal(persisted.state, "STAGED")
      assert.doesNotMatch(
        JSON.stringify(primary),
        /previewHash|VALIDATED|COMMITTED|controlTotals|finalKey|stagingKey/
      )
      await page
        .getByLabel("CSV or XLSX source file (maximum 5 MiB)")
        .setInputFiles({
          name: "synthetic.csv",
          mimeType: "text/csv",
          buffer: csv,
        })
      const uploaded = page.waitForResponse(
        (r) =>
          r.request().method() === "PUT" && r.url().includes("/api/v1/uploads/")
      )
      await page
        .getByRole("button", {
          name: "Upload source bytes with new intent",
          exact: true,
        })
        .click()
      assert.equal((await uploaded).status(), 204)
      await expect(
        page.getByRole("button", {
          name: "Finalize retained bytes",
          exact: true,
        })
      ).toBeVisible()
      let first: Applied | undefined,
        lostBody = "",
        calls = 0,
        transportFailure = "FINALIZE_TRANSPORT_FAILED"
      let dropped!: (ok: boolean) => void
      const responseDropped = new Promise<boolean>((resolve) => {
        dropped = resolve
      })
      await page.route("**/api/v1/commands/completeUpload", async (route) => {
        try {
          const body = route.request().postData()!,
            r = await route.fetch(),
            result = (await r.json()) as Applied
          if (r.status() !== 200)
            transportFailure = `FINALIZE_${r.status()}_${(result as unknown as { error?: { code: string } }).error?.code ?? "UNKNOWN"}`
          calls++
          if (calls === 1) {
            assert.equal(
              r.status(),
              200,
              `FINALIZE_${r.status()}_${(result as unknown as { error?: { code: string } }).error?.code ?? "UNKNOWN"}`
            )
            lostBody = body
            first = result
            await route.abort("failed")
            dropped(true)
          } else {
            assert.equal(body, lostBody)
            assert.equal(result.commandId, first!.commandId)
            assert.equal(result.replayed, true)
            await route.fulfill({ response: r })
          }
        } catch {
          // Playwright's exception text includes raw cookie headers: never log it.
          dropped(false)
          await route.abort("failed").catch(() => {})
        }
      })
      await page
        .getByRole("button", { name: "Finalize retained bytes", exact: true })
        .click()
      assert.ok(await responseDropped, transportFailure)
      await expect(
        page.getByRole("button", {
          name: "Retry identical request",
          exact: true,
        })
      ).toBeVisible()
      primary = await detail(primary.id)
      assert.equal(primary.uploads[0].state, "FINAL")
      assert.equal(primary.revision, 2)
      const before = await count(primary.uploads[0].uploadId)
      const counters = async () =>
        (
          await db.query(
            'SELECT (SELECT count(*) FROM vamotors."CommandReceipt")::text receipts,(SELECT count(*) FROM vamotors."AuditEntry")::text audits,(SELECT count(*) FROM vamotors."EntityReadVersion")::text versions,(SELECT count(*) FROM vamotors."UploadEvent")::text events,(SELECT value FROM vamotors."BusinessSequence" WHERE id=1)::text sequence'
          )
        ).rows[0]
      const committed = await counters()
      await page
        .getByRole("button", { name: "Retry identical request", exact: true })
        .click()
      await expect(
        page.getByRole("button", {
          name: "Download verified source",
          exact: true,
        })
      ).toBeVisible()
      assert.equal(await count(primary.uploads[0].uploadId), before)
      assert.deepEqual(await counters(), committed, "REPLAY_HAS_NO_NEW_EFFECTS")
      originalComplete = JSON.parse(lostBody)
      primaryAttachment = primary.uploads[0].attachmentId!
      await page.unroute("**/api/v1/commands/completeUpload")
      const download = page.waitForEvent("download")
      await page
        .getByRole("button", { name: "Download verified source", exact: true })
        .click()
      const receipt = await download,
        destination = join(root, `download-${suffix}.csv`)
      await receipt.saveAs(destination)
      assert.equal(hash(await readFile(destination)), hash(csv))
      evidence.primary = {
        batchId: primary.id,
        attachmentId: primaryAttachment,
        sha256: hash(csv),
        size: csv.length,
      }
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      )
      await page.screenshot({
        path: join(root, `desktop-${suffix}.png`),
        fullPage: true,
      })
    }
  )
  await group(
    "exact scopes/search/state/Colombo dates/order and unknown predicate rejection",
    async () => {
      const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Colombo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date())
      for (const params of [
        `?namespace=${suffix}&state=STAGED`,
        `?q=${suffix.toUpperCase()}&from=${today}&through=${today}`,
        `?namespace=${suffix}&sort=${encodeURIComponent('[{"field":"namespace","direction":"asc"}]')}`,
      ]) {
        const result = await query<ResultPage<ImportBatchSummaryDTO>>(
          a.request,
          "importBatches",
          params
        )
        assert.equal(result.total, 1)
        assert.equal(result.data[0].id, primary.id)
        assert.ok(Number.isFinite(new Date(result.asOf).valueOf()))
      }
      assert.equal(
        (
          await query<ResultPage<ImportBatchSummaryDTO>>(
            a.request,
            "importBatches",
            `?namespace=${suffix.toUpperCase()}`
          )
        ).total,
        0
      )
      for (const params of [
        "?createdBy=forged",
        "?state=FINAL",
        "?from=2026-02-30",
        `?sort=${encodeURIComponent('[{"field":"createdBy","direction":"asc"}]')}`,
        "?page=1&page=2",
      ])
        await denied(
          await a.request.get(`/api/v1/queries/importBatches${params}`),
          422,
          "INVALID_INPUT"
        )
    }
  )
  await group(
    "360px second-account rediscovery and validated XLSX private bytes",
    async () => {
      await mobile.goto("/imports")
      await mobile.getByLabel("Search namespace", { exact: true }).fill(suffix)
      await mobile
        .getByRole("button", { name: "Search batches", exact: true })
        .click()
      await mobile.waitForURL((url) => url.searchParams.get("q") === suffix)
      await expect(
        mobile.getByRole("status").filter({ hasText: /^1 authorized batch$/ })
      ).toBeVisible()
      await mobile.locator(`a[href="/imports/${primary.id}"]`).click()
      await expect(
        mobile.getByRole("button", {
          name: "Download verified source",
          exact: true,
        })
      ).toBeVisible()
      assert.ok(
        await mobile.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      )
      await mobile.screenshot({
        path: join(root, `mobile-${suffix}.png`),
        fullPage: true,
      })
      await retained(primaryAttachment, csv, b.request)
      const f = (await validFixtures()).find((f) =>
        f.filename.endsWith(".xlsx")
      )!
      const batch = await stageBatch(),
        u = await init(batch, f.bytes, a.request, f.filename, f.mime)
      await put(u, f.bytes)
      const result = await ok<Applied>(
        await post(
          a.request,
          "completeUpload",
          completeBody(await detail(batch.id), u.uploadId)
        )
      )
      await retained(result.result.id, f.bytes)
      evidence.xlsx = {
        attachmentId: result.result.id,
        sha256: hash(f.bytes),
        size: f.bytes.length,
      }
    }
  )
  await group(
    "active SW offline API/bytes remain errors; writes are never queued or replayed",
    async () => {
      const { batch, upload } = await makeStaged(),
        dto = await retained(primaryAttachment)
      await page.goto(`/imports/${batch.id}`)
      await expect(
        page.getByRole("button", {
          name: "Finalize retained bytes",
          exact: true,
        })
      ).toBeVisible()
      await a.setOffline(true)
      try {
        const results = await page.evaluate(
          async (url) =>
            Promise.all(
              ["/api/v1/queries/importBatches", url].map(async (path) => {
                try {
                  await fetch(path, { cache: "no-store" })
                  return "UNEXPECTED_RESPONSE"
                } catch {
                  return "UNAVAILABLE"
                }
              })
            ),
          dto.url
        )
        assert.deepEqual(results, ["UNAVAILABLE", "UNAVAILABLE"])
        await page
          .getByRole("button", { name: "Finalize retained bytes", exact: true })
          .click()
        await expect(
          page.getByRole("button", {
            name: "Retry identical request",
            exact: true,
          })
        ).toBeVisible()
        assert.equal(await count(upload.uploadId), 0)
      } finally {
        await a.setOffline(false)
      }
      await new Promise((resolve) => setTimeout(resolve, 300))
      assert.equal(
        await count(upload.uploadId),
        0,
        "NO_AUTOMATIC_ONLINE_REPLAY"
      )
      await page
        .getByRole("button", { name: "Retry identical request", exact: true })
        .click()
      await expect(
        page.getByRole("button", {
          name: "Download verified source",
          exact: true,
        })
      ).toBeVisible()
      assert.equal(await count(upload.uploadId), 1)
    }
  )
  await group(
    "strict owner/purpose/metadata/refs/MIME/hash/size/magic/failed-state negatives",
    async () => {
      const batch = await stageBatch(),
        valid = {
          target: { type: "IMPORT_BATCH", id: batch.id },
          purpose: "IMPORT_SOURCE",
          filename: "test.csv",
          contentType: "text/csv",
          size: csv.length,
          sha256: hash(csv),
        }
      for (const patch of [
        { target: { type: "VEHICLE", id: batch.id } },
        { purpose: "DO" },
        { category: "FRONT" },
        { contentType: "application/pdf" },
        { size: 5242881 },
        { sha256: "f" },
        { finalKey: "forged" },
      ])
        await denied(
          await post(
            a.request,
            "initUpload",
            envelope({ ...valid, ...patch }, [ref("ImportBatch", batch)])
          ),
          422
        )
      await denied(
        await post(a.request, "initUpload", envelope(valid)),
        428,
        "REVISION_REQUIRED"
      )
      await denied(
        await post(
          a.request,
          "initUpload",
          envelope({ ...valid, filename: "bad.html" }, [
            ref("ImportBatch", batch),
          ])
        ),
        422,
        "UPLOAD_MISMATCH"
      )
      const u = await init(batch)
      await denied(
        await a.request.put(u.putUrl, {
          headers: {
            origin,
            ...u.requiredHeaders,
            "Content-Type": "text/html",
          },
          data: csv,
        }),
        422
      )
      await denied(
        await a.request.put(u.putUrl, {
          headers: {
            origin,
            ...u.requiredHeaders,
            "X-Content-SHA256": "0".repeat(64),
          },
          data: csv,
        }),
        422
      )
      await denied(
        await a.request.put(u.putUrl, {
          headers: { origin, ...u.requiredHeaders },
          data: Buffer.alloc(5242881),
        }),
        413
      )
      await denied(
        await a.request.put(u.putUrl, {
          headers: { origin, ...u.requiredHeaders },
          data: Buffer.from("name,value\nSynthetic,124\n"),
        }),
        422
      )
      await denied(
        await anonymous.request.put(u.putUrl, {
          headers: { origin, ...u.requiredHeaders },
          data: csv,
        }),
        401
      )
      await denied(
        await post(
          a.request,
          "completeUpload",
          envelope({ uploadId: u.uploadId }, [ref("ImportBatch", batch)])
        ),
        428
      )
      const bad = Buffer.from("name,value\n<script>,1\n"),
        invalid = await init(batch, bad)
      await put(invalid, bad)
      await denied(
        await post(
          a.request,
          "completeUpload",
          completeBody(await detail(batch.id), invalid.uploadId)
        ),
        422,
        "UPLOAD_MISMATCH"
      )
      assert.equal(
        (await detail(batch.id)).uploads.find(
          (r) => r.uploadId === invalid.uploadId
        )!.state,
        "FAILED"
      )
      assert.equal(await count(invalid.uploadId), 0)
      await denied(
        await a.request.get(
          `/api/v1/attachments/${primaryAttachment}?expires=${Date.now() - 1}`
        ),
        409
      )
    }
  )
  await group(
    "same/different-key concurrent finalizers and old captured-target CAS",
    async () => {
      for (const same of [true, false]) {
        const { batch, upload } = await makeStaged(),
          body = completeBody(batch, upload.uploadId)
        const otherBody = same
          ? body
          : { ...body, idempotencyKey: randomUUID() }
        const results = await Promise.all([
          post(a.request, "completeUpload", body),
          post(a.request, "completeUpload", otherBody),
        ])
        assert.ok(results.some((r) => r.status() === 200))
        for (const r of results)
          assert.ok([200, 409].includes(r.status()), `RACE_${r.status()}`)
        assert.equal(await count(upload.uploadId), 1)
        const current = await detail(batch.id)
        const confirmed = await ok<Applied>(
          await post(
            a.request,
            "completeUpload",
            completeBody(current, upload.uploadId)
          )
        )
        assert.equal(confirmed.result.id, current.uploads[0].attachmentId)
        assert.equal(confirmed.replayed, false)
        const unchanged = await detail(batch.id)
        assert.equal(unchanged.revision, current.revision)
        assert.equal(unchanged.uploads[0].revision, current.uploads[0].revision)
        assert.equal(
          (
            await ok<Applied>(
              await post(
                a.request,
                "completeUpload",
                results[0].status() === 200 ? body : otherBody
              )
            )
          ).replayed,
          true
        )
        await denied(
          await post(a.request, "completeUpload", {
            ...body,
            input: { uploadId: randomUUID() },
          }),
          404
        )
      }
      const batch = await stageBatch(),
        first = await init(batch),
        stale = await init(batch)
      await put(first)
      await put(stale)
      await ok(
        await post(
          a.request,
          "completeUpload",
          completeBody(await detail(batch.id), first.uploadId)
        )
      )
      const current = await detail(batch.id)
      await denied(
        await post(
          a.request,
          "completeUpload",
          completeBody(current, stale.uploadId)
        ),
        409,
        "STALE_REVISION"
      )
      const fresh = await init(current)
      assert.notEqual(fresh.uploadId, stale.uploadId)
    }
  )
  await group(
    "own-only, explicit delegated read, hidden batch/documents, independent leaf redaction, 101 intents",
    async () => {
      const createdRole = await ok<Applied>(
        await post(
          a.request,
          "saveRole",
          envelope({
            name: `T06b ${suffix}`,
            grants: fullGrants,
            reason: "Synthetic staging scope",
          })
        )
      )
      staffRole = await query<RoleDTO>(
        a.request,
        "role",
        `?id=${createdRole.result.id}`
      )
      const user = await query<UserAdminDTO>(
        a.request,
        "user",
        "?id=03000000-0000-4000-8000-000000000013"
      )
      await ok(
        await post(
          a.request,
          "updateUser",
          envelope(
            {
              id: user.id,
              name: user.name,
              active: true,
              roleIds: [staffRole.id],
              reason: "Synthetic file scope",
            },
            [ref("User", user), ref("Role", staffRole)]
          )
        )
      )
      await denied(
        await staff.request.get(
          `/api/v1/queries/importBatchFiles?id=${primary.id}`
        ),
        404
      )
      const own = await stageBatch(staff.request)
      const ownList = await query<ResultPage<ImportBatchSummaryDTO>>(
        staff.request,
        "importBatches"
      )
      assert.ok(ownList.data.some((r) => r.id === own.id))
      assert.ok(!ownList.data.some((r) => r.id === primary.id))
      for (let i = 0; i < 101; i++)
        await init(own, csv, staff.request, `synthetic-${i}.csv`)
      const all = await detail(own.id, staff.request)
      assert.equal(all.uploads.length, 101)
      assert.deepEqual(
        all.uploads.map((u) => u.uploadId),
        all.uploads.map((u) => u.uploadId).sort()
      )
      await grants(
        fullGrants.map((g) =>
          g.subject === "Document" && g.action === "read"
            ? { ...g, fields: ["uploadId", "revision", "state"] }
            : g
        )
      )
      const partial = await detail(own.id, staff.request)
      assert.equal(partial.uploads.length, 101)
      assert.equal(partial.uploads[0].filename, undefined)
      assert.equal(partial.uploads[0].expiresAt, undefined)
      await grants(fullGrants.filter((g) => g.subject !== "Document"))
      assert.equal((await detail(own.id, staff.request)).uploads.length, 0)
      await grants([{ subject: "ImportBatch", action: "read", fields: ["*"] }])
      assert.equal((await detail(primary.id, staff.request)).uploads.length, 0)
      await denied(
        await post(
          staff.request,
          "initUpload",
          envelope(
            {
              target: { type: "IMPORT_BATCH", id: primary.id },
              purpose: "IMPORT_SOURCE",
              filename: "test.csv",
              contentType: "text/csv",
              size: csv.length,
              sha256: hash(csv),
            },
            [ref("ImportBatch", primary)]
          )
        ),
        403
      )
      await grants([
        { subject: "ImportBatch", action: "read", fields: ["*"] },
        {
          subject: "Document",
          action: "read",
          fields: ["attachmentId", "filename", "contentType", "size", "sha256"],
        },
      ])
      await denied(
        await staff.request.get(
          `/api/v1/queries/download?attachmentId=${primaryAttachment}`
        ),
        403,
        "FIELD_FORBIDDEN"
      )
      const issued = await retained(primaryAttachment)
      await denied(await staff.request.get(issued.url), 403, "FIELD_FORBIDDEN")
      await grants(fullGrants)
    }
  )
  await group(
    "current quota-stop leaves retained reads and old private bytes available",
    async () => {
      const policyPath = runtime.PRIVATE_FILES_POLICY!,
        policy = await readFile(policyPath, "utf8")
      try {
        await writeFile(
          policyPath,
          JSON.stringify({ ...JSON.parse(policy), allowWrites: false }),
          { mode: 0o600 }
        )
        const batch = await stageBatch()
        await denied(
          await post(
            a.request,
            "initUpload",
            envelope(
              {
                target: { type: "IMPORT_BATCH", id: batch.id },
                purpose: "IMPORT_SOURCE",
                filename: "stop.csv",
                contentType: "text/csv",
                size: csv.length,
                sha256: hash(csv),
              },
              [ref("ImportBatch", batch)]
            )
          ),
          429,
          "QUOTA_STOP"
        )
        await retained(primaryAttachment)
      } finally {
        await writeFile(policyPath, policy, { mode: 0o600 })
      }
    }
  )
  await group(
    "observed SQL lock before authorization: committed revocation wins",
    async () => {
      const target = await stageBatch(staff.request),
        blocker = await db.connect()
      try {
        await blocker.query("BEGIN")
        await blocker.query(
          'SELECT value FROM vamotors."BusinessSequence" WHERE id=1 FOR UPDATE'
        )
        const pending = post(
          staff.request,
          "initUpload",
          envelope(
            {
              target: { type: "IMPORT_BATCH", id: target.id },
              purpose: "IMPORT_SOURCE",
              filename: "locked.csv",
              contentType: "text/csv",
              size: csv.length,
              sha256: hash(csv),
            },
            [ref("ImportBatch", target)]
          )
        )
        let waiting = false
        for (let i = 0; i < 80; i++) {
          waiting =
            (
              await monitor.query(
                "SELECT count(*)::integer n FROM pg_stat_activity WHERE usename='vamotors_runtime' AND wait_event_type='Lock' AND query LIKE '%BusinessSequence%'"
              )
            ).rows[0].n > 0
          if (waiting) break
          await new Promise((r) => setTimeout(r, 10))
        }
        assert.ok(waiting)
        await grants(
          fullGrants.filter(
            (g) => !(g.subject === "Document" && g.action === "create")
          )
        )
        await blocker.query("COMMIT")
        await denied(await pending, 403)
        assert.equal((await detail(target.id)).uploads.length, 0)
      } finally {
        await blocker.query("ROLLBACK")
        blocker.release()
        await grants(fullGrants)
      }
    }
  )
  await group(
    "real adapter snapshot overwrite after validation cannot replace final bytes",
    async () => {
      const { batch, upload } = await makeStaged(),
        body = completeBody(batch, upload.uploadId),
        w = await worker(a, body, "validated")
      const row = (
        await db.query(
          'SELECT "stagingKey" FROM vamotors."UploadIntent" WHERE id=$1',
          [upload.uploadId]
        )
      ).rows[0]
      const replacement = Buffer.from("name,value\nAttacker,9999\n")
      await writeFile(join(filesRoot, row.stagingKey), replacement, {
        mode: 0o600,
      })
      w.resume()
      const result = await w.result
      await w.exited
      assert.equal(result.status, 200)
      await retained(result.result!.result.id)
      assert.equal(
        hash(await readFile(join(filesRoot, row.stagingKey))),
        hash(replacement)
      )
    }
  )
  await group(
    "during-IO revocation and post-IO target change leave correlated unlinked finals",
    async () => {
      const owned = await makeStaged(staff.request),
        body = completeBody(owned.batch, owned.upload.uploadId),
        w = await worker(staff, body, "validating")
      await grants(
        fullGrants.filter(
          (g) => !(g.subject === "Document" && g.action === "create")
        )
      )
      w.resume()
      const deniedResult = await w.result
      await w.exited
      assert.equal(deniedResult.status, 403)
      assert.equal(await count(owned.upload.uploadId), 0)
      await grants(fullGrants)
      let current = await detail(owned.batch.id)
      recoveries.push({
        batchId: current.id,
        uploadId: owned.upload.uploadId,
        body,
        expiresAt: current.uploads[0].claimExpiresAt!,
      })
      const stale = await makeStaged(),
        other = await init(stale.batch)
      await put(other)
      const staleBody = completeBody(stale.batch, stale.upload.uploadId),
        changing = await worker(a, staleBody, "final")
      await ok(
        await post(
          a.request,
          "completeUpload",
          completeBody(await detail(stale.batch.id), other.uploadId)
        )
      )
      changing.resume()
      const changed = await changing.result
      await changing.exited
      assert.equal(changed.status, 409)
      assert.equal(changed.code, "STALE_REVISION")
      assert.equal(await count(stale.upload.uploadId), 0)
      current = await detail(stale.batch.id)
      assert.equal(
        current.uploads.find((u) => u.uploadId === stale.upload.uploadId)!
          .state,
        "FINALIZING"
      )
      evidence.staleOrphan = { uploadId: stale.upload.uploadId, linked: false }
    }
  )
  await group(
    "session revoked during IO cannot link; explicit current finalizer may later recover",
    async () => {
      const { batch, upload } = await makeStaged(staff.request),
        body = completeBody(batch, upload.uploadId),
        w = await worker(staff, body, "validated")
      const logout = await staff.request.post("/api/auth/sign-out", {
        headers: { origin },
        data: {},
      })
      assert.equal(logout.status(), 200)
      w.resume()
      const result = await w.result
      await w.exited
      assert.equal(result.status, 401)
      assert.equal(await count(upload.uploadId), 0)
      const current = await detail(batch.id)
      recoveries.push({
        batchId: batch.id,
        uploadId: upload.uploadId,
        body,
        expiresAt: current.uploads[0].claimExpiresAt!,
      })
      // The revoked page's privacy boundary may still be redirecting. Use a
      // genuinely new browser context for the next ordinary sign-in.
      await staff.close()
      staff = await browser!.newContext({ baseURL: origin })
      staffPage = await staff.newPage()
      await login(staffPage, "STAFF")
    }
  )
  await group(
    "essential audit/link rollback retains exact correlated orphan for explicit recovery",
    async () => {
      const { batch, upload } = await makeStaged(),
        body = completeBody(batch, upload.uploadId),
        w = await worker(a, body, "final")
      const before = (
        await db.query('SELECT count(*)::integer n FROM vamotors."Attachment"')
      ).rows[0].n
      await db.query(
        'REVOKE INSERT ON vamotors."AuditEntry" FROM vamotors_runtime'
      )
      try {
        w.resume()
        const result = await w.result
        await w.exited
        assert.equal(result.status, 500)
      } finally {
        await db.query(
          'GRANT INSERT ON vamotors."AuditEntry" TO vamotors_runtime'
        )
      }
      assert.equal(await count(upload.uploadId), 0)
      assert.equal(
        (
          await db.query(
            'SELECT count(*)::integer n FROM vamotors."Attachment"'
          )
        ).rows[0].n,
        before
      )
      const current = await detail(batch.id)
      assert.equal(current.revision, batch.revision)
      assert.equal(current.uploads[0].state, "FINALIZING")
      recoveries.push({
        batchId: batch.id,
        uploadId: upload.uploadId,
        body,
        expiresAt: current.uploads[0].claimExpiresAt!,
      })
    }
  )
  await group(
    "crash after immutable final before DB; live lease and foreign-key/key isolation",
    async () => {
      const { batch, upload } = await makeStaged(),
        body = completeBody(batch, upload.uploadId),
        w = await worker(a, body, "final")
      await denied(
        await post(a.request, "completeUpload", body),
        409,
        "COMMAND_IN_PROGRESS"
      )
      const current = await detail(batch.id)
      assert.equal(current.uploads[0].state, "FINALIZING")
      assert.equal(current.uploads[0].attachmentId, null)
      w.child.kill("SIGKILL")
      await w.exited
      recoveries.push({
        batchId: batch.id,
        uploadId: upload.uploadId,
        body,
        expiresAt: current.uploads[0].claimExpiresAt!,
      })
      assert.equal(await count(upload.uploadId), 0)
      const keys = (
        await db.query(
          'SELECT u."stagingKey",a."finalKey" FROM vamotors."UploadIntent" u JOIN vamotors."UploadAttempt" a ON a.id=u."currentAttemptId" WHERE u.id=$1',
          [upload.uploadId]
        )
      ).rows[0]
      assert.equal(
        hash(await readFile(join(filesRoot, keys.finalKey))),
        hash(csv)
      )
      for (const raw of [keys.stagingKey, keys.finalKey])
        assert.equal(
          (await anonymous.request.get(`/${encodeURIComponent(raw)}`)).status(),
          404
        )
      const isolated = await makeStaged(),
        isolatedKey = (
          await db.query(
            'SELECT "stagingKey" FROM vamotors."UploadIntent" WHERE id=$1',
            [isolated.upload.uploadId]
          )
        ).rows[0].stagingKey
      // A fresh own intent names a symlink, never a retained user's final.
      const target = join(root, `symlink-specimen-${suffix}.csv`)
      await writeFile(target, csv, { mode: 0o600, flag: "wx" })
      const untouched = await init(await stageBatch())
      const emptyKey = (
        await db.query(
          'SELECT "stagingKey" FROM vamotors."UploadIntent" WHERE id=$1',
          [untouched.uploadId]
        )
      ).rows[0].stagingKey
      await symlink(target, join(filesRoot, emptyKey))
      const symlinkBatch = (
        await db.query(
          'SELECT "batchId" FROM vamotors."UploadIntent" WHERE id=$1',
          [untouched.uploadId]
        )
      ).rows[0].batchId
      await denied(
        await post(
          a.request,
          "completeUpload",
          completeBody(await detail(symlinkBatch), untouched.uploadId)
        ),
        503,
        "STORAGE_UNAVAILABLE"
      )
      assert.equal(hash(await readFile(target)), hash(csv))
      assert.ok(isolatedKey)
      // Keep unsafe specimen retained, but outside the active storage directory so
      // later inventory is not mislabeled complete. The symlink itself is retained.
      const { rename } = await import("node:fs/promises")
      await rename(
        join(filesRoot, emptyKey),
        join(root, `retained-symlink-${suffix}`)
      )
    }
  )
  await group(
    "crash before validation cannot recover fresh staging bytes after original expiry",
    async () => {
      const { batch, upload } = await makeStaged(),
        body = completeBody(batch, upload.uploadId),
        w = await worker(a, body, "validating")
      const current = await detail(batch.id)
      w.child.kill("SIGKILL")
      await w.exited
      assert.equal(await count(upload.uploadId), 0)
      recoveries.push({
        batchId: batch.id,
        uploadId: upload.uploadId,
        body,
        expiresAt: current.uploads[0].claimExpiresAt!,
        attachment: false,
      })
    }
  )
  await group(
    "restricted metadata grants, append-only history and no private SW caches",
    async () => {
      for (const table of ["Attachment", "UploadAttempt", "UploadEvent"]) {
        const acl = (
          await restricted.query(
            "SELECT has_table_privilege(current_user,$1,'UPDATE') edit,has_table_privilege(current_user,$1,'DELETE') remove,has_table_privilege(current_user,$1,'TRUNCATE') truncate",
            [`vamotors.\"${table}\"`]
          )
        ).rows[0]
        assert.deepEqual(acl, { edit: false, remove: false, truncate: false })
      }
      assert.equal(
        (
          await restricted.query(
            "SELECT has_column_privilege(current_user,'vamotors.\"UploadIntent\"','stagingKey','UPDATE') allowed"
          )
        ).rows[0].allowed,
        false
      )
      assert.equal(
        (
          await restricted.query(
            "SELECT has_schema_privilege(current_user,'vamotors','CREATE') allowed"
          )
        ).rows[0].allowed,
        false
      )
      for (const sql of [
        `INSERT INTO vamotors."UploadEvent"(id,"uploadId",revision,state,"attemptId","commandId") SELECT gen_random_uuid(),"uploadId",revision+10000,state,"attemptId","commandId" FROM vamotors."UploadEvent" WHERE "uploadId"=$1 ORDER BY revision DESC LIMIT 1`,
        `WITH fresh AS (SELECT gen_random_uuid() id,gen_random_uuid() nonce) INSERT INTO vamotors."UploadAttempt"(id,"environmentId","uploadId","createdBy","claimedAt","claimExpiresAt","commandId","idempotencyKey","inputHash","uploadRevision","targetRevision","finalKey",size,sha256,"contentType") SELECT fresh.id,old."environmentId",old."uploadId",old."createdBy",old."claimedAt",old."claimExpiresAt",gen_random_uuid(),gen_random_uuid(),old."inputHash",old."uploadRevision",old."targetRevision",'f.'||old."environmentId"::text||'.'||old."uploadId"::text||'.'||fresh.id::text||'.'||fresh.nonce::text,old.size,old.sha256,old."contentType" FROM vamotors."UploadAttempt" old CROSS JOIN fresh WHERE old."uploadId"=$1 LIMIT 1`,
      ]) {
        await restricted.query("BEGIN")
        try {
          await restricted.query(sql, [primary.uploads[0].uploadId])
          await assert.rejects(
            restricted.query("SET CONSTRAINTS ALL IMMEDIATE"),
            (error: unknown) => (error as { code?: string }).code === "23514"
          )
        } finally {
          await restricted.query("ROLLBACK")
        }
      }
      const cacheURLs = await page.evaluate(async () =>
        (
          await Promise.all(
            (await caches.keys()).map(async (name) =>
              (await (await caches.open(name)).keys()).map((r) => r.url)
            )
          )
        ).flat()
      )
      assert.ok(
        !cacheURLs.some((url) =>
          /\/imports|\/api\/v1|attachment|upload|login|dashboard/.test(url)
        )
      )
      evidence.cacheURLs = cacheURLs
    }
  )
  await group(
    "natural original expiry and live→expired lease recovery after real process/DB restart",
    async () => {
      const retentionRows = async () =>
        (
          await db.query(
            'SELECT id,"uploadIntentId","batchId","attemptId",sha256,size,"finalKey" FROM vamotors."Attachment" ORDER BY id'
          )
        ).rows
      const beforeRestart = await retentionRows()
      await stopServer()
      execFileSync(
        process.execPath,
        ["--import", "tsx", "scripts/local-postgres.ts", "stop"],
        { env: { ...process.env, VAMOTORS_LOCAL_DIR: root }, stdio: "pipe" }
      )
      execFileSync(
        process.execPath,
        ["--import", "tsx", "scripts/local-postgres.ts", "start"],
        { env: { ...process.env, VAMOTORS_LOCAL_DIR: root }, stdio: "pipe" }
      )
      await start()
      assert.deepEqual(
        await retentionRows(),
        beforeRestart,
        "RESTART_EXACT_HASH_COUNT_REFS"
      )
      evidence.restart = {
        retainedAttachmentCount: beforeRestart.length,
        attachmentMetadataSHA256: hash(
          Buffer.from(JSON.stringify(beforeRestart))
        ),
      }
      // One deadline wait, not polling or a test-only clock/permission bypass.
      const latest = Math.max(
        new Date(expiring.upload.expiresAt).valueOf(),
        ...recoveries.map((r) => new Date(r.expiresAt).valueOf())
      )
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(0, latest + 100 - Date.now()))
      )
      await denied(
        await a.request.put(expiring.upload.putUrl, {
          headers: { origin, ...expiring.upload.requiredHeaders },
          data: csv,
        }),
        409,
        "UPLOAD_EXPIRED"
      )
      const expiredBatch = await detail(expiring.batchId)
      await denied(
        await post(
          a.request,
          "completeUpload",
          completeBody(expiredBatch, expiring.upload.uploadId)
        ),
        409,
        "UPLOAD_EXPIRED"
      )
      const newIntent = await init(expiredBatch)
      assert.notEqual(newIntent.uploadId, expiring.upload.uploadId)
      assert.ok(
        new Date(newIntent.expiresAt).valueOf() >
          new Date(expiring.upload.expiresAt).valueOf()
      )
      for (const [index, item] of recoveries.entries()) {
        const current = await detail(item.batchId)
        assert.equal(
          current.uploads.find((u) => u.uploadId === item.uploadId)!.state,
          "FINALIZING"
        )
        // Original exact-key lost-response request and fresh explicit discovery
        // recovery are separate cases; neither supplies an attempt or filesystem key.
        const body =
          index % 2 === 0 ? item.body : completeBody(current, item.uploadId)
        const client = index === 0 ? staff.request : a.request
        if (item.attachment === false) {
          await denied(
            await post(client, "completeUpload", body),
            409,
            "DOCUMENT_NOT_READY"
          )
          assert.equal(await count(item.uploadId), 0)
          assert.equal((await detail(item.batchId)).uploads[0].state, "FAILED")
          continue
        }
        const result = await ok<Applied>(
          await post(client, "completeUpload", body)
        )
        await retained(result.result.id, csv, a.request)
        assert.equal(await count(item.uploadId), 1)
        if (body === item.body)
          assert.equal(
            (await ok<Applied>(await post(client, "completeUpload", body)))
              .replayed,
            true
          )
      }
      const freshContext = await browser!.newContext({ baseURL: origin }),
        fresh = await freshContext.newPage()
      await login(fresh, "ADMIN")
      primary = await detail(primary.id, freshContext.request)
      assert.equal(primary.state, "STAGED")
      assert.equal(primary.uploads[0].attachmentId, primaryAttachment)
      await retained(primaryAttachment, csv, freshContext.request)
      await fresh.goto(`/imports/${primary.id}`)
      await expect(
        fresh.getByRole("button", {
          name: "Download verified source",
          exact: true,
        })
      ).toBeVisible()
      assert.equal(
        (
          await ok<Applied>(
            await post(freshContext.request, "completeUpload", originalComplete)
          )
        ).replayed,
        true
      )
      await freshContext.close()
      evidence.recoveries = recoveries.map(
        ({ batchId, uploadId, attachment }) => ({
          batchId,
          uploadId,
          linkedCount: attachment === false ? 0 : 1,
        })
      )
    }
  )
  evidence.counts = (
    await db.query(
      'SELECT (SELECT count(*) FROM vamotors."ImportBatch")::integer batches,(SELECT count(*) FROM vamotors."UploadIntent")::integer intents,(SELECT count(*) FROM vamotors."Attachment")::integer attachments,(SELECT count(*) FROM vamotors."UploadAttempt")::integer attempts,(SELECT count(*) FROM vamotors."UploadEvent")::integer events'
    )
  ).rows[0]
  evidence.storageEntries = (await readdir(filesRoot)).length
  evidence.status =
    "PASS — author contributions, PREBASE; not independent acceptance or restore"
} catch (error) {
  evidence.status = "FAIL"
  evidence.failedStage = stage
  // Playwright/pg exception messages can embed authentication headers, SQL or
  // private keys. Persist only fixed machine diagnostics, never their raw text.
  evidence.error =
    error instanceof Error && /^[A-Z][A-Z0-9_]{0,160}$/.test(error.message)
      ? error.message
      : error instanceof assert.AssertionError
        ? `ASSERT_${error.operator}`
        : error instanceof Error
          ? error.name
          : "UNKNOWN"
  evidence.failureLocation =
    error instanceof Error
      ? error.stack
          ?.split("\n")
          .find((line) =>
            /^\s+at .*\/tests\/security\/import-attachments-check\.ts:\d+:\d+/.test(
              line
            )
          )
          ?.trim()
      : undefined
  console.error(`FAIL ${stage}: ${evidence.error}`)
  process.exitCode = 1
} finally {
  for (const child of workers) {
    const exited = once(child, "exit")
    child.kill("SIGKILL")
    await exited
  }
  await browser?.close()
  await stopServer()
  await db.end()
  await restricted.end()
  await monitor.end()
  await writeFile(
    manifestPath,
    JSON.stringify({ ...evidence, stopped: true }, null, 2),
    { mode: 0o600 }
  )
  console.log(
    `Retained manifest: ${manifestPath}; sha256=${hash(await readFile(manifestPath))}`
  )
}
