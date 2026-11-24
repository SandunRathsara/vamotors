import { z } from "zod"
import { createHash } from "node:crypto"
import readExcelFile from "read-excel-file/node"
import type {
  ApprovalProvenance,
  CashInput,
  Contact,
  ControlTotals,
  DateOnly,
  Disposition,
  ImportPayloads,
  ImportRowInput,
  ImportType,
  Instant,
  LegacyApprovalEvidence,
  LegacyMetadata,
  LegacyBrokerageStep,
  LegacyPayment,
  LegacyRef,
  Method,
  Mileage,
  Money,
  SettingsInput,
  WriteOff,
} from "../../.planning/implementation/contracts/api"
import { A, B, bounded, minor, parseMajor, sum, tierDays } from "../money"
import { states } from "../state"
import {
  brokerageInputs,
  brokerageReversalInput,
  cashInput,
  dispatchInput,
  financeInput,
  importTypes,
  reconciliationInputs,
} from "./validators"
import { canonical } from "./idempotency"
import { validateXlsx } from "./private-files/xlsx-validation.mjs"

export const IMPORT_TYPES = [
  "SUPPLIERS",
  "CUSTOMERS",
  "REPAIR_VENDORS",
  "VEHICLES",
  "SALES",
  "REPAIRS",
  "ADVANCES",
] as const satisfies readonly ImportType[]

export const IMPORT_LIMITS = {
  maxFileBytes: 5 * 1024 * 1024,
  maxRows: 200,
  maxChildItems: 100,
  maxColumns: 128,
  maxWorkbookCells: 10_000,
  maxCellChars: 8192,
} as const

export type ImportFormat = "CSV" | "XLSX"

export type ImportColumnSpec = {
  name: string
  type:
    | "string"
    | "enum"
    | "boolean"
    | "integer"
    | "money"
    | "date"
    | "instant"
    | "uuid"
    | "json"
  required: boolean
  description: string
  aliases?: readonly string[]
  example: string
}

export type ImportTemplateSchema = {
  version: 1
  type: ImportType
  columns: readonly ImportColumnSpec[]
}

export type ImportParseError = {
  rowNumber: number
  field: string
  code: string
  message: string
  sourceKey?: string
}

export type TypedImportRow<K extends ImportType = ImportType> = Extract<
  ImportRowInput,
  { type: K }
>

export type ParsedImportRow<K extends ImportType = ImportType> = {
  rowNumber: number
  sourceKey: string
  type: K
  normalized: TypedImportRow<K> | null
  errors: ImportParseError[]
}

export type DistinctImportKeys = {
  sourceKeys: string[]
  vehicleIdentities: string[]
  customerIdentities: string[]
  saleCaseSourceKeys: string[]
  referencedSourceKeys: string[]
  referencedExistingIds: string[]
}

export type ParsedImportResult<K extends ImportType = ImportType> = {
  valid: boolean
  type: K
  format: ImportFormat
  namespace: string
  sheetName?: string
  headers: string[]
  rows: ParsedImportRow<K>[]
  validRows: TypedImportRow<K>[]
  errors: ImportParseError[]
  controlTotals: ControlTotals
  moneyTotalsByField: Record<string, Money>
  distinctKeys: DistinctImportKeys
  digest: string
}

export type ParseImportOptions = {
  namespace?: string
  sheetName?: string
  maxRows?: number
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PHONE_RE = /^\+?[0-9][0-9 ()-]*[0-9]$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const INSTANT_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/
const FORMULA_PREFIX_RE = /^[\s]*[=+@-]/
const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/
const BINARY_SIG_RE = /^(?:#!|%PDF-|MZ|PK|\x7fELF)/
const TIMEZONE_VALID_CACHE = new Map<string, boolean>()

const METHODS = ["CASH", "BANK_TRANSFER"] as const
const PARTY_CATEGORIES = ["INDIVIDUAL", "COMPANY"] as const
const FUEL_TYPES = ["PETROL", "DIESEL", "HYBRID", "ELECTRIC", "OTHER"] as const
const TRANSMISSIONS = ["MANUAL", "AUTOMATIC", "CVT", "OTHER"] as const
const PURCHASE_TYPES = ["CASH", "LEASE_SETTLEMENT", "BRAND_NEW"] as const
const INSTITUTION_TYPES = ["FINANCE_COMPANY", "BANK", "PRIVATE_PARTY"] as const
const DISPOSAL_METHODS = ["SCRAPPED", "AUCTIONED", "DONATED", "OTHER"] as const
const SALE_KINDS = ["CASH", "ADVANCE", "LEASE", "TRADE_IN"] as const
const SALE_STATES = [
  "COMPLETED",
  "FINANCE_PENDING",
  "DO_RECEIVED",
  "CANCELLED",
] as const
const ADVANCE_STATES = [
  "ACTIVE",
  "EXPIRED",
  "CONVERTED",
  "REFUNDED",
  "CANCELLED",
] as const
const DISPOSITION_KINDS = ["RELEASE", "HOLD"] as const
const DIRECTIONS = ["IN", "OUT"] as const

const DEFAULT_TIERS: SettingsInput["tiers"] = [
  { upperBps: 500, days: 7 },
  { upperBps: 1000, days: 14 },
  { upperBps: 1500, days: 21 },
  { upperBps: null, days: 31 },
]

// Forged server/approval authority fields that must never be accepted from files.
const FORBIDDEN_AUTHORITY_HEADERS = new Set([
  "id",
  "revision",
  "createdby",
  "approvalid",
  "approvedby",
  "reviewerid",
  "reviewername",
  "reviewedby",
  "reviewedat",
  "batchid",
  "rowid",
  "initiatedbyadminid",
  "historicalapprovalbypass",
  "commandid",
  "businesssequence",
  "actor",
  "actorkind",
  "provenance",
])

type XlsxNumberToken = { __xlsxNum: string }
type RawCell = string | boolean | Date | XlsxNumberToken | null

function isXlsxNumberToken(value: unknown): value is XlsxNumberToken {
  return (
    typeof value === "object" &&
    value !== null &&
    "__xlsxNum" in value &&
    typeof (value as XlsxNumberToken).__xlsxNum === "string"
  )
}

function normalizeHeaderKey(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[\s_.-]+/g, "")
}

/** Normalize NIC/passport identity consistently with customer persistence. */
export function normalizeCustomerIdentity(value: string): string {
  return value.replace(/[\t\n\r\f\v ]/g, "").toUpperCase()
}

/** Normalize engine/chassis identity consistently with vehicle persistence. */
export function normalizeVehicleIdentity(value: string): string {
  return value.toUpperCase().replace(/[\t\n\r\f\v ]/g, "")
}

/** Strict Gregorian YYYY-MM-DD validation without JS Date rollover. */
export function isValidGregorianDate(value: string): boolean {
  const match = DATE_ONLY_RE.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (year < 1 || month < 1 || month > 12 || day < 1) return false
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
  const daysInMonth = [
    31,
    isLeap ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ][month - 1]
  return day <= daysInMonth
}

function isValidTimeZone(tz: string): boolean {
  const cached = TIMEZONE_VALID_CACHE.get(tz)
  if (cached !== undefined) return cached
  let valid = false
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz })
    valid = true
  } catch {
    valid = false
  }
  TIMEZONE_VALID_CACHE.set(tz, valid)
  return valid
}

function parseInstantStrict(value: string): string | null {
  const match = INSTANT_RE.exec(value.trim())
  if (!match) return null
  const datePart = `${match[1]}-${match[2]}-${match[3]}`
  if (!isValidGregorianDate(datePart)) return null
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6])
  if (hour > 23 || minute > 59 || second > 59) return null
  const ms = (match[7] ?? "0").padEnd(3, "0")
  return `${datePart}T${match[4]}:${match[5]}:${match[6]}.${ms}Z`
}

/** Parse major decimal currency text via lib/money.ts into minor-unit string. */
export function parseImportMoney(
  value: string,
  options: { positive?: boolean } = {}
): { ok: true; value: Money } | { ok: false; code: string; message: string } {
  try {
    const clean = value.trim()
    const minorStr = parseMajor(clean, false)
    if (options.positive && minorStr === "0") {
      return {
        ok: false,
        code: "NON_POSITIVE_MONEY",
        message: "Amount must be greater than zero",
      }
    }
    return { ok: true, value: minorStr }
  } catch (err) {
    if (err instanceof Error && err.message === "MONEY_OVERFLOW") {
      return {
        ok: false,
        code: "MONEY_OVERFLOW",
        message: "Monetary amount exceeds M1 bounds",
      }
    }
    return {
      ok: false,
      code: "INVALID_MONEY",
      message: "Invalid monetary amount; expected up to 2 decimal places",
    }
  }
}

function isFormulaInjection(text: string): boolean {
  return (
    text.startsWith("\t") ||
    text.startsWith("\r") ||
    FORMULA_PREFIX_RE.test(text)
  )
}

function addError(
  errors: ImportParseError[],
  rowNumber: number,
  field: string,
  code: string,
  message: string,
  sourceKey?: string
): void {
  errors.push({
    rowNumber,
    field,
    code,
    message,
    ...(sourceKey ? { sourceKey } : {}),
  })
}

// ============================================================================
// Column Schemas for All 7 Import Types
// ============================================================================

const LEGACY_METADATA_COLUMNS: readonly ImportColumnSpec[] = [
  {
    name: "legacyRecordedAt",
    type: "instant",
    required: false,
    description: "Optional historical UTC timestamp (YYYY-MM-DDTHH:mm:ss.sssZ)",
    aliases: ["recordedAt", "legacy.recordedAt"],
    example: "2026-01-10T08:30:00.000Z",
  },
  {
    name: "legacyRecordedByName",
    type: "string",
    required: false,
    description: "Optional historical staff name",
    aliases: ["recordedByName", "legacy.recordedByName"],
    example: "Historical Clerk",
  },
  {
    name: "legacyApproverName",
    type: "string",
    required: false,
    description: "Optional historical approver name",
    aliases: ["approverName", "legacy.approverName"],
    example: "",
  },
  {
    name: "legacyApprovalReference",
    type: "string",
    required: false,
    description: "Optional historical approval reference",
    aliases: ["approvalReference", "legacy.approvalReference"],
    example: "",
  },
  {
    name: "legacyOriginalId",
    type: "string",
    required: false,
    description: "Optional legacy system record identifier",
    aliases: ["originalId", "legacy.originalId"],
    example: "LEG-001",
  },
  {
    name: "legacyNotes",
    type: "string",
    required: false,
    description: "Optional legacy import annotation",
    aliases: ["legacy.notes"],
    example: "Imported synthetic baseline",
  },
]

const PARTY_COMMON_COLUMNS: readonly ImportColumnSpec[] = [
  {
    name: "sourceKey",
    type: "string",
    required: true,
    description: "Unique source key within namespace and type",
    example: "sup-001",
  },
  {
    name: "name",
    type: "string",
    required: true,
    description: "Party legal or display name",
    example: "Lanka Auto Traders",
  },
  {
    name: "category",
    type: "enum",
    required: true,
    description: "INDIVIDUAL or COMPANY",
    example: "COMPANY",
  },
  {
    name: "nicOrRegNumber",
    type: "string",
    required: false,
    description: "NIC or business registration number",
    example: "PV12345",
  },
  {
    name: "address",
    type: "string",
    required: false,
    description: "Street address",
    example: "120 Galle Road, Colombo 03",
  },
  {
    name: "phone",
    type: "string",
    required: false,
    description: "Primary phone number (digits/spaces/hyphens)",
    example: "0112345678",
  },
  {
    name: "hotline",
    type: "string",
    required: false,
    description: "Hotline phone number",
    example: "0112345679",
  },
  {
    name: "recurring",
    type: "boolean",
    required: false,
    description: "Whether party is recurring",
    example: "true",
  },
  {
    name: "notes",
    type: "string",
    required: false,
    description: "Directory notes",
    example: "Verified synthetic supplier",
  },
  {
    name: "contacts",
    type: "json",
    required: false,
    description:
      "JSON array of contacts [{name,phone,email?,role,primary}]; optional if flat contact* columns used",
    example:
      '[{"name":"Nimal Silva","phone":"0771234567","email":"nimal@example.test","role":"Manager","primary":true}]',
  },
]

const PARTY_FLAT_CONTACT_ALIASES: readonly ImportColumnSpec[] = [
  {
    name: "contactName",
    type: "string",
    required: false,
    description:
      "Convenience single-contact name when contacts JSON is omitted",
    example: "",
  },
  {
    name: "contactPhone",
    type: "string",
    required: false,
    description:
      "Convenience single-contact phone when contacts JSON is omitted",
    example: "",
  },
  {
    name: "contactEmail",
    type: "string",
    required: false,
    description:
      "Convenience single-contact email when contacts JSON is omitted",
    example: "",
  },
  {
    name: "contactRole",
    type: "string",
    required: false,
    description:
      "Convenience single-contact role when contacts JSON is omitted",
    example: "",
  },
  {
    name: "contactPrimary",
    type: "boolean",
    required: false,
    description: "Convenience single-contact primary flag",
    example: "",
  },
]

const extensionKey: ImportColumnSpec = {
  name: "sourceKey",
  type: "string",
  required: true,
  description: "Unique source key",
  example: "legacy-001",
}
const activeColumn: ImportColumnSpec = {
  name: "isActive",
  type: "boolean",
  required: false,
  description:
    "False to archive the party after importing its historical relationships",
  example: "",
}

