/** T01 wire proposal, not runtime validation or a production API implementation. */
export type Id = string; // UUID, checked at boundary
export type Money = string; // canonical integer minor units; M1 bounds
export type DateOnly = string; // Gregorian YYYY-MM-DD
export type Instant = string; // UTC RFC3339 milliseconds
export type Revision = number; // integer 1..2147483647; exhaustion => REVISION_EXHAUSTED
export type Method = "CASH" | "BANK_TRANSFER";
export type State = "PURCHASED" | "IN_STOCK" | "IN_REPAIR" | "ADVANCE_PLACED" |
  "ADVANCE_EXPIRED" | "FINANCE_PENDING" | "DO_RECEIVED" | "DELIVERED" | "SOLD" | "WRITTEN_OFF";
export type Dependency = { type: "Vehicle" | "PurchaseRecord" | "SaleCase" | "Reservation" |
  "BrokerageDeal" | "FinanceCompany" | "Settings" | "Remittance" | "CommissionEntitlement" |
  "RepairRecord" | "VehicleCost" | "ApprovalRequest" | "ImportBatch" | "Role" | "User" |
  "Customer" | "Supplier" | "RepairVendor" | "CashFacility" | "UploadIntent" |
  "RateSheet" | "Quote" | "Notification" | "InvoiceVersion" | "ExportJob";
  id: Id; revision: Revision };
export type Envelope<T> = { schemaVersion: 1; idempotencyKey: Id; expected: Dependency[]; input: T };
export type CashInput = { amount: Money; date: DateOnly; method: Method; reference?: string };
export type Disposition = { kind: "RELEASE" } | { kind: "HOLD"; reason: string };
export type Contact = { name: string; phone: string; email?: string; role: string; primary: boolean };
export type CustomerInput = { fullName: string; callingName: string; nicOrPassport: string;
  address: string; phone: string; email?: string; drivingLicence?: string; notes?: string };
export type DirectoryInput = { name: string; category: "INDIVIDUAL" | "COMPANY";
  nicOrRegNumber?: string; address?: string; phone?: string; hotline?: string;
  recurring?: boolean; specialisation?: string; notes?: string; contacts: Contact[] };
export type CommissionPolicy = { basis: "FIXED"; fixed: Money; rateBps: number } |
  { basis: "FINANCED_PRINCIPAL"; rateBps: number };
export type FinancePolicy = { path: "APPLICATION" | "REFERRAL"; commission: CommissionPolicy;
  processingFee: Money; reconciliationMethod: "PERIOD_NOTICE" | "PER_DEAL" };
export type VehicleInput = { engineNumber: string; chassisNumber: string; make: string;
  model: string; year: number; colour: string; vin?: string; crNumber?: string;
  fuelType: "PETROL" | "DIESEL" | "HYBRID" | "ELECTRIC" | "OTHER";
  transmission: "MANUAL" | "AUTOMATIC" | "CVT" | "OTHER"; notes?: string };
export type Mileage = { reading: number; date: DateOnly; remark?: string; decreaseReason?: string };
export type Settlement = { reference: string; amount: Money; cashToSeller: Money } &
  ({ institutionType: "FINANCE_COMPANY"; companyId: Id } |
   { institutionType: "BANK" | "PRIVATE_PARTY"; institutionName: string });
export type PurchaseInput = { vehicle: VehicleInput; supplierId: Id; purchaseDate: DateOnly;
  listedPrice?: Money; mileage: Mileage; paymentMethod: Method } &
  ({ purchaseType: "CASH" | "BRAND_NEW"; purchasePrice: Money } |
   { purchaseType: "LEASE_SETTLEMENT"; settlement: Settlement });
export type TradeIn = { description: string; value: Money; intake?: {
  vehicle: VehicleInput; mileage: Mileage; listedPrice?: Money } };
export type ImmediateSale = { cycleId: Id; customerId: Id; price: Money; date: DateOnly;
  mileage: number; method: Method; reference?: string; reason?: string } &
  ({ kind: "CASH" } | { kind: "TRADE_IN"; tradeIn: TradeIn });
export type Reserve = { cycleId: Id; customerId: Id; price: Money; receipt: CashInput;
  reference?: string; reason?: string };
export type StartFinance = { cycleId: Id; customerId: Id; price: Money; downPayment: CashInput;
  financeAmount: Money; companyId: Id; termMonths: number; reference?: string; reason?: string };
export type SaleEdit = { saleId: Id; reason: string; patch: {
  customerId?: Id; price?: Money; reference?: string | null; saleDate?: DateOnly;
  handoverMileage?: number; notes?: string | null;
  finance?: { companyId: Id; downPayment: Money; financeAmount: Money; termMonths: number;
    doAttachmentId: Id; doIssueDate: DateOnly };
  tradeIn?: { description: string; value: Money } }; cashCorrections: {
    paymentId: Id; replacement?: CashInput; reason: string }[] };
export type WriteOff = { cycleId: Id; date: DateOnly; reason: string;
  method: "SCRAPPED" | "AUCTIONED" | "DONATED" | "OTHER"; proceeds: Money;
  receipt?: CashInput };
export type Refund = ({ reservationId: Id; saleCaseId?: never } |
  { saleCaseId: Id; reservationId?: never }) & { refund: CashInput; reason: string;
  disposition: Disposition; retainedAmount: Money };
export type CancelFinanceError = { saleCaseId: Id; reason: string;
  receiptReversals: Id[]; disposition: Disposition };
export type Proposal = { kind: "DISCOUNT"; command:
  { name: "completeImmediate"; input: ImmediateSale } |
  { name: "placeReservation"; input: Reserve } |
  { name: "startFinance"; input: StartFinance } } |
  { kind: "WRITE_OFF"; input: WriteOff } | { kind: "REFUND"; input: Refund } |
  { kind: "SALE_EDIT"; operation: "EDIT_COMPLETION"; input: SaleEdit } |
  { kind: "SALE_EDIT"; operation: "CANCEL_FINANCE_ERROR"; input: CancelFinanceError };
export type AttachmentTarget = { type: "SALE_CASE" | "BROKERAGE_DEAL" | "REMITTANCE" | "IMPORT_BATCH" | "EXPORT_JOB"; id: Id };
export type PhotoCategory = "FRONT" | "BACK" | "LEFT" | "RIGHT" | "CHASSIS" | "ENGINE" |
  "METER" | "DEALER_WITH_VEHICLE" | "CUSTOMER_WITH_VEHICLE";
export type Purpose = "DO" | "INSPECTION" | "PARTICIPANT_DOCUMENT" | "VEHICLE_DOCUMENT" |
  "PROCESSING_DOCUMENT" | "RECONCILIATION_NOTICE" | "IMPORT_SOURCE" | "INVOICE" | "REPORT_EXPORT";
