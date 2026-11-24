/**
 * Local reservation-expiry scheduler runner (T10 / T18 / Gate G6: SLAD-04, SLAD-06).
 *
 * Operational guide (start, stop, sleep/downtime, catch-up, security):
 * - Start (scheduled loop):
 *     node --import tsx scripts/local-expiry-scheduler.ts \
 *       --base-url http://127.0.0.1:8000 \
 *       --secret-file ~/.config/vamotors/local-<hash>/scheduler.env \
 *       --interval-ms 60000
 * - Start (single immediate sweep):
 *     node --import tsx scripts/local-expiry-scheduler.ts \
 *       --base-url http://127.0.0.1:8000 \
 *       --secret-file ~/.config/vamotors/local-<hash>/scheduler.env \
 *       --once
 * - Authorized catch-up after machine sleep, OS downtime, or partial failure:
 *     node --import tsx scripts/local-expiry-scheduler.ts \
 *       --base-url http://127.0.0.1:8000 \
 *       --secret-file ~/.config/vamotors/local-<hash>/scheduler.env \
 *       --catch-up
 * - Stop gracefully: send SIGINT (Ctrl+C) or SIGTERM. In-flight HTTP requests
 *   are aborted via AbortController, no new ticks are scheduled, and persisted
 *   non-secret health state (if --state-file is configured) is flushed before exit.
 * - Sleep / downtime behavior: Node.js setInterval timers pause while the host OS
 *   is asleep or the process is stopped. Missed scheduled sweeps (for example,
 *   overnight sleep across Colombo midnight) do NOT replay blindly as burst
 *   timers on wake; instead, run `--catch-up` (or restart with `--catch-up`)
 *   to execute an explicit CATCH_UP sweep from the earliest unresolved cutoff
 *   using deterministic idempotency keys and cursor pagination. Health reports
 *   `isStale: true` whenever no full un-partial sweep succeeds within 26 hours.
 * - Security boundary: strictly enforces loopback base URLs (127.0.0.1 or
 *   localhost only), requires owner-only POSIX permissions (0600, regular file,
 *   current UID) on the secret file, and redacts all tokens, cookies, and
 *   authorization headers from logs, telemetry, and thrown errors.
 */

import { createHash } from "node:crypto"
import { realpathSync } from "node:fs"
import { lstat, readFile, rename, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { parseEnv } from "node:util"

export type ExpiryRunMode = "SCHEDULED" | "CATCH_UP"
export type ExpiryPayloadFormat = "envelope" | "job"
export type ExpiryJobStatus = "SUCCESS" | "PARTIAL" | "FAILED"
export type ExpiryTickStatus =
  | number
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "ABORTED"
  | "SKIPPED_OVERLAP"

export interface ExpiryTickRecord {
  event: "expiry_tick" | "expiry_overlap_skipped"
  tickNumber: number
  mode: ExpiryRunMode
  startedAt: string
  finishedAt: string
  durationMs: number
  status: ExpiryTickStatus
  ok: boolean
  idempotencyKey?: string
  jobRunId?: string
  jobStatus?: ExpiryJobStatus
  processed?: number
  expired?: number
  warned?: number
  skipped?: number
  pages?: number
  nextCursor?: string | null
  errorCode?: string
  consecutiveFailures: number
  isStale: boolean
}

export interface ExpiryLatestRun {
  id: string
  status: ExpiryJobStatus
  cursor: string | null
}

export interface ExpiryHealthSnapshot {
  startedAt: string
  lastSuccessAt: string | null
  lastFailureAt: string | null
  lastPartialAt: string | null
  lastFailureCode: string | null
  consecutiveFailures: number
  isStale: boolean
  staleThresholdMs: number
  totalTicks: number
  successfulTicks: number
  partialTicks: number
  failedTicks: number
  skippedOverlapTicks: number
  latestRun: ExpiryLatestRun | null
}

export interface ExpirySchedulerOptions {
  baseUrl: string
  secretFilePath: string
  secretEnvKey?: string
  endpointPath?: string
  payloadFormat?: ExpiryPayloadFormat
  authHeaderName?: string
  authScheme?: "bearer" | "raw"
  intervalMs?: number
  requestTimeoutMs?: number
  limit?: number
  maxPagesPerTick?: number
  maxTicks?: number
  once?: boolean
  catchUp?: boolean
  mode?: ExpiryRunMode
  through?: string
  initialCursor?: string
  schedulerId?: string
  runOnStart?: boolean
  staleThresholdMs?: number
  stateFilePath?: string
  signal?: AbortSignal
  registerSignalHandlers?: boolean
  now?: () => number
  output?: { write: (chunk: string) => unknown }
  onTick?: (record: ExpiryTickRecord) => void
}

export interface ExpirySchedulerHandle {
  start: () => Promise<void>
  stop: (reason?: string) => Promise<ExpiryHealthSnapshot>
  triggerOnce: (modeOverride?: ExpiryRunMode) => Promise<ExpiryTickRecord>
  getHealth: (asOfMs?: number) => ExpiryHealthSnapshot
  getTicks: () => readonly ExpiryTickRecord[]
  waitUntilDone: () => Promise<ExpiryHealthSnapshot>
}

interface PersistedHealthState {
  lastSuccessAt: string | null
  lastFailureAt: string | null
  lastPartialAt: string | null
  lastFailureCode: string | null
  consecutiveFailures: number
  latestRun: ExpiryLatestRun | null
}

interface LoadedSecret {
  token: string
  knownSecrets: string[]
}

export const DEFAULT_ENDPOINT_PATH = "/api/v1/commands/runExpiry"
export const DEFAULT_INTERVAL_MS = 60_000
export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000
export const DEFAULT_BATCH_LIMIT = 100
export const DEFAULT_MAX_PAGES_PER_TICK = 50
export const DEFAULT_STALE_THRESHOLD_MS = 26 * 60 * 60 * 1000
export const DEFAULT_SCHEDULER_ID = "local-expiry-scheduler"

const DEFAULT_SECRET_ENV_KEYS = [
  "SCHEDULER_SECRET",
  "EXPIRY_SCHEDULER_TOKEN",
  "SCHEDULER_TOKEN",
] as const

const SENSITIVE_ENV_KEY_PATTERN =
  /secret|token|password|cookie|authorization|key|url/i

/**
 * Validates that `baseUrl` strictly targets loopback (`127.0.0.1` or `localhost`)
 * over HTTP/HTTPS with no embedded userinfo credentials.
 */
export function assertLoopbackBaseUrl(rawUrl: string): URL {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error("INVALID_BASE_URL")
  }
  if (parsed.username || parsed.password) {
    throw new Error("LOOPBACK_CREDENTIALS_FORBIDDEN")
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("INVALID_BASE_URL_PROTOCOL")
  }
  const hostname = parsed.hostname.toLowerCase()
  if (hostname !== "127.0.0.1" && hostname !== "localhost") {
    throw new Error(
      "NON_LOOPBACK_BASE_URL_FORBIDDEN: only 127.0.0.1 or localhost is permitted"
    )
  }
  return parsed
}

