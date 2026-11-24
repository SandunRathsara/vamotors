/** Local PostgreSQL + private-file backup, isolated restore, and reconciliation. */
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { constants, existsSync } from "node:fs"
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  readlink,
  realpath,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import {
  dirname,
  isAbsolute,
  join,
  posix,
  relative,
  resolve,
  sep,
} from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"

const SCHEMA_NAME = "vamotors"
const MAX_BUFFER_COPY_BYTES = 50 * 1024 * 1024
const TRANSIENT_DIR_NAMES = new Set([
  "tmp",
  "temp",
  "staging",
  ".tmp",
  ".staging",
])
const UUID_SEGMENT =
  "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}"
const TRANSIENT_STAGE_FILE = new RegExp(
  `^s\\.${UUID_SEGMENT}\\.${UUID_SEGMENT}\\.${UUID_SEGMENT}$`
)
const TRANSIENT_PENDING_FILE = new RegExp(`^p\\.${UUID_SEGMENT}\\.(?:s|f)\\.`)
const EXCLUDED_PATTERNS = [
  "directories: tmp, temp, staging, .tmp, .staging",
  "transient files: s.<uuid>.<uuid>.<uuid>, p.<uuid>.(s|f).*",
] as const

const READ_NOFOLLOW_FLAGS =
  constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)
const WRITE_CREATE_EXCL_FLAGS =
  constants.O_WRONLY |
  constants.O_CREAT |
  constants.O_EXCL |
  (constants.O_NOFOLLOW ?? 0)

export type BackupErrorCode =
  | "INVALID_DATABASE_URL"
  | "REMOTE_DATABASE_FORBIDDEN"
  | "UNSAFE_OUTPUT_DIR"
  | "OUTPUT_DIR_NOT_EMPTY"
  | "UNSAFE_STORAGE"
  | "SYMLINK_ESCAPE"
  | "SCHEMA_NOT_FOUND"
  | "PG_BINARY_MISSING"
  | "PG_COMMAND_FAILED"
  | "DATABASE_QUERY_FAILED"
  | "SOURCE_OVERWRITE_FORBIDDEN"
  | "TARGET_NOT_EMPTY"
  | "TARGET_DB_NOT_EMPTY"
  | "MANIFEST_INVALID"
  | "INTEGRITY_CHECK_FAILED"
  | "RESTORE_VERIFICATION_FAILED"
  | "INVALID_CLI_ARGS"

export class BackupRestoreError extends Error {
  constructor(
    public readonly code: BackupErrorCode,
    message: string
  ) {
    super(redactSecrets(message))
    this.name = "BackupRestoreError"
  }
}

export type ParsedLoopbackDatabase = {
  host: string
  normalizedHost: "127.0.0.1"
  port: string
  dbName: string
  user: string
  password: string
  sslMode:
    | "disable"
    | "prefer"
    | "allow"
    | "require"
    | "verify-ca"
    | "verify-full"
  normalizedTargetKey: string
  redactedLabel: string
}

export type BackupFileEntry = {
  relativePath: string
  size: number
  sha256: string
}

export type DatabaseAttachmentReference = {
  id: string
  finalKey: string
  sha256: string
  size: number
}

export type FinancialTotalsSnapshot = {
  purchasePriceSum: string
  listedPriceSum: string
  purchasePaymentNetSum: string
  purchasePaymentGrossSum: string
  vehicleCostSum: string
  costPaymentNetSum: string
  costPaymentGrossSum: string
  disposalProceedsSum: string
  disposalNetLossSum: string
  disposalReceiptNetSum: string
  cycleBasisTotalSum: string
  leasePurchaseAmountSum: string
  leasePurchaseCashToSellerSum: string
}

export type DatabaseSnapshotMetadata = {
  schema: string
  tableRowCounts: Record<string, number>
  financialTotals: FinancialTotalsSnapshot
  attachments: DatabaseAttachmentReference[]
}

export type BackupManifestBody = {
  version: 1
  createdAt: string
  dump: {
    fileName: "database.dump"
    format: "custom" | "plain"
    size: number
    sha256: string
  }
  privateFiles: {
    totalCount: number
    totalBytes: number
    excludedPatterns: string[]
    files: BackupFileEntry[]
  }
  database: DatabaseSnapshotMetadata
}

export type BackupManifest = BackupManifestBody & {
  manifestSha256: string
}

export type BackupLocalStateOptions = {
  databaseUrl: string
  privateFileRoot: string
  outputDir: string
  pgDumpBin?: string
  allowScratchOutput?: boolean
  dumpFormat?: "custom" | "plain"
  pgClientFactory?: (db: ParsedLoopbackDatabase) => PgQueryClient
}

export type RestoreLocalStateOptions = {
  backupDir: string
  targetDatabaseUrl: string
  targetPrivateFileRoot: string
  sourceDatabaseUrl?: string
  sourcePrivateFileRoot?: string
  pgRestoreBin?: string
  psqlBin?: string
  allowScratchTarget?: boolean
  pgClientFactory?: (db: ParsedLoopbackDatabase) => PgQueryClient
}

export type VerifyRestoredStateOptions = {
  backupDir: string
  targetDatabaseUrl: string
  targetPrivateFileRoot: string
  pgClientFactory?: (db: ParsedLoopbackDatabase) => PgQueryClient
}

export type ReconciliationReport = {
  ok: boolean
  verifiedAt: string
  backupDir: string
  targetPrivateFileRoot: string
  targetDatabaseRedacted: string
  manifestSha256: string
  dump: {
    size: number
    sha256: string
    matched: boolean
  }
  privateFiles: {
    expectedCount: number
    restoredCount: number
    totalBytes: number
    missingFiles: string[]
    extraFiles: string[]
    mismatchedFiles: Array<{ relativePath: string; reason: string }>
    matched: boolean
  }
  database: {
    schema: string
    tableCount: number
    mismatchedTableCounts: Array<{
      table: string
      expected: number | null
      actual: number | null
    }>
    mismatchedFinancialTotals: Array<{
      metric: string
      expected: string
      actual: string
    }>
    attachmentCount: number
    mismatchedAttachments: Array<{
      id: string
      finalKey: string
      reason: string
    }>
    matched: boolean
  }
}

export type PgQueryClient = {
  connect(): Promise<void>
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<{ rows: T[]; rowCount: number | null }>
  end(): Promise<void>
}

const ALLOWED_SSL_MODES = new Set([
  "disable",
  "prefer",
  "allow",
  "require",
  "verify-ca",
  "verify-full",
])

