import { z } from "zod"

// ─── Vehicle ─────────────────────────────────────────────────────────────────

export const VehicleStatusSchema = z.enum([
  "Purchased",
  "InStock",
  "InRepair",
  "AdvancePlaced",
  "AdvanceExpired",
  "FinancePending",
  "DOReceived",
  "Delivered",
  "Sold",
  "WrittenOff",
])

export const VehicleSchema = z.object({
  id: z.string(),
  make: z.string(),
  model: z.string(),
  year: z.number().int(),
  colour: z.string(),
  engineNumber: z.string(),
  chassisNumber: z.string(),
  vin: z.string().optional(),
  crNumber: z.string().optional(),
  fuelType: z.enum(["Petrol", "Diesel", "Hybrid", "Electric"]),
  transmission: z.enum(["Manual", "Automatic"]),
  status: VehicleStatusSchema,
  isAvailableForSale: z.boolean(),
  unavailabilityReason: z.string().optional(),
  purchasePrice: z.number().int(),
  listedPrice: z.number().int(),
  costBasis: z.number().int(),
  purchaseDate: z.string(),
  purchaseType: z.enum(["Cash", "LeaseSettlement", "BrandNew"]),
  supplierId: z.string(),
  mileageHistory: z.array(
    z.object({ date: z.string(), reading: z.number().int(), remark: z.string().optional() })
  ),
  additionalCosts: z.array(
    z.object({ id: z.string(), description: z.string(), amount: z.number().int(), date: z.string() })
  ),
  photos: z.array(
    z.object({ id: z.string(), filename: z.string(), size: z.number().int(), url: z.string() })
  ),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type Vehicle = z.infer<typeof VehicleSchema>

// ─── Customer ─────────────────────────────────────────────────────────────────

export const CustomerSchema = z.object({
  id: z.string(),
  fullName: z.string(),
  callingName: z.string(),
  nicPassport: z.string(),
  address: z.string(),
  phone: z.string(),
  email: z.string().optional(),
  drivingLicence: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type Customer = z.infer<typeof CustomerSchema>

// ─── Sale ─────────────────────────────────────────────────────────────────────

export const SaleSchema = z.object({
  id: z.string(),
  vehicleId: z.string(),
  customerId: z.string(),
  saleType: z.enum(["Cash", "Advance", "LeaseFinance", "TradeIn"]),
  salePrice: z.number().int(),
  status: z.enum(["Completed", "AdvancePlaced", "AdvanceExpired", "FinancePending", "DOReceived", "Cancelled"]),
  paymentMethod: z.enum(["Cash", "BankTransfer"]),
  date: z.string(),
  mileageAtSale: z.number(),
  thirdPartyRefNumber: z.string().optional(),
  advanceAmount: z.number().int().optional(),
  advancePercentage: z.number().optional(),
  advanceExpiryDate: z.string().optional(),
  downPayment: z.number().int().optional(),
  financeCompanyId: z.string().optional(),
  financeAmount: z.number().int().optional(),
  tradeInVehicleId: z.string().optional(),
  tradeInValue: z.number().int().optional(),
  doDocumentUrl: z.string().optional(),
  doIssueDate: z.string().optional(),
  profitLoss: z.number().int().optional(),
  timeline: z.array(
    z.object({ date: z.string(), event: z.string(), detail: z.string() })
  ),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type Sale = z.infer<typeof SaleSchema>

// ─── Repair ───────────────────────────────────────────────────────────────────

export const RepairSchema = z.object({
  id: z.string(),
  vehicleId: z.string(),
  vendorId: z.string(),
  repairRequest: z.string(),
  dateSent: z.string(),
  dateReturned: z.string().optional(),
  invoiceAmount: z.number().int().optional(),
  invoiceDate: z.string().optional(),
  repairSummary: z.string().optional(),
  status: z.enum(["InProgress", "Completed", "Cancelled"]),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type Repair = z.infer<typeof RepairSchema>

// ─── Approval ─────────────────────────────────────────────────────────────────

export const ApprovalSchema = z.object({
  id: z.string(),
  requestedBy: z.string(),
  requestDate: z.string(),
  category: z.enum(["Discount", "WriteOff", "Refund", "SaleEdit"]),
  entityType: z.string(),
  entityId: z.string(),
  valueChange: z.string(),
  reason: z.string(),
  status: z.enum(["Pending", "Approved", "Rejected"]),
  approvedBy: z.string().optional(),
  approvedDate: z.string().optional(),
  createdAt: z.string(),
})

export type Approval = z.infer<typeof ApprovalSchema>

// ─── ThirdParty ───────────────────────────────────────────────────────────────

export const ThirdPartySchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(["Supplier", "RepairVendor", "FinanceCompany"]),
  category: z.string().optional(),
  isActive: z.boolean(),
  contactPersons: z.array(
    z.object({ name: z.string(), phone: z.string(), email: z.string().optional(), role: z.string() })
  ),
  commissionRate: z.number().optional(),
  processingPathType: z.enum(["Application", "Referral"]).optional(),
  totalVolume: z.number().int().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type ThirdParty = z.infer<typeof ThirdPartySchema>

// ─── LeaseDeal ────────────────────────────────────────────────────────────────

export const LeaseDealSchema = z.object({
  id: z.string(),
  customerId: z.string(),
  vehicleDescription: z.string(),
  financeCompanyId: z.string(),
  dealType: z.enum(["ApplicationProcessing", "Referral"]),
  loanAmount: z.number().int(),
  status: z.enum([
    "Initiated",
    "EligibilityPending",
    "Eligible",
    "Processing",
    "DocumentsCollected",
    "Dispatched",
    "Completed",
    "Rejected",
  ]),
  customerEligibility: z.enum(["Confirmed", "Rejected"]).optional(),
  guarantors: z.array(
    z.object({
      name: z.string(),
      nic: z.string(),
      phone: z.string(),
      eligibility: z.string().optional(),
    })
  ),
  cashAdvanceFacility: z.boolean(),
  cashAdvanceAmount: z.number().int().optional(),
  inspectionPhotos: z.array(
    z.object({ type: z.string(), filename: z.string(), url: z.string() })
  ),
  customerDocChecklist: z.record(z.boolean()),
  vehicleDocChecklist: z.record(z.boolean()),
  processingFee: z.number().int().optional(),
  fileNumber: z.string().optional(),
  dispatchedAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type LeaseDeal = z.infer<typeof LeaseDealSchema>

// ─── Notification ─────────────────────────────────────────────────────────────

export const NotificationSchema = z.object({
  id: z.string(),
  title: z.string(),
  message: z.string(),
  type: z.enum(["AdvanceExpiring", "AdvanceExpired", "RepairReturned", "ApprovalRequired", "ApprovalOutcome"]),
  entityType: z.string(),
  entityId: z.string(),
  isRead: z.boolean(),
  createdAt: z.string(),
})

export type Notification = z.infer<typeof NotificationSchema>

// ─── User ─────────────────────────────────────────────────────────────────────

export const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.enum(["Administrator", "Manager", "SalesExecutive", "FinanceOfficer"]),
  status: z.enum(["Active", "Inactive"]),
  lastLogin: z.string().optional(),
  avatar: z.string().optional(),
  createdAt: z.string(),
})

export type User = z.infer<typeof UserSchema>

// ─── Settings ─────────────────────────────────────────────────────────────────

export const SettingsSchema = z.object({
  companyName: z.string(),
  companyPhone: z.string(),
  companyAddress: z.string(),
  companyEmail: z.string(),
  companyLogo: z.string().optional(),
  currencyCode: z.string(),
  currencySymbol: z.string(),
  currencyDecimalPlaces: z.number().int(),
  currencyFormat: z.enum(["symbol-space-amount", "symbol-amount", "amount-space-symbol", "amount-symbol"]),
  advancePaymentTiers: z.array(
    z.object({
      minPercent: z.number(),
      maxPercent: z.number(),
      validityDays: z.number().int(),
      validityLabel: z.string(),
    })
  ),
  defaultTheme: z.enum(["System", "Light", "Dark"]),
  itemsPerPage: z.number().int(),
  dateFormat: z.string(),
})

export type Settings = z.infer<typeof SettingsSchema>

// ─── CashFlowEntry ────────────────────────────────────────────────────────────

export const CashFlowEntrySchema = z.object({
  id: z.string(),
  date: z.string(),
  type: z.enum(["Purchase", "Sale", "Repair", "AdditionalCost", "Refund", "Advance"]),
  description: z.string(),
  reference: z.string(),
  amount: z.number().int(),
  runningBalance: z.number().int(),
})

export type CashFlowEntry = z.infer<typeof CashFlowEntrySchema>

// ─── LeaseRateSheet ───────────────────────────────────────────────────────────

export const LeaseRateSheetSchema = z.object({
  id: z.string(),
  financeCompanyId: z.string(),
  financeCompanyName: z.string(),
  vehicleModel: z.string(),
  manufactureYear: z.number().int(),
  maxLoanAmount: z.number().int(),
  rateCards: z.array(
    z.object({
      loanAmount: z.number().int(),
      periods: z.array(z.object({ months: z.number().int(), installment: z.number().int() })),
    })
  ),
})

export type LeaseRateSheet = z.infer<typeof LeaseRateSheetSchema>

// ─── LeaseDispatch ────────────────────────────────────────────────────────────

export const LeaseDispatchSchema = z.object({
  id: z.string(),
  dealId: z.string(),
  source: z.enum(["VehicleSale", "Brokerage"]),
  customerName: z.string(),
  financeCompanyName: z.string(),
  fileNumber: z.string(),
  status: z.enum(["PendingDispatch", "Dispatched"]),
  dispatchedAt: z.string().optional(),
  dispatchedBy: z.string().optional(),
  trackingNumber: z.string().optional(),
})

export type LeaseDispatch = z.infer<typeof LeaseDispatchSchema>

// ─── LeaseReconciliation ──────────────────────────────────────────────────────

export const LeaseReconciliationSchema = z.object({
  id: z.string(),
  date: z.string(),
  source: z.enum(["VehicleSale", "Brokerage"]),
  entity: z.string(),
  dealRef: z.string(),
  expectedCommission: z.number().int(),
  receivedCommission: z.number().int().optional(),
  discrepancy: z.number().int().optional(),
  status: z.enum(["Pending", "Reconciled", "Overdue"]),
})

export type LeaseReconciliation = z.infer<typeof LeaseReconciliationSchema>

// ─── Activity ─────────────────────────────────────────────────────────────────

export const ActivitySchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  user: z.string(),
  action: z.string(),
  entity: z.string(),
  detail: z.string(),
})

export type Activity = z.infer<typeof ActivitySchema>

// ─── PaginatedResponse ────────────────────────────────────────────────────────

export const PaginatedResponseSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    data: z.array(itemSchema),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
  })

export type PaginatedResponse<T> = {
  data: T[]
  total: number
  page: number
  pageSize: number
}