/**
 * Validates that `endpointPath` is a relative path on the loopback origin and
 * cannot redirect to a different host via protocol-relative URLs.
 */
export function assertValidEndpointPath(
  endpointPath: string,
  origin: string
): string {
  if (!endpointPath.startsWith("/") || endpointPath.startsWith("//")) {
    throw new Error("INVALID_ENDPOINT_PATH")
  }
  let resolved: URL
  try {
    resolved = new URL(endpointPath, origin)
  } catch {
    throw new Error("INVALID_ENDPOINT_PATH")
  }
  if (resolved.origin !== origin) {
    throw new Error("ENDPOINT_ORIGIN_MISMATCH")
  }
  return `${resolved.pathname}${resolved.search}`
}

/**
 * Redacts all known secrets, tokens, cookies, and authorization headers from
 * any diagnostic string before logging or throwing.
 */
export function redactSensitiveText(
  input: string,
  extraSecrets: readonly string[] = []
): string {
  let output = input
  output = output.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "[REDACTED]")
  output = output.replace(
    /\b(authorization|cookie|set-cookie|x-scheduler-secret|x-api-key)\s*[:=]\s*[^\r\n;]+/gi,
    "$1: [REDACTED]"
  )
  output = output.replace(
    /\b(SCHEDULER_SECRET|EXPIRY_SCHEDULER_TOKEN|SCHEDULER_TOKEN|BETTER_AUTH_SECRET|TOKEN|SECRET|PASSWORD|COOKIE)\s*=\s*[^\s\r\n]+/gi,
    "$1=[REDACTED]"
  )

  const sortedSecrets = [...new Set(extraSecrets)]
    .filter((s) => s.length >= 4)
    .sort((a, b) => b.length - a.length)

  for (const secret of sortedSecrets) {
    const variants = new Set<string>([secret])
    try {
      const encoded = encodeURIComponent(secret)
      if (encoded.length >= 4) variants.add(encoded)
    } catch {
      // Ignore encoding errors
    }
    for (const variant of variants) {
      if (output.includes(variant)) {
        output = output.split(variant).join("[REDACTED]")
      }
    }
  }
  return output
}

function sanitizeErrorCode(
  raw: string | undefined,
  knownSecrets: readonly string[],
  fallback: string
): string {
  if (!raw) return fallback
  const redacted = redactSensitiveText(raw, knownSecrets)
    .replace(/[\r\n\t]+/g, " ")
    .trim()
  if (!redacted) return fallback
  return redacted.slice(0, 120)
}

/**
 * Reads an owner-only (`0600`) secret/env file on POSIX, rejecting symlinks,
 * non-regular files, wrong ownership, or group/world-accessible modes.
 */
export async function loadPrivateSecret(
  secretFilePath: string,
  secretEnvKey?: string
): Promise<LoadedSecret> {
  if (!secretFilePath || !secretFilePath.trim()) {
    throw new Error("SECRET_FILE_PATH_REQUIRED")
  }

  let info: Awaited<ReturnType<typeof lstat>>
  try {
    info = await lstat(secretFilePath)
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code)
        : "UNKNOWN"
    if (code === "ENOENT") {
      throw new Error("SECRET_FILE_NOT_FOUND")
    }
    throw new Error("SECRET_FILE_STAT_FAILED")
  }

  if (info.isSymbolicLink()) {
    throw new Error("SECRET_FILE_SYMLINK_FORBIDDEN")
  }
  if (!info.isFile()) {
    throw new Error("SECRET_FILE_NOT_REGULAR")
  }
  if (process.platform !== "win32") {
    if ((info.mode & 0o077) !== 0) {
      throw new Error("SECRET_FILE_INSECURE_PERMISSIONS")
    }
    if (typeof process.getuid === "function" && info.uid !== process.getuid()) {
      throw new Error("SECRET_FILE_INVALID_OWNER")
    }
  }

  let rawContent: string
  try {
    rawContent = await readFile(secretFilePath, "utf8")
  } catch {
    throw new Error("SECRET_FILE_UNREADABLE")
  }

  const trimmed = rawContent.trim()
  if (!trimmed) {
    throw new Error("SCHEDULER_SECRET_MISSING")
  }

  const candidateKeys = secretEnvKey
    ? [secretEnvKey]
    : [...DEFAULT_SECRET_ENV_KEYS]

  // Support single-line raw token files when no KEY=VALUE syntax is used.
  if (!trimmed.includes("=") && !/[\r\n]/.test(trimmed)) {
    return { token: trimmed, knownSecrets: [trimmed] }
  }

  let parsed: Record<string, string | undefined>
  try {
    parsed = parseEnv(rawContent)
  } catch {
    throw new Error("SECRET_FILE_PARSE_FAILED")
  }

  const knownSecrets: string[] = []
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === "string" && value.length > 0) {
      if (SENSITIVE_ENV_KEY_PATTERN.test(key) || candidateKeys.includes(key)) {
        knownSecrets.push(value)
      }
    }
  }

  for (const key of candidateKeys) {
    const value = parsed[key]?.trim()
    if (value) {
      if (!knownSecrets.includes(value)) knownSecrets.push(value)
      return { token: value, knownSecrets }
    }
  }

  throw new Error("SCHEDULER_SECRET_MISSING")
}

