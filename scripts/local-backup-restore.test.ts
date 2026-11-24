// @vitest-environment node
import { createHash, randomUUID } from "node:crypto"
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  BackupRestoreError,
  backupLocalState,
  parseLoopbackDatabaseUrl,
  redactSecrets,
  restoreLocalState,
  runCli,
  verifyBackupArchive,
  verifyRestoredState,
  type BackupManifest,
  type ParsedLoopbackDatabase,
  type PgQueryClient,
} from "./local-backup-restore"

const createdTempDirs: string[] = []

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  const real = await realpath(dir)
  createdTempDirs.push(real)
  return real
}

afterEach(async () => {
  while (createdTempDirs.length > 0) {
    const dir = createdTempDirs.pop()!
    await rm(dir, { recursive: true, force: true })
  }
})

function sha256Hex(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex")
}

type FakeTableData = {
  PurchaseRecord: Array<{ purchasePrice: string; listedPrice: string | null }>
  PurchasePayment: Array<{ amount: string; direction: "IN" | "OUT" }>
  VehicleCost: Array<{ amount: string }>
  CostPayment: Array<{ amount: string; direction: "IN" | "OUT" }>
  Disposal: Array<{ proceeds: string; netLoss: string }>
  DisposalReceipt: Array<{ amount: string; direction: "IN" | "OUT" }>
  CycleBasisVersion: Array<{ total: string }>
  LeasePurchaseDetail: Array<{ amount: string; cashToSeller: string }>
  Attachment: Array<{
    id: string
    finalKey: string
    sha256: string
    size: number
  }>
  AuditEntry: Array<{ id: string }>
}

type FakeDbCluster = Map<string, FakeTableData | null>

function emptyFakeDb(): FakeTableData {
  return {
    PurchaseRecord: [],
    PurchasePayment: [],
    VehicleCost: [],
    CostPayment: [],
    Disposal: [],
    DisposalReceipt: [],
    CycleBasisVersion: [],
    LeasePurchaseDetail: [],
    Attachment: [],
    AuditEntry: [],
  }
}