/** Strip any embedded connection-string credentials or secret query fragments. */
export function redactSecrets(
  input: string,
  extraSecrets: string[] = []
): string {
  let output = input.replace(
    /\b(postgres(?:ql)?):\/\/([^/@\s:]+):([^/@\s]+)@/gi,
    "$1://$2:[REDACTED]@"
  )
  output = output.replace(
    /\b(postgres(?:ql)?):\/\/([^/@\s]+)@/gi,
    "$1://[REDACTED]@"
  )
  output = output.replace(
    /(PGPASSWORD\s*=\s*)([^\s'"]+|'[^']*'|"[^"]*")/gi,
    "$1[REDACTED]"
  )
  for (const secret of extraSecrets) {
    if (secret && secret.length >= 3) {
      output = output.split(secret).join("[REDACTED]")
    }
  }
  return output
}

function within(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return (
    rel === "" ||
    (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
  )
}

function overlaps(pathA: string, pathB: string): boolean {
  return within(pathA, pathB) || within(pathB, pathA)
}

function errnoCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code
}

/** Resolve a path canonically even when the leaf directory does not yet exist. */
async function resolveCanonical(targetPath: string): Promise<string> {
  const abs = resolve(targetPath)
  const suffix: string[] = []
  let probe = abs
  while (true) {
    try {
      const real = await realpath(probe)
      return suffix.length ? join(real, ...suffix.reverse()) : real
    } catch (error) {
      if (errnoCode(error) !== "ENOENT") {
        throw error
      }
      const parent = dirname(probe)
      if (parent === probe) {
        return abs
      }
      suffix.push(probe.slice(parent.length === 1 ? 1 : parent.length + 1))
      probe = parent
    }
  }
}

async function isInsideGitWorkTree(targetPath: string): Promise<boolean> {
  const canonical = await resolveCanonical(targetPath)
  let current = canonical
  while (true) {
    if (existsSync(join(current, ".git"))) {
      return true
    }
    const parent = dirname(current)
    if (parent === current) {
      return false
    }
    current = parent
  }
}

async function isSystemTempPath(targetPath: string): Promise<boolean> {
  const canonical = await resolveCanonical(targetPath)
  const candidates = [tmpdir(), "/tmp", "/private/tmp", "/var/tmp"]
  for (const base of candidates) {
    try {
      const canonicalBase = await realpath(base)
      if (within(canonicalBase, canonical)) {
        return true
      }
    } catch {
      if (within(resolve(base), canonical)) {
        return true
      }
    }
  }
  return false
}

function hasScratchSegment(targetPath: string): boolean {
  const segments = resolve(targetPath)
    .split(sep)
    .map((s) => s.toLowerCase())
  return segments.some((s) =>
    ["scratch", ".scratch", "tmp", ".tmp", "temp"].includes(s)
  )
}

/** Validate and parse a loopback-only PostgreSQL URL without leaking secrets. */
export function parseLoopbackDatabaseUrl(
  input: string
): ParsedLoopbackDatabase {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new BackupRestoreError(
      "INVALID_DATABASE_URL",
      "Invalid PostgreSQL connection URL"
    )
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new BackupRestoreError(
      "INVALID_DATABASE_URL",
      "Database URL must use postgres:// or postgresql:// scheme"
    )
  }
  const host = url.hostname.toLowerCase()
  if (!host || host.includes("%")) {
    throw new BackupRestoreError(
      "INVALID_DATABASE_URL",
      "Database URL contains an invalid hostname"
    )
  }
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new BackupRestoreError(
      "REMOTE_DATABASE_FORBIDDEN",
      `Non-loopback database host is forbidden (${host}); only 127.0.0.1 and localhost are allowed`
    )
  }
  if (url.hash) {
    throw new BackupRestoreError(
      "INVALID_DATABASE_URL",
      "Database URL must not include a URL fragment"
    )
  }
  const dbName = decodeURIComponent(url.pathname.replace(/^\/+/, ""))
  if (!dbName || dbName.includes("/")) {
    throw new BackupRestoreError(
      "INVALID_DATABASE_URL",
      "Database URL must specify a single database name"
    )
  }
  const port = url.port || "5432"
  const portNumber = Number(port)
  if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) {
    throw new BackupRestoreError(
      "INVALID_DATABASE_URL",
      "Database URL port must be between 1 and 65535"
    )
  }
  for (const key of url.searchParams.keys()) {
    if (key !== "sslmode") {
      throw new BackupRestoreError(
        "INVALID_DATABASE_URL",
        `Unsupported database URL query parameter: ${key}`
      )
    }
  }
  const sslModeRaw = url.searchParams.get("sslmode") ?? "disable"
  if (!ALLOWED_SSL_MODES.has(sslModeRaw)) {
    throw new BackupRestoreError(
      "INVALID_DATABASE_URL",
      "Database URL sslmode is invalid"
    )
  }
  const user = decodeURIComponent(url.username)
  if (!user) {
    throw new BackupRestoreError(
      "INVALID_DATABASE_URL",
      "Database URL must include a username"
    )
  }
  const password = decodeURIComponent(url.password)
  const normalizedHost = "127.0.0.1" as const
  const sslMode = sslModeRaw as ParsedLoopbackDatabase["sslMode"]
  return {
    host,
    normalizedHost,
    port,
    dbName,
    user,
    password,
    sslMode,
    normalizedTargetKey: `${normalizedHost}:${port}/${dbName}`,
    redactedLabel: `${normalizedHost}:${port}/${dbName}`,
  }
}

function buildSanitizedPgEnv(db: ParsedLoopbackDatabase): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = {
    NODE_ENV: process.env.NODE_ENV ?? "development",
  }
  for (const [k, v] of Object.entries(process.env)) {
    if (
      k !== "NODE_ENV" &&
      !k.startsWith("PG") &&
      !k.startsWith("BOOTSTRAP_") &&
      k !== "DATABASE_URL" &&
      k !== "DIRECT_URL"
    ) {
      clean[k] = v
    }
  }
  clean.PGHOST = db.host
  clean.PGPORT = db.port
  clean.PGUSER = db.user
  clean.PGDATABASE = db.dbName
  clean.PGSSLMODE = db.sslMode
  if (db.password) {
    clean.PGPASSWORD = db.password
  }
  return clean
}

function createDefaultPgClient(db: ParsedLoopbackDatabase): PgQueryClient {
  const ssl =
    db.sslMode === "disable" ||
    db.sslMode === "allow" ||
    db.sslMode === "prefer"
      ? false
      : { rejectUnauthorized: db.sslMode === "verify-full" }
  return new pg.Client({
    host: db.host,
    port: Number(db.port),
    user: db.user,
    password: db.password || undefined,
    database: db.dbName,
    ssl,
    connectionTimeoutMillis: 10000,
  })
}

function resolvePgBinary(
  name: "pg_dump" | "pg_restore" | "psql",
  override?: string
): string {
  if (override) {
    if (override.includes(sep) || override.includes("/")) {
      if (!existsSync(override)) {
        throw new BackupRestoreError(
          "PG_BINARY_MISSING",
          `PostgreSQL binary not found at specified path: ${name}`
        )
      }
    }
    return override
  }
  if (process.env.PG_BIN) {
    const candidate = join(process.env.PG_BIN, name)
    if (existsSync(candidate)) {
      return candidate
    }
  }
  const candidates = [
    `/opt/homebrew/opt/postgresql@18/bin/${name}`,
    `/opt/homebrew/opt/libpq/bin/${name}`,
    `/usr/local/opt/postgresql@18/bin/${name}`,
    `/usr/local/opt/libpq/bin/${name}`,
    `/usr/lib/postgresql/18/bin/${name}`,
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }
  return name
}

