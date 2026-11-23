import { deflateSync } from "node:zlib"
import { B, major, minor } from "../money"

export type PdfMoney = string | bigint
export type SaleKind = "CASH" | "ADVANCE" | "LEASE" | "TRADE_IN"
export type PaymentMethod = "CASH" | "BANK_TRANSFER"
export type PageOrientation = "portrait" | "landscape"

export interface InvoicePaymentLine {
  amount: PdfMoney
  date: string
  method: PaymentMethod
  reference?: string | null
  label?: string | null
}

export interface InvoiceSellerIdentity {
  name: string
  identity: string
  address: string
  phone: string
  email: string
}

export interface InvoiceBuyerIdentity {
  fullName: string
  callingName?: string | null
  nicOrPassport: string
  phone: string
  address: string
  email?: string | null
  drivingLicence?: string | null
}

export interface InvoiceVehicleDetails {
  make: string
  model: string
  year: number
  colour: string
  engineNumber: string
  chassisNumber: string
  fuelType: string
  transmission: string
  vin?: string | null
  crNumber?: string | null
  handoverMileage: number
}

export type SaleInvoiceTransaction =
  | {
      kind: "CASH"
      agreedPrice: PdfMoney
      payment: InvoicePaymentLine
      totalReceived: PdfMoney
    }
  | {
      kind: "ADVANCE"
      agreedPrice: PdfMoney
      advanceReceipts: InvoicePaymentLine[]
      conversionBalance?: InvoicePaymentLine | null
      totalReceived: PdfMoney
    }
  | {
      kind: "LEASE"
      agreedPrice: PdfMoney
      downPayment: InvoicePaymentLine
      financeCompanyName: string
      financedAmount: PdfMoney
      termMonths?: number | null
      doIssueDate: string
      lenderSettlementStatus: string
      lenderReceived?: PdfMoney | null
      lenderOutstanding: PdfMoney
      lenderReceipts?: InvoicePaymentLine[]
    }
  | {
      kind: "TRADE_IN"
      agreedPrice: PdfMoney
      tradeInDescription: string
      tradeInValue: PdfMoney
      netBalance?: InvoicePaymentLine | null
      totalCashReceived: PdfMoney
    }

export interface InvoiceRestatement {
  priorVersion: number
  priorInvoiceNumber?: string | null
  reason: string
}

export interface SaleInvoicePdfInput {
  invoiceNumber: string
  version: number
  issuedDate: string
  saleDate: string
  currency: string
  saleReference?: string | null
  devNotice?: string | null
  seller: InvoiceSellerIdentity
  buyer: InvoiceBuyerIdentity
  vehicle: InvoiceVehicleDetails
  transaction: SaleInvoiceTransaction
  restatement?: InvoiceRestatement | null
  declarations: string[]
  remarks?: string | null
}

export interface ReportPdfColumn {
  key: string
  label: string
  width?: number
  align?: "left" | "right" | "center"
}

export interface ReportPdfSummaryItem {
  label: string
  value: string
}

export interface ReportPdfInput {
  title: string
  subtitle?: string | null
  orientation?: PageOrientation
  devNotice?: string | null
  dateRange?: {
    from?: string | null
    through?: string | null
  } | null
  filters?: { label: string; value: string }[]
  generatedAt?: string | null
  part?: {
    ordinal: number
    totalParts?: number | null
    firstRow: number
    lastRow: number
    totalRows?: number | null
  } | null
  columns: ReportPdfColumn[]
  rows: Record<string, string | number | null | undefined>[]
  totals?: ReportPdfSummaryItem[]
}

type FontKey = "F1" | "F2" | "F3"

const A4_WIDTH = 595
const A4_HEIGHT = 842

const DEFAULT_INVOICE_DEV_NOTICE =
  "DEV / DRAFT SYNTHETIC DATA - NOT A LEGAL TAX INVOICE"
const DEFAULT_REPORT_DEV_NOTICE =
  "DEV / DRAFT SYNTHETIC DATA - INTERNAL REPORT EXPORT"

const DEFAULT_DECLARATIONS = [
  "The seller declares that the vehicle described above is sold free from undisclosed encumbrances, except as explicitly recorded under lease/finance terms.",
  "Risk and responsibility for the vehicle pass to the buyer upon signed handover and recorded odometer reading.",
  "This is a draft system-generated snapshot for development and operational record-keeping only.",
]

// Standard AFM glyph widths (1/1000 em) for Helvetica ASCII 32..126.
// prettier-ignore
const HELVETICA_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
]

// Standard AFM glyph widths (1/1000 em) for Helvetica-Bold ASCII 32..126.
// prettier-ignore
const HELVETICA_BOLD_WIDTHS = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
]

const WIN_ANSI_UNICODE_TO_BYTE = new Map<number, number>([
  [0x20ac, 0x80],
  [0x201a, 0x82],
  [0x0192, 0x83],
  [0x201e, 0x84],
  [0x2026, 0x85],
  [0x2020, 0x86],
  [0x2021, 0x87],
  [0x02c6, 0x88],
  [0x2030, 0x89],
  [0x0160, 0x8a],
  [0x2039, 0x8b],
  [0x0152, 0x8c],
  [0x017d, 0x8e],
  [0x2018, 0x91],
  [0x2019, 0x92],
  [0x201c, 0x93],
  [0x201d, 0x94],
  [0x2022, 0x95],
  [0x2013, 0x96],
  [0x2014, 0x97],
  [0x02dc, 0x98],
  [0x2122, 0x99],
  [0x0161, 0x9a],
  [0x203a, 0x9b],
  [0x0153, 0x9c],
  [0x017e, 0x9e],
  [0x0178, 0x9f],
])

const SYMBOL_FALLBACKS: Record<string, string> = {
  "\u00a0": " ",
  "\u20a8": "Rs.",
  "\u20b9": "INR",
  "\u2265": ">=",
  "\u2264": "<=",
  "\u2260": "!=",
  "\u2192": "->",
  "\u2190": "<-",
}