function createFakePgClientFactory(
  cluster: FakeDbCluster
): (db: ParsedLoopbackDatabase) => PgQueryClient {
  return (db: ParsedLoopbackDatabase): PgQueryClient => ({
    async connect() {
      if (!cluster.has(db.dbName)) {
        throw new Error(`database "${db.dbName}" does not exist`)
      }
    },
    async query<T extends Record<string, unknown>>(
      sql: string,
      params?: unknown[]
    ): Promise<{ rows: T[]; rowCount: number | null }> {
      const schemaState = cluster.get(db.dbName) ?? null
      if (sql.includes("FROM information_schema.schemata")) {
        const schemaName = params?.[0]
        if (schemaName === "vamotors" && schemaState !== null) {
          return {
            rows: [{ schema_name: "vamotors" } as unknown as T],
            rowCount: 1,
          }
        }
        return { rows: [], rowCount: 0 }
      }

      if (
        sql.includes("FROM information_schema.tables") &&
        !sql.includes("+")
      ) {
        if (!schemaState) return { rows: [], rowCount: 0 }
        const names = Object.keys(schemaState).sort()
        return {
          rows: names.map((table_name) => ({ table_name }) as unknown as T),
          rowCount: names.length,
        }
      }

      if (sql.includes("information_schema.routines")) {
        const count = schemaState ? Object.keys(schemaState).length : 0
        return {
          rows: [{ count: String(count) } as unknown as T],
          rowCount: 1,
        }
      }

      if (sql.startsWith('DROP SCHEMA "vamotors"')) {
        cluster.set(db.dbName, null)
        return { rows: [], rowCount: 0 }
      }

      if (!schemaState) {
        throw new Error('schema "vamotors" does not exist')
      }

      if (sql.startsWith("SELECT COUNT(*)::text AS count FROM")) {
        const match = /"vamotors"\."([^"]+)"/.exec(sql)
        const table = match?.[1] as keyof FakeTableData | undefined
        const rows = table ? schemaState[table] : []
        return {
          rows: [{ count: String(rows.length) } as unknown as T],
          rowCount: 1,
        }
      }

      if (sql.includes('FROM "vamotors"."Attachment"')) {
        const rows = [...schemaState.Attachment].sort(
          (a, b) =>
            a.finalKey.localeCompare(b.finalKey) || a.id.localeCompare(b.id)
        )
        return {
          rows: rows as unknown as T[],
          rowCount: rows.length,
        }
      }

      const sumBigInt = (values: string[]) =>
        values.reduce((acc, v) => acc + BigInt(v), BigInt(0)).toString()

      if (sql.includes('SUM("purchasePrice")')) {
        return {
          rows: [
            {
              total: sumBigInt(
                schemaState.PurchaseRecord.map((r) => r.purchasePrice)
              ),
            } as unknown as T,
          ],
          rowCount: 1,
        }
      }
      if (sql.includes('SUM("listedPrice")')) {
        return {
          rows: [
            {
              total: sumBigInt(
                schemaState.PurchaseRecord.flatMap((r) =>
                  r.listedPrice ? [r.listedPrice] : []
                )
              ),
            } as unknown as T,
          ],
          rowCount: 1,
        }
      }
      if (
        sql.includes('"PurchasePayment"') &&
        sql.includes("CASE WHEN direction")
      ) {
        return {
          rows: [
            {
              total: schemaState.PurchasePayment.reduce(
                (acc, p) =>
                  acc +
                  (p.direction === "IN" ? BigInt(p.amount) : -BigInt(p.amount)),
                BigInt(0)
              ).toString(),
            } as unknown as T,
          ],
          rowCount: 1,
        }
      }
      if (sql.includes('"PurchasePayment"')) {
        return {
          rows: [
            {
              total: sumBigInt(
                schemaState.PurchasePayment.map((p) => p.amount)
              ),
            } as unknown as T,
          ],
          rowCount: 1,
        }
      }
      if (sql.includes('"VehicleCost"')) {
        return {
          rows: [
            {
              total: sumBigInt(schemaState.VehicleCost.map((c) => c.amount)),
            } as unknown as T,
          ],
          rowCount: 1,
        }
      }
      if (
        sql.includes('"CostPayment"') &&
        sql.includes("CASE WHEN direction")
      ) {
        return {
          rows: [
            {
              total: schemaState.CostPayment.reduce(
                (acc, p) =>
                  acc +
                  (p.direction === "IN" ? BigInt(p.amount) : -BigInt(p.amount)),
                BigInt(0)
              ).toString(),
            } as unknown as T,
          ],
          rowCount: 1,
        }
      }
      if (sql.includes('"CostPayment"')) {
        return {
          rows: [
            {
              total: sumBigInt(schemaState.CostPayment.map((p) => p.amount)),
            } as unknown as T,
          ],
          rowCount: 1,
        }
      }
      if (sql.includes('"Disposal"') && sql.includes("SUM(proceeds)")) {
        return {
          rows: [
            {
              total: sumBigInt(schemaState.Disposal.map((d) => d.proceeds)),
            } as unknown as T,
          ],
          rowCount: 1,
        }
      }
      if (sql.includes('"Disposal"') && sql.includes('SUM("netLoss")')) {
        return {
          rows: [
            {
              total: sumBigInt(schemaState.Disposal.map((d) => d.netLoss)),
            } as unknown as T,
          ],
          rowCount: 1,
        }
      }
      if (sql.includes('"DisposalReceipt"')) {
        return {
          rows: [
            {
              total: schemaState.DisposalReceipt.reduce(
                (acc, p) =>
                  acc +
                  (p.direction === "IN" ? BigInt(p.amount) : -BigInt(p.amount)),
                BigInt(0)
              ).toString(),
            } as unknown as T,
          ],
          rowCount: 1,
        }
      }
      if (sql.includes('"CycleBasisVersion"')) {
        return {
          rows: [
            {
              total: sumBigInt(
                schemaState.CycleBasisVersion.map((b) => b.total)
              ),
            } as unknown as T,
          ],
          rowCount: 1,
        }
      }
      if (
        sql.includes('"LeasePurchaseDetail"') &&
        sql.includes("SUM(amount)")
      ) {
        return {
          rows: [
            {
              total: sumBigInt(
                schemaState.LeasePurchaseDetail.map((l) => l.amount)
              ),
            } as unknown as T,
          ],
          rowCount: 1,
        }
      }
      if (
        sql.includes('"LeasePurchaseDetail"') &&
        sql.includes('SUM("cashToSeller")')
      ) {
        return {
          rows: [
            {
              total: sumBigInt(
                schemaState.LeasePurchaseDetail.map((l) => l.cashToSeller)
              ),
            } as unknown as T,
          ],
          rowCount: 1,
        }
      }

      throw new Error(`Unhandled fake SQL: ${sql}`)
    },
    async end() {},
  })
}

async function createFakePgBins(
  dir: string,
  cluster: FakeDbCluster,
  sourceSnapshotFile: string
): Promise<{ pgDumpBin: string; pgRestoreBin: string }> {
  const pgDumpBin = join(dir, "fake-pg-dump.mjs")
  const pgRestoreBin = join(dir, "fake-pg-restore.mjs")

  const dumpScript = `#!/usr/bin/env node
import { copyFileSync, writeFileSync } from "node:fs"
const args = process.argv.slice(2)
const fileIdx = args.indexOf("--file")
const outFile = fileIdx !== -1 ? args[fileIdx + 1] : ""
if (!outFile) process.exit(2)
const payload = JSON.stringify({
  db: process.env.PGDATABASE,
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  snap: ${JSON.stringify(sourceSnapshotFile)}
})
writeFileSync(outFile, payload, "utf8")
`
  await writeFile(pgDumpBin, dumpScript, { mode: 0o755 })
  await chmod(pgDumpBin, 0o755)

  // Restore writes a sentinel marker file and populates the target DB in cluster
  // via a state file read by the test helper wrapper.
  const restoreScript = `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs"
const args = process.argv.slice(2)
const dumpPath = args[args.length - 1]
const parsed = JSON.parse(readFileSync(dumpPath, "utf8"))
const dbIdx = args.indexOf("--dbname")
const targetDb = dbIdx !== -1 ? args[dbIdx + 1] : process.env.PGDATABASE
writeFileSync(parsed.snap, JSON.stringify({ targetDb, restoredFrom: parsed.db }))
`
  await writeFile(pgRestoreBin, restoreScript, { mode: 0o755 })
  await chmod(pgRestoreBin, 0o755)

  // Keep cluster reference used to satisfy lint while test syncs state
  void cluster
  return { pgDumpBin, pgRestoreBin }
}