function runPgTool(
  bin: string,
  args: string[],
  db: ParsedLoopbackDatabase,
  toolLabel: string
): void {
  const result = spawnSync(bin, args, {
    env: buildSanitizedPgEnv(db),
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120000,
  })
  if (result.error) {
    const code = errnoCode(result.error)
    if (code === "ENOENT") {
      throw new BackupRestoreError(
        "PG_BINARY_MISSING",
        `Required PostgreSQL binary unavailable: ${toolLabel}`
      )
    }
    throw new BackupRestoreError(
      "PG_COMMAND_FAILED",
      `${toolLabel} failed to execute (${code ?? "UNKNOWN"})`
    )
  }
  if (result.status !== 0) {
    const stderr = redactSecrets(
      result.stderr?.toString("utf8").trim() ?? "",
      db.password ? [db.password] : []
    )
    const firstLine = stderr.split(/\r?\n/)[0]?.slice(0, 240) ?? ""
    throw new BackupRestoreError(
      "PG_COMMAND_FAILED",
      `${toolLabel} exited with status ${result.status ?? "unknown"}${firstLine ? `: ${firstLine}` : ""}`
    )
  }
}

function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeJson)
  }
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicalizeJson((value as Record<string, unknown>)[key])
    }
    return sorted
  }
  return value
}

export function computeManifestSha256(body: BackupManifestBody): string {
  const serialized = JSON.stringify(canonicalizeJson(body))
  return createHash("sha256").update(serialized, "utf8").digest("hex")
}

async function hashAndStatRegularFile(
  filePath: string
): Promise<{ size: number; sha256: string; mode: number }> {
  const info = await lstat(filePath)
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new BackupRestoreError(
      "UNSAFE_STORAGE",
      "Expected regular non-symlink file"
    )
  }
  const handle = await open(filePath, READ_NOFOLLOW_FLAGS)
  try {
    const fInfo = await handle.stat()
    if (!fInfo.isFile()) {
      throw new BackupRestoreError("UNSAFE_STORAGE", "Target is not a file")
    }
    const hash = createHash("sha256")
    const buf = Buffer.allocUnsafe(65536)
    let total = 0
    while (true) {
      const { bytesRead } = await handle.read(buf, 0, buf.length, null)
      if (bytesRead === 0) break
      total += bytesRead
      hash.update(buf.subarray(0, bytesRead))
    }
    return {
      size: total,
      sha256: hash.digest("hex"),
      mode: fInfo.mode & 0o777,
    }
  } finally {
    await handle.close()
  }
}

async function copyFilePrivateVerified(
  srcPath: string,
  destPath: string
): Promise<{ size: number; sha256: string }> {
  const srcHandle = await open(srcPath, READ_NOFOLLOW_FLAGS)
  try {
    const srcStat = await srcHandle.stat()
    if (!srcStat.isFile()) {
      throw new BackupRestoreError(
        "UNSAFE_STORAGE",
        "Source entry is not a file"
      )
    }
    if (srcStat.size > MAX_BUFFER_COPY_BYTES) {
      throw new BackupRestoreError(
        "UNSAFE_STORAGE",
        "Private file exceeds maximum supported copy size"
      )
    }
    await mkdir(dirname(destPath), { recursive: true, mode: 0o700 })
    const destHandle = await open(destPath, WRITE_CREATE_EXCL_FLAGS, 0o600)
    const hash = createHash("sha256")
    let total = 0
    try {
      const buf = Buffer.allocUnsafe(65536)
      while (true) {
        const { bytesRead } = await srcHandle.read(buf, 0, buf.length, null)
        if (bytesRead === 0) break
        const slice = buf.subarray(0, bytesRead)
        hash.update(slice)
        let offset = 0
        while (offset < slice.length) {
          const { bytesWritten } = await destHandle.write(
            slice,
            offset,
            slice.length - offset
          )
          if (bytesWritten <= 0) {
            throw new BackupRestoreError(
              "UNSAFE_STORAGE",
              "Failed writing destination file"
            )
          }
          offset += bytesWritten
        }
        total += bytesRead
      }
      await destHandle.chmod(0o600)
      await destHandle.sync()
    } finally {
      await destHandle.close()
    }
    const sha256 = hash.digest("hex")
    const verified = await hashAndStatRegularFile(destPath)
    if (verified.size !== total || verified.sha256 !== sha256) {
      throw new BackupRestoreError(
        "INTEGRITY_CHECK_FAILED",
        "Copied file failed post-write hash verification"
      )
    }
    return { size: total, sha256 }
  } finally {
    await srcHandle.close()
  }
}

function assertSafeRelativePosixPath(relPosix: string): void {
  if (
    !relPosix ||
    posix.isAbsolute(relPosix) ||
    relPosix.includes("\\") ||
    relPosix.includes("\0")
  ) {
    throw new BackupRestoreError(
      "MANIFEST_INVALID",
      "Invalid relative file path in manifest"
    )
  }
  const segments = relPosix.split("/")
  if (segments.some((s) => !s || s === "." || s === "..")) {
    throw new BackupRestoreError(
      "MANIFEST_INVALID",
      "Path traversal segment in manifest file entry"
    )
  }
}

async function assertSymlinkDoesNotEscape(
  entryPath: string,
  canonicalRoot: string
): Promise<never> {
  let resolvedTarget: string
  try {
    resolvedTarget = await realpath(entryPath)
  } catch {
    try {
      const linkTarget = await readlink(entryPath)
      const absTarget = resolve(dirname(entryPath), linkTarget)
      if (!within(canonicalRoot, absTarget)) {
        throw new BackupRestoreError(
          "SYMLINK_ESCAPE",
          "Dangling symlink escapes privateFileRoot"
        )
      }
    } catch (inner) {
      if (inner instanceof BackupRestoreError) throw inner
    }
    throw new BackupRestoreError(
      "SYMLINK_ESCAPE",
      "Unresolvable symlink inside privateFileRoot is forbidden"
    )
  }
  if (!within(canonicalRoot, resolvedTarget)) {
    throw new BackupRestoreError(
      "SYMLINK_ESCAPE",
      "Symlink escapes privateFileRoot"
    )
  }
  throw new BackupRestoreError(
    "SYMLINK_ESCAPE",
    "Symlinks are forbidden inside privateFileRoot"
  )
}