export const IMPORT_SCHEMAS: Record<ImportType, ImportTemplateSchema> = {
  REMITTANCES: {
    version: 1,
    type: "REMITTANCES",
    columns: [
      extensionKey,
      {
        name: "companySourceKey",
        type: "string",
        required: false,
        description: "Finance company source key",
        example: "finance-001",
      },
      {
        name: "companyExistingId",
        type: "uuid",
        required: false,
        description: "Existing finance company UUID",
        example: "",
      },
      {
        name: "reference",
        type: "string",
        required: true,
        description: "Unique bank transfer reference",
        example: "BANK-001",
      },
      {
        name: "amount",
        type: "money",
        required: true,
        description: "Received amount in major currency units",
        example: "10000.00",
      },
      {
        name: "date",
        type: "date",
        required: true,
        description: "Date of receipt",
        example: "2026-01-30",
      },
      {
        name: "asOfDate",
        type: "date",
        required: true,
        description: "Historical reconciliation cutoff",
        example: "2026-01-30",
      },
      {
        name: "draftId",
        type: "uuid",
        required: false,
        description: "Existing staged remittance for the verified notice",
        example: "",
      },
      {
        name: "noticeAttachmentId",
        type: "uuid",
        required: false,
        description: "Finalized notice attachment on that draft",
        example: "",
      },
      {
        name: "noticeLines",
        type: "json",
        required: false,
        description:
          "Notice line array with distinct key, amount in major units, and description",
        example: "",
      },
      {
        name: "reversalDate",
        type: "date",
        required: false,
        description: "Date this bank receipt was reversed",
        example: "",
      },
      {
        name: "reversalReason",
        type: "string",
        required: false,
        description:
          "Historical reason for reversing this bank receipt and any allocations",
        example: "",
      },
      {
        name: "allocations",
        type: "json",
        required: false,
        description:
          "Array with source type SALES/BROKERAGE, sourceKey or existingId, amount in major currency units, and optional noticeLineKey",
        example:
          '[{"type":"SALES","sourceKey":"sale-001","amount":"10000.00"}]',
      },
      ...LEGACY_METADATA_COLUMNS,
    ],
  },
  FINANCE_COMPANIES: {
    version: 1,
    type: "FINANCE_COMPANIES",
    columns: [
      extensionKey,
      {
        name: "name",
        type: "string",
        required: true,
        description: "Finance company name",
        example: "Synthetic Finance",
      },
      {
        name: "financePolicy",
        type: "json",
        required: true,
        description: "Company policy with money in minor units",
        example:
          '{"path":"REFERRAL","commission":{"basis":"FIXED","fixed":"0","rateBps":0},"processingFee":"0","reconciliationMethod":"PER_DEAL"}',
      },
      {
        name: "financeContacts",
        type: "json",
        required: true,
        description: "Company contacts",
        example:
          '[{"name":"Finance Desk","phone":"0771234567","role":"Loan officer","primary":true}]',
      },
      ...LEGACY_METADATA_COLUMNS,
    ],
  },
  BROKERAGE: {
    version: 1,
    type: "BROKERAGE",
    columns: [
      extensionKey,
      {
        name: "customerSourceKey",
        type: "string",
        required: false,
        description: "Customer source key",
        example: "cust-001",
      },
      {
        name: "customerExistingId",
        type: "uuid",
        required: false,
        description: "Existing customer UUID",
        example: "",
      },
      {
        name: "quoteId",
        type: "uuid",
        required: true,
        description: "Existing, currently usable quote UUID",
        example: "11111111-1111-4111-8111-111111111111",
      },
      {
        name: "guarantors",
        type: "json",
        required: true,
        description: "Guarantor information",
        example:
          '[{"name":"Synthetic Guarantor","identity":"812345678V","address":"10 Park Lane","phone":"0776543210"}]',
      },
      {
        name: "existingDealId",
        type: "uuid",
        required: false,
        description: "Draft deal already holding verified historical documents",
        example: "",
      },
      {
        name: "history",
        type: "json",
        required: false,
        description:
          "Ordered brokerage commands, with the deal ID omitted. Values in payment steps are in minor units. Add a sourceKey to fee, disbursement, recovery and reversal steps. A reversal references sourceKey/fee, /payout, /deduction:N, /recover:principal, /recover:charge, /recover:fee or /replacement and supplies the exact opposite payment plus reason.",
        example: "",
      },
      ...LEGACY_METADATA_COLUMNS,
    ],
  },
  SUPPLIERS: {
    version: 1,
    type: "SUPPLIERS",
    columns: [
      ...PARTY_COMMON_COLUMNS,
      ...PARTY_FLAT_CONTACT_ALIASES,
      activeColumn,
      ...LEGACY_METADATA_COLUMNS,
    ],
  },
  REPAIR_VENDORS: {
    version: 1,
    type: "REPAIR_VENDORS",
    columns: [
      ...PARTY_COMMON_COLUMNS.slice(0, 8),
      {
        name: "specialisation",
        type: "string",
        required: false,
        description: "Repair vendor specialisation",
        aliases: ["specialization"],
        example: "Body & Paint",
      },
      ...PARTY_COMMON_COLUMNS.slice(8),
      ...PARTY_FLAT_CONTACT_ALIASES,
      activeColumn,
      ...LEGACY_METADATA_COLUMNS,
    ],
  },
  CUSTOMERS: {
    version: 1,
    type: "CUSTOMERS",
    columns: [
      {
        name: "sourceKey",
        type: "string",
        required: true,
        description: "Unique source key within namespace and type",
        example: "cust-001",
      },
      {
        name: "fullName",
        type: "string",
        required: true,
        description: "Customer full legal name",
        example: "Kamal Perera",
      },
      {
        name: "callingName",
        type: "string",
        required: true,
        description: "Preferred calling name",
        example: "Kamal",
      },
      {
        name: "nicOrPassport",
        type: "string",
        required: true,
        description: "NIC or Passport identifier",
        example: "901234567V",
      },
      {
        name: "address",
        type: "string",
        required: true,
        description: "Customer residential address",
        example: "45 Temple Road, Kandy",
      },
      {
        name: "phone",
        type: "string",
        required: true,
        description: "Customer phone number",
        example: "0771234567",
      },
      {
        name: "email",
        type: "string",
        required: false,
        description: "Optional valid email address",
        example: "kamal@example.test",
      },
      {
        name: "drivingLicence",
        type: "string",
        required: false,
        description: "Optional driving licence number",
        aliases: ["drivingLicense"],
        example: "B1234567",
      },
      {
        name: "notes",
        type: "string",
        required: false,
        description: "Optional customer notes",
        example: "Synthetic customer record",
      },
      activeColumn,
      ...LEGACY_METADATA_COLUMNS,
    ],
  },
  VEHICLES: {
    version: 1,
    type: "VEHICLES",
    columns: [
      {
        name: "sourceKey",
        type: "string",
        required: true,
        description: "Unique source key for this vehicle/cycle row",
        example: "veh-001",
      },
      {
        name: "engineNumber",
        type: "string",
        required: true,
        description: "Vehicle engine number",
        example: "ENG-2026-001",
      },
      {
        name: "chassisNumber",
        type: "string",
        required: true,
        description: "Vehicle chassis number",
        example: "CHS-2026-001",
      },
      {
        name: "make",
        type: "string",
        required: true,
        description: "Vehicle manufacturer",
        example: "Toyota",
      },
      {
        name: "model",
        type: "string",
        required: true,
        description: "Vehicle model",
        example: "Aqua",
      },
      {
        name: "year",
        type: "integer",
        required: true,
        description: "Model year (1886..currentYear+1)",
        example: "2024",
      },
      {
        name: "colour",
        type: "string",
        required: true,
        description: "Vehicle colour",
        aliases: ["color"],
        example: "Silver",
      },
      {
        name: "fuelType",
        type: "enum",
        required: true,
        description: "PETROL | DIESEL | HYBRID | ELECTRIC | OTHER",
        example: "HYBRID",
      },
      {
        name: "transmission",
        type: "enum",
        required: true,
        description: "MANUAL | AUTOMATIC | CVT | OTHER",
        example: "AUTOMATIC",
      },
      {
        name: "vin",
        type: "string",
        required: false,
        description: "Optional VIN",
        example: "JTDKN3DU0F0000001",
      },
      {
        name: "crNumber",
        type: "string",
        required: false,
        description: "Optional CR registration number",
        example: "WP-CAB-1234",
      },
      {
        name: "vehicleNotes",
        type: "string",
        required: false,
        description: "Optional physical vehicle notes",
        example: "Imported synthetic vehicle",
      },
      {
        name: "supplierSourceKey",
        type: "string",
        required: false,
        description:
          "Supplier sourceKey (XOR with supplierExistingId/sellerCustomer*)",
        example: "sup-001",
      },
      {
        name: "supplierExistingId",
        type: "uuid",
        required: false,
        description: "Existing supplier UUID",
        example: "",
      },
      {
        name: "sellerCustomerSourceKey",
        type: "string",
        required: false,
        description: "Trade-in seller customer sourceKey",
        example: "",
      },
      {
        name: "sellerCustomerExistingId",
        type: "uuid",
        required: false,
        description: "Existing seller customer UUID",
        example: "",
      },
      {
        name: "tradeInSaleSourceKey",
        type: "string",
        required: false,
        description: "Source sale sourceKey for trade-in intake",
        example: "",
      },
      {
        name: "tradeInSaleExistingId",
        type: "uuid",
        required: false,
        description: "Existing source sale UUID for trade-in intake",
        example: "",
      },
      {
        name: "cycleSourceKey",
        type: "string",
        required: true,
        description: "Unique ownership cycle sourceKey",
        example: "cyc-001",
      },
      {
        name: "cycleNumber",
        type: "integer",
        required: true,
        description:
          "1-based acquisition cycle number for this physical identity",
        example: "1",
      },
      {
        name: "purchaseType",
        type: "enum",
        required: true,
        description: "CASH | LEASE_SETTLEMENT | BRAND_NEW",
        example: "CASH",
      },
      {
        name: "purchaseDate",
        type: "date",
        required: true,
        description: "Gregorian YYYY-MM-DD purchase date",
        example: "2026-01-10",
      },
      {
        name: "purchasePrice",
        type: "money",
        required: true,
        description: "Purchase price in major currency units (e.g. 5000000.00)",
        example: "5000000.00",
      },
      {
        name: "listedPrice",
        type: "money",
        required: false,
        description: "Optional asking/listed price in major currency units",
        example: "5500000.00",
      },
      {
        name: "notes",
        type: "string",
        required: false,
        description: "Optional cycle purchase notes",
        example: "Clean auction grade 4",
      },
      {
        name: "settlementReference",
        type: "string",
        required: false,
        description: "Required when purchaseType is LEASE_SETTLEMENT",
        example: "",
      },
      {
        name: "settlementAmount",
        type: "money",
        required: false,
        description: "Settlement payoff amount in major currency units",
        example: "",
      },
      {
        name: "settlementCashToSeller",
        type: "money",
        required: false,
        description: "Cash paid to seller in major currency units",
        example: "",
      },
      {
        name: "settlementInstitutionType",
        type: "enum",
        required: false,
        description: "FINANCE_COMPANY | BANK | PRIVATE_PARTY",
        example: "",
      },
      {
        name: "settlementCompanyExistingId",
        type: "uuid",
        required: false,
        description: "Existing finance company UUID (when FINANCE_COMPANY)",
        example: "",
      },
      {
        name: "settlementCompanySourceKey",
        type: "string",
        required: false,
        description: "Finance company sourceKey (when FINANCE_COMPANY)",
        example: "",
      },
      {
        name: "settlementInstitutionName",
        type: "string",
        required: false,
        description: "Institution name (when BANK or PRIVATE_PARTY)",
        example: "",
      },
      {
        name: "mileage",
        type: "json",
        required: false,
        description: "JSON array [{reading,date,remark?,decreaseReason?}]",
        example: '[{"reading":42000,"date":"2026-01-10","remark":"Intake"}]',
      },
      {
        name: "initialMileageReading",
        type: "integer",
        required: false,
        description:
          "Convenience initial mileage reading when mileage JSON omitted",
        example: "",
      },
      {
        name: "initialMileageDate",
        type: "date",
        required: false,
        description:
          "Convenience initial mileage date when mileage JSON omitted",
        example: "",
      },
      {
        name: "initialMileageRemark",
        type: "string",
        required: false,
        description: "Convenience initial mileage remark",
        example: "",
      },
      {
        name: "status",
        type: "enum",
        required: true,
        description: "Ten-state VehicleStatus enum",
        example: "IN_STOCK",
      },
      {
        name: "available",
        type: "boolean",
        required: true,
        description: "Availability flag (only true when status=IN_STOCK)",
        example: "true",
      },
      {
        name: "holdReason",
        type: "string",
        required: false,
        description: "Required when status=IN_STOCK and available=false",
        example: "",
      },
      {
        name: "receivedDate",
        type: "date",
        required: false,
        description: "Gregorian YYYY-MM-DD physical receipt date",
        example: "2026-01-11",
      },
      {
        name: "closedAt",
        type: "instant",
        required: false,
        description: "Required UTC RFC3339 ms instant for terminal states",
        example: "",
      },
      {
        name: "payments",
        type: "json",
        required: false,
        description:
          "JSON array of LegacyPayment [{sourceKey,amount,date,method,direction,category,reference?,reversalOfSourceKey?}]",
        example:
          '[{"sourceKey":"pay-veh-001","amount":"5000000.00","date":"2026-01-10","method":"BANK_TRANSFER","direction":"OUT","category":"SELLER","reference":"BT-1001"}]',
      },
      {
        name: "additionalCosts",
        type: "json",
        required: false,
        description:
          "JSON array [{sourceKey,category,description,amount,date,payments:[]}]",
        example:
          '[{"sourceKey":"cost-001","category":"TRANSPORT","description":"Carrier delivery","amount":"25000.00","date":"2026-01-11","payments":[{"sourceKey":"pay-cost-001","amount":"25000.00","date":"2026-01-11","method":"CASH","direction":"OUT","category":"COST"}]}]',
      },
      {
        name: "disposalDate",
        type: "date",
        required: false,
        description: "Required when status=WRITTEN_OFF",
        example: "",
      },
      {
        name: "disposalReason",
        type: "string",
        required: false,
        description: "Required when status=WRITTEN_OFF",
        example: "",
      },
      {
        name: "disposalMethod",
        type: "enum",
        required: false,
        description: "SCRAPPED | AUCTIONED | DONATED | OTHER",
        example: "",
      },
      {
        name: "disposalProceeds",
        type: "money",
        required: false,
        description: "Disposal proceeds in major currency units (>= 0)",
        example: "",
      },
      {
        name: "disposalReceiptAmount",
        type: "money",
        required: false,
        description:
          "Optional receipt amount (must equal disposalProceeds when > 0)",
        example: "",
      },
      {
        name: "disposalReceiptDate",
        type: "date",
        required: false,
        description: "Required when disposalProceeds > 0",
        example: "",
      },
      {
        name: "disposalReceiptMethod",
        type: "enum",
        required: false,
        description:
          "CASH | BANK_TRANSFER (required when disposalProceeds > 0)",
        example: "",
      },
      {
        name: "disposalReceiptReference",
        type: "string",
        required: false,
        description: "Optional disposal receipt reference",
        example: "",
      },
      {
        name: "disposalApproverName",
        type: "string",
        required: false,
        description:
          "Nonblank legacy approver name (required when WRITTEN_OFF)",
        example: "",
      },
      {
        name: "disposalApprovalReference",
        type: "string",
        required: false,
        description: "Optional nonblank legacy approval reference",
        example: "",
      },
      ...LEGACY_METADATA_COLUMNS,
    ],
  },
  SALES: {
    version: 1,
    type: "SALES",
    columns: [
      {
        name: "sourceKey",
        type: "string",
        required: true,
        description: "Unique source key for this sale row",
        example: "sale-001",
      },
      {
        name: "cycleSourceKey",
        type: "string",
        required: false,
        description: "Cycle sourceKey (XOR with cycleExistingId)",
        example: "cyc-001",
      },
      {
        name: "cycleExistingId",
        type: "uuid",
        required: false,
        description: "Existing cycle UUID",
        example: "",
      },
      {
        name: "customerSourceKey",
        type: "string",
        required: false,
        description: "Customer sourceKey (XOR with customerExistingId)",
        example: "cust-001",
      },
      {
        name: "customerExistingId",
        type: "uuid",
        required: false,
        description: "Existing customer UUID",
        example: "",
      },
      {
        name: "kind",
        type: "enum",
        required: true,
        description: "CASH | ADVANCE | LEASE | TRADE_IN",
        example: "CASH",
      },
      {
        name: "saleCaseSourceKey",
        type: "string",
        required: true,
        description:
          "Shared SaleCase key (paired with ADVANCES when kind=ADVANCE)",
        example: "case-001",
      },
      {
        name: "price",
        type: "money",
        required: true,
        description: "Agreed sale price in major currency units (> 0)",
        example: "5800000.00",
      },
      {
        name: "reference",
        type: "string",
        required: false,
        description: "Optional external sale reference",
        example: "INV-HIST-001",
      },
      {
        name: "state",
        type: "enum",
        required: true,
        description: "COMPLETED | FINANCE_PENDING | DO_RECEIVED | CANCELLED",
        example: "COMPLETED",
      },
      {
        name: "completionDate",
        type: "date",
        required: false,
        description:
          "Gregorian YYYY-MM-DD handover/completion date (when COMPLETED)",
        example: "2026-01-20",
      },
      {
        name: "completionMileage",
        type: "integer",
        required: false,
        description: "Handover odometer reading (when COMPLETED)",
        example: "42100",
      },
      {
        name: "completionBasisPurchase",
        type: "money",
        required: false,
        description:
          "Frozen purchase basis in major currency units (when COMPLETED)",
        example: "5000000.00",
      },
      {
        name: "completionBasisRepairs",
        type: "json",
        required: false,
        description:
          "JSON array [{sourceKey,amount}] of repair basis components",
        example: "[]",
      },
      {
        name: "completionBasisCosts",
        type: "json",
        required: false,
        description:
          "JSON array [{sourceKey,amount}] of additional cost components",
        example: '[{"sourceKey":"cost-001","amount":"25000.00"}]',
      },
      {
        name: "reservationSourceKey",
        type: "string",
        required: false,
        description: "ADVANCES row sourceKey (required when kind=ADVANCE)",
        example: "",
      },
      {
        name: "reservationExistingId",
        type: "uuid",
        required: false,
        description: "Existing reservation UUID",
        example: "",
      },
      {
        name: "financeCompanyExistingId",
        type: "uuid",
        required: false,
        description: "Existing finance company UUID (when kind=LEASE)",
        example: "",
      },
      {
        name: "financeCompanySourceKey",
        type: "string",
        required: false,
        description: "Finance company sourceKey (when kind=LEASE)",
        example: "",
      },
      {
        name: "downPayment",
        type: "money",
        required: false,
        description: "Down payment in major units (when kind=LEASE)",
        example: "",
      },
      {
        name: "financeAmount",
        type: "money",
        required: false,
        description: "Financed principal in major units (when kind=LEASE)",
        example: "",
      },
      {
        name: "termMonths",
        type: "integer",
        required: false,
        description: "Lease term 1..120 months (when kind=LEASE)",
        example: "",
      },
      {
        name: "doAttachmentId",
        type: "uuid",
        required: false,
        description: "Optional DO attachment UUID",
        example: "",
      },
      {
        name: "doIssueDate",
        type: "date",
        required: false,
        description: "Gregorian YYYY-MM-DD DO issue date",
        example: "",
      },
      {
        name: "tradeInDescription",
        type: "string",
        required: false,
        description: "Trade-in vehicle description (when kind=TRADE_IN)",
        example: "",
      },
      {
        name: "tradeInValue",
        type: "money",
        required: false,
        description: "Trade-in value in major units (when kind=TRADE_IN)",
        example: "",
      },
      {
        name: "tradeInAcquiredCycleSourceKey",
        type: "string",
        required: false,
        description: "Optional acquired cycle sourceKey for trade-in intake",
        example: "",
      },
      {
        name: "tradeInAcquiredCycleExistingId",
        type: "uuid",
        required: false,
        description:
          "Optional existing acquired cycle UUID for trade-in intake",
        example: "",
      },
      {
        name: "payments",
        type: "json",
        required: false,
        description: "JSON array of LegacyPayment[]",
        example:
          '[{"sourceKey":"pay-sale-001","amount":"5800000.00","date":"2026-01-20","method":"BANK_TRANSFER","direction":"IN","category":"SALE","reference":"CR-5001"}]',
      },
      {
        name: "notes",
        type: "string",
        required: false,
        description: "Optional sale notes",
        example: "Synthetic cash sale",
      },
      ...LEGACY_METADATA_COLUMNS,
    ],
  },
  REPAIRS: {
    version: 1,
    type: "REPAIRS",
    columns: [
      {
        name: "sourceKey",
        type: "string",
        required: true,
        description: "Unique source key for this repair row",
        example: "rep-001",
      },
      {
        name: "cycleSourceKey",
        type: "string",
        required: false,
        description: "Cycle sourceKey (XOR with cycleExistingId)",
        example: "cyc-001",
      },
      {
        name: "cycleExistingId",
        type: "uuid",
        required: false,
        description: "Existing cycle UUID",
        example: "",
      },
      {
        name: "vendorSourceKey",
        type: "string",
        required: false,
        description: "Repair vendor sourceKey (XOR with vendorExistingId)",
        example: "vnd-001",
      },
      {
        name: "vendorExistingId",
        type: "uuid",
        required: false,
        description: "Existing repair vendor UUID",
        example: "",
      },
      {
        name: "request",
        type: "string",
        required: true,
        description: "Repair request description",
        example: "Front bumper repaint and polish",
      },
      {
        name: "sentDate",
        type: "date",
        required: true,
        description: "Gregorian YYYY-MM-DD sent date",
        example: "2026-01-12",
      },
      {
        name: "returnedDate",
        type: "date",
        required: false,
        description:
          "Gregorian YYYY-MM-DD return date (all 4 return fields or none)",
        example: "2026-01-15",
      },
      {
        name: "invoiceDate",
        type: "date",
        required: false,
        description: "Gregorian YYYY-MM-DD invoice date",
        example: "2026-01-15",
      },
      {
        name: "invoiceAmount",
        type: "money",
        required: false,
        description: "Invoice amount in major currency units (>= 0)",
        example: "45000.00",
      },
      {
        name: "summary",
        type: "string",
        required: false,
        description: "Repair completion summary",
        example: "Completed bumper repaint",
      },
      {
        name: "payments",
        type: "json",
        required: false,
        description:
          "JSON array of LegacyPayment[] (must be empty if unreturned)",
        example:
          '[{"sourceKey":"pay-rep-001","amount":"45000.00","date":"2026-01-15","method":"CASH","direction":"OUT","category":"REPAIR"}]',
      },
      ...LEGACY_METADATA_COLUMNS,
    ],
  },
  ADVANCES: {
    version: 1,
    type: "ADVANCES",
    columns: [
      {
        name: "sourceKey",
        type: "string",
        required: true,
        description: "Unique source key for this advance/reservation row",
        example: "adv-001",
      },
      {
        name: "cycleSourceKey",
        type: "string",
        required: false,
        description: "Cycle sourceKey (XOR with cycleExistingId)",
        example: "cyc-001",
      },
      {
        name: "cycleExistingId",
        type: "uuid",
        required: false,
        description: "Existing cycle UUID",
        example: "",
      },
      {
        name: "customerSourceKey",
        type: "string",
        required: false,
        description: "Customer sourceKey (XOR with customerExistingId)",
        example: "cust-001",
      },
      {
        name: "customerExistingId",
        type: "uuid",
        required: false,
        description: "Existing customer UUID",
        example: "",
      },
      {
        name: "agreed",
        type: "money",
        required: true,
        description: "Agreed sale price in major currency units (> 0)",
        example: "5500000.00",
      },
      {
        name: "amount",
        type: "money",
        required: true,
        description: "Advance amount in major currency units (> 0, <= agreed)",
        example: "500000.00",
      },
      {
        name: "saleCaseSourceKey",
        type: "string",
        required: true,
        description: "Shared SaleCase key (paired with SALES when CONVERTED)",
        example: "case-adv-001",
      },
      {
        name: "placedDate",
        type: "date",
        required: true,
        description: "Gregorian YYYY-MM-DD placement date",
        example: "2026-01-12",
      },
      {
        name: "listedBasis",
        type: "money",
        required: true,
        description: "Listed price basis snapshot in major units (> 0)",
        example: "5500000.00",
      },
      {
        name: "validThrough",
        type: "date",
        required: true,
        description: "Gregorian YYYY-MM-DD inclusive validity end date",
        example: "2026-01-26",
      },
      {
        name: "expiresAt",
        type: "instant",
        required: true,
        description: "UTC RFC3339 ms expiry instant",
        example: "2026-01-26T18:30:00.000Z",
      },
      {
        name: "policyTimezone",
        type: "string",
        required: false,
        description: "Policy IANA timezone (default Asia/Colombo)",
        example: "Asia/Colombo",
      },
      {
        name: "policyTiers",
        type: "json",
        required: false,
        description: "JSON array [{upperBps,days}]",
        example:
          '[{"upperBps":500,"days":7},{"upperBps":1000,"days":14},{"upperBps":1500,"days":21},{"upperBps":null,"days":31}]',
      },
      {
        name: "policyLeadDays",
        type: "integer",
        required: false,
        description: "Warning lead days 0..7 (default 3)",
        example: "3",
      },
      {
        name: "policyDays",
        type: "integer",
        required: false,
        description: "Snapshotted tier days 1..31",
        example: "14",
      },
      {
        name: "policySnapshot",
        type: "json",
        required: false,
        description: "Alternative full policySnapshot JSON object",
        example: "",
      },
      {
        name: "state",
        type: "enum",
        required: true,
        description: "ACTIVE | EXPIRED | CONVERTED | REFUNDED | CANCELLED",
        example: "EXPIRED",
      },
      {
        name: "completedSaleSourceKey",
        type: "string",
        required: false,
        description: "SALES sourceKey (required when state=CONVERTED)",
        example: "",
      },
      {
        name: "completedSaleExistingId",
        type: "uuid",
        required: false,
        description: "Existing completed sale UUID",
        example: "",
      },
      {
        name: "retainedAmount",
        type: "money",
        required: false,
        description:
          "Retained advance amount in major units (when REFUNDED/CANCELLED)",
        example: "",
      },
      {
        name: "resolutionDate",
        type: "date",
        required: false,
        description: "Gregorian YYYY-MM-DD resolution date",
        example: "",
      },
      {
        name: "resolutionReason",
        type: "string",
        required: false,
        description: "Resolution reason (when REFUNDED/CANCELLED)",
        example: "",
      },
      {
        name: "dispositionKind",
        type: "enum",
        required: false,
        description: "RELEASE | HOLD (when REFUNDED/CANCELLED)",
        example: "",
      },
      {
        name: "dispositionHoldReason",
        type: "string",
        required: false,
        description: "Required when dispositionKind=HOLD",
        example: "",
      },
      {
        name: "payments",
        type: "json",
        required: false,
        description: "JSON array of LegacyPayment[]",
        example:
          '[{"sourceKey":"pay-adv-001","amount":"500000.00","date":"2026-01-12","method":"CASH","direction":"IN","category":"ADVANCE"}]',
      },
      ...LEGACY_METADATA_COLUMNS,
    ],
  },
}

