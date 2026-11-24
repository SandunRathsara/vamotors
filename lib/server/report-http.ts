import "server-only"
import { createHash, randomUUID } from "node:crypto"
import { crc32 } from "node:zlib"
import type { ReportKind } from "../../.planning/implementation/contracts/api"
import { authenticate, currentActor, type Actor } from "./actor"
import { database, assertEnvironment, type Tx } from "./db"
import { dashboardQuery, reportFilter, reportQuery } from "./reports"
import { boundedJSON, endpoint, noStoreJSON, sameOrigin } from "./http"
import { CommandError, fail } from "./errors"
import {
  buildReportCsv,
  formatReportCell,
  planReportPdfParts,
  reportCellValue,
  REPORT_PDF_MAX_PAGES,
} from "./report-export"
import { renderReportPdf } from "./pdf"
import { z } from "zod"
import type { ExportJob, Prisma } from "@prisma/client"
import { fileIO, privateStorage, writableStorage } from "./attachments"
import { runtimeConfig } from "./config"
import { audit } from "./audit"
import { canonical } from "./idempotency"
import { requireFields } from "./permissions"

type Part = {
  name: string
  bytes: Uint8Array
  firstRow: number
  lastRow: number
}
const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex")

// Store-only ZIP. Every entry already has its final bytes and size, so the
// central directory, checksums and manifest describe the same captured rows.
function zip(files: { name: string; bytes: Uint8Array }[]) {
  const body: Uint8Array[] = []
  const directory: Uint8Array[] = []
  let offset = 0
  for (const file of files) {
    const name = Buffer.from(file.name)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(33, 12) // 1980-01-01 DOS date
    local.writeUInt32LE(crc32(file.bytes), 14)
    local.writeUInt32LE(file.bytes.length, 18)
    local.writeUInt32LE(file.bytes.length, 22)
    local.writeUInt16LE(name.length, 26)
    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02014b50)
    entry.writeUInt16LE(20, 4)
    local.copy(entry, 6, 4)
    entry.writeUInt32LE(offset, 42)
    body.push(local, name, file.bytes)
    directory.push(entry, name)
    offset += local.length + name.length + file.bytes.length
  }
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(
    directory.reduce((size, bytes) => size + bytes.length, 0),
    12
  )
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...body, ...directory, end])
}

function download(bytes: Uint8Array, name: string, contentType: string) {
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private,no-store",
      "X-Content-Type-Options": "nosniff",
    },
  })
}

function renderExportPdf(
  part: ReturnType<typeof planReportPdfParts>[number],
  filters: Parameters<typeof planReportPdfParts>[0]["filters"],
  currency: string,
  notice: string | null | undefined,
  totals = part.totals
) {
  return renderReportPdf({
    title: part.title,
    subtitle: `Currency: ${currency}`,
    maxPages: REPORT_PDF_MAX_PAGES,
    orientation: "landscape",
    devNotice: "VA Motors | Internal report",
    dateRange: filters,
    filters: [
      ...Object.entries(filters ?? {}),
      ...(notice ? [["Coverage", notice]] : []),
    ].flatMap(([label, value]) =>
      value === undefined || label === "from" || label === "through"
        ? []
        : [{ label, value: String(value) }]
    ),
    part: {
      ordinal: part.partNumber,
      totalParts: part.totalParts || null,
      firstRow: part.firstRow,
      lastRow: part.lastRow,
      totalRows: part.totalRows,
    },
    columns: part.columns.map((column) => ({
      key: column.key,
      label: column.label,
      ...(column.format === "money" ? { align: "right" as const } : {}),
      ...(column.key === "components" || column.key === "request"
        ? { width: 4 }
        : {}),
    })),
    rows: part.rows.map((row) =>
      Object.fromEntries(
        part.columns.map((column) => [
          column.key,
          formatReportCell(
            reportCellValue(part.kind, row, column.key),
            column.format,
            column.signed,
            currency
          ),
        ])
      )
    ),
    totals: Object.entries(totals ?? {}).map(([key, value]) => ({
      label:
        part.columns.find((column) => column.totalKey === key)?.label ??
        { cashIn: "Money in", cashOut: "Money out", net: "Net movement" }[
          key
        ] ??
        key,
      value: formatReportCell(value, "money", true, currency),
    })),
  })
}

