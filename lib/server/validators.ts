import { checklistItemKey } from "../brokerage-checklist"
import { z } from "zod"
import { grantSchema } from "./permissions"
export const id = z.string().uuid()
export const revision = z.number().int().min(1).max(2147483647)
const text = z.string().trim().min(1).max(2000)
const name = text.max(200)
export const customerInput = z
  .object({
    fullName: name,
    callingName: name,
    nicOrPassport: text.max(100),
    address: text,
    phone: z
      .string()
      .trim()
      .min(3)
      .max(30)
      .regex(/^\+?[0-9][0-9 ()-]*[0-9]$/),
    email: z.string().trim().email().max(254).optional(),
    drivingLicence: text.max(100).optional(),
    notes: text.optional(),
  })
  .strict()
export const customerCommands = {
  createCustomer: customerInput,
  updateCustomer: z
    .object({ id, values: customerInput, reason: text.optional() })
    .strict(),
  archiveParty: z
    .object({
      type: z.literal("CUSTOMER"),
      id,
      active: z.boolean(),
      reason: text,
    })
    .strict(),
} as const
export const contactInput = z
  .object({
    name,
    phone: customerInput.shape.phone,
    email: customerInput.shape.email,
    role: name,
    primary: z.boolean(),
  })
  .strict()
export const directoryInput = z
  .object({
    name,
    category: z.enum(["INDIVIDUAL", "COMPANY"]),
    nicOrRegNumber: text.max(100).optional(),
    address: text.optional(),
    phone: customerInput.shape.phone.optional(),
    hotline: customerInput.shape.phone.optional(),
    recurring: z.boolean().optional(),
    specialisation: text.optional(),
    notes: text.optional(),
    contacts: z
      .array(contactInput)
      .max(100)
      .refine(
        (contacts) =>
          contacts.filter((c) => c.primary).length <= 1 &&
          new Set(contacts.map((c) => JSON.stringify(c))).size ===
            contacts.length
      ),
  })
  .strict()
const directoryType = z.enum(["SUPPLIER", "REPAIR_VENDOR"])
export const partySelector = z
  .object({
    type: z.enum(["SUPPLIER", "REPAIR_VENDOR", "FINANCE_COMPANY"]),
    id,
  })
  .strict()
export const moneyInput = z
  .string()
  .max(14)
  .regex(/^(0|[1-9][0-9]*)$/)
export const financePolicy = z
  .object({
    path: z.enum(["APPLICATION", "REFERRAL"]),
    commission: z.discriminatedUnion("basis", [
      z
        .object({
          basis: z.literal("FIXED"),
          fixed: moneyInput,
          rateBps: z.number().int().min(0).max(10000),
        })
        .strict(),
      z
        .object({
          basis: z.literal("FINANCED_PRINCIPAL"),
          rateBps: z.number().int().min(0).max(10000),
        })
        .strict(),
    ]),
    processingFee: moneyInput,
    reconciliationMethod: z.enum(["PERIOD_NOTICE", "PER_DEAL"]),
  })
  .strict()
export const financeInput = z
  .object({
    name,
    contacts: directoryInput.shape.contacts,
    policy: financePolicy,
  })
  .strict()
export const settingsInput = z
  .object({
    company: z
      .object({
        name,
        identity: text.max(100),
        address: text,
        phone: customerInput.shape.phone,
        email: z.string().trim().email().max(254),
      })
      .strict(),
    declarations: z.array(text).max(100),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .refine(
        (value) =>
          Intl.supportedValuesOf("currency").includes(value) &&
          new Intl.NumberFormat("en", {
            style: "currency",
            currency: value,
          }).resolvedOptions().maximumFractionDigits === 2
      ),
    scale: z.literal(2),
    timezone: name.refine((value) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: value })
        return true
      } catch {
        return false
      }
    }),
    tiers: z
      .array(
        z
          .object({
            upperBps: z.number().int().min(0).max(10000).nullable(),
            days: z.number().int().min(1).max(31),
          })
          .strict()
      )
      .min(1)
      .max(100)
      .refine((tiers) =>
        tiers.every((tier, index) =>
          index === tiers.length - 1
            ? tier.upperBps === null
            : tier.upperBps !== null &&
              (index === 0 || tier.upperBps > tiers[index - 1].upperBps!)
        )
      ),
    warningLeadDays: z.number().int().min(0).max(7),
    processingFee: moneyInput,
    dateFormat: z.enum(["YYYY-MM-DD", "DD/MM/YYYY"]),
    itemsPerPage: z.union([
      z.literal(10),
      z.literal(20),
      z.literal(50),
      z.literal(100),
    ]),
    theme: z.enum(["SYSTEM", "LIGHT", "DARK"]),
  })
  .strict()