export function getImportTemplateSchema(
  kind: ImportType
): ImportTemplateSchema {
  return IMPORT_SCHEMAS[kind]
}

function escapeCsvCell(value: string): string {
  if (
    value.includes(",") ||
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r")
  ) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

export function importTemplateColumns(kind: ImportType) {
  // Exclude flat convenience-only columns from generated CSV template so the
  // template displays canonical JSON columns without redundant empty columns.
  return IMPORT_SCHEMAS[kind].columns.filter(
    (c) =>
      !c.name.startsWith("contact") &&
      !c.name.startsWith("initialMileage") &&
      c.name !== "policySnapshot"
  )
}

/** Deterministic UTF-8 CSV with canonical headers and a synthetic row. */
export function generateImportTemplateCsv(kind: ImportType): string {
  const cols = importTemplateColumns(kind)
  const headerLine = cols.map((c) => escapeCsvCell(c.name)).join(",")
  const exampleLine = cols.map((c) => escapeCsvCell(c.example)).join(",")
  return `${headerLine}\n${exampleLine}\n`
}

// ============================================================================
// CSV & XLSX Matrix Extraction
// ============================================================================

type MatrixResult =
  | {
      ok: true
      sheetName?: string
      rows: { rowNumber: number; cells: RawCell[] }[]
    }
  | { ok: false; errors: ImportParseError[] }

function parseCsvMatrix(bytes: Uint8Array): MatrixResult {
  if (bytes.length === 0) {
    return {
      ok: false,
      errors: [
        {
          rowNumber: 0,
          field: "file",
          code: "FILE_EMPTY",
          message: "CSV file is empty",
        },
      ],
    }
  }
  if (bytes.length > IMPORT_LIMITS.maxFileBytes) {
    return {
      ok: false,
      errors: [
        {
          rowNumber: 0,
          field: "file",
          code: "FILE_TOO_LARGE",
          message: "CSV file exceeds 5 MiB limit",
        },
      ],
    }
  }

  let text: string
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    return {
      ok: false,
      errors: [
        {
          rowNumber: 0,
          field: "file",
          code: "INVALID_UTF8",
          message: "CSV must be valid UTF-8",
        },
      ],
    }
  }

  // Strip UTF-8 BOM if present.
  if (text.startsWith("\uFEFF")) {
    text = text.slice(1)
  }

  if (BINARY_SIG_RE.test(text)) {
    return {
      ok: false,
      errors: [
        {
          rowNumber: 0,
          field: "file",
          code: "INVALID_CSV",
          message: "File content is not valid CSV text",
        },
      ],
    }
  }
  if (CONTROL_CHAR_RE.test(text)) {
    return {
      ok: false,
      errors: [
        {
          rowNumber: 0,
          field: "file",
          code: "UNSAFE_CONTENT",
          message: "CSV contains forbidden control characters",
        },
      ],
    }
  }

  // Normalize CRLF -> LF; reject lone CR outside/inside text so line boundaries are unambiguous.
  const normalized = text.replace(/\r\n/g, "\n")
  if (normalized.includes("\r")) {
    return {
      ok: false,
      errors: [
        {
          rowNumber: 0,
          field: "file",
          code: "INVALID_CSV",
          message: "CSV contains unnormalized lone carriage return",
        },
      ],
    }
  }

  const parsedRows: { rowNumber: number; cells: RawCell[] }[] = []
  let currentRow: string[] = []
  let field = ""
  let quoted = false
  let closed = false
  let cellCount = 0

  const flushField = () => {
    if (field.length > IMPORT_LIMITS.maxCellChars) {
      throw new Error("CELL_TOO_LONG")
    }
    if (++cellCount > IMPORT_LIMITS.maxWorkbookCells) {
      throw new Error("CELL_LIMIT_EXCEEDED")
    }
    currentRow.push(field)
    field = ""
    closed = false
  }

  const flushRow = () => {
    flushField()
    if (currentRow.length > IMPORT_LIMITS.maxColumns) {
      throw new Error("COLUMN_LIMIT_EXCEEDED")
    }
    parsedRows.push({ rowNumber: parsedRows.length + 1, cells: currentRow })
    currentRow = []
  }

  try {
    for (let i = 0; i < normalized.length; i++) {
      const ch = normalized[i]
      if (quoted) {
        if (ch === '"') {
          if (normalized[i + 1] === '"') {
            field += '"'
            i++
          } else {
            quoted = false
            closed = true
          }
        } else {
          field += ch
        }
      } else if (ch === '"' && field.length === 0 && !closed) {
        quoted = true
      } else if (ch === ",") {
        flushField()
      } else if (ch === "\n") {
        flushRow()
      } else {
        if (closed || ch === '"') {
          return {
            ok: false,
            errors: [
              {
                rowNumber: parsedRows.length + 1,
                field: "file",
                code: "INVALID_CSV",
                message: "Malformed CSV quote syntax",
              },
            ],
          }
        }
        field += ch
      }
      if (field.length > IMPORT_LIMITS.maxCellChars) {
        throw new Error("CELL_TOO_LONG")
      }
    }

    if (quoted) {
      return {
        ok: false,
        errors: [
          {
            rowNumber: parsedRows.length + 1,
            field: "file",
            code: "INVALID_CSV",
            message: "Unterminated quoted CSV field",
          },
        ],
      }
    }
    if (field.length > 0 || currentRow.length > 0 || closed) {
      flushRow()
    }
  } catch (err) {
    const code = err instanceof Error ? err.message : "INVALID_CSV"
    return {
      ok: false,
      errors: [
        {
          rowNumber: parsedRows.length + 1,
          field: "file",
          code,
          message: `CSV validation failed: ${code}`,
        },
      ],
    }
  }

  // Strip trailing completely empty rows.
  while (
    parsedRows.length > 0 &&
    parsedRows[parsedRows.length - 1].cells.every((c) => c === "")
  ) {
    parsedRows.pop()
  }

  if (parsedRows.length === 0) {
    return {
      ok: false,
      errors: [
        {
          rowNumber: 0,
          field: "file",
          code: "FILE_EMPTY",
          message: "CSV contains no rows",
        },
      ],
    }
  }

  return { ok: true, rows: parsedRows }
}

async function parseXlsxMatrix(
  bytes: Uint8Array,
  kind: ImportType,
  sheetName?: string
): Promise<MatrixResult> {
  if (bytes.length === 0) {
    return {
      ok: false,
      errors: [
        {
          rowNumber: 0,
          field: "file",
          code: "FILE_EMPTY",
          message: "XLSX file is empty",
        },
      ],
    }
  }
  if (bytes.length > IMPORT_LIMITS.maxFileBytes) {
    return {
      ok: false,
      errors: [
        {
          rowNumber: 0,
          field: "file",
          code: "FILE_TOO_LARGE",
          message: "XLSX file exceeds 5 MiB limit",
        },
      ],
    }
  }

  const buffer = Buffer.from(bytes)
  try {
    await validateXlsx(buffer)
  } catch {
    return {
      ok: false,
      errors: [
        {
          rowNumber: 0,
          field: "file",
          code: "INVALID_XLSX",
          message:
            "Invalid or unsafe XLSX workbook (formulas, external links, unsupported XML/ZIP, or size bounds violated)",
        },
      ],
    }
  }

  let sheets: { sheet: string; data: RawCell[][] }[]
  try {
    // Upstream read-excel-file .d.ts types Date cells as `typeof Date` instead of `Date`.
    sheets = (await readExcelFile<XlsxNumberToken>(buffer, {
      trim: false,
      parseNumber: (raw: string) => ({ __xlsxNum: raw }),
    })) as unknown as { sheet: string; data: RawCell[][] }[]
  } catch {
    return {
      ok: false,
      errors: [
        {
          rowNumber: 0,
          field: "file",
          code: "INVALID_XLSX",
          message: "Failed to parse XLSX sheets",
        },
      ],
    }
  }

  let totalWorkbookCells = 0
  for (const s of sheets) {
    for (const r of s.data) {
      for (const c of r) {
        if (
          c !== null &&
          ++totalWorkbookCells > IMPORT_LIMITS.maxWorkbookCells
        ) {
          return {
            ok: false,
            errors: [
              {
                rowNumber: 0,
                field: "file",
                code: "CELL_LIMIT_EXCEEDED",
                message: "Workbook exceeds 10,000 populated cells limit",
              },
            ],
          }
        }
      }
    }
  }

  let target: { sheet: string; data: RawCell[][] } | undefined
  if (sheetName !== undefined) {
    target = sheets.find((s) => s.sheet === sheetName)
  } else if (sheets.length === 1) {
    target = sheets[0]
  } else {
    target = sheets.find(
      (s) => s.sheet.trim().toUpperCase() === kind.toUpperCase()
    )
  }

  if (!target) {
    return {
      ok: false,
      errors: [
        {
          rowNumber: 0,
          field: "sheetName",
          code: "SHEET_NOT_FOUND",
          message: sheetName
            ? `Worksheet "${sheetName}" not found`
            : `Workbook has multiple sheets; specify sheetName or name a sheet "${kind}"`,
        },
      ],
    }
  }

  const rawRows = target.data.map((cells, idx) => ({
    rowNumber: idx + 1,
    cells: [...cells],
  }))

  // Trim trailing null/empty cells from header row and strip trailing empty rows.
  while (
    rawRows.length > 0 &&
    rawRows[rawRows.length - 1].cells.every(
      (c) => c === null || (typeof c === "string" && c === "")
    )
  ) {
    rawRows.pop()
  }

  if (rawRows.length === 0) {
    return {
      ok: false,
      errors: [
        {
          rowNumber: 0,
          field: "file",
          code: "FILE_EMPTY",
          message: "Worksheet contains no rows",
        },
      ],
    }
  }

  const headerCells = rawRows[0].cells
  while (
    headerCells.length > 0 &&
    (headerCells[headerCells.length - 1] === null ||
      headerCells[headerCells.length - 1] === "")
  ) {
    headerCells.pop()
  }

  return { ok: true, sheetName: target.sheet, rows: rawRows }
}

// ============================================================================
// Cell Coercion & Field Validators
// ============================================================================

type CellTextResult =
  | { ok: true; text: string; isNumericToken: boolean }
  | { ok: false; code: string; message: string }

function rawCellToText(
  cell: RawCell,
  kind: "string" | "date" | "instant" | "boolean" | "number"
): CellTextResult {
  if (cell === null) {
    return { ok: true, text: "", isNumericToken: false }
  }
  if (typeof cell === "string") {
    if (CONTROL_CHAR_RE.test(cell)) {
      return {
        ok: false,
        code: "UNSAFE_CONTENT",
        message: "Cell contains forbidden control characters",
      }
    }
    if (isFormulaInjection(cell)) {
      return {
        ok: false,
        code: "FORMULA_INJECTION",
        message: "Cell value begins with a forbidden formula character",
      }
    }
    return { ok: true, text: cell, isNumericToken: false }
  }
  if (isXlsxNumberToken(cell)) {
    return { ok: true, text: cell.__xlsxNum, isNumericToken: true }
  }
  if (typeof cell === "boolean") {
    if (kind !== "boolean" && kind !== "string") {
      return {
        ok: false,
        code: "INVALID_TYPE",
        message: `Unexpected boolean cell for ${kind} field`,
      }
    }
    return {
      ok: true,
      text: cell ? "true" : "false",
      isNumericToken: false,
    }
  }
  if (cell instanceof Date) {
    if (Number.isNaN(cell.valueOf())) {
      return {
        ok: false,
        code: "INVALID_DATE",
        message: "Invalid Excel date cell",
      }
    }
    const iso = cell.toISOString()
    if (kind === "date") {
      if (!iso.endsWith("T00:00:00.000Z")) {
        return {
          ok: false,
          code: "INVALID_DATE",
          message: "Date-only cell cannot include a non-midnight time",
        }
      }
      return { ok: true, text: iso.slice(0, 10), isNumericToken: false }
    }
    return { ok: true, text: iso, isNumericToken: false }
  }
  return { ok: false, code: "INVALID_TYPE", message: "Unsupported cell type" }
}

type RowReader = {
  rowNumber: number
  sourceKey?: string
  errors: ImportParseError[]
  raw: Map<string, RawCell>
  hasColumn: (col: string) => boolean
  getText: (
    col: string,
    cellKind?: "string" | "date" | "instant" | "boolean" | "number"
  ) => string | undefined
  optString: (col: string, maxLen?: number) => string | undefined
  reqString: (col: string, maxLen?: number) => string | undefined
  optEnum: <T extends string>(
    col: string,
    allowed: readonly T[]
  ) => T | undefined
  reqEnum: <T extends string>(
    col: string,
    allowed: readonly T[]
  ) => T | undefined
  optBool: (col: string) => boolean | undefined
  reqBool: (col: string) => boolean | undefined
  optInt: (col: string, min: number, max: number) => number | undefined
  reqInt: (col: string, min: number, max: number) => number | undefined
  optMoney: (col: string, opts?: { positive?: boolean }) => Money | undefined
  reqMoney: (col: string, opts?: { positive?: boolean }) => Money | undefined
  optDate: (col: string) => DateOnly | undefined
  reqDate: (col: string) => DateOnly | undefined
  optInstant: (col: string) => Instant | undefined
  reqInstant: (col: string) => Instant | undefined
  optPhone: (col: string) => string | undefined
  reqPhone: (col: string) => string | undefined
  optEmail: (col: string) => string | undefined
  optUuid: (col: string) => string | undefined
  optJson: (col: string) => unknown | undefined
  hasAny: (cols: readonly string[]) => boolean
}

function makeRowReader(
  rowNumber: number,
  rawMap: Map<string, RawCell>,
  presentColumns: Set<string>,
  errors: ImportParseError[]
): RowReader {
  const checkedFormula = new Set<string>()

  const getText = (
    col: string,
    cellKind: "string" | "date" | "instant" | "boolean" | "number" = "string"
  ): string | undefined => {
    if (!presentColumns.has(col)) return undefined
    const cell = rawMap.get(col) ?? null
    const coerced = rawCellToText(cell, cellKind)
    if (!coerced.ok) {
      if (!checkedFormula.has(col)) {
        checkedFormula.add(col)
        addError(
          errors,
          rowNumber,
          col,
          coerced.code,
          coerced.message,
          reader.sourceKey
        )
      }
      return undefined
    }
    const trimmed = coerced.text.trim()
    return trimmed.length === 0 ? undefined : trimmed
  }

  const optString = (col: string, maxLen = 2000): string | undefined => {
    const val = getText(col, "string")
    if (val === undefined) return undefined
    if (val.length > maxLen) {
      addError(
        errors,
        rowNumber,
        col,
        "STRING_TOO_LONG",
        `${col} exceeds maximum length of ${maxLen}`,
        reader.sourceKey
      )
      return undefined
    }
    return val
  }

  const reqString = (col: string, maxLen = 2000): string | undefined => {
    const val = optString(col, maxLen)
    if (val === undefined && !checkedFormula.has(col)) {
      if (!errors.some((e) => e.rowNumber === rowNumber && e.field === col)) {
        addError(
          errors,
          rowNumber,
          col,
          "MISSING_REQUIRED",
          `${col} is required`,
          reader.sourceKey
        )
      }
    }
    return val
  }

  const optEnum = <T extends string>(
    col: string,
    allowed: readonly T[]
  ): T | undefined => {
    const val = getText(col, "string")
    if (val === undefined) return undefined
    const upper = val.toUpperCase() as T
    if (!allowed.includes(upper)) {
      addError(
        errors,
        rowNumber,
        col,
        "INVALID_ENUM",
        `Invalid ${col} "${val}"; expected one of: ${allowed.join(", ")}`,
        reader.sourceKey
      )
      return undefined
    }
    return upper
  }

  const reqEnum = <T extends string>(
    col: string,
    allowed: readonly T[]
  ): T | undefined => {
    const val = optEnum(col, allowed)
    if (
      val === undefined &&
      !errors.some((e) => e.rowNumber === rowNumber && e.field === col)
    ) {
      addError(
        errors,
        rowNumber,
        col,
        "MISSING_REQUIRED",
        `${col} is required`,
        reader.sourceKey
      )
    }
    return val
  }

  const optBool = (col: string): boolean | undefined => {
    const val = getText(col, "boolean")
    if (val === undefined) return undefined
    const low = val.toLowerCase()
    if (low === "true" || low === "1" || low === "yes") return true
    if (low === "false" || low === "0" || low === "no") return false
    addError(
      errors,
      rowNumber,
      col,
      "INVALID_BOOLEAN",
      `Invalid boolean "${val}" for ${col}`,
      reader.sourceKey
    )
    return undefined
  }

  const reqBool = (col: string): boolean | undefined => {
    const val = optBool(col)
    if (
      val === undefined &&
      !errors.some((e) => e.rowNumber === rowNumber && e.field === col)
    ) {
      addError(
        errors,
        rowNumber,
        col,
        "MISSING_REQUIRED",
        `${col} is required`,
        reader.sourceKey
      )
    }
    return val
  }

  const optInt = (
    col: string,
    min: number,
    max: number
  ): number | undefined => {
    const val = getText(col, "number")
    if (val === undefined) return undefined
    if (!/^-?\d+$/.test(val)) {
      addError(
        errors,
        rowNumber,
        col,
        "INVALID_INTEGER",
        `Invalid integer "${val}" for ${col}`,
        reader.sourceKey
      )
      return undefined
    }
    const num = Number(val)
    if (!Number.isSafeInteger(num) || num < min || num > max) {
      addError(
        errors,
        rowNumber,
        col,
        "OUT_OF_RANGE",
        `${col} must be an integer between ${min} and ${max}`,
        reader.sourceKey
      )
      return undefined
    }
    return num
  }

  const reqInt = (
    col: string,
    min: number,
    max: number
  ): number | undefined => {
    const val = optInt(col, min, max)
    if (
      val === undefined &&
      !errors.some((e) => e.rowNumber === rowNumber && e.field === col)
    ) {
      addError(
        errors,
        rowNumber,
        col,
        "MISSING_REQUIRED",
        `${col} is required`,
        reader.sourceKey
      )
    }
    return val
  }

  const optMoney = (
    col: string,
    opts: { positive?: boolean } = {}
  ): Money | undefined => {
    const val = getText(col, "number")
    if (val === undefined) return undefined
    const parsed = parseImportMoney(val, opts)
    if (!parsed.ok) {
      addError(
        errors,
        rowNumber,
        col,
        parsed.code,
        `${col}: ${parsed.message}`,
        reader.sourceKey
      )
      return undefined
    }
    return parsed.value
  }

  const reqMoney = (
    col: string,
    opts: { positive?: boolean } = {}
  ): Money | undefined => {
    const val = optMoney(col, opts)
    if (
      val === undefined &&
      !errors.some((e) => e.rowNumber === rowNumber && e.field === col)
    ) {
      addError(
        errors,
        rowNumber,
        col,
        "MISSING_REQUIRED",
        `${col} is required`,
        reader.sourceKey
      )
    }
    return val
  }

  const optDate = (col: string): DateOnly | undefined => {
    const val = getText(col, "date")
    if (val === undefined) return undefined
    if (!isValidGregorianDate(val)) {
      addError(
        errors,
        rowNumber,
        col,
        "INVALID_DATE",
        `Invalid Gregorian YYYY-MM-DD date "${val}" for ${col}`,
        reader.sourceKey
      )
      return undefined
    }
    return val
  }

  const reqDate = (col: string): DateOnly | undefined => {
    const val = optDate(col)
    if (
      val === undefined &&
      !errors.some((e) => e.rowNumber === rowNumber && e.field === col)
    ) {
      addError(
        errors,
        rowNumber,
        col,
        "MISSING_REQUIRED",
        `${col} is required`,
        reader.sourceKey
      )
    }
    return val
  }

  const optInstant = (col: string): Instant | undefined => {
    const val = getText(col, "instant")
    if (val === undefined) return undefined
    const parsed = parseInstantStrict(val)
    if (!parsed) {
      addError(
        errors,
        rowNumber,
        col,
        "INVALID_INSTANT",
        `Invalid UTC RFC3339 timestamp "${val}" for ${col}`,
        reader.sourceKey
      )
      return undefined
    }
    return parsed
  }

  const reqInstant = (col: string): Instant | undefined => {
    const val = optInstant(col)
    if (
      val === undefined &&
      !errors.some((e) => e.rowNumber === rowNumber && e.field === col)
    ) {
      addError(
        errors,
        rowNumber,
        col,
        "MISSING_REQUIRED",
        `${col} is required`,
        reader.sourceKey
      )
    }
    return val
  }

  const optPhone = (col: string): string | undefined => {
    const val = optString(col, 30)
    if (val === undefined) return undefined
    if (val.length < 3 || !PHONE_RE.test(val)) {
      addError(
        errors,
        rowNumber,
        col,
        "INVALID_PHONE",
        `Invalid phone "${val}" for ${col}`,
        reader.sourceKey
      )
      return undefined
    }
    return val
  }

  const reqPhone = (col: string): string | undefined => {
    const val = optPhone(col)
    if (
      val === undefined &&
      !errors.some((e) => e.rowNumber === rowNumber && e.field === col)
    ) {
      addError(
        errors,
        rowNumber,
        col,
        "MISSING_REQUIRED",
        `${col} is required`,
        reader.sourceKey
      )
    }
    return val
  }

  const optEmail = (col: string): string | undefined => {
    const val = optString(col, 254)
    if (val === undefined) return undefined
    if (!EMAIL_RE.test(val)) {
      addError(
        errors,
        rowNumber,
        col,
        "INVALID_EMAIL",
        `Invalid email "${val}" for ${col}`,
        reader.sourceKey
      )
      return undefined
    }
    return val
  }

  const optUuid = (col: string): string | undefined => {
    const val = optString(col, 36)
    if (val === undefined) return undefined
    if (!UUID_RE.test(val)) {
      addError(
        errors,
        rowNumber,
        col,
        "INVALID_UUID",
        `Invalid UUID "${val}" for ${col}`,
        reader.sourceKey
      )
      return undefined
    }
    return val.toLowerCase()
  }

  const optJson = (col: string): unknown | undefined => {
    const val = getText(col, "string")
    if (val === undefined) return undefined
    try {
      return JSON.parse(val)
    } catch {
      addError(
        errors,
        rowNumber,
        col,
        "INVALID_JSON",
        `${col} must be valid JSON`,
        reader.sourceKey
      )
      return undefined
    }
  }

  const hasAny = (cols: readonly string[]) =>
    cols.some((c) => {
      if (!presentColumns.has(c)) return false
      const cell = rawMap.get(c) ?? null
      return cell !== null && (typeof cell !== "string" || cell.trim() !== "")
    })

  const reader: RowReader & { hasAny: (cols: readonly string[]) => boolean } = {
    rowNumber,
    errors,
    raw: rawMap,
    hasColumn: (col) => presentColumns.has(col),
    hasAny,
    getText,
    optString,
    reqString,
    optEnum,
    reqEnum,
    optBool,
    reqBool,
    optInt,
    reqInt,
    optMoney,
    reqMoney,
    optDate,
    reqDate,
    optInstant,
    reqInstant,
    optPhone,
    reqPhone,
    optEmail,
    optUuid,
    optJson,
  }
  return reader
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    Object.getPrototypeOf(v) === Object.prototype
  )
}

