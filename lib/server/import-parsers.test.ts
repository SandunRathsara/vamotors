import { describe, expect, it } from "vitest"
import { buildXlsx, type XlsxCell } from "./import-template"
import {
  IMPORT_TYPES,
  computeControlTotals,
  computeImportDigest,
  generateImportTemplateCsv,
  getImportTemplateSchema,
  isValidGregorianDate,
  parseImportBuffer,
  parseImportMoney,
} from "./import-parsers"
import {
  digest as sha256Hex,
  validateDocument,
} from "./private-files/validation"
import { validFixtures } from "../../tests/private-files/fixtures"
import type { ImportType } from "../../.planning/implementation/contracts/api"

// ============================================================================
// Minimal Valid Spec-Compliant XLSX Builder for Equivalence Tests
// ============================================================================

/** Convert YYYY-MM-DD to Excel 1900 serial date (for dates >= 1900-03-01). */
function toExcelSerial(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number)
  const utc = Date.UTC(y, m - 1, d)
  const epoch = Date.UTC(1899, 11, 30)
  return Math.round((utc - epoch) / 86_400_000)
}


function parseCsvLineForTest(line: string): string[] {
  const cells: string[] = []
  let field = ""
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      quoted = true
    } else if (ch === ",") {
      cells.push(field)
      field = ""
    } else {
      field += ch
    }
  }
  cells.push(field)
  return cells
}

function templateToXlsx(kind: ImportType): Buffer {
  const csv = generateImportTemplateCsv(kind).trimEnd()
  const lines = csv.split("\n")
  const rows: XlsxCell[][] = lines.map((line) =>
    parseCsvLineForTest(line).map((c) => (c === "" ? null : c))
  )
  return buildXlsx([{ name: kind, rows }])
}

// ============================================================================
// Tests
// ============================================================================

