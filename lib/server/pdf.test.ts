// @vitest-environment node
import { describe, expect, it } from "vitest"
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs"
import {
  formatPdfMoney,
  renderReportPdf,
  renderSaleInvoicePdf,
  type ReportPdfInput,
  type SaleInvoicePdfInput,
} from "./pdf"
import { validatePdf } from "./private-files/pdf-validation.mjs"

interface ParsedPdf {
  numPages: number
  pages: {
    width: number
    height: number
    text: string
  }[]
  fullText: string
}

async function validateAndParsePdf(
  bytes: Uint8Array,
  runPrivateValidator = true
): Promise<ParsedPdf> {
  expect(bytes.byteLength).toBeGreaterThan(200)
  const raw = Buffer.from(bytes)
  const header = raw.subarray(0, 9).toString("latin1")
  expect(header).toBe("%PDF-1.4\n")
  const trailerTail = raw.subarray(raw.length - 6).toString("latin1")
  expect(trailerTail).toBe("%%EOF\n")

  // Ensure forbidden PDF structures never appear.
  const latin1 = raw.toString("latin1")
  for (const marker of [
    "/ObjStm",
    "/XRef",
    "/Linearized",
    "/JavaScript",
    "/OpenAction",
    "/Launch",
    "/EmbeddedFiles",
    "/Encrypt",
    "/Metadata",
  ]) {
    expect(latin1).not.toContain(marker)
  }

  // Fixture bytes are generated here. Attachment checks exercise the subprocess boundary.
  if (runPrivateValidator) await validatePdf(raw)

  const task = getDocument({
    data: Uint8Array.from(bytes),
    stopAtErrors: true,
    useSystemFonts: false,
    disableFontFace: true,
    useWorkerFetch: false,
    enableXfa: false,
    verbosity: 0,
  })
  const doc = await task.promise
  try {
    const pages: ParsedPdf["pages"] = []
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const viewport = page.getViewport({ scale: 1 })
      const content = await page.getTextContent()
      const text = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
      pages.push({
        width: viewport.width,
        height: viewport.height,
        text,
      })
      page.cleanup()
    }
    return {
      numPages: doc.numPages,
      pages,
      fullText: pages.map((p) => p.text).join(" "),
    }
  } finally {
    await task.destroy()
  }
}

const baseSeller = {
  name: "VA Motors — SYNTHETIC DEVELOPMENT",
  identity: "DEV-NOT-LEGAL",
  address: "Synthetic Test Address, Colombo 05, Sri Lanka",
  phone: "+94 11 555 0100",
  email: "dev-synthetic@vamotors.invalid",
}

const baseBuyer = {
  fullName: "Nimal Perera (Buyer)",
  callingName: "Nimal",
  nicOrPassport: "199012345678",
  phone: "+94 77 555 0199",
  address: "42 Temple Road, Maharagama, Western Province",
  email: "nimal.buyer@example.invalid",
  drivingLicence: "B1234567",
}

const baseVehicle = {
  make: "Toyota",
  model: "Aqua S",
  year: 2019,
  colour: "Pearl White",
  engineNumber: "1NZ-FXE-884412",
  chassisNumber: "NHP10-6543210",
  fuelType: "HYBRID",
  transmission: "AUTOMATIC",
  vin: "JTDKN3DU7K0123456",
  crNumber: "CR-WP-992211",
  handoverMileage: 48250,
}

const baseDeclarations = [
  "Seller confirms clear title and lawful authority to transfer the above vehicle.",
  "Buyer acknowledges physical inspection and odometer reading at handover.",
]

function makeBaseInvoice(
  overrides: Partial<SaleInvoicePdfInput> & {
    transaction: SaleInvoicePdfInput["transaction"]
  }
): SaleInvoicePdfInput {
  return {
    invoiceNumber: "DEV-2026-000001-v1",
    version: 1,
    issuedDate: "2026-10-30",
    saleDate: "2026-10-29",
    currency: "LKR",
    saleReference: "SALE-REF-2026-001",
    seller: baseSeller,
    buyer: baseBuyer,
    vehicle: baseVehicle,
    declarations: baseDeclarations,
    ...overrides,
  }
}