export const partyCommands = {
  createFinanceCompany: financeInput,
  updateFinanceCompany: financeInput.extend({ id, reason: text }).strict(),
  createDirectoryParty: z
    .object({ type: directoryType, values: directoryInput })
    .strict(),
  updateDirectoryParty: z
    .object({
      type: directoryType,
      id,
      values: directoryInput,
      reason: text.optional(),
    })
    .strict(),
  archiveParty: z
    .object({
      type: partySelector.shape.type,
      id,
      active: z.boolean(),
      reason: text,
    })
    .strict(),
} as const
export type PartyCommandName = keyof typeof partyCommands
export function partyEnvelope(name: PartyCommandName) {
  return customerEnvelope("createCustomer").extend({
    input: partyCommands[name],
  })
}
export type CustomerCommandName = keyof typeof customerCommands
export function customerEnvelope(name: CustomerCommandName) {
  return z
    .object({
      schemaVersion: z.literal(1),
      idempotencyKey: id,
      expected: z
        .array(
          z
            .object({
              type: z.enum([
                "Vehicle",
                "PurchaseRecord",
                "SaleCase",
                "Reservation",
                "BrokerageDeal",
                "FinanceCompany",
                "Settings",
                "Remittance",
                "CommissionEntitlement",
                "RepairRecord",
                "VehicleCost",
                "ApprovalRequest",
                "ImportBatch",
                "Role",
                "User",
                "Customer",
                "Supplier",
                "RepairVendor",
                "CashFacility",
                "UploadIntent",
                "RateSheet",
                "Quote",
                "Notification",
                "InvoiceVersion",
                "ExportJob",
              ]),
              id,
              revision,
            })
            .strict()
        )
        .max(1000)
        .refine(
          (refs) =>
            new Set(refs.map((r) => `${r.type}:${r.id}`)).size === refs.length
        ),
      input: customerCommands[name],
    })
    .strict()
}
export const settingsCommand = settingsInput.extend({ reason: text }).strict()
export const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(`${s}T00:00:00.000Z`)
    return (
      !s.startsWith("0000-") &&
      !Number.isNaN(d.valueOf()) &&
      d.toISOString().slice(0, 10) === s
    )
  })
export const vehicleInput = z
  .object({
    engineNumber: text
      .max(100)
      .refine((v) => v.replace(/[\t\n\r\f\v ]/g, "").length > 0),
    chassisNumber: text
      .max(100)
      .refine((v) => v.replace(/[\t\n\r\f\v ]/g, "").length > 0),
    make: name,
    model: name,
    year: z
      .number()
      .int()
      .min(1886)
      .max(new Date().getUTCFullYear() + 1),
    colour: name,
    vin: text.max(100).optional(),
    crNumber: text.max(100).optional(),
    fuelType: z.enum(["PETROL", "DIESEL", "HYBRID", "ELECTRIC", "OTHER"]),
    transmission: z.enum(["MANUAL", "AUTOMATIC", "CVT", "OTHER"]),
    notes: text.optional(),
  })
  .strict()
export const mileageInput = z
  .object({
    reading: z.number().int().min(0).max(99999999),
    date: dateOnly,
    remark: text.optional(),
    decreaseReason: text.optional(),
  })
  .strict()
