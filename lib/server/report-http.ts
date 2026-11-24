import "server-only"
import { createHash } from "node:crypto"
import { crc32 } from "node:zlib"
import type { ReportKind } from "../../.planning/implementation/contracts/api"
import { authenticate, currentActor } from "./actor"
import { database, assertEnvironment } from "./db"
import { dashboardQuery, reportFilter, reportQuery } from "./reports"
import { endpoint, noStoreJSON } from "./http"
import { fail } from "./errors"
import {
  buildReportCsv,
  formatReportCell,
  planReportPdfParts,
  reportCellValue,
  REPORT_PDF_MAX_PAGES,
} from "./report-export"
import { renderReportPdf } from "./pdf"

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
    },
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
            const bytes = renderReportPdf({
              title: part.title,
              maxPages: REPORT_PDF_MAX_PAGES,
              orientation: "landscape",
              devNotice: "VA Motors | Internal report",
              dateRange: filters,
              filters: [
                ...Object.entries(filters),
                ...(snapshot.notice ? [["Coverage", snapshot.notice]] : []),
              ].flatMap(([label, value]) =>
                value === undefined || label === "from" || label === "through"
                  ? []
                  : [{ label, value: String(value) }]
              ),
              part: {
                ordinal: part.partNumber,
                totalParts: part.totalParts,
                firstRow: part.firstRow,
                lastRow: part.lastRow,
                totalRows: part.totalRows,
              },
              columns: part.columns.map((column) => ({
                key: column.key,
                label: column.label,
                ...(column.format === "money"
                  ? { align: "right" as const }
                  : {}),
                ...(column.key === "components" || column.key === "request"
                  ? { width: 4 }
                  : {}),
              })),
              rows: part.rows.map((row) =>
                Object.fromEntries(
                  part.columns.map((column) => [
                    column.key,
                    formatReportCell(
                      reportCellValue(kind, row, column.key),
                      column.format,
                      column.signed
                    ),
                  ])
                )
              ),
              totals: Object.entries(part.formattedTotals ?? {}).map(
                ([key, value]) => ({
                  label:
                    part.columns.find((column) => column.totalKey === key)
                      ?.label ??
                    {
                      cashIn: "Money in",
                      cashOut: "Money out",
                      net: "Net movement",
                    }[key] ??
                    key,
                  value,
                })
              ),
            })
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