export type ExternalVehicle = { make: string; model: string; year: number; description: string;
  engineNumber?: string; chassisNumber?: string };
export type Guarantor = { name: string; identity: string; address: string; phone: string };
export type ChecklistKind = "CUSTOMER_ID" | "GUARANTOR_ID" | "PASSPORT_PHOTOS" | "BANK_PASSBOOK" |
  "ADDRESS_PROOF" | "RELATIONSHIP_PROOF" | "AFFIDAVIT" | "REGISTRATION_BOOK" |
  "DELETION_LETTER" | "REVENUE_LICENSE" | "EXTRA_KEY" | "TRANSFER_PAPER" | "PREVIOUS_OWNER_ID" |
  "PROCESSING_DOCUMENT";
export type Charge = { category: string; amount: Money };
export type FacilityTerms = { gross: Money; deductions: { label: string; amount: Money;
  recipient: string; handling: "WITHHELD" | "PAID_BY_DEALERSHIP" }[];
  fee: Money; feeMode: "WITHHELD" | "SEPARATE"; separatelyRecoverableCharges: Money };
export type Subject = "Vehicle" | "PurchaseRecord" | "SaleCase" | "Reservation" |
  "RepairRecord" | "VehicleCost" | "Disposal" | "Customer" | "Supplier" | "RepairVendor" |
  "FinanceCompany" | "RateSheet" | "BrokerageDeal" | "CashFacility" | "DispatchBatch" |
  "CommissionEntitlement" | "Remittance" | "ReconciliationRun" | "ApprovalRequest" |
  "Document" | "Invoice" | "Report" | "AuditLog" | "Notification" | "ImportBatch" |
  "Settings" | "User" | "Role" | "ReservationExpiryJob";
export type Grant = { action: "create" | "read" | "update" | "archive" | "approve" | "export" |
  "receive" | "release" | "pay" | "dispatch" | "reconcile" | "import" | "run";
  subject: Subject; fields: string[]; conditions?: { createdBy?: "$actor.id";
    customerId?: Id; financeCompanyId?: Id; status?: string; recipientUserId?: "$actor.id" } };
export type SettingsInput = { company: { name: string; identity: string; address: string;
  phone: string; email: string }; declarations: string[]; currency: string; scale: 2;
  timezone: string; tiers: { upperBps: number | null; days: number }[];
  warningLeadDays: number; processingFee: Money; dateFormat: "YYYY-MM-DD" | "DD/MM/YYYY";
  itemsPerPage: 10 | 20 | 50 | 100; theme: "SYSTEM" | "LIGHT" | "DARK" };