export const cycleEditInputs = {
  addMileage: z.object({ cycleId: id, mileage: mileageInput }).strict(),
  setListedPrice: z
    .object({ cycleId: id, amount: moneyInput, reason: text.optional() })
    .strict(),
  editVehicle: z
    .object({ vehicleId: id, values: vehicleInput, reason: text })
    .strict(),
} as const
export type CycleEditCommand = keyof typeof cycleEditInputs
export function cycleEditEnvelope(name: CycleEditCommand) {
  return customerEnvelope("createCustomer").extend({
    input: cycleEditInputs[name],
  })
}
const settlementTerms = {
  reference: text.max(200),
  amount: moneyInput,
  cashToSeller: moneyInput,
}
export const settlementInput = z
  .discriminatedUnion("institutionType", [
    z
      .object({
        ...settlementTerms,
        institutionType: z.literal("FINANCE_COMPANY"),
        companyId: id,
      })
      .strict(),
    z
      .object({
        ...settlementTerms,
        institutionType: z.enum(["BANK", "PRIVATE_PARTY"]),
        institutionName: name,
      })
      .strict(),
  ])
  .refine((value) => value.amount !== "0" || value.cashToSeller !== "0", {
    message: "At least one settlement component must be positive",
  })
const purchaseCommon = {
  vehicle: vehicleInput,
  supplierId: id,
  purchaseDate: dateOnly,
  listedPrice: moneyInput.optional(),
  mileage: mileageInput,
  paymentMethod: z.enum(["CASH", "BANK_TRANSFER"]),
}
export const purchaseInput = z.discriminatedUnion("purchaseType", [
  z
    .object({
      ...purchaseCommon,
      purchaseType: z.enum(["CASH", "BRAND_NEW"]),
      purchasePrice: moneyInput.refine((v) => v !== "0"),
    })
    .strict(),
  z
    .object({
      ...purchaseCommon,
      purchaseType: z.literal("LEASE_SETTLEMENT"),
      settlement: settlementInput,
    })
    .strict(),
])
export const purchaseEnvelope = customerEnvelope("createCustomer").extend({
  input: purchaseInput,
})
export const stockInputs = {
  receiveStock: z
    .object({
      cycleId: id,
      date: dateOnly,
      disposition: z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("RELEASE") }).strict(),
        z.object({ kind: z.literal("HOLD"), reason: text }).strict(),
      ]),
    })
    .strict(),
  holdStock: z.object({ cycleId: id, reason: text }).strict(),
  releaseStock: z.object({ cycleId: id }).strict(),
} as const
export type StockCommand = keyof typeof stockInputs
export function stockEnvelope(name: StockCommand) {
  return customerEnvelope("createCustomer").extend({ input: stockInputs[name] })
}
export const cashInput = z
  .object({
    amount: moneyInput.refine((v) => v !== "0"),
    date: dateOnly,
    method: z.enum(["CASH", "BANK_TRANSFER"]),
    reference: text.max(200).optional(),
  })
  .strict()
export const repairInputs = {
  sendRepair: z
    .object({ cycleId: id, vendorId: id, request: text, sentDate: dateOnly })
    .strict(),
  returnRepair: z
    .object({
      repairId: id,
      invoiceAmount: moneyInput,
      invoiceDate: dateOnly,
      returnedDate: dateOnly,
      summary: text,
      payment: cashInput.optional(),
    })
    .strict(),
  payRepair: z.object({ repairId: id, payment: cashInput }).strict(),
} as const
export type RepairCommand = keyof typeof repairInputs
export function repairEnvelope(name: RepairCommand) {
  return customerEnvelope("createCustomer").extend({
    input: repairInputs[name],
  })
}
// The REPAIR branch is routed to the exact child owner, not the cycle-money owner.
export const repairReversalInput = z
  .object({
    sourceType: z.literal("REPAIR"),
    sourceId: id,
    paymentId: id,
    replacement: cashInput.optional(),
    reason: text,
  })
  .strict()
