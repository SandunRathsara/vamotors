import "server-only"
import type {
  ApprovalProvenance,
  Money,
  ReportFilter,
  ReportKind,
  ReportRow,
  Visible,
} from "../../.planning/implementation/contracts/api"
import {
  B,
  bounded,
  cashTotals,
  formatCurrency,
  major,
  minor,
  sum,
} from "../money"

export type ReportColumnFormat =
  | "text"
  | "money"
  | "date"
  | "number"
  | "boolean"
  | "percent"

export interface ReportColumn {
  readonly key: string
  readonly label: string
  readonly format: ReportColumnFormat
  readonly permissionFields: readonly string[]
  readonly totalKey?: string
  readonly signed?: boolean
}

export interface BuildReportCsvInput<K extends ReportKind = ReportKind> {
  kind: K
  rows: readonly Visible<ReportRow[K]>[]
  totals?: Record<string, Money>
  filters?: Partial<Omit<ReportFilter, "page" | "pageSize">>
  redactedFields?: readonly string[]
  currency?: string
  includeTotals?: boolean
}

export interface BuildReportCsvResult {
  bytes: Uint8Array
  filename: string
  rowCount: number
}

export interface PlanReportPdfPartsInput<K extends ReportKind = ReportKind> {
  kind: K
  rows: readonly Visible<ReportRow[K]>[]
  totals?: Record<string, Money>
  filters?: Partial<Omit<ReportFilter, "page" | "pageSize">>
  redactedFields?: readonly string[]
  currency?: string
  maxRowsPerPart?: number
}

export interface ReportPdfPartSpec<K extends ReportKind = ReportKind> {
  kind: K
  partNumber: number
  totalParts: number
  firstRow: number
  lastRow: number
  totalRows: number
  rows: Visible<ReportRow[K]>[]
  includeTotals: boolean
  totals: Record<string, Money> | null
  formattedTotals: Record<string, string> | null
  columns: readonly ReportColumn[]
  title: string
  subtitle: string
  currency: string
  estimatedPages: number
}

export const REPORT_PDF_MAX_PAGES = 50
export const REPORT_EXPORT_DEFAULT_CURRENCY = "LKR"

export const REPORT_TITLES: Readonly<Record<ReportKind, string>> = {
  INVENTORY: "Current Vehicle Inventory Report",
  SOLD: "Vehicles Sold Report",
  PROFIT: "Profit per Vehicle Report",
  ADVANCES: "Outstanding Advances Report",
  REPAIRS: "Vehicles Currently in Repair Report",
  CASH_FLOW: "Cash Flow Summary Report",
  DISPOSALS: "Write-Off and Disposal Report",
  PURCHASES: "Purchases per Period Report",
}

export const REPORT_COLUMNS: Readonly<
  Record<ReportKind, readonly ReportColumn[]>