async function walkDurableFiles(
  rootDir: string,
  options: { excludeTransient: boolean }
): Promise<Array<{ fullPath: string; relativePath: string }>> {
  const rootInfo = await lstat(rootDir).catch(() => null)
  if (!rootInfo || rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
    throw new BackupRestoreError(
      "UNSAFE_STORAGE",
      "Storage root must be an existing non-symlink directory"
    )
  }
  const canonicalRoot = await realpath(rootDir)
  const collected: Array<{ fullPath: string; relativePath: string }> = []

  async function visit(currentDir: string, relPrefix: string) {
    const entries = await readdir(currentDir, { withFileTypes: true })
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name)
      const relPosix = relPrefix ? `${relPrefix}/${entry.name}` : entry.name
      const statInfo = await lstat(fullPath)
      if (statInfo.isSymbolicLink()) {
        await assertSymlinkDoesNotEscape(fullPath, canonicalRoot)
      }
      if (statInfo.isDirectory()) {
        if (options.excludeTransient && TRANSIENT_DIR_NAMES.has(entry.name)) {
          continue
        }
        await visit(fullPath, relPosix)
        continue
      }
      if (!statInfo.isFile()) {
        throw new BackupRestoreError(
          "UNSAFE_STORAGE",
          "Non-regular file entry encountered in private storage"
        )
      }
      if (
        options.excludeTransient &&
        (TRANSIENT_STAGE_FILE.test(entry.name) ||
          TRANSIENT_PENDING_FILE.test(entry.name))
      ) {
        continue
      }
      collected.push({ fullPath, relativePath: relPosix })
    }
  }

  await visit(canonicalRoot, "")
  return collected
}

function quoteIdent(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`
}

async function withPgClient<T>(
  db: ParsedLoopbackDatabase,
  factory: ((db: ParsedLoopbackDatabase) => PgQueryClient) | undefined,
  fn: (client: PgQueryClient) => Promise<T>
): Promise<T> {
  const client = (factory ?? createDefaultPgClient)(db)
  try {
    await client.connect()
    return await fn(client)
  } catch (error) {
    if (error instanceof BackupRestoreError) {
      throw error
    }
    const safeMsg = redactSecrets(
      error instanceof Error ? error.message : "Database operation failed",
      db.password ? [db.password] : []
    )
    throw new BackupRestoreError(
      "DATABASE_QUERY_FAILED",
      `Database query failed on ${db.redactedLabel}: ${safeMsg}`
    )
  } finally {
    await client.end().catch(() => {})
  }
}

async function queryOptionalAggregate(
  client: PgQueryClient,
  tableSet: Set<string>,
  tableName: string,
  sqlExpression: string
): Promise<string> {
  if (!tableSet.has(tableName)) {
    return "0"
  }
  const sql = `SELECT ${sqlExpression} AS total FROM ${quoteIdent(SCHEMA_NAME)}.${quoteIdent(tableName)}`
  const res = await client.query<{ total: string | number | null }>(sql)
  const raw = res.rows[0]?.total
  return raw === null || raw === undefined ? "0" : String(raw)
}

async function collectDatabaseSnapshot(
  db: ParsedLoopbackDatabase,
  pgClientFactory?: (db: ParsedLoopbackDatabase) => PgQueryClient
): Promise<DatabaseSnapshotMetadata> {
  return withPgClient(db, pgClientFactory, async (client) => {
    const schemaCheck = await client.query<{ schema_name: string }>(
      "SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1",
      [SCHEMA_NAME]
    )
    if (!schemaCheck.rows.length) {
      throw new BackupRestoreError(
        "SCHEMA_NOT_FOUND",
        `Schema ${SCHEMA_NAME} does not exist in ${db.redactedLabel}`
      )
    }
    const tablesRes = await client.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = $1 AND table_type = 'BASE TABLE'
       ORDER BY table_name ASC`,
      [SCHEMA_NAME]
    )
    const tableNames = tablesRes.rows.map((r) => r.table_name)
    const tableSet = new Set(tableNames)
    const tableRowCounts: Record<string, number> = {}
    for (const tableName of tableNames) {
      const countRes = await client.query<{ count: string | number }>(
        `SELECT COUNT(*)::text AS count FROM ${quoteIdent(SCHEMA_NAME)}.${quoteIdent(tableName)}`
      )
      tableRowCounts[tableName] = Number(countRes.rows[0]?.count ?? 0)
    }

    const financialTotals: FinancialTotalsSnapshot = {
      purchasePriceSum: await queryOptionalAggregate(
        client,
        tableSet,
        "PurchaseRecord",
        'COALESCE(SUM("purchasePrice"), 0)::text'
      ),
      listedPriceSum: await queryOptionalAggregate(
        client,
        tableSet,
        "PurchaseRecord",
        'COALESCE(SUM("listedPrice"), 0)::text'
      ),
      purchasePaymentNetSum: await queryOptionalAggregate(
        client,
        tableSet,
        "PurchasePayment",
        "COALESCE(SUM(CASE WHEN direction = 'IN' THEN amount ELSE -amount END), 0)::text"
      ),
      purchasePaymentGrossSum: await queryOptionalAggregate(
        client,
        tableSet,
        "PurchasePayment",
        "COALESCE(SUM(amount), 0)::text"
      ),
      vehicleCostSum: await queryOptionalAggregate(
        client,
        tableSet,
        "VehicleCost",
        "COALESCE(SUM(amount), 0)::text"
      ),
      costPaymentNetSum: await queryOptionalAggregate(
        client,
        tableSet,
        "CostPayment",
        "COALESCE(SUM(CASE WHEN direction = 'IN' THEN amount ELSE -amount END), 0)::text"
      ),
      costPaymentGrossSum: await queryOptionalAggregate(
        client,
        tableSet,
        "CostPayment",
        "COALESCE(SUM(amount), 0)::text"
      ),
      disposalProceedsSum: await queryOptionalAggregate(
        client,
        tableSet,
        "Disposal",
        "COALESCE(SUM(proceeds), 0)::text"
      ),
      disposalNetLossSum: await queryOptionalAggregate(
        client,
        tableSet,
        "Disposal",
        'COALESCE(SUM("netLoss"), 0)::text'
      ),
      disposalReceiptNetSum: await queryOptionalAggregate(
        client,
        tableSet,
        "DisposalReceipt",
        "COALESCE(SUM(CASE WHEN direction = 'IN' THEN amount ELSE -amount END), 0)::text"
      ),
      cycleBasisTotalSum: await queryOptionalAggregate(
        client,
        tableSet,
        "CycleBasisVersion",
        "COALESCE(SUM(total), 0)::text"
      ),
      leasePurchaseAmountSum: await queryOptionalAggregate(
        client,
        tableSet,
        "LeasePurchaseDetail",
        "COALESCE(SUM(amount), 0)::text"
      ),
      leasePurchaseCashToSellerSum: await queryOptionalAggregate(
        client,
        tableSet,
        "LeasePurchaseDetail",
        'COALESCE(SUM("cashToSeller"), 0)::text'
      ),
    }

    let attachments: DatabaseAttachmentReference[] = []
    if (tableSet.has("Attachment")) {
      const attRes = await client.query<{
        id: string
        finalKey: string
        sha256: string
        size: number | string
      }>(
        `SELECT id::text AS id, "finalKey", sha256, size::integer AS size
         FROM ${quoteIdent(SCHEMA_NAME)}."Attachment"
         ORDER BY "finalKey" ASC, id ASC`
      )
      attachments = attRes.rows.map((row) => ({
        id: String(row.id),
        finalKey: String(row.finalKey),
        sha256: String(row.sha256),
        size: Number(row.size),
      }))
    }

    return {
      schema: SCHEMA_NAME,
      tableRowCounts,
      financialTotals,
      attachments,
    }
  })
}

