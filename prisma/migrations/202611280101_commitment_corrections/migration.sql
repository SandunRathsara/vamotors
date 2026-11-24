BEGIN;
SELECT value FROM vamotors."BusinessSequence" WHERE id=1 FOR UPDATE;
SELECT vamotors.lock_admin_guard();

-- Keep originals and their replacements. Unreversed cardinality is checked by
-- the deferred graph after the case and all payment facts have been written.
DROP INDEX vamotors.sale_deposit_and_resolution_once;
DO $$
DECLARE guard_name text;
BEGIN
  SELECT conname INTO STRICT guard_name FROM pg_constraint
  WHERE conrelid='vamotors."SaleReceipt"'::regclass AND contype='c'
    AND pg_get_constraintdef(oid) LIKE '%"refundOf" IS NOT NULL%';
  EXECUTE format('ALTER TABLE vamotors."SaleReceipt" DROP CONSTRAINT %I', guard_name);
END $$;
ALTER TABLE vamotors."SaleReceipt" ADD CONSTRAINT commitment_receipt_direction CHECK (
  (category='REFUND')=("refundOf" IS NOT NULL) AND
  CASE WHEN category='SALE' THEN true
       WHEN category='REFUND' THEN "reversalOf" IS NULL AND direction='OUT'
       ELSE direction=CASE WHEN "reversalOf" IS NULL THEN 'IN' ELSE 'OUT' END END);
GRANT UPDATE (down,"termMonths") ON vamotors."InventoryLease" TO vamotors_runtime;

-- Resolve the exact review applied to this case in the current transaction.
CREATE FUNCTION vamotors.commitment_review(sid uuid, operation text)
RETURNS vamotors."ApprovalRequest" LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp AS $$
 SELECT a FROM vamotors."ApprovalRequest" a JOIN vamotors."CommandReceipt" c ON c.id=a."appliedCommandId"
 WHERE a."saleCaseId"=sid AND a.kind='SALE_EDIT' AND a.state='APPROVED'
   AND a.proposal->>'operation'=operation AND a."reviewedBy"<>a."requestedBy"
   AND c."commandName"='reviewApproval' AND c."actorKey"='USER:'||a."reviewedBy"::text
   AND a.xmin=pg_current_xact_id()::xid AND c.xmin=pg_current_xact_id()::xid
$$;

CREATE FUNCTION vamotors.check_commitment_correction() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a vamotors."ApprovalRequest"; s vamotors."SaleCase"; old_revision int; prior vamotors."SaleCorrection";
BEGIN
 SELECT * INTO s FROM vamotors."SaleCase" WHERE id=NEW."saleCaseId";
 IF s.kind NOT IN ('ADVANCE','LEASE') THEN RETURN NULL; END IF;
 SELECT * INTO a FROM vamotors.commitment_review(s.id,'EDIT_COMPLETION');
 SELECT * INTO prior FROM vamotors."SaleCorrection"
   WHERE "completionId"=NEW."completionId" AND version<NEW.version ORDER BY version DESC LIMIT 1;
 SELECT (ref->>'revision')::int INTO old_revision FROM jsonb_array_elements(a.expected) ref
   WHERE ref->>'type'='SaleCase' AND ref->>'id'=s.id::text;
 IF a.id IS NULL OR NEW."approvalId"<>a.id OR NEW."commandId"<>a."appliedCommandId"
   OR NEW."createdBy"<>a."reviewedBy" OR NEW.patch IS DISTINCT FROM a.proposal#>'{input,patch}'
   OR NEW.reason IS DISTINCT FROM a.proposal#>>'{input,reason}'
   OR NEW.version<>coalesce(prior.version,0)+1 OR NEW."priorVersionId" IS DISTINCT FROM prior.id
   OR NEW."restatedProfit" IS DISTINCT FROM s."agreedPrice"-
      (SELECT total FROM vamotors."CycleBasisVersion" WHERE "cycleId"=s."purchaseRecordId" ORDER BY version DESC LIMIT 1)
   OR NEW."basisVersionId" IS DISTINCT FROM
      (SELECT id FROM vamotors."CycleBasisVersion" WHERE "cycleId"=s."purchaseRecordId" ORDER BY version DESC LIMIT 1)
   OR s.revision IS DISTINCT FROM old_revision+1
   OR NOT EXISTS(SELECT FROM vamotors."SaleCase" WHERE id=s.id AND xmin=pg_current_xact_id()::xid)
 THEN RAISE EXCEPTION 'INVALID_COMMITMENT_CORRECTION' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER commitment_correction_graph AFTER INSERT ON vamotors."SaleCorrection"
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vamotors.check_commitment_correction();