/** Each property is a POST /api/v1/commands/<name> input, inside Envelope. */
export interface Commands {
  createCustomer: CustomerInput;
  updateCustomer: { id: Id; values: CustomerInput; reason?: string };
  createDirectoryParty: { type: "SUPPLIER" | "REPAIR_VENDOR"; values: DirectoryInput };
  updateDirectoryParty: { type: "SUPPLIER" | "REPAIR_VENDOR"; id: Id; values: DirectoryInput; reason?: string };
  createFinanceCompany: { name: string; contacts: Contact[]; policy: FinancePolicy };
  updateFinanceCompany: { id: Id; name: string; contacts: Contact[]; policy: FinancePolicy; reason: string };
  archiveParty: { type: "CUSTOMER" | "SUPPLIER" | "REPAIR_VENDOR" | "FINANCE_COMPANY"; id: Id; active: boolean; reason: string };
  updateSettings: SettingsInput & { reason: string };
  createUser: { name: string; email: string; password: string; roleIds: Id[] }; // secret: never audit/echo
  updateUser: { id: Id; name: string; active: boolean; roleIds: Id[]; reason: string };
  saveRole: { id?: Id; name: string; grants: Grant[]; reason: string };
  archiveRole: { id: Id; reason: string };
  recordPurchase: PurchaseInput;
  editPurchase: { cycleId: Id; reason: string; patch: { purchaseDate?: DateOnly;
    purchasePrice?: Money; seller?: { type: "SUPPLIER" | "CUSTOMER"; id: Id };
    purchaseType?: "CASH" | "LEASE_SETTLEMENT" | "BRAND_NEW";
    notes?: string | null; settlement?: Settlement | null };
    cashCorrections: { paymentId: Id; replacement?: CashInput; reason: string }[] };
  editVehicle: { vehicleId: Id; values: VehicleInput; reason: string };
  receiveStock: { cycleId: Id; date: DateOnly; disposition: Disposition };
  holdStock: { cycleId: Id; reason: string };
  releaseStock: { cycleId: Id };
  setListedPrice: { cycleId: Id; amount: Money; reason?: string };
  addMileage: { cycleId: Id; mileage: Mileage };
  addCost: { cycleId: Id; category: string; description: string; amount: Money;
    incurredDate: DateOnly; payment?: CashInput };
  editCost: { costId: Id; category: string; description: string; amount: Money;
    incurredDate: DateOnly; reason: string };
  payPurchase: { cycleId: Id; recipient: "SELLER" | "SETTLEMENT"; payment: CashInput };
  payCost: { costId: Id; payment: CashInput };
  sendRepair: { cycleId: Id; vendorId: Id; request: string; sentDate: DateOnly };
  returnRepair: { repairId: Id; invoiceAmount: Money; invoiceDate: DateOnly;
    returnedDate: DateOnly; summary: string; payment?: CashInput };
  payRepair: { repairId: Id; payment: CashInput };
  requestApproval: { proposal: Proposal; reason: string };
  reviewApproval: { approvalId: Id; decision: "APPROVE" | "REJECT"; note?: string };
  completeImmediate: ImmediateSale;
  intakeTradeIn: { saleId: Id; vehicle: VehicleInput; mileage: Mileage; listedPrice?: Money };
  placeReservation: Reserve;
  convertReservation: { reservationId: Id; balance: CashInput | null; date: DateOnly; mileage: number; reason?: string };
  cancelRetained: { reservationId: Id; reason: string; disposition: Disposition; retainedAmount: Money };
  startFinance: StartFinance;
  recordDO: { saleCaseId: Id; attachmentId: Id; issueDate: DateOnly };
  confirmDOAndHandover: { saleCaseId: Id; date: DateOnly; mileage: number };
  recordLenderReceipt: { saleCaseId: Id; payment: CashInput };
  normalizeDelivered: { cycleId: Id; reason: string };
  initUpload: { target: Omit<AttachmentTarget, "type"> & { type: Exclude<AttachmentTarget["type"], "EXPORT_JOB"> };
    purpose: Exclude<Purpose, "INVOICE" | "REPORT_EXPORT">;
    filename: string; contentType: string; size: number; sha256: string; category?: PhotoCategory };
  completeUpload: { uploadId: Id };
  issueInvoice: { saleId: Id; saleRevision: Revision; regenerate: boolean };
  publishRates: { companyId: Id; make: string; model: string; year: number;
    validFrom: DateOnly; validThrough: DateOnly; maximum: Money;
    cards: { principal: Money; months: number; installment: Money }[] };
  selectQuote: { sheetId: Id; cardId: Id; vehicle: ExternalVehicle; charges: Charge[] };
  openBrokerage: { customerId: Id; guarantors: Guarantor[]; quoteId: Id; facility?: FacilityTerms };
  recordEligibility: { dealId: Id; target: "CUSTOMER" | "GUARANTOR" | "VEHICLE";
    guarantorId?: Id; outcome: "CONFIRMED" | "REJECTED"; contactId: Id; checkedAt: Instant; feedback: string };
  recordInspection: { dealId: Id; photos: { category: PhotoCategory; attachmentId: Id }[] };
  adjustLoan: { dealId: Id; amount: Money; contactId: Id; feedback: string; confirmedAt: Instant };
  replaceDealQuote: { dealId: Id; quoteId: Id; reason: string; contactId: Id; confirmedAt: Instant };
  setChecklist: { dealId: Id; items: { kind: ChecklistKind; participantId?: Id;
    applicability: "REQUIRED" | "NOT_REQUIRED" | "OPTIONAL"; reason?: string;
    collected: boolean; quantity: number; attachmentIds: Id[] }[] };
  verifyDocuments: { dealId: Id; checklistHash: string; outcome: "CLEAN" | "ISSUES" | "RESOLVED";
    issues: { itemKey: string; description: string; resolved: boolean }[];
    contactId: Id; confirmedAt: Instant; feedback: string };
  setProcessingFee: { dealId: Id; amount: Money; reason: string };
  informCompany: { dealId: Id; contactId: Id; informedAt: Instant; fileReference: string; feedback: string };
  dispatchBatch: { sourceIds: { type: "BROKERAGE" | "VEHICLE_SALE"; id: Id;
    revision: Revision; checklistHash: string }[]; handedOverAt: Instant; courier: string; tracking?: string };
  referDeal: { dealId: Id; contactId: Id; referredAt: Instant; sentContact: { name: string; phone: string }; feedback: string };
  rejectDeal: { dealId: Id; contactId: Id; at: Instant; reason: string };
  completeBrokerage: { dealId: Id; contactId: Id; at: Instant; feedback: string };
  openIssue: { dealId: Id; kind: "BLOCKER" | "DELAY_INQUIRY" | "NON_REMITTANCE";
    text: string; at: Instant; blocksStep?: "DISPATCH" | "COMPLETE"; contactId?: Id; feedback?: string };
  recordIssueFeedback: { issueId: Id; contactId: Id; at: Instant; feedback: string; resolve: boolean };
  requestFacility: { dealId: Id; terms: FacilityTerms; reason: string };
  disburseFacility: { dealId: Id; payment: CashInput | null;
    separatelyPaidDeductions: { index: number; payment: CashInput }[] };
  recoverFacility: { dealId: Id; principal: CashInput | null; chargeRecovery: CashInput | null; fee: CashInput | null };
  recordBrokerageFee: { dealId: Id; category: "PROCESSING" | "ADDITIONAL"; payment: CashInput };
  stageRemittance: { companyId: Id; reference: string }; // metadata only, no received cash
  recordRemittance: { draftId: Id; companyId: Id; payment: CashInput; noticeAttachmentId?: Id;
    lines: { key: string; source?: { type: "VEHICLE_SALE" | "BROKERAGE"; id: Id }; amount: Money; description: string }[] };
  reconcile: { companyId: Id; asOfDate: DateOnly; allocations: { remittanceId: Id;
    entitlementId: Id; noticeLineId?: Id; amount: Money }[]; resolutions: {
      entitlementId: Id; kind: "KEEP_OPEN" | "ACCEPT_SHORTFALL" | "CARRY_CREDIT" | "RETURN_OVERPAYMENT"; reason: string }[] };
  reverseAllocation: { allocationId: Id; reason: string };
  returnRemittanceOverpayment: { remittanceId: Id; discrepancyId: Id; payment: CashInput; reason: string };
  reversePayment: { sourceType: "PURCHASE" | "REPAIR" | "COST" | "SALE" | "FACILITY" | "BROKERAGE_FEE" | "REMITTANCE";
    sourceId: Id; paymentId: Id; replacement?: CashInput; reason: string };
  markNotificationRead: { notificationId: Id };
  markAllNotificationsRead: { through: Instant };
  stageImport: { types: ImportType[]; namespace: string }; // ONE bounded graph, not one commit per type
  previewImport: { batchId: Id; sources: { attachmentId: Id; type: ImportType; sheetName?: string }[];
    templateVersion: 1; namespace: string;
    mappings: { type: ImportType; row: number; existingVehicleId?: Id; cycleSourceKey?: string }[] };
  confirmImport: { batchId: Id; previewHash: string; controlTotals: ControlTotals };
  startReportExport: { filter: Omit<ReportFilter, "page" | "pageSize">; format: "CSV" | "PDF" };
  continueReportExport: { exportId: Id }; // bounded resumable generation, never changes filter
  runExpiry: { through: Instant; cursor?: string; limit: number };
}
export type ImportType = "SUPPLIERS" | "CUSTOMERS" | "REPAIR_VENDORS" | "VEHICLES" | "SALES" | "REPAIRS" | "ADVANCES";
export type LegacyRef = { namespace: string; type: ImportType | "FINANCE_COMPANIES";
  sourceKey: string } | { existingId: Id };
export type LegacyPayment = CashInput & { sourceKey: string; direction: "IN" | "OUT";
  category: string; reversalOfSourceKey?: string };
export type LegacyMetadata = { recordedAt?: Instant; recordedByName?: string;
  approverName?: string; approvalReference?: string; originalId?: string; notes?: string };