function checkJsonStringSafety(
  val: unknown,
  rowNumber: number,
  field: string,
  errors: ImportParseError[],
  sourceKey?: string
): string | undefined {
  if (typeof val !== "string") return undefined
  if (CONTROL_CHAR_RE.test(val)) {
    addError(
      errors,
      rowNumber,
      field,
      "UNSAFE_CONTENT",
      `${field} contains control characters`,
      sourceKey
    )
    return undefined
  }
  if (isFormulaInjection(val)) {
    addError(
      errors,
      rowNumber,
      field,
      "FORMULA_INJECTION",
      `${field} contains forbidden formula prefix`,
      sourceKey
    )
    return undefined
  }
  const trimmed = val.trim()
  return trimmed.length ? trimmed : undefined
}

function parseJsonStringField(
  obj: Record<string, unknown>,
  key: string,
  rowNumber: number,
  fieldPath: string,
  errors: ImportParseError[],
  opts: { required?: boolean; maxLen?: number },
  sourceKey?: string
): string | undefined {
  const raw = obj[key]
  if (raw === undefined || raw === null || raw === "") {
    if (opts.required) {
      addError(
        errors,
        rowNumber,
        fieldPath,
        "MISSING_REQUIRED",
        `${fieldPath} is required`,
        sourceKey
      )
    }
    return undefined
  }
  if (typeof raw !== "string") {
    addError(
      errors,
      rowNumber,
      fieldPath,
      "INVALID_TYPE",
      `${fieldPath} must be a string`,
      sourceKey
    )
    return undefined
  }
  const safe = checkJsonStringSafety(
    raw,
    rowNumber,
    fieldPath,
    errors,
    sourceKey
  )
  if (!safe) {
    if (
      opts.required &&
      !errors.some((e) => e.field === fieldPath && e.rowNumber === rowNumber)
    ) {
      addError(
        errors,
        rowNumber,
        fieldPath,
        "MISSING_REQUIRED",
        `${fieldPath} is required`,
        sourceKey
      )
    }
    return undefined
  }
  const maxLen = opts.maxLen ?? 2000
  if (safe.length > maxLen) {
    addError(
      errors,
      rowNumber,
      fieldPath,
      "STRING_TOO_LONG",
      `${fieldPath} exceeds max length ${maxLen}`,
      sourceKey
    )
    return undefined
  }
  return safe
}

function parseJsonMoneyField(
  obj: Record<string, unknown>,
  key: string,
  rowNumber: number,
  fieldPath: string,
  errors: ImportParseError[],
  opts: { required?: boolean; positive?: boolean },
  sourceKey?: string
): Money | undefined {
  const raw = obj[key]
  if (raw === undefined || raw === null || raw === "") {
    if (opts.required) {
      addError(
        errors,
        rowNumber,
        fieldPath,
        "MISSING_REQUIRED",
        `${fieldPath} is required`,
        sourceKey
      )
    }
    return undefined
  }
  if (typeof raw !== "string" && typeof raw !== "number") {
    addError(
      errors,
      rowNumber,
      fieldPath,
      "INVALID_MONEY",
      `${fieldPath} must be a decimal string or number`,
      sourceKey
    )
    return undefined
  }
  const str = typeof raw === "number" ? String(raw) : raw
  const parsed = parseImportMoney(str, { positive: opts.positive })
  if (!parsed.ok) {
    addError(
      errors,
      rowNumber,
      fieldPath,
      parsed.code,
      `${fieldPath}: ${parsed.message}`,
      sourceKey
    )
    return undefined
  }
  return parsed.value
}

function rejectUnknownJsonKeys(
  obj: Record<string, unknown>,
  allowed: readonly string[],
  rowNumber: number,
  fieldPath: string,
  errors: ImportParseError[],
  sourceKey?: string
): void {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) {
      addError(
        errors,
        rowNumber,
        `${fieldPath}.${k}`,
        "UNKNOWN_PROPERTY",
        `Unknown property "${k}" in ${fieldPath}`,
        sourceKey
      )
    }
  }
}

function parseLegacyPaymentsArray(
  raw: unknown,
  rowNumber: number,
  fieldName: string,
  errors: ImportParseError[],
  sourceKey?: string
): LegacyPayment[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) {
    addError(
      errors,
      rowNumber,
      fieldName,
      "INVALID_JSON",
      `${fieldName} must be a JSON array`,
      sourceKey
    )
    return []
  }
  if (raw.length > IMPORT_LIMITS.maxChildItems) {
    addError(
      errors,
      rowNumber,
      fieldName,
      "CHILD_LIMIT_EXCEEDED",
      `${fieldName} exceeds ${IMPORT_LIMITS.maxChildItems} items per row`,
      sourceKey
    )
    return []
  }
  const seenKeys = new Set<string>()
  const out: LegacyPayment[] = []
  const allowedKeys = [
    "sourceKey",
    "amount",
    "date",
    "method",
    "reference",
    "direction",
    "category",
    "reversalOfSourceKey",
  ]

  raw.forEach((item, idx) => {
    const path = `${fieldName}[${idx}]`
    if (!isPlainObject(item)) {
      addError(
        errors,
        rowNumber,
        path,
        "INVALID_OBJECT",
        `${path} must be an object`,
        sourceKey
      )
      return
    }
    rejectUnknownJsonKeys(item, allowedKeys, rowNumber, path, errors, sourceKey)

    const pKey = parseJsonStringField(
      item,
      "sourceKey",
      rowNumber,
      `${path}.sourceKey`,
      errors,
      { required: true, maxLen: 200 },
      sourceKey
    )
    if (pKey) {
      if (seenKeys.has(pKey)) {
        addError(
          errors,
          rowNumber,
          `${path}.sourceKey`,
          "DUPLICATE_SOURCE_KEY",
          `Duplicate payment sourceKey "${pKey}"`,
          sourceKey
        )
      }
      seenKeys.add(pKey)
    }

    const amount = parseJsonMoneyField(
      item,
      "amount",
      rowNumber,
      `${path}.amount`,
      errors,
      { required: true, positive: true },
      sourceKey
    )
    const dateStr = parseJsonStringField(
      item,
      "date",
      rowNumber,
      `${path}.date`,
      errors,
      { required: true, maxLen: 10 },
      sourceKey
    )
    if (dateStr && !isValidGregorianDate(dateStr)) {
      addError(
        errors,
        rowNumber,
        `${path}.date`,
        "INVALID_DATE",
        `Invalid Gregorian date "${dateStr}"`,
        sourceKey
      )
    }

    const methodRaw = parseJsonStringField(
      item,
      "method",
      rowNumber,
      `${path}.method`,
      errors,
      { required: true, maxLen: 20 },
      sourceKey
    )?.toUpperCase()
    const method =
      methodRaw && METHODS.includes(methodRaw as Method)
        ? (methodRaw as Method)
        : undefined
    if (methodRaw && !method) {
      addError(
        errors,
        rowNumber,
        `${path}.method`,
        "INVALID_ENUM",
        `Invalid method "${methodRaw}"`,
        sourceKey
      )
    }

    const dirRaw = parseJsonStringField(
      item,
      "direction",
      rowNumber,
      `${path}.direction`,
      errors,
      { required: true, maxLen: 10 },
      sourceKey
    )?.toUpperCase()
    const direction =
      dirRaw && DIRECTIONS.includes(dirRaw as "IN" | "OUT")
        ? (dirRaw as "IN" | "OUT")
        : undefined
    if (dirRaw && !direction) {
      addError(
        errors,
        rowNumber,
        `${path}.direction`,
        "INVALID_ENUM",
        `Invalid direction "${dirRaw}"`,
        sourceKey
      )
    }

    const category = parseJsonStringField(
      item,
      "category",
      rowNumber,
      `${path}.category`,
      errors,
      { required: true, maxLen: 100 },
      sourceKey
    )
    const reference = parseJsonStringField(
      item,
      "reference",
      rowNumber,
      `${path}.reference`,
      errors,
      { required: false, maxLen: 200 },
      sourceKey
    )
    const reversalOfSourceKey = parseJsonStringField(
      item,
      "reversalOfSourceKey",
      rowNumber,
      `${path}.reversalOfSourceKey`,
      errors,
      { required: false, maxLen: 200 },
      sourceKey
    )
    if (reversalOfSourceKey && pKey && reversalOfSourceKey === pKey) {
      addError(
        errors,
        rowNumber,
        `${path}.reversalOfSourceKey`,
        "INVALID_REVERSAL",
        "Payment cannot reverse itself",
        sourceKey
      )
    }

    if (
      pKey &&
      amount &&
      dateStr &&
      isValidGregorianDate(dateStr) &&
      method &&
      direction &&
      category
    ) {
      out.push({
        sourceKey: pKey,
        amount,
        date: dateStr,
        method,
        direction,
        category,
        ...(reference !== undefined ? { reference } : {}),
        ...(reversalOfSourceKey !== undefined ? { reversalOfSourceKey } : {}),
      })
    }
  })

  return out
}

function parseLegacyRefPair(
  r: RowReader,
  prefix: string,
  targetType: ImportType | "FINANCE_COMPANIES",
  namespace: string,
  required: boolean
): LegacyRef | undefined {
  const skCol = `${prefix}SourceKey`
  const idCol = `${prefix}ExistingId`
  const sk = r.optString(skCol, 200)
  const eid = r.optUuid(idCol)
  if (sk !== undefined && eid !== undefined) {
    addError(
      r.errors,
      r.rowNumber,
      idCol,
      "CONFLICTING_REFERENCE",
      `Cannot supply both ${skCol} and ${idCol}`,
      r.sourceKey
    )
    return undefined
  }
  if (eid !== undefined) return { existingId: eid }
  if (sk !== undefined) return { namespace, type: targetType, sourceKey: sk }
  if (
    required &&
    !r.errors.some(
      (e) =>
        e.rowNumber === r.rowNumber && (e.field === skCol || e.field === idCol)
    )
  ) {
    addError(
      r.errors,
      r.rowNumber,
      skCol,
      "MISSING_REQUIRED",
      `Either ${skCol} or ${idCol} is required`,
      r.sourceKey
    )
  }
  return undefined
}