/**
 * Derives a deterministic RFC 4122 UUID (version 5 bit-layout) from canonical
 * sweep parameters so retries and catch-up sweeps share stable idempotency keys.
 */
export function deriveDeterministicIdempotencyKey(params: {
  schedulerId: string
  endpointPath: string
  mode: ExpiryRunMode
  through: string
  cursor?: string
  page: number
  tickNumber?: number
}): string {
  const canonical = JSON.stringify([
    params.schedulerId,
    params.endpointPath,
    params.mode,
    params.through,
    params.cursor ?? null,
    params.page,
    params.mode === "CATCH_UP" ? null : (params.tickNumber ?? null),
  ])
  const digest = createHash("sha256").update(canonical).digest()
  const bytes = Uint8Array.from(digest.subarray(0, 16))
  bytes[6] = (bytes[6]! & 0x0f) | 0x50
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = Buffer.from(bytes).toString("hex")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

/**
 * Computes stale-job health from persisted/in-memory run timestamps.
 * Marks `isStale = true` when no un-partial sweep has succeeded within
 * `staleThresholdMs` (default 26 hours).
 */
export function computeExpiryHealth(
  state: {
    startedAt: string
    lastSuccessAt: string | null
    lastFailureAt: string | null
    lastPartialAt: string | null
    lastFailureCode: string | null
    consecutiveFailures: number
    totalTicks: number
    successfulTicks: number
    partialTicks: number
    failedTicks: number
    skippedOverlapTicks: number
    latestRun: ExpiryLatestRun | null
  },
  nowMs: number,
  staleThresholdMs = DEFAULT_STALE_THRESHOLD_MS
): ExpiryHealthSnapshot {
  const referenceIso = state.lastSuccessAt ?? state.startedAt
  const referenceMs = Date.parse(referenceIso)
  const isStale =
    Number.isFinite(referenceMs) && nowMs - referenceMs > staleThresholdMs

  return {
    startedAt: state.startedAt,
    lastSuccessAt: state.lastSuccessAt,
    lastFailureAt: state.lastFailureAt,
    lastPartialAt: state.lastPartialAt,
    lastFailureCode: state.lastFailureCode,
    consecutiveFailures: state.consecutiveFailures,
    isStale,
    staleThresholdMs,
    totalTicks: state.totalTicks,
    successfulTicks: state.successfulTicks,
    partialTicks: state.partialTicks,
    failedTicks: state.failedTicks,
    skippedOverlapTicks: state.skippedOverlapTicks,
    latestRun: state.latestRun ? { ...state.latestRun } : null,
  }
}

async function readStateFile(
  stateFilePath: string
): Promise<PersistedHealthState | null> {
  try {
    const info = await lstat(stateFilePath)
    if (info.isSymbolicLink() || !info.isFile()) return null
    const raw = await readFile(stateFilePath, "utf8")
    const parsed = JSON.parse(raw) as Partial<PersistedHealthState>
    return {
      lastSuccessAt:
        typeof parsed.lastSuccessAt === "string" ? parsed.lastSuccessAt : null,
      lastFailureAt:
        typeof parsed.lastFailureAt === "string" ? parsed.lastFailureAt : null,
      lastPartialAt:
        typeof parsed.lastPartialAt === "string" ? parsed.lastPartialAt : null,
      lastFailureCode:
        typeof parsed.lastFailureCode === "string"
          ? parsed.lastFailureCode
          : null,
      consecutiveFailures:
        typeof parsed.consecutiveFailures === "number" &&
        Number.isInteger(parsed.consecutiveFailures) &&
        parsed.consecutiveFailures >= 0
          ? parsed.consecutiveFailures
          : 0,
      latestRun:
        parsed.latestRun &&
        typeof parsed.latestRun === "object" &&
        typeof parsed.latestRun.id === "string" &&
        (parsed.latestRun.status === "SUCCESS" ||
          parsed.latestRun.status === "PARTIAL" ||
          parsed.latestRun.status === "FAILED")
          ? {
              id: parsed.latestRun.id,
              status: parsed.latestRun.status,
              cursor:
                typeof parsed.latestRun.cursor === "string"
                  ? parsed.latestRun.cursor
                  : null,
            }
          : null,
    }
  } catch {
    return null
  }
}

async function writeStateFile(
  stateFilePath: string,
  state: PersistedHealthState
): Promise<void> {
  const dir = dirname(stateFilePath)
  const tempPath = join(
    dir,
    `.expiry-state.${process.pid}.${Date.now()}.tmp.json`
  )
  await writeFile(tempPath, JSON.stringify(state, null, 2) + "\n", {
    mode: 0o600,
  })
  await rename(tempPath, stateFilePath)
}

function buildRequestBody(params: {
  payloadFormat: ExpiryPayloadFormat
  idempotencyKey: string
  mode: ExpiryRunMode
  through: string
  limit: number
  cursor?: string
}) {
  const runInput: { through: string; limit: number; cursor?: string } = {
    through: params.through,
    limit: params.limit,
    ...(params.cursor !== undefined ? { cursor: params.cursor } : {}),
  }

  if (params.payloadFormat === "envelope") {
    return {
      schemaVersion: 1 as const,
      idempotencyKey: params.idempotencyKey,
      expected: [] as const,
      input: runInput,
    }
  }

  return {
    schemaVersion: 1 as const,
    idempotencyKey: params.idempotencyKey,
    mode: params.mode,
    ...runInput,
  }
}

function parseNumberField(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function validateOptions(options: ExpirySchedulerOptions) {
  const url = assertLoopbackBaseUrl(options.baseUrl)
  const endpointPath = assertValidEndpointPath(
    options.endpointPath ?? DEFAULT_ENDPOINT_PATH,
    url.origin
  )
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS
  if (!Number.isFinite(intervalMs) || intervalMs < 10) {
    throw new Error("INVALID_INTERVAL_MS")
  }
  const requestTimeoutMs =
    options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs < 10) {
    throw new Error("INVALID_REQUEST_TIMEOUT_MS")
  }
  const limit = options.limit ?? DEFAULT_BATCH_LIMIT
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("INVALID_LIMIT")
  }
  const maxPagesPerTick = options.maxPagesPerTick ?? DEFAULT_MAX_PAGES_PER_TICK
  if (!Number.isInteger(maxPagesPerTick) || maxPagesPerTick < 1) {
    throw new Error("INVALID_MAX_PAGES_PER_TICK")
  }
  const maxTicks = options.once ? 1 : options.maxTicks
  if (maxTicks !== undefined && (!Number.isInteger(maxTicks) || maxTicks < 1)) {
    throw new Error("INVALID_MAX_TICKS")
  }
  const staleThresholdMs =
    options.staleThresholdMs ?? DEFAULT_STALE_THRESHOLD_MS
  if (!Number.isFinite(staleThresholdMs) || staleThresholdMs <= 0) {
    throw new Error("INVALID_STALE_THRESHOLD_MS")
  }
  if (
    options.through !== undefined &&
    Number.isNaN(Date.parse(options.through))
  ) {
    throw new Error("INVALID_THROUGH_TIMESTAMP")
  }
  const authHeaderName = (options.authHeaderName ?? "authorization").trim()
  if (!authHeaderName) {
    throw new Error("INVALID_AUTH_HEADER_NAME")
  }
  const payloadFormat: ExpiryPayloadFormat =
    options.payloadFormat ??
    (endpointPath.includes("/api/v1/commands/") ? "envelope" : "job")

  return {
    origin: url.origin,
    secretFilePath: options.secretFilePath,
    secretEnvKey: options.secretEnvKey,
    endpointPath,
    targetUrl: `${url.origin}${endpointPath}`,
    payloadFormat,
    authHeaderName,
    authScheme: options.authScheme ?? "bearer",
    intervalMs,
    requestTimeoutMs,
    limit,
    maxPagesPerTick,
    maxTicks,
    once: Boolean(options.once),
    catchUp: Boolean(options.catchUp),
    mode: options.mode,
    through: options.through,
    initialCursor: options.initialCursor,
    schedulerId: options.schedulerId ?? DEFAULT_SCHEDULER_ID,
    runOnStart: options.runOnStart ?? true,
    staleThresholdMs,
    stateFilePath: options.stateFilePath,
    registerSignalHandlers: options.registerSignalHandlers ?? false,
    now: options.now ?? Date.now,
    output: options.output ?? process.stdout,
    onTick: options.onTick,
  }
}