function sanitizeLine(input: string): number[] {
  const bytes: number[] = []
  for (const ch of input) {
    if (ch in SYMBOL_FALLBACKS) {
      for (const sub of SYMBOL_FALLBACKS[ch]) {
        bytes.push(sub.charCodeAt(0))
      }
      continue
    }
    const code = ch.codePointAt(0)!
    // Strip control characters and zero-width/bidi formatting marks.
    if (
      code < 0x20 ||
      code === 0x7f ||
      (code >= 0x200b && code <= 0x200f) ||
      (code >= 0x202a && code <= 0x202e) ||
      code === 0xfeff
    ) {
      continue
    }
    if (code <= 0x7e) {
      bytes.push(code)
      continue
    }
    const winAnsi = WIN_ANSI_UNICODE_TO_BYTE.get(code)
    if (winAnsi !== undefined) {
      bytes.push(winAnsi)
      continue
    }
    if (code >= 0xa1 && code <= 0xff) {
      bytes.push(code)
      continue
    }
    bytes.push(0x3f) // '?'
  }
  return bytes
}

function encodePdfLiteral(input: string): string {
  const bytes = sanitizeLine(input)
  let out = "("
  for (const b of bytes) {
    if (b === 0x28 || b === 0x29 || b === 0x5c) {
      out += "\\" + String.fromCharCode(b)
    } else if (b >= 0x20 && b <= 0x7e) {
      out += String.fromCharCode(b)
    } else {
      out += "\\" + b.toString(8).padStart(3, "0")
    }
  }
  out += ")"
  return out
}

function measureTextWidth(
  text: string,
  font: FontKey,
  fontSize: number
): number {
  const bytes = sanitizeLine(text)
  if (font === "F3") {
    return bytes.length * 0.6 * fontSize
  }
  const widths = font === "F2" ? HELVETICA_BOLD_WIDTHS : HELVETICA_WIDTHS
  let units = 0
  for (const b of bytes) {
    if (b >= 32 && b <= 126) {
      units += widths[b - 32]
    } else if (b === 0x97) {
      units += 1000
    } else if (b === 0x96) {
      units += 556
    } else {
      units += 556
    }
  }
  return (units / 1000) * fontSize
}

function wrapText(
  text: string,
  maxWidth: number,
  font: FontKey,
  fontSize: number
): string[] {
  const normalized = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\t/g, "  ")
  const paragraphs = normalized.split("\n")
  const lines: string[] = []
  const safeMax = Math.max(maxWidth, fontSize)

  for (const paragraph of paragraphs) {
    const trimmedRight = paragraph.replace(/\s+$/, "")
    if (!trimmedRight) {
      lines.push("")
      continue
    }
    const words = trimmedRight.split(/(\s+)/)
    let current = ""

    const pushToken = (token: string) => {
      if (!token) return
      if (!current) {
        if (measureTextWidth(token, font, fontSize) <= safeMax) {
          current = token.trimStart()
          return
        }
        // Hard-break an oversized unbroken token (e.g. long chassis/reference).
        let chunk = ""
        for (const ch of token) {
          if (chunk && measureTextWidth(chunk + ch, font, fontSize) > safeMax) {
            lines.push(chunk)
            chunk = ch
          } else {
            chunk += ch
          }
        }
        current = chunk
        return
      }
      if (/^\s+$/.test(token)) {
        if (measureTextWidth(current + " ", font, fontSize) <= safeMax) {
          current += " "
        }
        return
      }
      const candidate = current + token
      if (measureTextWidth(candidate, font, fontSize) <= safeMax) {
        current = candidate
      } else {
        lines.push(current.trimEnd())
        current = ""
        pushToken(token)
      }
    }

    for (const part of words) {
      pushToken(part)
    }
    if (current.trimEnd()) {
      lines.push(current.trimEnd())
    }
  }

  return lines.length ? lines : [""]
}

/** Format canonical minor-unit money (bigint or decimal-integer string) without JS float conversion. */
export function formatPdfMoney(value: PdfMoney, currency = "LKR"): string {
  const amount = typeof value === "bigint" ? value : minor(value, B, true)
  const decimal = major(amount)
  const negative = decimal.startsWith("-")
  const unsigned = negative ? decimal.slice(1) : decimal
  const [whole, frac] = unsigned.split(".")
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  const prefix = currency ? `${currency} ` : ""
  return `${prefix}${negative ? "-" : ""}${grouped}.${frac}`
}

function formatInteger(value: number): string {
  const s = Math.trunc(value).toString()
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
}

function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}

function formatMethod(method: PaymentMethod): string {
  return method === "BANK_TRANSFER" ? "Bank Transfer" : "Cash"
}

function formatPaymentSummary(line: InvoicePaymentLine): string {
  const parts = [formatMethod(line.method), `on ${line.date}`]
  if (line.reference) parts.push(`Ref: ${line.reference}`)
  return parts.join(" | ")
}

type Rgb = readonly [number, number, number]

const COLOR_TEXT: Rgb = [0.09, 0.11, 0.16]
const COLOR_MUTED: Rgb = [0.38, 0.42, 0.49]
const COLOR_BORDER: Rgb = [0.78, 0.82, 0.87]
const COLOR_RULE: Rgb = [0.88, 0.91, 0.94]
const COLOR_HEADER_BG: Rgb = [0.95, 0.96, 0.98]
const COLOR_ZEBRA_BG: Rgb = [0.98, 0.99, 1.0]
const COLOR_DEV_BG: Rgb = [1.0, 0.97, 0.88]
const COLOR_DEV_BORDER: Rgb = [0.85, 0.55, 0.08]
const COLOR_DEV_TEXT: Rgb = [0.55, 0.28, 0.02]
const COLOR_WARN_BG: Rgb = [0.99, 0.94, 0.94]
const COLOR_WARN_BORDER: Rgb = [0.78, 0.22, 0.22]
const COLOR_WARN_TEXT: Rgb = [0.58, 0.12, 0.12]

class PageStream {
  readonly ops: string[] = []

  setFill(rgb: Rgb) {
    this.ops.push(`${rgb[0]} ${rgb[1]} ${rgb[2]} rg`)
  }

  setStroke(rgb: Rgb) {
    this.ops.push(`${rgb[0]} ${rgb[1]} ${rgb[2]} RG`)
  }

