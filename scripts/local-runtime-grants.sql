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
GRANT SELECT (id, "sellerCustomerId", "createdBy", "purchaseDate", status, "purchasePrice") ON vamotors."PurchaseRecord" TO vamotors_runtime;