export function reportEndpoint(request: Request, fixedKind?: ReportKind) {
  return endpoint(async () => {
    const identity = await authenticate(request.headers)
    const params = new URL(request.url).searchParams
    const format = params.get("format")
    if (
      params.getAll("format").length > 1 ||
      (format !== null && !["csv", "pdf"].includes(format))
    )
      fail("INVALID_INPUT", 422)
    params.delete("format")
    if (fixedKind) {
      if (params.has("kind")) fail("INVALID_INPUT", 422)
      params.set("kind", fixedKind)
    }
    const filter = reportFilter(params)
    const snapshot = await database().$transaction(
      async (tx) => {
        await assertEnvironment(tx)
        return reportQuery(
          tx,
          await currentActor(tx, identity),
          filter,
          format !== null
        )
      },
      { isolationLevel: "RepeatableRead", timeout: 9000 }
    )
    if (!format) return noStoreJSON({ ok: true, data: snapshot })

    // The full response is derived from one transaction snapshot. Rendering
    // and packaging hold no database connection.
    const {
      kind,
      page: _page,
      pageSize: _pageSize,
      status,
      ...selected
    } = filter
    void _page
    void _pageSize
    const filters = { ...selected, ...(status ? { statuses: [status] } : {}) }
    const exportInput = {
      kind,
      rows: snapshot.data,
      totals: snapshot.totals,
      filters,
      currency: snapshot.currency,
    }
    const stem = kind.toLowerCase().replaceAll("_", "-") + "-report"
    const parts: Part[] = []
    if (format === "csv") {
      if (snapshot.total <= 1000) {
        const csv = buildReportCsv(exportInput)
        return download(csv.bytes, csv.filename, "text/csv; charset=utf-8")
      }
      for (let offset = 0; offset < snapshot.total; offset += 1000) {
        const rows = snapshot.data.slice(offset, offset + 1000)
        const csv = buildReportCsv({
          ...exportInput,
          rows,
          includeTotals: offset + rows.length === snapshot.total,
        })
        parts.push({
          name: `${stem}-${parts.length + 1}.csv`,
          bytes: csv.bytes,
          firstRow: offset + 1,
          lastRow: offset + rows.length,
        })
      }
    } else {
      for (
        let maxRowsPerPart = 35;
        ;
        maxRowsPerPart = Math.floor(maxRowsPerPart / 2)
      ) {
        try {
          const pdfParts = planReportPdfParts({
            ...exportInput,
            maxRowsPerPart,
          })
          for (const part of pdfParts) {
            const bytes = renderExportPdf(
              part,
              filters,
              snapshot.currency,
              snapshot.notice
            )
            parts.push({
              name: `${stem}-${part.partNumber}.pdf`,
              bytes,
              firstRow: part.firstRow,
              lastRow: part.lastRow,
            })
          }
          break
        } catch (error) {
          if (
            !(
              error instanceof RangeError &&
              error.message === "REPORT_PDF_PART_TOO_LARGE"
            )
          )
            throw error
          if (maxRowsPerPart === 1) fail("REPORT_PDF_PART_TOO_LARGE", 422)
          parts.length = 0
        }
      }
      if (parts.length === 1)
        return download(parts[0].bytes, `${stem}.pdf`, "application/pdf")
    }
    const manifest = {
      kind,
      format,
      filters,
      asOf: snapshot.asOf,
      totalRows: snapshot.total,
      currency: snapshot.currency,
      totals: snapshot.totals,
      notice: snapshot.notice,
      parts: parts.map(({ name, bytes, firstRow, lastRow }) => ({
        name,
        firstRow,
        lastRow,
        sha256: sha256(bytes),
        size: bytes.length,
      })),
    }
    return download(
      zip([
        ...parts,
        {
          name: "manifest.json",
          bytes: Buffer.from(JSON.stringify(manifest, null, 2)),
        },
      ]),
      `${stem}.zip`,
      "application/zip"
    )
  })
}

export function dashboardEndpoint(request: Request) {
  return endpoint(async () => {
    const identity = await authenticate(request.headers)
    const data = await database().$transaction(
      async (tx) => {
        await assertEnvironment(tx)
        return dashboardQuery(
          tx,
          await currentActor(tx, identity),
          new URL(request.url).searchParams
        )
      },
      { isolationLevel: "RepeatableRead", timeout: 9000 }
    )
    return noStoreJSON({ ok: true, data })
  })
}

const exportFormat = z.enum(["csv", "pdf"])
const uuid = z.string().uuid()
const exportStart = z
  .object({
    id: uuid,
    format: exportFormat,
    query: z.string().max(2048),
  })
  .strict()
const exportStep = z.object({ revision: z.number().int().positive() }).strict()
const partLimit = 5 * 1024 * 1024