  fillRect(x: number, yBottom: number, w: number, h: number, fill: Rgb) {
    this.ops.push(
      `q ${fill[0]} ${fill[1]} ${fill[2]} rg ${fmtNum(x)} ${fmtNum(yBottom)} ${fmtNum(w)} ${fmtNum(h)} re f Q`
    )
  }

  strokeRect(
    x: number,
    yBottom: number,
    w: number,
    h: number,
    stroke: Rgb,
    lineWidth = 0.6
  ) {
    this.ops.push(
      `q ${fmtNum(lineWidth)} w ${stroke[0]} ${stroke[1]} ${stroke[2]} RG ${fmtNum(x)} ${fmtNum(yBottom)} ${fmtNum(w)} ${fmtNum(h)} re S Q`
    )
  }

  box(
    x: number,
    yBottom: number,
    w: number,
    h: number,
    fill: Rgb,
    stroke: Rgb,
    lineWidth = 0.6
  ) {
    this.ops.push(
      `q ${fmtNum(lineWidth)} w ${fill[0]} ${fill[1]} ${fill[2]} rg ${stroke[0]} ${stroke[1]} ${stroke[2]} RG ${fmtNum(x)} ${fmtNum(yBottom)} ${fmtNum(w)} ${fmtNum(h)} re B Q`
    )
  }

  line(x1: number, y1: number, x2: number, y2: number, stroke: Rgb, w = 0.6) {
    this.ops.push(
      `q ${fmtNum(w)} w ${stroke[0]} ${stroke[1]} ${stroke[2]} RG ${fmtNum(x1)} ${fmtNum(y1)} m ${fmtNum(x2)} ${fmtNum(y2)} l S Q`
    )
  }

  text(
    str: string,
    x: number,
    yBaseline: number,
    font: FontKey,
    size: number,
    color: Rgb = COLOR_TEXT
  ) {
    this.ops.push(
      `BT /${font} ${fmtNum(size)} Tf ${color[0]} ${color[1]} ${color[2]} rg 1 0 0 1 ${fmtNum(x)} ${fmtNum(yBaseline)} Tm ${encodePdfLiteral(str)} Tj ET`
    )
  }

  textAligned(
    str: string,
    x: number,
    width: number,
    yBaseline: number,
    font: FontKey,
    size: number,
    align: "left" | "right" | "center",
    color: Rgb = COLOR_TEXT
  ) {
    let tx = x
    if (align !== "left") {
      const tw = measureTextWidth(str, font, size)
      tx = align === "right" ? x + width - tw : x + (width - tw) / 2
    }
    this.text(str, tx, yBaseline, font, size, color)
  }

  toBuffer(): Buffer {
    return Buffer.from(this.ops.join("\n") + "\n", "ascii")
  }
}