async function ensureOutputDirSafeAndEmpty(
  outputDir: string,
  privateFileRoot: string,
  allowScratchOutput: boolean
): Promise<string> {
  const canonicalPrivate = await resolveCanonical(privateFileRoot)
  const canonicalOutput = await resolveCanonical(outputDir)

  if (overlaps(canonicalPrivate, canonicalOutput)) {
    throw new BackupRestoreError(
      "UNSAFE_OUTPUT_DIR",
      "outputDir must not equal, reside inside, or enclose privateFileRoot"
    )
  }

  const inGit = await isInsideGitWorkTree(outputDir)
  if (inGit) {
    const isExplicitScratch =
      allowScratchOutput &&
      (hasScratchSegment(outputDir) || (await isSystemTempPath(outputDir)))
    if (!isExplicitScratch) {
      throw new BackupRestoreError(
        "UNSAFE_OUTPUT_DIR",
        "outputDir must not reside inside a Git repository working tree"
      )
    }
  }

  const existing = await lstat(outputDir).catch(() => null)
  if (existing) {
    if (existing.isSymbolicLink() || !existing.isDirectory()) {
      throw new BackupRestoreError(
        "UNSAFE_OUTPUT_DIR",
        "outputDir must be a regular directory"
      )
    }
    const entries = await readdir(outputDir)
    if (entries.length > 0) {
      throw new BackupRestoreError(
        "OUTPUT_DIR_NOT_EMPTY",
        "outputDir already exists and is not empty"
      )
    }
    await chmod(outputDir, 0o700)
  } else {
    await mkdir(outputDir, { recursive: true, mode: 0o700 })
    await chmod(outputDir, 0o700)
  }

  return realpath(outputDir)
}

/** Create a verified backup snapshot of local PostgreSQL and durable private files. */
export async function backupLocalState(
  options: BackupLocalStateOptions
): Promise<{ outputDir: string; manifest: BackupManifest }> {
  const db = parseLoopbackDatabaseUrl(options.databaseUrl)
  const dumpFormat = options.dumpFormat ?? "custom"
  const safeOutputDir = await ensureOutputDirSafeAndEmpty(
    options.outputDir,
    options.privateFileRoot,
    Boolean(options.allowScratchOutput)
  )

  const durableFiles = await walkDurableFiles(options.privateFileRoot, {
    excludeTransient: true,
  })
  const filesOutputDir = join(safeOutputDir, "files")
  await mkdir(filesOutputDir, { mode: 0o700 })

  const fileEntries: BackupFileEntry[] = []
  let totalBytes = 0
  for (const item of durableFiles) {
    const destPath = join(filesOutputDir, ...item.relativePath.split("/"))
    const copied = await copyFilePrivateVerified(item.fullPath, destPath)
    totalBytes += copied.size
    fileEntries.push({
      relativePath: item.relativePath,
      size: copied.size,
      sha256: copied.sha256,
    })
  }
  fileEntries.sort((a, b) => a.relativePath.localeCompare(b.relativePath))

  const dumpPath = join(safeOutputDir, "database.dump")
  const pgDump = resolvePgBinary("pg_dump", options.pgDumpBin)
  const dumpArgs = [
    `--format=${dumpFormat}`,
    "--no-owner",
    "--no-privileges",
    `--schema=${SCHEMA_NAME}`,
    "--file",
    dumpPath,
  ]
  runPgTool(pgDump, dumpArgs, db, "pg_dump")
  await chmod(dumpPath, 0o600)
  const dumpStats = await hashAndStatRegularFile(dumpPath)

  const databaseMetadata = await collectDatabaseSnapshot(
    db,
    options.pgClientFactory
  )

  const manifestBody: BackupManifestBody = {
    version: 1,
    createdAt: new Date().toISOString(),
    dump: {
      fileName: "database.dump",
      format: dumpFormat,
      size: dumpStats.size,
      sha256: dumpStats.sha256,
    },
    privateFiles: {
      totalCount: fileEntries.length,
      totalBytes,
      excludedPatterns: [...EXCLUDED_PATTERNS],
      files: fileEntries,
    },
    database: databaseMetadata,
  }

  const manifest: BackupManifest = {
    ...manifestBody,
    manifestSha256: computeManifestSha256(manifestBody),
  }

  const manifestPath = join(safeOutputDir, "manifest.json")
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx",
  })

  return { outputDir: safeOutputDir, manifest }
}

function isValidManifestShape(raw: unknown): raw is BackupManifest {
  if (!raw || typeof raw !== "object") return false
  const m = raw as Record<string, unknown>
  if (m.version !== 1 || typeof m.createdAt !== "string") return false
  if (
    typeof m.manifestSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(m.manifestSha256)
  ) {
    return false
  }
  if (!m.dump || typeof m.dump !== "object") return false
  const dump = m.dump as Record<string, unknown>
  if (
    dump.fileName !== "database.dump" ||
    !["custom", "plain"].includes(String(dump.format)) ||
    typeof dump.size !== "number" ||
    !Number.isSafeInteger(dump.size) ||
    dump.size < 0 ||
    typeof dump.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(dump.sha256)
  ) {
    return false
  }
  if (!m.privateFiles || typeof m.privateFiles !== "object") return false
  const pf = m.privateFiles as Record<string, unknown>
  if (
    typeof pf.totalCount !== "number" ||
    typeof pf.totalBytes !== "number" ||
    !Array.isArray(pf.files) ||
    !Array.isArray(pf.excludedPatterns)
  ) {
    return false
  }
  for (const entry of pf.files) {
    if (!entry || typeof entry !== "object") return false
    const e = entry as Record<string, unknown>
    if (
      typeof e.relativePath !== "string" ||
      typeof e.size !== "number" ||
      !Number.isSafeInteger(e.size) ||
      e.size < 0 ||
      typeof e.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(e.sha256)
    ) {
      return false
    }
    assertSafeRelativePosixPath(e.relativePath)
  }
  if (!m.database || typeof m.database !== "object") return false
  const db = m.database as Record<string, unknown>
  if (
    db.schema !== SCHEMA_NAME ||
    !db.tableRowCounts ||
    typeof db.tableRowCounts !== "object" ||
    !db.financialTotals ||
    typeof db.financialTotals !== "object" ||
    !Array.isArray(db.attachments)
  ) {
    return false
  }
  return true
}