> = {
  INVENTORY: [
    {
      key: "cycleId",
      label: "Cycle ID",
      format: "text",
      permissionFields: ["cycleId"],
    },
    {
      key: "id",
      label: "Vehicle ID",
      format: "text",
      permissionFields: ["id"],
    },
    {
      key: "identity.make",
      label: "Make",
      format: "text",
      permissionFields: ["identity.make"],
    },
    {
      key: "identity.model",
      label: "Model",
      format: "text",
      permissionFields: ["identity.model"],
    },
    {
      key: "identity.year",
      label: "Year",
      format: "number",
      permissionFields: ["identity.year"],
    },
    {
      key: "identity.colour",
      label: "Colour",
      format: "text",
      permissionFields: ["identity.colour"],
    },
    {
      key: "identity.engineNumber",
      label: "Engine Number",
      format: "text",
      permissionFields: ["identity.engineNumber"],
    },
    {
      key: "identity.chassisNumber",
      label: "Chassis Number",
      format: "text",
      permissionFields: ["identity.chassisNumber"],
    },
    {
      key: "identity.vin",
      label: "VIN",
      format: "text",
      permissionFields: ["identity.vin"],
    },
    {
      key: "identity.crNumber",
      label: "CR Number",
      format: "text",
      permissionFields: ["identity.crNumber"],
    },
    {
      key: "identity.fuelType",
      label: "Fuel Type",
      format: "text",
      permissionFields: ["identity.fuelType"],
    },
    {
      key: "identity.transmission",
      label: "Transmission",
      format: "text",
      permissionFields: ["identity.transmission"],
    },
    {
      key: "purchaseDate",
      label: "Purchase Date",
      format: "date",
      permissionFields: ["purchaseDate"],
    },
    {
      key: "daysHeld",
      label: "Days Held",
      format: "number",
      permissionFields: ["purchaseDate"],
    },
    {
      key: "status",
      label: "Status",
      format: "text",
      permissionFields: ["status"],
    },
    {
      key: "available",
      label: "Available",
      format: "boolean",
      permissionFields: ["available"],
    },
    {
      key: "holdReason",
      label: "Hold Reason",
      format: "text",
      permissionFields: ["holdReason"],
    },
    {
      key: "listedPrice",
      label: "Listed Price",
      format: "money",
      permissionFields: ["listedPrice"],
      totalKey: "listedPrice",
    },
    {
      key: "financial.purchase",
      label: "Purchase Cost",
      format: "money",
      permissionFields: [
        "financial.purchase",
        "purchase",
        "purchasePrice",
        "cost",
      ],
      totalKey: "purchase",
    },
    {
      key: "financial.repairs",
      label: "Repair Costs",
      format: "money",
      permissionFields: ["financial.repairs", "repairs", "cost"],
      totalKey: "repairs",
    },
    {
      key: "financial.additionalCosts",
      label: "Additional Costs",
      format: "money",
      permissionFields: [
        "financial.additionalCosts",
        "additionalCosts",
        "cost",
      ],
      totalKey: "additionalCosts",
    },
    {
      key: "financial.basis",
      label: "Cost Basis",
      format: "money",
      permissionFields: ["financial.basis", "basis", "costBasis", "cost"],
      totalKey: "basis",
    },
  ],
  SOLD: [
    {
      key: "saleId",
      label: "Sale ID",
      format: "text",
      permissionFields: ["saleId"],
    },
    {
      key: "cycleId",
      label: "Cycle ID",
      format: "text",
      permissionFields: ["cycleId"],
    },
    {
      key: "date",
      label: "Sale Date",
      format: "date",
      permissionFields: ["date"],
    },
    {
      key: "vehicle",
      label: "Vehicle",
      format: "text",
      permissionFields: ["vehicle"],
    },
    {
      key: "customer",
      label: "Customer",
      format: "text",
      permissionFields: ["customer"],
    },
    {
      key: "type",
      label: "Sale Type",
      format: "text",
      permissionFields: ["type"],
    },
    {
      key: "method",
      label: "Payment Method",
      format: "text",
      permissionFields: ["method"],
    },
    {
      key: "financial.salePrice",
      label: "Sale Price",
      format: "money",
      permissionFields: ["financial.salePrice", "salePrice"],
      totalKey: "salePrice",
    },
    {
      key: "financial.originalBasis",
      label: "Original Cost Basis",
      format: "money",
      permissionFields: [
        "financial.originalBasis",
        "originalBasis",
        "financial.basis",
        "basis",
        "costBasis",
        "cost",
      ],
      totalKey: "originalBasis",
    },
    {
      key: "financial.basis",
      label: "Cost Basis",
      format: "money",
      permissionFields: ["financial.basis", "basis", "costBasis", "cost"],
      totalKey: "basis",
    },
    {
      key: "financial.originalProfit",
      label: "Original Profit",
      format: "money",
      permissionFields: [
        "financial.originalProfit",
        "originalProfit",
        "profit",
      ],
      totalKey: "originalProfit",
      signed: true,
    },
    {
      key: "financial.restatedProfit",
      label: "Restated Profit",
      format: "money",
      permissionFields: [
        "financial.restatedProfit",
        "restatedProfit",
        "profit",
      ],
      totalKey: "restatedProfit",
      signed: true,
    },
  ],
  PROFIT: [
    {
      key: "cycleId",
      label: "Cycle ID",
      format: "text",
      permissionFields: ["cycleId"],
    },
    {
      key: "vehicle",
      label: "Vehicle",
      format: "text",
      permissionFields: ["vehicle"],
    },
    {
      key: "status",
      label: "Status",
      format: "text",
      permissionFields: ["status"],
    },
    {
      key: "date",
      label: "Date",
      format: "date",
      permissionFields: ["date"],
    },
    {
      key: "financial.purchase",
      label: "Purchase Cost",
      format: "money",
      permissionFields: [
        "financial.purchase",
        "purchase",
        "purchasePrice",
        "cost",
      ],
      totalKey: "purchase",
    },
    {
      key: "financial.repairs",
      label: "Repair Costs",
      format: "money",
      permissionFields: ["financial.repairs", "repairs", "cost"],
      totalKey: "repairs",
    },
    {
      key: "financial.additionalCosts",
      label: "Additional Costs",
      format: "money",
      permissionFields: [
        "financial.additionalCosts",
        "additionalCosts",
        "cost",
      ],
      totalKey: "additionalCosts",
    },
    {
      key: "financial.originalBasis",
      label: "Original Cost Basis",
      format: "money",
      permissionFields: [
        "financial.originalBasis",
        "originalBasis",
        "financial.basis",
        "basis",
        "costBasis",
        "cost",
      ],
      totalKey: "originalBasis",
    },
    {
      key: "financial.basis",
      label: "Cost Basis",
      format: "money",
      permissionFields: ["financial.basis", "basis", "costBasis", "cost"],
      totalKey: "basis",
    },
    {
      key: "financial.salePrice",
      label: "Sale Price",
      format: "money",
      permissionFields: ["financial.salePrice", "salePrice"],
      totalKey: "salePrice",
    },
    {
      key: "financial.originalProfit",
      label: "Original Profit",
      format: "money",
      permissionFields: [
        "financial.originalProfit",
        "originalProfit",
        "profit",
      ],
      totalKey: "originalProfit",
      signed: true,
    },
    {
      key: "financial.restatedProfit",
      label: "Restated Profit",
      format: "money",
      permissionFields: [
        "financial.restatedProfit",
        "restatedProfit",
        "profit",
      ],
      totalKey: "restatedProfit",
      signed: true,
    },
    {
      key: "marginPercent",
      label: "Margin (%)",
      format: "percent",
      permissionFields: [
        "marginPercent",
        "financial.originalProfit",
        "financial.restatedProfit",
        "profit",
        "financial.salePrice",
        "salePrice",
      ],
    },
    {
      key: "components",
      label: "Cost Components",
      format: "text",
      permissionFields: [
        "components",
        "cost",
        "financial.purchase",
        "financial.repairs",
        "financial.additionalCosts",
        "purchasePrice",
      ],
    },
  ],
  ADVANCES: [
    {
      key: "reservationId",
      label: "Reservation ID",
      format: "text",
      permissionFields: ["reservationId"],
    },
    {
      key: "cycleId",
      label: "Cycle ID",
      format: "text",
      permissionFields: ["cycleId"],
    },
    {
      key: "customer",
      label: "Customer",
      format: "text",
      permissionFields: ["customer"],
    },
    {
      key: "vehicle",
      label: "Vehicle",
      format: "text",
      permissionFields: ["vehicle"],
    },
    {
      key: "placedDate",
      label: "Placed Date",
      format: "date",
      permissionFields: ["placedDate"],
    },
    {
      key: "state",
      label: "State",
      format: "text",
      permissionFields: ["state"],
    },
    {
      key: "amount",
      label: "Advance Amount",
      format: "money",
      permissionFields: ["amount"],
      totalKey: "amount",
    },
    {
      key: "listedBasis",
      label: "Listed Price Basis",
      format: "money",
      permissionFields: ["listedBasis", "listedPrice", "basis", "cost"],
      totalKey: "listedBasis",
    },
    {
      key: "agreed",
      label: "Agreed Price",
      format: "money",
      permissionFields: ["agreed", "agreedPrice"],
      totalKey: "agreed",
    },
    {
      key: "percentDisplay",
      label: "Advance %",
      format: "percent",
      permissionFields: ["percentDisplay", "amount", "listedBasis"],
    },
    {
      key: "validThrough",
      label: "Valid Through",
      format: "date",
      permissionFields: ["validThrough"],
    },
    {
      key: "daysOutstanding",
      label: "Days Outstanding",
      format: "number",
      permissionFields: ["daysOutstanding"],
    },
    {
      key: "daysOverdue",
      label: "Days Overdue",
      format: "number",
      permissionFields: ["daysOverdue"],
    },
  ],
  REPAIRS: [
    {
      key: "repairId",
      label: "Repair ID",
      format: "text",
      permissionFields: ["repairId"],
    },
    {
      key: "cycleId",
      label: "Cycle ID",
      format: "text",
      permissionFields: ["cycleId"],
    },
    {
      key: "vehicle",
      label: "Vehicle",
      format: "text",
      permissionFields: ["vehicle"],
    },
    {
      key: "vendorId",
      label: "Vendor ID",
      format: "text",
      permissionFields: ["vendorId"],
    },
    {
      key: "vendor",
      label: "Vendor",
      format: "text",
      permissionFields: ["vendor"],
    },
    {
      key: "request",
      label: "Repair Request",
      format: "text",
      permissionFields: ["request"],
    },
    {
      key: "sentDate",
      label: "Date Sent",
      format: "date",
      permissionFields: ["sentDate"],
    },
    {
      key: "daysInRepair",
      label: "Days in Repair",
      format: "number",
      permissionFields: ["daysInRepair"],
    },
  ],
  CASH_FLOW: [
    {
      key: "paymentId",
      label: "Payment ID",
      format: "text",
      permissionFields: ["paymentId"],
    },
    {
      key: "date",
      label: "Date",
      format: "date",
      permissionFields: ["date"],
    },
    {
      key: "sourceType",
      label: "Source Type",
      format: "text",
      permissionFields: ["sourceType"],
    },
    {
      key: "sourceId",
      label: "Source ID",
      format: "text",
      permissionFields: ["sourceId"],
    },
    {
      key: "category",
      label: "Category",
      format: "text",
      permissionFields: ["category"],
    },
    {
      key: "direction",
      label: "Direction",
      format: "text",
      permissionFields: ["direction"],
    },
    {
      key: "method",
      label: "Method",
      format: "text",
      permissionFields: ["method"],
    },
    {
      key: "amount",
      label: "Amount",
      format: "money",
      permissionFields: ["amount"],
      totalKey: "net",
      signed: true,
    },
  ],
  PURCHASES: [
    {
      key: "cycleId",
      label: "Cycle ID",
      format: "text",
      permissionFields: ["cycleId"],
    },
    {
      key: "date",
      label: "Purchase date",
      format: "date",
      permissionFields: ["date"],
    },
    {
      key: "vehicle",
      label: "Vehicle",
      format: "text",
      permissionFields: ["vehicle"],
    },
    {
      key: "seller",
      label: "Seller",
      format: "text",
      permissionFields: ["seller"],
    },
    {
      key: "purchaseType",
      label: "Purchase type",
      format: "text",
      permissionFields: ["purchaseType"],
    },
    {
      key: "status",
      label: "Status",
      format: "text",
      permissionFields: ["status"],
    },
    {
      key: "price",
      label: "Purchase price",
      format: "money",
      permissionFields: ["price"],
      totalKey: "purchasePrice",
    },
  ],
  DISPOSALS: [
    {
      key: "cycleId",
      label: "Cycle ID",
      format: "text",
      permissionFields: ["cycleId"],
    },
    {
      key: "vehicle",
      label: "Vehicle",
      format: "text",
      permissionFields: ["vehicle"],
    },
    {
      key: "date",
      label: "Disposal Date",
      format: "date",
      permissionFields: ["date"],
    },
    {
      key: "method",
      label: "Method",
      format: "text",
      permissionFields: ["method"],
    },
    {
      key: "reason",
      label: "Reason",
      format: "text",
      permissionFields: ["reason"],
    },
    {
      key: "approval.kind",
      label: "Approval Kind",
      format: "text",
      permissionFields: ["approval.kind"],
    },
    {
      key: "approval.approver",
      label: "Approver",
      format: "text",
      permissionFields: [
        "approval.reviewerName",
        "approval.legacy",
        "approval.legacy.approverName",
        "approver",
      ],
    },
    {
      key: "basis",
      label: "Cost Basis",
      format: "money",
      permissionFields: ["basis", "financial.basis", "costBasis", "cost"],
      totalKey: "basis",
    },
    {
      key: "proceeds",
      label: "Proceeds",
      format: "money",
      permissionFields: ["proceeds"],
      totalKey: "proceeds",
    },
    {
      key: "netLoss",
      label: "Net Loss",
      format: "money",
      permissionFields: [
        "netLoss",
        "basis",
        "proceeds",
        "financial.basis",
        "costBasis",
        "cost",
      ],
      totalKey: "netLoss",
      signed: true,
    },
    {
      key: "restatedBasis",
      label: "Restated Cost Basis",
      format: "money",
      permissionFields: ["basis", "financial.basis", "cost"],
      totalKey: "restatedBasis",
    },
    {
      key: "restatedLoss",
      label: "Restated Net Loss",
      format: "money",
      signed: true,
      permissionFields: ["basis", "proceeds", "financial.basis", "cost"],
      totalKey: "restatedLoss",
    },
  ],
}

