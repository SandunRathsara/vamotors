-- Local cluster only. Explicit current-table grants, never future-table defaults.
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA vamotors FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA vamotors FROM vamotors_runtime;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA vamotors FROM PUBLIC;
GRANT USAGE ON SCHEMA vamotors TO vamotors_runtime;
GRANT SELECT, INSERT ON vamotors."user" TO vamotors_runtime;
GRANT UPDATE (name, active, "authzRevision", "updatedAt") ON vamotors."user" TO vamotors_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON vamotors.session TO vamotors_runtime;
GRANT SELECT, INSERT ON vamotors.account TO vamotors_runtime;
GRANT SELECT (singleton, id, name, "allowBusinessWrites", "disposableTest", "bootstrappedAt") ON vamotors."Environment" TO vamotors_runtime;
GRANT EXECUTE ON FUNCTION vamotors.lock_admin_guard() TO vamotors_runtime;
GRANT SELECT, INSERT ON vamotors."Role" TO vamotors_runtime;
GRANT UPDATE (name, active, revision) ON vamotors."Role" TO vamotors_runtime;
GRANT SELECT, INSERT ON vamotors."Permission" TO vamotors_runtime;
GRANT SELECT, INSERT, DELETE ON vamotors."UserRole", vamotors."RolePermission" TO vamotors_runtime;
GRANT SELECT, INSERT ON vamotors."CommandReceipt", vamotors."AuditEntry", vamotors."EntityReadVersion", vamotors."StatusEvent" TO vamotors_runtime;
GRANT SELECT ON vamotors."BusinessSequence" TO vamotors_runtime;
GRANT UPDATE (value) ON vamotors."BusinessSequence" TO vamotors_runtime;
GRANT SELECT, INSERT ON vamotors."Notification" TO vamotors_runtime;
GRANT UPDATE ("readAt", revision) ON vamotors."Notification" TO vamotors_runtime;
GRANT SELECT, INSERT ON vamotors."Customer" TO vamotors_runtime;
GRANT UPDATE ("fullName", "callingName", "nicOrPassport", "normalizedIdentity", address, phone, email, "drivingLicence", notes, active, revision, "updatedAt") ON vamotors."Customer" TO vamotors_runtime;
-- Read-only, exact source columns for independently authorized customer links.
GRANT SELECT (id, "supplierId", "sellerCustomerId", "createdBy", "purchaseDate", status, "purchasePrice") ON vamotors."PurchaseRecord" TO vamotors_runtime;
GRANT SELECT, INSERT ON vamotors."Supplier", vamotors."SupplierContact", vamotors."RepairVendor", vamotors."VendorContact" TO vamotors_runtime;
GRANT UPDATE (name, category, "nicOrRegNumber", address, phone, hotline, notes, recurring, active, revision, "updatedAt") ON vamotors."Supplier" TO vamotors_runtime;
GRANT UPDATE (name, category, "nicOrRegNumber", address, phone, hotline, notes, recurring, specialisation, active, revision, "updatedAt") ON vamotors."RepairVendor" TO vamotors_runtime;
-- Contacts are immutable identities. Replacement only archives; no DELETE or
-- owner/content UPDATE can invalidate historical references.
GRANT UPDATE (active) ON vamotors."SupplierContact", vamotors."VendorContact" TO vamotors_runtime;
GRANT SELECT ON vamotors."Settings", vamotors."SettingsVersion" TO vamotors_runtime;
GRANT INSERT ON vamotors."SettingsVersion" TO vamotors_runtime;
GRANT UPDATE (revision, "currentVersionId") ON vamotors."Settings" TO vamotors_runtime;
-- Currency freeze includes pre-Settings vehicle roots, not a vehicle DTO grant.
GRANT SELECT (id) ON vamotors."Vehicle" TO vamotors_runtime;
GRANT SELECT, INSERT ON vamotors."FinanceCompany", vamotors."FinanceContact", vamotors."FinancePolicyVersion" TO vamotors_runtime;
GRANT UPDATE (name, active, revision, "currentPolicyId", "updatedAt") ON vamotors."FinanceCompany" TO vamotors_runtime;
GRANT UPDATE (active) ON vamotors."FinanceContact" TO vamotors_runtime;
GRANT EXECUTE ON FUNCTION vamotors.valid_finance_policy(jsonb) TO vamotors_runtime;
-- T05a: create complete acquisition graph only. No mutable ownership, lifecycle,
-- financial-history UPDATE, DELETE, DDL, or future-table/default privileges.
GRANT SELECT (id, "engineNumber", "chassisNumber", "normalizedEngine", "normalizedChassis", make, model, year, colour, "fuelType", transmission, vin, "crNumber", notes, revision, "createdBy", "createdAt", "updatedAt", "activePurchaseId") ON vamotors."Vehicle" TO vamotors_runtime;
GRANT SELECT (id, "vehicleId", "cycleNumber", "purchaseType", "acquisitionKind", "supplierId", "sellerCustomerId", "purchaseDate", "purchasePrice", "listedPrice", status, available, "holdReason", "receivedDate", "closedAt", revision, "createdBy", "createdAt", "updatedAt", "acquisitionCommandId", "settingsVersionId") ON vamotors."PurchaseRecord" TO vamotors_runtime;
GRANT SELECT (id, "cycleId", amount, direction, category, "occurredDate", method, currency, scale, reference, "reversalOf", reason, "commandId", "lineKey", "recordedAt") ON vamotors."PurchasePayment" TO vamotors_runtime;
GRANT SELECT (id, "vehicleId", "cycleId", reading, "recordedDate", remark, "decreaseReason", "commandId", "recordedAt") ON vamotors."MileageReading" TO vamotors_runtime;
GRANT SELECT (id, "cycleId", version, purchase, components, total, currency, scale, reason, "commandId", "recordedAt", "supersedesId") ON vamotors."CycleBasisVersion" TO vamotors_runtime;
GRANT SELECT ("sourceType", "sourceId", "paymentId", date, direction, amount, method, category, "commandId") ON vamotors."CashMovement" TO vamotors_runtime;
GRANT INSERT (id, "engineNumber", "chassisNumber", "normalizedEngine", "normalizedChassis", make, model, year, colour, "fuelType", transmission, vin, "crNumber", notes, revision, "createdBy", "createdAt", "updatedAt", "activePurchaseId") ON vamotors."Vehicle" TO vamotors_runtime;
GRANT INSERT (id, "vehicleId", "cycleNumber", "purchaseType", "acquisitionKind", "supplierId", "purchaseDate", "purchasePrice", "listedPrice", status, available, revision, "createdBy", "createdAt", "updatedAt", "acquisitionCommandId", "settingsVersionId") ON vamotors."PurchaseRecord" TO vamotors_runtime;
GRANT INSERT (id, "cycleId", amount, direction, category, "occurredDate", method, currency, scale, "commandId", "lineKey", "recordedAt") ON vamotors."PurchasePayment" TO vamotors_runtime;
GRANT INSERT (id, "vehicleId", "cycleId", reading, "recordedDate", remark, "decreaseReason", "commandId", "recordedAt") ON vamotors."MileageReading" TO vamotors_runtime;
GRANT INSERT (id, "cycleId", version, purchase, components, total, currency, scale, reason, "commandId", "recordedAt") ON vamotors."CycleBasisVersion" TO vamotors_runtime;
-- T05b: command-evidenced stock state only; identity, provenance and money stay immutable.
GRANT UPDATE (status, available, "holdReason", "receivedDate", revision, "updatedAt") ON vamotors."PurchaseRecord" TO vamotors_runtime;
-- T11a immutable published cards and quote candidates only; never update/delete.
GRANT SELECT, INSERT ON vamotors."RateSheetVersion", vamotors."RateCardEntry", vamotors."Quote" TO vamotors_runtime;
-- T05c: bounded current terms and costs only; source money/basis remain append-only.
GRANT SELECT (notes) ON vamotors."PurchaseRecord" TO vamotors_runtime;
GRANT UPDATE ("purchaseDate", "purchasePrice", notes) ON vamotors."PurchaseRecord" TO vamotors_runtime;
GRANT INSERT (reference, "reversalOf", reason) ON vamotors."PurchasePayment" TO vamotors_runtime;
GRANT INSERT ("supersedesId") ON vamotors."CycleBasisVersion" TO vamotors_runtime;
GRANT SELECT, INSERT ON vamotors."VehicleCost", vamotors."CostPayment" TO vamotors_runtime;
GRANT UPDATE (category, description, amount, "incurredDate", revision, "updatedAt") ON vamotors."VehicleCost" TO vamotors_runtime;
-- T06b typed staging only. Retained claims/files/events are append-only.
GRANT SELECT, INSERT ON vamotors."ImportBatch", vamotors."UploadIntent", vamotors."UploadAttempt", vamotors."Attachment", vamotors."UploadEvent" TO vamotors_runtime;
GRANT UPDATE (revision) ON vamotors."ImportBatch" TO vamotors_runtime;
GRANT UPDATE (revision, state, "currentAttemptId", "claimExpiresAt") ON vamotors."UploadIntent" TO vamotors_runtime;
-- T05c.1: exact current physical/asking columns; append-only mileage stays INSERT only.
GRANT UPDATE ("engineNumber", "chassisNumber", "normalizedEngine", "normalizedChassis", make, model, year, colour, "fuelType", transmission, vin, "crNumber", notes, revision, "updatedAt") ON vamotors."Vehicle" TO vamotors_runtime;
GRANT UPDATE ("listedPrice") ON vamotors."PurchaseRecord" TO vamotors_runtime;
-- T05c.2: current supplier/channel/settlement terms, never source-kind/owner/history.
GRANT UPDATE ("purchaseType", "supplierId") ON vamotors."PurchaseRecord" TO vamotors_runtime;
GRANT SELECT, INSERT ON vamotors."LeasePurchaseDetail" TO vamotors_runtime;
GRANT UPDATE ("institutionType", "companyId", "institutionNameSnapshot", reference, amount, "cashToSeller") ON vamotors."LeasePurchaseDetail" TO vamotors_runtime;