function parseLegacyMetadata(r: RowReader): LegacyMetadata | undefined {
  const recordedAt = r.optInstant("legacyRecordedAt")
  const recordedByName = r.optString("legacyRecordedByName", 200)
  const approverName = r.optString("legacyApproverName", 200)
  const approvalReference = r.optString("legacyApprovalReference", 200)
  const originalId = r.optString("legacyOriginalId", 200)
  const notes = r.optString("legacyNotes", 2000)
  const out: LegacyMetadata = {
    ...(recordedAt !== undefined ? { recordedAt } : {}),
    ...(recordedByName !== undefined ? { recordedByName } : {}),
    ...(approverName !== undefined ? { approverName } : {}),
    ...(approvalReference !== undefined ? { approvalReference } : {}),
    ...(originalId !== undefined ? { originalId } : {}),
    ...(notes !== undefined ? { notes } : {}),
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function netOutflowMinor(payments: readonly LegacyPayment[]): bigint {
  let outSum = 0n
  let inSum = 0n
  for (const p of payments) {
    const amt = minor(p.amount)
    if (p.direction === "OUT") outSum += amt
    else inSum += amt
  }
  return outSum - inSum
}

// ============================================================================
// Per-Type Row Parsers
// ============================================================================

function parseContactsField(r: RowReader): Contact[] {
  const hasJson = r.getText("contacts", "string") !== undefined
  const flatFields = [
    "contactName",
    "contactPhone",
    "contactEmail",
    "contactRole",
    "contactPrimary",
  ]
  const hasFlat = flatFields.some((f) => r.getText(f, "string") !== undefined)

  if (hasJson && hasFlat) {
    addError(
      r.errors,
      r.rowNumber,
      "contacts",
      "CONFLICTING_COLUMNS",
      "Cannot supply both contacts JSON and flat contact* columns",
      r.sourceKey
    )
    return []
  }

  if (hasFlat) {
    const name = r.reqString("contactName", 200)
    const phone = r.reqPhone("contactPhone")
    const email = r.optEmail("contactEmail")
    const role = r.reqString("contactRole", 200)
    const primary = r.optBool("contactPrimary") ?? true
    if (name && phone && role) {
      return [
        {
          name,
          phone,
          ...(email !== undefined ? { email } : {}),
          role,
          primary,
        },
      ]
    }
    return []
  }

  if (!hasJson) return []
  const raw = r.optJson("contacts")
  if (raw === undefined) return []
  if (!Array.isArray(raw)) {
    addError(
      r.errors,
      r.rowNumber,
      "contacts",
      "INVALID_JSON",
      "contacts must be a JSON array",
      r.sourceKey
    )
    return []
  }
  if (raw.length > IMPORT_LIMITS.maxChildItems) {
    addError(
      r.errors,
      rowNumberFromReader(r),
      "contacts",
      "CHILD_LIMIT_EXCEEDED",
      `contacts exceeds ${IMPORT_LIMITS.maxChildItems} items`,
      r.sourceKey
    )
    return []
  }

  const out: Contact[] = []
  const seen = new Set<string>()
  let primaryCount = 0
  const allowedKeys = ["name", "phone", "email", "role", "primary"]

  raw.forEach((item, idx) => {
    const path = `contacts[${idx}]`
    if (!isPlainObject(item)) {
      addError(
        r.errors,
        r.rowNumber,
        path,
        "INVALID_OBJECT",
        `${path} must be an object`,
        r.sourceKey
      )
      return
    }
    rejectUnknownJsonKeys(
      item,
      allowedKeys,
      r.rowNumber,
      path,
      r.errors,
      r.sourceKey
    )
    const name = parseJsonStringField(
      item,
      "name",
      r.rowNumber,
      `${path}.name`,
      r.errors,
      { required: true, maxLen: 200 },
      r.sourceKey
    )
    const phone = parseJsonStringField(
      item,
      "phone",
      r.rowNumber,
      `${path}.phone`,
      r.errors,
      { required: true, maxLen: 30 },
      r.sourceKey
    )
    if (phone && (phone.length < 3 || !PHONE_RE.test(phone))) {
      addError(
        r.errors,
        r.rowNumber,
        `${path}.phone`,
        "INVALID_PHONE",
        `Invalid contact phone "${phone}"`,
        r.sourceKey
      )
    }
    const email = parseJsonStringField(
      item,
      "email",
      r.rowNumber,
      `${path}.email`,
      r.errors,
      { required: false, maxLen: 254 },
      r.sourceKey
    )
    if (email && !EMAIL_RE.test(email)) {
      addError(
        r.errors,
        r.rowNumber,
        `${path}.email`,
        "INVALID_EMAIL",
        `Invalid contact email "${email}"`,
        r.sourceKey
      )
    }
    const role = parseJsonStringField(
      item,
      "role",
      r.rowNumber,
      `${path}.role`,
      r.errors,
      { required: true, maxLen: 200 },
      r.sourceKey
    )
    if (typeof item.primary !== "boolean") {
      addError(
        r.errors,
        r.rowNumber,
        `${path}.primary`,
        "INVALID_BOOLEAN",
        `${path}.primary must be boolean`,
        r.sourceKey
      )
    }
    if (item.primary === true) primaryCount++
    if (
      name &&
      phone &&
      phone.length >= 3 &&
      PHONE_RE.test(phone) &&
      (!email || EMAIL_RE.test(email)) &&
      role &&
      typeof item.primary === "boolean"
    ) {
      const contact: Contact = {
        name,
        phone,
        ...(email !== undefined ? { email } : {}),
        role,
        primary: item.primary,
      }
      const sig = canonical(contact)
      if (seen.has(sig)) {
        addError(
          r.errors,
          r.rowNumber,
          path,
          "DUPLICATE_CONTACT",
          "Duplicate contact entry",
          r.sourceKey
        )
      }
      seen.add(sig)
      out.push(contact)
    }
  })

  if (primaryCount > 1) {
    addError(
      r.errors,
      r.rowNumber,
      "contacts",
      "MULTIPLE_PRIMARY_CONTACTS",
      "At most one primary contact is allowed",
      r.sourceKey
    )
  }
  return out
}

function rowNumberFromReader(r: RowReader): number {
  return r.rowNumber
}

function parseDirectoryRow<K extends "SUPPLIERS" | "REPAIR_VENDORS">(
  type: K,
  r: RowReader
): ImportPayloads[K] | null {
  const errStart = r.errors.length
  const name = r.reqString("name", 200)
  const category = r.reqEnum("category", PARTY_CATEGORIES)
  const nicOrRegNumber = r.optString("nicOrRegNumber", 100)
  const address = r.optString("address", 2000)
  const phone = r.optPhone("phone")
  const hotline = r.optPhone("hotline")
  const recurring = r.optBool("recurring")
  const specialisation =
    type === "REPAIR_VENDORS" ? r.optString("specialisation", 2000) : undefined
  const notes = r.optString("notes", 2000)
  const isActive = r.optBool("isActive")
  const contacts = parseContactsField(r)

  if (r.errors.length > errStart || !name || !category) return null
  return {
    name,
    category,
    ...(nicOrRegNumber !== undefined ? { nicOrRegNumber } : {}),
    ...(address !== undefined ? { address } : {}),
    ...(phone !== undefined ? { phone } : {}),
    ...(hotline !== undefined ? { hotline } : {}),
    ...(recurring !== undefined ? { recurring } : {}),
    ...(specialisation !== undefined ? { specialisation } : {}),
    ...(notes !== undefined ? { notes } : {}),
    ...(isActive !== undefined ? { isActive } : {}),
    contacts,
  }
}

function parseCustomerRow(r: RowReader): ImportPayloads["CUSTOMERS"] | null {
  const errStart = r.errors.length
  const fullName = r.reqString("fullName", 200)
  const callingName = r.reqString("callingName", 200)
  const nicOrPassport = r.reqString("nicOrPassport", 100)
  if (
    nicOrPassport !== undefined &&
    normalizeCustomerIdentity(nicOrPassport).length === 0
  ) {
    addError(
      r.errors,
      r.rowNumber,
      "nicOrPassport",
      "INVALID_IDENTITY",
      "nicOrPassport must contain non-whitespace characters",
      r.sourceKey
    )
  }
  const address = r.reqString("address", 2000)
  const phone = r.reqPhone("phone")
  const email = r.optEmail("email")
  const drivingLicence = r.optString("drivingLicence", 100)
  const notes = r.optString("notes", 2000)
  const isActive = r.optBool("isActive")

  if (
    r.errors.length > errStart ||
    !fullName ||
    !callingName ||
    !nicOrPassport ||
    !address ||
    !phone
  ) {
    return null
  }
  return {
    fullName,
    callingName,
    nicOrPassport,
    address,
    phone,
    ...(email !== undefined ? { email } : {}),
    ...(drivingLicence !== undefined ? { drivingLicence } : {}),
    ...(notes !== undefined ? { notes } : {}),
    ...(isActive !== undefined ? { isActive } : {}),
  }
}

function parseMileageArray(r: RowReader): Mileage[] {
  const hasJson = r.getText("mileage", "string") !== undefined
  const flatFields = [
    "initialMileageReading",
    "initialMileageDate",
    "initialMileageRemark",
  ]
  const hasFlat = flatFields.some((f) => r.getText(f, "string") !== undefined)

  if (hasJson && hasFlat) {
    addError(
      r.errors,
      r.rowNumber,
      "mileage",
      "CONFLICTING_COLUMNS",
      "Cannot supply both mileage JSON and initialMileage* columns",
      r.sourceKey
    )
    return []
  }
  if (hasFlat) {
    const reading = r.reqInt("initialMileageReading", 0, 99_999_999)
    const date = r.reqDate("initialMileageDate")
    const remark = r.optString("initialMileageRemark", 2000)
    if (reading !== undefined && date !== undefined) {
      return [
        {
          reading,
          date,
          ...(remark !== undefined ? { remark } : {}),
        },
      ]
    }
    return []
  }

  if (!hasJson) return []
  const raw = r.optJson("mileage")
  if (raw === undefined) return []
  if (!Array.isArray(raw)) {
    addError(
      r.errors,
      r.rowNumber,
      "mileage",
      "INVALID_JSON",
      "mileage must be a JSON array",
      r.sourceKey
    )
    return []
  }
  if (raw.length > IMPORT_LIMITS.maxChildItems) {
    addError(
      r.errors,
      r.rowNumber,
      "mileage",
      "CHILD_LIMIT_EXCEEDED",
      `mileage exceeds ${IMPORT_LIMITS.maxChildItems} items`,
      r.sourceKey
    )
    return []
  }

  const out: Mileage[] = []
  const allowedKeys = ["reading", "date", "remark", "decreaseReason"]

  raw.forEach((item, idx) => {
    const path = `mileage[${idx}]`
    if (!isPlainObject(item)) {
      addError(
        r.errors,
        r.rowNumber,
        path,
        "INVALID_OBJECT",
        `${path} must be an object`,
        r.sourceKey
      )
      return
    }
    rejectUnknownJsonKeys(
      item,
      allowedKeys,
      r.rowNumber,
      path,
      r.errors,
      r.sourceKey
    )
    const reading = item.reading
    if (
      typeof reading !== "number" ||
      !Number.isSafeInteger(reading) ||
      reading < 0 ||
      reading > 99_999_999
    ) {
      addError(
        r.errors,
        r.rowNumber,
        `${path}.reading`,
        "INVALID_INTEGER",
        `${path}.reading must be integer 0..99999999`,
        r.sourceKey
      )
    }
    const date = parseJsonStringField(
      item,
      "date",
      r.rowNumber,
      `${path}.date`,
      r.errors,
      { required: true, maxLen: 10 },
      r.sourceKey
    )
    if (date && !isValidGregorianDate(date)) {
      addError(
        r.errors,
        r.rowNumber,
        `${path}.date`,
        "INVALID_DATE",
        `Invalid Gregorian date "${date}"`,
        r.sourceKey
      )
    }
    const remark = parseJsonStringField(
      item,
      "remark",
      r.rowNumber,
      `${path}.remark`,
      r.errors,
      { required: false, maxLen: 2000 },
      r.sourceKey
    )
    const decreaseReason = parseJsonStringField(
      item,
      "decreaseReason",
      r.rowNumber,
      `${path}.decreaseReason`,
      r.errors,
      { required: false, maxLen: 2000 },
      r.sourceKey
    )

    if (
      typeof reading === "number" &&
      Number.isSafeInteger(reading) &&
      reading >= 0 &&
      reading <= 99_999_999 &&
      date &&
      isValidGregorianDate(date)
    ) {
      out.push({
        reading,
        date,
        ...(remark !== undefined ? { remark } : {}),
        ...(decreaseReason !== undefined ? { decreaseReason } : {}),
      })
    }
  })

  // Check chronological non-decreasing mileage unless decreaseReason is given.
  const sorted = [...out].sort((a, b) => a.date.localeCompare(b.date))
  for (let i = 1; i < sorted.length; i++) {
    if (
      sorted[i].reading < sorted[i - 1].reading &&
      !sorted[i].decreaseReason
    ) {
      addError(
        r.errors,
        r.rowNumber,
        "mileage",
        "MISSING_DECREASE_REASON",
        "Decreasing mileage reading requires decreaseReason",
        r.sourceKey
      )
      break
    }
  }
  return out
}

function parseAdditionalCostsArray(
  r: RowReader
): ImportPayloads["VEHICLES"]["additionalCosts"] {
  const raw = r.optJson("additionalCosts")
  if (raw === undefined) return []
  if (!Array.isArray(raw)) {
    addError(
      r.errors,
      r.rowNumber,
      "additionalCosts",
      "INVALID_JSON",
      "additionalCosts must be a JSON array",
      r.sourceKey
    )
    return []
  }
  if (raw.length > IMPORT_LIMITS.maxChildItems) {
    addError(
      r.errors,
      r.rowNumber,
      "additionalCosts",
      "CHILD_LIMIT_EXCEEDED",
      `additionalCosts exceeds ${IMPORT_LIMITS.maxChildItems} items`,
      r.sourceKey
    )
    return []
  }

  const out: ImportPayloads["VEHICLES"]["additionalCosts"] = []
  const seenKeys = new Set<string>()
  const allowedKeys = [
    "sourceKey",
    "category",
    "description",
    "amount",
    "date",
    "payments",
  ]

  raw.forEach((item, idx) => {
    const path = `additionalCosts[${idx}]`
    if (!isPlainObject(item)) {
      addError(
        r.errors,
        r.rowNumber,
        path,
        "INVALID_OBJECT",
        `${path} must be an object`,
        r.sourceKey
      )
      return
    }
    rejectUnknownJsonKeys(
      item,
      allowedKeys,
      r.rowNumber,
      path,
      r.errors,
      r.sourceKey
    )
    const cKey = parseJsonStringField(
      item,
      "sourceKey",
      r.rowNumber,
      `${path}.sourceKey`,
      r.errors,
      { required: true, maxLen: 200 },
      r.sourceKey
    )
    if (cKey) {
      if (seenKeys.has(cKey)) {
        addError(
          r.errors,
          r.rowNumber,
          `${path}.sourceKey`,
          "DUPLICATE_SOURCE_KEY",
          `Duplicate additionalCost sourceKey "${cKey}"`,
          r.sourceKey
        )
      }
      seenKeys.add(cKey)
    }
    const category = parseJsonStringField(
      item,
      "category",
      r.rowNumber,
      `${path}.category`,
      r.errors,
      { required: true, maxLen: 200 },
      r.sourceKey
    )
    const description = parseJsonStringField(
      item,
      "description",
      r.rowNumber,
      `${path}.description`,
      r.errors,
      { required: true, maxLen: 2000 },
      r.sourceKey
    )
    const amount = parseJsonMoneyField(
      item,
      "amount",
      r.rowNumber,
      `${path}.amount`,
      r.errors,
      { required: true },
      r.sourceKey
    )
    const date = parseJsonStringField(
      item,
      "date",
      r.rowNumber,
      `${path}.date`,
      r.errors,
      { required: true, maxLen: 10 },
      r.sourceKey
    )
    if (date && !isValidGregorianDate(date)) {
      addError(
        r.errors,
        r.rowNumber,
        `${path}.date`,
        "INVALID_DATE",
        `Invalid Gregorian date "${date}"`,
        r.sourceKey
      )
    }
    const payments = parseLegacyPaymentsArray(
      item.payments,
      r.rowNumber,
      `${path}.payments`,
      r.errors,
      r.sourceKey
    )
    if (amount !== undefined && netOutflowMinor(payments) > minor(amount)) {
      addError(
        r.errors,
        r.rowNumber,
        `${path}.payments`,
        "BALANCE_MISMATCH",
        "Cost payments exceed cost amount",
        r.sourceKey
      )
    }
    if (
      cKey &&
      category &&
      description &&
      amount !== undefined &&
      date &&
      isValidGregorianDate(date)
    ) {
      out.push({
        sourceKey: cKey,
        category,
        description,
        amount,
        date,
        payments,
      })
    }
  })

  return out
}

function parseVehicleRow(
  r: RowReader,
  namespace: string
): ImportPayloads["VEHICLES"] | null {
  const errStart = r.errors.length
  const maxYear = new Date().getUTCFullYear() + 1

  const engineNumber = r.reqString("engineNumber", 100)
  if (
    engineNumber !== undefined &&
    normalizeVehicleIdentity(engineNumber).length === 0
  ) {
    addError(
      r.errors,
      r.rowNumber,
      "engineNumber",
      "INVALID_IDENTITY",
      "engineNumber must contain non-whitespace characters",
      r.sourceKey
    )
  }
  const chassisNumber = r.reqString("chassisNumber", 100)
  if (
    chassisNumber !== undefined &&
    normalizeVehicleIdentity(chassisNumber).length === 0
  ) {
    addError(
      r.errors,
      r.rowNumber,
      "chassisNumber",
      "INVALID_IDENTITY",
      "chassisNumber must contain non-whitespace characters",
      r.sourceKey
    )
  }
  const make = r.reqString("make", 200)
  const model = r.reqString("model", 200)
  const year = r.reqInt("year", 1886, maxYear)
  const colour = r.reqString("colour", 200)
  const fuelType = r.reqEnum("fuelType", FUEL_TYPES)
  const transmission = r.reqEnum("transmission", TRANSMISSIONS)
  const vin = r.optString("vin", 100)
  const crNumber = r.optString("crNumber", 100)
  const vehicleNotes = r.optString("vehicleNotes", 2000)

  const supplier = parseLegacyRefPair(
    r,
    "supplier",
    "SUPPLIERS",
    namespace,
    false
  )
  const sellerCustomer = parseLegacyRefPair(
    r,
    "sellerCustomer",
    "CUSTOMERS",
    namespace,
    false
  )
  const tradeInSale = parseLegacyRefPair(
    r,
    "tradeInSale",
    "SALES",
    namespace,
    false
  )

  if (supplier && sellerCustomer) {
    addError(
      r.errors,
      r.rowNumber,
      "sellerCustomerSourceKey",
      "CONFLICTING_SELLER",
      "Specify either supplier or sellerCustomer, never both",
      r.sourceKey
    )
  } else if (!supplier && !sellerCustomer) {
    addError(
      r.errors,
      r.rowNumber,
      "supplierSourceKey",
      "MISSING_REQUIRED",
      "Either supplier or sellerCustomer reference is required",
      r.sourceKey
    )
  }

  const cycleSourceKey = r.reqString("cycleSourceKey", 200)
  const cycleNumber = r.reqInt("cycleNumber", 1, 10_000)
  const purchaseType = r.reqEnum("purchaseType", PURCHASE_TYPES)
  const purchaseDate = r.reqDate("purchaseDate")
  const purchasePrice = r.reqMoney("purchasePrice", { positive: true })
  const listedPrice = r.optMoney("listedPrice")
  const notes = r.optString("notes", 2000)

  if (purchaseType === "BRAND_NEW" && sellerCustomer) {
    addError(
      r.errors,
      r.rowNumber,
      "purchaseType",
      "INVALID_PURCHASE_TYPE",
      "BRAND_NEW acquisition requires a supplier, not sellerCustomer",
      r.sourceKey
    )
  }
  if (tradeInSale) {
    if (!sellerCustomer) {
      addError(
        r.errors,
        r.rowNumber,
        "tradeInSaleSourceKey",
        "INVALID_TRADE_IN",
        "tradeInSale requires sellerCustomer",
        r.sourceKey
      )
    }
    if (purchaseType && purchaseType !== "CASH") {
      addError(
        r.errors,
        r.rowNumber,
        "purchaseType",
        "INVALID_TRADE_IN",
        "tradeInSale cycle must use purchaseType CASH",
        r.sourceKey
      )
    }
  }

  // Settlement fields
  let settlement: ImportPayloads["VEHICLES"]["settlement"] | undefined
  if (purchaseType === "LEASE_SETTLEMENT") {
    const reqRef = r.reqString("settlementReference", 200)
    const reqAmt = r.reqMoney("settlementAmount")
    const reqCash = r.reqMoney("settlementCashToSeller")
    const reqInstType = r.reqEnum(
      "settlementInstitutionType",
      INSTITUTION_TYPES
    )

    if (reqAmt !== undefined && reqCash !== undefined) {
      const total = bounded(minor(reqAmt) + minor(reqCash), A)
      if (total === 0n) {
        addError(
          r.errors,
          r.rowNumber,
          "settlementAmount",
          "NON_POSITIVE_MONEY",
          "Settlement amount + cashToSeller must be positive",
          r.sourceKey
        )
      }
      if (purchasePrice !== undefined && total !== minor(purchasePrice)) {
        addError(
          r.errors,
          r.rowNumber,
          "purchasePrice",
          "BALANCE_MISMATCH",
          "settlementAmount + settlementCashToSeller must equal purchasePrice",
          r.sourceKey
        )
      }
    }

    if (reqInstType === "FINANCE_COMPANY") {
      const comp = parseLegacyRefPair(
        r,
        "settlementCompany",
        "FINANCE_COMPANIES",
        namespace,
        true
      )
      if (r.hasAny(["settlementInstitutionName"])) {
        addError(
          r.errors,
          r.rowNumber,
          "settlementInstitutionName",
          "CONFLICTING_COLUMNS",
          "settlementInstitutionName is forbidden for FINANCE_COMPANY settlement",
          r.sourceKey
        )
      }
      if (reqRef && reqAmt !== undefined && reqCash !== undefined && comp) {
        settlement = {
          reference: reqRef,
          amount: reqAmt,
          cashToSeller: reqCash,
          institutionType: "FINANCE_COMPANY",
          company: comp,
        }
      }
    } else if (reqInstType === "BANK" || reqInstType === "PRIVATE_PARTY") {
      const instName = r.reqString("settlementInstitutionName", 200)
      if (
        r.hasAny(["settlementCompanySourceKey", "settlementCompanyExistingId"])
      ) {
        addError(
          r.errors,
          r.rowNumber,
          "settlementCompanySourceKey",
          "CONFLICTING_COLUMNS",
          "settlementCompany* is forbidden for BANK or PRIVATE_PARTY settlement",
          r.sourceKey
        )
      }
      if (reqRef && reqAmt !== undefined && reqCash !== undefined && instName) {
        settlement = {
          reference: reqRef,
          amount: reqAmt,
          cashToSeller: reqCash,
          institutionType: reqInstType,
          institutionName: instName,
        }
      }
    }
  } else if (
    r.hasAny([
      "settlementReference",
      "settlementAmount",
      "settlementCashToSeller",
      "settlementInstitutionType",
      "settlementCompanyExistingId",
      "settlementCompanySourceKey",
      "settlementInstitutionName",
    ])
  ) {
    addError(
      r.errors,
      r.rowNumber,
      "settlementReference",
      "UNEXPECTED_SETTLEMENT",
      "Settlement fields are only allowed when purchaseType is LEASE_SETTLEMENT",
      r.sourceKey
    )
  }

  const mileage = parseMileageArray(r)
  const status = r.reqEnum("status", states)
  const available = r.reqBool("available")
  const holdReason = r.optString("holdReason", 2000)
  const receivedDate = r.optDate("receivedDate")
  const closedAt = r.optInstant("closedAt")

  if (status !== undefined) {
    if (status !== "IN_STOCK" && available === true) {
      addError(
        r.errors,
        r.rowNumber,
        "available",
        "INVALID_AVAILABILITY",
        `available must be false when status is ${status}`,
        r.sourceKey
      )
    }
    if (status === "IN_STOCK" && available === false && !holdReason) {
      addError(
        r.errors,
        r.rowNumber,
        "holdReason",
        "MISSING_REQUIRED",
        "holdReason is required when IN_STOCK vehicle is held (available=false)",
        r.sourceKey
      )
    }
    if (status === "PURCHASED" && receivedDate !== undefined) {
      addError(
        r.errors,
        r.rowNumber,
        "receivedDate",
        "INVALID_STATE",
        "receivedDate must be absent when status is PURCHASED",
        r.sourceKey
      )
    }
    if (
      status !== "PURCHASED" &&
      status !== "WRITTEN_OFF" &&
      receivedDate === undefined &&
      !r.errors.some(
        (e) => e.rowNumber === r.rowNumber && e.field === "receivedDate"
      )
    ) {
      addError(
        r.errors,
        r.rowNumber,
        "receivedDate",
        "MISSING_REQUIRED",
        `receivedDate is required when status is ${status}`,
        r.sourceKey
      )
    }
    if (purchaseDate && receivedDate && receivedDate < purchaseDate) {
      addError(
        r.errors,
        r.rowNumber,
        "receivedDate",
        "CHRONOLOGY_VIOLATION",
        "receivedDate cannot precede purchaseDate",
        r.sourceKey
      )
    }
    const isTerminal =
      status === "SOLD" || status === "DELIVERED" || status === "WRITTEN_OFF"
    if (isTerminal && closedAt === undefined) {
      addError(
        r.errors,
        r.rowNumber,
        "closedAt",
        "MISSING_REQUIRED",
        `closedAt is required for terminal status ${status}`,
        r.sourceKey
      )
    }
    if (!isTerminal && closedAt !== undefined) {
      addError(
        r.errors,
        r.rowNumber,
        "closedAt",
        "INVALID_STATE",
        `closedAt must be absent for open status ${status}`,
        r.sourceKey
      )
    }
  }

  const payments = parseLegacyPaymentsArray(
    r.optJson("payments"),
    r.rowNumber,
    "payments",
    r.errors,
    r.sourceKey
  )
  if (tradeInSale && payments.length > 0) {
    addError(
      r.errors,
      r.rowNumber,
      "payments",
      "INVALID_TRADE_IN",
      "Noncash trade-in acquisition cannot include purchase payments",
      r.sourceKey
    )
  } else if (
    purchasePrice !== undefined &&
    netOutflowMinor(payments) > minor(purchasePrice)
  ) {
    addError(
      r.errors,
      r.rowNumber,
      "payments",
      "BALANCE_MISMATCH",
      "Purchase payments exceed purchasePrice",
      r.sourceKey
    )
  }

  const additionalCosts = parseAdditionalCostsArray(r)

  // Disposal fields
  let disposal: ImportPayloads["VEHICLES"]["disposal"] | undefined
  if (status === "WRITTEN_OFF") {
    const reqDDate = r.reqDate("disposalDate")
    const reqDReason = r.reqString("disposalReason", 2000)
    const reqDMethod = r.reqEnum("disposalMethod", DISPOSAL_METHODS)
    const reqDProceeds = r.reqMoney("disposalProceeds")
    const reqDApprover = r.reqString("disposalApproverName", 200)
    const dAppRef = r.optString("disposalApprovalReference", 200)

    if (purchaseDate && reqDDate && reqDDate < purchaseDate) {
      addError(
        r.errors,
        r.rowNumber,
        "disposalDate",
        "CHRONOLOGY_VIOLATION",
        "disposalDate cannot precede purchaseDate",
        r.sourceKey
      )
    }

    let receipt: CashInput | undefined
    if (reqDProceeds !== undefined && minor(reqDProceeds) > 0n) {
      const dRecAmt = r.optMoney("disposalReceiptAmount")
      const recDate = r.reqDate("disposalReceiptDate")
      const recMethod = r.reqEnum("disposalReceiptMethod", METHODS)
      const dRecRef = r.optString("disposalReceiptReference", 200)
      if (dRecAmt !== undefined && dRecAmt !== reqDProceeds) {
        addError(
          r.errors,
          r.rowNumber,
          "disposalReceiptAmount",
          "BALANCE_MISMATCH",
          "disposalReceiptAmount must equal disposalProceeds",
          r.sourceKey
        )
      }
      if (recDate && recMethod) {
        receipt = {
          amount: reqDProceeds,
          date: recDate,
          method: recMethod,
          ...(dRecRef !== undefined ? { reference: dRecRef } : {}),
        }
      }
    } else if (
      reqDProceeds === "0" &&
      r.hasAny([
        "disposalReceiptAmount",
        "disposalReceiptDate",
        "disposalReceiptMethod",
        "disposalReceiptReference",
      ])
    ) {
      addError(
        r.errors,
        r.rowNumber,
        "disposalReceiptDate",
        "UNEXPECTED_RECEIPT",
        "Zero disposal proceeds must not have a disposal receipt",
        r.sourceKey
      )
    }

    if (
      reqDDate &&
      reqDReason &&
      reqDMethod &&
      reqDProceeds !== undefined &&
      reqDApprover
    ) {
      const legacyApproval: LegacyApprovalEvidence = {
        approverName: reqDApprover,
        ...(dAppRef !== undefined ? { approvalReference: dAppRef } : {}),
      }
      disposal = {
        date: reqDDate,
        reason: reqDReason,
        method: reqDMethod,
        proceeds: reqDProceeds,
        ...(receipt ? { receipt } : {}),
        legacyApproval,
      }
    }
  } else if (
    r.hasAny([
      "disposalDate",
      "disposalReason",
      "disposalMethod",
      "disposalProceeds",
      "disposalReceiptAmount",
      "disposalReceiptDate",
      "disposalReceiptMethod",
      "disposalReceiptReference",
      "disposalApproverName",
      "disposalApprovalReference",
    ])
  ) {
    addError(
      r.errors,
      r.rowNumber,
      "disposalDate",
      "UNEXPECTED_DISPOSAL",
      "Disposal fields are only allowed when status is WRITTEN_OFF",
      r.sourceKey
    )
  }

  if (
    r.errors.length > errStart ||
    !engineNumber ||
    !chassisNumber ||
    !make ||
    !model ||
    year === undefined ||
    !colour ||
    !fuelType ||
    !transmission ||
    !cycleSourceKey ||
    cycleNumber === undefined ||
    !purchaseType ||
    !purchaseDate ||
    purchasePrice === undefined ||
    !status ||
    available === undefined
  ) {
    return null
  }

  return {
    vehicle: {
      engineNumber,
      chassisNumber,
      make,
      model,
      year,
      colour,
      fuelType,
      transmission,
      ...(vin !== undefined ? { vin } : {}),
      ...(crNumber !== undefined ? { crNumber } : {}),
      ...(vehicleNotes !== undefined ? { notes: vehicleNotes } : {}),
    },
    ...(supplier ? { supplier } : {}),
    ...(sellerCustomer ? { sellerCustomer } : {}),
    ...(tradeInSale ? { tradeInSale } : {}),
    cycleSourceKey,
    cycleNumber,
    purchaseType,
    purchaseDate,
    purchasePrice,
    ...(listedPrice !== undefined ? { listedPrice } : {}),
    ...(notes !== undefined ? { notes } : {}),
    ...(settlement ? { settlement } : {}),
    mileage,
    status,
    available,
    ...(holdReason !== undefined ? { holdReason } : {}),
    ...(receivedDate !== undefined ? { receivedDate } : {}),
    ...(closedAt !== undefined ? { closedAt } : {}),
    payments,
    additionalCosts,
    ...(disposal ? { disposal } : {}),
  }
}

function parseBasisComponents(
  raw: unknown,
  rowNumber: number,
  fieldName: string,
  errors: ImportParseError[],
  sourceKey?: string
): { sourceKey: string; amount: Money }[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) {
    addError(
      errors,
      rowNumber,
      fieldName,
      "INVALID_JSON",
      `${fieldName} must be a JSON array`,
      sourceKey
    )
    return []
  }
  if (raw.length > IMPORT_LIMITS.maxChildItems) {
    addError(
      errors,
      rowNumber,
      fieldName,
      "CHILD_LIMIT_EXCEEDED",
      `${fieldName} exceeds ${IMPORT_LIMITS.maxChildItems} items`,
      sourceKey
    )
    return []
  }
  const out: { sourceKey: string; amount: Money }[] = []
  const seen = new Set<string>()
  raw.forEach((item, idx) => {
    const path = `${fieldName}[${idx}]`
    if (!isPlainObject(item)) {
      addError(
        errors,
        rowNumber,
        path,
        "INVALID_OBJECT",
        `${path} must be an object`,
        sourceKey
      )
      return
    }
    rejectUnknownJsonKeys(
      item,
      ["sourceKey", "amount"],
      rowNumber,
      path,
      errors,
      sourceKey
    )
    const key = parseJsonStringField(
      item,
      "sourceKey",
      rowNumber,
      `${path}.sourceKey`,
      errors,
      { required: true, maxLen: 200 },
      sourceKey
    )
    if (key) {
      if (seen.has(key)) {
        addError(
          errors,
          rowNumber,
          `${path}.sourceKey`,
          "DUPLICATE_SOURCE_KEY",
          `Duplicate basis component sourceKey "${key}"`,
          sourceKey
        )
      }
      seen.add(key)
    }
    const amount = parseJsonMoneyField(
      item,
      "amount",
      rowNumber,
      `${path}.amount`,
      errors,
      { required: true },
      sourceKey
    )
    if (key && amount !== undefined) out.push({ sourceKey: key, amount })
  })
  return out
}

function parseSaleRow(
  r: RowReader,
  namespace: string
): ImportPayloads["SALES"] | null {
  const errStart = r.errors.length
  const cycle = parseLegacyRefPair(r, "cycle", "VEHICLES", namespace, true)
  const customer = parseLegacyRefPair(
    r,
    "customer",
    "CUSTOMERS",
    namespace,
    true
  )
  const kind = r.reqEnum("kind", SALE_KINDS)
  const saleCaseSourceKey = r.reqString("saleCaseSourceKey", 200)
  const price = r.reqMoney("price", { positive: true })
  const reference = r.optString("reference", 200)
  const state = r.reqEnum("state", SALE_STATES)
  const notes = r.optString("notes", 2000)

  if (
    kind &&
    kind !== "LEASE" &&
    (state === "FINANCE_PENDING" || state === "DO_RECEIVED")
  ) {
    addError(
      r.errors,
      r.rowNumber,
      "state",
      "INVALID_STATE",
      `Sale state ${state} is only valid for LEASE sales`,
      r.sourceKey
    )
  }

  // Completion fields
  let completion: ImportPayloads["SALES"]["completion"] | undefined
  if (state === "COMPLETED") {
    const reqCDate = r.reqDate("completionDate")
    const reqCMileage = r.reqInt("completionMileage", 0, 99_999_999)
    const reqBP = r.reqMoney("completionBasisPurchase")
    const repairs = parseBasisComponents(
      r.optJson("completionBasisRepairs"),
      r.rowNumber,
      "completionBasisRepairs",
      r.errors,
      r.sourceKey
    )
    const costs = parseBasisComponents(
      r.optJson("completionBasisCosts"),
      r.rowNumber,
      "completionBasisCosts",
      r.errors,
      r.sourceKey
    )
    if (reqCDate && reqCMileage !== undefined && reqBP !== undefined) {
      completion = {
        date: reqCDate,
        mileage: reqCMileage,
        basis: { purchase: reqBP, repairs, costs },
      }
    }
  } else if (
    r.hasAny([
      "completionDate",
      "completionMileage",
      "completionBasisPurchase",
      "completionBasisRepairs",
      "completionBasisCosts",
    ])
  ) {
    addError(
      r.errors,
      r.rowNumber,
      "completionDate",
      "UNEXPECTED_COMPLETION",
      "Completion fields are only allowed when state is COMPLETED",
      r.sourceKey
    )
  }

  // Reservation ref
  const resRef = parseLegacyRefPair(
    r,
    "reservation",
    "ADVANCES",
    namespace,
    kind === "ADVANCE"
  )
  if (kind && kind !== "ADVANCE" && kind !== "LEASE" && resRef) {
    addError(
      r.errors,
      r.rowNumber,
      "reservationSourceKey",
      "UNEXPECTED_RESERVATION",
      "reservation reference is only allowed when kind is ADVANCE or LEASE",
      r.sourceKey
    )
  }

  // Finance fields
  let finance: ImportPayloads["SALES"]["finance"] | undefined
  if (kind === "LEASE") {
    const fCompany = parseLegacyRefPair(
      r,
      "financeCompany",
      "FINANCE_COMPANIES",
      namespace,
      true
    )
    const reqDown = r.reqMoney("downPayment", { positive: true })
    const reqAmt = r.reqMoney("financeAmount", { positive: true })
    const reqTerm = r.reqInt("termMonths", 1, 120)
    const fDoAtt = r.optUuid("doAttachmentId")
    const fDoDate = r.optDate("doIssueDate")
    if (reqDown !== undefined && reqAmt !== undefined && price !== undefined) {
      if (!resRef && minor(reqDown) + minor(reqAmt) !== minor(price)) {
        addError(
          r.errors,
          r.rowNumber,
          "financeAmount",
          "BALANCE_MISMATCH",
          "downPayment + financeAmount must equal sale price",
          r.sourceKey
        )
      }
    }
    if (state === "FINANCE_PENDING" && (fDoAtt || fDoDate)) {
      addError(
        r.errors,
        r.rowNumber,
        "doIssueDate",
        "INVALID_STATE",
        "DO fields must be absent when state is FINANCE_PENDING",
        r.sourceKey
      )
    }
    if ((state === "DO_RECEIVED" || state === "COMPLETED") && !fDoDate) {
      addError(
        r.errors,
        r.rowNumber,
        "doIssueDate",
        "MISSING_REQUIRED",
        `doIssueDate is required for LEASE sale in state ${state}`,
        r.sourceKey
      )
    }
    if (fCompany && reqDown && reqAmt && reqTerm !== undefined) {
      finance = {
        company: fCompany,
        downPayment: reqDown,
        financeAmount: reqAmt,
        termMonths: reqTerm,
        ...(fDoAtt !== undefined ? { doAttachmentId: fDoAtt } : {}),
        ...(fDoDate !== undefined ? { doIssueDate: fDoDate } : {}),
      }
    }
  } else if (
    r.hasAny([
      "financeCompanyExistingId",
      "financeCompanySourceKey",
      "downPayment",
      "financeAmount",
      "termMonths",
      "doAttachmentId",
      "doIssueDate",
    ])
  ) {
    addError(
      r.errors,
      r.rowNumber,
      "financeCompanyExistingId",
      "UNEXPECTED_FINANCE",
      "Finance fields are only allowed when kind is LEASE",
      r.sourceKey
    )
  }

  // Trade-in fields
  let tradeIn: ImportPayloads["SALES"]["tradeIn"] | undefined
  if (kind === "TRADE_IN") {
    const reqDesc = r.reqString("tradeInDescription", 2000)
    const reqVal = r.reqMoney("tradeInValue", { positive: true })
    const tiCycle = parseLegacyRefPair(
      r,
      "tradeInAcquiredCycle",
      "VEHICLES",
      namespace,
      false
    )
    if (
      reqVal !== undefined &&
      price !== undefined &&
      minor(reqVal) > minor(price)
    ) {
      addError(
        r.errors,
        r.rowNumber,
        "tradeInValue",
        "OVERALLOWANCE",
        "tradeInValue cannot exceed sale price",
        r.sourceKey
      )
    }
    if (reqDesc && reqVal) {
      tradeIn = {
        description: reqDesc,
        value: reqVal,
        ...(tiCycle ? { acquiredCycle: tiCycle } : {}),
      }
    }
  } else if (
    r.hasAny([
      "tradeInDescription",
      "tradeInValue",
      "tradeInAcquiredCycleSourceKey",
      "tradeInAcquiredCycleExistingId",
    ])
  ) {
    addError(
      r.errors,
      r.rowNumber,
      "tradeInDescription",
      "UNEXPECTED_TRADE_IN",
      "Trade-in fields are only allowed when kind is TRADE_IN",
      r.sourceKey
    )
  }

  const payments = parseLegacyPaymentsArray(
    r.optJson("payments"),
    r.rowNumber,
    "payments",
    r.errors,
    r.sourceKey
  )

  if (
    r.errors.length > errStart ||
    !cycle ||
    !customer ||
    !kind ||
    !saleCaseSourceKey ||
    price === undefined ||
    !state
  ) {
    return null
  }

  return {
    cycle,
    customer,
    kind,
    saleCaseSourceKey,
    price,
    ...(reference !== undefined ? { reference } : {}),
    state,
    ...(completion ? { completion } : {}),
    ...(resRef ? { reservation: resRef } : {}),
    ...(finance ? { finance } : {}),
    ...(tradeIn ? { tradeIn } : {}),
    payments,
    ...(notes !== undefined ? { notes } : {}),
  }
}

function parseRepairRow(
  r: RowReader,
  namespace: string
): ImportPayloads["REPAIRS"] | null {
  const errStart = r.errors.length
  const cycle = parseLegacyRefPair(r, "cycle", "VEHICLES", namespace, true)
  const vendor = parseLegacyRefPair(
    r,
    "vendor",
    "REPAIR_VENDORS",
    namespace,
    true
  )
  const request = r.reqString("request", 2000)
  const sentDate = r.reqDate("sentDate")

  const returnedDate = r.optDate("returnedDate")
  const invoiceDate = r.optDate("invoiceDate")
  const invoiceAmount = r.optMoney("invoiceAmount")
  const summary = r.optString("summary", 2000)

  const returnColsPresent = [
    r.getText("returnedDate", "date") !== undefined,
    r.getText("invoiceDate", "date") !== undefined,
    r.getText("invoiceAmount", "number") !== undefined,
    r.getText("summary", "string") !== undefined,
  ]
  const anyReturn = returnColsPresent.some(Boolean)
  const allReturn = returnColsPresent.every(Boolean)
  if (anyReturn && !allReturn) {
    for (const [idx, field] of [
      "returnedDate",
      "invoiceDate",
      "invoiceAmount",
      "summary",
    ].entries()) {
      if (!returnColsPresent[idx]) {
        addError(
          r.errors,
          r.rowNumber,
          field,
          "INCOMPLETE_RETURN_GROUP",
          "returnedDate, invoiceDate, invoiceAmount, and summary must all be present or all absent",
          r.sourceKey
        )
      }
    }
  }
  if (sentDate && returnedDate && returnedDate < sentDate) {
    addError(
      r.errors,
      r.rowNumber,
      "returnedDate",
      "CHRONOLOGY_VIOLATION",
      "returnedDate cannot precede sentDate",
      r.sourceKey
    )
  }
  if (sentDate && invoiceDate && invoiceDate < sentDate) {
    addError(
      r.errors,
      r.rowNumber,
      "invoiceDate",
      "CHRONOLOGY_VIOLATION",
      "invoiceDate cannot precede sentDate",
      r.sourceKey
    )
  }

  const payments = parseLegacyPaymentsArray(
    r.optJson("payments"),
    r.rowNumber,
    "payments",
    r.errors,
    r.sourceKey
  )
  if (!anyReturn && payments.length > 0) {
    addError(
      r.errors,
      r.rowNumber,
      "payments",
      "UNRETURNED_REPAIR_PAYMENT",
      "Unreturned repair cannot include payments",
      r.sourceKey
    )
  } else if (
    invoiceAmount !== undefined &&
    netOutflowMinor(payments) > minor(invoiceAmount)
  ) {
    addError(
      r.errors,
      r.rowNumber,
      "payments",
      "BALANCE_MISMATCH",
      "Repair payments exceed invoiceAmount",
      r.sourceKey
    )
  }

  if (
    r.errors.length > errStart ||
    !cycle ||
    !vendor ||
    !request ||
    !sentDate
  ) {
    return null
  }

  return {
    cycle,
    vendor,
    request,
    sentDate,
    ...(returnedDate !== undefined ? { returnedDate } : {}),
    ...(invoiceDate !== undefined ? { invoiceDate } : {}),
    ...(invoiceAmount !== undefined ? { invoiceAmount } : {}),
    ...(summary !== undefined ? { summary } : {}),
    payments,
  }
}

function validateTiersArray(
  raw: unknown,
  rowNumber: number,
  fieldPath: string,
  errors: ImportParseError[],
  sourceKey?: string
): SettingsInput["tiers"] | undefined {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 100) {
    addError(
      errors,
      rowNumber,
      fieldPath,
      "INVALID_TIERS",
      `${fieldPath} must be a non-empty array (max 100)`,
      sourceKey
    )
    return undefined
  }
  const out: SettingsInput["tiers"] = []
  let prevUpper = -1
  let bad = false
  raw.forEach((item, idx) => {
    const path = `${fieldPath}[${idx}]`
    if (!isPlainObject(item)) {
      addError(
        errors,
        rowNumber,
        path,
        "INVALID_OBJECT",
        `${path} must be an object`,
        sourceKey
      )
      bad = true
      return
    }
    rejectUnknownJsonKeys(
      item,
      ["upperBps", "days"],
      rowNumber,
      path,
      errors,
      sourceKey
    )
    const isLast = idx === raw.length - 1
    const upper = item.upperBps
    if (isLast) {
      if (upper !== null) {
        addError(
          errors,
          rowNumber,
          `${path}.upperBps`,
          "INVALID_TIERS",
          "Last tier upperBps must be null",
          sourceKey
        )
        bad = true
      }
    } else if (
      typeof upper !== "number" ||
      !Number.isSafeInteger(upper) ||
      upper < 0 ||
      upper > 10_000 ||
      upper <= prevUpper
    ) {
      addError(
        errors,
        rowNumber,
        `${path}.upperBps`,
        "INVALID_TIERS",
        "Tier upperBps must be strictly increasing integers 0..10000",
        sourceKey
      )
      bad = true
    } else {
      prevUpper = upper
    }
    const days = item.days
    if (
      typeof days !== "number" ||
      !Number.isSafeInteger(days) ||
      days < 1 ||
      days > 31
    ) {
      addError(
        errors,
        rowNumber,
        `${path}.days`,
        "INVALID_TIERS",
        "Tier days must be integer 1..31",
        sourceKey
      )
      bad = true
    }
    if (!bad) {
      out.push({ upperBps: upper as number | null, days: days as number })
    }
  })
  return bad ? undefined : out
}