function assertReportKind(kind: ReportKind): void {
  if (!Object.hasOwn(REPORT_COLUMNS, kind)) {
    throw new RangeError(`Unsupported report kind: ${String(kind)}`)
  }
}

function matchesRedaction(
  fieldPath: string,
  redactedFields: readonly string[]
): boolean {
  for (const raw of redactedFields) {
    const pattern = raw.trim()
    if (!pattern) continue
    if (pattern === "*") return true
    const clean = pattern.endsWith(".*") ? pattern.slice(0, -2) : pattern
    if (fieldPath === clean || fieldPath.startsWith(`${clean}.`)) {
      return true
    }
  }
  return false
}

export function isColumnRedacted(
  column: ReportColumn,
  redactedFields: readonly string[]
): boolean {
  if (redactedFields.length === 0) return false
  if (matchesRedaction(column.key, redactedFields)) return true
  return column.permissionFields.some((pf) =>
    matchesRedaction(pf, redactedFields)
  )
}

export function getReportColumns(
  kind: ReportKind,
  redactedFields: readonly string[] = []
): readonly ReportColumn[] {
  assertReportKind(kind)
  return REPORT_COLUMNS[kind].filter(
    (col) => !isColumnRedacted(col, redactedFields)
  )
}

function valueAtPath(row: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (current && typeof current === "object" && !Array.isArray(current)) {
      return (current as Record<string, unknown>)[segment]
    }
    return undefined
  }, row)
}

