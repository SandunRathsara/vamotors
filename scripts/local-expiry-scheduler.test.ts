// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest"
import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { createServer, type IncomingMessage, type Server } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  assertLoopbackBaseUrl,
  computeExpiryHealth,
  createExpiryScheduler,
  deriveDeterministicIdempotencyKey,
  loadPrivateSecret,
  parseExpirySchedulerCliArgs,
  redactSensitiveText,
  runExpiryScheduler,
  type ExpiryTickRecord,
} from "./local-expiry-scheduler"

interface RecordedHttpCall {
  method: string | undefined
  url: string | undefined
  headers: Record<string, string | string[] | undefined>
  body: Record<string, unknown>
}

interface TestServerHandle {
  baseUrl: string
  calls: RecordedHttpCall[]
  close: () => Promise<void>
}

const tempDirs: string[] = []
const servers: Server[] = []

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "vamotors-expiry-test-"))
  tempDirs.push(dir)
  return dir
}

async function writeSecretFile(
  dir: string,
  name: string,
  content: string,
  mode: number
): Promise<string> {
  const filePath = join(dir, name)
  await writeFile(filePath, content, { mode })
  await chmod(filePath, mode)
  return filePath
}

async function startTestServer(
  handler: (
    call: RecordedHttpCall,
    index: number,
    res: import("node:http").ServerResponse
  ) => void | Promise<void>
): Promise<TestServerHandle> {
  const calls: RecordedHttpCall[] = []
  const server = createServer((req: IncomingMessage, res) => {
    const chunks: Buffer[] = []
    req.on("data", (chunk: Buffer) => chunks.push(chunk))
    req.on("end", () => {
      void (async () => {
        const rawBody = Buffer.concat(chunks).toString("utf8")
        let body: Record<string, unknown> = {}
        try {
          body = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {}
        } catch {
          body = {}
        }
        const call: RecordedHttpCall = {
          method: req.method,
          url: req.url,
          headers: { ...req.headers },
          body,
        }
        const index = calls.push(call) - 1
        await handler(call, index, res)
      })()
    })
  })
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === "string") {
    throw new Error("FAILED_TO_BIND_TEST_SERVER")
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    calls,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      }),
  }
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (srv) =>
        new Promise<void>((resolve) => {
          srv.close(() => resolve())
        })
    )
  )
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  )
})