describe("local-backup-restore safety guards", () => {
  it("parses valid loopback URLs and rejects remote/malformed URLs", () => {
    const parsedA = parseLoopbackDatabaseUrl(
      "postgresql://vamotors_runtime:secret123@localhost/vamotors_local?sslmode=disable"
    )
    const parsedB = parseLoopbackDatabaseUrl(
      "postgres://vamotors_migrator:other456@127.0.0.1:5432/vamotors_local?sslmode=require"
    )
    expect(parsedA.normalizedTargetKey).toBe("127.0.0.1:5432/vamotors_local")
    expect(parsedB.normalizedTargetKey).toBe("127.0.0.1:5432/vamotors_local")
    expect(parsedA.redactedLabel).toBe("127.0.0.1:5432/vamotors_local")
    expect(JSON.stringify(parsedA.redactedLabel)).not.toContain("secret123")

    for (const badUrl of [
      "postgresql://user:pass@db.neon.tech:5432/vamotors?sslmode=require",
      "postgresql://user:pass@10.0.1.24:5432/vamotors?sslmode=disable",
      "postgresql://user:pass@[::1]:5432/vamotors?sslmode=disable",
      "mysql://user:pass@127.0.0.1:3306/vamotors",
      "postgresql://user:pass@127.0.0.1:5432/vamotors?options=-c%20search_path=public",
      "postgresql://user:pass@127.0.0.1:5432/",
      "not-a-url",
    ]) {
      expect(() => parseLoopbackDatabaseUrl(badUrl)).toThrow(BackupRestoreError)
    }
  })

  it("redacts credentials from URLs, PGPASSWORD, and explicit secrets", () => {
    const raw =
      "Error connecting to postgresql://vamotors_admin:SuperSecretPass99@127.0.0.1:5432/vamotors_local with PGPASSWORD=SuperSecretPass99"
    const cleaned = redactSecrets(raw, ["SuperSecretPass99"])
    expect(cleaned).not.toContain("SuperSecretPass99")
    expect(cleaned).toContain("[REDACTED]")
  })

  it("rejects remote DB host in backupLocalState, restoreLocalState, and verifyRestoredState", async () => {
    const dir = await makeTempDir("vamotors-remote-")
    const privateRoot = join(dir, "private")
    const outDir = join(dir, "out")
    await mkdir(privateRoot, { mode: 0o700 })

    await expect(
      backupLocalState({
        databaseUrl:
          "postgresql://u:p@remote.db.example:5432/vamotors?sslmode=require",
        privateFileRoot: privateRoot,
        outputDir: outDir,
      })
    ).rejects.toMatchObject({ code: "REMOTE_DATABASE_FORBIDDEN" })

    await expect(
      restoreLocalState({
        backupDir: outDir,
        targetDatabaseUrl:
          "postgresql://u:p@192.168.1.10:5432/vamotors_restore?sslmode=disable",
        targetPrivateFileRoot: join(dir, "restore-files"),
      })
    ).rejects.toMatchObject({ code: "REMOTE_DATABASE_FORBIDDEN" })

    await expect(
      verifyRestoredState({
        backupDir: outDir,
        targetDatabaseUrl:
          "postgresql://u:p@prod.db.internal:5432/vamotors_restore?sslmode=require",
        targetPrivateFileRoot: join(dir, "restore-files"),
      })
    ).rejects.toMatchObject({ code: "REMOTE_DATABASE_FORBIDDEN" })
  })

  it("rejects outputDir inside privateFileRoot or inside a Git repo working tree", async () => {
    const dir = await makeTempDir("vamotors-outdir-")
    const privateRoot = join(dir, "private")
    await mkdir(privateRoot, { mode: 0o700 })
    const dbUrl =
      "postgresql://u:SecretPass!@127.0.0.1:5432/vamotors_local?sslmode=disable"

    // Inside privateFileRoot
    await expect(
      backupLocalState({
        databaseUrl: dbUrl,
        privateFileRoot: privateRoot,
        outputDir: join(privateRoot, "backup-nested"),
      })
    ).rejects.toMatchObject({ code: "UNSAFE_OUTPUT_DIR" })

    // Equal to privateFileRoot
    await expect(
      backupLocalState({
        databaseUrl: dbUrl,
        privateFileRoot: privateRoot,
        outputDir: privateRoot,
      })
    ).rejects.toMatchObject({ code: "UNSAFE_OUTPUT_DIR" })

    // Inside simulated Git working tree
    const fakeRepo = join(dir, "repo")
    await mkdir(join(fakeRepo, ".git"), { recursive: true })
    await expect(
      backupLocalState({
        databaseUrl: dbUrl,
        privateFileRoot: privateRoot,
        outputDir: join(fakeRepo, "backups", "snap1"),
      })
    ).rejects.toMatchObject({ code: "UNSAFE_OUTPUT_DIR" })

    // Inside actual repo working tree (process.cwd())
    await expect(
      backupLocalState({
        databaseUrl: dbUrl,
        privateFileRoot: privateRoot,
        outputDir: join(process.cwd(), "unwanted-backup-dir"),
      })
    ).rejects.toMatchObject({ code: "UNSAFE_OUTPUT_DIR" })
  })

  it("rejects symlinks that escape privateFileRoot (and dangling symlinks)", async () => {
    const dir = await makeTempDir("vamotors-symlink-")
    const privateRoot = join(dir, "private")
    const outsideSecret = join(dir, "outside.txt")
    const outDir = join(dir, "backup")
    await mkdir(privateRoot, { mode: 0o700 })
    await writeFile(outsideSecret, "secret-outside-root", { mode: 0o600 })
    await symlink(outsideSecret, join(privateRoot, "escape-link.txt"))

    await expect(
      backupLocalState({
        databaseUrl:
          "postgresql://u:SecretPass!@127.0.0.1:5432/vamotors_local?sslmode=disable",
        privateFileRoot: privateRoot,
        outputDir: outDir,
      })
    ).rejects.toMatchObject({ code: "SYMLINK_ESCAPE" })

    // Dangling symlink pointing outside root
    const dir2 = await makeTempDir("vamotors-dangling-")
    const privateRoot2 = join(dir2, "private")
    await mkdir(privateRoot2, { mode: 0o700 })
    await symlink(
      join(dir2, "nonexistent-outside"),
      join(privateRoot2, "dangling")
    )

    await expect(
      backupLocalState({
        databaseUrl:
          "postgresql://u:SecretPass!@127.0.0.1:5432/vamotors_local?sslmode=disable",
        privateFileRoot: privateRoot2,
        outputDir: join(dir2, "backup"),
      })
    ).rejects.toMatchObject({ code: "SYMLINK_ESCAPE" })
  })
})