export function reportCellValue(
  kind: ReportKind,
  row: unknown,
  columnKey: string
): unknown {
  if (kind === "DISPOSALS" && columnKey === "approval.approver") {
    const approval = valueAtPath(row, "approval") as
      | ApprovalProvenance
      | undefined
    if (!approval || typeof approval !== "object") return undefined
    if (approval.kind === "CURRENT") return approval.reviewerName
    if (approval.kind === "IMPORTED") return approval.legacy?.approverName
    return undefined
  }
  if (kind === "PROFIT" && columnKey === "components") {
    const components = valueAtPath(row, "components") as
      | readonly {
          type?: string
          date?: string
          amount?: Money
          description?: string
        }[]
      | undefined
    if (components === undefined || components === null) return undefined
    return components
      .map((c) => {
        const formattedAmount =
          typeof c.amount === "string" ? major(minor(c.amount, B, true)) : ""
        const header = [c.date, c.type].filter(Boolean).join(" ")
        const desc = c.description ?? ""
        return formattedAmount
          ? `${header}: ${desc} (${formattedAmount})`.trim()
          : `${header}: ${desc}`.trim()
      })
      .join("; ")
  }
  return valueAtPath(row, columnKey)
}

/**
 * Formats a single cell value according to column format.
 * Missing/undefined/null values always return `""` — never substituting `"0"`
 * or `"0.00"` for absent or redacted financial fields.
 */