// A source explicitly typed as another owner is malformed, not a missing repair.
// UUIDs may coincide across tables; a matching repair ref resolves that ambiguity.
export const repairReversalEnvelope = customerEnvelope("createCustomer")
  .extend({ input: repairReversalInput })
  .refine(
    ({ input, expected }) =>
      !expected.some(
        (ref) => ref.id === input.sourceId && ref.type !== "RepairRecord"
      ) ||
      expected.some(
        (ref) => ref.id === input.sourceId && ref.type === "RepairRecord"
      )
  )
export const writeOffInput = z
  .object({
    cycleId: id,
    date: dateOnly,
    reason: text,
    method: z.enum(["SCRAPPED", "AUCTIONED", "DONATED", "OTHER"]),
    proceeds: moneyInput,
    receipt: cashInput.optional(),
  })
  .strict()
export const approvalInputs = {
  requestApproval: z
    .object({
      proposal: z
        .object({ kind: z.literal("WRITE_OFF"), input: writeOffInput })
        .strict(),
      reason: text,
    })
    .strict(),
  reviewApproval: z
    .object({
      approvalId: id,
      decision: z.enum(["APPROVE", "REJECT"]),
      note: text.optional(),
    })
    .strict()
    .refine((v) => v.decision !== "REJECT" || !!v.note),
} as const
export type ApprovalCommand = keyof typeof approvalInputs
export const approvalEnvelope = <N extends ApprovalCommand>(name: N) =>
  customerEnvelope("createCustomer").extend({ input: approvalInputs[name] })
export const notificationInputs = {
  markNotificationRead: z.object({ notificationId: id }).strict(),
  markAllNotificationsRead: z
    .object({ through: z.string().datetime({ precision: 3, offset: false }) })
    .strict(),
} as const
export type NotificationCommand = keyof typeof notificationInputs
export const notificationEnvelope = <N extends NotificationCommand>(name: N) =>
  customerEnvelope("createCustomer").extend({ input: notificationInputs[name] })
const costTerms = {
  category: text,
  description: text,
  amount: moneyInput,
  incurredDate: dateOnly,
}
const cashCorrection = z
  .object({ paymentId: id, replacement: cashInput.optional(), reason: text })
  .strict()
export const cycleMoneyInputs = {
  addCost: z
    .object({ cycleId: id, ...costTerms, payment: cashInput.optional() })
    .strict(),
  editCost: z.object({ costId: id, ...costTerms, reason: text }).strict(),
  payCost: z.object({ costId: id, payment: cashInput }).strict(),
  payPurchase: z
    .object({
      cycleId: id,
      recipient: z.enum(["SELLER", "SETTLEMENT"]),
      payment: cashInput,
    })
    .strict(),
  editPurchase: z
    .object({
      cycleId: id,
      reason: text,
      patch: z
        .object({
          purchaseDate: dateOnly.optional(),
          purchasePrice: moneyInput.refine((v) => v !== "0").optional(),
          purchaseType: z
            .enum(["CASH", "BRAND_NEW", "LEASE_SETTLEMENT"])
            .optional(),
          seller: z
            .object({ type: z.enum(["SUPPLIER", "CUSTOMER"]), id })
            .strict()
            .optional(),
          settlement: settlementInput.nullable().optional(),
          notes: text.nullable().optional(),
        })
        .strict(),
      cashCorrections: z
        .array(cashCorrection)
        .max(100)
        .refine(
          (rows) => new Set(rows.map((r) => r.paymentId)).size === rows.length
        ),
    })
    .strict()
    .refine(
      (v) => Object.keys(v.patch).length > 0 || v.cashCorrections.length > 0
    ),
  reversePayment: z
    .object({
      sourceType: z.enum(["COST", "PURCHASE"]),
      sourceId: id,
      paymentId: id,
      replacement: cashInput.optional(),
      reason: text,
    })
    .strict(),
} as const
export type CycleMoneyCommand = keyof typeof cycleMoneyInputs
export function cycleMoneyEnvelope(name: CycleMoneyCommand) {
  return customerEnvelope("createCustomer").extend({
    input: cycleMoneyInputs[name],
  })
}
export const settingsEnvelope = customerEnvelope("createCustomer").extend({
  input: settingsCommand,
})
const roleIds = z
  .array(id)
  .min(1)
  .max(100)
  .refine((ids) => new Set(ids).size === ids.length)