/** Verify backup manifest signature, database dump hash, and all backed-up files. */
export async function verifyBackupArchive(
  backupDir: string
): Promise<BackupManifest> {
  const dirInfo = await lstat(backupDir).catch(() => null)
  if (!dirInfo || dirInfo.isSymbolicLink() || !dirInfo.isDirectory()) {
    throw new BackupRestoreError(
      "UNSAFE_STORAGE",
      "backupDir must be an existing non-symlink directory"
    )
  }
  const canonicalBackup = await realpath(backupDir)
  const manifestPath = join(canonicalBackup, "manifest.json")
  const manifestStat = await lstat(manifestPath).catch(() => null)
  if (
    !manifestStat ||
    manifestStat.isSymbolicLink() ||
    !manifestStat.isFile()
  ) {
    throw new BackupRestoreError(
      "MANIFEST_INVALID",
      "Backup manifest.json is missing or invalid"
    )
  }
  let parsedRaw: unknown
  try {
    parsedRaw = JSON.parse(await readFile(manifestPath, "utf8"))
  } catch {
    throw new BackupRestoreError(
      "MANIFEST_INVALID",
      "Backup manifest.json is not valid JSON"
    )
  }
  if (!isValidManifestShape(parsedRaw)) {
    throw new BackupRestoreError(
      "MANIFEST_INVALID",
      "Backup manifest.json schema is invalid"
    )
  }
  const { manifestSha256, ...body } = parsedRaw
  const expectedManifestSha = computeManifestSha256(body)
  if (manifestSha256 !== expectedManifestSha) {
    throw new BackupRestoreError(
      "INTEGRITY_CHECK_FAILED",
      "Backup manifestSha256 verification failed"
    )
  }

  const dumpPath = join(canonicalBackup, parsedRaw.dump.fileName)
  const dumpStat = await hashAndStatRegularFile(dumpPath).catch((err) => {
    if (err instanceof BackupRestoreError) throw err
    throw new BackupRestoreError(
      "INTEGRITY_CHECK_FAILED",
      "Backup database.dump is missing or unreadable"
    )
  })
  if (
    dumpStat.size !== parsedRaw.dump.size ||
    dumpStat.sha256 !== parsedRaw.dump.sha256
  ) {
    throw new BackupRestoreError(
      "INTEGRITY_CHECK_FAILED",
      "Backup database.dump failed size or SHA-256 verification"
    )
  }

  const filesDir = join(canonicalBackup, "files")
  const actualFiles = await walkDurableFiles(filesDir, {
    excludeTransient: false,
  })
  const actualMap = new Map(
    actualFiles.map((f) => [f.relativePath, f.fullPath])
  )
  const expectedPaths = new Set<string>()
  let actualByteTotal = 0

  for (const expected of parsedRaw.privateFiles.files) {
    if (expectedPaths.has(expected.relativePath)) {
      throw new BackupRestoreError(
        "MANIFEST_INVALID",
        "Duplicate relativePath in manifest"
      )
    }
    expectedPaths.add(expected.relativePath)
    const fullPath = actualMap.get(expected.relativePath)
    if (!fullPath) {
      throw new BackupRestoreError(
        "INTEGRITY_CHECK_FAILED",
        `Backed-up private file missing: ${expected.relativePath}`
      )
    }
    const stats = await hashAndStatRegularFile(fullPath)
    if (stats.size !== expected.size || stats.sha256 !== expected.sha256) {
      throw new BackupRestoreError(
        "INTEGRITY_CHECK_FAILED",
        `Backed-up private file failed integrity check: ${expected.relativePath}`
      )
    }
    actualByteTotal += stats.size
  }

  if (
    actualMap.size !== expectedPaths.size ||
    parsedRaw.privateFiles.totalCount !== parsedRaw.privateFiles.files.length ||
    parsedRaw.privateFiles.totalBytes !== actualByteTotal
  ) {
    throw new BackupRestoreError(
      "INTEGRITY_CHECK_FAILED",
      "Backup archive private file count or total bytes do not match manifest"
    )
  }

  return parsedRaw
}

async function ensureIsolatedEmptyTargetRoot(
  options: RestoreLocalStateOptions,
  canonicalBackup: string
): Promise<string> {
  const canonicalTarget = await resolveCanonical(options.targetPrivateFileRoot)

  if (overlaps(canonicalBackup, canonicalTarget)) {
    throw new BackupRestoreError(
      "UNSAFE_STORAGE",
      "targetPrivateFileRoot must not overlap backupDir"
    )
  }

  if (options.sourcePrivateFileRoot) {
    const canonicalSource = await resolveCanonical(
      options.sourcePrivateFileRoot
    )
    if (overlaps(canonicalSource, canonicalTarget)) {
      throw new BackupRestoreError(
        "SOURCE_OVERWRITE_FORBIDDEN",
        "targetPrivateFileRoot must not equal or overlap sourcePrivateFileRoot"
      )
    }
  }

  const inGit = await isInsideGitWorkTree(options.targetPrivateFileRoot)
  if (inGit) {
    const isExplicitScratch =
      Boolean(options.allowScratchTarget) &&
      (hasScratchSegment(options.targetPrivateFileRoot) ||
        (await isSystemTempPath(options.targetPrivateFileRoot)))
    if (!isExplicitScratch) {
      throw new BackupRestoreError(
        "UNSAFE_STORAGE",
        "targetPrivateFileRoot must not reside inside a Git repository working tree"
      )
    }
  }

  const info = await lstat(options.targetPrivateFileRoot).catch(() => null)
  if (info) {
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new BackupRestoreError(
        "UNSAFE_STORAGE",
        "targetPrivateFileRoot must be a regular non-symlink directory"
      )
    }
    const entries = await readdir(options.targetPrivateFileRoot)
    if (entries.length > 0) {
      throw new BackupRestoreError(
        "TARGET_NOT_EMPTY",
        "targetPrivateFileRoot must be empty before restore"
      )
    }
    await chmod(options.targetPrivateFileRoot, 0o700)
  } else {
    await mkdir(options.targetPrivateFileRoot, { recursive: true, mode: 0o700 })
    await chmod(options.targetPrivateFileRoot, 0o700)
  }

  return realpath(options.targetPrivateFileRoot)
}

async function prepareEmptyTargetSchema(
  targetDb: ParsedLoopbackDatabase,
  pgClientFactory?: (db: ParsedLoopbackDatabase) => PgQueryClient
): Promise<void> {
  await withPgClient(targetDb, pgClientFactory, async (client) => {
    const schemaRes = await client.query<{ schema_name: string }>(
      "SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1",
      [SCHEMA_NAME]
    )
    if (!schemaRes.rows.length) {
      return
    }
    const objRes = await client.query<{ count: string | number }>(
      `SELECT (
         (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = $1) +
         (SELECT COUNT(*) FROM information_schema.routines WHERE routine_schema = $1) +
         (SELECT COUNT(*) FROM information_schema.sequences WHERE sequence_schema = $1)
       )::text AS count`,
      [SCHEMA_NAME]
    )
    const objectCount = Number(objRes.rows[0]?.count ?? 0)
    if (objectCount > 0) {
      throw new BackupRestoreError(
        "TARGET_DB_NOT_EMPTY",
        `Target database ${targetDb.redactedLabel} already contains objects in schema ${SCHEMA_NAME}`
      )
    }
    await client.query(`DROP SCHEMA ${quoteIdent(SCHEMA_NAME)}`)
  })
}