CREATE FUNCTION vamotors.guard_lease_correction() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a vamotors."ApprovalRequest"; patch jsonb;
BEGIN
 IF to_jsonb(NEW)=to_jsonb(OLD) THEN RETURN NEW; END IF;
 IF NEW.down=OLD.down AND NEW."termMonths"=OLD."termMonths"
   AND EXISTS(SELECT FROM vamotors."SaleCase" WHERE id=NEW."saleCaseId" AND state='FINANCE_PENDING')
 THEN RETURN NEW; END IF;
 SELECT * INTO a FROM vamotors.commitment_review(NEW."saleCaseId",'EDIT_COMPLETION');
 patch:=a.proposal#>'{input,patch,finance}';
 IF patch IS NULL OR (to_jsonb(NEW)-ARRAY['down','termMonths','issueDate'])<>(to_jsonb(OLD)-ARRAY['down','termMonths','issueDate'])
   OR NEW.down IS DISTINCT FROM (patch->>'downPayment')::bigint
   OR NEW."termMonths" IS DISTINCT FROM (patch->>'termMonths')::int
   OR NEW."issueDate" IS DISTINCT FROM (patch->>'doIssueDate')::date
 THEN RAISE EXCEPTION 'INVALID_LEASE_CORRECTION' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER lease_correction_guard BEFORE UPDATE ON vamotors."InventoryLease"
 FOR EACH ROW EXECUTE FUNCTION vamotors.guard_lease_correction();