/** Serialize pages into a strict single-revision PDF 1.4 byte stream with classic xref. */
function buildPdf14(
  pages: PageStream[],
  pageWidth: number,
  pageHeight: number
): Uint8Array {
  if (!pages.length) {
    throw new RangeError("PDF must contain at least one page")
  }

  const pageCount = pages.length
  const kidRefs: string[] = []
  const objects: Buffer[] = []

  // 1: Catalog
  objects.push(Buffer.from("<< /Type /Catalog /Pages 2 0 R >>", "ascii"))
  // 2: Pages placeholder (filled once kids are known)
  objects.push(Buffer.alloc(0))
  // 3..5: Built-in Type1 fonts with WinAnsiEncoding
  objects.push(
    Buffer.from(
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
      "ascii"
    )
  )
  objects.push(
    Buffer.from(
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
      "ascii"
    )
  )
  objects.push(
    Buffer.from(
      "<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>",
      "ascii"
    )
  )

  for (let i = 0; i < pageCount; i++) {
    const contentId = 6 + i * 2
    const pageId = contentId + 1
    kidRefs.push(`${pageId} 0 R`)

    const compressed = deflateSync(pages[i].toBuffer())
    objects.push(
      Buffer.concat([
        Buffer.from(
          `<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n`,
          "ascii"
        ),
        compressed,
        Buffer.from("\nendstream", "ascii"),
      ])
    )
    objects.push(
      Buffer.from(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fmtNum(pageWidth)} ${fmtNum(pageHeight)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ${contentId} 0 R >>`,
        "ascii"
      )
    )
  }

  objects[1] = Buffer.from(
    `<< /Type /Pages /Count ${pageCount} /Kids [${kidRefs.join(" ")}] >>`,
    "ascii"
  )

  const chunks: Buffer[] = []
  let offset = 0
  const push = (buf: Buffer) => {
    chunks.push(buf)
    offset += buf.length
  }

  push(Buffer.from("%PDF-1.4\n", "ascii"))

  const objectOffsets: number[] = []
  for (let i = 0; i < objects.length; i++) {
    objectOffsets.push(offset)
    push(Buffer.from(`${i + 1} 0 obj\n`, "ascii"))
    push(objects[i])
    push(Buffer.from("\nendobj\n", "ascii"))
  }

  const xrefOffset = offset
  const xrefLines = [
    "xref",
    `0 ${objects.length + 1}`,
    "0000000000 65535 f ",
    ...objectOffsets.map((off) => `${String(off).padStart(10, "0")} 00000 n `),
    "trailer",
    `<< /Size ${objects.length + 1} /Root 1 0 R >>`,
    "startxref",
    String(xrefOffset),
    "%%EOF",
    "",
  ]
  push(Buffer.from(xrefLines.join("\n"), "ascii"))

  const merged = Buffer.concat(chunks)
  return new Uint8Array(merged.buffer, merged.byteOffset, merged.byteLength)
}

class InvoiceDocumentBuilder {
  readonly margin = 42
  readonly pageWidth = A4_WIDTH
  readonly pageHeight = A4_HEIGHT
  readonly contentWidth = A4_WIDTH - 42 * 2
  readonly footerY = 30
  readonly minBottomY = 48
  readonly pages: PageStream[] = []
  currentPage: PageStream
  y: number

  constructor(private readonly input: SaleInvoicePdfInput) {
    this.currentPage = new PageStream()
    this.pages.push(this.currentPage)
    this.y = this.pageHeight - this.margin
  }

  startNewPage() {
    this.currentPage = new PageStream()
    this.pages.push(this.currentPage)
    this.y = this.pageHeight - this.margin
    const notice = this.input.devNotice?.trim() || DEFAULT_INVOICE_DEV_NOTICE
    this.drawNoticeBanner(
      notice,
      COLOR_DEV_BG,
      COLOR_DEV_BORDER,
      COLOR_DEV_TEXT
    )
    this.currentPage.text(
      `Invoice ${this.input.invoiceNumber} (v${this.input.version}) - Continued`,
      this.margin,
      this.y - 4,
      "F2",
      9,
      COLOR_MUTED
    )
    this.y -= 18
  }

  ensureSpace(requiredHeight: number) {
    if (this.y - requiredHeight < this.minBottomY) {
      this.startNewPage()
    }
  }

  drawNoticeBanner(message: string, fill: Rgb, border: Rgb, textColor: Rgb) {
    const lines = wrapText(message, this.contentWidth - 16, "F2", 8.5)
    const boxH = lines.length * 11 + 10
    this.ensureSpace(boxH + 6)
    this.currentPage.box(
      this.margin,
      this.y - boxH,
      this.contentWidth,
      boxH,
      fill,
      border,
      0.8
    )
    let ly = this.y - 13
    for (const line of lines) {
      this.currentPage.text(line, this.margin + 8, ly, "F2", 8.5, textColor)
      ly -= 11
    }
    this.y -= boxH + 8
  }

  drawSectionTitle(title: string) {
    this.ensureSpace(24)
    this.currentPage.fillRect(
      this.margin,
      this.y - 16,
      this.contentWidth,
      16,
      COLOR_HEADER_BG
    )
    this.currentPage.line(
      this.margin,
      this.y - 16,
      this.margin + this.contentWidth,
      this.y - 16,
      COLOR_BORDER,
      0.6
    )
    this.currentPage.text(title, this.margin + 6, this.y - 11.5, "F2", 9)
    this.y -= 22
  }

  drawKeyValueGrid(
    entries: { label: string; value: string }[],
    columns: 1 | 2 = 2
  ) {
    const colWidth =
      columns === 2 ? (this.contentWidth - 12) / 2 : this.contentWidth
    const labelW = 92
    const valueW = colWidth - labelW - 6
    const lineH = 11.5

    for (let i = 0; i < entries.length; i += columns) {
      const pair = entries.slice(i, i + columns)
      const wrapped = pair.map((entry) => ({
        label: entry.label,
        lines: wrapText(entry.value || "-", valueW, "F1", 8.5),
      }))
      const maxLines = Math.max(...wrapped.map((w) => w.lines.length))
      const rowH = maxLines * lineH + 4
      this.ensureSpace(rowH)

      wrapped.forEach((item, colIdx) => {
        const baseX = this.margin + 4 + colIdx * (colWidth + 12)
        this.currentPage.text(
          item.label,
          baseX,
          this.y - 9.5,
          "F2",
          8,
          COLOR_MUTED
        )
        item.lines.forEach((ln, lineIdx) => {
          this.currentPage.text(
            ln,
            baseX + labelW,
            this.y - 9.5 - lineIdx * lineH,
            "F1",
            8.5,
            COLOR_TEXT
          )
        })
      })
      this.y -= rowH
    }
    this.y -= 4
  }

  drawWrappedParagraphs(items: string[], numbered = false, fontSize = 8.5) {
    const lineH = fontSize + 3
    items.forEach((raw, idx) => {
      const prefix = numbered ? `${idx + 1}. ` : ""
      const prefixW = prefix ? measureTextWidth(prefix, "F2", fontSize) : 0
      const lines = wrapText(
        raw,
        this.contentWidth - 12 - prefixW,
        "F1",
        fontSize
      )
      for (let li = 0; li < lines.length; li++) {
        this.ensureSpace(lineH + 2)
        if (li === 0 && prefix) {
          this.currentPage.text(
            prefix,
            this.margin + 4,
            this.y - 9,
            "F2",
            fontSize,
            COLOR_TEXT
          )
        }
        this.currentPage.text(
          lines[li],
          this.margin + 4 + prefixW,
          this.y - 9,
          "F1",
          fontSize,
          COLOR_TEXT
        )
        this.y -= lineH
      }
      this.y -= 3
    })
  }

  finalizeFooters() {
    const total = this.pages.length
    this.pages.forEach((page, index) => {
      page.line(
        this.margin,
        this.footerY + 12,
        this.margin + this.contentWidth,
        this.footerY + 12,
        COLOR_RULE,
        0.5
      )
      page.text(
        `Invoice ${this.input.invoiceNumber} (v${this.input.version}) | DEV / DRAFT SYNTHETIC DATA`,
        this.margin,
        this.footerY,
        "F1",
        7.5,
        COLOR_MUTED
      )
      page.textAligned(
        `Page ${index + 1} of ${total}`,
        this.margin,
        this.contentWidth,
        this.footerY,
        "F1",
        7.5,
        "right",
        COLOR_MUTED
      )
    })
  }
}

interface TransactionTableRow {
  item: string
  detail: string
  amount: string
  emphasize?: boolean
}

function buildTransactionRows(
  tx: SaleInvoiceTransaction,
  currency: string
): TransactionTableRow[] {
  const money = (v: PdfMoney) => formatPdfMoney(v, currency)
  const rows: TransactionTableRow[] = [
    {
      item: "Agreed Sale Price",
      detail: `Sale Category: ${tx.kind.replace("_", "-")}`,
      amount: money(tx.agreedPrice),
      emphasize: true,
    },
  ]

  switch (tx.kind) {
    case "CASH": {
      rows.push({
        item: tx.payment.label || "Immediate Cash / Transfer Receipt",
        detail: formatPaymentSummary(tx.payment),
        amount: money(tx.payment.amount),
      })
      rows.push({
        item: "Total Received",
        detail: "Full settled consideration",
        amount: money(tx.totalReceived),
        emphasize: true,
      })
      break
    }
    case "ADVANCE": {
      tx.advanceReceipts.forEach((receipt, idx) => {
        rows.push({
          item:
            receipt.label ||
            (tx.advanceReceipts.length > 1
              ? `Advance Receipt #${idx + 1}`
              : "Advance Receipt"),
          detail: formatPaymentSummary(receipt),
          amount: money(receipt.amount),
        })
      })
      if (tx.conversionBalance) {
        rows.push({
          item: tx.conversionBalance.label || "Conversion Balance Receipt",
          detail: formatPaymentSummary(tx.conversionBalance),
          amount: money(tx.conversionBalance.amount),
        })
      } else {
        rows.push({
          item: "Conversion Balance Receipt",
          detail: "No balance due at conversion (covered by advance)",
          amount: money("0"),
        })
      }
      rows.push({
        item: "Total Received",
        detail: "Cumulative advance and conversion receipts",
        amount: money(tx.totalReceived),
        emphasize: true,
      })
      break
    }
    case "LEASE": {
      rows.push({
        item: tx.downPayment.label || "Customer Down Payment Receipt",
        detail: formatPaymentSummary(tx.downPayment),
        amount: money(tx.downPayment.amount),
      })
      rows.push({
        item: "Financed Principal (Non-Cash)",
        detail:
          `Finance Company: ${tx.financeCompanyName}` +
          (tx.termMonths ? ` | Term: ${tx.termMonths} months` : ""),
        amount: money(tx.financedAmount),
      })
      rows.push({
        item: "Delivery Order (DO) Issued (Non-Cash)",
        detail: `DO Issue Date: ${tx.doIssueDate} (documentary commitment, non-cash)`,
        amount: "Non-Cash",
      })
      if (tx.lenderReceipts?.length) {
        tx.lenderReceipts.forEach((receipt, idx) => {
          rows.push({
            item:
              receipt.label ||
              (tx.lenderReceipts!.length > 1
                ? `Lender Settlement Receipt #${idx + 1}`
                : "Lender Settlement Receipt"),
            detail: formatPaymentSummary(receipt),
            amount: money(receipt.amount),
          })
        })
      }
      if (tx.lenderReceived !== undefined && tx.lenderReceived !== null) {
        rows.push({
          item: "Lender Settlement Received",
          detail: `Status: ${tx.lenderSettlementStatus}`,
          amount: money(tx.lenderReceived),
        })
      }
      rows.push({
        item: "Lender Settlement Balance",
        detail: `Lender Settlement Status: ${tx.lenderSettlementStatus}`,
        amount: money(tx.lenderOutstanding),
        emphasize: true,
      })
      break
    }
    case "TRADE_IN": {
      rows.push({
        item: "Trade-In Consideration (Non-Cash)",
        detail: `${tx.tradeInDescription} (non-cash consideration)`,
        amount: money(tx.tradeInValue),
      })
      if (tx.netBalance) {
        rows.push({
          item: tx.netBalance.label || "Net Cash / Transfer Balance Received",
          detail: formatPaymentSummary(tx.netBalance),
          amount: money(tx.netBalance.amount),
        })
      } else {
        rows.push({
          item: "Net Cash / Transfer Balance Received",
          detail: "No cash residual (fully covered by trade-in consideration)",
          amount: money("0"),
        })
      }
      rows.push({
        item: "Total Cash Received",
        detail: "Excludes non-cash trade-in consideration",
        amount: money(tx.totalCashReceived),
        emphasize: true,
      })
      break
    }
  }

  return rows
}