export function formatReportCell(
  value: unknown,
  format: ReportColumnFormat,
  signed = false,
  currency?: string
): string {
  if (value === undefined || value === null) return ""
  switch (format) {
    case "money": {
      if (typeof value !== "string" || value.length === 0) return ""
      return formatCurrency(
        minor(value, B, signed),
        currency ?? "",
        currency ? "display" : "decimal"
      )
    }
    case "number": {
      if (typeof value === "number") {
        return Number.isFinite(value) ? String(value) : ""
      }
      if (typeof value === "bigint") return value.toString()
      if (typeof value === "string") return value
      return ""
    }
    case "boolean": {
      if (typeof value === "boolean") return value ? "true" : "false"
      return String(value)
    }
    case "percent": {
      const str = String(value)
      if (str.length === 0) return ""
      return str.endsWith("%") ? str : `${str}%`
    }
    case "date":
    case "text":
      return String(value)
  }
}

/**
 * Neutralizes spreadsheet formula injection (CSV/CWE-1236).
 *
 * Free-text cells beginning with `=`, `+`, `-`, `@`, `\t`, or `\r` (or ASCII
 * spaces followed by `=`, `+`, `-`, `@`) are prefixed with a leading single
 * quote `'`.
 *
 * Validated numeric/money cells (`money` matching `^-?\d+\.\d{2}$`, `number`
 * matching `^-?\d+(\.\d+)?$`, and strict numeric `percent` matching
 * `^-?\d+(\.\d+)?%?$`) are kept intact so negative financial values such as
 * `-250.00` or `-12.50%` preserve numeric semantics without allowing formula
 * expressions (e.g. `-1+1` or `=CMD|...` are still neutralized).
 */
export function neutralizeCsvFormula(
  value: string,
  format: ReportColumnFormat
): string {
  if (value.length === 0) return ""
  if (format === "money" && /^-?\d+\.\d{2}$/.test(value)) {
    return value
  }
  if (format === "number" && /^-?\d+(\.\d+)?$/.test(value)) {
    return value
  }
  if (format === "percent" && /^-?\d+(\.\d+)?%?$/.test(value)) {
    return value
  }
  if (/^(?:[=+\-@\t\r]| +[=+@-])/.test(value)) {
    return `'${value}`
  }
  return value
}

/** Applies RFC 4180 quoting when a field contains comma, quote, CR, or LF. */
function quoteCsvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function formatCsvCell(
  value: unknown,
  format: ReportColumnFormat,
  signed = false
): string {
  const formatted = formatReportCell(value, format, signed)
  const safe = neutralizeCsvFormula(formatted, format)
  return quoteCsvField(safe)
}

interface ResolvedTotals {
  minor: Record<string, Money>
  formatted: Record<string, string>
  columnTotals: Map<string, string>
  cashFlowSummary?: {
    cashIn: Money
    cashOut: Money
    net: Money
  }
}

