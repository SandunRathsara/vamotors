BEGIN;
SELECT value FROM vamotors."BusinessSequence" WHERE id=1 FOR UPDATE;

-- Retain pre-T13 cash facts. Backfill only the status of existing lease entitlements.
UPDATE vamotors."CommissionEntitlement" e
SET state = CASE WHEN paid.amount = l.principal + e."expectedAmount" THEN 'SETTLED' ELSE 'PARTIAL' END
FROM vamotors."InventoryLease" l
JOIN (
  SELECT "saleCaseId", sum(CASE direction WHEN 'IN' THEN amount ELSE -amount END) AS amount
  FROM vamotors."SaleReceipt" WHERE category = 'LENDER' GROUP BY "saleCaseId"
) paid ON paid."saleCaseId"=l."saleCaseId"
WHERE e."saleCaseId"=l."saleCaseId" AND e.state='OPEN' AND paid.amount>0;

-- Backstop the runtime's serialized accounting and append-only cash evidence.
CREATE FUNCTION vamotors.check_remittance_ledger() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE
  rid uuid;
  r vamotors."Remittance";
  receipt vamotors."RemittancePayment";
  original vamotors."RemittancePayment";
  original_allocation vamotors."CommissionAllocation";
  booked numeric;
  credit numeric;
  receipt_reversed boolean;
  command_id uuid;
  expected_command text;