export const commandInputs = {
  createUser: z
    .object({
      name,
      email: z.string().trim().toLowerCase().email().max(254),
      password: z.string().min(12).max(128),
      roleIds,
    })
    .strict(),
  updateUser: z
    .object({ id, name, active: z.boolean(), roleIds, reason: text })
    .strict(),
  saveRole: z
    .object({
      id: id.optional(),
      name,
      grants: z.array(grantSchema).max(100),
      reason: text,
    })
    .strict(),
  archiveRole: z.object({ id, reason: text }).strict(),
} as const
export type CommandName = keyof typeof commandInputs
export function envelopeSchema<N extends CommandName>(command: N) {
  return z
    .object({
      schemaVersion: z.literal(1),
      idempotencyKey: id,
      expected: z
        .array(
          z.object({ type: z.enum(["User", "Role"]), id, revision }).strict()
        )
        .max(1000)
        .refine(
          (refs) =>
            new Set(refs.map((r) => `${r.type}:${r.id}`)).size === refs.length
        ),
      input: commandInputs[command],
    })
    .strict()
}
export const listParams = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    pageSize: z.coerce
      .number()
      .refine((v) => [10, 20, 50, 100].includes(v))
      .default(20),
  })
  .strict()

export const externalVehicle = vehicleInput
  .pick({ make: true, model: true, year: true })
  .extend({
    description: text,
    engineNumber: text.max(100).optional(),
    chassisNumber: text.max(100).optional(),
  })
  .strict()
export const rateVehicle = externalVehicle.pick({
  make: true,
  model: true,
  year: true,
})
const positiveMoney = moneyInput.refine((v) => v !== "0")
export const rateCommands = {
  publishRates: z
    .object({
      companyId: id,
      ...rateVehicle.shape,
      validFrom: dateOnly,
      validThrough: dateOnly,
      maximum: positiveMoney,
      cards: z
        .array(
          z
            .object({
              principal: positiveMoney,
              months: z.number().int().min(1).max(120),
              installment: positiveMoney,
            })
            .strict()
        )
        .min(1)
        .max(100),
    })
    .strict()
    .superRefine((v, ctx) => {
      if (
        v.validFrom > v.validThrough ||
        (moneyInput.safeParse(v.maximum).success &&
          v.cards.some(
            (c) =>
              moneyInput.safeParse(c.principal).success &&
              BigInt(c.principal) > BigInt(v.maximum)
          )) ||
        new Set(v.cards.map((c) => `${c.principal}:${c.months}`)).size !==
          v.cards.length
      )
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Invalid validity, bounds or duplicate card",
        })
    }),
  selectQuote: z
    .object({
      sheetId: id,
      cardId: id,
      vehicle: externalVehicle,
      charges: z
        .array(z.object({ category: name, amount: moneyInput }).strict())
        .max(100),
    })
    .strict(),
} as const
export type RateCommandName = keyof typeof rateCommands
export const rateEnvelope = (name: RateCommandName) =>
  customerEnvelope("createCustomer").extend({ input: rateCommands[name] })
export const maximaInput = z
  .object({ vehicle: rateVehicle, asOf: dateOnly })
  .strict()
export const compareInput = z
  .object({
    vehicle: externalVehicle,
    asOf: dateOnly,
    principal: positiveMoney,
    months: z.number().int().min(1).max(120).optional(),
    installment: positiveMoney.optional(),
  })
  .strict()
  .refine((v) => (v.months === undefined) !== (v.installment === undefined))