describe("PDF 1.4 deterministic engine", () => {
  it("formats canonical minor-unit money strings and huge bigints without float loss", () => {
    expect(formatPdfMoney("350000000", "LKR")).toBe("LKR 3,500,000.00")
    expect(formatPdfMoney("-125005", "LKR")).toBe("LKR -1,250.05")
    expect(formatPdfMoney(0n, "LKR")).toBe("LKR 0.00")
    // Exceeds Number.MAX_SAFE_INTEGER (9007199254740991)
    expect(formatPdfMoney("9223372036854775807", "LKR")).toBe(
      "LKR 92,233,720,368,547,758.07"
    )
  })

  it(
    "renders deterministic CASH invoice passing private-files validator and full text checks",
    { timeout: 20_000 },
    async () => {
      const input = makeBaseInvoice({
        transaction: {
          kind: "CASH",
          agreedPrice: "450000000",
          payment: {
            amount: "450000000",
            date: "2026-10-29",
            method: "BANK_TRANSFER",
            reference: "BT-998877",
          },
          totalReceived: "450000000",
        },
      })

      const bytesA = renderSaleInvoicePdf(input)
      const bytesB = renderSaleInvoicePdf(input)
      expect(Buffer.from(bytesA).equals(Buffer.from(bytesB))).toBe(true)

      const parsed = await validateAndParsePdf(bytesA)
      expect(parsed.numPages).toBe(1)
      expect(parsed.pages[0].width).toBe(595)
      expect(parsed.pages[0].height).toBe(842)

      for (const expected of [
        "DEV / DRAFT SYNTHETIC DATA",
        "DEV-2026-000001-v1",
        "v1",
        "2026-10-30",
        "2026-10-29",
        "SALE-REF-2026-001",
        "VA Motors — SYNTHETIC DEVELOPMENT",
        "DEV-NOT-LEGAL",
        "Nimal Perera (Buyer)",
        "199012345678",
        "+94 77 555 0199",
        "42 Temple Road, Maharagama",
        "nimal.buyer@example.invalid",
        "B1234567",
        "Toyota Aqua S",
        "2019 / Pearl White",
        "1NZ-FXE-884412",
        "NHP10-6543210",
        "HYBRID",
        "AUTOMATIC",
        "JTDKN3DU7K0123456",
        "CR-WP-992211",
        "48,250 km",
        "LKR 4,500,000.00",
        "Bank Transfer",
        "BT-998877",
        "Total Received",
        "Seller confirms clear title",
        "Seller / Authorized Signatory",
        "Buyer / Customer Signature",
      ]) {
        expect(parsed.fullText).toContain(expected)
      }
    }
  )

  it(
    "renders ADVANCE invoice with multiple advance receipts and conversion balance",
    { timeout: 20_000 },
    async () => {
      const input = makeBaseInvoice({
        invoiceNumber: "DEV-2026-000002-v1",
        transaction: {
          kind: "ADVANCE",
          agreedPrice: "500000000",
          advanceReceipts: [
            {
              amount: "50000000",
              date: "2026-10-15",
              method: "CASH",
              reference: "ADV-001",
            },
            {
              amount: "25000000",
              date: "2026-10-18",
              method: "BANK_TRANSFER",
              reference: "ADV-002",
            },
          ],
          conversionBalance: {
            amount: "425000000",
            date: "2026-10-29",
            method: "BANK_TRANSFER",
            reference: "CONV-777",
          },
          totalReceived: "500000000",
        },
      })

      const bytes = renderSaleInvoicePdf(input)
      const parsed = await validateAndParsePdf(bytes)

      for (const expected of [
        "DEV-2026-000002-v1",
        "ADVANCE",
        "Advance Receipt #1",
        "ADV-001",
        "2026-10-15",
        "LKR 500,000.00",
        "Advance Receipt #2",
        "ADV-002",
        "2026-10-18",
        "LKR 250,000.00",
        "Conversion Balance Receipt",
        "CONV-777",
        "LKR 4,250,000.00",
        "LKR 5,000,000.00",
      ]) {
        expect(parsed.fullText).toContain(expected)
      }
    }
  )

  it(
    "renders LEASE invoice with down payment, finance company, DO non-cash marker, and settlement status",
    { timeout: 20_000 },
    async () => {
      const input = makeBaseInvoice({
        invoiceNumber: "DEV-2026-000003-v1",
        transaction: {
          kind: "LEASE",
          agreedPrice: "600000000",
          downPayment: {
            amount: "150000000",
            date: "2026-10-25",
            method: "BANK_TRANSFER",
            reference: "DP-441",
          },
          financeCompanyName: "Synthetic Lanka Finance PLC",
          financedAmount: "450000000",
          termMonths: 48,
          doIssueDate: "2026-10-28",
          lenderSettlementStatus: "PENDING",
          lenderOutstanding: "450000000",
        },
      })

      const bytes = renderSaleInvoicePdf(input)
      const parsed = await validateAndParsePdf(bytes)

      for (const expected of [
        "DEV-2026-000003-v1",
        "LEASE",
        "LKR 6,000,000.00",
        "Customer Down Payment Receipt",
        "DP-441",
        "2026-10-25",
        "LKR 1,500,000.00",
        "Financed Principal (Non-Cash)",
        "Synthetic Lanka Finance PLC",
        "Term: 48 months",
        "LKR 4,500,000.00",
        "Delivery Order (DO) Issued (Non-Cash)",
        "DO Issue Date: 2026-10-28",
        "Non-Cash",
        "Lender Settlement Status: PENDING",
      ]) {
        expect(parsed.fullText).toContain(expected)
      }
    }
  )

  it(
    "renders TRADE_IN invoice with non-cash trade-in consideration and net balance, plus v2 restatement",
    { timeout: 20_000 },
    async () => {
      const input = makeBaseInvoice({
        invoiceNumber: "DEV-2026-000004-v2",
        version: 2,
        restatement: {
          priorVersion: 1,
          priorInvoiceNumber: "DEV-2026-000004-v1",
          reason:
            "Corrected handover mileage & trade-in valuation after inspection",
        },
        transaction: {
          kind: "TRADE_IN",
          agreedPrice: "550000000",
          tradeInDescription: "2015 Suzuki Alto K10 (Reg CAA-4411)",
          tradeInValue: "200000000",
          netBalance: {
            amount: "350000000",
            date: "2026-10-29",
            method: "CASH",
            reference: "TI-BAL-09",
          },
          totalCashReceived: "350000000",
        },
      })

      const bytes = renderSaleInvoicePdf(input)
      const parsed = await validateAndParsePdf(bytes)

      for (const expected of [
        "DEV-2026-000004-v2",
        "v2",
        "CORRECTION / RESTATEMENT NOTICE (v2)",
        "Supersedes prior version v1 (DEV-2026-000004-v1)",
        "Corrected handover mileage & trade-in valuation after inspection",
        "Trade-In Consideration (Non-Cash)",
        "2015 Suzuki Alto K10 (Reg CAA-4411) (non-cash consideration)",
        "LKR 2,000,000.00",
        "Net Cash / Transfer Balance Received",
        "TI-BAL-09",
        "LKR 3,500,000.00",
        "Total Cash Received",
      ]) {
        expect(parsed.fullText).toContain(expected)
      }
    }
  )

  it(
    "handles special PDF escaping, WinAnsi symbols, and multi-page invoice overflow cleanly",
    { timeout: 20_000 },
    async () => {
      const longRemarks = Array.from(
        { length: 45 },
        (_, idx) =>
          `Clause ${idx + 1}: Escaped chars (parens) \\backslash\\ & currency ₨ fallback — verified on 2026-10-30.`
      ).join("\n")

      const input = makeBaseInvoice({
        invoiceNumber: "DEV-2026-000005-v1",
        remarks: longRemarks,
        transaction: {
          kind: "CASH",
          agreedPrice: "320000000",
          payment: {
            amount: "320000000",
            date: "2026-10-29",
            method: "CASH",
            reference: "CASH-(REF)\\1",
          },
          totalReceived: "320000000",
        },
      })

      const bytes = renderSaleInvoicePdf(input)
      const parsed = await validateAndParsePdf(bytes)
      expect(parsed.numPages).toBeGreaterThanOrEqual(2)
      expect(parsed.fullText).toContain("CASH-(REF)\\1")
      expect(parsed.fullText).toContain(
        "Clause 1: Escaped chars (parens) \\backslash\\ & currency Rs. fallback — verified on 2026-10-30."
      )
      expect(parsed.fullText).toContain(
        "Clause 45: Escaped chars (parens) \\backslash\\ & currency Rs. fallback — verified on 2026-10-30."
      )
      expect(parsed.fullText).toContain("Seller / Authorized Signatory")
      expect(parsed.fullText).toContain("Buyer / Customer Signature")
      expect(parsed.fullText).toContain(
        `Page ${parsed.numPages} of ${parsed.numPages}`
      )
    }
  )

  it(
    "paginates a long multiline buyer address and keeps both signatures",
    { timeout: 20_000 },
    async () => {
      const address = Array.from(
        { length: 90 },
        (_, index) => `Address line ${index + 1}`
      ).join("\n")
      const parsed = await validateAndParsePdf(
        renderSaleInvoicePdf(
          makeBaseInvoice({
            issuedBy: "Synthetic operator",
            buyer: { ...baseBuyer, address },
            transaction: {
              kind: "CASH",
              agreedPrice: "100",
              payment: { amount: "100", date: "2026-10-29", method: "CASH" },
              totalReceived: "100",
            },
          })
        )
      )
      expect(parsed.numPages).toBeGreaterThan(1)
      expect(parsed.pages[0].text).toContain("Synthetic operator")
      expect(parsed.pages[0].text).toContain("Address line 1")
      expect(
        parsed.pages
          .slice(1)
          .some((page) => page.text.includes("Address line 90"))
      ).toBe(true)
      expect(parsed.pages.at(-1)?.text).toContain(
        "Seller / Authorized Signatory"
      )
      expect(parsed.pages.at(-1)?.text).toContain("Buyer / Customer Signature")
    }
  )

  it(
    "renders multi-page landscape report with repeating column headers, filters, totals, and passes validator",
    { timeout: 20_000 },
    async () => {
      const rows = Array.from({ length: 150 }, (_, idx) => {
        const n = String(idx + 1).padStart(3, "0")
        return {
          saleId: `SL-${n}`,
          vehicle: `2021 Toyota Corolla Axio #${n}`,
          customer: `Customer ${n}`,
          saleDate: "2026-10-15",
          saleType: idx % 2 === 0 ? "CASH" : "LEASE",
          agreedPrice: formatPdfMoney(BigInt((idx + 1) * 1000000), "LKR"),
          profit: formatPdfMoney(BigInt((idx + 1) * 120000), "LKR"),
        }
      })

      const report: ReportPdfInput = {
        title: "Sold Vehicles Summary Report",
        subtitle: "Snapshot Cutoff #420",
        orientation: "landscape",
        dateRange: { from: "2026-10-01", through: "2026-10-31" },
        filters: [
          { label: "Sale Type", value: "ALL" },
          { label: "Make", value: "Toyota" },
        ],
        part: {
          ordinal: 1,
          totalParts: 1,
          firstRow: 1,
          lastRow: 150,
          totalRows: 150,
        },
        columns: [
          { key: "saleId", label: "Sale ID", width: 1 },
          { key: "vehicle", label: "Vehicle", width: 2.5 },
          { key: "customer", label: "Customer", width: 2 },
          { key: "saleDate", label: "Sale Date", width: 1.2 },
          { key: "saleType", label: "Type", width: 1 },
          {
            key: "agreedPrice",
            label: "Agreed Price",
            width: 1.6,
            align: "right",
          },
          { key: "profit", label: "Net Profit", width: 1.6, align: "right" },
        ],
        rows,
        totals: [
          { label: "Total Records", value: "150" },
          { label: "Total Sales", value: "LKR 113,250,000.00" },
          { label: "Total Net Profit", value: "LKR 13,590,000.00" },
        ],
      }

      const bytesA = renderReportPdf(report)
      const bytesB = renderReportPdf(report)
      expect(Buffer.from(bytesA).equals(Buffer.from(bytesB))).toBe(true)

      const parsed = await validateAndParsePdf(bytesA)
      expect(parsed.numPages).toBeGreaterThanOrEqual(4)
      expect(parsed.numPages).toBeLessThanOrEqual(50)

      for (const page of parsed.pages) {
        expect(page.width).toBe(842)
        expect(page.height).toBe(595)
        // Repeating header + column headers on every page
        expect(page.text).toContain("Sold Vehicles Summary Report")
        expect(page.text).toContain("DEV / DRAFT SYNTHETIC DATA")
        expect(page.text).toContain("Date Range: 2026-10-01 to 2026-10-31")
        expect(page.text).toContain("Sale Type: ALL")
        expect(page.text).toContain("Make: Toyota")
        expect(page.text).toContain("Sale ID")
        expect(page.text).toContain("Agreed Price")
        expect(page.text).toContain("Net Profit")
      }

      expect(parsed.fullText).toContain("SL-001")
      expect(parsed.fullText).toContain("SL-075")
      expect(parsed.fullText).toContain("SL-150")
      expect(parsed.fullText).toContain("SUMMARY TOTALS")
      expect(parsed.fullText).toContain("LKR 113,250,000.00")
      expect(parsed.fullText).toContain("LKR 13,590,000.00")
    }
  )

  it(
    "renders portrait report with empty rows cleanly and passes validator",
    { timeout: 20_000 },
    async () => {
      const bytes = renderReportPdf({
        title: "Open Repairs Report",
        orientation: "portrait",
        dateRange: { from: "2026-10-01", through: "2026-10-31" },
        columns: [
          { key: "repairId", label: "Repair ID" },
          { key: "vehicle", label: "Vehicle" },
          { key: "vendor", label: "Vendor" },
        ],
        rows: [],
        totals: [{ label: "Open Repairs", value: "0" }],
      })

      const parsed = await validateAndParsePdf(bytes)
      expect(parsed.numPages).toBe(1)
      expect(parsed.pages[0].width).toBe(595)
      expect(parsed.pages[0].height).toBe(842)
      expect(parsed.fullText).toContain("No matching records found")
      expect(parsed.fullText).toContain("Open Repairs:")
    }
  )

  it(
    "handles thousands of report rows smoothly without clipping or memory blowup",
    { timeout: 20_000 },
    async () => {
      const rows = Array.from({ length: 2500 }, (_, idx) => ({
        idx: String(idx + 1),
        ref: `ROW-${String(idx + 1).padStart(4, "0")}`,
        amount: "LKR 10,000.00",
      }))

      const bytes = renderReportPdf({
        title: "High-Volume Cash Flow Export",
        orientation: "landscape",
        columns: [
          { key: "idx", label: "#", width: 1 },
          { key: "ref", label: "Reference", width: 2 },
          { key: "amount", label: "Amount", width: 2, align: "right" },
        ],
        rows,
        totals: [{ label: "Total Rows", value: "2,500" }],
      })

      // Note: 2,500 rows spans >50 pages, so parse with pdfjs-dist directly
      // (private-files validator enforces <=50 pages per individual export part).
      const parsed = await validateAndParsePdf(bytes, false)
      expect(parsed.numPages).toBeGreaterThan(50)
      expect(parsed.fullText).toContain("ROW-0001")
      expect(parsed.fullText).toContain("ROW-1250")
      expect(parsed.fullText).toContain("ROW-2500")
      expect(parsed.fullText).toContain("2,500")
    }
  )
})