function exportRights(actor: Actor, kind: ReportKind) {
  if (
    !actor.ability.can("read", "Report", kind) ||
    !actor.ability.can("export", "Report", kind)
  )
    fail("FORBIDDEN", 403)
  requireFields(
    actor.ability,
    "Document",
    "read",
    { createdBy: actor.userId },
    ["filename", "contentType", "size", "sha256", "bytes"]
  )
}

async function authorizeJob(tx: Tx, actor: Actor, id: string) {
  const job = await tx.exportJob.findUnique({ where: { id } })
  if (!job || job.ownerUserId !== actor.userId) fail("NOT_FOUND", 404)
  exportRights(actor, job.kind as ReportKind)
  if (job.authzFingerprint !== actor.authzRevision) fail("FORBIDDEN", 403)
  // Mutable source conditions can change without a role edit. Fail closed if
  // any source mutation may have changed that population's record permissions.
  if (job.scopeGuard && (await businessCutoff(tx)) !== job.cutoffSequence)
    fail("STALE_REVISION", 409)
  return job
}

async function businessCutoff(tx: Tx) {
  return (await tx.businessSequence.findUniqueOrThrow({ where: { id: 1 } }))
    .value
}

async function auditJob(tx: Tx, job: ExportJob, before: ExportJob | null) {
  const commandId = randomUUID()
  const action = before ? "continueReportExport" : "startReportExport"
  await tx.commandReceipt.create({
    data: {
      id: commandId,
      environmentId: runtimeConfig().ENVIRONMENT_ID,
      actorKey: `USER:${job.ownerUserId}`,
      commandName: action,
      idempotencyKey: before ? commandId : job.id,
      inputHash: job.inputHash,
      result: { id: job.id, revision: job.revision },
    },
  })
  await audit(tx, {
    commandId,
    userId: job.ownerUserId,
    entityType: "ExportJob",
    entityId: job.id,
    action,
    before,
    after: job,
  })
}

const partSelection = {
  id: true,
  ordinal: true,
  filename: true,
  firstRow: true,
  lastRow: true,
  sha256: true,
  size: true,
} satisfies Prisma.ExportPartSelect

async function jobStatus(tx: Tx, job: ExportJob) {
  const complete = job.state === "READY"
  const parts = complete
    ? await tx.exportPart.findMany({
        where: { exportId: job.id },
        orderBy: { ordinal: "asc" },
        select: partSelection,
      })
    : []
  return {
    id: job.id,
    kind: job.kind,
    format: job.format,
    revision: job.revision,
    state: job.state,
    ...(job.state === "PAUSED_QUOTA" ? { error: "QUOTA_STOP" } : {}),
    complete,
    filters: job.filters,
    cutoffSequence: job.cutoffSequence.toString(),
    snapshotAt: job.snapshotAt.toISOString(),
    asOf: job.asOf,
    currency: job.currency,
    totalRows: job.rowCount,
    renderedRows: job.renderedRows,
    totals: job.totals,
    digest: job.digest,
    notice: job.notice,
    parts,
  }
}

export type ReportExportStatus = Awaited<ReturnType<typeof jobStatus>>

async function startExport(
  tx: Tx,
  actor: Actor,
  input: z.infer<typeof exportStart>
) {
  const params = new URLSearchParams(input.query)
  params.delete("page")
  params.delete("pageSize")
  const filter = reportFilter(params)
  const { page: _page, pageSize: _pageSize, status, kind, ...selected } = filter
  void _page
  void _pageSize
  const filters = { ...selected, ...(status ? { statuses: [status] } : {}) }
  const inputHash = sha256(
    Buffer.from(canonical({ kind, filters, format: input.format }))
  )
  exportRights(actor, kind)
  const existing = await tx.exportJob.findUnique({ where: { id: input.id } })
  if (existing) {
    const job = await authorizeJob(tx, actor, existing.id)
    if (job.inputHash !== inputHash) fail("IDEMPOTENCY_MISMATCH")
    return job
  }
  const cutoffSequence = await businessCutoff(tx)
  const snapshot = await reportQuery(tx, actor, filter, true)
  const digest = createHash("sha256")
  for (const row of snapshot.data) digest.update(canonical(row) + "\n")
  const job = await tx.exportJob.create({
    data: {
      id: input.id,
      ownerUserId: actor.userId,
      kind,
      format: input.format,
      filters,
      inputHash,
      authzFingerprint: actor.authzRevision,
      scopeGuard: actor.grants.some(
        ({ action, conditions }) =>
          action === "read" &&
          Boolean(
            conditions?.status ||
            conditions?.customerId ||
            conditions?.financeCompanyId
          )
      ),
      cutoffSequence,
      asOf: snapshot.asOf,
      currency: snapshot.currency,
      notice: snapshot.notice,
      rowCount: snapshot.total,
      totals: snapshot.totals,
      digest: digest.digest("hex"),
    },
  })
  for (let start = 0; start < snapshot.data.length; start += 500) {
    await tx.exportRowSnapshot.createMany({
      data: snapshot.data.slice(start, start + 500).map((row, i) => ({
        exportId: job.id,
        ordinal: start + i + 1,
        payload: JSON.parse(canonical(row)) as Prisma.InputJsonObject,
      })),
    })
  }
  await auditJob(tx, job, null)
  return job
}