function parsePolicySnapshot(
  r: RowReader,
  amount?: Money,
  listedBasis?: Money
): ImportPayloads["ADVANCES"]["policySnapshot"] | undefined {
  const hasJson = r.getText("policySnapshot", "string") !== undefined
  const splitFields = [
    "policyTimezone",
    "policyTiers",
    "policyLeadDays",
    "policyDays",
  ]
  const hasSplit = splitFields.some((f) => r.getText(f, "string") !== undefined)

  if (hasJson && hasSplit) {
    addError(
      r.errors,
      r.rowNumber,
      "policySnapshot",
      "CONFLICTING_COLUMNS",
      "Cannot supply both policySnapshot JSON and policy* columns",
      r.sourceKey
    )
    return undefined
  }

  if (hasJson) {
    const raw = r.optJson("policySnapshot")
    if (raw === undefined) return undefined
    if (!isPlainObject(raw)) {
      addError(
        r.errors,
        r.rowNumber,
        "policySnapshot",
        "INVALID_OBJECT",
        "policySnapshot must be a JSON object",
        r.sourceKey
      )
      return undefined
    }
    rejectUnknownJsonKeys(
      raw,
      ["timezone", "tiers", "leadDays", "days"],
      r.rowNumber,
      "policySnapshot",
      r.errors,
      r.sourceKey
    )
    const tz = parseJsonStringField(
      raw,
      "timezone",
      r.rowNumber,
      "policySnapshot.timezone",
      r.errors,
      { required: true, maxLen: 200 },
      r.sourceKey
    )
    if (tz && !isValidTimeZone(tz)) {
      addError(
        r.errors,
        r.rowNumber,
        "policySnapshot.timezone",
        "INVALID_TIMEZONE",
        `Invalid IANA timezone "${tz}"`,
        r.sourceKey
      )
    }
    const tiers = validateTiersArray(
      raw.tiers,
      r.rowNumber,
      "policySnapshot.tiers",
      r.errors,
      r.sourceKey
    )
    const leadDays = raw.leadDays
    if (
      typeof leadDays !== "number" ||
      !Number.isSafeInteger(leadDays) ||
      leadDays < 0 ||
      leadDays > 7
    ) {
      addError(
        r.errors,
        r.rowNumber,
        "policySnapshot.leadDays",
        "OUT_OF_RANGE",
        "policySnapshot.leadDays must be integer 0..7",
        r.sourceKey
      )
    }
    const days = raw.days
    if (
      typeof days !== "number" ||
      !Number.isSafeInteger(days) ||
      days < 1 ||
      days > 31
    ) {
      addError(
        r.errors,
        r.rowNumber,
        "policySnapshot.days",
        "OUT_OF_RANGE",
        "policySnapshot.days must be integer 1..31",
        r.sourceKey
      )
    }
    if (
      tz &&
      isValidTimeZone(tz) &&
      tiers &&
      typeof leadDays === "number" &&
      Number.isSafeInteger(leadDays) &&
      leadDays >= 0 &&
      leadDays <= 7 &&
      typeof days === "number" &&
      Number.isSafeInteger(days) &&
      days >= 1 &&
      days <= 31
    ) {
      return { timezone: tz, tiers, leadDays, days }
    }
    return undefined
  }

  const timezone = r.optString("policyTimezone", 200) ?? "Asia/Colombo"
  if (!isValidTimeZone(timezone)) {
    addError(
      r.errors,
      r.rowNumber,
      "policyTimezone",
      "INVALID_TIMEZONE",
      `Invalid IANA timezone "${timezone}"`,
      r.sourceKey
    )
  }
  const tiersRaw = r.optJson("policyTiers")
  const tiers =
    tiersRaw !== undefined
      ? validateTiersArray(
          tiersRaw,
          r.rowNumber,
          "policyTiers",
          r.errors,
          r.sourceKey
        )
      : DEFAULT_TIERS
  const leadDays = r.optInt("policyLeadDays", 0, 7) ?? 3
  let days = r.optInt("policyDays", 1, 31)
  if (
    days === undefined &&
    !r.errors.some(
      (e) => e.rowNumber === r.rowNumber && e.field === "policyDays"
    )
  ) {
    days =
      amount && listedBasis ? tierDays(minor(amount), minor(listedBasis)) : 7
  }
  if (!isValidTimeZone(timezone) || !tiers || days === undefined) {
    return undefined
  }
  return { timezone, tiers, leadDays, days }
}

