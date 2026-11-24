import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import type {
  FinancialDTO,
  ReportKind,
  ReportRow,
} from "../../.planning/implementation/contracts/api"
import {
  REPORT_COLUMNS,
  REPORT_PDF_MAX_PAGES,
  buildReportCsv,
  getReportColumns,
  planReportPdfParts,
} from "./report-export"

/** Minimal RFC 4180 parser for verifying exact CSV structure and escaping. */
function parseRfc4180(csv: string): string[][] {
  const rows: string[][] = []
  let currentRow: string[] = []
  let field = ""
  let inQuotes = false
  let i = 0

  while (i < csv.length) {
    const ch = csv[i]
    if (inQuotes) {
      if (ch === '"') {
        if (csv[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i += 1
        continue
      }
      field += ch
      i += 1
      continue
    }

    if (ch === '"') {
      inQuotes = true
      i += 1
      continue
    }
    if (ch === ",") {
      currentRow.push(field)
      field = ""
      i += 1
      continue
    }
    if (ch === "\r" && csv[i + 1] === "\n") {
      currentRow.push(field)
      rows.push(currentRow)
      currentRow = []
      field = ""
      i += 2
      continue
    }
    if (ch === "\n") {
      currentRow.push(field)
      rows.push(currentRow)
      currentRow = []
      field = ""
      i += 1
      continue
    }
    field += ch
    i += 1
  }

  if (field.length > 0 || currentRow.length > 0) {
    currentRow.push(field)
    rows.push(currentRow)
  }

  return rows
}

function makeFinancial(overrides: Partial<FinancialDTO> = {}): FinancialDTO {
  return {
    currency: "LKR",
    scale: 2,
    purchase: "1000000",
    repairs: "100000",
    additionalCosts: "50000",
    basis: "1150000",
    salePrice: "1400000",
    originalProfit: "250000",
    cashIn: "1400000",
    cashOut: "1150000",
    net: "250000",
    ...overrides,
  }
}

describe("report-export", () => {
  describe("column definitions and all ReportKind CSV exports", () => {
    it("declares column metadata for every ReportKind", () => {
      const kinds: ReportKind[] = [
        "INVENTORY",
        "SOLD",
        "PROFIT",
        "ADVANCES",
        "REPAIRS",
        "CASH_FLOW",
        "DISPOSALS",
        "PURCHASES",
      ]
      for (const kind of kinds) {
        const cols = REPORT_COLUMNS[kind]
        expect(cols.length).toBeGreaterThan(0)
        for (const col of cols) {
          expect(col.key.length).toBeGreaterThan(0)
          expect(col.label.length).toBeGreaterThan(0)
          expect([
            "text",
            "money",
            "date",
            "number",
            "boolean",
            "percent",
          ]).toContain(col.format)
          expect(col.permissionFields.length).toBeGreaterThan(0)
        }
      }
    })

    it("serializes INVENTORY to UTF-8 CSV with bigint money and totals", () => {
      const rows: ReportRow["INVENTORY"][] = [
        {
          id: "veh-1",
          cycleId: "cyc-1",
          revision: 1,
          identityRevision: 1,
          status: "IN_STOCK",
          available: true,
          listedPrice: "900719925474099312",
          identity: {
            make: "Toyota",
            model: "Corolla",
            year: 2022,
            colour: "Pearl White",
            engineNumber: "ENG-001",
            chassisNumber: "CHS-001",
            vin: "VIN-001",
            crNumber: "CR-001",
            fuelType: "PETROL",
            transmission: "AUTOMATIC",
          },
          financial: makeFinancial({
            purchase: "5000000000",
            repairs: "250000",
            additionalCosts: "50000",
            basis: "5000300000",
          }),
          mileage: [{ reading: 12000, date: "2026-01-10" }],
          provenance: { imported: false },
        },
        {
          id: "veh-2",
          cycleId: "cyc-2",
          revision: 2,
          identityRevision: 1,
          status: "IN_STOCK",
          available: false,
          holdReason: "Awaiting inspection",
          listedPrice: "200000000",
          identity: {
            make: "Honda",
            model: "Civic",
            year: 2021,
            colour: "Black",
            engineNumber: "ENG-002",
            chassisNumber: "CHS-002",
            fuelType: "HYBRID",
            transmission: "CVT",
          },
          financial: makeFinancial({
            purchase: "150000000",
            repairs: "0",
            additionalCosts: "100000",
            basis: "150100000",
          }),
          mileage: [{ reading: 45000, date: "2026-01-12" }],
          provenance: { imported: false },
        },
      ]

      const result = buildReportCsv({
        kind: "INVENTORY",
        rows,
        filters: { from: "2026-01-01", through: "2026-01-31" },
        currency: "LKR",
      })

      expect(result.filename).toBe(
        "inventory-report-from-2026-01-01-to-2026-01-31.csv"
      )
      expect(result.rowCount).toBe(2)

      const decoded = new TextDecoder().decode(result.bytes)
      expect(decoded.endsWith("\r\n")).toBe(true)
      const parsed = parseRfc4180(decoded)
      expect(parsed).toHaveLength(4) // header + 2 rows + totals

      const headers = parsed[0]
      expect(headers).toEqual(
        REPORT_COLUMNS.INVENTORY.map((column) => column.label)
      )

      const listedIdx = headers.indexOf("Listed Price")
      const basisIdx = headers.indexOf("Cost Basis")
      const holdIdx = headers.indexOf("Hold Reason")
      expect(parsed[1][listedIdx]).toBe("9007199254740993.12")
      expect(parsed[1][holdIdx]).toBe("")
      expect(parsed[2][holdIdx]).toBe("Awaiting inspection")
      // Exact bigint sum beyond Number.MAX_SAFE_INTEGER
      expect(parsed[3][0]).toBe("TOTALS")
      expect(parsed[3][listedIdx]).toBe("9007199256740993.12")
      expect(parsed[3][basisIdx]).toBe("51504000.00")
    })

    it("serializes SOLD with original/restated values and negative profit", () => {
      const rows: ReportRow["SOLD"][] = [
        {
          saleId: "sale-1",
          cycleId: "cyc-1",
          vehicle: "Toyota Aqua 2020",
          customer: "Nimal Perera",
          date: "2026-02-01",
          type: "CASH",
          method: "BANK_TRANSFER",
          financial: makeFinancial({
            salePrice: "5000000",
            originalBasis: "4200000",
            basis: "4300000",
            originalProfit: "800000",
            restatedProfit: "700000",
          }),
        },
        {
          saleId: "sale-2",
          cycleId: "cyc-2",
          vehicle: "Suzuki Alto 2019",
          customer: "Kamal Silva",
          date: "2026-02-02",
          type: "TRADE_IN",
          method: null,
          financial: makeFinancial({
            salePrice: "2000000",
            basis: "2250000",
            originalProfit: "-250000",
          }),
        },
      ]

      const result = buildReportCsv({ kind: "SOLD", rows })
      const parsed = parseRfc4180(new TextDecoder().decode(result.bytes))
      expect(parsed).toHaveLength(4)

      const headers = parsed[0]
      expect(parsed[1][headers.indexOf("Original Profit")]).toBe("8000.00")
      expect(parsed[1][headers.indexOf("Restated Profit")]).toBe("7000.00")
      expect(parsed[2][headers.indexOf("Original Cost Basis")]).toBe("")
      expect(parsed[2][headers.indexOf("Original Profit")]).toBe("-2500.00")
      expect(parsed[3][headers.indexOf("Sale Price")]).toBe("70000.00")
      expect(parsed[3][headers.indexOf("Cost Basis")]).toBe("65500.00")
      expect(parsed[3][headers.indexOf("Original Profit")]).toBe("5500.00")
    })

    it("serializes PROFIT with components and leaves unsold sale/profit empty", () => {
      const rows: ReportRow["PROFIT"][] = [
        {
          cycleId: "cyc-1",
          vehicle: "Mazda Demio 2018",
          status: "SOLD",
          date: "2026-02-10",
          financial: makeFinancial({
            purchase: "10000",
            repairs: "1000",
            additionalCosts: "500",
            basis: "11500",
            salePrice: "14000",
            originalProfit: "2500",
          }),
          components: [
            {
              type: "PURCHASE",
              id: "p1",
              date: "2026-01-01",
              amount: "10000",
              description: "Auction purchase",
            },
            {
              type: "REPAIR",
              id: "r1",
              date: "2026-01-05",
              amount: "1000",
              description: "Bumper paint",
            },
          ],
          marginPercent: "17.86",
        },
        {
          cycleId: "cyc-2",
          vehicle: "Nissan Leaf 2022",
          status: "IN_STOCK",
          date: "2026-02-11",
          financial: {
            currency: "LKR",
            scale: 2,
            purchase: "20000",
            repairs: "0",
            additionalCosts: "0",
            basis: "20000",
            cashIn: "0",
            cashOut: "20000",
            net: "-20000",
          },
          marginPercent: null,
        },
      ]

      const result = buildReportCsv({ kind: "PROFIT", rows })
      const parsed = parseRfc4180(new TextDecoder().decode(result.bytes))
      expect(parsed).toHaveLength(4)

      const headers = parsed[0]
      expect(parsed[1][headers.indexOf("Margin (%)")]).toBe("17.86%")
      expect(parsed[1][headers.indexOf("Cost Components")]).toContain(
        "2026-01-01 PURCHASE: Auction purchase (100.00)"
      )
      // Unsold vehicle must not synthesize 0.00 for salePrice or profit
      expect(parsed[2][headers.indexOf("Sale Price")]).toBe("")
      expect(parsed[2][headers.indexOf("Original Profit")]).toBe("")
      expect(parsed[2][headers.indexOf("Margin (%)")]).toBe("")
      expect(parsed[3][headers.indexOf("Cost Basis")]).toBe("315.00")
      expect(parsed[3][headers.indexOf("Sale Price")]).toBe("140.00")
      expect(parsed[3][headers.indexOf("Original Profit")]).toBe("25.00")
    })

    it("serializes ADVANCES, REPAIRS, CASH_FLOW, and DISPOSALS cleanly", () => {
      const advancesCsv = buildReportCsv({
        kind: "ADVANCES",
        rows: [
          {
            reservationId: "res-1",
            cycleId: "cyc-1",
            customer: "Saman Kumara",
            vehicle: "Honda Vezel 2019",
            placedDate: "2026-02-01",
            state: "EXPIRED",
            amount: "100000",
            listedBasis: "1000000",
            agreed: "980000",
            percentDisplay: "10.00",
            validThrough: "2026-02-15",
            daysOutstanding: 20,
            daysOverdue: 5,
          },
        ],
      })
      const advParsed = parseRfc4180(
        new TextDecoder().decode(advancesCsv.bytes)
      )
      expect(advParsed).toHaveLength(3)
      expect(advParsed[1][advParsed[0].indexOf("Advance %")]).toBe("10.00%")
      expect(advParsed[2][advParsed[0].indexOf("Advance Amount")]).toBe(
        "1000.00"
      )

      const repairsCsv = buildReportCsv({
        kind: "REPAIRS",
        rows: [
          {
            repairId: "rep-1",
            cycleId: "cyc-1",
            vehicle: "Toyota Prius 2017",
            vendorId: "ven-1",
            vendor: "Lanka Auto Care",
            request: "Hybrid battery service",
            sentDate: "2026-02-10",
            daysInRepair: 6,
          },
        ],
      })
      const repParsed = parseRfc4180(new TextDecoder().decode(repairsCsv.bytes))
      expect(repParsed).toHaveLength(2) // header + 1 row (no money columns)

      const cashCsv = buildReportCsv({
        kind: "CASH_FLOW",
        rows: [
          {
            paymentId: "pay-1",
            sourceType: "SALE",
            sourceId: "sale-1",
            date: "2026-02-10",
            amount: "500000",
            direction: "IN",
            method: "CASH",
            category: "SALE_RECEIPT",
          },
          {
            paymentId: "pay-2",
            sourceType: "REPAIR",
            sourceId: "rep-1",
            date: "2026-02-11",
            amount: "650000",
            direction: "OUT",
            method: "BANK_TRANSFER",
            category: "REPAIR_PAYMENT",
          },
        ],
      })
      const cashParsed = parseRfc4180(new TextDecoder().decode(cashCsv.bytes))
      expect(cashParsed).toHaveLength(4)
      const cashHeaders = cashParsed[0]
      expect(cashParsed[3][cashHeaders.indexOf("Direction")]).toBe("NET")
      expect(cashParsed[3][cashHeaders.indexOf("Category")]).toBe(
        "Inflow: 5000.00 | Outflow: 6500.00"
      )
      expect(cashParsed[3][cashHeaders.indexOf("Amount")]).toBe("-1500.00")

      const disposalCsv = buildReportCsv({
        kind: "DISPOSALS",
        rows: [
          {
            cycleId: "cyc-9",
            vehicle: "Toyota Vitz 2015",
            date: "2026-02-15",
            reason: "Total flood loss",
            approval: {
              kind: "CURRENT",
              approvalId: "apr-1",
              reviewerId: "usr-1",
              reviewerName: "Manager One",
              reviewedAt: "2026-02-15T08:00:00.000Z",
            },
            method: "AUCTIONED",
            basis: "300000",
            proceeds: "350000",
            netLoss: "-50000",
          },
          {
            cycleId: "cyc-10",
            vehicle: "Suzuki WagonR 2016",
            date: "2026-02-16",
            reason: "Salvaged",
            approval: {
              kind: "IMPORTED",
              batchId: "imp-1",
              rowId: "row-1",
              initiatedByAdminId: "usr-admin",
              historicalApprovalBypass: true,
              legacy: {
                approverName: "Legacy Director",
                approvalReference: "LEG-99",
              },
            },
            method: "SCRAPPED",
            basis: "200000",
            proceeds: "0",
            netLoss: "200000",
          },
        ],
      })
      const dispParsed = parseRfc4180(
        new TextDecoder().decode(disposalCsv.bytes)
      )
      expect(dispParsed).toHaveLength(4)
      const dispHeaders = dispParsed[0]
      expect(dispParsed[1][dispHeaders.indexOf("Approver")]).toBe("Manager One")
      expect(dispParsed[2][dispHeaders.indexOf("Approver")]).toBe(
        "Legacy Director"
      )
      expect(dispParsed[2][dispHeaders.indexOf("Proceeds")]).toBe("0.00")
      expect(dispParsed[3][dispHeaders.indexOf("Net Loss")]).toBe("1500.00")
    })
  })

  describe("redactedFields exclusion across CSV and PDF part specs", () => {
    it("completely omits redacted financial fields from CSV headers, cells, totals, and PDF specs", () => {
      const soldRows: ReportRow["SOLD"][] = [
        {
          saleId: "sale-secret",
          cycleId: "cyc-secret",
          vehicle: "BMW 320i 2023",
          customer: "Secret Buyer",
          date: "2026-03-01",
          type: "CASH",
          method: "BANK_TRANSFER",
          financial: makeFinancial({
            purchase: "777777",
            basis: "888888",
            originalBasis: "888888",
            salePrice: "999999",
            originalProfit: "111111",
            restatedProfit: "111111",
          }),
        },
      ]

      const redacted = ["basis", "purchasePrice", "profit", "cost"]
      const csv = buildReportCsv({
        kind: "SOLD",
        rows: soldRows,
        totals: {
          salePrice: "999999",
          basis: "888888",
          originalBasis: "888888",
          originalProfit: "111111",
          restatedProfit: "111111",
        },
        redactedFields: redacted,
      })

      const text = new TextDecoder().decode(csv.bytes)
      const parsed = parseRfc4180(text)
      expect(parsed[0]).not.toContain("Cost Basis")
      expect(parsed[0]).not.toContain("Original Cost Basis")
      expect(parsed[0]).not.toContain("Original Profit")
      expect(parsed[0]).not.toContain("Restated Profit")
      expect(parsed[0]).toContain("Sale Price")

      // Hidden monetary values must never appear anywhere in CSV
      expect(text).not.toContain("8888.88")
      expect(text).not.toContain("888888")
      expect(text).not.toContain("1111.11")
      expect(text).not.toContain("111111")
      // Visible field stays intact
      expect(text).toContain("9999.99")

      const pdfParts = planReportPdfParts({
        kind: "SOLD",
        rows: soldRows,
        totals: {
          salePrice: "999999",
          basis: "888888",
          originalProfit: "111111",
        },
        redactedFields: redacted,
      })
      expect(pdfParts).toHaveLength(1)
      const partJson = JSON.stringify(pdfParts[0])
      expect(partJson).not.toContain("888888")
      expect(partJson).not.toContain("8888.88")
      expect(partJson).not.toContain("111111")
      expect(partJson).not.toContain("1111.11")
      expect(pdfParts[0].columns.map((c) => c.key)).toEqual([
        "saleId",
        "cycleId",
        "date",
        "vehicle",
        "customer",
        "type",
        "method",
        "financial.salePrice",
      ])
      expect(pdfParts[0].totals).toEqual({ salePrice: "999999" })
      expect(pdfParts[0].formattedTotals).toEqual({ salePrice: "9999.99" })
    })

    it("excludes all financial columns when parent prefix 'financial' or 'cost' is redacted on PROFIT/DISPOSALS", () => {
      const profitCols = getReportColumns("PROFIT", ["financial"])
      expect(profitCols.some((c) => c.key.startsWith("financial."))).toBe(false)
      expect(profitCols.some((c) => c.key === "marginPercent")).toBe(false)

      const costRedactedCols = getReportColumns("PROFIT", ["cost"])
      expect(costRedactedCols.map((c) => c.key)).not.toContain(
        "financial.purchase"
      )
      expect(costRedactedCols.map((c) => c.key)).not.toContain(
        "financial.basis"
      )
      expect(costRedactedCols.map((c) => c.key)).not.toContain("components")
      expect(costRedactedCols.map((c) => c.key)).toContain(
        "financial.salePrice"
      )

      const disposalCols = getReportColumns("DISPOSALS", ["basis"])
      expect(disposalCols.map((c) => c.key)).not.toContain("basis")
      expect(disposalCols.map((c) => c.key)).not.toContain("netLoss")
      expect(disposalCols.map((c) => c.key)).toContain("proceeds")

      const cashCsv = buildReportCsv({
        kind: "CASH_FLOW",
        rows: [
          {
            paymentId: "p1",
            sourceType: "SALE",
            sourceId: "s1",
            date: "2026-03-01",
            amount: "123456",
            direction: "IN",
            method: "CASH",
            category: "SALE_RECEIPT",
          },
        ],
        totals: { cashIn: "123456", cashOut: "0", net: "123456" },
        redactedFields: ["amount"],
      })
      const cashText = new TextDecoder().decode(cashCsv.bytes)
      expect(cashText).not.toContain("1234.56")
      expect(cashText).not.toContain("Inflow")
      expect(cashText).not.toContain("TOTALS")
    })
  })

  describe("CSV formula-injection neutralization & RFC 4180 quoting", () => {
    it("neutralizes dangerous leading characters on text cells while keeping negative money/numbers intact", () => {
      const rows: ReportRow["REPAIRS"][] = [
        {
          repairId: "rep-1",
          cycleId: "cyc-1",
          vehicle: '=CMD|" /C calc"!A0',
          vendorId: "+1+1",
          vendor: "-2+3",
          request: '@SUM(1,1), "quote"\nand\r\nnewline',
          sentDate: "2026-03-01",
          daysInRepair: 5,
        },
        {
          repairId: "rep-2",
          cycleId: "cyc-2",
          vehicle: "\t=HYPERLINK()",
          vendorId: "\r=IMPORTXML()",
          vendor: " =1+1",
          request: 'ශ්‍රී ලංකා — Normal, "quoted" text',
          sentDate: "2026-03-02",
          daysInRepair: 12,
        },
      ]

      const csv = buildReportCsv({ kind: "REPAIRS", rows })
      const decoded = new TextDecoder().decode(csv.bytes)
      const parsed = parseRfc4180(decoded)
      const h = parsed[0]

      expect(parsed[1][h.indexOf("Vehicle")]).toBe('\'=CMD|" /C calc"!A0')
      expect(parsed[1][h.indexOf("Vendor ID")]).toBe("'+1+1")
      expect(parsed[1][h.indexOf("Vendor")]).toBe("'-2+3")
      expect(parsed[1][h.indexOf("Repair Request")]).toBe(
        '\'@SUM(1,1), "quote"\nand\r\nnewline'
      )
      expect(parsed[2][h.indexOf("Vehicle")]).toBe("'\t=HYPERLINK()")
      expect(parsed[2][h.indexOf("Vendor ID")]).toBe("'\r=IMPORTXML()")
      expect(parsed[2][h.indexOf("Vendor")]).toBe("' =1+1")
      expect(parsed[2][h.indexOf("Repair Request")]).toBe(
        'ශ්‍රී ලංකා — Normal, "quoted" text'
      )
    })

    it("preserves valid negative money and negative percent values without apostrophe prefix", () => {
      const rows: ReportRow["PROFIT"][] = [
        {
          cycleId: "cyc-loss",
          vehicle: "Honda Fit 2016",
          status: "SOLD",
          date: "2026-03-05",
          financial: makeFinancial({
            purchase: "300000",
            repairs: "0",
            additionalCosts: "0",
            basis: "300000",
            salePrice: "250000",
            originalProfit: "-50000",
          }),
          marginPercent: "-20.00",
        },
      ]

      const csv = buildReportCsv({ kind: "PROFIT", rows })
      const parsed = parseRfc4180(new TextDecoder().decode(csv.bytes))
      const h = parsed[0]
      expect(parsed[1][h.indexOf("Original Profit")]).toBe("-500.00")
      expect(parsed[1][h.indexOf("Margin (%)")]).toBe("-20.00%")
      expect(parsed[2][h.indexOf("Original Profit")]).toBe("-500.00")
    })
  })

  describe("planReportPdfParts deterministic partitioning & 50-page guarantee", () => {
    it("partitions >1,500 rows deterministically with grand totals on the final part only", () => {
      const count = 1650
      const rows: ReportRow["SOLD"][] = Array.from(
        { length: count },
        (_, i) => ({
          saleId: `sale-${String(i + 1).padStart(4, "0")}`,
          cycleId: `cyc-${String(i + 1).padStart(4, "0")}`,
          vehicle: `Vehicle ${i + 1}`,
          customer: `Customer ${i + 1}`,
          date: "2026-03-10",
          type: "CASH",
          method: "CASH",
          financial: makeFinancial({
            salePrice: "100000",
            basis: "80000",
            originalProfit: "20000",
          }),
        })
      )

      const parts = planReportPdfParts({
        kind: "SOLD",
        rows,
        filters: {
          from: "2026-03-01",
          through: "2026-03-31",
          saleType: "CASH",
        },
        currency: "LKR",
        maxRowsPerPart: 500,
      })

      expect(parts).toHaveLength(4)
      expect(parts.map((p) => p.rows.length)).toEqual([500, 500, 500, 150])
      expect(parts.map((p) => p.partNumber)).toEqual([1, 2, 3, 4])
      expect(parts.every((p) => p.totalParts === 4)).toBe(true)
      expect(parts.every((p) => p.totalRows === count)).toBe(true)
      expect(parts.every((p) => p.estimatedPages <= REPORT_PDF_MAX_PAGES)).toBe(
        true
      )

      expect(parts[0].firstRow).toBe(1)
      expect(parts[0].lastRow).toBe(500)
      expect(parts[0].includeTotals).toBe(false)
      expect(parts[0].totals).toBeNull()
      expect(parts[0].subtitle).toContain("Part 1 of 4")
      expect(parts[0].subtitle).toContain("Rows 1-500 of 1650")

      const last = parts[3]
      expect(last.firstRow).toBe(1501)
      expect(last.lastRow).toBe(1650)
      expect(last.includeTotals).toBe(true)
      expect(last.totals).toEqual({
        salePrice: String(1650n * 100000n),
        basis: String(1650n * 80000n),
        originalProfit: String(1650n * 20000n),
      })
      expect(last.formattedTotals).toEqual({
        salePrice: "1650000.00",
        basis: "1320000.00",
        originalProfit: "330000.00",
      })

      // Deterministic repeatability
      const secondRun = planReportPdfParts({
        kind: "SOLD",
        rows,
        filters: {
          from: "2026-03-01",
          through: "2026-03-31",
          saleType: "CASH",
        },
        currency: "LKR",
        maxRowsPerPart: 500,
      })
      expect(secondRun).toEqual(parts)
    })

    it("handles >10,000 rows without population cap and clamps maxRowsPerPart to stay <= 50 pages", () => {
      const count = 10500
      const rows: ReportRow["CASH_FLOW"][] = Array.from(
        { length: count },
        (_, i) => ({
          paymentId: `pay-${i + 1}`,
          sourceType: "SALE",
          sourceId: `sale-${i + 1}`,
          date: "2026-04-01",
          amount: "10000",
          direction: i % 2 === 0 ? "IN" : "OUT",
          method: "CASH",
          category: "SALE_RECEIPT",
        })
      )

      const csv = buildReportCsv({ kind: "CASH_FLOW", rows })
      expect(csv.rowCount).toBe(count)
      const csvLines = parseRfc4180(new TextDecoder().decode(csv.bytes))
      expect(csvLines).toHaveLength(count + 2) // header + 10,500 rows + totals

      // Even if caller passes maxRowsPerPart: 5000, planner clamps within 50-page limit
      const parts = planReportPdfParts({
        kind: "CASH_FLOW",
        rows,
        maxRowsPerPart: 5000,
      })
      expect(parts.length).toBeGreaterThan(10)
      expect(parts.reduce((sumRows, p) => sumRows + p.rows.length, 0)).toBe(
        count
      )
      expect(parts.every((p) => p.estimatedPages <= REPORT_PDF_MAX_PAGES)).toBe(
        true
      )
      const finalPart = parts.at(-1)!
      expect(finalPart.includeTotals).toBe(true)
      expect(finalPart.totals).toEqual({
        cashIn: "52500000",
        cashOut: "52500000",
        net: "0",
      })
    })

    it("handles empty populations and validates invalid inputs", () => {
      const emptyCsv = buildReportCsv({ kind: "INVENTORY", rows: [] })
      expect(emptyCsv.rowCount).toBe(0)
      const parsed = parseRfc4180(new TextDecoder().decode(emptyCsv.bytes))
      expect(parsed).toHaveLength(1)

      const emptyParts = planReportPdfParts({ kind: "INVENTORY", rows: [] })
      expect(emptyParts).toHaveLength(1)
      expect(emptyParts[0].firstRow).toBe(0)
      expect(emptyParts[0].lastRow).toBe(0)
      expect(emptyParts[0].includeTotals).toBe(true)
      expect(emptyParts[0].estimatedPages).toBe(1)

      expect(() =>
        planReportPdfParts({
          kind: "INVENTORY",
          rows: [],
          maxRowsPerPart: 0,
        })
      ).toThrow(RangeError)

      expect(() =>
        buildReportCsv({
          kind: "UNKNOWN" as ReportKind,
          rows: [],
        })
      ).toThrow(RangeError)

      expect(() =>
        buildReportCsv({
          kind: "CASH_FLOW",
          rows: [
            {
              paymentId: "p1",
              sourceType: "SALE",
              sourceId: "s1",
              date: "2026-04-01",
              amount: "9223372036854775807",
              direction: "IN",
              method: "CASH",
              category: "SALE_RECEIPT",
            },
            {
              paymentId: "p2",
              sourceType: "SALE",
              sourceId: "s2",
              date: "2026-04-01",
              amount: "1",
              direction: "IN",
              method: "CASH",
              category: "SALE_RECEIPT",
            },
          ],
        })
      ).toThrow("MONEY_OVERFLOW")
    })
  })
})