/** Restore a verified backup into an isolated local PostgreSQL database and private root. */
export async function restoreLocalState(
  options: RestoreLocalStateOptions
): Promise<{ manifest: BackupManifest; report: ReconciliationReport }> {
  const targetDb = parseLoopbackDatabaseUrl(options.targetDatabaseUrl)
  if (options.sourceDatabaseUrl) {
    const sourceDb = parseLoopbackDatabaseUrl(options.sourceDatabaseUrl)
    if (targetDb.normalizedTargetKey === sourceDb.normalizedTargetKey) {
      throw new BackupRestoreError(
        "SOURCE_OVERWRITE_FORBIDDEN",
        "targetDatabaseUrl must not match sourceDatabaseUrl"
      )
    }
  }

  const manifest = await verifyBackupArchive(options.backupDir)
  const canonicalBackup = await realpath(options.backupDir)
  const targetRoot = await ensureIsolatedEmptyTargetRoot(
    options,
    canonicalBackup
  )

  await prepareEmptyTargetSchema(targetDb, options.pgClientFactory)

  const dumpPath = join(canonicalBackup, manifest.dump.fileName)
  if (manifest.dump.format === "custom") {
    const pgRestore = resolvePgBinary("pg_restore", options.pgRestoreBin)
    runPgTool(
      pgRestore,
      [
        "--no-owner",
        "--no-privileges",
        "--exit-on-error",
        "--dbname",
        targetDb.dbName,
        dumpPath,
      ],
      targetDb,
      "pg_restore"
    )
  } else {
    const psql = resolvePgBinary("psql", options.psqlBin)
    runPgTool(
      psql,
      ["--set=ON_ERROR_STOP=1", "--file", dumpPath],
      targetDb,
      "psql"
    )
  }

  const filesDir = join(canonicalBackup, "files")
  for (const entry of manifest.privateFiles.files) {
    const srcPath = join(filesDir, ...entry.relativePath.split("/"))
    const destPath = join(targetRoot, ...entry.relativePath.split("/"))
    const copied = await copyFilePrivateVerified(srcPath, destPath)
    if (copied.size !== entry.size || copied.sha256 !== entry.sha256) {
      throw new BackupRestoreError(
        "INTEGRITY_CHECK_FAILED",
        `Restored file mismatch: ${entry.relativePath}`
      )
    }
  }
  await chmod(targetRoot, 0o700)

  const report = await verifyRestoredState({
    backupDir: canonicalBackup,
    targetDatabaseUrl: options.targetDatabaseUrl,
    targetPrivateFileRoot: targetRoot,
    pgClientFactory: options.pgClientFactory,
  })
  if (!report.ok) {
    throw new BackupRestoreError(
      "RESTORE_VERIFICATION_FAILED",
      `Restored state reconciliation failed for ${targetDb.redactedLabel}`
    )
  }

  return { manifest, report }
}

/** Reconcile restored database row counts, financial sums, attachments, and private files against manifest.json. */
export async function verifyRestoredState(
  options: VerifyRestoredStateOptions
): Promise<ReconciliationReport> {
  const targetDb = parseLoopbackDatabaseUrl(options.targetDatabaseUrl)
  const manifest = await verifyBackupArchive(options.backupDir)

  const rootInfo = await lstat(options.targetPrivateFileRoot).catch(() => null)
  if (!rootInfo || rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
    throw new BackupRestoreError(
      "UNSAFE_STORAGE",
      "targetPrivateFileRoot must be an existing non-symlink directory"
    )
  }
  if ((rootInfo.mode & 0o077) !== 0) {
    throw new BackupRestoreError(
      "UNSAFE_STORAGE",
      "targetPrivateFileRoot must not allow group/world permissions"
    )
  }

  const restoredWalk = await walkDurableFiles(options.targetPrivateFileRoot, {
    excludeTransient: false,
  })
  const restoredByPath = new Map<
    string,
    { size: number; sha256: string; mode: number }
  >()
  let restoredTotalBytes = 0
  for (const file of restoredWalk) {
    const stats = await hashAndStatRegularFile(file.fullPath)
    restoredByPath.set(file.relativePath, stats)
    restoredTotalBytes += stats.size
  }

  const expectedByPath = new Map(
    manifest.privateFiles.files.map((f) => [f.relativePath, f])
  )
  const missingFiles: string[] = []
  const extraFiles: string[] = []
  const mismatchedFiles: Array<{ relativePath: string; reason: string }> = []

  for (const expected of manifest.privateFiles.files) {
    const actual = restoredByPath.get(expected.relativePath)
    if (!actual) {
      missingFiles.push(expected.relativePath)
      continue
    }
    if (actual.size !== expected.size) {
      mismatchedFiles.push({
        relativePath: expected.relativePath,
        reason: `size mismatch: expected ${expected.size}, got ${actual.size}`,
      })
    } else if (actual.sha256 !== expected.sha256) {
      mismatchedFiles.push({
        relativePath: expected.relativePath,
        reason: "sha256 mismatch",
      })
    } else if ((actual.mode & 0o077) !== 0) {
      mismatchedFiles.push({
        relativePath: expected.relativePath,
        reason: "unsafe permissions (group/world accessible)",
      })
    }
  }
  for (const actualPath of restoredByPath.keys()) {
    if (!expectedByPath.has(actualPath)) {
      extraFiles.push(actualPath)
    }
  }

  const actualDb = await collectDatabaseSnapshot(
    targetDb,
    options.pgClientFactory
  )

  const mismatchedTableCounts: ReconciliationReport["database"]["mismatchedTableCounts"] =
    []
  const allTables = new Set([
    ...Object.keys(manifest.database.tableRowCounts),
    ...Object.keys(actualDb.tableRowCounts),
  ])
  for (const table of [...allTables].sort()) {
    const expected = manifest.database.tableRowCounts[table] ?? null
    const actual = actualDb.tableRowCounts[table] ?? null
    if (expected !== actual) {
      mismatchedTableCounts.push({ table, expected, actual })
    }
  }

  const mismatchedFinancialTotals: ReconciliationReport["database"]["mismatchedFinancialTotals"] =
    []
  const financialKeys = Object.keys(manifest.database.financialTotals) as Array<
    keyof FinancialTotalsSnapshot
  >
  for (const metric of financialKeys) {
    const expected = manifest.database.financialTotals[metric]
    const actual = actualDb.financialTotals[metric]
    if (expected !== actual) {
      mismatchedFinancialTotals.push({ metric, expected, actual })
    }
  }

  const mismatchedAttachments: ReconciliationReport["database"]["mismatchedAttachments"] =
    []
  const expectedAttMap = new Map(
    manifest.database.attachments.map((a) => [a.id, a])
  )
  const actualAttMap = new Map(actualDb.attachments.map((a) => [a.id, a]))

  for (const exp of manifest.database.attachments) {
    const act = actualAttMap.get(exp.id)
    if (!act) {
      mismatchedAttachments.push({
        id: exp.id,
        finalKey: exp.finalKey,
        reason: "missing Attachment row in restored database",
      })
      continue
    }
    if (
      act.finalKey !== exp.finalKey ||
      act.sha256 !== exp.sha256 ||
      act.size !== exp.size
    ) {
      mismatchedAttachments.push({
        id: exp.id,
        finalKey: exp.finalKey,
        reason: "Attachment row metadata mismatch",
      })
      continue
    }
    const restoredFile = restoredByPath.get(act.finalKey)
    if (!restoredFile) {
      mismatchedAttachments.push({
        id: act.id,
        finalKey: act.finalKey,
        reason: "referenced private file missing from restored root",
      })
    } else if (
      restoredFile.sha256 !== act.sha256 ||
      restoredFile.size !== act.size
    ) {
      mismatchedAttachments.push({
        id: act.id,
        finalKey: act.finalKey,
        reason: "referenced private file hash or size mismatch",
      })
    }
  }
  for (const act of actualDb.attachments) {
    if (!expectedAttMap.has(act.id)) {
      mismatchedAttachments.push({
        id: act.id,
        finalKey: act.finalKey,
        reason: "unexpected Attachment row in restored database",
      })
    }
  }

  const filesMatched =
    missingFiles.length === 0 &&
    extraFiles.length === 0 &&
    mismatchedFiles.length === 0 &&
    restoredTotalBytes === manifest.privateFiles.totalBytes
  const databaseMatched =
    mismatchedTableCounts.length === 0 &&
    mismatchedFinancialTotals.length === 0 &&
    mismatchedAttachments.length === 0

  return {
    ok: filesMatched && databaseMatched,
    verifiedAt: new Date().toISOString(),
    backupDir: await realpath(options.backupDir),
    targetPrivateFileRoot: await realpath(options.targetPrivateFileRoot),
    targetDatabaseRedacted: targetDb.redactedLabel,
    manifestSha256: manifest.manifestSha256,
    dump: {
      size: manifest.dump.size,
      sha256: manifest.dump.sha256,
      matched: true,
    },
    privateFiles: {
      expectedCount: manifest.privateFiles.totalCount,
      restoredCount: restoredWalk.length,
      totalBytes: restoredTotalBytes,
      missingFiles,
      extraFiles,
      mismatchedFiles,
      matched: filesMatched,
    },
    database: {
      schema: SCHEMA_NAME,
      tableCount: Object.keys(actualDb.tableRowCounts).length,
      mismatchedTableCounts,
      mismatchedFinancialTotals,
      attachmentCount: actualDb.attachments.length,
      mismatchedAttachments,
      matched: databaseMatched,
    },
  }
}