describe("local-expiry-scheduler security guards", () => {
  it("rejects non-loopback baseUrl hosts and embedded credentials", () => {
    expect(() => assertLoopbackBaseUrl("http://127.0.0.1:8000")).not.toThrow()
    expect(() => assertLoopbackBaseUrl("http://localhost:8000")).not.toThrow()
    expect(() => assertLoopbackBaseUrl("https://127.0.0.1:8443")).not.toThrow()

    for (const badUrl of [
      "https://api.example.com",
      "http://192.168.1.50:8000",
      "http://0.0.0.0:8000",
      "http://user:pass@127.0.0.1:8000",
      "ftp://127.0.0.1:8000",
      "not-a-url",
    ]) {
      expect(() => assertLoopbackBaseUrl(badUrl)).toThrow()
      expect(() =>
        createExpiryScheduler({
          baseUrl: badUrl,
          secretFilePath: "/tmp/unused",
        })
      ).toThrow()
    }
  })

  it("rejects insecure (0644) secret files, symlinks, and missing secrets without leaking content", async () => {
    const dir = await makeTempDir()
    const secret = "super-secret-scheduler-token-99887766"
    const insecureFile = await writeSecretFile(
      dir,
      "insecure.env",
      `SCHEDULER_SECRET=${secret}\n`,
      0o644
    )
    const groupReadableFile = await writeSecretFile(
      dir,
      "group.env",
      `SCHEDULER_SECRET=${secret}\n`,
      0o640
    )
    const secureFile = await writeSecretFile(
      dir,
      "secure.env",
      `SCHEDULER_SECRET=${secret}\n`,
      0o600
    )
    const linkedFile = join(dir, "symlink.env")
    await symlink(secureFile, linkedFile)

    for (const badPath of [
      insecureFile,
      groupReadableFile,
      linkedFile,
      join(dir, "does-not-exist.env"),
    ]) {
      let caught: unknown
      try {
        await loadPrivateSecret(badPath)
      } catch (err) {
        caught = err
      }
      expect(caught).toBeInstanceOf(Error)
      const msg = (caught as Error).message
      expect(msg).not.toContain(secret)
      expect(msg).not.toContain("SCHEDULER_SECRET=")
    }

    const loaded = await loadPrivateSecret(secureFile)
    expect(loaded.token).toBe(secret)
  })

  it("redacts secrets, cookies, and authorization headers from logs and error diagnostics", async () => {
    const dir = await makeTempDir()
    const secret = "tok_live_ultra_sensitive_abc123456"
    const cookieSecret = "session_cookie_xyz987654"
    const secretFile = await writeSecretFile(
      dir,
      "scheduler.env",
      `SCHEDULER_SECRET=${secret}\nAUTH_COOKIE=${cookieSecret}\n`,
      0o600
    )

    const srv = await startTestServer((_call, _idx, res) => {
      res.writeHead(500, {
        "content-type": "application/json",
        "set-cookie": `sid=${cookieSecret}; HttpOnly`,
      })
      res.end(
        JSON.stringify({
          ok: false,
          error: {
            code: `ERR_Bearer ${secret}_Cookie=${cookieSecret}`,
            message: `Authorization: Bearer ${secret}`,
          },
        })
      )
    })

    const capturedLines: string[] = []
    const health = await runExpiryScheduler({
      baseUrl: srv.baseUrl,
      secretFilePath: secretFile,
      once: true,
      output: {
        write: (line: string) => {
          capturedLines.push(line)
        },
      },
    })

    expect(health.failedTicks).toBe(1)
    expect(health.consecutiveFailures).toBe(1)
    const allLogs = capturedLines.join("")
    expect(allLogs).not.toContain(secret)
    expect(allLogs).not.toContain(cookieSecret)
    expect(allLogs).not.toContain("Bearer ")
    expect(health.lastFailureCode ?? "").not.toContain(secret)
    expect(health.lastFailureCode ?? "").not.toContain(cookieSecret)

    const sanitized = redactSensitiveText(
      `Authorization: Bearer ${secret}; Cookie: sid=${cookieSecret}; SCHEDULER_SECRET=${secret}`,
      [secret, cookieSecret]
    )
    expect(sanitized).not.toContain(secret)
    expect(sanitized).not.toContain(cookieSecret)
    expect(sanitized).toContain("[REDACTED]")
  })
})