describe("T16 import parsers, templates & canonical validator", () => {
  it("covers all 7 ImportType kinds with deterministic schemas & round-trippable templates", async () => {
    expect(IMPORT_TYPES).toEqual([
      "SUPPLIERS",
      "CUSTOMERS",
      "REPAIR_VENDORS",
      "VEHICLES",
      "SALES",
      "REPAIRS",
      "ADVANCES",
    ])

    for (const kind of IMPORT_TYPES) {
      const schema = getImportTemplateSchema(kind)
      expect(schema.version).toBe(1)
      expect(schema.type).toBe(kind)
      expect(schema.columns.length).toBeGreaterThan(3)

      const csv = generateImportTemplateCsv(kind)
      expect(generateImportTemplateCsv(kind)).toBe(csv)
      const csvBytes = Buffer.from(csv, "utf8")

      // Must pass private-files CSV validation as well.
      await validateDocument(csvBytes, {
        size: csvBytes.length,
        sha256: sha256Hex(csvBytes),
        mime: "text/csv",
        filename: `${kind.toLowerCase()}.csv`,
      })

      const parsedCsv = await parseImportBuffer(kind, "CSV", csvBytes, {
        namespace: "synthetic",
      })
      expect(parsedCsv.errors).toEqual([])
      expect(parsedCsv.valid).toBe(true)
      expect(parsedCsv.validRows).toHaveLength(1)
      expect(parsedCsv.controlTotals.rows).toBe(1)

      const xlsxBytes = templateToXlsx(kind)
      const parsedXlsx = await parseImportBuffer(kind, "XLSX", xlsxBytes, {
        namespace: "synthetic",
      })
      expect(parsedXlsx.errors).toEqual([])
      expect(parsedXlsx.valid).toBe(true)

      // 100% CSV vs XLSX canonical equivalence
      expect(parsedXlsx.validRows).toEqual(parsedCsv.validRows)
      expect(parsedXlsx.controlTotals).toEqual(parsedCsv.controlTotals)
      expect(parsedXlsx.moneyTotalsByField).toEqual(
        parsedCsv.moneyTotalsByField
      )
      expect(parsedXlsx.distinctKeys).toEqual(parsedCsv.distinctKeys)
      expect(parsedXlsx.digest).toBe(parsedCsv.digest)
    }
  })

  it("achieves 100% CSV vs XLSX equivalence across complex multi-row fixtures, native Excel numbers/dates/booleans, and reordered rows/columns", async () => {
    const fcUuid = "11111111-1111-4111-8111-111111111111"

    // Test VEHICLES with:
    // 1) LEASE_SETTLEMENT + additionalCosts + mileage + high M1 amount (> 32-bit)
    // 2) WRITTEN_OFF with disposal + legacyApproval + positive proceeds receipt
    // 3) TRADE_IN customer-as-seller with zero payments
    const vehiclesCsv = [
      [
        "sourceKey",
        "engineNumber",
        "chassisNumber",
        "make",
        "model",
        "year",
        "colour",
        "fuelType",
        "transmission",
        "supplierSourceKey",
        "sellerCustomerSourceKey",
        "tradeInSaleSourceKey",
        "cycleSourceKey",
        "cycleNumber",
        "purchaseType",
        "purchaseDate",
        "purchasePrice",
        "listedPrice",
        "settlementReference",
        "settlementAmount",
        "settlementCashToSeller",
        "settlementInstitutionType",
        "settlementCompanyExistingId",
        "mileage",
        "status",
        "available",
        "holdReason",
        "receivedDate",
        "closedAt",
        "payments",
        "additionalCosts",
        "disposalDate",
        "disposalReason",
        "disposalMethod",
        "disposalProceeds",
        "disposalReceiptDate",
        "disposalReceiptMethod",
        "disposalReceiptReference",
        "disposalApproverName",
        "disposalApprovalReference",
      ].join(","),
      // Row 2: LEASE_SETTLEMENT held in stock, large M1 money (9999999999.99)
      [
        "veh-lease-1",
        "ENG-L1",
        "CHS-L1",
        "Honda",
        "Fit",
        "2023",
        "Blue",
        "HYBRID",
        "CVT",
        "sup-001",
        "",
        "",
        "cyc-l1",
        "1",
        "LEASE_SETTLEMENT",
        "2024-02-29",
        "9999999999.99",
        "10500000.00",
        "SET-REF-9",
        "6000000000.00",
        "3999999999.99",
        "FINANCE_COMPANY",
        fcUuid,
        '"[{""reading"":15000,""date"":""2024-02-29""},{""reading"":14500,""date"":""2024-03-02"",""decreaseReason"":""Cluster replaced""}]"',
        "IN_STOCK",
        "false",
        "Pending polish",
        "2024-03-01",
        "",
        '"[{""sourceKey"":""p-set-1"",""amount"":""6000000.00"",""date"":""2024-02-29"",""method"":""BANK_TRANSFER"",""direction"":""OUT"",""category"":""SETTLEMENT""}]"',
        '"[{""sourceKey"":""c-1"",""category"":""DETAILING"",""description"":""Full interior"",""amount"":""12500.50"",""date"":""2024-03-02"",""payments"":[]}]"',
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
      ].join(","),
      // Row 3: WRITTEN_OFF with disposal & receipt
      [
        "veh-wo-1",
        "ENG-W1",
        "CHS-W1",
        "Suzuki",
        "Alto",
        "2018",
        "White",
        "PETROL",
        "MANUAL",
        "sup-001",
        "",
        "",
        "cyc-w1",
        "1",
        "CASH",
        "2025-01-05",
        "1800000.00",
        "",
        "",
        "",
        "",
        "",
        "",
        '"[{""reading"":80000,""date"":""2025-01-05""}]"',
        "WRITTEN_OFF",
        "false",
        "",
        "2025-01-06",
        "2025-02-10T12:00:00Z",
        '"[{""sourceKey"":""p-wo-1"",""amount"":""1800000.00"",""date"":""2025-01-05"",""method"":""CASH"",""direction"":""OUT"",""category"":""SELLER""}]"',
        "[]",
        "2025-02-10",
        "Total flood damage",
        "AUCTIONED",
        "450000.25",
        "2025-02-10",
        "BANK_TRANSFER",
        "AUC-77",
        "Director A",
        "MIN-2025-02",
      ].join(","),
      // Row 4: TRADE_IN customer-as-seller
      [
        "veh-ti-1",
        "ENG-T1",
        "CHS-T1",
        "Nissan",
        "Leaf",
        "2022",
        "Grey",
        "ELECTRIC",
        "AUTOMATIC",
        "",
        "cust-001",
        "sale-001",
        "cyc-t1",
        "1",
        "CASH",
        "2026-01-15",
        "3200000.00",
        "3500000.00",
        "",
        "",
        "",
        "",
        "",
        '"[{""reading"":22000,""date"":""2026-01-15""}]"',
        "IN_STOCK",
        "true",
        "",
        "2026-01-15",
        "",
        "[]",
        "[]",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
      ].join(","),
    ].join("\n")

    // Build equivalent XLSX using native numeric cells, Excel serial dates, boolean cells, and REVERSED row order!
    const headers: XlsxCell[] = [
      "sourceKey",
      "engineNumber",
      "chassisNumber",
      "make",
      "model",
      "year",
      "colour",
      "fuelType",
      "transmission",
      "supplierSourceKey",
      "sellerCustomerSourceKey",
      "tradeInSaleSourceKey",
      "cycleSourceKey",
      "cycleNumber",
      "purchaseType",
      "purchaseDate",
      "purchasePrice",
      "listedPrice",
      "settlementReference",
      "settlementAmount",
      "settlementCashToSeller",
      "settlementInstitutionType",
      "settlementCompanyExistingId",
      "mileage",
      "status",
      "available",
      "holdReason",
      "receivedDate",
      "closedAt",
      "payments",
      "additionalCosts",
      "disposalDate",
      "disposalReason",
      "disposalMethod",
      "disposalProceeds",
      "disposalReceiptDate",
      "disposalReceiptMethod",
      "disposalReceiptReference",
      "disposalApproverName",
      "disposalApprovalReference",
    ]
    const rowLease: XlsxCell[] = [
      "veh-lease-1",
      "ENG-L1",
      "CHS-L1",
      "Honda",
      "Fit",
      { num: "2023" },
      "Blue",
      "HYBRID",
      "CVT",
      "sup-001",
      null,
      null,
      "cyc-l1",
      { num: "1" },
      "LEASE_SETTLEMENT",
      { dateSerial: toExcelSerial("2024-02-29") },
      { num: "9999999999.99" },
      { num: "10500000" },
      "SET-REF-9",
      { num: "6000000000" },
      { num: "3999999999.99" },
      "FINANCE_COMPANY",
      fcUuid.toUpperCase(),
      '[{"reading":15000,"date":"2024-02-29"},{"reading":14500,"date":"2024-03-02","decreaseReason":"Cluster replaced"}]',
      "IN_STOCK",
      { bool: false },
      "Pending polish",
      { dateSerial: toExcelSerial("2024-03-01") },
      null,
      '[{"sourceKey":"p-set-1","amount":"6000000.00","date":"2024-02-29","method":"BANK_TRANSFER","direction":"OUT","category":"SETTLEMENT"}]',
      '[{"sourceKey":"c-1","category":"DETAILING","description":"Full interior","amount":"12500.50","date":"2024-03-02","payments":[]}]',
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ]
    const rowWo: XlsxCell[] = [
      "veh-wo-1",
      "ENG-W1",
      "CHS-W1",
      "Suzuki",
      "Alto",
      { num: "2018" },
      "White",
      "PETROL",
      "MANUAL",
      "sup-001",
      null,
      null,
      "cyc-w1",
      { num: "1" },
      "CASH",
      { dateSerial: toExcelSerial("2025-01-05") },
      { num: "1800000" },
      null,
      null,
      null,
      null,
      null,
      null,
      '[{"reading":80000,"date":"2025-01-05"}]',
      "WRITTEN_OFF",
      { bool: false },
      null,
      { dateSerial: toExcelSerial("2025-01-06") },
      "2025-02-10T12:00:00.000Z",
      '[{"sourceKey":"p-wo-1","amount":"1800000","date":"2025-01-05","method":"CASH","direction":"OUT","category":"SELLER"}]',
      "[]",
      { dateSerial: toExcelSerial("2025-02-10") },
      "Total flood damage",
      "AUCTIONED",
      { num: "450000.25" },
      { dateSerial: toExcelSerial("2025-02-10") },
      "BANK_TRANSFER",
      "AUC-77",
      "Director A",
      "MIN-2025-02",
    ]
    const rowTi: XlsxCell[] = [
      "veh-ti-1",
      "ENG-T1",
      "CHS-T1",
      "Nissan",
      "Leaf",
      { num: "2022" },
      "Grey",
      "ELECTRIC",
      "AUTOMATIC",
      null,
      "cust-001",
      "sale-001",
      "cyc-t1",
      { num: "1" },
      "CASH",
      { dateSerial: toExcelSerial("2026-01-15") },
      { num: "3200000" },
      { num: "3500000" },
      null,
      null,
      null,
      null,
      null,
      '[{"reading":22000,"date":"2026-01-15"}]',
      "IN_STOCK",
      { bool: true },
      null,
      { dateSerial: toExcelSerial("2026-01-15") },
      null,
      "[]",
      "[]",
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ]

    const xlsx = buildXlsx([
      {
        name: "VEHICLES",
        // Reversed row order + trailing blank rows
        rows: [headers, rowTi, rowWo, rowLease, [null, null], []],
      },
    ])

    const csvRes = await parseImportBuffer(
      "VEHICLES",
      "CSV",
      Buffer.from(vehiclesCsv, "utf8"),
      { namespace: "hist-2026" }
    )
    const xlsxRes = await parseImportBuffer("VEHICLES", "XLSX", xlsx, {
      namespace: "hist-2026",
    })

    expect(csvRes.errors).toEqual([])
    expect(xlsxRes.errors).toEqual([])
    expect(csvRes.valid).toBe(true)
    expect(xlsxRes.valid).toBe(true)

    // Control totals: exact bigint minor-unit strings (beyond 32-bit!)
    expect(csvRes.controlTotals).toEqual({
      rows: 3,
      purchase: "1000499999999", // 999999999999 + 180000000 + 320000000
      cost: "1250050",
      consideration: "0",
      cashIn: "45000025", // disposal receipt
      cashOut: "780000000", // 6000000.00 + 1800000.00
      byType: [{ type: "VEHICLES", rows: 3 }],
    })
    expect(xlsxRes.controlTotals).toEqual(csvRes.controlTotals)
    expect(xlsxRes.moneyTotalsByField).toEqual(csvRes.moneyTotalsByField)
    expect(xlsxRes.distinctKeys).toEqual(csvRes.distinctKeys)
    // Order-independent digest must match despite reversed rows!
    expect(xlsxRes.digest).toBe(csvRes.digest)
    expect(xlsxRes.digest).toMatch(/^[a-f0-9]{64}$/)

    // Sorted validRows must match deeply
    const sortByKey = <T extends { sourceKey: string }>(arr: T[]) =>
      [...arr].sort((a, b) => a.sourceKey.localeCompare(b.sourceKey))
    expect(sortByKey(xlsxRes.validRows)).toEqual(sortByKey(csvRes.validRows))
  })

  it("supports multi-sheet XLSX workbooks and rejects unknown sheets", async () => {
    const xlsx = buildXlsx([
      {
        name: "SUPPLIERS",
        rows: [
          ["sourceKey", "name", "category", "phone"],
          ["sup-1", "Alpha Motors", "COMPANY", "0112223344"],
        ],
      },
      {
        name: "CUSTOMERS",
        rows: [
          [
            "sourceKey",
            "fullName",
            "callingName",
            "nicOrPassport",
            "address",
            "phone",
          ],
          [
            "cust-1",
            "Nimal Perera",
            "Nimal",
            "881234567V",
            "10 Main St",
            "0771112233",
          ],
        ],
      },
    ])

    const sup = await parseImportBuffer("SUPPLIERS", "XLSX", xlsx)
    expect(sup.valid).toBe(true)
    expect(sup.sheetName).toBe("SUPPLIERS")
    expect(sup.validRows[0].payload.name).toBe("Alpha Motors")

    const cust = await parseImportBuffer("CUSTOMERS", "XLSX", xlsx, {
      sheetName: "CUSTOMERS",
    })
    expect(cust.valid).toBe(true)
    expect(cust.sheetName).toBe("CUSTOMERS")
    expect(cust.validRows[0].payload.fullName).toBe("Nimal Perera")

    const missing = await parseImportBuffer("CUSTOMERS", "XLSX", xlsx, {
      sheetName: "NONEXISTENT",
    })
    expect(missing.valid).toBe(false)
    expect(missing.errors[0].code).toBe("SHEET_NOT_FOUND")
  })

  it("handles UTF-8 BOM, CRLF, RFC 4180 quotes, trailing empty rows, and header aliases identically to XLSX", async () => {
    const csvWithBomAndCrlf =
      "\uFEFF" +
      [
        "source_key,Full Name,calling_name,nic_or_passport,Address,Phone,drivingLicense,recordedAt",
        'cust-q1,"Saman ""Sam"" Silva",Sam,921234567v,"No 5, Lake Road\r\nColombo 02",0779876543,DL-99,2026-01-01T00:00:00Z',
        ",,,,,,," /* trailing blank row */,
        "",
      ].join("\r\n")

    const xlsx = buildXlsx([
      {
        name: "CUSTOMERS",
        rows: [
          [
            "sourceKey",
            "fullName",
            "callingName",
            "nicOrPassport",
            "address",
            "phone",
            "drivingLicence",
            "legacyRecordedAt",
          ],
          [
            "cust-q1",
            'Saman "Sam" Silva',
            "Sam",
            "921234567v",
            "No 5, Lake Road\nColombo 02",
            "0779876543",
            "DL-99",
            "2026-01-01T00:00:00.000Z",
          ],
        ],
      },
    ])

    const csvRes = await parseImportBuffer(
      "CUSTOMERS",
      "CSV",
      Buffer.from(csvWithBomAndCrlf, "utf8")
    )
    const xlsxRes = await parseImportBuffer("CUSTOMERS", "XLSX", xlsx)
    expect(csvRes.errors).toEqual([])
    expect(xlsxRes.errors).toEqual([])
    expect(csvRes.validRows).toEqual(xlsxRes.validRows)
    expect(csvRes.digest).toBe(xlsxRes.digest)
  })

  it("validates strict Gregorian dates with zero JS Date rollover", () => {
    expect(isValidGregorianDate("2024-02-29")).toBe(true)
    expect(isValidGregorianDate("2000-02-29")).toBe(true)
    expect(isValidGregorianDate("2025-02-29")).toBe(false)
    expect(isValidGregorianDate("1900-02-29")).toBe(false)
    expect(isValidGregorianDate("2025-04-31")).toBe(false)
    expect(isValidGregorianDate("2025-13-01")).toBe(false)
    expect(isValidGregorianDate("2025-00-10")).toBe(false)
    expect(isValidGregorianDate("0000-01-01")).toBe(false)
    expect(isValidGregorianDate("2025-1-1")).toBe(false)
  })

  it("collects all per-row/per-column errors across mixed valid+invalid rows without stopping at first bad row", async () => {
    const csv = [
      "sourceKey,cycleSourceKey,vendorSourceKey,request,sentDate,returnedDate,invoiceDate,invoiceAmount,summary,payments",
      // Row 2: valid
      'rep-ok,cyc-1,vnd-1,Oil change,2026-01-10,2026-01-11,2026-01-11,15000.00,Done,"[{""sourceKey"":""pr-1"",""amount"":""15000.00"",""date"":""2026-01-11"",""method"":""CASH"",""direction"":""OUT"",""category"":""REPAIR""}]"',
      // Row 3: invalid Gregorian date + invalid money 3 decimals + incomplete return group
      "rep-bad1,cyc-1,vnd-1,Brake pad,2025-02-29,2026-01-12,,12.345,,[]",
      // Row 4: money overflow + returnedDate < sentDate + duplicate sourceKey
      "rep-ok,cyc-1,vnd-1,Paint,2026-02-10,2026-02-01,2026-02-01,1000000000000.00,Painted,[]",
      // Row 5: valid second row
      "rep-ok2,cyc-2,vnd-1,Alignment,2026-01-20,,,,,[]",
    ].join("\n")

    const res = await parseImportBuffer("REPAIRS", "CSV", Buffer.from(csv, "utf8"))
    expect(res.valid).toBe(false)
    expect(res.validRows).toHaveLength(2)
    expect(res.validRows.map((r) => r.sourceKey)).toEqual(["rep-ok", "rep-ok2"])
    expect(res.rows).toHaveLength(4)

    // Row 3 errors
    const row3Errors = res.rows[1].errors
    expect(row3Errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rowNumber: 3,
          field: "sentDate",
          code: "INVALID_DATE",
        }),
        expect.objectContaining({
          rowNumber: 3,
          field: "invoiceAmount",
          code: "INVALID_MONEY",
        }),
        expect.objectContaining({
          rowNumber: 3,
          field: "invoiceDate",
          code: "INCOMPLETE_RETURN_GROUP",
        }),
        expect.objectContaining({
          rowNumber: 3,
          field: "summary",
          code: "INCOMPLETE_RETURN_GROUP",
        }),
      ])
    )

    // Row 4 errors
    const row4Errors = res.rows[2].errors
    expect(row4Errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rowNumber: 4,
          field: "sourceKey",
          code: "DUPLICATE_SOURCE_KEY",
        }),
        expect.objectContaining({
          rowNumber: 4,
          field: "returnedDate",
          code: "CHRONOLOGY_VIOLATION",
        }),
        expect.objectContaining({
          rowNumber: 4,
          field: "invoiceAmount",
          code: "MONEY_OVERFLOW",
        }),
      ])
    )
  })

  it("rejects duplicate identities, duplicate cycles, duplicate saleCaseSourceKeys, bad enums, and balance mismatches", async () => {
    // Duplicate normalized customer identity ("901234567V" vs "901234 567v")
    const custCsv = [
      "sourceKey,fullName,callingName,nicOrPassport,address,phone,email",
      "c1,Kamal Perera,Kamal,901234567V,Addr 1,0771234567,kamal@example.test",
      "c2,Kamal Twin,Kamal,901234 567v,Addr 2,0771234568,bad-email",
    ].join("\n")
    const custRes = await parseImportBuffer(
      "CUSTOMERS",
      "CSV",
      Buffer.from(custCsv, "utf8")
    )
    expect(custRes.valid).toBe(false)
    expect(custRes.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rowNumber: 3,
          field: "nicOrPassport",
          code: "DUPLICATE_IDENTITY",
        }),
        expect.objectContaining({
          rowNumber: 3,
          field: "email",
          code: "INVALID_EMAIL",
        }),
      ])
    )

    // Sales balance mismatch + invalid enum + duplicate saleCaseSourceKey
    const salesCsv = [
      "sourceKey,cycleSourceKey,customerSourceKey,kind,saleCaseSourceKey,price,state,completionDate,completionMileage,completionBasisPurchase,financeCompanySourceKey,downPayment,financeAmount,termMonths",
      "s1,cyc-1,c1,LEASE,case-1,1000.00,COMPLETED,2026-01-10,100,800.00,fc-1,200.00,700.00,12",
      "s2,cyc-2,c1,INVALID_KIND,case-1,500.00,COMPLETED,2026-01-11,200,400.00,,,,",
    ].join("\n")
    const salesRes = await parseImportBuffer(
      "SALES",
      "CSV",
      Buffer.from(salesCsv, "utf8")
    )
    expect(salesRes.valid).toBe(false)
    expect(salesRes.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rowNumber: 2,
          field: "financeAmount",
          code: "BALANCE_MISMATCH",
        }),
        expect.objectContaining({
          rowNumber: 2,
          field: "doIssueDate",
          code: "MISSING_REQUIRED",
        }),
        expect.objectContaining({
          rowNumber: 3,
          field: "kind",
          code: "INVALID_ENUM",
        }),
        expect.objectContaining({
          rowNumber: 3,
          field: "saleCaseSourceKey",
          code: "DUPLICATE_SALE_CASE_KEY",
        }),
      ])
    )
  })

  it("rejects unknown columns, duplicate columns, forbidden authority columns, formula injection, and unsafe XLSX/CSV inputs", async () => {
    const unknownColCsv = "sourceKey,name,category,surpriseCol\ns1,A,COMPANY,x\n"
    const r1 = await parseImportBuffer(
      "SUPPLIERS",
      "CSV",
      Buffer.from(unknownColCsv, "utf8")
    )
    expect(r1.valid).toBe(false)
    expect(r1.errors[0].code).toBe("UNKNOWN_COLUMN")

    const forbiddenColCsv =
      "sourceKey,name,category,approvalId\ns1,A,COMPANY,11111111-1111-4111-8111-111111111111\n"
    const r2 = await parseImportBuffer(
      "SUPPLIERS",
      "CSV",
      Buffer.from(forbiddenColCsv, "utf8")
    )
    expect(r2.valid).toBe(false)
    expect(r2.errors[0].code).toBe("FORBIDDEN_COLUMN")

    const formulaCsv = "sourceKey,name,category\ns1,=CMD|calc,COMPANY\n"
    const r3 = await parseImportBuffer(
      "SUPPLIERS",
      "CSV",
      Buffer.from(formulaCsv, "utf8")
    )
    expect(r3.valid).toBe(false)
    expect(r3.errors[0]).toMatchObject({
      rowNumber: 2,
      field: "name",
      code: "FORMULA_INJECTION",
    })

    const badUtf8 = new Uint8Array([0xff, 0xfe, 0x00])
    const r4 = await parseImportBuffer("SUPPLIERS", "CSV", badUtf8)
    expect(r4.valid).toBe(false)
    expect(r4.errors[0].code).toBe("INVALID_UTF8")

    const formulaXlsx = buildXlsx([
      {
        name: "SUPPLIERS",
        rows: [
          ["sourceKey", "name", "category"],
          ["s1", { formula: "1+1", cached: "2" }, "COMPANY"],
        ],
      },
    ])
    const r5 = await parseImportBuffer("SUPPLIERS", "XLSX", formulaXlsx)
    expect(r5.valid).toBe(false)
    expect(r5.errors[0].code).toBe("INVALID_XLSX")

    // Verify real private-files valid.xlsx fixture fails schema check cleanly without crashing.
    const fixtures = await validFixtures()
    const validXlsxFixture = fixtures.find((f) => f.filename === "valid.xlsx")!
    const r6 = await parseImportBuffer(
      "SUPPLIERS",
      "XLSX",
      validXlsxFixture.bytes
    )
    expect(r6.valid).toBe(false)
    expect(r6.errors.some((e) => e.code === "UNKNOWN_COLUMN")).toBe(true)
  })

  it("enforces ADVANCES state-specific invariants and parseImportMoney bounds", async () => {
    expect(parseImportMoney("123.45")).toEqual({ ok: true, value: "12345" })
    expect(parseImportMoney("0", { positive: true })).toMatchObject({
      ok: false,
      code: "NON_POSITIVE_MONEY",
    })
    expect(parseImportMoney("1.234")).toMatchObject({
      ok: false,
      code: "INVALID_MONEY",
    })
    expect(parseImportMoney("-5.00")).toMatchObject({
      ok: false,
      code: "INVALID_MONEY",
    })
    expect(parseImportMoney("1000000000000.00")).toMatchObject({
      ok: false,
      code: "MONEY_OVERFLOW",
    })

    const advCsv = [
      "sourceKey,cycleSourceKey,customerSourceKey,agreed,amount,saleCaseSourceKey,placedDate,listedBasis,validThrough,expiresAt,state,completedSaleSourceKey,retainedAmount,resolutionDate,resolutionReason,dispositionKind,dispositionHoldReason,payments",
      // Valid CONVERTED advance
      'adv-1,cyc-1,cust-1,5500000.00,500000.00,case-1,2026-01-10,5500000.00,2026-01-24,2026-01-24T18:30:00Z,CONVERTED,sale-1,,2026-01-20,,,,"[{""sourceKey"":""p-a1"",""amount"":""500000.00"",""date"":""2026-01-10"",""method"":""CASH"",""direction"":""IN"",""category"":""ADVANCE""}]"',
      // Valid REFUNDED advance with HOLD disposition
      'adv-2,cyc-2,cust-1,3000000.00,200000.00,case-2,2026-01-12,3000000.00,2026-01-26,2026-01-26T18:30:00Z,REFUNDED,,80000.00,2026-01-18,Buyer withdrew,HOLD,Inspect paint,"[{""sourceKey"":""p-a2"",""amount"":""200000.00"",""date"":""2026-01-12"",""method"":""CASH"",""direction"":""IN"",""category"":""ADVANCE""},{""sourceKey"":""p-a2r"",""amount"":""120000.00"",""date"":""2026-01-18"",""method"":""BANK_TRANSFER"",""direction"":""OUT"",""category"":""REFUND""}]"',
      // Invalid ACTIVE advance with resolutionDate + retainedAmount > amount
      "adv-3,cyc-3,cust-1,1000.00,1500.00,case-3,2026-01-15,1000.00,2026-01-10,2026-01-10T18:30:00Z,ACTIVE,,100.00,2026-01-16,,,,[]",
    ].join("\n")

    const res = await parseImportBuffer("ADVANCES", "CSV", Buffer.from(advCsv, "utf8"))
    expect(res.valid).toBe(false)
    expect(res.validRows).toHaveLength(2)
    expect(res.controlTotals).toEqual({
      rows: 2,
      purchase: "0",
      cost: "0",
      consideration: "0",
      cashIn: "70000000",
      cashOut: "12000000",
      byType: [{ type: "ADVANCES", rows: 2 }],
    })
    expect(res.rows[2].errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rowNumber: 4,
          field: "amount",
          code: "BALANCE_MISMATCH",
        }),
        expect.objectContaining({
          rowNumber: 4,
          field: "validThrough",
          code: "CHRONOLOGY_VIOLATION",
        }),
        expect.objectContaining({
          rowNumber: 4,
          field: "resolutionDate",
          code: "INVALID_STATE",
        }),
      ])
    )
    // Verify computeControlTotals / computeImportDigest are directly callable.
    expect(computeControlTotals(res.validRows)).toEqual(res.controlTotals)
    expect(computeImportDigest(res.validRows)).toBe(res.digest)
  })
})

it("parses a lease sale that converts a historical advance", async () => {
  const columns = getImportTemplateSchema("SALES").columns
  const values: Record<string, string> = {
    kind: "LEASE", price: "5500000.00", reservationSourceKey: "adv-001",
    financeCompanySourceKey: "lender-001", downPayment: "500000.00",
    financeAmount: "4500000.00", termMonths: "36", doIssueDate: "2026-01-19",
    payments: "[]",
  }
  const result = await parseImportBuffer("SALES", "XLSX", buildXlsx([{
    name: "SALES",
    rows: [columns.map((c) => c.name), columns.map((c) => values[c.name] ?? c.example)],
  }]), { namespace: "synthetic" })
  expect(result.validRows).toHaveLength(1)
})
