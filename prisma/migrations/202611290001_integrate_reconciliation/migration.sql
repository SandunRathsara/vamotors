BEGIN;

-- Grant the same narrow reconciliation access on both first install and upgrade.
GRANT SELECT, INSERT ON vamotors."Remittance", vamotors."RemittancePayment", vamotors."NoticeLine",
  vamotors."ReconciliationRun", vamotors."CommissionAllocation", vamotors."CommissionDiscrepancy" TO vamotors_runtime;
GRANT UPDATE (revision, state, "noticeAttachmentId") ON vamotors."Remittance" TO vamotors_runtime;
GRANT UPDATE (revision, state, "updatedAt") ON vamotors."CommissionEntitlement" TO vamotors_runtime;
GRANT UPDATE ("reconciliationWatermark") ON vamotors."FinanceCompany" TO vamotors_runtime;
GRANT SELECT ("remittanceId"), INSERT ("remittanceId") ON vamotors."Attachment", vamotors."UploadIntent" TO vamotors_runtime;
REVOKE ALL ON FUNCTION vamotors.check_remittance_ledger(), vamotors.check_reconciliation_resolution() FROM PUBLIC;

COMMIT;