const historySourceKey = z.string().trim().min(1).max(100)
const historicalBrokerageSteps = z
  .array(
    z.discriminatedUnion("command", [
      z
        .object({
          command: z.literal("recordEligibility"),
          input: brokerageInputs.recordEligibility
            .innerType()
            .omit({ dealId: true, guarantorId: true })
            .extend({
              guarantorIdentity: z.string().trim().min(1).max(200).optional(),
            })
            .refine(
              (step) =>
                (step.target === "GUARANTOR") === !!step.guarantorIdentity
            ),
        })
        .strict(),
      z
        .object({
          command: z.literal("recordInspection"),
          input: brokerageInputs.recordInspection.omit({ dealId: true }),
        })
        .strict(),
      z
        .object({
          command: z.literal("adjustLoan"),
          input: brokerageInputs.adjustLoan.omit({ dealId: true }),
        })
        .strict(),
      z
        .object({
          command: z.literal("setChecklist"),
          input: brokerageInputs.setChecklist.omit({ dealId: true }),
        })
        .strict(),
      z
        .object({
          command: z.literal("verifyDocuments"),
          input: brokerageInputs.verifyDocuments.omit({ dealId: true }),
        })
        .strict(),
      z
        .object({
          command: z.literal("setProcessingFee"),
          input: brokerageInputs.setProcessingFee.omit({ dealId: true }),
        })
        .strict(),
      z
        .object({
          command: z.literal("informCompany"),
          input: brokerageInputs.informCompany.omit({ dealId: true }),
        })
        .strict(),
      z
        .object({
          command: z.literal("referDeal"),
          input: brokerageInputs.referDeal.omit({ dealId: true }),
        })
        .strict(),
      z
        .object({
          command: z.literal("rejectDeal"),
          input: brokerageInputs.rejectDeal.omit({ dealId: true }),
        })
        .strict(),
      z
        .object({
          command: z.literal("completeBrokerage"),
          input: brokerageInputs.completeBrokerage.omit({ dealId: true }),
        })
        .strict(),
      z
        .object({
          command: z.literal("dispatchBatch"),
          input: dispatchInput.omit({ sourceIds: true }),
        })
        .strict(),
      z
        .object({
          command: z.literal("requestFacility"),
          input: brokerageInputs.requestFacility.omit({ dealId: true }),
        })
        .strict(),
      z
        .object({
          command: z.literal("disburseFacility"),
          sourceKey: historySourceKey,
          input: brokerageInputs.disburseFacility.omit({ dealId: true }),
        })
        .strict(),
      z
        .object({
          command: z.literal("recoverFacility"),
          sourceKey: historySourceKey,
          input: brokerageInputs.recoverFacility
            .innerType()
            .omit({ dealId: true })
            .refine(
              (value) => value.principal || value.chargeRecovery || value.fee
            ),
        })
        .strict(),
      z
        .object({
          command: z.literal("recordBrokerageFee"),
          sourceKey: historySourceKey,
          input: brokerageInputs.recordBrokerageFee.omit({ dealId: true }),
        })
        .strict(),
      z
        .object({
          command: z.literal("reversePayment"),
          sourceKey: historySourceKey,
          input: cashInput
            .extend({
              direction: z.enum(["IN", "OUT"]),
              category: z.enum([
                "PROCESSING",
                "ADDITIONAL",
                "PAYOUT",
                "DEDUCTION",
                "PRINCIPAL",
                "CHARGE",
                "FEE",
              ]),
              reversalOfSourceKey: z.string().trim().min(1).max(130),
              ...brokerageReversalInput.pick({
                reason: true,
                replacement: true,
              }).shape,
            })
            .strict(),
        })
        .strict(),
    ])
  )
  .max(20)

function historicalBrokerageCash(
  step: LegacyBrokerageStep,
  cashIn: bigint[],
  cashOut: bigint[]
) {
  const add = (payments: (CashInput | null | undefined)[], total: bigint[]) => {
    for (const payment of payments)
      if (payment) total.push(minor(payment.amount))
  }
  switch (step.command) {
    case "recordBrokerageFee":
      add([step.input.payment], cashIn)
      break
    case "disburseFacility":
      add(
        [
          step.input.payment,
          ...step.input.separatelyPaidDeductions.map((line) => line.payment),
        ],
        cashOut
      )
      break
    case "recoverFacility":
      add(
        [step.input.principal, step.input.chargeRecovery, step.input.fee],
        cashIn
      )
      break
    case "reversePayment":
      add([step.input], step.input.direction === "IN" ? cashIn : cashOut)
      add(
        [step.input.replacement],
        step.input.direction === "IN" ? cashOut : cashIn
      )
      break
  }
}

function parseRemittanceRow(
  r: RowReader,
  namespace: string
): ImportPayloads["REMITTANCES"] | null {
  const company = parseLegacyRefPair(
    r,
    "company",
    "FINANCE_COMPANIES",
    namespace,
    true
  )
  const reference = r.reqString("reference", 200)
  const amount = r.reqMoney("amount", { positive: true })
  const date = r.reqDate("date")
  const asOfDate = r.reqDate("asOfDate")
  const draftId = r.optUuid("draftId")
  const noticeAttachmentId = r.optUuid("noticeAttachmentId")
  const reversalDate = r.optDate("reversalDate")
  const reversalReason = r.optString("reversalReason", 2000)
  const lineSchema = reconciliationInputs.recordRemittance.shape.lines
    .innerType()
    .element.omit({ source: true })
    .extend({ amount: z.string() })
  const lines = z
    .array(lineSchema)
    .max(100)
    .safeParse(r.optJson("noticeLines") ?? [])
  if (!lines.success) {
    addError(
      r.errors,
      r.rowNumber,
      "noticeLines",
      "INVALID_JSON",
      "Expected notice lines with key, description and amount",
      r.sourceKey
    )
    return null
  }
  if (
    !!draftId !== !!noticeAttachmentId ||
    (lines.data.length && !noticeAttachmentId)
  ) {
    addError(
      r.errors,
      r.rowNumber,
      "noticeAttachmentId",
      "INVALID_INPUT",
      "Supply the staged draft and its finalized notice together",
      r.sourceKey
    )
    return null
  }
  const noticeLines = lines.data.flatMap((line, index) => {
    const amount = parseImportMoney(line.amount, { positive: true })
    if (!amount.ok) {
      addError(
        r.errors,
        r.rowNumber,
        `noticeLines[${index}].amount`,
        amount.code,
        amount.message,
        r.sourceKey
      )
      return []
    }
    return [{ ...line, amount: amount.value }]
  })
  const lineKeys = new Set(noticeLines.map((line) => line.key))
  if (lineKeys.size !== noticeLines.length)
    addError(
      r.errors,
      r.rowNumber,
      "noticeLines",
      "DUPLICATE_SOURCE_KEY",
      "Notice line keys must be unique",
      r.sourceKey
    )
  const raw = r.optJson("allocations") ?? []
  const rows = z
    .array(
      z
        .object({
          type: z.enum(["SALES", "BROKERAGE"]),
          sourceKey: z.string().trim().min(1).max(200).optional(),
          existingId: z.string().uuid().optional(),
          amount: z.string(),
          noticeLineKey: z.string().trim().min(1).max(200).optional(),
        })
        .strict()
        .refine((row) => !!row.sourceKey !== !!row.existingId)
    )
    .max(100)
    .safeParse(raw)
  if (!rows.success) {
    addError(
      r.errors,
      r.rowNumber,
      "allocations",
      "INVALID_JSON",
      "Expected allocation type, source key or UUID, and amount",
      r.sourceKey
    )
    return null
  }
  if (!company || !reference || !amount || !date || !asOfDate) return null
  const payment = reconciliationInputs.recordRemittance.shape.payment.safeParse(
    { amount, date, reference, method: "BANK_TRANSFER" }
  )
  if (!payment.success || asOfDate < date) {
    addError(
      r.errors,
      r.rowNumber,
      "asOfDate",
      "INVALID_INPUT",
      "A valid bank payment must precede or match the reconciliation cutoff",
      r.sourceKey
    )
    return null
  }
  if (
    !!reversalDate !== !!reversalReason ||
    (reversalDate && reversalDate < asOfDate)
  ) {
    addError(
      r.errors,
      r.rowNumber,
      "reversalDate",
      "INVALID_INPUT",
      "A reversal needs a reason and must follow or match the receipt and reconciliation cutoff",
      r.sourceKey
    )
    return null
  }
  const allocations = rows.data.flatMap((row, index) => {
    const value = parseImportMoney(row.amount)
    if (!value.ok || value.value === "0") {
      addError(
        r.errors,
        r.rowNumber,
        `allocations[${index}].amount`,
        "INVALID_MONEY",
        "Allocation must be positive money in major units",
        r.sourceKey
      )
      return []
    }
    const source = row.existingId
      ? { existingId: row.existingId.toLowerCase() }
      : { namespace, type: row.type, sourceKey: row.sourceKey! }
    if (row.noticeLineKey && !lineKeys.has(row.noticeLineKey))
      addError(
        r.errors,
        r.rowNumber,
        `allocations[${index}].noticeLineKey`,
        "INVALID_INPUT",
        "Allocation must name a line in noticeLines",
        r.sourceKey
      )
    return [
      {
        source,
        sourceType: row.type,
        amount: value.value,
        ...(row.noticeLineKey ? { noticeLineKey: row.noticeLineKey } : {}),
      },
    ]
  })
  return {
    company,
    payment: payment.data,
    asOfDate,
    allocations,
    ...(reversalDate && reversalReason
      ? { reversal: { date: reversalDate, reason: reversalReason } }
      : {}),
    ...(draftId && noticeAttachmentId
      ? { draftId, noticeAttachmentId, noticeLines }
      : {}),
  }
}

function parseAdvanceRow(
  r: RowReader,
  namespace: string
): ImportPayloads["ADVANCES"] | null {
  const errStart = r.errors.length
  const cycle = parseLegacyRefPair(r, "cycle", "VEHICLES", namespace, true)
  const customer = parseLegacyRefPair(
    r,
    "customer",
    "CUSTOMERS",
    namespace,
    true
  )
  const agreed = r.reqMoney("agreed", { positive: true })
  const amount = r.reqMoney("amount", { positive: true })
  if (
    agreed !== undefined &&
    amount !== undefined &&
    minor(amount) > minor(agreed)
  ) {
    addError(
      r.errors,
      r.rowNumber,
      "amount",
      "BALANCE_MISMATCH",
      "Advance amount cannot exceed agreed price",
      r.sourceKey
    )
  }
  const saleCaseSourceKey = r.reqString("saleCaseSourceKey", 200)
  const placedDate = r.reqDate("placedDate")
  const listedBasis = r.reqMoney("listedBasis", { positive: true })
  const validThrough = r.reqDate("validThrough")
  if (placedDate && validThrough && validThrough < placedDate) {
    addError(
      r.errors,
      r.rowNumber,
      "validThrough",
      "CHRONOLOGY_VIOLATION",
      "validThrough cannot precede placedDate",
      r.sourceKey
    )
  }
  const expiresAt = r.reqInstant("expiresAt")
  const policySnapshot = parsePolicySnapshot(r, amount, listedBasis)
  const state = r.reqEnum("state", ADVANCE_STATES)

  let compSale: LegacyRef | undefined
  let retainedAmount: Money | undefined
  let resolutionDate: DateOnly | undefined
  let resolutionReason: string | undefined
  let disposition: Disposition | undefined

  if (state === "CONVERTED") {
    compSale = parseLegacyRefPair(r, "completedSale", "SALES", namespace, true)
    resolutionDate = r.reqDate("resolutionDate")
    if (
      r.hasAny([
        "retainedAmount",
        "resolutionReason",
        "dispositionKind",
        "dispositionHoldReason",
      ])
    ) {
      addError(
        r.errors,
        r.rowNumber,
        "retainedAmount",
        "INVALID_STATE",
        "CONVERTED advance must not have retainedAmount or cancellation disposition",
        r.sourceKey
      )
    }
  } else if (state === "REFUNDED" || state === "CANCELLED") {
    retainedAmount = r.reqMoney("retainedAmount")
    resolutionDate = r.reqDate("resolutionDate")
    resolutionReason = r.reqString("resolutionReason", 2000)
    const reqDisp = r.reqEnum("dispositionKind", DISPOSITION_KINDS)
    if (
      retainedAmount !== undefined &&
      amount !== undefined &&
      minor(retainedAmount) > minor(amount)
    ) {
      addError(
        r.errors,
        r.rowNumber,
        "retainedAmount",
        "BALANCE_MISMATCH",
        "retainedAmount cannot exceed advance amount",
        r.sourceKey
      )
    }
    if (reqDisp === "HOLD") {
      const holdReason = r.reqString("dispositionHoldReason", 2000)
      if (holdReason) disposition = { kind: "HOLD", reason: holdReason }
    } else if (reqDisp === "RELEASE") {
      if (r.hasAny(["dispositionHoldReason"])) {
        addError(
          r.errors,
          r.rowNumber,
          "dispositionHoldReason",
          "CONFLICTING_COLUMNS",
          "dispositionHoldReason is forbidden when dispositionKind is RELEASE",
          r.sourceKey
        )
      }
      disposition = { kind: "RELEASE" }
    }
    if (r.hasAny(["completedSaleSourceKey", "completedSaleExistingId"])) {
      addError(
        r.errors,
        r.rowNumber,
        "completedSaleSourceKey",
        "INVALID_STATE",
        `completedSale must be absent when state is ${state}`,
        r.sourceKey
      )
    }
  } else if (
    (state === "ACTIVE" || state === "EXPIRED") &&
    r.hasAny([
      "completedSaleSourceKey",
      "completedSaleExistingId",
      "retainedAmount",
      "resolutionDate",
      "resolutionReason",
      "dispositionKind",
      "dispositionHoldReason",
    ])
  ) {
    addError(
      r.errors,
      r.rowNumber,
      "resolutionDate",
      "INVALID_STATE",
      `Resolution fields must be absent when state is ${state}`,
      r.sourceKey
    )
  }

  if (placedDate && resolutionDate && resolutionDate < placedDate) {
    addError(
      r.errors,
      r.rowNumber,
      "resolutionDate",
      "CHRONOLOGY_VIOLATION",
      "resolutionDate cannot precede placedDate",
      r.sourceKey
    )
  }

  const payments = parseLegacyPaymentsArray(
    r.optJson("payments"),
    r.rowNumber,
    "payments",
    r.errors,
    r.sourceKey
  )

  if (
    r.errors.length > errStart ||
    !cycle ||
    !customer ||
    !agreed ||
    !amount ||
    !saleCaseSourceKey ||
    !placedDate ||
    !listedBasis ||
    !validThrough ||
    !expiresAt ||
    !policySnapshot ||
    !state
  ) {
    return null
  }

  return {
    cycle,
    customer,
    agreed,
    amount,
    saleCaseSourceKey,
    placedDate,
    listedBasis,
    validThrough,
    expiresAt,
    policySnapshot,
    state,
    ...(compSale ? { completedSale: compSale } : {}),
    ...(retainedAmount !== undefined ? { retainedAmount } : {}),
    ...(resolutionDate !== undefined ? { resolutionDate } : {}),
    ...(resolutionReason !== undefined ? { resolutionReason } : {}),
    ...(disposition ? { disposition } : {}),
    payments,
  }
}

// ============================================================================
// Control Totals, Distinct Keys & Canonical Digest
// ============================================================================

function collectPaymentTotals(
  payments: readonly LegacyPayment[],
  inAmounts: bigint[],
  outAmounts: bigint[]
): void {
  for (const p of payments) {
    const amt = minor(p.amount)
    if (p.direction === "IN") inAmounts.push(amt)
    else outAmounts.push(amt)
  }
}

/** Compute ControlTotals across valid parsed import rows using bigint arithmetic. */
export function computeControlTotals(
  rows: readonly ImportRowInput[]
): ControlTotals {
  const purchaseAmounts: bigint[] = []
  const costAmounts: bigint[] = []
  const considerationAmounts: bigint[] = []
  const cashInAmounts: bigint[] = []
  const cashOutAmounts: bigint[] = []
  const counts = new Map<ImportType, number>()

  for (const row of rows) {
    counts.set(row.type, (counts.get(row.type) ?? 0) + 1)
    switch (row.type) {
      case "VEHICLES": {
        purchaseAmounts.push(minor(row.payload.purchasePrice))
        collectPaymentTotals(
          row.payload.payments,
          cashInAmounts,
          cashOutAmounts
        )
        for (const cost of row.payload.additionalCosts) {
          costAmounts.push(minor(cost.amount))
          collectPaymentTotals(cost.payments, cashInAmounts, cashOutAmounts)
        }
        if (row.payload.disposal?.receipt) {
          cashInAmounts.push(minor(row.payload.disposal.receipt.amount))
        }
        break
      }
      case "REPAIRS": {
        if (row.payload.invoiceAmount !== undefined) {
          costAmounts.push(minor(row.payload.invoiceAmount))
        }
        collectPaymentTotals(
          row.payload.payments,
          cashInAmounts,
          cashOutAmounts
        )
        break
      }
      case "SALES": {
        if (row.payload.state === "COMPLETED") {
          considerationAmounts.push(minor(row.payload.price))
        }
        collectPaymentTotals(
          row.payload.payments,
          cashInAmounts,
          cashOutAmounts
        )
        break
      }
      case "BROKERAGE":
        for (const step of row.payload.history ?? [])
          historicalBrokerageCash(step, cashInAmounts, cashOutAmounts)
        break
      case "REMITTANCES":
        cashInAmounts.push(minor(row.payload.payment.amount))
        if (row.payload.reversal)
          cashOutAmounts.push(minor(row.payload.payment.amount))
        break
      case "ADVANCES": {
        collectPaymentTotals(
          row.payload.payments,
          cashInAmounts,
          cashOutAmounts
        )
        break
      }
      case "SUPPLIERS":
      case "CUSTOMERS":
      case "REPAIR_VENDORS":
        break
    }
  }

  const byType: { type: ImportType; rows: number }[] = []
  for (const t of importTypes) {
    const count = counts.get(t)
    if (count !== undefined && count > 0) {
      byType.push({ type: t, rows: count })
    }
  }

  return {
    rows: rows.length,
    purchase: sum(purchaseAmounts, B).toString(),
    cost: sum(costAmounts, B).toString(),
    consideration: sum(considerationAmounts, B).toString(),
    cashIn: sum(cashInAmounts, B).toString(),
    cashOut: sum(cashOutAmounts, B).toString(),
    byType,
  }
}