/**
 * Creates a non-overlapping, secret-redacting loopback expiry scheduler handle.
 */
export function createExpiryScheduler(
  options: ExpirySchedulerOptions
): ExpirySchedulerHandle {
  const cfg = validateOptions(options)

  let loadedSecret: LoadedSecret | null = null
  let started = false
  let stopped = false
  let inFlight = false
  let inFlightPromise: Promise<ExpiryTickRecord> | null = null
  let inFlightAbortController: AbortController | null = null
  let intervalHandle: ReturnType<typeof setInterval> | null = null
  let donePromise: Promise<ExpiryHealthSnapshot> | null = null
  let resolveDone: ((snapshot: ExpiryHealthSnapshot) => void) | null = null

  let tickCounter = 0
  const tickHistory: ExpiryTickRecord[] = []

  const state = {
    startedAt: new Date(cfg.now()).toISOString(),
    lastSuccessAt: null as string | null,
    lastFailureAt: null as string | null,
    lastPartialAt: null as string | null,
    lastFailureCode: null as string | null,
    consecutiveFailures: 0,
    totalTicks: 0,
    successfulTicks: 0,
    partialTicks: 0,
    failedTicks: 0,
    skippedOverlapTicks: 0,
    latestRun: null as ExpiryLatestRun | null,
  }

  let signalCleanup: (() => void) | null = null

  function currentHealth(asOfMs = cfg.now()): ExpiryHealthSnapshot {
    return computeExpiryHealth(state, asOfMs, cfg.staleThresholdMs)
  }

  function emitRecord(record: ExpiryTickRecord) {
    tickHistory.push(record)
    const known = loadedSecret?.knownSecrets ?? []
    const safeRecord: ExpiryTickRecord = record.errorCode
      ? {
          ...record,
          errorCode: sanitizeErrorCode(record.errorCode, known, "ERROR"),
        }
      : record
    const serialized = redactSensitiveText(JSON.stringify(safeRecord), known)
    cfg.output.write(`${serialized}\n`)
    cfg.onTick?.(safeRecord)
  }

  function cleanupHandlersAndTimers() {
    if (intervalHandle !== null) {
      clearInterval(intervalHandle)
      intervalHandle = null
    }
    if (signalCleanup) {
      signalCleanup()
      signalCleanup = null
    }
  }

  function finishIfDone() {
    if (resolveDone) {
      const done = resolveDone
      resolveDone = null
      cleanupHandlersAndTimers()
      done(currentHealth())
    }
  }

  async function persistHealthIfConfigured() {
    if (!cfg.stateFilePath) return
    try {
      await writeStateFile(cfg.stateFilePath, {
        lastSuccessAt: state.lastSuccessAt,
        lastFailureAt: state.lastFailureAt,
        lastPartialAt: state.lastPartialAt,
        lastFailureCode: state.lastFailureCode,
        consecutiveFailures: state.consecutiveFailures,
        latestRun: state.latestRun,
      })
    } catch {
      // Never crash scheduler loop on state-file write errors.
    }
  }

  function resolveModeForTick(tickNumber: number): ExpiryRunMode {
    if (cfg.mode) return cfg.mode
    if (cfg.catchUp && tickNumber === 1) return "CATCH_UP"
    return "SCHEDULED"
  }

  async function executeSinglePage(params: {
    mode: ExpiryRunMode
    through: string
    cursor?: string
    page: number
    tickNumber: number
  }): Promise<
    | {
        ok: true
        status: number
        runId?: string
        cutoff?: string
        processed: number
        expired: number
        warned: number
        skipped: number
        failuresCount: number
        firstFailureCode?: string
        nextCursor: string | null
      }
    | {
        ok: false
        status: ExpiryTickStatus
        errorCode: string
        runId?: string
      }
  > {
    if (!loadedSecret) {
      return {
        ok: false,
        status: "NETWORK_ERROR",
        errorCode: "SECRET_NOT_LOADED",
      }
    }

    const idempotencyKey = deriveDeterministicIdempotencyKey({
      schedulerId: cfg.schedulerId,
      endpointPath: cfg.endpointPath,
      mode: params.mode,
      through: params.through,
      cursor: params.cursor,
      page: params.page,
      tickNumber: params.tickNumber,
    })

    const bodyPayload = buildRequestBody({
      payloadFormat: cfg.payloadFormat,
      idempotencyKey,
      mode: params.mode,
      through: params.through,
      limit: cfg.limit,
      cursor: params.cursor,
    })

    const requestController = new AbortController()
    inFlightAbortController = requestController
    let timedOut = false
    const timeoutTimer = setTimeout(() => {
      timedOut = true
      requestController.abort()
    }, cfg.requestTimeoutMs)

    const authValue =
      cfg.authScheme === "bearer"
        ? `Bearer ${loadedSecret.token}`
        : loadedSecret.token

    try {
      const response = await fetch(cfg.targetUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: cfg.origin,
          [cfg.authHeaderName]: authValue,
          "x-idempotency-key": idempotencyKey,
          "x-scheduler-mode": params.mode,
        },
        body: JSON.stringify(bodyPayload),
        signal: requestController.signal,
      })

      let parsedBody: Record<string, unknown> | null = null
      try {
        const text = await response.text()
        if (text.trim()) {
          const json = JSON.parse(text) as unknown
          if (json && typeof json === "object" && !Array.isArray(json)) {
            parsedBody = json as Record<string, unknown>
          }
        }
      } catch {
        parsedBody = null
      }

      if (!response.ok || parsedBody?.ok === false) {
        const apiError =
          parsedBody?.error && typeof parsedBody.error === "object"
            ? (parsedBody.error as { code?: unknown })
            : null
        const rawCode =
          typeof apiError?.code === "string"
            ? apiError.code
            : `HTTP_${response.status}`
        return {
          ok: false,
          status: response.status,
          errorCode: sanitizeErrorCode(
            rawCode,
            loadedSecret.knownSecrets,
            `HTTP_${response.status}`
          ),
        }
      }

      const runId =
        typeof parsedBody?.runId === "string"
          ? parsedBody.runId
          : typeof parsedBody?.commandId === "string"
            ? parsedBody.commandId
            : undefined
      const cutoff =
        typeof parsedBody?.cutoff === "string" ? parsedBody.cutoff : undefined
      const failuresArray = Array.isArray(parsedBody?.failures)
        ? parsedBody.failures
        : []
      const firstFailure =
        failuresArray[0] && typeof failuresArray[0] === "object"
          ? (failuresArray[0] as { code?: unknown })
          : null
      const firstFailureCode =
        typeof firstFailure?.code === "string"
          ? sanitizeErrorCode(
              firstFailure.code,
              loadedSecret.knownSecrets,
              "PARTIAL_FAILURE"
            )
          : undefined
      const nextCursor =
        typeof parsedBody?.nextCursor === "string" &&
        parsedBody.nextCursor.length > 0
          ? parsedBody.nextCursor
          : null

      return {
        ok: true,
        status: response.status,
        runId,
        cutoff,
        processed: parseNumberField(parsedBody?.processed),
        expired: parseNumberField(parsedBody?.expired),
        warned: parseNumberField(parsedBody?.warned),
        skipped: parseNumberField(parsedBody?.skipped),
        failuresCount: failuresArray.length,
        firstFailureCode,
        nextCursor,
      }
    } catch (error) {
      if (stopped || options.signal?.aborted) {
        return { ok: false, status: "ABORTED", errorCode: "ABORTED" }
      }
      if (timedOut) {
        return { ok: false, status: "TIMEOUT", errorCode: "REQUEST_TIMEOUT" }
      }
      const causeCode =
        error &&
        typeof error === "object" &&
        "cause" in error &&
        (error as { cause?: { code?: unknown } }).cause?.code
          ? String((error as { cause: { code: unknown } }).cause.code)
          : undefined
      return {
        ok: false,
        status: "NETWORK_ERROR",
        errorCode: sanitizeErrorCode(
          causeCode ?? "NETWORK_ERROR",
          loadedSecret.knownSecrets,
          "NETWORK_ERROR"
        ),
      }
    } finally {
      clearTimeout(timeoutTimer)
      if (inFlightAbortController === requestController) {
        inFlightAbortController = null
      }
    }
  }

  async function runTick(
    modeOverride?: ExpiryRunMode
  ): Promise<ExpiryTickRecord> {
    if (inFlight) {
      state.skippedOverlapTicks += 1
      const nowIso = new Date(cfg.now()).toISOString()
      const skipRecord: ExpiryTickRecord = {
        event: "expiry_overlap_skipped",
        tickNumber: tickCounter,
        mode: modeOverride ?? resolveModeForTick(tickCounter + 1),
        startedAt: nowIso,
        finishedAt: nowIso,
        durationMs: 0,
        status: "SKIPPED_OVERLAP",
        ok: false,
        errorCode: "OVERLAP_SKIPPED",
        consecutiveFailures: state.consecutiveFailures,
        isStale: currentHealth().isStale,
      }
      emitRecord(skipRecord)
      return skipRecord
    }

    inFlight = true
    const tickNumber = ++tickCounter
    const mode = modeOverride ?? resolveModeForTick(tickNumber)
    const startedMs = cfg.now()
    const startedAt = new Date(startedMs).toISOString()
    const tickThrough = cfg.through ?? startedAt
    const firstIdempotencyKey = deriveDeterministicIdempotencyKey({
      schedulerId: cfg.schedulerId,
      endpointPath: cfg.endpointPath,
      mode,
      through: tickThrough,
      cursor: cfg.initialCursor,
      page: 1,
      tickNumber,
    })

    const promise = (async (): Promise<ExpiryTickRecord> => {
      let cursor: string | undefined = cfg.initialCursor
      let page = 1
      let lastStatus: ExpiryTickStatus = 200
      let jobRunId: string | undefined
      let processed = 0
      let expired = 0
      let warned = 0
      let skipped = 0
      let failuresCount = 0
      let firstFailureCode: string | undefined
      let nextCursor: string | null = null
      let pagesExecuted = 0
      let transportErrorCode: string | undefined
      let hadSuccessfulPage = false

      while (page <= cfg.maxPagesPerTick) {
        if (stopped || options.signal?.aborted) {
          lastStatus = "ABORTED"
          transportErrorCode = "ABORTED"
          break
        }

        const pageResult = await executeSinglePage({
          mode,
          through: tickThrough,
          cursor,
          page,
          tickNumber,
        })
        pagesExecuted += 1

        if (!pageResult.ok) {
          lastStatus = pageResult.status
          transportErrorCode = pageResult.errorCode
          break
        }

        hadSuccessfulPage = true
        lastStatus = pageResult.status
        if (pageResult.runId) jobRunId = pageResult.runId
        processed += pageResult.processed
        expired += pageResult.expired
        warned += pageResult.warned
        skipped += pageResult.skipped
        failuresCount += pageResult.failuresCount
        if (!firstFailureCode && pageResult.firstFailureCode) {
          firstFailureCode = pageResult.firstFailureCode
        }
        nextCursor = pageResult.nextCursor

        if (nextCursor === null) break
        cursor = nextCursor
        page += 1
      }

      const finishedMs = cfg.now()
      const finishedAt = new Date(finishedMs).toISOString()
      const durationMs = Math.max(0, finishedMs - startedMs)

      const isCompleteSuccess =
        transportErrorCode === undefined &&
        hadSuccessfulPage &&
        failuresCount === 0 &&
        nextCursor === null
      const isPartial =
        !isCompleteSuccess &&
        hadSuccessfulPage &&
        transportErrorCode !== "ABORTED"

      state.totalTicks += 1
      let jobStatus: ExpiryJobStatus
      let errorCode: string | undefined

      if (isCompleteSuccess) {
        jobStatus = "SUCCESS"
        state.successfulTicks += 1
        state.consecutiveFailures = 0
        state.lastSuccessAt = finishedAt
      } else if (isPartial) {
        jobStatus = "PARTIAL"
        errorCode = transportErrorCode ?? firstFailureCode ?? "PARTIAL_SWEEP"
        state.partialTicks += 1
        state.consecutiveFailures += 1
        state.lastPartialAt = finishedAt
        state.lastFailureAt = finishedAt
        state.lastFailureCode = errorCode
      } else {
        jobStatus = "FAILED"
        errorCode = transportErrorCode ?? "EXECUTION_FAILED"
        state.failedTicks += 1
        state.consecutiveFailures += 1
        state.lastFailureAt = finishedAt
        state.lastFailureCode = errorCode
      }

      if (jobRunId) {
        state.latestRun = {
          id: jobRunId,
          status: jobStatus,
          cursor: nextCursor,
        }
      }

      await persistHealthIfConfigured()

      const health = currentHealth(finishedMs)
      const record: ExpiryTickRecord = {
        event: "expiry_tick",
        tickNumber,
        mode,
        startedAt,
        finishedAt,
        durationMs,
        status: lastStatus,
        ok: isCompleteSuccess,
        idempotencyKey: firstIdempotencyKey,
        ...(jobRunId ? { jobRunId } : {}),
        jobStatus,
        processed,
        expired,
        warned,
        skipped,
        pages: pagesExecuted,
        nextCursor,
        ...(errorCode ? { errorCode } : {}),
        consecutiveFailures: state.consecutiveFailures,
        isStale: health.isStale,
      }
      emitRecord(record)
      return record
    })()

    inFlightPromise = promise
    try {
      return await promise
    } finally {
      inFlight = false
      inFlightPromise = null
      if (
        !stopped &&
        cfg.maxTicks !== undefined &&
        state.totalTicks >= cfg.maxTicks
      ) {
        stopped = true
        finishIfDone()
      }
    }
  }

  async function stop(): Promise<ExpiryHealthSnapshot> {
    if (!stopped) {
      stopped = true
      cleanupHandlersAndTimers()
      inFlightAbortController?.abort()
    }
    if (inFlightPromise) {
      await inFlightPromise.catch(() => undefined)
    }
    await persistHealthIfConfigured()
    finishIfDone()
    return currentHealth()
  }

  async function start(): Promise<void> {
    if (started) return
    started = true
    loadedSecret = await loadPrivateSecret(cfg.secretFilePath, cfg.secretEnvKey)

    if (cfg.stateFilePath) {
      const persisted = await readStateFile(cfg.stateFilePath)
      if (persisted) {
        state.lastSuccessAt = persisted.lastSuccessAt
        state.lastFailureAt = persisted.lastFailureAt
        state.lastPartialAt = persisted.lastPartialAt
        state.lastFailureCode = persisted.lastFailureCode
        state.consecutiveFailures = persisted.consecutiveFailures
        state.latestRun = persisted.latestRun
      }
    }

    donePromise = new Promise<ExpiryHealthSnapshot>((resolve) => {
      resolveDone = resolve
    })

    if (options.signal?.aborted) {
      stopped = true
      finishIfDone()
      return
    }

    const onExternalAbort = () => {
      void stop()
    }
    const onSigInt = () => {
      void stop()
    }
    const onSigTerm = () => {
      void stop()
    }

    if (options.signal) {
      options.signal.addEventListener("abort", onExternalAbort, { once: true })
    }
    if (cfg.registerSignalHandlers) {
      process.on("SIGINT", onSigInt)
      process.on("SIGTERM", onSigTerm)
    }
    signalCleanup = () => {
      options.signal?.removeEventListener("abort", onExternalAbort)
      if (cfg.registerSignalHandlers) {
        process.off("SIGINT", onSigInt)
        process.off("SIGTERM", onSigTerm)
      }
    }

    // Single-tick mode avoids creating unnecessary interval timers.
    if (cfg.maxTicks === 1 && cfg.runOnStart) {
      await runTick()
      return
    }

    intervalHandle = setInterval(() => {
      if (stopped) return
      if (cfg.maxTicks !== undefined && state.totalTicks >= cfg.maxTicks) {
        void stop()
        return
      }
      void runTick()
    }, cfg.intervalMs)

    if (cfg.runOnStart) {
      void runTick()
    }
  }

  async function triggerOnce(
    modeOverride?: ExpiryRunMode
  ): Promise<ExpiryTickRecord> {
    if (!loadedSecret) {
      loadedSecret = await loadPrivateSecret(
        cfg.secretFilePath,
        cfg.secretEnvKey
      )
    }
    return runTick(modeOverride)
  }

  async function waitUntilDone(): Promise<ExpiryHealthSnapshot> {
    if (!donePromise) {
      return currentHealth()
    }
    return donePromise
  }

  return {
    start,
    stop,
    triggerOnce,
    getHealth: currentHealth,
    getTicks: () => [...tickHistory],
    waitUntilDone,
  }
}