export type ImportPayloads = {
  SUPPLIERS: DirectoryInput;
  CUSTOMERS: CustomerInput;
  REPAIR_VENDORS: DirectoryInput;
  VEHICLES: { vehicle: VehicleInput; supplier?: LegacyRef; sellerCustomer?: LegacyRef;
    tradeInSale?: LegacyRef; cycleSourceKey: string; cycleNumber: number;
    purchaseType: "CASH" | "LEASE_SETTLEMENT" | "BRAND_NEW"; purchaseDate: DateOnly;
    purchasePrice: Money; listedPrice?: Money; notes?: string;
    settlement?: { reference: string; amount: Money; cashToSeller: Money } &
      ({ institutionType: "FINANCE_COMPANY"; company: LegacyRef } |
       { institutionType: "BANK" | "PRIVATE_PARTY"; institutionName: string });
    mileage: Mileage[]; status: State; available: boolean; holdReason?: string;
    receivedDate?: DateOnly; closedAt?: Instant; payments: LegacyPayment[];
    additionalCosts: { sourceKey: string; category: string; description: string;
      amount: Money; date: DateOnly; payments: LegacyPayment[] }[];
    disposal?: Omit<WriteOff, "cycleId"> & { legacyApprover: string } };
  SALES: { cycle: LegacyRef; customer: LegacyRef; kind: SaleDTO["kind"];
    saleCaseSourceKey: string; // shared with ADVANCES, never a second SaleCase
    price: Money; reference?: string; state: "COMPLETED" | "FINANCE_PENDING" | "DO_RECEIVED" | "CANCELLED";
    completion?: { date: DateOnly; mileage: number; basis: { purchase: Money;
      repairs: { sourceKey: string; amount: Money }[]; costs: { sourceKey: string; amount: Money }[] } };
    reservation?: LegacyRef; finance?: { company: LegacyRef; downPayment: Money;
      financeAmount: Money; termMonths: number; doAttachmentId?: Id; doIssueDate?: DateOnly };
    tradeIn?: { description: string; value: Money; acquiredCycle?: LegacyRef };
    payments: LegacyPayment[]; notes?: string };
  REPAIRS: { cycle: LegacyRef; vendor: LegacyRef; request: string; sentDate: DateOnly;
    returnedDate?: DateOnly; invoiceDate?: DateOnly; invoiceAmount?: Money; summary?: string;
    payments: LegacyPayment[] };
  ADVANCES: { cycle: LegacyRef; customer: LegacyRef; agreed: Money; amount: Money;
    saleCaseSourceKey: string;
    placedDate: DateOnly; listedBasis: Money; validThrough: DateOnly; expiresAt: Instant;
    policySnapshot: { timezone: string; tiers: SettingsInput["tiers"]; leadDays: number; days: number };
    state: "ACTIVE" | "EXPIRED" | "CONVERTED" | "REFUNDED" | "CANCELLED";
    completedSale?: LegacyRef; retainedAmount?: Money; resolutionDate?: DateOnly;
    resolutionReason?: string; disposition?: Disposition; payments: LegacyPayment[] };
};
export type ImportRowInput = { [K in ImportType]: { type: K; sourceKey: string;
  payload: ImportPayloads[K]; legacy?: LegacyMetadata } }[ImportType];
export type ControlTotals = { rows: number; purchase: Money; cost: Money; consideration: Money;
  cashIn: Money; cashOut: Money; openingBalance?: Money;
  byType: { type: ImportType; rows: number }[] };
export type CommandName = keyof Commands;
/** Required CAS dependencies. @ selectors are trusted FK/singleton resolvers defined in A3R.
 * Optional/list/variant references expand only when present; [] has explicit A3R semantics. */
export type RevisionSelector = `${Dependency["type"]}:${string}` | `@${string}`;
export const commandRevisionRules = {
  "createCustomer": [],
  "updateCustomer": ["Customer:input.id"],
  "createDirectoryParty": [],
  "updateDirectoryParty": ["@party"],
  "createFinanceCompany": ["@settings"],
  "updateFinanceCompany": ["FinanceCompany:input.id", "@settings"],
  "archiveParty": ["@party"],
  "updateSettings": ["@settings"],
  "createUser": ["@assignedRoles"],
  "updateUser": ["User:input.id", "@assignedRoles"],
  "saveRole": ["@existingRole"],
  "archiveRole": ["Role:input.id"],
  "recordPurchase": ["@purchaseReferences"],
  "editPurchase": ["PurchaseRecord:input.cycleId", "@purchaseEditReferences"],
  "editVehicle": ["Vehicle:input.vehicleId"],
  "receiveStock": ["PurchaseRecord:input.cycleId"],
  "holdStock": ["PurchaseRecord:input.cycleId"],
  "releaseStock": ["PurchaseRecord:input.cycleId"],
  "setListedPrice": ["PurchaseRecord:input.cycleId"],
  "addMileage": ["PurchaseRecord:input.cycleId", "@vehicleForCycle"],
  "addCost": ["PurchaseRecord:input.cycleId"],
  "editCost": ["VehicleCost:input.costId", "@cycleForCost"],
  "payPurchase": ["PurchaseRecord:input.cycleId"],
  "payCost": ["VehicleCost:input.costId", "@cycleForCost"],
  "sendRepair": ["PurchaseRecord:input.cycleId", "RepairVendor:input.vendorId"],
  "returnRepair": ["RepairRecord:input.repairId", "@cycleForRepair"],
  "payRepair": ["RepairRecord:input.repairId", "@cycleForRepair"],
  "requestApproval": ["@proposalDependencies"],
  "reviewApproval": ["ApprovalRequest:input.approvalId", "@approvalDependencies"],
  "completeImmediate": ["PurchaseRecord:input.cycleId", "Customer:input.customerId", "@tradeInIdentity"],
  "intakeTradeIn": ["@saleAndCycle", "@tradeInIdentity"],
  "placeReservation": ["PurchaseRecord:input.cycleId", "Customer:input.customerId", "@settings"],
  "convertReservation": ["@reservationAndSaleAndCycle"],
  "cancelRetained": ["@reservationAndSaleAndCycle"],
  "startFinance": ["PurchaseRecord:input.cycleId", "Customer:input.customerId", "FinanceCompany:input.companyId", "@settings"],
  "recordDO": ["@saleAndCycle"],
  "confirmDOAndHandover": ["@saleAndCycle"],
  "recordLenderReceipt": ["@saleAndCycle"],
  "normalizeDelivered": ["PurchaseRecord:input.cycleId", "@completedSaleForCycle"],
  "initUpload": ["@target"],
  "completeUpload": ["UploadIntent:input.uploadId", "@uploadTarget"],
  "issueInvoice": ["@saleAndCycle", "@existingInvoice"],
  "publishRates": ["FinanceCompany:input.companyId"],
  "selectQuote": ["RateSheet:input.sheetId", "@companyForSheet", "@settings"],
  "openBrokerage": ["Customer:input.customerId", "Quote:input.quoteId", "@companyForQuote", "@settings"],
  "recordEligibility": ["BrokerageDeal:input.dealId", "@companyForDeal"],
  "recordInspection": ["BrokerageDeal:input.dealId"],
  "adjustLoan": ["BrokerageDeal:input.dealId", "@facilityForDeal"],
  "replaceDealQuote": ["BrokerageDeal:input.dealId", "Quote:input.quoteId", "@companyForDeal", "@facilityForDeal"],
  "setChecklist": ["BrokerageDeal:input.dealId"],
  "verifyDocuments": ["BrokerageDeal:input.dealId", "@companyForDeal"],
  "setProcessingFee": ["BrokerageDeal:input.dealId"],
  "informCompany": ["BrokerageDeal:input.dealId", "@companyForDeal"],
  "dispatchBatch": ["@dispatchMembers"],
  "referDeal": ["BrokerageDeal:input.dealId", "@companyForDeal"],
  "rejectDeal": ["BrokerageDeal:input.dealId", "@companyForDeal"],
  "completeBrokerage": ["BrokerageDeal:input.dealId", "@companyForDeal"],
  "openIssue": ["BrokerageDeal:input.dealId"],
  "recordIssueFeedback": ["@dealForIssue", "@companyForIssue"],
  "requestFacility": ["BrokerageDeal:input.dealId", "@facilityForDeal"],
  "disburseFacility": ["BrokerageDeal:input.dealId", "@facilityForDeal"],
  "recoverFacility": ["BrokerageDeal:input.dealId", "@facilityForDeal"],
  "recordBrokerageFee": ["BrokerageDeal:input.dealId"],
  "stageRemittance": ["FinanceCompany:input.companyId"],
  "recordRemittance": ["Remittance:input.draftId", "FinanceCompany:input.companyId"],
  "reconcile": ["FinanceCompany:input.companyId", "@reconciliationMembers"],
  "reverseAllocation": ["@allocationOwners"],
  "returnRemittanceOverpayment": ["Remittance:input.remittanceId", "@discrepancyEntitlement"],
  "reversePayment": ["@paymentOwners"],
  "markNotificationRead": ["Notification:input.notificationId"],
  "markAllNotificationsRead": [],
  "stageImport": [],
  "previewImport": ["ImportBatch:input.batchId", "@importMappings"],
  "confirmImport": ["ImportBatch:input.batchId", "@importManifestDependencies"],
  "startReportExport": [],
  "continueReportExport": ["ExportJob:input.exportId"],
  "runExpiry": []
} satisfies Record<CommandName, readonly RevisionSelector[]>;
export type CommandRequest = { [N in CommandName]: { name: N; body: Envelope<Commands[N]> } }[CommandName];
export type ErrorCode = "UNAUTHENTICATED" | "ACCOUNT_INACTIVE" | "FORBIDDEN" | "FIELD_FORBIDDEN" |
  "NOT_FOUND" | "INVALID_INPUT" | "MONEY_OVERFLOW" | "OVERALLOWANCE" | "BALANCE_MISMATCH" |
  "INVALID_STATE" | "STALE_REVISION" | "REVISION_REQUIRED" | "REVISION_EXHAUSTED" |
  "IDENTITY_CONFLICT" | "IDENTITY_WRITTEN_OFF" | "STOCK_UNAVAILABLE" | "OBLIGATION_OPEN" |
  "APPROVAL_REQUIRED" | "SELF_REVIEW" | "APPROVAL_STALE" | "ALREADY_REVIEWED" |
  "IDEMPOTENCY_MISMATCH" | "COMMAND_IN_PROGRESS" | "LAST_ADMIN" | "SYSTEM_ROLE_PROTECTED" |
  "IMMUTABLE_CURRENCY" | "UNSUPPORTED_RATE" | "QUOTE_EXPIRED" | "PATH_MISMATCH" |
  "CHECKLIST_INCOMPLETE" | "VERIFICATION_STALE" | "CONTACT_MISMATCH" | "ALLOCATION_EXCEEDED" |
  "DOCUMENT_NOT_READY" | "UPLOAD_EXPIRED" | "UPLOAD_MISMATCH" | "STORAGE_UNAVAILABLE" |
  "IMPORT_INVALID" | "IMPORT_STALE" | "IMPORT_DUPLICATE" | "DELIVERED_WITHOUT_COMPLETION" |
  "ENVIRONMENT_UNAVAILABLE" | "QUOTA_STOP" | "RETRYABLE_TRANSACTION" | "INTERNAL_ERROR";