describe("local-backup-restore end-to-end snapshot, tamper detection & isolated restore", () => {
  it("backs up durable files + DB metadata, excludes transient staging, redacts secrets, and restores isolated with full reconciliation", async () => {
    const dir = await makeTempDir("vamotors-e2e-")
    const sourcePrivateRoot = join(dir, "source-private")
    const backupDir = join(dir, "backup-out")
    const targetPrivateRoot = join(dir, "target-private")
    const binsDir = join(dir, "bins")
    const restoreMarker = join(dir, "restore-marker.json")

    await mkdir(sourcePrivateRoot, { mode: 0o700 })
    await mkdir(binsDir, { mode: 0o700 })

    const envId = randomUUID()
    const intentId = randomUUID()
    const attemptId = randomUUID()
    const fileId = randomUUID()
    const finalKey = `f.${envId}.${intentId}.${attemptId}.${fileId}`
    const stageKey = `s.${envId}.${intentId}.${randomUUID()}`
    const pendingKey = `p.${randomUUID()}.${finalKey}`

    const pdfBytes = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n")
    const nestedBytes = Buffer.from("vehicle-photo-webp-bytes")
    await writeFile(join(sourcePrivateRoot, finalKey), pdfBytes, {
      mode: 0o600,
    })
    await mkdir(join(sourcePrivateRoot, "invoices", "2026"), {
      recursive: true,
      mode: 0o700,
    })
    await writeFile(
      join(sourcePrivateRoot, "invoices", "2026", "inv-001.webp"),
      nestedBytes,
      { mode: 0o600 }
    )

    // Transient files/dirs that MUST be excluded from durable snapshot
    await writeFile(join(sourcePrivateRoot, stageKey), "transient-stage", {
      mode: 0o600,
    })
    await writeFile(join(sourcePrivateRoot, pendingKey), "transient-pending", {
      mode: 0o600,
    })
    await mkdir(join(sourcePrivateRoot, "staging"), { mode: 0o700 })
    await writeFile(
      join(sourcePrivateRoot, "staging", "upload.part"),
      "partial"
    )
    await mkdir(join(sourcePrivateRoot, "tmp"), { mode: 0o700 })
    await writeFile(join(sourcePrivateRoot, "tmp", "scratch.bin"), "scratch")

    const sourceData = emptyFakeDb()
    sourceData.PurchaseRecord.push(
      { purchasePrice: "250000000", listedPrice: "295000000" },
      { purchasePrice: "180000000", listedPrice: null }
    )
    sourceData.PurchasePayment.push(
      { amount: "250000000", direction: "OUT" },
      { amount: "10000000", direction: "IN" }
    )
    sourceData.VehicleCost.push({ amount: "1250000" })
    sourceData.CostPayment.push({ amount: "1250000", direction: "OUT" })
    sourceData.CycleBasisVersion.push({ total: "251250000" })
    sourceData.Attachment.push({
      id: randomUUID(),
      finalKey,
      sha256: sha256Hex(pdfBytes),
      size: pdfBytes.length,
    })
    sourceData.AuditEntry.push({ id: randomUUID() }, { id: randomUUID() })

    const cluster: FakeDbCluster = new Map([
      ["vamotors_local", sourceData],
      ["vamotors_restore", null],
    ])
    const pgClientFactory = createFakePgClientFactory(cluster)
    const { pgDumpBin, pgRestoreBin } = await createFakePgBins(
      binsDir,
      cluster,
      restoreMarker
    )

    // Wrap pgRestoreBin behavior by having a tiny script + synchronizing cluster on restore
    const syncPgRestoreBin = join(binsDir, "sync-pg-restore.mjs")
    await writeFile(
      syncPgRestoreBin,
      `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs"
const args = process.argv.slice(2)
const dumpPath = args[args.length - 1]
const parsed = JSON.parse(readFileSync(dumpPath, "utf8"))
const dbIdx = args.indexOf("--dbname")
const targetDb = dbIdx !== -1 ? args[dbIdx + 1] : process.env.PGDATABASE
if (!process.env.PGPASSWORD) process.exit(3)
writeFileSync(${JSON.stringify(restoreMarker)}, JSON.stringify({ targetDb, from: parsed.db }))
`,
      { mode: 0o755 }
    )
    await chmod(syncPgRestoreBin, 0o755)
    void pgRestoreBin

    const sourceSecret = "SourceSecretPassword_98765"
    const targetSecret = "TargetSecretPassword_12345"
    const sourceUrl = `postgresql://vamotors_migrator:${sourceSecret}@localhost:5432/vamotors_local?sslmode=disable`
    const targetUrl = `postgresql://vamotors_restore_admin:${targetSecret}@127.0.0.1:5432/vamotors_restore?sslmode=disable`

    const { manifest } = await backupLocalState({
      databaseUrl: sourceUrl,
      privateFileRoot: sourcePrivateRoot,
      outputDir: backupDir,
      pgDumpBin,
      pgClientFactory,
    })

    // Check manifest contents & zero credential leakage
    const manifestRaw = await readFile(join(backupDir, "manifest.json"), "utf8")
    expect(manifestRaw).not.toContain(sourceSecret)
    expect(manifestRaw).not.toContain("vamotors_migrator")
    expect(manifestRaw).not.toContain("postgresql://")
    expect(manifest.privateFiles.totalCount).toBe(2)
    expect(manifest.privateFiles.files.map((f) => f.relativePath)).toEqual([
      finalKey,
      "invoices/2026/inv-001.webp",
    ])
    expect(manifest.database.financialTotals.purchasePriceSum).toBe("430000000")
    expect(manifest.database.financialTotals.purchasePaymentNetSum).toBe(
      "-240000000"
    )
    expect(manifest.database.tableRowCounts.AuditEntry).toBe(2)
    expect(manifest.database.attachments).toHaveLength(1)

    // Hard safety guards before restore:
    // 1) Refuse overwrite of source DB (even localhost vs 127.0.0.1)
    await expect(
      restoreLocalState({
        backupDir,
        targetDatabaseUrl: `postgresql://other:${targetSecret}@127.0.0.1/vamotors_local?sslmode=disable`,
        targetPrivateFileRoot: targetPrivateRoot,
        sourceDatabaseUrl: sourceUrl,
        sourcePrivateFileRoot: sourcePrivateRoot,
        pgRestoreBin: syncPgRestoreBin,
        pgClientFactory,
      })
    ).rejects.toMatchObject({ code: "SOURCE_OVERWRITE_FORBIDDEN" })

    // 2) Refuse overlapping/equal sourcePrivateFileRoot
    await expect(
      restoreLocalState({
        backupDir,
        targetDatabaseUrl: targetUrl,
        targetPrivateFileRoot: join(sourcePrivateRoot, "nested-restore"),
        sourceDatabaseUrl: sourceUrl,
        sourcePrivateFileRoot: sourcePrivateRoot,
        pgRestoreBin: syncPgRestoreBin,
        pgClientFactory,
      })
    ).rejects.toMatchObject({ code: "SOURCE_OVERWRITE_FORBIDDEN" })

    // 3) Refuse non-empty targetPrivateFileRoot
    await mkdir(targetPrivateRoot, { mode: 0o700 })
    await writeFile(join(targetPrivateRoot, "existing.txt"), "do-not-clobber")
    await expect(
      restoreLocalState({
        backupDir,
        targetDatabaseUrl: targetUrl,
        targetPrivateFileRoot: targetPrivateRoot,
        sourceDatabaseUrl: sourceUrl,
        sourcePrivateFileRoot: sourcePrivateRoot,
        pgRestoreBin: syncPgRestoreBin,
        pgClientFactory,
      })
    ).rejects.toMatchObject({ code: "TARGET_NOT_EMPTY" })
    await rm(join(targetPrivateRoot, "existing.txt"))

    // 4) Refuse non-empty target DB schema
    cluster.set("vamotors_restore", emptyFakeDb())
    await expect(
      restoreLocalState({
        backupDir,
        targetDatabaseUrl: targetUrl,
        targetPrivateFileRoot: targetPrivateRoot,
        sourceDatabaseUrl: sourceUrl,
        sourcePrivateFileRoot: sourcePrivateRoot,
        pgRestoreBin: syncPgRestoreBin,
        pgClientFactory,
      })
    ).rejects.toMatchObject({ code: "TARGET_DB_NOT_EMPTY" })
    cluster.set("vamotors_restore", null)

    // Simulate pg_restore populating vamotors_restore once syncPgRestoreBin runs
    const restoringFactory = (db: ParsedLoopbackDatabase): PgQueryClient => {
      if (db.dbName === "vamotors_restore" && existsSync(restoreMarker)) {
        cluster.set("vamotors_restore", structuredClone(sourceData))
      }
      return pgClientFactory(db)
    }

    const restored = await restoreLocalState({
      backupDir,
      targetDatabaseUrl: targetUrl,
      targetPrivateFileRoot: targetPrivateRoot,
      sourceDatabaseUrl: sourceUrl,
      sourcePrivateFileRoot: sourcePrivateRoot,
      pgRestoreBin: syncPgRestoreBin,
      pgClientFactory: restoringFactory,
    })

    expect(restored.report.ok).toBe(true)
    expect(restored.report.privateFiles.matched).toBe(true)
    expect(restored.report.privateFiles.restoredCount).toBe(2)
    expect(restored.report.database.matched).toBe(true)
    expect(restored.report.targetDatabaseRedacted).toBe(
      "127.0.0.1:5432/vamotors_restore"
    )
    const reportJson = JSON.stringify(restored.report)
    expect(reportJson).not.toContain(sourceSecret)
    expect(reportJson).not.toContain(targetSecret)

    // Check 0700 / 0600 permissions and restored bytes
    const targetRootStat = await lstat(targetPrivateRoot)
    expect(targetRootStat.mode & 0o777).toBe(0o700)
    const restoredPdfStat = await lstat(join(targetPrivateRoot, finalKey))
    expect(restoredPdfStat.mode & 0o777).toBe(0o600)
    expect(await readFile(join(targetPrivateRoot, finalKey))).toEqual(pdfBytes)
    expect(
      await readFile(
        join(targetPrivateRoot, "invoices", "2026", "inv-001.webp")
      )
    ).toEqual(nestedBytes)
    expect(await readdir(targetPrivateRoot)).toEqual(
      expect.arrayContaining([finalKey, "invoices"])
    )

    // Detect post-restore drift in verifyRestoredState
    await writeFile(
      join(targetPrivateRoot, "invoices", "2026", "inv-001.webp"),
      "corrupted-bytes",
      { mode: 0o600 }
    )
    const driftReport = await verifyRestoredState({
      backupDir,
      targetDatabaseUrl: targetUrl,
      targetPrivateFileRoot: targetPrivateRoot,
      pgClientFactory: restoringFactory,
    })
    expect(driftReport.ok).toBe(false)
    expect(driftReport.privateFiles.matched).toBe(false)
    expect(driftReport.privateFiles.mismatchedFiles).toHaveLength(1)
  })

  it("rejects tampered database.dump, tampered private files, and tampered manifest.json before touching target", async () => {
    const dir = await makeTempDir("vamotors-tamper-")
    const sourcePrivateRoot = join(dir, "source-private")
    const backupDir = join(dir, "backup-out")
    const targetPrivateRoot = join(dir, "target-private")
    const binsDir = join(dir, "bins")
    await mkdir(sourcePrivateRoot, { mode: 0o700 })
    await mkdir(binsDir, { mode: 0o700 })

    const docPath = join(sourcePrivateRoot, "doc.txt")
    await writeFile(docPath, "immutable-content", { mode: 0o600 })

    const pgDumpBin = join(binsDir, "dump.mjs")
    await writeFile(
      pgDumpBin,
      `#!/usr/bin/env node
import { writeFileSync } from "node:fs"
const args = process.argv.slice(2)
writeFileSync(args[args.indexOf("--file") + 1], "CUSTOM_DUMP_BYTES")
`,
      { mode: 0o755 }
    )
    await chmod(pgDumpBin, 0o755)

    const cluster: FakeDbCluster = new Map([
      ["vamotors_local", emptyFakeDb()],
      ["vamotors_restore", null],
    ])
    const pgClientFactory = createFakePgClientFactory(cluster)

    await backupLocalState({
      databaseUrl:
        "postgresql://u:SecretPass1@127.0.0.1:5432/vamotors_local?sslmode=disable",
      privateFileRoot: sourcePrivateRoot,
      outputDir: backupDir,
      pgDumpBin,
      pgClientFactory,
    })

    // Verify clean archive passes
    const valid = await verifyBackupArchive(backupDir)
    expect(valid.privateFiles.totalCount).toBe(1)

    // 1) Tamper backed-up private file
    const backedUpDoc = join(backupDir, "files", "doc.txt")
    const origDoc = await readFile(backedUpDoc)
    await writeFile(backedUpDoc, "tampered-content", { mode: 0o600 })
    await expect(
      restoreLocalState({
        backupDir,
        targetDatabaseUrl:
          "postgresql://u:SecretPass2@127.0.0.1:5432/vamotors_restore?sslmode=disable",
        targetPrivateFileRoot: targetPrivateRoot,
        pgClientFactory,
      })
    ).rejects.toMatchObject({ code: "INTEGRITY_CHECK_FAILED" })
    // Ensure targetPrivateFileRoot was not even created
    expect(existsSync(targetPrivateRoot)).toBe(false)
    await writeFile(backedUpDoc, origDoc, { mode: 0o600 })

    // 2) Tamper database.dump
    const dumpPath = join(backupDir, "database.dump")
    const origDump = await readFile(dumpPath)
    await writeFile(dumpPath, "TAMPERED_DUMP", { mode: 0o600 })
    await expect(verifyBackupArchive(backupDir)).rejects.toMatchObject({
      code: "INTEGRITY_CHECK_FAILED",
    })
    await writeFile(dumpPath, origDump, { mode: 0o600 })

    // 3) Tamper manifest.json without updating manifestSha256
    const manifestPath = join(backupDir, "manifest.json")
    const parsed = JSON.parse(
      await readFile(manifestPath, "utf8")
    ) as BackupManifest
    parsed.database.financialTotals.purchasePriceSum = "999999"
    await writeFile(manifestPath, JSON.stringify(parsed, null, 2))
    await expect(verifyBackupArchive(backupDir)).rejects.toMatchObject({
      code: "INTEGRITY_CHECK_FAILED",
    })
  })

  it("supports CLI verify subcommand on archive without secrets", async () => {
    const dir = await makeTempDir("vamotors-cli-")
    const sourcePrivateRoot = join(dir, "source-private")
    const backupDir = join(dir, "backup-out")
    const binsDir = join(dir, "bins")
    await mkdir(sourcePrivateRoot, { mode: 0o700 })
    await mkdir(binsDir, { mode: 0o700 })
    await writeFile(join(sourcePrivateRoot, "a.bin"), "alpha", { mode: 0o600 })

    const pgDumpBin = join(binsDir, "dump.mjs")
    await writeFile(
      pgDumpBin,
      `#!/usr/bin/env node
import { writeFileSync } from "node:fs"
const args = process.argv.slice(2)
writeFileSync(args[args.indexOf("--file") + 1], "DUMP_OK")
`,
      { mode: 0o755 }
    )
    await chmod(pgDumpBin, 0o755)

    const cluster: FakeDbCluster = new Map([["vamotors_local", emptyFakeDb()]])
    await backupLocalState({
      databaseUrl:
        "postgresql://u:SecretPass1@127.0.0.1:5432/vamotors_local?sslmode=disable",
      privateFileRoot: sourcePrivateRoot,
      outputDir: backupDir,
      pgDumpBin,
      pgClientFactory: createFakePgClientFactory(cluster),
    })

    const logs: string[] = []
    const origLog = console.log
    console.log = (msg?: unknown) => logs.push(String(msg))
    try {
      const code = await runCli(["verify", "--backup-dir", backupDir])
      expect(code).toBe(0)
      expect(logs).toHaveLength(1)
      const parsed = JSON.parse(logs[0]) as { ok: boolean; action: string }
      expect(parsed.ok).toBe(true)
      expect(parsed.action).toBe("verify-archive")
      expect(logs[0]).not.toContain("SecretPass1")
    } finally {
      console.log = origLog
    }
  })
})