/**
 * Starts the local expiry scheduler and waits until completion (`maxTicks`,
 * `once`, `AbortSignal`, or `SIGINT`/`SIGTERM`).
 */
export async function runExpiryScheduler(
  options: ExpirySchedulerOptions
): Promise<ExpiryHealthSnapshot> {
  const scheduler = createExpiryScheduler(options)
  await scheduler.start()
  return scheduler.waitUntilDone()
}

export function formatCliHelp(): string {
  return [
    "Usage: node --import tsx scripts/local-expiry-scheduler.ts [options]",
    "",
    "Required:",
    "  --base-url <url>          Loopback origin only (127.0.0.1 or localhost)",
    "  --secret-file <path>      Owner-only (0600) env/token file path",
    "",
    "Options:",
    "  --endpoint <path>         Endpoint path (default: /api/v1/commands/runExpiry)",
    "  --payload-format <fmt>    envelope | job (default derived from endpoint)",
    "  --secret-key <name>       Env key inside secret file (default: SCHEDULER_SECRET)",
    "  --interval-ms <ms>        Timer interval in ms (default: 60000)",
    "  --timeout-ms <ms>         Per-request AbortController timeout (default: 15000)",
    "  --limit <1..100>          Batch size per page (default: 100)",
    "  --max-ticks <n>           Stop after n executed ticks",
    "  --once                    Run a single scheduled sweep and exit",
    "  --catch-up                Run an immediate CATCH_UP sweep (exits unless --max-ticks > 1 or --loop)",
    "  --loop                    Keep running SCHEDULED ticks after --catch-up",
    "  --through <iso>           Fixed UTC ISO cutoff timestamp for deterministic catch-up",
    "  --cursor <cursor>         Initial resume cursor",
    "  --state-file <path>       Optional 0600 JSON file for health persistence",
    "  --stale-hours <hours>     Stale threshold in hours (default: 26)",
    "  --help                    Show this help message",
  ].join("\n")
}

