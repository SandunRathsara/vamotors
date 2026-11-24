BEGIN;
CREATE UNIQUE INDEX "CommissionDiscrepancy_overpayment_allocation_key"
  ON vamotors."CommissionDiscrepancy" ("allocationId") WHERE classification='OVERPAYMENT';

CREATE FUNCTION vamotors.check_reconciliation_resolution() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE d vamotors."CommissionDiscrepancy"; allocation vamotors."CommissionAllocation";
  active_returns numeric;
BEGIN
  IF TG_TABLE_NAME='CommissionDiscrepancy' THEN
    d := NEW;
    IF NOT EXISTS (
      SELECT FROM vamotors."ReconciliationRun" run
      JOIN vamotors."CommandReceipt" c ON c.id=run."commandId"
      JOIN vamotors."AuditEntry" a ON a."commandId"=c.id AND a."entityId"=d."entitlementId"
      WHERE run.id=d."runId" AND c."commandName"='reconcile'
        AND c.xmin=pg_current_xact_id()::xid AND a."entityType"='CommissionEntitlement'
    ) THEN RAISE EXCEPTION 'DISCREPANCY_COMMAND_EVIDENCE_REQUIRED' USING ERRCODE='23514'; END IF;
    IF d.classification='OVERPAYMENT' THEN
      SELECT * INTO STRICT allocation FROM vamotors."CommissionAllocation" WHERE id=d."allocationId";
      IF allocation."reversalOf" IS NOT NULL OR allocation."runId"<>d."runId"
         OR -d."expectedMinusAllocated">allocation.amount
      THEN RAISE EXCEPTION 'INVALID_OVERPAYMENT' USING ERRCODE='23514'; END IF;
    END IF;
  ELSIF TG_TABLE_NAME='RemittancePayment' THEN
    IF NEW."discrepancyId" IS NULL THEN RETURN NULL; END IF;
    SELECT * INTO STRICT d FROM vamotors."CommissionDiscrepancy" WHERE id=NEW."discrepancyId";
    SELECT coalesce(sum(p.amount),0) INTO active_returns FROM vamotors."RemittancePayment" p
      WHERE p."discrepancyId"=d.id AND p.category='REMITTANCE_RETURN'
        AND NOT EXISTS(SELECT FROM vamotors."RemittancePayment" reversal WHERE reversal."reversalOf"=p.id);
    IF d.resolution<>'RETURN_OVERPAYMENT' OR active_returns > -d."expectedMinusAllocated"
       OR (active_returns>0 AND EXISTS(SELECT FROM vamotors."CommissionAllocation" reversal WHERE reversal."reversalOf"=d."allocationId"))
    THEN RAISE EXCEPTION 'RETURN_EXCEEDS_OVERPAYMENT' USING ERRCODE='23514'; END IF;
  ELSIF TG_TABLE_NAME='CommissionAllocation' THEN
    IF NEW."reversalOf" IS NULL THEN RETURN NULL; END IF;
    IF EXISTS(
      SELECT FROM vamotors."CommissionDiscrepancy" d0
      JOIN vamotors."RemittancePayment" p ON p."discrepancyId"=d0.id AND p.category='REMITTANCE_RETURN'
      WHERE d0."allocationId"=NEW."reversalOf"
        AND NOT EXISTS(SELECT FROM vamotors."RemittancePayment" reversal WHERE reversal."reversalOf"=p.id)
    ) THEN RAISE EXCEPTION 'RETURN_REQUIRES_ALLOCATION' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NULL;
END $$;

DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['CommissionDiscrepancy','RemittancePayment','CommissionAllocation'] LOOP
    EXECUTE format('CREATE CONSTRAINT TRIGGER reconciliation_resolution AFTER INSERT ON vamotors.%I
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vamotors.check_reconciliation_resolution()',tbl);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION vamotors.check_reconciliation_resolution() FROM PUBLIC;
COMMIT;