function findRealPostgresServerBins(): string | null {
  const candidates = [
    process.env.PG_BIN,
    "/opt/homebrew/opt/postgresql@18/bin",
    "/usr/local/opt/postgresql@18/bin",
    "/usr/lib/postgresql/18/bin",
  ].filter((p): p is string => Boolean(p))
  for (const dir of candidates) {
    if (
      existsSync(join(dir, "postgres")) &&
      existsSync(join(dir, "initdb")) &&
      existsSync(join(dir, "pg_ctl"))
    ) {
      return dir
    }
  }
  return null
}

const realPgBins = findRealPostgresServerBins()

describe.runIf(Boolean(realPgBins))(
  "local-backup-restore real PostgreSQL round-trip",
  () => {
    it("dumps real vamotors schema + rows via pg_dump and restores isolated via pg_restore", async () => {
      const root = await makeTempDir("vamotors-realpg-")
      const clusterDir = join(root, "pgdata")
      const pwFile = join(root, "pw")
      const sourceFiles = join(root, "source-files")
      const backupDir = join(root, "backup")
      const targetFiles = join(root, "target-files")
      await mkdir(sourceFiles, { mode: 0o700 })
      const pgPass = "realPgTestPass_2026"
      await writeFile(pwFile, pgPass, { mode: 0o600 })

      const bin = realPgBins!
      const initRes = spawnSync(
        join(bin, "initdb"),
        [
          "-D",
          clusterDir,
          "-U",
          "postgres",
          "-A",
          "scram-sha-256",
          "--pwfile",
          pwFile,
          "--encoding=UTF8",
          "--locale=C",
        ],
        { stdio: "pipe" }
      )
      expect(initRes.status).toBe(0)

      // Pick an ephemeral port using python/node? Use 55439 or dynamic port
      const port = 55439
      await writeFile(
        join(clusterDir, "postgresql.auto.conf"),
        `listen_addresses = '127.0.0.1'\nport = ${port}\nunix_socket_directories = ''\nssl = off\n`,
        { mode: 0o600 }
      )
      const startRes = spawnSync(
        join(bin, "pg_ctl"),
        ["-D", clusterDir, "-l", join(root, "pg.log"), "-w", "start"],
        { stdio: "pipe" }
      )
      expect(startRes.status).toBe(0)

      try {
        const adminEnv = {
          ...process.env,
          PGHOST: "127.0.0.1",
          PGPORT: String(port),
          PGUSER: "postgres",
          PGPASSWORD: pgPass,
          PGSSLMODE: "disable",
        }
        const mkSource = spawnSync(
          join(bin, "psql"),
          [
            "-d",
            "postgres",
            "-c",
            "CREATE DATABASE vamotors_src",
            "-c",
            "CREATE DATABASE vamotors_dst",
          ],
          { env: adminEnv, stdio: "pipe" }
        )
        expect(mkSource.status).toBe(0)

        const docBytes = Buffer.from("%PDF-1.4\n%%EOF\n")
        const docHash = sha256Hex(docBytes)
        const docKey = `f.${randomUUID()}.${randomUUID()}.${randomUUID()}.${randomUUID()}`
        await writeFile(join(sourceFiles, docKey), docBytes, { mode: 0o600 })

        const seedSql = `
          CREATE SCHEMA vamotors;
          CREATE TABLE vamotors."PurchaseRecord" (
            id uuid PRIMARY KEY,
            "purchasePrice" bigint NOT NULL,
            "listedPrice" bigint
          );
          CREATE TABLE vamotors."PurchasePayment" (
            id uuid PRIMARY KEY,
            amount bigint NOT NULL,
            direction text NOT NULL
          );
          CREATE TABLE vamotors."Attachment" (
            id uuid PRIMARY KEY,
            "finalKey" text NOT NULL UNIQUE,
            sha256 text NOT NULL,
            size integer NOT NULL
          );
          INSERT INTO vamotors."PurchaseRecord" VALUES ('${randomUUID()}', 120000000, 145000000);
          INSERT INTO vamotors."PurchasePayment" VALUES ('${randomUUID()}', 120000000, 'OUT');
          INSERT INTO vamotors."Attachment" VALUES ('${randomUUID()}', '${docKey}', '${docHash}', ${docBytes.length});
        `
        const seedRes = spawnSync(
          join(bin, "psql"),
          ["-d", "vamotors_src", "-v", "ON_ERROR_STOP=1", "-c", seedSql],
          { env: adminEnv, stdio: "pipe" }
        )
        expect(seedRes.status).toBe(0)

        const sourceUrl = `postgresql://postgres:${pgPass}@127.0.0.1:${port}/vamotors_src?sslmode=disable`
        const targetUrl = `postgresql://postgres:${pgPass}@127.0.0.1:${port}/vamotors_dst?sslmode=disable`

        const { manifest } = await backupLocalState({
          databaseUrl: sourceUrl,
          privateFileRoot: sourceFiles,
          outputDir: backupDir,
          pgDumpBin: join(bin, "pg_dump"),
        })
        expect(manifest.database.financialTotals.purchasePriceSum).toBe(
          "120000000"
        )

        const { report } = await restoreLocalState({
          backupDir,
          targetDatabaseUrl: targetUrl,
          targetPrivateFileRoot: targetFiles,
          sourceDatabaseUrl: sourceUrl,
          sourcePrivateFileRoot: sourceFiles,
          pgRestoreBin: join(bin, "pg_restore"),
        })
        expect(report.ok).toBe(true)
        expect(report.database.matched).toBe(true)
        expect(report.privateFiles.matched).toBe(true)
      } finally {
        spawnSync(
          join(bin, "pg_ctl"),
          ["-D", clusterDir, "-m", "fast", "-w", "stop"],
          {
            stdio: "pipe",
          }
        )
      }
    })
  }
)