function takeValue(
  argv: readonly string[],
  index: number,
  flag: string
): string {
  const next = argv[index + 1]
  if (next === undefined || next.startsWith("--")) {
    throw new Error(`MISSING_VALUE_FOR_${flag}`)
  }
  return next
}

/**
 * Parses CLI flags for `scripts/local-expiry-scheduler.ts`.
 */
export function parseExpirySchedulerCliArgs(argv: readonly string[]): {
  help: boolean
  options?: ExpirySchedulerOptions
} {
  let baseUrl = process.env.EXPIRY_BASE_URL ?? ""
  let secretFilePath = process.env.EXPIRY_SECRET_FILE ?? ""
  let secretEnvKey: string | undefined
  let endpointPath: string | undefined
  let payloadFormat: ExpiryPayloadFormat | undefined
  let intervalMs: number | undefined
  let requestTimeoutMs: number | undefined
  let limit: number | undefined
  let maxTicks: number | undefined
  let once = false
  let catchUp = false
  let loopAfterCatchUp = false
  let through: string | undefined
  let initialCursor: string | undefined
  let stateFilePath: string | undefined
  let staleThresholdMs: number | undefined

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!
    switch (arg) {
      case "--help":
      case "-h":
        return { help: true }
      case "--base-url":
        baseUrl = takeValue(argv, i, arg)
        i += 1
        break
      case "--secret-file":
        secretFilePath = takeValue(argv, i, arg)
        i += 1
        break
      case "--secret-key":
        secretEnvKey = takeValue(argv, i, arg)
        i += 1
        break
      case "--endpoint":
        endpointPath = takeValue(argv, i, arg)
        i += 1
        break
      case "--payload-format": {
        const fmt = takeValue(argv, i, arg)
        if (fmt !== "envelope" && fmt !== "job") {
          throw new Error("INVALID_PAYLOAD_FORMAT")
        }
        payloadFormat = fmt
        i += 1
        break
      }
      case "--interval-ms":
        intervalMs = Number(takeValue(argv, i, arg))
        i += 1
        break
      case "--timeout-ms":
        requestTimeoutMs = Number(takeValue(argv, i, arg))
        i += 1
        break
      case "--limit":
        limit = Number(takeValue(argv, i, arg))
        i += 1
        break
      case "--max-ticks":
        maxTicks = Number(takeValue(argv, i, arg))
        i += 1
        break
      case "--once":
        once = true
        break
      case "--catch-up":
        catchUp = true
        break
      case "--loop":
        loopAfterCatchUp = true
        break
      case "--through":
        through = takeValue(argv, i, arg)
        i += 1
        break
      case "--cursor":
        initialCursor = takeValue(argv, i, arg)
        i += 1
        break
      case "--state-file":
        stateFilePath = takeValue(argv, i, arg)
        i += 1
        break
      case "--stale-hours": {
        const hours = Number(takeValue(argv, i, arg))
        if (!Number.isFinite(hours) || hours <= 0) {
          throw new Error("INVALID_STALE_HOURS")
        }
        staleThresholdMs = hours * 60 * 60 * 1000
        i += 1
        break
      }
      default:
        throw new Error(`UNKNOWN_CLI_OPTION: ${arg}`)
    }
  }

  if (!baseUrl) throw new Error("BASE_URL_REQUIRED")
  if (!secretFilePath) throw new Error("SECRET_FILE_REQUIRED")

  const effectiveOnce =
    once ||
    (catchUp && !loopAfterCatchUp && (maxTicks === undefined || maxTicks === 1))

  return {
    help: false,
    options: {
      baseUrl,
      secretFilePath,
      secretEnvKey,
      endpointPath,
      payloadFormat,
      intervalMs,
      requestTimeoutMs,
      limit,
      maxTicks,
      once: effectiveOnce,
      catchUp,
      through,
      initialCursor,
      stateFilePath,
      staleThresholdMs,
      registerSignalHandlers: true,
    },
  }
}

export async function runCli(
  argv: readonly string[] = process.argv.slice(2)
): Promise<number> {
  const parsed = parseExpirySchedulerCliArgs(argv)
  if (parsed.help || !parsed.options) {
    process.stdout.write(`${formatCliHelp()}\n`)
    return 0
  }
  const health = await runExpiryScheduler(parsed.options)
  return health.consecutiveFailures > 0 ? 1 : 0
}

function isMainModule(): boolean {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (isMainModule()) {
  runCli().then(
    (code) => {
      process.exitCode = code
    },
    (error: unknown) => {
      const message =
        error instanceof Error
          ? redactSensitiveText(error.message)
          : "SCHEDULER_FAILED"
      process.stderr.write(
        `${JSON.stringify({ event: "expiry_error", message })}\n`
      )
      process.exitCode = 1
    }
  )
}