/**
 * Render a deterministic, printable A4 portrait PDF 1.4 sale invoice across all
 * four sale workflows (`CASH`, `ADVANCE`, `LEASE`, `TRADE_IN`) and restated versions.
 */
export function renderSaleInvoicePdf(invoice: SaleInvoicePdfInput): Uint8Array {
  const b = new InvoiceDocumentBuilder(invoice)
  const devNotice = invoice.devNotice?.trim() || DEFAULT_INVOICE_DEV_NOTICE

  b.drawNoticeBanner(devNotice, COLOR_DEV_BG, COLOR_DEV_BORDER, COLOR_DEV_TEXT)

  // Header: Dealership identity on left, Invoice metadata on right
  const leftW = b.contentWidth * 0.56
  const rightX = b.margin + leftW + 12
  const rightW = b.contentWidth - leftW - 12

  const sellerLines = [
    ...wrapText(invoice.seller.name, leftW, "F2", 12).map((text) => ({
      text,
      font: "F2" as FontKey,
      size: 12,
      color: COLOR_TEXT,
    })),
    {
      text: `Identity: ${invoice.seller.identity}`,
      font: "F1" as FontKey,
      size: 8.5,
      color: COLOR_MUTED,
    },
    ...wrapText(invoice.seller.address, leftW, "F1", 8.5).map((text) => ({
      text,
      font: "F1" as FontKey,
      size: 8.5,
      color: COLOR_TEXT,
    })),
    {
      text: `Tel: ${invoice.seller.phone} | Email: ${invoice.seller.email}`,
      font: "F1" as FontKey,
      size: 8.5,
      color: COLOR_MUTED,
    },
  ]

  const metaLines: { label: string; value: string }[] = [
    { label: "Invoice No:", value: invoice.invoiceNumber },
    { label: "Version:", value: `v${invoice.version}` },
    { label: "Issued Date:", value: invoice.issuedDate },
    { label: "Sale Date:", value: invoice.saleDate },
    { label: "Sale Type:", value: invoice.transaction.kind },
  ]
  if (invoice.saleReference) {
    metaLines.push({ label: "Sale Ref:", value: invoice.saleReference })
  }

  const leftHeight = sellerLines.reduce((acc, l) => acc + l.size + 3.5, 0)
  const rightHeight = 18 + metaLines.length * 12
  const headerH = Math.max(leftHeight, rightHeight) + 6

  b.ensureSpace(headerH)
  let ly = b.y - 12
  for (const line of sellerLines) {
    b.currentPage.text(
      line.text,
      b.margin,
      ly,
      line.font,
      line.size,
      line.color
    )
    ly -= line.size + 3.5
  }

  let ry = b.y - 13
  b.currentPage.textAligned(
    "VEHICLE SALE INVOICE",
    rightX,
    rightW,
    ry,
    "F2",
    13,
    "right"
  )
  ry -= 16
  for (const m of metaLines) {
    b.currentPage.text(m.label, rightX, ry, "F2", 8.5, COLOR_MUTED)
    b.currentPage.textAligned(m.value, rightX, rightW, ry, "F2", 8.5, "right")
    ry -= 12
  }
  b.y -= headerH
  b.currentPage.line(
    b.margin,
    b.y + 4,
    b.margin + b.contentWidth,
    b.y + 4,
    COLOR_BORDER,
    0.8
  )
  b.y -= 8

  // Correction / Restatement notice when version > 1
  if (invoice.version > 1 || invoice.restatement) {
    const priorVer =
      invoice.restatement?.priorVersion ?? Math.max(1, invoice.version - 1)
    const priorNum = invoice.restatement?.priorInvoiceNumber
      ? ` (${invoice.restatement.priorInvoiceNumber})`
      : ""
    const reason = invoice.restatement?.reason || "Restated invoice version"
    const msg = `CORRECTION / RESTATEMENT NOTICE (v${invoice.version}): Supersedes prior version v${priorVer}${priorNum}. Reason: ${reason}`
    b.drawNoticeBanner(msg, COLOR_WARN_BG, COLOR_WARN_BORDER, COLOR_WARN_TEXT)
  }

  // Buyer / Customer Identity
  b.drawSectionTitle("BUYER / CUSTOMER DETAILS")
  const buyerEntries: { label: string; value: string }[] = [
    { label: "Full Name:", value: invoice.buyer.fullName },
    { label: "NIC / Passport:", value: invoice.buyer.nicOrPassport },
    { label: "Phone:", value: invoice.buyer.phone },
  ]
  if (invoice.buyer.callingName) {
    buyerEntries.push({
      label: "Calling Name:",
      value: invoice.buyer.callingName,
    })
  }
  if (invoice.buyer.email) {
    buyerEntries.push({ label: "Email:", value: invoice.buyer.email })
  }
  if (invoice.buyer.drivingLicence) {
    buyerEntries.push({
      label: "Driving Licence:",
      value: invoice.buyer.drivingLicence,
    })
  }
  b.drawKeyValueGrid(buyerEntries, 2)
  b.drawKeyValueGrid([{ label: "Address:", value: invoice.buyer.address }], 1)

  // Vehicle Details
  b.drawSectionTitle("VEHICLE DETAILS & HANDOVER")
  const vehicleEntries: { label: string; value: string }[] = [
    {
      label: "Make / Model:",
      value: `${invoice.vehicle.make} ${invoice.vehicle.model}`,
    },
    {
      label: "Year / Colour:",
      value: `${invoice.vehicle.year} / ${invoice.vehicle.colour}`,
    },
    { label: "Engine No:", value: invoice.vehicle.engineNumber },
    { label: "Chassis No:", value: invoice.vehicle.chassisNumber },
    { label: "Fuel Type:", value: invoice.vehicle.fuelType },
    { label: "Transmission:", value: invoice.vehicle.transmission },
    {
      label: "Handover Mileage:",
      value: `${formatInteger(invoice.vehicle.handoverMileage)} km`,
    },
  ]
  if (invoice.vehicle.vin) {
    vehicleEntries.push({ label: "VIN:", value: invoice.vehicle.vin })
  }
  if (invoice.vehicle.crNumber) {
    vehicleEntries.push({
      label: "CR Number:",
      value: invoice.vehicle.crNumber,
    })
  }
  b.drawKeyValueGrid(vehicleEntries, 2)

  // Transaction Breakdown Table
  b.drawSectionTitle("TRANSACTION & CONSIDERATION BREAKDOWN")
  const colItemW = 165
  const colAmountW = 115
  const colDetailW = b.contentWidth - colItemW - colAmountW

  const drawTxHeader = () => {
    b.ensureSpace(20)
    b.currentPage.fillRect(
      b.margin,
      b.y - 15,
      b.contentWidth,
      15,
      COLOR_HEADER_BG
    )
    b.currentPage.line(
      b.margin,
      b.y - 15,
      b.margin + b.contentWidth,
      b.y - 15,
      COLOR_BORDER,
      0.6
    )
    b.currentPage.text("Line Item", b.margin + 6, b.y - 11, "F2", 8)
    b.currentPage.text(
      "Details / Non-Cash Basis",
      b.margin + colItemW + 4,
      b.y - 11,
      "F2",
      8
    )
    b.currentPage.textAligned(
      `Amount (${invoice.currency})`,
      b.margin + colItemW + colDetailW,
      colAmountW - 6,
      b.y - 11,
      "F2",
      8,
      "right"
    )
    b.y -= 16
  }

  drawTxHeader()
  const txRows = buildTransactionRows(invoice.transaction, invoice.currency)
  txRows.forEach((row, idx) => {
    const font: FontKey = row.emphasize ? "F2" : "F1"
    const itemLines = wrapText(row.item, colItemW - 10, font, 8.5)
    const detailLines = wrapText(row.detail, colDetailW - 10, "F1", 8)
    const lineCount = Math.max(itemLines.length, detailLines.length)
    const rowH = lineCount * 11 + 6

    if (b.y - rowH < b.minBottomY) {
      b.startNewPage()
      drawTxHeader()
    }

    if (row.emphasize) {
      b.currentPage.fillRect(
        b.margin,
        b.y - rowH,
        b.contentWidth,
        rowH,
        COLOR_HEADER_BG
      )
    } else if (idx % 2 === 1) {
      b.currentPage.fillRect(
        b.margin,
        b.y - rowH,
        b.contentWidth,
        rowH,
        COLOR_ZEBRA_BG
      )
    }

    itemLines.forEach((ln, li) => {
      b.currentPage.text(
        ln,
        b.margin + 6,
        b.y - 11 - li * 11,
        font,
        8.5,
        COLOR_TEXT
      )
    })
    detailLines.forEach((ln, li) => {
      b.currentPage.text(
        ln,
        b.margin + colItemW + 4,
        b.y - 11 - li * 11,
        "F1",
        8,
        COLOR_MUTED
      )
    })
    b.currentPage.textAligned(
      row.amount,
      b.margin + colItemW + colDetailW,
      colAmountW - 6,
      b.y - 11,
      font,
      8.5,
      "right",
      COLOR_TEXT
    )
    b.currentPage.line(
      b.margin,
      b.y - rowH,
      b.margin + b.contentWidth,
      b.y - rowH,
      COLOR_RULE,
      0.5
    )
    b.y -= rowH
  })
  b.y -= 10

  // Optional Remarks
  if (invoice.remarks && invoice.remarks.trim()) {
    b.drawSectionTitle("REMARKS & NOTES")
    b.drawWrappedParagraphs([invoice.remarks.trim()], false, 8.5)
    b.y -= 6
  }

  // Declarations Block
  const declarations = invoice.declarations.length
    ? invoice.declarations
    : DEFAULT_DECLARATIONS
  b.drawSectionTitle("DRAFT DECLARATIONS")
  b.drawWrappedParagraphs(declarations, true, 8)
  b.y -= 8

  // Signatures Block (atomic: never split signature lines across pages)
  const sigBlockH = 66
  b.ensureSpace(sigBlockH)
  const sigTop = b.y - 4
  const sigLineY = sigTop - 28
  const sigColW = (b.contentWidth - 40) / 2
  const leftSigX = b.margin
  const rightSigX = b.margin + sigColW + 40

  b.currentPage.line(
    leftSigX,
    sigLineY,
    leftSigX + sigColW,
    sigLineY,
    COLOR_TEXT,
    0.7
  )
  b.currentPage.text(
    "Seller / Authorized Signatory",
    leftSigX,
    sigLineY - 11,
    "F2",
    8.5
  )
  b.currentPage.text(
    `${invoice.seller.name} | Date: _______________`,
    leftSigX,
    sigLineY - 22,
    "F1",
    8,
    COLOR_MUTED
  )

  b.currentPage.line(
    rightSigX,
    sigLineY,
    rightSigX + sigColW,
    sigLineY,
    COLOR_TEXT,
    0.7
  )
  b.currentPage.text(
    "Buyer / Customer Signature",
    rightSigX,
    sigLineY - 11,
    "F2",
    8.5
  )
  b.currentPage.text(
    `${invoice.buyer.fullName} | Date: _______________`,
    rightSigX,
    sigLineY - 22,
    "F1",
    8,
    COLOR_MUTED
  )

  b.finalizeFooters()
  return buildPdf14(b.pages, b.pageWidth, b.pageHeight)
}