export type ApiError = { ok: false; error: { code: ErrorCode; message: string;
  fields?: { path: string; code: string; message: string }[]; requestId: Id;
  retryable: boolean; current?: Dependency[]; retryAfterMs?: number } };
export type Applied = { ok: true; status: "APPLIED"; commandId: Id; replayed: boolean;
  result: { type: string; id: Id; revision: Revision }; affected: Dependency[];
  invalidate: ("inventory" | "purchases" | "sales" | "customers" | "parties" | "repairs" |
    "approvals" | "documents" | "brokerage" | "finance" | "reports" | "dashboard" | "notifications" | "settings" | "users")[] };
export type Pending = { ok: true; status: "PENDING_APPROVAL"; commandId: Id;
  approvalId: Id; revision: Revision; replayed: boolean; businessEffect: false };
export type UploadReady = { ok: true; status: "UPLOAD_READY"; uploadId: Id; revision: Revision;
  putUrl: string; requiredHeaders: Record<string, string>; expiresAt: Instant }; // secret-bearing URL: no logs/cache
export type InvoicePending = { ok: true; status: "DOCUMENT_PENDING"; invoiceId: Id; version: number;
  state: "PENDING" | "FAILED"; retryable: boolean };
export type ImportPreview = { ok: true; status: "IMPORT_PREVIEW"; batchId: Id; revision: Revision;
  previewHash: string; valid: boolean; graph: ImportGraphManifest;
  rows: { attachmentId: Id; sheetName?: string; row: number; sourceKey: string; type: ImportType;
    normalized: ImportRowInput | null; errors: { field: string; code: string; message: string }[] }[];
  controlTotals: ControlTotals };
export type JobResult = { ok: true; status: "JOB_RESULT"; runId: Id; cutoff: Instant;
  processed: number; expired: number; warned: number; skipped: number;
  failures: { reservationId: Id; code: ErrorCode }[]; nextCursor: string | null };
export type CommandResult = Applied | Pending | UploadReady | InvoicePending | ImportPreview | JobResult | ApiError;

export type ListParams = { page: number; pageSize: 10 | 20 | 50 | 100; q?: string;
  sort: { field: string; direction: "asc" | "desc" }[]; from?: DateOnly; through?: DateOnly };
export type ReportKind = "INVENTORY" | "SOLD" | "PROFIT" | "ADVANCES" | "REPAIRS" | "CASH_FLOW" | "DISPOSALS";
export type ReportFilter = ListParams & { kind: ReportKind; statuses?: State[]; available?: boolean;
  make?: string; model?: string; saleType?: "CASH" | "ADVANCE" | "LEASE" | "TRADE_IN";
  vendorId?: Id; profitOnly?: boolean; lossOnly?: boolean; method?: Method };