function computeMoneyTotalsByField(
  rows: readonly ImportRowInput[]
): Record<string, Money> {
  const buckets = new Map<string, bigint[]>()
  const push = (field: string, value: Money | undefined) => {
    if (value === undefined) return
    let arr = buckets.get(field)
    if (!arr) {
      arr = []
      buckets.set(field, arr)
    }
    arr.push(minor(value))
  }

  for (const row of rows) {
    switch (row.type) {
      case "VEHICLES": {
        push("purchasePrice", row.payload.purchasePrice)
        push("listedPrice", row.payload.listedPrice)
        push("settlementAmount", row.payload.settlement?.amount)
        push("settlementCashToSeller", row.payload.settlement?.cashToSeller)
        for (const cost of row.payload.additionalCosts) {
          push("additionalCosts", cost.amount)
        }
        push("disposalProceeds", row.payload.disposal?.proceeds)
        break
      }
      case "SALES": {
        push("price", row.payload.price)
        push("completionBasisPurchase", row.payload.completion?.basis.purchase)
        push("downPayment", row.payload.finance?.downPayment)
        push("financeAmount", row.payload.finance?.financeAmount)
        push("tradeInValue", row.payload.tradeIn?.value)
        break
      }
      case "REPAIRS": {
        push("invoiceAmount", row.payload.invoiceAmount)
        break
      }
      case "ADVANCES": {
        push("agreed", row.payload.agreed)
        push("amount", row.payload.amount)
        push("listedBasis", row.payload.listedBasis)
        push("retainedAmount", row.payload.retainedAmount)
        break
      }
      default:
        break
    }
  }

  const out: Record<string, Money> = {}
  for (const key of [...buckets.keys()].sort()) {
    out[key] = sum(buckets.get(key)!, B).toString()
  }
  return out
}

function collectDistinctKeys(
  rows: readonly ImportRowInput[]
): DistinctImportKeys {
  const sourceKeys = new Set<string>()
  const vehicleIdentities = new Set<string>()
  const customerIdentities = new Set<string>()
  const saleCaseSourceKeys = new Set<string>()
  const referencedSourceKeys = new Set<string>()
  const referencedExistingIds = new Set<string>()

  const addRef = (ref?: LegacyRef) => {
    if (!ref) return
    if ("existingId" in ref) referencedExistingIds.add(ref.existingId)
    else referencedSourceKeys.add(`${ref.type}:${ref.sourceKey}`)
  }

  for (const row of rows) {
    sourceKeys.add(row.sourceKey)
    switch (row.type) {
      case "REMITTANCES":
        addRef(row.payload.company)
        for (const allocation of row.payload.allocations)
          addRef(allocation.source)
        break
      case "BROKERAGE":
        addRef(row.payload.customer)
        if (row.payload.quoteId) referencedExistingIds.add(row.payload.quoteId)
        if (row.payload.existingDealId)
          referencedExistingIds.add(row.payload.existingDealId)
        break
      case "CUSTOMERS":
        customerIdentities.add(
          normalizeCustomerIdentity(row.payload.nicOrPassport)
        )
        break
      case "VEHICLES":
        vehicleIdentities.add(
          `${normalizeVehicleIdentity(row.payload.vehicle.engineNumber)}|${normalizeVehicleIdentity(row.payload.vehicle.chassisNumber)}`
        )
        addRef(row.payload.supplier)
        addRef(row.payload.sellerCustomer)
        addRef(row.payload.tradeInSale)
        if (row.payload.settlement?.institutionType === "FINANCE_COMPANY") {
          addRef(row.payload.settlement.company)
        }
        break
      case "SALES":
        saleCaseSourceKeys.add(row.payload.saleCaseSourceKey)
        addRef(row.payload.cycle)
        addRef(row.payload.customer)
        addRef(row.payload.reservation)
        addRef(row.payload.finance?.company)
        addRef(row.payload.tradeIn?.acquiredCycle)
        break
      case "REPAIRS":
        addRef(row.payload.cycle)
        addRef(row.payload.vendor)
        break
      case "ADVANCES":
        saleCaseSourceKeys.add(row.payload.saleCaseSourceKey)
        addRef(row.payload.cycle)
        addRef(row.payload.customer)
        addRef(row.payload.completedSale)
        break
      default:
        break
    }
  }

  return {
    sourceKeys: [...sourceKeys].sort(),
    vehicleIdentities: [...vehicleIdentities].sort(),
    customerIdentities: [...customerIdentities].sort(),
    saleCaseSourceKeys: [...saleCaseSourceKeys].sort(),
    referencedSourceKeys: [...referencedSourceKeys].sort(),
    referencedExistingIds: [...referencedExistingIds].sort(),
  }
}

/** Deterministic SHA-256 canonical digest independent of physical row/column order or file format. */
export function computeImportDigest(rows: readonly ImportRowInput[]): string {
  const sorted = [...rows].sort((a, b) =>
    a.type !== b.type
      ? a.type.localeCompare(b.type)
      : a.sourceKey.localeCompare(b.sourceKey)
  )
  return createHash("sha256")
    .update("import:v1\0")
    .update(canonical(sorted))
    .digest("hex")
}

// Unused type anchor verifying ApprovalProvenance import contract awareness.
type _ApprovalProvenanceCheck = ApprovalProvenance | WriteOff
const _anchor: _ApprovalProvenanceCheck | null = null
void _anchor

// ============================================================================
// Main Unified Parser Entrypoint
// ============================================================================

function buildAliasMap(schema: ImportTemplateSchema): Map<string, string> {
  const map = new Map<string, string>()
  for (const col of schema.columns) {
    map.set(normalizeHeaderKey(col.name), col.name)
    for (const alias of col.aliases ?? []) {
      map.set(normalizeHeaderKey(alias), col.name)
    }
  }
  return map
}

function emptyResult<K extends ImportType>(
  kind: K,
  format: ImportFormat,
  namespace: string,
  errors: ImportParseError[],
  sheetName?: string,
  headers: string[] = []
): ParsedImportResult<K> {
  const sortedErrors = [...errors].sort(compareErrors)
  return {
    valid: false,
    type: kind,
    format,
    namespace,
    ...(sheetName !== undefined ? { sheetName } : {}),
    headers,
    rows: [],
    validRows: [],
    errors: sortedErrors,
    controlTotals: computeControlTotals([]),
    moneyTotalsByField: {},
    distinctKeys: collectDistinctKeys([]),
    digest: computeImportDigest([]),
  }
}

function compareErrors(a: ImportParseError, b: ImportParseError): number {
  return (
    a.rowNumber - b.rowNumber ||
    a.field.localeCompare(b.field) ||
    a.code.localeCompare(b.code)
  )
}

/** Parse and strictly validate a CSV or XLSX import buffer for any of the 7 record types. */
export async function parseImportBuffer<K extends ImportType>(
  kind: K,
  format: ImportFormat,
  bytes: Uint8Array,
  options: ParseImportOptions = {}
): Promise<ParsedImportResult<K>> {
  const namespace = (options.namespace ?? "default").trim() || "default"
  const maxRows = options.maxRows ?? IMPORT_LIMITS.maxRows
  const schema = IMPORT_SCHEMAS[kind]

  const matrix =
    format === "CSV"
      ? parseCsvMatrix(bytes)
      : await parseXlsxMatrix(bytes, kind, options.sheetName)

  if (!matrix.ok) {
    return emptyResult(kind, format, namespace, matrix.errors)
  }

  const headerRow = matrix.rows[0]
  const dataRows = matrix.rows.slice(1)
  const aliasMap = buildAliasMap(schema)
  const fileErrors: ImportParseError[] = []
  const canonicalHeaders: string[] = []
  const seenCanonical = new Set<string>()

  headerRow.cells.forEach((cell, idx) => {
    const coerced = rawCellToText(cell, "string")
    if (!coerced.ok) {
      addError(
        fileErrors,
        1,
        `column_${idx + 1}`,
        coerced.code,
        coerced.message
      )
      canonicalHeaders.push(`__invalid_${idx}`)
      return
    }
    const rawHeader = coerced.text.trim()
    if (!rawHeader) {
      addError(
        fileErrors,
        1,
        `column_${idx + 1}`,
        "INVALID_HEADER",
        `Empty header at column ${idx + 1}`
      )
      canonicalHeaders.push(`__empty_${idx}`)
      return
    }
    const norm = normalizeHeaderKey(rawHeader)
    if (FORBIDDEN_AUTHORITY_HEADERS.has(norm)) {
      addError(
        fileErrors,
        1,
        rawHeader,
        "FORBIDDEN_COLUMN",
        `Forbidden authority column "${rawHeader}" cannot be imported`
      )
      canonicalHeaders.push(`__forbidden_${idx}`)
      return
    }
    const canonicalName = aliasMap.get(norm)
    if (!canonicalName) {
      addError(
        fileErrors,
        1,
        rawHeader,
        "UNKNOWN_COLUMN",
        `Unknown column "${rawHeader}" for import type ${kind}`
      )
      canonicalHeaders.push(`__unknown_${idx}`)
      return
    }
    if (seenCanonical.has(canonicalName)) {
      addError(
        fileErrors,
        1,
        rawHeader,
        "DUPLICATE_COLUMN",
        `Duplicate column mapping to "${canonicalName}"`
      )
      canonicalHeaders.push(`__dup_${idx}`)
      return
    }
    seenCanonical.add(canonicalName)
    canonicalHeaders.push(canonicalName)
  })

  if (canonicalHeaders.length === 0) {
    addError(
      fileErrors,
      1,
      "headers",
      "MISSING_HEADERS",
      "Header row contains no columns"
    )
  }

  for (const col of schema.columns) {
    if (col.required && !seenCanonical.has(col.name)) {
      addError(
        fileErrors,
        1,
        col.name,
        "MISSING_REQUIRED_COLUMN",
        `Missing required column "${col.name}" for ${kind}`
      )
    }
  }

  if (dataRows.length === 0) {
    addError(
      fileErrors,
      0,
      "file",
      "NO_DATA_ROWS",
      "Import file must contain at least one data row"
    )
  }
  if (dataRows.length > maxRows) {
    addError(
      fileErrors,
      maxRows + 2,
      "file",
      "ROW_LIMIT_EXCEEDED",
      `Import exceeds maximum of ${maxRows} data rows`
    )
  }

  if (fileErrors.length > 0) {
    return emptyResult(
      kind,
      format,
      namespace,
      fileErrors,
      matrix.sheetName,
      canonicalHeaders
    )
  }

  const parsedRows: ParsedImportRow<K>[] = []
  const validRows: TypedImportRow<K>[] = []
  const allErrors: ImportParseError[] = []

  // Batch-level uniqueness trackers
  const sourceKeyFirstRow = new Map<string, number>()
  const customerIdFirstRow = new Map<string, number>()
  const vehicleCycleFirstRow = new Map<string, number>()
  const saleCaseFirstRow = new Map<string, number>()

  for (const row of dataRows) {
    const rowErrors: ImportParseError[] = []

    // Check column count parity (XLSX may omit trailing nulls, reject extra populated cells).
    if (format === "CSV" && row.cells.length !== canonicalHeaders.length) {
      addError(
        rowErrors,
        row.rowNumber,
        "row",
        "COLUMN_COUNT_MISMATCH",
        `Expected ${canonicalHeaders.length} columns, got ${row.cells.length}`
      )
    } else if (
      format === "XLSX" &&
      row.cells.length > canonicalHeaders.length
    ) {
      const hasExtraNonEmpty = row.cells
        .slice(canonicalHeaders.length)
        .some((c) => c !== null && !(typeof c === "string" && c === ""))
      if (hasExtraNonEmpty) {
        addError(
          rowErrors,
          row.rowNumber,
          "row",
          "COLUMN_COUNT_MISMATCH",
          `Row has populated cells past the ${canonicalHeaders.length} header columns`
        )
      }
    }

    const rawMap = new Map<string, RawCell>()
    for (let i = 0; i < canonicalHeaders.length; i++) {
      rawMap.set(canonicalHeaders[i], row.cells[i] ?? null)
    }

    const reader = makeRowReader(
      row.rowNumber,
      rawMap,
      seenCanonical,
      rowErrors
    )
    const sourceKey = reader.reqString("sourceKey", 200)
    reader.sourceKey = sourceKey

    // Attach sourceKey to any errors collected before sourceKey was read (none before, but keep consistent).
    if (sourceKey) {
      const prevRow = sourceKeyFirstRow.get(sourceKey)
      if (prevRow !== undefined) {
        addError(
          rowErrors,
          row.rowNumber,
          "sourceKey",
          "DUPLICATE_SOURCE_KEY",
          `Duplicate sourceKey "${sourceKey}" (first seen at row ${prevRow})`,
          sourceKey
        )
      } else {
        sourceKeyFirstRow.set(sourceKey, row.rowNumber)
      }
    }

    let payload: ImportPayloads[K] | null = null
    switch (kind) {
      case "FINANCE_COMPANIES": {
        const company = financeInput.safeParse({
          name: reader.reqString("name", 200),
          policy: reader.optJson("financePolicy"),
          contacts: reader.optJson("financeContacts"),
        })
        if (company.success) payload = company.data as ImportPayloads[K]
        else
          for (const issue of company.error.issues)
            addError(
              rowErrors,
              row.rowNumber,
              issue.path.join("."),
              "INVALID_INPUT",
              issue.message,
              sourceKey
            )
        break
      }
      case "BROKERAGE": {
        const existingDealId = reader.optUuid("existingDealId")
        const history = historicalBrokerageSteps.safeParse(
          reader.optJson("history") ?? []
        )
        if (!history.success) {
          for (const issue of history.error.issues)
            addError(
              rowErrors,
              row.rowNumber,
              ["history", ...issue.path].join("."),
              "INVALID_INPUT",
              issue.message,
              sourceKey
            )
          break
        }
        const progress = history.data.length ? { history: history.data } : {}
        if (existingDealId) {
          if (
            !history.data.length ||
            reader.hasAny([
              "customerSourceKey",
              "customerExistingId",
              "quoteId",
              "guarantors",
            ])
          )
            addError(
              rowErrors,
              row.rowNumber,
              "existingDealId",
              "INVALID_INPUT",
              "Supply historical steps for the existing deal and clear intake columns",
              sourceKey
            )
          else payload = { existingDealId, ...progress } as ImportPayloads[K]
          break
        }
        const customer = parseLegacyRefPair(
          reader,
          "customer",
          "CUSTOMERS",
          namespace,
          true
        )
        const quoteId = reader.optUuid("quoteId")
        const guarantors =
          brokerageInputs.openBrokerage.shape.guarantors.safeParse(
            reader.optJson("guarantors")
          )
        if (!quoteId)
          addError(
            rowErrors,
            row.rowNumber,
            "quoteId",
            "REQUIRED",
            "Quote UUID is required",
            sourceKey
          )
        if (!guarantors.success)
          for (const issue of guarantors.error.issues)
            addError(
              rowErrors,
              row.rowNumber,
              ["guarantors", ...issue.path].join("."),
              "INVALID_INPUT",
              issue.message,
              sourceKey
            )
        if (customer && quoteId && guarantors.success)
          payload = {
            customer,
            quoteId,
            guarantors: guarantors.data,
            ...progress,
          } as ImportPayloads[K]
        break
      }
      case "SUPPLIERS":
      case "REPAIR_VENDORS":
        payload = parseDirectoryRow(kind, reader) as ImportPayloads[K] | null
        break
      case "CUSTOMERS":
        payload = parseCustomerRow(reader) as ImportPayloads[K] | null
        break
      case "VEHICLES":
        payload = parseVehicleRow(reader, namespace) as ImportPayloads[K] | null
        break
      case "SALES":
        payload = parseSaleRow(reader, namespace) as ImportPayloads[K] | null
        break
      case "REPAIRS":
        payload = parseRepairRow(reader, namespace) as ImportPayloads[K] | null
        break
      case "REMITTANCES":
        payload = parseRemittanceRow(reader, namespace) as
          | ImportPayloads[K]
          | null
        break
      case "ADVANCES":
        payload = parseAdvanceRow(reader, namespace) as ImportPayloads[K] | null
        break
    }

    const legacy = parseLegacyMetadata(reader)

    // Intra-batch semantic uniqueness checks (independent of unrelated field errors)
    if (kind === "CUSTOMERS") {
      const nic = reader.getText("nicOrPassport", "string")
      if (nic) {
        const normId = normalizeCustomerIdentity(nic)
        if (normId.length > 0) {
          const prev = customerIdFirstRow.get(normId)
          if (prev !== undefined) {
            addError(
              rowErrors,
              row.rowNumber,
              "nicOrPassport",
              "DUPLICATE_IDENTITY",
              `Duplicate customer identity "${nic}" (first seen at row ${prev})`,
              sourceKey
            )
          } else {
            customerIdFirstRow.set(normId, row.rowNumber)
          }
        }
      }
    } else if (kind === "VEHICLES") {
      const eng = reader.getText("engineNumber", "string")
      const chs = reader.getText("chassisNumber", "string")
      const cyc = reader.getText("cycleNumber", "number")
      if (eng && chs && cyc && /^\d+$/.test(cyc)) {
        const key = `${normalizeVehicleIdentity(eng)}|${normalizeVehicleIdentity(chs)}|${Number(cyc)}`
        const prev = vehicleCycleFirstRow.get(key)
        if (prev !== undefined) {
          addError(
            rowErrors,
            row.rowNumber,
            "cycleNumber",
            "DUPLICATE_CYCLE",
            `Duplicate vehicle cycle (${eng}, ${chs}, cycle ${cyc}; first seen at row ${prev})`,
            sourceKey
          )
        } else {
          vehicleCycleFirstRow.set(key, row.rowNumber)
        }
      }
    } else if (kind === "SALES" || kind === "ADVANCES") {
      const scKey = reader.getText("saleCaseSourceKey", "string")
      if (scKey) {
        const prev = saleCaseFirstRow.get(scKey)
        if (prev !== undefined) {
          addError(
            rowErrors,
            row.rowNumber,
            "saleCaseSourceKey",
            "DUPLICATE_SALE_CASE_KEY",
            `Duplicate saleCaseSourceKey "${scKey}" within ${kind} (first seen at row ${prev})`,
            sourceKey
          )
        } else {
          saleCaseFirstRow.set(scKey, row.rowNumber)
        }
      }
    }

    rowErrors.sort(compareErrors)
    const normalized =
      rowErrors.length === 0 && sourceKey && payload
        ? ({
            type: kind,
            sourceKey,
            payload,
            ...(legacy ? { legacy } : {}),
          } as TypedImportRow<K>)
        : null

    if (normalized) validRows.push(normalized)
    allErrors.push(...rowErrors)
    parsedRows.push({
      rowNumber: row.rowNumber,
      sourceKey: sourceKey ?? "",
      type: kind,
      normalized,
      errors: rowErrors,
    })
  }

  let controlTotals: ControlTotals
  let moneyTotalsByField: Record<string, Money>
  try {
    controlTotals = computeControlTotals(validRows)
    moneyTotalsByField = computeMoneyTotalsByField(validRows)
  } catch (err) {
    const code =
      err instanceof Error && err.message === "MONEY_OVERFLOW"
        ? "MONEY_OVERFLOW"
        : "INVALID_INPUT"
    addError(
      allErrors,
      0,
      "controlTotals",
      code,
      "Aggregate monetary control totals overflow bounds"
    )
    controlTotals = computeControlTotals([])
    moneyTotalsByField = {}
  }

  allErrors.sort(compareErrors)
  return {
    valid: allErrors.length === 0 && validRows.length > 0,
    type: kind,
    format,
    namespace,
    ...(matrix.sheetName !== undefined ? { sheetName: matrix.sheetName } : {}),
    headers: canonicalHeaders,
    rows: parsedRows,
    validRows,
    errors: allErrors,
    controlTotals,
    moneyTotalsByField,
    distinctKeys: collectDistinctKeys(validRows),
    digest: computeImportDigest(validRows),
  }
}