interface ReportColumnLayout {
  key: string
  label: string
  x: number
  width: number
  align: "left" | "right" | "center"
}

function computeColumnLayouts(
  columns: ReportPdfColumn[],
  tableWidth: number
): ReportColumnLayout[] {
  const weights = columns.map((c) =>
    typeof c.width === "number" && c.width > 0 ? c.width : 1
  )
  const totalWeight = weights.reduce((a, b) => a + b, 0)
  let x = 0
  return columns.map((col, idx) => {
    const isLast = idx === columns.length - 1
    const w = isLast
      ? tableWidth - x
      : Math.floor((weights[idx] / totalWeight) * tableWidth)
    const layout: ReportColumnLayout = {
      key: col.key,
      label: col.label,
      x,
      width: Math.max(w, 24),
      align: col.align ?? "left",
    }
    x += w
    return layout
  })
}

function buildFilterSummary(report: ReportPdfInput): string {
  const segments: string[] = []
  if (report.dateRange?.from || report.dateRange?.through) {
    segments.push(
      `Date Range: ${report.dateRange.from ?? "Start"} to ${report.dateRange.through ?? "Latest"}`
    )
  }
  if (report.filters?.length) {
    for (const f of report.filters) {
      segments.push(`${f.label}: ${f.value}`)
    }
  }
  return segments.length
    ? segments.join("  |  ")
    : "Filters: None (All Records)"
}