export interface Queries {
  currentActor: Record<string, never>;
  users: ListParams & { active?: boolean; roleId?: Id };
  user: { id: Id };
  roles: ListParams & { active?: boolean };
  role: { id: Id };
  permissionRegistry: { subject?: Subject; action?: Grant["action"] };
  parties: ListParams & { type: "SUPPLIER" | "REPAIR_VENDOR" | "FINANCE_COMPANY"; active?: boolean };
  customers: ListParams;
  customer: { id: Id };
  inventory: ListParams & { statuses?: State[]; available?: boolean; make?: string; model?: string };
  vehicle: { id: Id; cycleId?: Id };
  vehicleIdentity: { engineNumber: string; chassisNumber: string };
  purchases: ListParams & { supplierId?: Id; sellerCustomerId?: Id; vehicleId?: Id;
    purchaseType?: PurchaseInput["purchaseType"]; statuses?: State[] };
  purchase: { cycleId: Id };
  sale: { id: Id };
  approvals: ListParams & { status?: "PENDING" | "APPROVED" | "REJECTED" | "STALE" };
  audit: ListParams & { type: string; id: Id };
  notifications: ListParams & { unread?: boolean; kind?: string };
  compare: { vehicle: ExternalVehicle; principal: Money; asOf: DateOnly } &
    ({ months: number; installment?: never } | { installment: Money; months?: never });
  loanMaxima: { vehicle: Pick<ExternalVehicle, "make" | "model" | "year">; asOf: DateOnly };
  quote: { id: Id };
  brokerage: ListParams & { companyId?: Id; status?: string; includeRejected?: boolean };
  brokerageDeal: { id: Id };
  dispatchPreview: { sourceIds: { type: "VEHICLE_SALE" | "BROKERAGE"; id: Id }[] };
  reconciliation: ListParams & { companyId: Id; asOf: DateOnly; runId?: Id; pendingOnly?: boolean };
  report: ReportFilter;
  exportReport: { exportId: Id }; // manifest/status; creation is startReportExport
  dashboard: { asOf: DateOnly; year: number; month: number };
  settings: Record<string, never>;
  importTemplate: { type: ImportType; format: "CSV" | "XLSX"; version: 1 };
  importBatch: { id: Id };
  download: { attachmentId: Id };
  invoice: { saleId: Id; version?: number };
  jobHealth: Record<string, never>;
  commandStatus: { name: CommandName; idempotencyKey: Id };
}
export type Provenance = { imported: false } | { imported: true; batchId: Id; row: number; sourceKey: string;
  contributingRows: { rowId: Id; type: ImportType; sourceKey: string }[] };
export type PaymentDTO = CashInput & { id: Id; direction: "IN" | "OUT"; category: string;
  recordedAt: Instant; reversalOf?: Id };
export type FinancialDTO = { currency: string; scale: 2; purchase: Money; repairs: Money;
  additionalCosts: Money; basis: Money; originalBasis?: Money; salePrice?: Money;
  originalProfit?: Money; restatedProfit?: Money; cashIn: Money; cashOut: Money; net: Money };
export type VehicleDTO = { id: Id; identity: VehicleInput; cycleId: Id; revision: Revision;
  identityRevision: Revision;
  status: State; available: boolean; holdReason?: string; listedPrice?: Money;
  financial?: FinancialDTO; mileage: Mileage[]; provenance: Provenance };
export type SaleDTO = { id: Id; cycleId: Id; customerId: Id; revision: Revision;
  kind: "CASH" | "ADVANCE" | "LEASE" | "TRADE_IN"; state: string; price: Money;
  reference?: string; reservation?: { id: Id; revision: Revision; amount: Money; listedBasis: Money; percentDisplay: string;
    validThrough: DateOnly; expiresAt: Instant; effectiveStatus: "ACTIVE" | "EXPIRED" | "CONVERTED" | "REFUNDED" | "CANCELLED";
    expiryFlagPending: boolean; retainedAmount?: Money };
  finance?: { companyId: Id; down: Money; principal: Money; termMonths: number;
    doAttachmentId?: Id; issueDate?: DateOnly; lenderOutstanding: Money };
  tradeIn?: { description: string; value: Money; acquiredCycleId?: Id };
  completion?: { id: Id; date: DateOnly; mileage: number; basisVersionId: Id };
  payments?: PaymentDTO[]; timeline: { at: Instant; action: string; actorName: string }[];
  nextActions: CommandName[]; invoices: { id: Id; revision: Revision; version: number; state: "PENDING" | "READY" | "FAILED" }[];
  provenance: Provenance };
export type Page<T> = { ok: true; data: T[]; total: number; page: number; pageSize: number;
  asOf: Instant; totals?: Record<string, Money>; redactedFields: string[] };
export type CompareResult = { companyId: Id; companyRevision: Revision; status: "SUPPORTED"; sheetId: Id; cardId: Id;
  maximum: Money; principal: Money; installment: Money; months: number; validThrough: DateOnly } |
  { companyId: Id; companyRevision: Revision; status: "UNSUPPORTED"; reason: "NO_CARD" | "OVER_LIMIT" | "EXPIRED" | "AMBIGUOUS";
    maximum: Money | null; sheetId: Id | null; validThrough: DateOnly | null;
    choices?: { cardId: Id; months: number; installment: Money }[] };
export type ReconciliationDTO = { entitlementId: Id; source: "VEHICLE_SALE" | "BROKERAGE";
  sourceId: Id; companyId: Id; sentDate: DateOnly; expected: Money; received: Money;
  discrepancy: Money; outstanding: Money; state: "OPEN" | "PARTIAL" | "SETTLED" | "RESOLVED";
  overdue: boolean; cutoffDate: DateOnly; watermarkDate: DateOnly | null };
export type NotificationDTO = { id: Id; revision: Revision; kind: "ADVANCE_EXPIRING" | "ADVANCE_EXPIRED" |
  "REPAIR_RETURNED" | "APPROVAL_REQUIRED" | "APPROVAL_OUTCOME"; title: string; body: string;
  target: { type: string; id: Id; href: string }; createdAt: Instant; readAt: Instant | null };
export type DownloadDTO = { ok: true; attachmentId: Id; url: string; expiresAt: Instant;
  filename: string; contentType: string; size: number; sha256: string };
export type PartyDTO = { id: Id; revision: Revision; type: "SUPPLIER" | "REPAIR_VENDOR" |
  "FINANCE_COMPANY"; name: string; active: boolean; contacts: (Contact & { id: Id })[];
  directory?: DirectoryInput; policy?: FinancePolicy; provenance: Provenance };
export type CustomerDTO = CustomerInput & { id: Id; revision: Revision; active: boolean;
  provenance: Provenance; links: { type: "PURCHASE" | "SALE" | "BROKERAGE";
    id: Id; date: DateOnly; status: string; amount?: Money }[] };