function resolveReportTotals<K extends ReportKind>(
  kind: K,
  rows: readonly Visible<ReportRow[K]>[],
  visibleColumns: readonly ReportColumn[],
  totals: Record<string, Money> | undefined
): ResolvedTotals {
  const minorTotals: Record<string, Money> = {}
  const formattedTotals: Record<string, string> = {}
  const columnTotals = new Map<string, string>()

  if (kind === "CASH_FLOW") {
    const amountVisible = visibleColumns.some((c) => c.key === "amount")
    if (!amountVisible) {
      return { minor: minorTotals, formatted: formattedTotals, columnTotals }
    }

    const directionVisible = visibleColumns.some((c) => c.key === "direction")
    const rawIn = totals?.cashIn ?? totals?.incoming
    const rawOut = totals?.cashOut ?? totals?.outgoing
    const rawNet = totals?.net

    let cashInValue: bigint | undefined
    let cashOutValue: bigint | undefined
    let netValue: bigint | undefined

    if (rawIn !== undefined) cashInValue = minor(rawIn, B, false)
    if (rawOut !== undefined) cashOutValue = minor(rawOut, B, false)
    if (rawNet !== undefined) netValue = minor(rawNet, B, true)

    if (
      (cashInValue === undefined ||
        cashOutValue === undefined ||
        netValue === undefined) &&
      directionVisible
    ) {
      const facts: { direction: "IN" | "OUT"; amount: string }[] = []
      for (const row of rows) {
        const dir = valueAtPath(row, "direction")
        const amt = valueAtPath(row, "amount")
        if ((dir === "IN" || dir === "OUT") && typeof amt === "string") {
          facts.push({ direction: dir, amount: amt })
        }
      }
      if (
        facts.length > 0 ||
        rawIn !== undefined ||
        rawOut !== undefined ||
        rawNet !== undefined
      ) {
        const computed = cashTotals(facts)
        if (cashInValue === undefined) {
          cashInValue = minor(computed.incoming, B, false)
        }
        if (cashOutValue === undefined) {
          cashOutValue = minor(computed.outgoing, B, false)
        }
        if (netValue === undefined) {
          netValue = bounded(cashInValue - cashOutValue, B)
        }
      }
    } else if (
      netValue === undefined &&
      cashInValue !== undefined &&
      cashOutValue !== undefined
    ) {
      netValue = bounded(cashInValue - cashOutValue, B)
    }

    if (cashInValue !== undefined) {
      minorTotals.cashIn = cashInValue.toString()
      formattedTotals.cashIn = major(cashInValue)
    }
    if (cashOutValue !== undefined) {
      minorTotals.cashOut = cashOutValue.toString()
      formattedTotals.cashOut = major(cashOutValue)
    }
    if (netValue !== undefined) {
      minorTotals.net = netValue.toString()
      formattedTotals.net = major(netValue)
      columnTotals.set("amount", formattedTotals.net)
    }

    return {
      minor: minorTotals,
      formatted: formattedTotals,
      columnTotals,
      cashFlowSummary:
        cashInValue !== undefined &&
        cashOutValue !== undefined &&
        netValue !== undefined
          ? {
              cashIn: cashInValue.toString(),
              cashOut: cashOutValue.toString(),
              net: netValue.toString(),
            }
          : undefined,
    }
  }

  for (const col of visibleColumns) {
    if (col.format !== "money") continue
    const key = col.totalKey ?? col.key
    const explicit =
      totals?.[col.key] ??
      (col.totalKey !== undefined ? totals?.[col.totalKey] : undefined)

    if (explicit !== undefined) {
      const value = minor(explicit, B, Boolean(col.signed))
      minorTotals[key] = value.toString()
      const formatted = major(value)
      formattedTotals[key] = formatted
      columnTotals.set(col.key, formatted)
      continue
    }

    const rowValues: bigint[] = []
    for (const row of rows) {
      const raw = reportCellValue(kind, row, col.key)
      if (typeof raw === "string" && raw.length > 0) {
        rowValues.push(minor(raw, B, Boolean(col.signed)))
      }
    }

    if (rowValues.length > 0) {
      const totalBigint = sum(rowValues, B)
      minorTotals[key] = totalBigint.toString()
      const formatted = major(totalBigint)
      formattedTotals[key] = formatted
      columnTotals.set(col.key, formatted)
    }
  }

  return {
    minor: minorTotals,
    formatted: formattedTotals,
    columnTotals,
  }
}

function buildCsvFilename(
  kind: ReportKind,
  filters?: Partial<Omit<ReportFilter, "page" | "pageSize">>
): string {
  const slug = kind.toLowerCase().replace(/_/g, "-")
  const parts = [`${slug}-report`]
  const sanitizeSegment = (val: string) =>
    val.trim().replace(/[^a-zA-Z0-9_-]/g, "")
  if (filters?.from) {
    const from = sanitizeSegment(filters.from)
    if (from) parts.push(`from-${from}`)
  }
  if (filters?.through) {
    const through = sanitizeSegment(filters.through)
    if (through) parts.push(`to-${through}`)
  }
  return `${parts.join("-")}.csv`.slice(0, 200)
}

function buildTotalsCsvLine(
  kind: ReportKind,
  visibleColumns: readonly ReportColumn[],
  resolved: ResolvedTotals
): string | null {
  if (visibleColumns.length === 0 || resolved.columnTotals.size === 0) {
    return null
  }
  const labelIndex = visibleColumns.findIndex((c) => c.format !== "money")
  const cells = visibleColumns.map((col, idx) => {
    const total = resolved.columnTotals.get(col.key)
    if (total !== undefined) {
      return quoteCsvField(neutralizeCsvFormula(total, col.format))
    }
    if (
      kind === "CASH_FLOW" &&
      col.key === "direction" &&
      resolved.columnTotals.has("amount")
    ) {
      return quoteCsvField("NET")
    }
    if (
      kind === "CASH_FLOW" &&
      col.key === "category" &&
      resolved.cashFlowSummary
    ) {
      return quoteCsvField(
        `Inflow: ${resolved.formatted.cashIn} | Outflow: ${resolved.formatted.cashOut}`
      )
    }
    if (idx === (labelIndex >= 0 ? labelIndex : 0)) {
      return quoteCsvField("TOTALS")
    }
    return ""
  })
  return cells.join(",")
}