function parseCliFlags(argv: string[]): {
  command: string
  flags: Record<string, string | boolean>
} {
  const [command = "", ...rest] = argv
  const flags: Record<string, string | boolean> = {}
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i]
    if (!token.startsWith("--")) {
      throw new BackupRestoreError(
        "INVALID_CLI_ARGS",
        `Unexpected positional argument: ${token}`
      )
    }
    const eqIndex = token.indexOf("=")
    if (eqIndex !== -1) {
      flags[token.slice(2, eqIndex)] = token.slice(eqIndex + 1)
    } else {
      const key = token.slice(2)
      const next = rest[i + 1]
      if (!next || next.startsWith("--")) {
        flags[key] = true
      } else {
        flags[key] = next
        i++
      }
    }
  }
  return { command, flags }
}

function requireStringFlag(
  flags: Record<string, string | boolean>,
  name: string,
  envFallback?: string
): string {
  const val = flags[name]
  if (typeof val === "string" && val.length > 0) return val
  if (envFallback && envFallback.length > 0) return envFallback
  throw new BackupRestoreError("INVALID_CLI_ARGS", `Missing --${name}`)
}

function optionalStringFlag(
  flags: Record<string, string | boolean>,
  name: string
): string | undefined {
  const val = flags[name]
  return typeof val === "string" && val.length > 0 ? val : undefined
}

export async function runCli(argv: string[]): Promise<number> {
  const { command, flags } = parseCliFlags(argv)
  if (command === "backup") {
    const databaseUrl = requireStringFlag(
      flags,
      "database-url",
      process.env.DATABASE_URL
    )
    const privateFileRoot = requireStringFlag(
      flags,
      "private-file-root",
      process.env.PRIVATE_FILES_ROOT
    )
    const outputDir = requireStringFlag(flags, "output-dir")
    const result = await backupLocalState({
      databaseUrl,
      privateFileRoot,
      outputDir,
      pgDumpBin: optionalStringFlag(flags, "pg-dump-bin"),
      allowScratchOutput: flags["allow-scratch-output"] === true,
    })
    console.log(
      JSON.stringify({
        ok: true,
        action: "backup",
        outputDir: result.outputDir,
        manifestSha256: result.manifest.manifestSha256,
        dump: result.manifest.dump,
        privateFileCount: result.manifest.privateFiles.totalCount,
        privateFileBytes: result.manifest.privateFiles.totalBytes,
      })
    )
    return 0
  }

  if (command === "restore") {
    const backupDir = requireStringFlag(flags, "backup-dir")
    const targetDatabaseUrl = requireStringFlag(flags, "target-database-url")
    const targetPrivateFileRoot = requireStringFlag(
      flags,
      "target-private-file-root"
    )
    const result = await restoreLocalState({
      backupDir,
      targetDatabaseUrl,
      targetPrivateFileRoot,
      sourceDatabaseUrl: optionalStringFlag(flags, "source-database-url"),
      sourcePrivateFileRoot: optionalStringFlag(
        flags,
        "source-private-file-root"
      ),
      pgRestoreBin: optionalStringFlag(flags, "pg-restore-bin"),
      psqlBin: optionalStringFlag(flags, "psql-bin"),
      allowScratchTarget: flags["allow-scratch-target"] === true,
    })
    console.log(
      JSON.stringify({
        ok: result.report.ok,
        action: "restore",
        report: result.report,
      })
    )
    return result.report.ok ? 0 : 1
  }

  if (command === "verify") {
    const backupDir = requireStringFlag(flags, "backup-dir")
    const targetDatabaseUrl = optionalStringFlag(flags, "target-database-url")
    const targetPrivateFileRoot = optionalStringFlag(
      flags,
      "target-private-file-root"
    )
    if (targetDatabaseUrl || targetPrivateFileRoot) {
      if (!targetDatabaseUrl || !targetPrivateFileRoot) {
        throw new BackupRestoreError(
          "INVALID_CLI_ARGS",
          "verify with target requires both --target-database-url and --target-private-file-root"
        )
      }
      const report = await verifyRestoredState({
        backupDir,
        targetDatabaseUrl,
        targetPrivateFileRoot,
      })
      console.log(JSON.stringify(report))
      return report.ok ? 0 : 1
    }
    const manifest = await verifyBackupArchive(backupDir)
    console.log(
      JSON.stringify({
        ok: true,
        action: "verify-archive",
        manifestSha256: manifest.manifestSha256,
        dump: manifest.dump,
        privateFileCount: manifest.privateFiles.totalCount,
      })
    )
    return 0
  }

  throw new BackupRestoreError(
    "INVALID_CLI_ARGS",
    "Usage: local-backup-restore.ts <backup|restore|verify> [options]"
  )
}

const isDirectExecution =
  !process.env.VITEST &&
  Boolean(process.argv[1]) &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectExecution) {
  runCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code
    })
    .catch((error: unknown) => {
      const code =
        error instanceof BackupRestoreError
          ? error.code
          : "BACKUP_RESTORE_FAILED"
      const message = redactSecrets(
        error instanceof Error ? error.message : "Operation failed"
      )
      console.error(JSON.stringify({ ok: false, code, message }))
      process.exitCode = 1
    })
}
