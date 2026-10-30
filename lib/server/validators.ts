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
export const purchaseInput = z
  .object({
    vehicle: vehicleInput,
    supplierId: id,
    purchaseDate: dateOnly,
    listedPrice: moneyInput.optional(),
    mileage: mileageInput,
    paymentMethod: z.enum(["CASH", "BANK_TRANSFER"]),
    purchaseType: z.enum(["CASH", "BRAND_NEW"]),
    purchasePrice: moneyInput.refine((v) => v !== "0"),
  })
  .strict()
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