export const importTypes = [
  "SUPPLIERS",
  "CUSTOMERS",
  "REPAIR_VENDORS",
  "VEHICLES",
  "SALES",
  "REPAIRS",
  "ADVANCES",
] as const
const attachmentId = id.transform((value) => value.toLowerCase())
export const photoCategory = z.enum([
  "FRONT",
  "BACK",
  "LEFT",
  "RIGHT",
  "CHASSIS",
  "ENGINE",
  "METER",
  "DEALER_WITH_VEHICLE",
  "CUSTOMER_WITH_VEHICLE",
])
export const checklistKind = z.enum([
  "CUSTOMER_ID",
  "GUARANTOR_ID",
  "PASSPORT_PHOTOS",
  "BANK_PASSBOOK",
  "ADDRESS_PROOF",
  "RELATIONSHIP_PROOF",
  "AFFIDAVIT",
  "REGISTRATION_BOOK",
  "DELETION_LETTER",
  "REVENUE_LICENSE",
  "EXTRA_KEY",
  "TRANSFER_PAPER",
  "PREVIOUS_OWNER_ID",
  "PROCESSING_DOCUMENT",
])
export const documentContentTypes = z.enum([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
])
const importContentTypes = z.enum([
  "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
])
export const attachmentCommands = {
  stageImport: z
    .object({
      types: z
        .array(z.enum(importTypes))
        .min(1)
        .max(7)
        .refine((v) => new Set(v).size === v.length),
      namespace: name,
    })
    .strict(),
  initUpload: z
    .object({
      target: z.discriminatedUnion("type", [
        z.object({ type: z.literal("IMPORT_BATCH"), id: attachmentId }).strict(),
        z
          .object({ type: z.literal("BROKERAGE_DEAL"), id: attachmentId })
          .strict(),
      ]),
      purpose: z.enum([
        "IMPORT_SOURCE",
        "INSPECTION",
        "PARTICIPANT_DOCUMENT",
        "VEHICLE_DOCUMENT",
        "PROCESSING_DOCUMENT",
      ]),
      filename: z.string().min(1).max(200),
      contentType: z.union([importContentTypes, documentContentTypes]),
      size: z
        .number()
        .int()
        .min(1)
        .max(5 * 1024 * 1024),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      category: photoCategory.optional(),
    })
    .strict()
    .superRefine((value, ctx) => {
      const image = ["image/jpeg", "image/png", "image/webp"].includes(
        value.contentType
      )
      const isImport = value.target.type === "IMPORT_BATCH"
      if (
        (isImport &&
          (value.purpose !== "IMPORT_SOURCE" ||
            ![
              "text/csv",
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            ].includes(value.contentType) ||
            value.category !== undefined)) ||
        (!isImport &&
          (value.purpose === "IMPORT_SOURCE" ||
            (value.purpose === "INSPECTION" &&
              (!image || value.category === undefined)) ||
            (value.purpose !== "INSPECTION" &&
              (value.category !== undefined ||
                (!image && value.contentType !== "application/pdf"))))) ||
        (image && value.size > 2 * 1024 * 1024)
      )
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Invalid upload target/purpose/category/size",
        })
    }),
  completeUpload: z.object({ uploadId: attachmentId }).strict(),
} as const
export type AttachmentCommand = keyof typeof attachmentCommands
export const attachmentEnvelope = (name: AttachmentCommand) =>
  customerEnvelope("createCustomer").extend({
    idempotencyKey: attachmentId,
    expected: customerEnvelope("createCustomer")
      .shape.expected.transform((refs) =>
        refs.map((ref) => ({ ...ref, id: ref.id.toLowerCase() }))
      )
      .refine(
        (refs) =>
          new Set(refs.map((ref) => `${ref.type}:${ref.id}`)).size ===
          refs.length
      ),
    input: attachmentCommands[name],
  })

// ── T11b/T12 brokerage ───────────────────────────────────────────────────────
export const instant = z.string().datetime({ precision: 3 })
const positiveOrZeroMoney = moneyInput
export const guarantorInput = z
  .object({
    name,
    identity: text.max(100),
    address: text,
    phone: customerInput.shape.phone,
  })
  .strict()
