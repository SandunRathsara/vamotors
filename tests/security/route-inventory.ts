// Explicit entry-point inventory. Source test fails when a route is added/removed.
export const legacyAPIs = [
  "/api/approvals",
  "/api/cash-flow",
  "/api/customers",
  "/api/customers/[id]",
  "/api/dashboard",
  "/api/lease-deals",
  "/api/lease-deals/[id]",
  "/api/lease-dispatch",
  "/api/lease-reconciliation",
  "/api/notifications",
  "/api/purchases",
  "/api/repairs",
  "/api/reports/advances",
  "/api/reports/audit",
  "/api/reports/profit",
  "/api/reports/purchases",
  "/api/reports/repairs",
  "/api/reports/sales",
  "/api/reports/stock",
  "/api/sales",
  "/api/sales/[id]",
  "/api/settings",
  "/api/third-parties",
  "/api/third-parties/[id]",
  "/api/users",
  "/api/vehicles",
  "/api/vehicles/[id]",
]
export const persistedRateAPIs = {
  "/api/lease-comparison": "POST",
  "/api/lease-rate-sheets": "GET",
} as const
export const persistedRatePages = ["/lease-comparison", "/lease-rate-sheets"]
export const privateAttachmentAPIs = {
  "/api/v1/uploads/[uploadId]": "PUT",
  "/api/v1/attachments/[attachmentId]": "GET",
} as const
export const importStagingPages = ["/imports", "/imports/[id]"]
export const persistedRepairPages = ["/repairs", "/repairs/[id]"]
export const approvalPages = ["/approvals", "/approvals/[id]"]
export const brokeragePages = ["/lease-deals", "/lease-deals/[id]", "/lease-dispatch"]
export const unavailablePages = [
  "/cash-flow",
  "/dashboard",
  "/lease-reconciliation",
  "/reports",
  "/reports/advances",
  "/reports/audit",
  "/reports/profit",
  "/reports/purchases",
  "/reports/repairs",
  "/reports/sales",
  "/reports/stock",
  "/sales",
  "/sales/[id]",
]
export const methods = [
  "GET",
  "HEAD",
  "OPTIONS",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
] as const
export const queryNames = [
  "importBatches",
  "importBatchFiles",
  "download",
  "quote",
  "purchases",
  "purchase",
  "inventory",
  "vehicle",
  "vehicleIdentity",
  "settings",
  "party",
  "parties",
  "customers",
  "customer",
  "currentActor",
  "users",
  "user",
  "roles",
  "role",
  "permissionRegistry",
  "audit",
]
export const commandNames = [
  "stageImport",
  "initUpload",
  "completeUpload",
  "publishRates",
  "selectQuote",
  "recordPurchase",
  "updateSettings",
  "createFinanceCompany",
  "updateFinanceCompany",
  "createDirectoryParty",
  "updateDirectoryParty",
  "createCustomer",
  "updateCustomer",
  "archiveParty",
  "createUser",
  "updateUser",
  "saveRole",
  "archiveRole",
]
export const guessedID = "00000000-0000-4000-8000-000000000099"
export const concrete = (path: string) => path.replace("[id]", guessedID)