describe("local-expiry-scheduler timer execution, resilience, and catch-up", () => {
  it("executes 3 real timer ticks with auth header, deterministic idempotencyKey, and structured JSON telemetry", async () => {
    const dir = await makeTempDir()
    const secret = "sched_token_real_timer_001"
    const secretFile = await writeSecretFile(
      dir,
      "scheduler.env",
      `SCHEDULER_SECRET=${secret}\n`,
      0o600
    )

    const srv = await startTestServer((call, idx, res) => {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(
        JSON.stringify({
          ok: true,
          status: "JOB_RESULT",
          runId: `11111111-1111-4111-8111-00000000000${idx + 1}`,
          cutoff: (call.body.input as { through?: string })?.through,
          processed: 2,
          expired: 1,
          warned: 1,
          skipped: 0,
          failures: [],
          nextCursor: null,
        })
      )
    })

    const capturedLines: string[] = []
    const health = await runExpiryScheduler({
      baseUrl: srv.baseUrl,
      secretFilePath: secretFile,
      intervalMs: 40,
      maxTicks: 3,
      output: {
        write: (line: string) => {
          capturedLines.push(line)
        },
      },
    })

    expect(srv.calls).toHaveLength(3)
    expect(health.totalTicks).toBe(3)
    expect(health.successfulTicks).toBe(3)
    expect(health.consecutiveFailures).toBe(0)
    expect(health.lastSuccessAt).not.toBeNull()
    expect(health.isStale).toBe(false)

    const seenKeys = new Set<string>()
    for (const [idx, call] of srv.calls.entries()) {
      expect(call.method).toBe("POST")
      expect(call.url).toBe("/api/v1/commands/runExpiry")
      expect(call.headers.authorization).toBe(`Bearer ${secret}`)
      expect(call.headers.origin).toBe(srv.baseUrl)
      expect(call.headers["x-scheduler-mode"]).toBe("SCHEDULED")
      expect(call.body.schemaVersion).toBe(1)
      expect(call.body.expected).toEqual([])
      const key = String(call.body.idempotencyKey)
      expect(key).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      )
      expect(call.headers["x-idempotency-key"]).toBe(key)
      seenKeys.add(key)

      const logRecord = JSON.parse(capturedLines[idx]!) as ExpiryTickRecord
      expect(logRecord.event).toBe("expiry_tick")
      expect(logRecord.tickNumber).toBe(idx + 1)
      expect(logRecord.mode).toBe("SCHEDULED")
      expect(logRecord.status).toBe(200)
      expect(logRecord.ok).toBe(true)
      expect(logRecord.jobRunId).toBe(
        `11111111-1111-4111-8111-00000000000${idx + 1}`
      )
      expect(logRecord.consecutiveFailures).toBe(0)
      expect(logRecord.durationMs).toBeGreaterThanOrEqual(0)
    }
    expect(seenKeys.size).toBe(3)
    expect(capturedLines.join("")).not.toContain(secret)
  })

  it("enforces non-overlapping guard when server responds slowly", async () => {
    const dir = await makeTempDir()
    const secretFile = await writeSecretFile(
      dir,
      "scheduler.env",
      "SCHEDULER_SECRET=overlap_guard_token\n",
      0o600
    )

    let activeRequests = 0
    let maxConcurrent = 0
    const srv = await startTestServer(async (_call, idx, res) => {
      activeRequests += 1
      maxConcurrent = Math.max(maxConcurrent, activeRequests)
      if (idx === 0) {
        await new Promise((resolve) => setTimeout(resolve, 95))
      }
      activeRequests -= 1
      res.writeHead(200, { "content-type": "application/json" })
      res.end(
        JSON.stringify({
          ok: true,
          status: "JOB_RESULT",
          runId: `22222222-2222-4222-8222-00000000000${idx + 1}`,
          cutoff: new Date().toISOString(),
          processed: 0,
          expired: 0,
          warned: 0,
          skipped: 0,
          failures: [],
          nextCursor: null,
        })
      )
    })

    const captured: ExpiryTickRecord[] = []
    const health = await runExpiryScheduler({
      baseUrl: srv.baseUrl,
      secretFilePath: secretFile,
      intervalMs: 25,
      maxTicks: 2,
      output: { write: () => {} },
      onTick: (record) => {
        captured.push(record)
      },
    })

    expect(maxConcurrent).toBe(1)
    expect(srv.calls).toHaveLength(2)
    expect(health.successfulTicks).toBe(2)
    expect(health.skippedOverlapTicks).toBeGreaterThanOrEqual(2)
    expect(captured.some((r) => r.event === "expiry_overlap_skipped")).toBe(
      true
    )
  })

  it("recovers cleanly after 500 error followed by 200 tick and tracks stale health", async () => {
    const dir = await makeTempDir()
    const secretFile = await writeSecretFile(
      dir,
      "scheduler.env",
      "SCHEDULER_SECRET=resilience_token\n",
      0o600
    )

    const srv = await startTestServer((_call, idx, res) => {
      if (idx === 0) {
        res.writeHead(500, { "content-type": "application/json" })
        res.end(
          JSON.stringify({
            ok: false,
            error: { code: "INTERNAL_ERROR", message: "transient" },
          })
        )
        return
      }
      res.writeHead(200, { "content-type": "application/json" })
      res.end(
        JSON.stringify({
          ok: true,
          status: "JOB_RESULT",
          runId: "33333333-3333-4333-8333-000000000002",
          cutoff: new Date().toISOString(),
          processed: 1,
          expired: 1,
          warned: 0,
          skipped: 0,
          failures: [],
          nextCursor: null,
        })
      )
    })

    const ticks: ExpiryTickRecord[] = []
    const health = await runExpiryScheduler({
      baseUrl: srv.baseUrl,
      secretFilePath: secretFile,
      intervalMs: 25,
      maxTicks: 2,
      output: { write: () => {} },
      onTick: (r) => ticks.push(r),
    })

    expect(ticks).toHaveLength(2)
    expect(ticks[0]!.ok).toBe(false)
    expect(ticks[0]!.status).toBe(500)
    expect(ticks[0]!.errorCode).toBe("INTERNAL_ERROR")
    expect(ticks[0]!.consecutiveFailures).toBe(1)

    expect(ticks[1]!.ok).toBe(true)
    expect(ticks[1]!.status).toBe(200)
    expect(ticks[1]!.consecutiveFailures).toBe(0)

    expect(health.failedTicks).toBe(1)
    expect(health.successfulTicks).toBe(1)
    expect(health.consecutiveFailures).toBe(0)
    expect(health.lastFailureAt).not.toBeNull()
    expect(health.lastSuccessAt).not.toBeNull()
    expect(health.lastFailureCode).toBe("INTERNAL_ERROR")

    const staleSnapshot = computeExpiryHealth(
      {
        ...health,
        lastPartialAt: null,
      },
      Date.parse(health.lastSuccessAt!) + 27 * 60 * 60 * 1000
    )
    expect(staleSnapshot.isStale).toBe(true)
  })

  it("supports --catch-up mode with cursor pagination and deterministic idempotencyKey", async () => {
    const dir = await makeTempDir()
    const secretFile = await writeSecretFile(
      dir,
      "scheduler.env",
      "SCHEDULER_SECRET=catchup_token_001\n",
      0o600
    )

    const srv = await startTestServer((call, idx, res) => {
      const nextCursor = idx === 0 ? "cursor-page-2" : null
      res.writeHead(200, { "content-type": "application/json" })
      res.end(
        JSON.stringify({
          ok: true,
          status: "JOB_RESULT",
          runId: `44444444-4444-4444-8444-00000000000${idx + 1}`,
          cutoff: call.body.through,
          processed: 3,
          expired: 2,
          warned: 1,
          skipped: 0,
          failures: [],
          nextCursor,
        })
      )
    })

    const fixedThrough = "2026-11-24T00:05:00.000Z"
    const parsed = parseExpirySchedulerCliArgs([
      "--base-url",
      srv.baseUrl,
      "--secret-file",
      secretFile,
      "--endpoint",
      "/api/v1/jobs/reservation-expiry",
      "--catch-up",
      "--through",
      fixedThrough,
    ])
    expect(parsed.help).toBe(false)
    expect(parsed.options?.once).toBe(true)
    expect(parsed.options?.catchUp).toBe(true)

    const logs: ExpiryTickRecord[] = []
    const health = await runExpiryScheduler({
      ...parsed.options!,
      registerSignalHandlers: false,
      output: { write: () => {} },
      onTick: (r) => logs.push(r),
    })

    expect(srv.calls).toHaveLength(2)
    expect(srv.calls[0]!.url).toBe("/api/v1/jobs/reservation-expiry")
    expect(srv.calls[0]!.body.mode).toBe("CATCH_UP")
    expect(srv.calls[0]!.body.through).toBe(fixedThrough)
    expect(srv.calls[0]!.body.cursor).toBeUndefined()
    expect(srv.calls[1]!.body.cursor).toBe("cursor-page-2")
    expect(srv.calls[0]!.body.idempotencyKey).toBe(
      deriveDeterministicIdempotencyKey({
        schedulerId: "local-expiry-scheduler",
        endpointPath: "/api/v1/jobs/reservation-expiry",
        mode: "CATCH_UP",
        through: fixedThrough,
        page: 1,
      })
    )

    expect(health.successfulTicks).toBe(1)
    expect(logs[0]!.mode).toBe("CATCH_UP")
    expect(logs[0]!.pages).toBe(2)
    expect(logs[0]!.processed).toBe(6)
    expect(logs[0]!.expired).toBe(4)
  })

  it("shuts down cleanly via AbortSignal even during a slow in-flight request", async () => {
    const dir = await makeTempDir()
    const secretFile = await writeSecretFile(
      dir,
      "scheduler.env",
      "SCHEDULER_SECRET=abort_token\n",
      0o600
    )

    const srv = await startTestServer(async (_call, _idx, res) => {
      await new Promise((resolve) => setTimeout(resolve, 250))
      if (!res.writableEnded) {
        res.writeHead(200, { "content-type": "application/json" })
        res.end(JSON.stringify({ ok: true, nextCursor: null }))
      }
    })

    const controller = new AbortController()
    const scheduler = createExpiryScheduler({
      baseUrl: srv.baseUrl,
      secretFilePath: secretFile,
      intervalMs: 30,
      signal: controller.signal,
      output: { write: () => {} },
    })

    await scheduler.start()
    setTimeout(() => controller.abort(), 35)
    const health = await scheduler.waitUntilDone()

    expect(health.totalTicks).toBe(1)
    const expiryTicks = scheduler
      .getTicks()
      .filter((t) => t.event === "expiry_tick")
    expect(expiryTicks).toHaveLength(1)
    expect(expiryTicks[0]!.status).toBe("ABORTED")
  })

  it("handles transient network errors and request timeouts without crashing the loop", async () => {
    const dir = await makeTempDir()
    const secretFile = await writeSecretFile(
      dir,
      "scheduler.env",
      "SCHEDULER_SECRET=net_timeout_token\n",
      0o600
    )

    // Bind an unused ephemeral port, then close it to trigger ECONNREFUSED on tick 1.
    const probe = await startTestServer((_call, _idx, res) => {
      res.writeHead(200)
      res.end("{}")
    })
    const closedUrl = probe.baseUrl
    await probe.close()

    const ticks: ExpiryTickRecord[] = []
    const healthNet = await runExpiryScheduler({
      baseUrl: closedUrl,
      secretFilePath: secretFile,
      intervalMs: 20,
      maxTicks: 2,
      output: { write: () => {} },
      onTick: (r) => ticks.push(r),
    })

    expect(healthNet.totalTicks).toBe(2)
    expect(healthNet.failedTicks).toBe(2)
    expect(healthNet.consecutiveFailures).toBe(2)
    expect(ticks[0]!.status).toBe("NETWORK_ERROR")
    expect(ticks[0]!.ok).toBe(false)

    // Verify per-request AbortController timeout recovers on subsequent tick.
    const slowThenFast = await startTestServer(async (_call, idx, res) => {
      if (idx === 0) {
        await new Promise((resolve) => setTimeout(resolve, 120))
        if (!res.writableEnded) {
          res.writeHead(200)
          res.end(JSON.stringify({ ok: true, nextCursor: null }))
        }
        return
      }
      res.writeHead(200, { "content-type": "application/json" })
      res.end(
        JSON.stringify({
          ok: true,
          status: "JOB_RESULT",
          runId: "55555555-5555-4555-8555-000000000002",
          cutoff: new Date().toISOString(),
          processed: 1,
          expired: 1,
          warned: 0,
          skipped: 0,
          failures: [],
          nextCursor: null,
        })
      )
    })

    const timeoutTicks: ExpiryTickRecord[] = []
    const healthTimeout = await runExpiryScheduler({
      baseUrl: slowThenFast.baseUrl,
      secretFilePath: secretFile,
      intervalMs: 25,
      requestTimeoutMs: 40,
      maxTicks: 2,
      output: { write: () => {} },
      onTick: (r) => {
        if (r.event === "expiry_tick") timeoutTicks.push(r)
      },
    })

    expect(timeoutTicks).toHaveLength(2)
    expect(timeoutTicks[0]!.status).toBe("TIMEOUT")
    expect(timeoutTicks[0]!.errorCode).toBe("REQUEST_TIMEOUT")
    expect(timeoutTicks[1]!.ok).toBe(true)
    expect(healthTimeout.consecutiveFailures).toBe(0)
    expect(healthTimeout.lastSuccessAt).not.toBeNull()
  })

  it("treats partial runs with failures as PARTIAL without advancing lastSuccessAt and persists stateFile", async () => {
    const dir = await makeTempDir()
    const secretFile = await writeSecretFile(
      dir,
      "scheduler.env",
      "SCHEDULER_SECRET=partial_token\n",
      0o600
    )
    const stateFilePath = join(dir, "expiry-state.json")

    const srv = await startTestServer((_call, _idx, res) => {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(
        JSON.stringify({
          ok: true,
          status: "JOB_RESULT",
          runId: "66666666-6666-4666-8666-000000000001",
          cutoff: new Date().toISOString(),
          processed: 3,
          expired: 2,
          warned: 0,
          skipped: 0,
          failures: [
            {
              reservationId: "77777777-7777-4777-8777-000000000001",
              code: "RETRYABLE_TRANSACTION",
            },
          ],
          nextCursor: null,
        })
      )
    })

    const health = await runExpiryScheduler({
      baseUrl: srv.baseUrl,
      secretFilePath: secretFile,
      stateFilePath,
      once: true,
      output: { write: () => {} },
    })

    expect(health.partialTicks).toBe(1)
    expect(health.successfulTicks).toBe(0)
    expect(health.lastSuccessAt).toBeNull()
    expect(health.lastPartialAt).not.toBeNull()
    expect(health.lastFailureCode).toBe("RETRYABLE_TRANSACTION")
    expect(health.latestRun?.status).toBe("PARTIAL")

    // Restarting with the same stateFilePath restores prior health metrics.
    const restarted = createExpiryScheduler({
      baseUrl: srv.baseUrl,
      secretFilePath: secretFile,
      stateFilePath,
      once: true,
      output: { write: () => {} },
    })
    await restarted.start()
    const restoredHealth = await restarted.waitUntilDone()
    expect(restoredHealth.lastPartialAt).not.toBeNull()
    expect(restoredHealth.consecutiveFailures).toBe(2)
  })
})