/**
 * Builds an RFC 4180 UTF-8 CSV export over the full filtered authorized
 * population with formula-injection neutralization and visible-only totals.
 */
export function buildReportCsv<K extends ReportKind>({
  kind,
  rows,
  totals,
  filters,
  redactedFields = [],
  includeTotals = true,
  currency,
}: BuildReportCsvInput<K>): BuildReportCsvResult {
  assertReportKind(kind)
  const visibleColumns = getReportColumns(kind, redactedFields)
  const lines: string[] = []

  if (visibleColumns.length > 0) {
    lines.push(
      visibleColumns
        .map((col) =>
          quoteCsvField(
            currency && col.format === "money"
              ? `${col.label} (${currency})`
              : col.label
          )
        )
        .join(",")
    )

    for (const row of rows) {
      const cells = visibleColumns.map((col) => {
        const raw = reportCellValue(kind, row, col.key)
        return formatCsvCell(raw, col.format, Boolean(col.signed))
      })
      lines.push(cells.join(","))
    }

    if (includeTotals) {
      const resolved = resolveReportTotals(kind, rows, visibleColumns, totals)
      const totalsLine = buildTotalsCsvLine(kind, visibleColumns, resolved)
      if (totalsLine !== null) lines.push(totalsLine)
    }
  }

  const csvText = lines.length > 0 ? `${lines.join("\r\n")}\r\n` : ""
  return {
    bytes: new TextEncoder().encode(csvText),
    filename: buildCsvFilename(kind, filters),
    rowCount: rows.length,
  }
}

/**
 * Conservative rows-per-page capacity ensuring rendered PDF tables remain
 * strictly within the 50-page private-file `validateDocument` ceiling.
 */
function rowsPerPdfPage(columnCount: number): number {
  if (columnCount <= 8) return 25
  if (columnCount <= 14) return 18
  return 12
}

function maxRowsWithinPdfPageLimit(columnCount: number): number {
  const perPage = rowsPerPdfPage(columnCount)
  // Reserve headroom for header/filter banner + final grand-totals summary
  const safePages = REPORT_PDF_MAX_PAGES - 5
  return Math.min(1000, perPage * safePages)
}

function estimatePdfPages(
  rowCount: number,
  columnCount: number,
  includeTotals: boolean
): number {
  const perPage = rowsPerPdfPage(columnCount)
  const effectiveRows = rowCount + (includeTotals ? 2 : 1)
  return Math.max(1, Math.ceil(effectiveRows / perPage))
}

function sanitizeRowForRedaction<K extends ReportKind>(
  row: Visible<ReportRow[K]>,
  redactedFields: readonly string[],
  excludedColumnKeys: ReadonlySet<string>
): Visible<ReportRow[K]> {
  if (redactedFields.length === 0 && excludedColumnKeys.size === 0) {
    return structuredClone(row)
  }

  const visit = (value: unknown, prefix: string): unknown => {
    if (Array.isArray(value)) {
      return value.map((item) =>
        item && typeof item === "object" ? visit(item, prefix) : item
      )
    }
    if (!value || typeof value !== "object") {
      return value
    }

    const output: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(
      value as Record<string, unknown>
    )) {
      const path = prefix ? `${prefix}.${key}` : key
      if (
        matchesRedaction(path, redactedFields) ||
        excludedColumnKeys.has(path)
      ) {
        continue
      }
      if (
        path === "approval" &&
        entry &&
        typeof entry === "object" &&
        excludedColumnKeys.has("approval.approver")
      ) {
        // Redact approver subfields without dropping non-redacted metadata
        const sanitizedApproval = visit(entry, path) as Record<string, unknown>
        delete sanitizedApproval.reviewerName
        if (
          sanitizedApproval.legacy &&
          typeof sanitizedApproval.legacy === "object"
        ) {
          const legacyCopy = {
            ...(sanitizedApproval.legacy as Record<string, unknown>),
          }
          delete legacyCopy.approverName
          if (Object.keys(legacyCopy).length === 0) {
            delete sanitizedApproval.legacy
          } else {
            sanitizedApproval.legacy = legacyCopy
          }
        }
        if (Object.keys(sanitizedApproval).length > 0) {
          output[key] = sanitizedApproval
        }
        continue
      }
      if (entry && typeof entry === "object") {
        const nested = visit(entry, path)
        if (
          Array.isArray(nested) ||
          (nested &&
            typeof nested === "object" &&
            Object.keys(nested as Record<string, unknown>).length > 0)
        ) {
          output[key] = nested
        }
        continue
      }
      output[key] = entry
    }
    return output
  }

  return visit(row, "") as Visible<ReportRow[K]>
}