export type BrokerageDTO = { id: Id; revision: Revision; customerId: Id; companyId: Id;
  vehicle: ExternalVehicle; path: "APPLICATION" | "REFERRAL"; state: "INTAKE" |
  "ELIGIBILITY_PENDING" | "ELIGIBLE" | "INSPECTED" | "DOCUMENTS_READY" | "DISPATCHED" |
  "REFERRED" | "COMPLETED" | "REJECTED"; guarantors: (Guarantor & { id: Id })[];
  quote: DealQuoteDTO; originalQuoteId: Id; quoteHistory: DealQuoteDTO[];
  quoteStatus: "SUPPORTED" | "RESELECTION_REQUIRED";
  approvedLoan: Money; processingFee: Money; fileReference?: string;
  eligibility: { target: "CUSTOMER" | "GUARANTOR" | "VEHICLE"; guarantorId?: Id;
    outcome: "CONFIRMED" | "REJECTED"; contactId: Id; at: Instant; feedback: string }[];
  photos: { category: PhotoCategory; attachmentId: Id }[];
  checklist: Commands["setChecklist"]["items"];
  verification: (Commands["verifyDocuments"] & { id: Id })[];
  issues: (Commands["openIssue"] & { id: Id; resolvedAt?: Instant; feedback:
    { contactId: Id; at: Instant; text: string }[] })[];
  facility?: { id: Id; revision: Revision; terms: FacilityTerms; net: Money; principalOutstanding: Money;
    chargesOutstanding: Money; feeOutstanding: Money; payments: PaymentDTO[] };
  events: { kind: string; at: Instant; contactId?: Id; text: string }[];
  nextActions: CommandName[]; provenance: Provenance };
export type ApprovalDTO = { id: Id; revision: Revision; proposal: Proposal;
  expected: Dependency[]; payloadHash: string; reason: string; requestedBy: Id;
  requestedAt: Instant; state: "PENDING" | "APPROVED" | "REJECTED" | "STALE";
  reviewedBy?: Id; reviewedAt?: Instant; reviewNote?: string; appliedCommandId?: Id };
export type AuditDTO = { id: Id; entityType: string; entityId: Id; action: string;
  actor: { kind: "USER" | "SYSTEM" | "IMPORT"; userId?: Id; initiatedBy?: Id };
  approverId?: Id; at: Instant; reason?: string;
  fields: { path: string; before: unknown; after: unknown }[] };
export type ReportRow = {
  INVENTORY: VehicleDTO;
  SOLD: { saleId: Id; cycleId: Id; vehicle: string; customer: string; date: DateOnly;
    type: SaleDTO["kind"]; method: Method | null; financial?: FinancialDTO };
  PROFIT: { cycleId: Id; vehicle: string; status: State; date: DateOnly;
    financial?: FinancialDTO; components?: { type: "PURCHASE" | "REPAIR" | "COST";
      id: Id; date: DateOnly; amount: Money; description: string }[]; marginPercent?: string | null };
  ADVANCES: { reservationId: Id; cycleId: Id; customer: string; vehicle: string;
    placedDate: DateOnly; state: "ACTIVE" | "EXPIRED"; amount: Money; listedBasis: Money;
    agreed: Money; percentDisplay: string; validThrough: DateOnly; daysOutstanding: number; daysOverdue: number };
  REPAIRS: { repairId: Id; cycleId: Id; vehicle: string; vendorId: Id; vendor: string;
    request: string; sentDate: DateOnly; daysInRepair: number };
  CASH_FLOW: { paymentId: Id; sourceType: string; sourceId: Id; date: DateOnly;
    amount: Money; direction: "IN" | "OUT"; method: Method; category: string };
  DISPOSALS: { cycleId: Id; vehicle: string; date: DateOnly; reason: string; approvedBy: Id;
    method: WriteOff["method"]; basis?: Money; proceeds?: Money; netLoss?: Money };
};
export type ReportResponse = { [K in ReportKind]: Page<ReportRow[K]> & { kind: K } }[ReportKind];
export type DispatchPreview = { source: "VEHICLE_SALE" | "BROKERAGE"; id: Id;
  revision: Revision; checklistHash: string; ready: boolean;
  blockers: { code: ErrorCode; field: string; message: string }[] };
export type JobHealth = { lastSuccess: Instant | null; lastFailure: Instant | null; stale: boolean;
  latestRun: { id: Id; status: "SUCCESS" | "PARTIAL" | "FAILED"; cursor: string | null } | null };
export type CurrentActorDTO = { user: { id: Id; name: string; active: true };
  authzRevision: string; // opaque fingerprint of CURRENT activation/user+role/rule versions, not a session token
  roles: { id: Id; name: string; revision: Revision }[];
  presentationGrants: Grant[]; registryVersion: number; serverTime: Instant };
export type UserAdminDTO = { id: Id; revision: Revision; name: string; email?: string;
  active: boolean; authzRevision: string; roles: { id: Id; name: string; revision: Revision }[];
  createdAt: Instant; updatedAt: Instant;
  adminProtection?: { isAdministrator: boolean; lastActiveAdministrator: boolean } };
export type RoleDTO = { id: Id; revision: Revision; name: string; active: boolean;
  systemKey: "ADMINISTRATOR" | null; grants: Grant[]; assignedUserCount?: number };
export type PermissionRegistryDTO = { version: number; subjects: { subject: Subject;
  actions: { action: Grant["action"]; fields: { path: string; dataType: "STRING" | "MONEY" |
    "NUMBER" | "BOOLEAN" | "DATE" | "OBJECT" | "ARRAY"; readable: boolean; writable: boolean }[];
    conditions: { key: keyof NonNullable<Grant["conditions"]>; operator: "EQ";
      valueType: "ACTOR_ID" | "UUID" | "STATUS"; allowedValues?: string[] }[] }[] }[] };
export type SourcePaymentDTO = PaymentDTO & { owner: { type: "PURCHASE" | "COST" | "REPAIR" |
  "SALE" | "DISPOSAL"; id: Id }; commandId: Id; reason?: string };
export type PurchaseCycleDTO = { id: Id; revision: Revision; vehicleId: Id;
  identity: VehicleInput; identityRevision: Revision; cycleNumber: number;
  purchaseType: PurchaseInput["purchaseType"]; acquisitionKind: "SUPPLIER" | "TRADE_IN";
  seller: { type: "SUPPLIER" | "CUSTOMER"; id: Id; name: string; active: boolean };
  tradeInSourceSaleId?: Id; purchaseDate: DateOnly; purchasePrice: Money; listedPrice?: Money;
  notes?: string; settlement?: Settlement & { institutionNameSnapshot: string };
  status: State; available: boolean; holdReason?: string; receivedDate?: DateOnly;
  closedAt: Instant | null; payments: SourcePaymentDTO[];
  outstanding: { seller: Money; settlement: Money };
  costs: { id: Id; revision: Revision; category: string; description: string; amount: Money;
    incurredDate: DateOnly; payments: SourcePaymentDTO[]; outstanding: Money; provenance: Provenance }[];
  repairs: { id: Id; revision: Revision; vendorId: Id; request: string; sentDate: DateOnly;
    returnedDate?: DateOnly; summary?: string; invoiceAmount?: Money; invoiceDate?: DateOnly;
    payments: SourcePaymentDTO[] }[];
  mileage: (Mileage & { id: Id })[]; financial?: FinancialDTO;
  basisVersions: { id: Id; version: number; total: Money; reason: string }[];
  sales: { saleCaseId: Id; revision: Revision; customerId: Id; kind: SaleDTO["kind"];
    state: string; completionId?: Id; date?: DateOnly }[];
  disposal: { id: Id; approvalId: Id | null; legacyApprovalReference?: string;
    date: DateOnly; reason: string; method: WriteOff["method"]; proceeds: Money;
    basisVersionId: Id; payments: SourcePaymentDTO[] } | null;
  provenance: Provenance; nextActions: CommandName[] };