function renderRetainedPart(
  job: ExportJob,
  rows: Awaited<ReturnType<typeof reportQuery>>["data"],
  ordinal: number
) {
  const kind = job.kind as ReportKind
  const filters = job.filters as Parameters<
    typeof planReportPdfParts
  >[0]["filters"]
  const totals = job.totals as Record<string, string>
  for (let size = rows.length; ; size = Math.floor(size / 2)) {
    const slice = rows.slice(0, size)
    const lastRow = job.renderedRows + slice.length
    const firstRow = slice.length ? job.renderedRows + 1 : 0
    const input = { kind, filters, totals, currency: job.currency, rows: slice }
    try {
      const bytes =
        job.format === "csv"
          ? buildReportCsv({
              ...input,
              includeTotals: lastRow === job.rowCount,
            }).bytes
          : renderExportPdf(
              {
                ...planReportPdfParts(input)[0],
                partNumber: ordinal,
                totalParts: 0,
                firstRow,
                lastRow,
                totalRows: job.rowCount,
              },
              filters,
              job.currency,
              job.notice,
              totals
            )
      if (bytes.length <= partLimit) return { bytes, firstRow, lastRow }
    } catch (error) {
      if (
        !(
          error instanceof RangeError &&
          error.message === "REPORT_PDF_PART_TOO_LARGE"
        )
      )
        throw error
    }
    if (size <= 1) fail("REPORT_PART_TOO_LARGE", 422)
  }
}

function exportMime(format: string) {
  return format === "csv" ? ("text/csv" as const) : ("application/pdf" as const)
}

async function continueExport(
  tx: Tx,
  identity: Parameters<typeof currentActor>[1],
  id: string,
  revision: number
) {
  // Serialize render/publish/commit for this job. No lock is held across HTTP requests.
  await tx.$queryRaw`SELECT true FROM pg_advisory_xact_lock(hashtextextended(${id}, 0))`
  const actor = await currentActor(tx, identity)
  const job = await authorizeJob(tx, actor, id)
  if (job.state === "READY") return job
  if (revision !== job.revision) fail("STALE_REVISION", 409)
  const records = await tx.exportRowSnapshot.findMany({
    where: { exportId: id, ordinal: { gt: job.renderedRows } },
    orderBy: { ordinal: "asc" },
    take: job.format === "csv" ? 1000 : 35,
  })
  if (
    (!records.length && job.rowCount) ||
    records.some((row, index) => row.ordinal !== job.renderedRows + index + 1)
  )
    fail("INTERNAL_ERROR", 500)
  const ordinal = 1 + (await tx.exportPart.count({ where: { exportId: id } }))
  const rendered = renderRetainedPart(
    job,
    records.map(
      ({ payload }) =>
        payload as Awaited<ReturnType<typeof reportQuery>>["data"][number]
    ),
    ordinal
  )
  // A repeat attempt after a crash republishes the same bytes at the same key.
  const suffix = sha256(Buffer.from(`${job.id}:${ordinal}`)).slice(0, 32)
  const partId = `${suffix.slice(0, 8)}-${suffix.slice(8, 12)}-4${suffix.slice(13, 16)}-8${suffix.slice(17, 20)}-${suffix.slice(20)}`
  const finalKey = `f.${runtimeConfig().ENVIRONMENT_ID}.${job.id}.${partId}.${partId}`
  const filename = `${job.kind.toLowerCase().replaceAll("_", "-")}-report-${ordinal}.${job.format}`
  const metadata = await fileIO(async () => {
    const store = await writableStorage()
    return store.writeGeneratedReport(
      finalKey,
      rendered.bytes,
      exportMime(job.format)
    )
  }).catch((error) => {
    if (error instanceof CommandError && error.code === "QUOTA_STOP")
      return null
    throw error
  })
  await authorizeJob(tx, await currentActor(tx, identity), id)
  const state = !metadata
    ? "PAUSED_QUOTA"
    : rendered.lastRow === job.rowCount
      ? "READY"
      : "RENDERING"
  if (!metadata && job.state === state) return job
  if (metadata) {
    await tx.exportPart.create({
      data: {
        id: partId,
        exportId: id,
        ordinal,
        filename,
        finalKey,
        firstRow: rendered.firstRow,
        lastRow: rendered.lastRow,
        sha256: metadata.sha256,
        size: metadata.size,
      },
    })
  }
  const updated = await tx.exportJob.update({
    where: { id },
    data: {
      revision: { increment: 1 },
      state,
      renderedRows: metadata ? rendered.lastRow : job.renderedRows,
    },
  })
  await auditJob(tx, updated, job)
  return updated
}