function formatFilterSummary(
  filters: Partial<Omit<ReportFilter, "page" | "pageSize">> | undefined
): string {
  if (!filters) return "Filters: All"
  const parts: string[] = []
  if (filters.from || filters.through) {
    parts.push(`Period: ${filters.from ?? "*"} to ${filters.through ?? "*"}`)
  }
  if (filters.statuses && filters.statuses.length > 0) {
    parts.push(`Statuses: ${filters.statuses.join(", ")}`)
  }
  if (filters.available !== undefined) {
    parts.push(`Available: ${filters.available ? "Yes" : "No"}`)
  }
  if (filters.make) parts.push(`Make: ${filters.make}`)
  if (filters.model) parts.push(`Model: ${filters.model}`)
  if (filters.saleType) parts.push(`Sale Type: ${filters.saleType}`)
  if (filters.method) parts.push(`Method: ${filters.method}`)
  if (filters.vendorId) parts.push(`Vendor: ${filters.vendorId}`)
  if (filters.profitOnly) parts.push("Profit Only")
  if (filters.lossOnly) parts.push("Loss Only")
  if (filters.q) parts.push(`Search: ${filters.q}`)
  return parts.length > 0 ? parts.join(" | ") : "Filters: All"
}

/**
 * Deterministically partitions a full filtered report population into ordered
 * PDF part specifications bounded strictly within the 50-page document limit,
 * with full-population grand totals attached to the final part.
 */
export function planReportPdfParts<K extends ReportKind>({
  kind,
  rows,
  totals,
  filters,
  redactedFields = [],
  currency = REPORT_EXPORT_DEFAULT_CURRENCY,
  maxRowsPerPart,
}: PlanReportPdfPartsInput<K>): ReportPdfPartSpec<K>[] {
  assertReportKind(kind)
  if (
    maxRowsPerPart !== undefined &&
    (!Number.isInteger(maxRowsPerPart) || maxRowsPerPart < 1)
  ) {
    throw new RangeError("maxRowsPerPart must be a positive integer")
  }

  const allColumns = REPORT_COLUMNS[kind]
  const visibleColumns = getReportColumns(kind, redactedFields)
  const visibleKeys = new Set(visibleColumns.map((c) => c.key))
  const excludedColumnKeys = new Set(
    allColumns.map((c) => c.key).filter((k) => !visibleKeys.has(k))
  )

  const pageSafeCap = maxRowsWithinPdfPageLimit(visibleColumns.length)
  const effectiveMaxRows =
    maxRowsPerPart !== undefined
      ? Math.min(maxRowsPerPart, pageSafeCap)
      : pageSafeCap

  const resolvedTotals = resolveReportTotals(kind, rows, visibleColumns, totals)
  const hasGrandTotals = Object.keys(resolvedTotals.minor).length > 0

  const totalRows = rows.length
  const totalParts =
    totalRows === 0 ? 1 : Math.ceil(totalRows / effectiveMaxRows)
  const title = REPORT_TITLES[kind]
  const filterSummary = formatFilterSummary(filters)

  const parts: ReportPdfPartSpec<K>[] = []
  for (let partIdx = 0; partIdx < totalParts; partIdx++) {
    const start = partIdx * effectiveMaxRows
    const end = Math.min(start + effectiveMaxRows, totalRows)
    const slice = rows.slice(start, end)
    const sanitizedRows = slice.map((r) =>
      sanitizeRowForRedaction(r, redactedFields, excludedColumnKeys)
    )
    const partNumber = partIdx + 1
    const isFinalPart = partNumber === totalParts
    const firstRow = totalRows === 0 ? 0 : start + 1
    const lastRow = totalRows === 0 ? 0 : end
    const rowRangeLabel =
      totalRows === 0
        ? "Rows 0 of 0"
        : `Rows ${firstRow}-${lastRow} of ${totalRows}`
    const subtitle = `Part ${partNumber} of ${totalParts} | ${rowRangeLabel} | Currency: ${currency} | ${filterSummary}`

    parts.push({
      kind,
      partNumber,
      totalParts,
      firstRow,
      lastRow,
      totalRows,
      rows: sanitizedRows,
      includeTotals: isFinalPart,
      totals:
        isFinalPart && hasGrandTotals ? { ...resolvedTotals.minor } : null,
      formattedTotals:
        isFinalPart && hasGrandTotals ? { ...resolvedTotals.formatted } : null,
      columns: visibleColumns,
      title,
      subtitle,
      currency,
      estimatedPages: estimatePdfPages(
        sanitizedRows.length,
        visibleColumns.length,
        isFinalPart
      ),
    })
  }

  return parts
}