export type QuoteDTO = { id: Id; revision: 1; vehicle: ExternalVehicle;
  sheetId: Id; cardId: Id; companyId: Id; principal: Money; months: number; installment: Money;
  maximum: Money; charges: Charge[]; policy: FinancePolicy; expiresAt: Instant };
export type DealQuoteDTO = { id: Id; selectionId: Id; version: number; sheetId: Id; cardId: Id; companyId: Id;
  principal: Money; months: number; installment: Money; maximum: Money;
  charges: Charge[]; policy: FinancePolicy; expiresAt: Instant;
  effectivePolicy: FinancePolicy; selectedAt: Instant; selectedBy: Id; replacedQuoteId: Id | null; reason?: string };
export type LoanMaximumDTO = { companyId: Id; companyRevision: Revision; companyName: string; asOf: DateOnly } &
  ({ status: "APPLICABLE"; sheetId: Id; maximum: Money; validFrom: DateOnly; validThrough: DateOnly } |
   { status: "UNAVAILABLE"; reason: "NO_SHEET" | "EXPIRED"; maximum: null; sheetId: null });
export type ImportGraphManifest = { schemaVersion: 1; types: ImportType[]; totalRows: number;
  nodes: { rowKey: string; sourceType: ImportType; sourceKey: string;
    targets: { type: "Vehicle" | "PurchaseRecord" | "SaleCase" | "Reservation" |
      "SaleCompletion" | "RepairRecord" | "Supplier" | "Customer" | "RepairVendor"; id: Id }[] }[];
  edges: { fromRowKey: string; field: string; toRowKey: string | null; existingTargetId: Id | null }[];
  saleCases: { sourceKey: string; id: Id; cycleSourceKey: string; rowKeys: string[] }[];
  existingDependencies: Dependency[]; normalizedHash: string };
export type ExportManifestDTO = { id: Id; revision: Revision; state: "SNAPSHOTTING" | "RENDERING" |
  "READY" | "PAUSED_QUOTA" | "FAILED"; format: "CSV" | "PDF"; filter: Omit<ReportFilter, "page" | "pageSize">;
  filterHash: string; snapshotAt: Instant; authzRevision: string; rowCount: number | null;
  snapshotSequence: string; // canonical positive integer commit prefix, not timestamp isolation
  totals: Record<string, Money> | null; renderedRows: number; manifestHash: string | null;
  parts: { ordinal: number; firstRow: number; lastRow: number; rowCount: number;
    sha256: string; size: number; attachmentId: Id }[];
  complete: boolean; retryable: boolean; errorCode?: ErrorCode; nextAction?: "continueReportExport" };
export interface QueryData {
  currentActor: CurrentActorDTO;
  users: Page<UserAdminDTO>;
  user: UserAdminDTO;
  roles: Page<RoleDTO>;
  role: RoleDTO;
  permissionRegistry: PermissionRegistryDTO;
  parties: Page<PartyDTO>;
  customers: Page<CustomerDTO>;
  customer: CustomerDTO;
  inventory: Page<VehicleDTO>;
  vehicle: VehicleDTO & { cycles: PurchaseCycleDTO[];
    repairs: { id: Id; cycleId: Id; vendorId: Id; request: string; sentDate: DateOnly;
      returnedDate?: DateOnly; summary?: string; invoiceAmount?: Money; invoiceDate?: DateOnly }[] };
  vehicleIdentity: { id: Id; revision: Revision; identity: VehicleInput;
    activeCycleId: Id | null; latestCycleId: Id | null; latestStatus: State } | null;
  purchases: Page<PurchaseCycleDTO>;
  purchase: PurchaseCycleDTO;
  sale: SaleDTO;
  approvals: Page<ApprovalDTO>;
  audit: Page<AuditDTO>;
  notifications: Page<NotificationDTO> & { unreadCount: number };
  compare: CompareResult[];
  loanMaxima: LoanMaximumDTO[];
  quote: QuoteDTO;
  brokerage: Page<BrokerageDTO>;
  brokerageDeal: BrokerageDTO;
  dispatchPreview: DispatchPreview[];
  reconciliation: Page<ReconciliationDTO> & { unallocatedRemittances: { id: Id; amount: Money }[] };
  report: ReportResponse;
  exportReport: ExportManifestDTO;
  dashboard: { asOf: DateOnly; year: number; month: number; inStock: number; available: number;
    held: number; inRepair: number; activeAdvances: number; expiredAdvances: number;
    recentSales: SaleDTO[]; totals?: { salePrice: Money; profit: Money; cashIn: Money; cashOut: Money; net: Money };
    quickActions: ("recordPurchase" | "completeImmediate" | "sendRepair")[] };
  settings: SettingsInput & { id: Id; revision: Revision; policyVersion: number };
  importTemplate: { version: 1; type: ImportType; columns: { name: string; type: string;
    required: boolean; description: string }[]; download: DownloadDTO };
  importBatch: ImportPreview & { state: "STAGED" | "VALIDATED" | "COMMITTED" | "FAILED";
    targets: { sourceKey: string; type: string; id: Id }[] };
  download: DownloadDTO;
  invoice: { id: Id; revision: Revision; version: number; saleRevision: Revision; number: string;
    state: "PENDING" | "READY" | "FAILED"; download?: DownloadDTO };
  jobHealth: JobHealth;
  commandStatus: CommandResult | { ok: true; status: "NOT_COMMITTED" };
}
/** Compile-time completeness of query response map; adapters still validate runtime. */
export type QueryResponse<N extends keyof Queries> = N extends keyof QueryData ?
  { ok: true; data: Visible<QueryData[N]>; redactedFields: string[]; asOf: Instant } | ApiError : never;
/** DTOs above specify the maximum allowed shape, never a mandate to disclose all fields.
 * Projection may omit forbidden properties recursively, never substitute zero/null for money.
 * Adapters keep envelope/pagination/identity fields required and project business records only. */
export type Visible<T> = T extends readonly (infer U)[] ? Visible<U>[] :
  T extends object ? { [K in keyof T]?: Visible<T[K]> } : T;
export type MissingQueryData = Exclude<keyof Queries, keyof QueryData>;
const queryDataComplete: MissingQueryData extends never ? true : never = true;
void queryDataComplete;