CREATE FUNCTION vamotors.commitment_review_receipt(receipt vamotors."SaleReceipt")
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a vamotors."ApprovalRequest"; original vamotors."SaleReceipt"; correction jsonb; ordinal bigint;
BEGIN
 IF receipt.category NOT IN ('ADVANCE','BALANCE','DOWN_PAYMENT','LENDER') THEN RETURN false; END IF;
 SELECT * INTO a FROM vamotors.commitment_review(receipt."saleCaseId",'CANCEL_FINANCE_ERROR');
 IF a.id IS NOT NULL AND receipt."commandId"=a."appliedCommandId" THEN
   IF receipt.category<>'DOWN_PAYMENT' OR receipt."reversalOf" IS NULL
     OR NOT (a.proposal#>'{input,receiptReversals}' ? receipt."reversalOf"::text)
     OR receipt.reason IS DISTINCT FROM a.proposal#>>'{input,reason}' THEN RETURN false; END IF;
   SELECT * INTO original FROM vamotors."SaleReceipt" WHERE id=receipt."reversalOf";
 ELSE
   SELECT * INTO a FROM vamotors.commitment_review(receipt."saleCaseId",'EDIT_COMPLETION');
   IF a.id IS NULL OR receipt."commandId"<>a."appliedCommandId" THEN RETURN false; END IF;
   SELECT item, ordinality INTO correction, ordinal
   FROM jsonb_array_elements(a.proposal#>'{input,cashCorrections}') WITH ORDINALITY AS p(item, ordinality)
   WHERE (receipt."reversalOf" IS NOT NULL AND item->>'paymentId'=receipt."reversalOf"::text AND receipt."lineKey"='rev:'||(ordinality-1))
      OR (receipt."reversalOf" IS NULL AND receipt."lineKey"='rep:'||(ordinality-1));
   IF correction IS NULL THEN RETURN false; END IF;
   SELECT * INTO original FROM vamotors."SaleReceipt" WHERE id=(correction->>'paymentId')::uuid;
   IF receipt."reversalOf" IS NULL THEN
     RETURN original."saleCaseId"=receipt."saleCaseId" AND original."reversalOf" IS NULL
       AND original.direction='IN' AND original.category=receipt.category
       AND original.currency=receipt.currency AND original.scale=receipt.scale
       AND receipt.direction='IN'
       AND receipt.amount=(correction#>>'{replacement,amount}')::bigint
       AND receipt."occurredDate"=(correction#>>'{replacement,date}')::date
       AND receipt.method=correction#>>'{replacement,method}'
       AND receipt.reference IS NOT DISTINCT FROM correction#>>'{replacement,reference}'
       AND EXISTS(SELECT FROM vamotors."SaleReceipt" r WHERE r."reversalOf"=original.id AND r."commandId"=receipt."commandId");
   END IF;
   IF receipt.reason IS DISTINCT FROM correction->>'reason' THEN RETURN false; END IF;
 END IF;
 RETURN original.id IS NOT NULL AND original."saleCaseId"=receipt."saleCaseId"
   AND original."reversalOf" IS NULL AND original.direction='IN' AND receipt.direction='OUT'
   AND original.category=receipt.category AND original.amount=receipt.amount
   AND original."occurredDate"=receipt."occurredDate" AND original.method=receipt.method
   AND original.currency=receipt.currency AND original.scale=receipt.scale
   AND original.reference IS NOT DISTINCT FROM receipt.reference;
END $$;

DO $$
DECLARE source text; marker text;
BEGIN
 SELECT pg_get_functiondef('vamotors.guard_commitment_case()'::regprocedure) INTO source;
 marker:='IF NEW.revision::bigint<>OLD.revision::bigint+1';
 IF strpos(source,marker)=0 THEN RAISE EXCEPTION 'COMMITMENT_CASE_BASE'; END IF;
 source:=replace(source,marker,$patch$
 IF OLD.state='COMPLETED' AND NEW.state='COMPLETED' AND NEW.revision::bigint=OLD.revision::bigint+1
   AND (to_jsonb(NEW)-ARRAY['revision','customerId','agreedPrice','reference','notes'])=
       (to_jsonb(OLD)-ARRAY['revision','customerId','agreedPrice','reference','notes'])
   AND EXISTS(SELECT FROM vamotors.commitment_review(NEW.id,'EDIT_COMPLETION') a
     WHERE a.id IS NOT NULL AND EXISTS(SELECT FROM jsonb_array_elements(a.expected) ref
       WHERE ref->>'type'='SaleCase' AND ref->>'id'=OLD.id::text AND ref->>'revision'=OLD.revision::text)
     AND NEW."customerId"=coalesce((a.proposal#>>'{input,patch,customerId}')::uuid,OLD."customerId")
     AND NEW."agreedPrice"=coalesce((a.proposal#>>'{input,patch,price}')::bigint,OLD."agreedPrice")
     AND NEW.reference IS NOT DISTINCT FROM CASE WHEN a.proposal#>'{input,patch}' ? 'reference' THEN a.proposal#>>'{input,patch,reference}' ELSE OLD.reference END
     AND NEW.notes IS NOT DISTINCT FROM CASE WHEN a.proposal#>'{input,patch}' ? 'notes' THEN a.proposal#>>'{input,patch,notes}' ELSE OLD.notes END)
 THEN RETURN NEW; END IF;
 $patch$||marker);
 EXECUTE source;

 SELECT pg_get_functiondef('vamotors.check_commitment_graph()'::regprocedure) INTO source;
 marker:='AND (CASE NEW.category';
 IF strpos(source,marker)=0 THEN RAISE EXCEPTION 'COMMITMENT_RECEIPT_BASE'; END IF;
 source:=replace(source,marker,$patch$
   AND (coalesce(vamotors.commitment_review_receipt(NEW),false) OR
     (NEW."reversalOf" IS NULL AND (CASE NEW.category
 $patch$);
 source:=replace(source,'ELSE false END))','ELSE false END))))');
 -- Only approve opening paths for original receipts. Subsequent facts need a
 -- matching correction or the existing lender/refund command evidence.
 source:=replace(source,'SELECT * INTO a FROM vamotors."SaleReceipt" WHERE "saleCaseId"=sid AND category=''ADVANCE'';',
   $patch$SELECT * INTO a FROM vamotors."SaleReceipt" x WHERE "saleCaseId"=sid AND category='ADVANCE'
      AND x."reversalOf" IS NULL AND NOT EXISTS(SELECT FROM vamotors."SaleReceipt" rev WHERE rev."reversalOf"=x.id);$patch$);
 source:=replace(source,'SELECT * INTO d FROM vamotors."SaleReceipt" WHERE "saleCaseId"=sid AND category=''DOWN_PAYMENT'';',
   $patch$SELECT * INTO d FROM vamotors."SaleReceipt" x WHERE "saleCaseId"=sid AND category='DOWN_PAYMENT'
      AND x."reversalOf" IS NULL AND NOT EXISTS(SELECT FROM vamotors."SaleReceipt" rev WHERE rev."reversalOf"=x.id);$patch$);
 FOREACH marker IN ARRAY ARRAY['ADVANCE','BALANCE','DOWN_PAYMENT','LENDER'] LOOP
   source:=replace(source,'sum(amount) FILTER (WHERE category='||quote_literal(marker)||')',
     'sum(CASE direction WHEN ''IN'' THEN amount ELSE -amount END) FILTER (WHERE category='||quote_literal(marker)||')');
 END LOOP;
 source:=replace(source,'(s."listedSnapshot">s."agreedPrice" AND s."approvalId" IS NULL)',
   '(s."listedSnapshot">coalesce(f."agreedPrice",s."agreedPrice") AND s."approvalId" IS NULL)');
 source:=replace(source,'OR advance_paid<>coalesce(r.amount,0)',$patch$
   OR EXISTS(SELECT FROM vamotors."SaleReceipt" x WHERE x."saleCaseId"=sid AND x.category IN ('ADVANCE','BALANCE','DOWN_PAYMENT')
      AND x."reversalOf" IS NULL AND NOT EXISTS(SELECT FROM vamotors."SaleReceipt" rev WHERE rev."reversalOf"=x.id)
      GROUP BY x.category HAVING count(*)>1)
   OR advance_paid<>coalesce(r.amount,0)
 $patch$);
 source:=replace(source,'OR l.down<>down_paid',$patch$
   OR (l.down<>down_paid AND NOT (s.state='CANCELLED' AND r.id IS NULL AND down_paid=0
      AND EXISTS(SELECT FROM vamotors."SaleReceipt" x JOIN vamotors."ApprovalRequest" ap ON ap."appliedCommandId"=x."commandId"
        WHERE x."saleCaseId"=sid AND x.category='DOWN_PAYMENT' AND x."reversalOf" IS NOT NULL
          AND ap."saleCaseId"=sid AND ap.kind='SALE_EDIT' AND ap.proposal->>'operation'='CANCEL_FINANCE_ERROR')))
 $patch$);
 marker:='IF f.id IS NOT NULL AND (f."agreedPrice"<>s."agreedPrice"';
 IF strpos(source,marker)=0 THEN RAISE EXCEPTION 'COMMITMENT_COMPLETION_BASE'; END IF;
 source:=replace(source,marker,$patch$
 IF f.id IS NOT NULL AND (
     coalesce((SELECT (sc."correctedSnapshot"->>'agreedPrice')::bigint FROM vamotors."SaleCorrection" sc
         WHERE sc."completionId"=f.id ORDER BY sc.version DESC LIMIT 1),f."agreedPrice")<>s."agreedPrice"
 $patch$);
 source:=replace(source,'f."originalProfit"::numeric=s."agreedPrice"::numeric-b.total','f."originalProfit"::numeric=f."agreedPrice"::numeric-b.total');
 source:=replace(source,'IF TG_TABLE_NAME=''SaleCase'' THEN
    IF NOT EXISTS',$patch$IF TG_TABLE_NAME='SaleCase' THEN
    IF TG_OP='UPDATE' AND OLD.state='COMPLETED' AND EXISTS(SELECT FROM vamotors.commitment_review(sid,'EDIT_COMPLETION') ap WHERE ap.id IS NOT NULL)
      AND NOT EXISTS(SELECT FROM vamotors."SaleCorrection" sc WHERE sc."saleCaseId"=sid AND sc.xmin=pg_current_xact_id()::xid)
    THEN RAISE EXCEPTION 'COMMITMENT_CORRECTION_REQUIRED' USING ERRCODE='23514'; END IF;
    IF NOT EXISTS$patch$);
 EXECUTE source;

 SELECT pg_get_functiondef('vamotors.approval_origin(uuid,vamotors."ApprovalRequest",vamotors."PurchaseRecord",vamotors."Vehicle",boolean)'::regprocedure) INTO source;
 marker:='sale_data := to_jsonb(sale_row);';
 IF strpos(source,marker)=0 THEN RAISE EXCEPTION 'SALE_EDIT_AUTHORITY_BASE'; END IF;
 source:=replace(source,marker,marker||$patch$
    IF a.proposal->>'operation'='CANCEL_FINANCE_ERROR' THEN
      RETURN vamotors.approval_fields(uid,'SaleCase','read',sale_data,
        ARRAY['id','revision','state','payments.id','payments.amount','payments.direction','payments.date','payments.method','payments.category','payments.reversalOf'])
        AND vamotors.approval_fields(uid,'SaleCase','update',sale_data,ARRAY['cancelFinanceError']);
    END IF;
 $patch$);
 EXECUTE source;

 SELECT pg_get_functiondef('vamotors.check_approval_graph()'::regprocedure) INTO source;
 marker:='ELSIF a.kind = ''SALE_EDIT'' THEN';
 IF strpos(source,marker)=0 THEN RAISE EXCEPTION 'SALE_EDIT_APPROVAL_BASE'; END IF;
 source:=replace(source,marker,$patch$
 ELSIF a.kind='SALE_EDIT' AND a.proposal->>'operation'='CANCEL_FINANCE_ERROR' THEN
   i:=a.proposal->'input';
   SELECT * INTO s FROM vamotors."SaleCase" WHERE id=a."saleCaseId" AND "purchaseRecordId"=p.id;
   IF s.id IS NULL OR s.kind<>'LEASE' OR a.proposal->>'kind' IS DISTINCT FROM 'SALE_EDIT'
      OR i->>'saleCaseId' IS DISTINCT FROM s.id::text
      OR (a.state='APPROVED' AND s.state<>'CANCELLED')
      OR (a.state<>'APPROVED' AND s.state NOT IN ('FINANCE_PENDING','DO_RECEIVED'))
      OR EXISTS(SELECT FROM vamotors."Reservation" r WHERE r."saleCaseId"=s.id)
      OR EXISTS(SELECT FROM vamotors."SaleCompletion" f WHERE f."saleCaseId"=s.id)
      OR EXISTS(SELECT FROM vamotors."CommissionEntitlement" e WHERE e."saleCaseId"=s.id)
      OR jsonb_typeof(i->'receiptReversals') IS DISTINCT FROM 'array'
      OR jsonb_array_length(i->'receiptReversals')<>1
      OR i#>>'{disposition,kind}' IS NULL OR i#>>'{disposition,kind}' NOT IN ('RELEASE','HOLD')
      OR NOT EXISTS(SELECT FROM vamotors."SaleReceipt" r WHERE r.id::text=i#>>'{receiptReversals,0}'
        AND r."saleCaseId"=s.id AND r.category='DOWN_PAYMENT' AND r."reversalOf" IS NULL AND r.direction='IN')
   THEN RAISE EXCEPTION 'INVALID_FINANCE_ERROR_PROPOSAL' USING ERRCODE='23514'; END IF;
 $patch$||marker);
 source:=replace(source,$patch$OR (a.kind = 'SALE_EDIT' AND p.status <> 'SOLD')$patch$,$patch$
   OR (a.kind='SALE_EDIT' AND p.status::text NOT IN (
     CASE WHEN a.proposal->>'operation'='CANCEL_FINANCE_ERROR' THEN 'FINANCE_PENDING' ELSE 'SOLD' END,
     CASE WHEN a.proposal->>'operation'='CANCEL_FINANCE_ERROR' THEN 'DO_RECEIVED' ELSE 'SOLD' END))
 $patch$);
 source:=replace(source,$patch$'proposal.input.cashCorrections',$patch$,$patch$
   'proposal.input.cashCorrections','proposal.input.patch.finance','proposal.input.receiptReversals',
 $patch$);
 marker:='ELSIF a.kind = ''SALE_EDIT'' AND NOT EXISTS';
 IF strpos(source,marker)=0 THEN RAISE EXCEPTION 'SALE_EDIT_APPLICATION_BASE'; END IF;
 source:=replace(source,marker,$patch$
 ELSIF a.kind='SALE_EDIT' AND a.proposal->>'operation'='CANCEL_FINANCE_ERROR' THEN
   IF p.status<>'IN_STOCK' OR p.available IS DISTINCT FROM (i#>>'{disposition,kind}'='RELEASE')
      OR p."holdReason" IS DISTINCT FROM i#>>'{disposition,reason}'
      OR NOT EXISTS(SELECT FROM vamotors."SaleReceipt" r WHERE r."commandId"=c.id AND r."saleCaseId"=s.id
        AND r."reversalOf"::text=i#>>'{receiptReversals,0}' AND r.xmin=pg_current_xact_id()::xid)
   THEN RAISE EXCEPTION 'FINANCE_ERROR_REVERSAL_REQUIRED' USING ERRCODE='23514'; END IF;
 $patch$||marker);
 EXECUTE source;
END $$;

REVOKE ALL ON FUNCTION vamotors.commitment_review(uuid,text),
  vamotors.check_commitment_correction(), vamotors.guard_lease_correction(),
  vamotors.commitment_review_receipt(vamotors."SaleReceipt") FROM PUBLIC;
COMMIT;