export const facilityDeduction = z
  .object({
    label: name,
    amount: positiveOrZeroMoney,
    recipient: name,
    handling: z.enum(["WITHHELD", "PAID_BY_DEALERSHIP"]),
  })
  .strict()
export const facilityTerms = z
  .object({
    gross: positiveMoney,
    deductions: z.array(facilityDeduction).max(50),
    fee: positiveOrZeroMoney,
    feeMode: z.enum(["WITHHELD", "SEPARATE"]),
    separatelyRecoverableCharges: positiveOrZeroMoney,
  })
  .strict()
  .refine(
    (v) =>
      BigInt(v.separatelyRecoverableCharges) <=
      v.deductions
        .filter((d) => d.handling === "PAID_BY_DEALERSHIP")
        .reduce((n, d) => n + BigInt(d.amount), 0n)
  )
const eligibilityTarget = z.enum(["CUSTOMER", "GUARANTOR", "VEHICLE"])
export const brokerageInputs = {
  openBrokerage: z
    .object({
      customerId: id,
      guarantors: z.array(guarantorInput).min(1).max(20),
      quoteId: id,
      facility: facilityTerms.optional(),
    })
    .strict(),
  recordEligibility: z
    .object({
      dealId: id,
      target: eligibilityTarget,
      guarantorId: id.optional(),
      outcome: z.enum(["CONFIRMED", "REJECTED"]),
      contactId: id,
      checkedAt: instant,
      feedback: text,
    })
    .strict()
    .refine((v) => (v.target === "GUARANTOR") === (v.guarantorId !== undefined)),
  recordInspection: z
    .object({
      dealId: id,
      photos: z
        .array(
          z.object({ category: photoCategory, attachmentId: id }).strict()
        )
        .min(1)
        .max(9)
        .refine(
          (rows) =>
            new Set(rows.map((r) => r.category)).size === rows.length
        ),
    })
    .strict(),
  adjustLoan: z
    .object({
      dealId: id,
      amount: positiveMoney,
      contactId: id,
      feedback: text,
      confirmedAt: instant,
    })
    .strict(),
  replaceDealQuote: z
    .object({
      dealId: id,
      quoteId: id,
      reason: text,
      contactId: id,
      confirmedAt: instant,
    })
    .strict(),
  setChecklist: z
    .object({
      dealId: id,
      items: z
        .array(
          z
            .object({
              kind: checklistKind,
              label: name.optional(),
              participantId: id.optional(),
              applicability: z.enum(["REQUIRED", "NOT_REQUIRED", "OPTIONAL"]),
              reason: text.optional(),
              collected: z.boolean(),
              quantity: z.number().int().min(0).max(1000000),
              attachmentIds: z
                .array(id)
                .max(20)
                .refine((v) => new Set(v).size === v.length),
            })
            .strict()
        )
        .max(100)
        .refine(
          (rows) =>
            new Set(
              rows.map(checklistItemKey)
            ).size === rows.length
        ),
    })
    .strict(),
  verifyDocuments: z
    .object({
      dealId: id,
      checklistHash: z.string().regex(/^[a-f0-9]{64}$/),
      outcome: z.enum(["CLEAN", "ISSUES", "RESOLVED"]),
      issues: z
        .array(
          z
            .object({
              itemKey: name,
              description: text,
              resolved: z.boolean(),
            })
            .strict()
        )
        .max(100)
        .refine(
          (rows) => new Set(rows.map((r) => r.itemKey)).size === rows.length
        ),
      contactId: id,
      confirmedAt: instant,
      feedback: text,
    })
    .strict(),
  setProcessingFee: z
    .object({ dealId: id, amount: positiveOrZeroMoney, reason: text })
    .strict(),
  informCompany: z
    .object({
      dealId: id,
      contactId: id,
      informedAt: instant,
      fileReference: text.max(200),
      feedback: text,
    })
    .strict(),
  referDeal: z
    .object({
      dealId: id,
      contactId: id,
      referredAt: instant,
      sentContact: z
        .object({ name, phone: customerInput.shape.phone })
        .strict(),
      feedback: text,
    })
    .strict(),
  rejectDeal: z
    .object({ dealId: id, contactId: id, at: instant, reason: text })
    .strict(),
  completeBrokerage: z
    .object({ dealId: id, contactId: id, at: instant, feedback: text })
    .strict(),
  openIssue: z
    .object({
      dealId: id,
      kind: z.enum(["BLOCKER", "DELAY_INQUIRY", "NON_REMITTANCE"]),
      text,
      at: instant,
      blocksStep: z.enum(["DISPATCH", "COMPLETE"]).optional(),
      contactId: id.optional(),
      feedback: text.optional(),
    })
    .strict()
    .refine(
      (v) =>
        (v.kind === "BLOCKER") === (v.blocksStep !== undefined) &&
        (v.contactId === undefined) === (v.feedback === undefined)
    ),
  recordIssueFeedback: z
    .object({
      issueId: id,
      contactId: id,
      at: instant,
      feedback: text,
      resolve: z.boolean(),
    })
    .strict(),
  requestFacility: z
    .object({ dealId: id, terms: facilityTerms, reason: text })
    .strict(),
  disburseFacility: z
    .object({
      dealId: id,
      payment: cashInput.nullable(),
      separatelyPaidDeductions: z
        .array(
          z
            .object({
              index: z.number().int().min(0).max(49),
              payment: cashInput,
            })
            .strict()
        )
        .max(50)
        .refine(
          (rows) => new Set(rows.map((r) => r.index)).size === rows.length
        ),
    })
    .strict(),
  recoverFacility: z
    .object({
      dealId: id,
      principal: cashInput.nullable(),
      chargeRecovery: cashInput.nullable(),
      fee: cashInput.nullable(),
    })
    .strict()
    .refine((v) => v.principal || v.chargeRecovery || v.fee),
  recordBrokerageFee: z
    .object({
      dealId: id,
      category: z.enum(["PROCESSING", "ADDITIONAL"]),
      payment: cashInput,
    })
    .strict(),
} as const
export type BrokerageCommandName = keyof typeof brokerageInputs
export function brokerageEnvelope(name: BrokerageCommandName) {
  return customerEnvelope("createCustomer").extend({
    input: brokerageInputs[name],
  })
}
export const brokerageReversalInput = z
  .object({
    sourceType: z.enum(["FACILITY", "BROKERAGE_FEE"]),
    sourceId: id,
    paymentId: id,
    replacement: cashInput.optional(),
    reason: text,
  })
  .strict()
export const brokerageReversalEnvelope = customerEnvelope("createCustomer")
  .extend({ input: brokerageReversalInput })
export const dispatchInput = z
  .object({
    sourceIds: z
      .array(
        z
          .object({
            type: z.enum(["BROKERAGE", "VEHICLE_SALE"]),
            id,
            revision,
            checklistHash: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict()
      )
      .min(1)
      .max(50)
      .refine((rows) => new Set(rows.map((r) => r.id)).size === rows.length),
    handedOverAt: instant,
    courier: text.max(200),
    tracking: text.max(200).optional(),
  })
  .strict()
export const dispatchEnvelope = customerEnvelope("createCustomer").extend({
  input: dispatchInput,
})
export const brokerageQueryParams = listParams.extend({
  companyId: id.optional(),
  status: z.string().max(40).optional(),
  includeRejected: z
    .union([z.literal("true"), z.literal("false"), z.boolean()])
    .optional(),
})
export const dispatchPreviewInput = z
  .object({
    sourceIds: z
      .array(z.object({ type: z.enum(["VEHICLE_SALE", "BROKERAGE"]), id }).strict())
      .min(1)
      .max(50)
      .refine((rows) => new Set(rows.map((r) => r.id)).size === rows.length),
  })
  .strict()