BEGIN
  rid := CASE TG_TABLE_NAME WHEN 'Remittance' THEN (to_jsonb(NEW)->>'id')::uuid
         ELSE (to_jsonb(NEW)->>'remittanceId')::uuid END;
  IF rid IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO STRICT r FROM vamotors."Remittance" WHERE id=rid;
  SELECT * INTO receipt FROM vamotors."RemittancePayment"
    WHERE "remittanceId"=rid AND category='REMITTANCE_RECEIPT';
  SELECT EXISTS(SELECT FROM vamotors."RemittancePayment" WHERE "reversalOf"=receipt.id) INTO receipt_reversed;

  IF ((r.state='STAGED') <> (receipt.id IS NULL))
     OR ((r.state='REVERSED') <> receipt_reversed)
     OR (receipt.id IS NOT NULL AND receipt.reference<>r.reference)
     OR (r.state='STAGED' AND r."noticeAttachmentId" IS NOT NULL)
     OR (r.state<>'STAGED' AND r.method='PERIOD_NOTICE' AND r."noticeAttachmentId" IS NULL)
     OR (r."noticeAttachmentId" IS NOT NULL AND NOT EXISTS (
         SELECT FROM vamotors."Attachment" WHERE id=r."noticeAttachmentId"
           AND "remittanceId"=rid AND purpose='RECONCILIATION_NOTICE'
     )) THEN RAISE EXCEPTION 'INVALID_REMITTANCE_STATE' USING ERRCODE='23514'; END IF;

  IF TG_TABLE_NAME='RemittancePayment' THEN
    command_id := NEW."commandId";
    expected_command := CASE NEW.category
      WHEN 'REMITTANCE_RECEIPT' THEN 'recordRemittance'
      WHEN 'REMITTANCE_RETURN' THEN 'returnRemittanceOverpayment'
      ELSE 'reversePayment' END;
    IF NEW."reversalOf" IS NOT NULL THEN
      SELECT * INTO STRICT original FROM vamotors."RemittancePayment" WHERE id=NEW."reversalOf";
      IF original."remittanceId"<>rid OR original."reversalOf" IS NOT NULL
         OR original.amount<>NEW.amount OR original.direction=NEW.direction
         OR original."discrepancyId" IS DISTINCT FROM NEW."discrepancyId"
         OR original.reference<>NEW.reference OR original."occurredDate">NEW."occurredDate"
      THEN RAISE EXCEPTION 'INVALID_REMITTANCE_REVERSAL' USING ERRCODE='23514'; END IF;
    END IF;
    IF NEW."occurredDate"<receipt."occurredDate" THEN RAISE EXCEPTION 'INVALID_REMITTANCE_DATE' USING ERRCODE='23514'; END IF;
  ELSIF TG_TABLE_NAME='CommissionAllocation' THEN
    command_id := NEW."commandId";
    expected_command := CASE WHEN NEW."reversalOf" IS NULL THEN 'reconcile' ELSE 'reverseAllocation' END;
    IF NEW."reversalOf" IS NOT NULL THEN
      SELECT * INTO STRICT original_allocation FROM vamotors."CommissionAllocation" WHERE id=NEW."reversalOf";
      IF original_allocation."remittanceId"<>rid OR original_allocation."entitlementId"<>NEW."entitlementId"
         OR original_allocation."reversalOf" IS NOT NULL OR original_allocation.amount<>NEW.amount
         OR original_allocation."noticeLineId" IS DISTINCT FROM NEW."noticeLineId"
      THEN RAISE EXCEPTION 'INVALID_ALLOCATION_REVERSAL' USING ERRCODE='23514'; END IF;
    END IF;
    IF NEW."reversalOf" IS NULL AND (r.state<>'RECEIVED'
       OR (r.method='PERIOD_NOTICE' AND NEW."noticeLineId" IS NULL)
       OR EXISTS (
         SELECT FROM vamotors."CommissionEntitlement" e
         JOIN vamotors."ReconciliationRun" run ON run.id=NEW."runId"
         LEFT JOIN vamotors."NoticeLine" l ON l.id=NEW."noticeLineId"
         WHERE e.id=NEW."entitlementId" AND (
           receipt."occurredDate" NOT BETWEEN e."sentDate" AND run."asOfDate"
           OR (l."sourceType" IS NOT NULL AND (l."sourceType"<>e."sourceType"
             OR l."sourceId"<>coalesce(e."saleCaseId",e."brokerageDealId")))
         )
       )) THEN RAISE EXCEPTION 'INVALID_ALLOCATION_SOURCE' USING ERRCODE='23514'; END IF;
  ELSIF TG_TABLE_NAME='NoticeLine' THEN
    command_id := receipt."commandId";
    expected_command := 'recordRemittance';
  END IF;

  IF (TG_TABLE_NAME IN ('RemittancePayment','NoticeLine','CommissionAllocation') OR command_id IS NOT NULL)
     AND NOT EXISTS (
       SELECT FROM vamotors."CommandReceipt" c JOIN vamotors."AuditEntry" a ON a."commandId"=c.id
       WHERE c.id=command_id AND c."commandName"=expected_command AND c."businessSequence" IS NOT NULL
         AND c.xmin=pg_current_xact_id()::xid AND a."entityType"='Remittance' AND a."entityId"=rid
     ) THEN RAISE EXCEPTION 'REMITTANCE_COMMAND_EVIDENCE_REQUIRED' USING ERRCODE='23514'; END IF;

  SELECT coalesce(sum(a.amount),0) INTO booked
  FROM vamotors."CommissionAllocation" a
  WHERE a."remittanceId"=rid AND a."reversalOf" IS NULL
    AND NOT EXISTS (SELECT FROM vamotors."CommissionAllocation" rv WHERE rv."reversalOf"=a.id);
  SELECT coalesce(sum(-d."expectedMinusAllocated"),0) INTO credit
  FROM vamotors."CommissionDiscrepancy" d
  WHERE d."remittanceId"=rid AND d.resolution='CARRY_CREDIT'
    AND NOT EXISTS (SELECT FROM vamotors."CommissionAllocation" rv WHERE rv."reversalOf"=d."allocationId");
  IF (r.state<>'RECEIVED' AND booked<>0) OR booked-credit NOT BETWEEN 0 AND coalesce(receipt.amount,0)
     OR EXISTS (
       SELECT FROM vamotors."NoticeLine" l JOIN vamotors."CommissionAllocation" a ON a."noticeLineId"=l.id
       WHERE l."remittanceId"=rid AND a."reversalOf" IS NULL
         AND NOT EXISTS(SELECT FROM vamotors."CommissionAllocation" rv WHERE rv."reversalOf"=a.id)
       GROUP BY l.id HAVING sum(a.amount)>l.amount
     ) THEN RAISE EXCEPTION 'REMITTANCE_BALANCE_MISMATCH' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER remittance_ledger AFTER INSERT OR UPDATE ON vamotors."Remittance"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vamotors.check_remittance_ledger();
DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['RemittancePayment','NoticeLine','CommissionAllocation','CommissionDiscrepancy'] LOOP
    EXECUTE format('CREATE CONSTRAINT TRIGGER remittance_ledger AFTER INSERT ON vamotors.%I
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vamotors.check_remittance_ledger()',tbl);
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION vamotors.check_remittance_ledger() FROM PUBLIC;
COMMIT;