function buildPartSummary(report: ReportPdfInput): string {
  const parts: string[] = []
  if (report.part) {
    const partLabel = report.part.totalParts
      ? `Part ${report.part.ordinal} of ${report.part.totalParts}`
      : `Part ${report.part.ordinal}`
    const rowLabel = report.part.totalRows
      ? `Rows ${report.part.firstRow}-${report.part.lastRow} of ${report.part.totalRows}`
      : `Rows ${report.part.firstRow}-${report.part.lastRow}`
    parts.push(`${partLabel} (${rowLabel})`)
  }
  if (report.generatedAt) {
    parts.push(`Snapshot: ${report.generatedAt}`)
  }
  return parts.join("  |  ")
}

/**
 * Render a deterministic, multi-page A4 (portrait or landscape) PDF 1.4 report export
 * with repeating page headers, column headers, DEV notice, and summary totals footer.
 */
export function renderReportPdf(report: ReportPdfInput): Uint8Array {
  if (!report.columns.length) {
    throw new RangeError("Report PDF requires at least one column")
  }

  const orientation = report.orientation ?? "portrait"
  const pageWidth = orientation === "landscape" ? A4_HEIGHT : A4_WIDTH
  const pageHeight = orientation === "landscape" ? A4_WIDTH : A4_HEIGHT
  const margin = 32
  const contentWidth = pageWidth - margin * 2
  const footerY = 22
  const minBottomY = 38

  const devNotice = report.devNotice?.trim() || DEFAULT_REPORT_DEV_NOTICE
  const filterSummary = buildFilterSummary(report)
  const partSummary = buildPartSummary(report)
  const colLayouts = computeColumnLayouts(report.columns, contentWidth)

  const headerLinesFilter = wrapText(filterSummary, contentWidth, "F1", 8)
  const colHeaderLines = colLayouts.map((col) =>
    wrapText(col.label, Math.max(col.width - 8, 12), "F2", 8)
  )
  const maxColHeaderLines = Math.max(...colHeaderLines.map((l) => l.length))
  const colHeaderH = maxColHeaderLines * 10 + 8

  const pages: PageStream[] = []
  let currentPage: PageStream
  let y = 0

  const startPage = () => {
    currentPage = new PageStream()
    pages.push(currentPage)
    y = pageHeight - margin

    // DEV Notice banner
    currentPage.box(
      margin,
      y - 16,
      contentWidth,
      16,
      COLOR_DEV_BG,
      COLOR_DEV_BORDER,
      0.6
    )
    currentPage.text(devNotice, margin + 6, y - 11.5, "F2", 8, COLOR_DEV_TEXT)
    y -= 24

    // Report Title & Subtitle / Part metadata
    currentPage.text(report.title, margin, y - 10, "F2", 12, COLOR_TEXT)
    const rightHeader = [report.subtitle, partSummary]
      .filter((s): s is string => Boolean(s))
      .join("  |  ")
    if (rightHeader) {
      currentPage.textAligned(
        rightHeader,
        margin,
        contentWidth,
        y - 10,
        "F1",
        8,
        "right",
        COLOR_MUTED
      )
    }
    y -= 16

    // Date range & active filters summary
    for (const fl of headerLinesFilter) {
      currentPage.text(fl, margin, y - 7, "F1", 8, COLOR_MUTED)
      y -= 10.5
    }
    y -= 4

    // Repeating column headers
    currentPage.fillRect(
      margin,
      y - colHeaderH,
      contentWidth,
      colHeaderH,
      COLOR_HEADER_BG
    )
    currentPage.line(margin, y, margin + contentWidth, y, COLOR_BORDER, 0.7)
    currentPage.line(
      margin,
      y - colHeaderH,
      margin + contentWidth,
      y - colHeaderH,
      COLOR_BORDER,
      0.7
    )

    colLayouts.forEach((col, cIdx) => {
      const lines = colHeaderLines[cIdx]
      lines.forEach((ln, li) => {
        currentPage.textAligned(
          ln,
          margin + col.x + 4,
          Math.max(col.width - 8, 12),
          y - 11 - li * 10,
          "F2",
          8,
          col.align,
          COLOR_TEXT
        )
      })
    })
    y -= colHeaderH
  }

  startPage()

  const cellFontSize = 7.5
  const cellLineH = 9.5

  if (!report.rows.length) {
    const emptyH = 22
    currentPage!.fillRect(
      margin,
      y - emptyH,
      contentWidth,
      emptyH,
      COLOR_ZEBRA_BG
    )
    currentPage!.text(
      "No matching records found for the selected criteria.",
      margin + 6,
      y - 14,
      "F1",
      8.5,
      COLOR_MUTED
    )
    currentPage!.line(
      margin,
      y - emptyH,
      margin + contentWidth,
      y - emptyH,
      COLOR_RULE,
      0.5
    )
    y -= emptyH
  } else {
    for (let rIdx = 0; rIdx < report.rows.length; rIdx++) {
      const row = report.rows[rIdx]
      const wrappedCells = colLayouts.map((col) => {
        const raw = row[col.key]
        const text =
          raw === null || raw === undefined || raw === "" ? "-" : String(raw)
        return wrapText(text, Math.max(col.width - 8, 12), "F1", cellFontSize)
      })
      const maxLines = Math.max(...wrappedCells.map((c) => c.length))
      const rowH = maxLines * cellLineH + 6

      if (y - rowH < minBottomY) {
        startPage()
      }

      if (rIdx % 2 === 1) {
        currentPage!.fillRect(
          margin,
          y - rowH,
          contentWidth,
          rowH,
          COLOR_ZEBRA_BG
        )
      }

      colLayouts.forEach((col, cIdx) => {
        const lines = wrappedCells[cIdx]
        lines.forEach((ln, li) => {
          currentPage!.textAligned(
            ln,
            margin + col.x + 4,
            Math.max(col.width - 8, 12),
            y - 10 - li * cellLineH,
            "F1",
            cellFontSize,
            col.align,
            COLOR_TEXT
          )
        })
      })

      currentPage!.line(
        margin,
        y - rowH,
        margin + contentWidth,
        y - rowH,
        COLOR_RULE,
        0.4
      )
      y -= rowH
    }
  }

  // Summary Totals Footer
  if (report.totals?.length) {
    y -= 8
    const colsPerRow = orientation === "landscape" ? 3 : 2
    const boxPadding = 8
    const itemW = (contentWidth - boxPadding * 2) / colsPerRow
    const rowsOfTotals: ReportPdfSummaryItem[][] = []
    for (let i = 0; i < report.totals.length; i += colsPerRow) {
      rowsOfTotals.push(report.totals.slice(i, i + colsPerRow))
    }
    const metricRowH = 24
    const totalsBoxH = 20 + rowsOfTotals.length * metricRowH + 4

    if (y - totalsBoxH < minBottomY) {
      startPage()
      y -= 6
    }

    currentPage!.box(
      margin,
      y - totalsBoxH,
      contentWidth,
      totalsBoxH,
      COLOR_HEADER_BG,
      COLOR_BORDER,
      0.7
    )
    currentPage!.text(
      "SUMMARY TOTALS",
      margin + boxPadding,
      y - 12,
      "F2",
      8.5,
      COLOR_TEXT
    )

    let ty = y - 26
    for (const totalRow of rowsOfTotals) {
      totalRow.forEach((item, idx) => {
        const tx = margin + boxPadding + idx * itemW
        currentPage!.text(`${item.label}:`, tx, ty, "F1", 7.5, COLOR_MUTED)
        currentPage!.text(item.value, tx, ty - 10.5, "F2", 8.5, COLOR_TEXT)
      })
      ty -= metricRowH
    }
  }

  // Running Footers on every page
  const totalPages = pages.length
  pages.forEach((page, idx) => {
    page.line(
      margin,
      footerY + 11,
      margin + contentWidth,
      footerY + 11,
      COLOR_RULE,
      0.5
    )
    page.text(
      `${report.title} | ${devNotice}`,
      margin,
      footerY,
      "F1",
      7.5,
      COLOR_MUTED
    )
    page.textAligned(
      `Page ${idx + 1} of ${totalPages}`,
      margin,
      contentWidth,
      footerY,
      "F1",
      7.5,
      "right",
      COLOR_MUTED
    )
  })

  return buildPdf14(pages, pageWidth, pageHeight)
}