export function reportExportEndpoint(
  request: Request,
  rawId?: string,
  rawPart?: string
) {
  return endpoint(async () => {
    const identity = await authenticate(request.headers)
    const txRun = <T>(
      fn: (tx: Tx) => Promise<T>,
      isolationLevel: Prisma.TransactionIsolationLevel = "RepeatableRead"
    ) =>
      database().$transaction(
        async (tx) => {
          await assertEnvironment(tx)
          return fn(tx)
        },
        { isolationLevel, timeout: 10000 }
      )
    if (!rawId && request.method === "POST") {
      sameOrigin(request)
      const input = exportStart.safeParse(await boundedJSON(request))
      if (!input.success) fail("INVALID_INPUT", 422)
      const create = () => txRun(async (tx) => {
        await assertEnvironment(tx, true)
        return startExport(tx, await currentActor(tx, identity), input.data)
      })
      const job = await create().catch((error: unknown) => {
        if (error instanceof Error && "code" in error &&
          (error.code === "P2002" || error.code === "P2034")) return create()
        throw error
      })
      const status = await txRun(async (tx) =>
        jobStatus(tx, await authorizeJob(tx, await currentActor(tx, identity), job.id))
      )
      return noStoreJSON({ ok: true, data: status }, 201)
    }
    if (!rawId) {
      const params = new URL(request.url).searchParams
      if (params.size !== 1 || !params.has("kind")) fail("INVALID_INPUT", 422)
      const filter = reportFilter(params)
      const data = await txRun(async (tx) => {
        const actor = await currentActor(tx, identity)
        exportRights(actor, filter.kind)
        const jobs = await tx.exportJob.findMany({
          where: {
            ownerUserId: actor.userId,
            kind: filter.kind,
            authzFingerprint: actor.authzRevision,
            OR: [
              { scopeGuard: false },
              { cutoffSequence: await businessCutoff(tx) },
            ],
          },
          select: { id: true, format: true, snapshotAt: true, state: true },
          orderBy: [{ snapshotAt: "desc" }, { id: "desc" }],
          take: 20,
        })
        return jobs
      })
      return noStoreJSON({ ok: true, data })
    }
    if (
      !uuid.safeParse(rawId).success ||
      (rawPart && !uuid.safeParse(rawPart).success)
    )
      fail("INVALID_INPUT", 422)
    if (request.method === "POST") {
      sameOrigin(request)
      const input = exportStep.safeParse(await boundedJSON(request))
      if (!input.success) fail("INVALID_INPUT", 422)
      await txRun(
        async (tx) => {
          await assertEnvironment(tx, true)
          return continueExport(tx, identity, rawId, input.data.revision)
        },
        "ReadCommitted"
      )
    }
    const authorize = async (tx: Tx) =>
      authorizeJob(tx, await currentActor(tx, identity), rawId)
    if (!rawPart) {
      const status = await txRun(async (tx) =>
        jobStatus(tx, await authorize(tx))
      )
      if (new URL(request.url).searchParams.get("manifest") === "1") {
        if (!status.complete) fail("DOCUMENT_NOT_READY")
        return download(
          Buffer.from(JSON.stringify(status, null, 2)),
          "manifest.json",
          "application/json"
        )
      }
      return noStoreJSON({ ok: true, data: status })
    }
    const { part, mime } = await txRun(async (tx) => {
      const job = await authorize(tx)
      if (job.state !== "READY") fail("DOCUMENT_NOT_READY")
      const part = await tx.exportPart.findFirst({
        where: { id: rawPart, exportId: rawId },
      })
      if (!part) fail("NOT_FOUND", 404)
      return { part, mime: exportMime(job.format) }
    })
    const bytes = await fileIO(async () =>
      (await privateStorage()).readGeneratedReport(part.finalKey, {
        mime,
        sha256: part.sha256,
        size: part.size,
      })
    )
    await txRun(authorize)
    return download(
      bytes,
      part.filename,
      mime === "text/csv" ? "text/csv; charset=utf-8" : mime
    )
  })
}
