BEGIN;

CREATE FUNCTION vamotors.guard_commitment_case() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.kind IN ('ADVANCE','LEASE') THEN RAISE EXCEPTION 'RETAINED_SALE_COMMITMENT' USING ERRCODE='23514'; END IF;
    RETURN OLD;
  END IF;
  IF NEW.kind NOT IN ('ADVANCE','LEASE') AND OLD.kind NOT IN ('ADVANCE','LEASE') THEN RETURN NEW; END IF;
  IF NEW.revision::bigint<>OLD.revision::bigint+1
    OR (to_jsonb(NEW)-ARRAY['state','revision','reference','kind'])<>(to_jsonb(OLD)-ARRAY['state','revision','reference','kind'])
    OR (OLD.kind<>NEW.kind AND NOT (OLD.kind='ADVANCE' AND NEW.kind='LEASE'
      AND OLD.state IN ('RESERVED','EXPIRED') AND NEW.state='FINANCE_PENDING'))
    OR (OLD.reference IS DISTINCT FROM NEW.reference AND OLD.kind=NEW.kind)
    OR NOT (CASE OLD.state
      WHEN 'RESERVED' THEN NEW.state IN ('EXPIRED','FINANCE_PENDING','CANCELLED','COMPLETED')
      WHEN 'EXPIRED' THEN NEW.state IN ('FINANCE_PENDING','CANCELLED','COMPLETED')
      WHEN 'FINANCE_PENDING' THEN NEW.state IN ('DO_RECEIVED','CANCELLED')
      WHEN 'DO_RECEIVED' THEN NEW.state IN ('COMPLETED','CANCELLED')
      WHEN 'COMPLETED' THEN NEW.state='COMPLETED' AND NEW.kind='LEASE'
      ELSE false END)
    THEN RAISE EXCEPTION 'INVALID_COMMITMENT_MUTATION' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER commitment_case_guard BEFORE UPDATE OR DELETE ON vamotors."SaleCase"
  FOR EACH ROW EXECUTE FUNCTION vamotors.guard_commitment_case();

DO $$
DECLARE source text; marker text;
BEGIN
  SELECT pg_get_functiondef('vamotors.check_commitment_graph()'::regprocedure) INTO source;
  marker:='IF TG_TABLE_NAME=''SaleCase'' AND (TG_OP=''INSERT'' OR OLD.state IS DISTINCT FROM NEW.state) THEN';
  IF strpos(source,marker)=0 THEN RAISE EXCEPTION 'COMMITMENT_GRAPH_BASE'; END IF;
  source:=replace(source,marker,$patch$
  IF TG_TABLE_NAME='SaleCase' THEN
    IF NOT EXISTS(SELECT FROM vamotors."EntityReadVersion" e JOIN vamotors."CommandReceipt" c ON c.id=e."commandId"
      JOIN vamotors."AuditEntry" a ON a."commandId"=c.id AND a."entityType"='SaleCase' AND a."entityId"=sid
      WHERE e."entityType"='SaleCase' AND e."entityId"=sid AND e.revision=NEW.revision AND e.sequence=c."businessSequence"
        AND c.xmin=pg_current_xact_id()::xid AND e.xmin=pg_current_xact_id()::xid AND a.xmin=pg_current_xact_id()::xid
        AND a.action=c."commandName"
        AND (CASE WHEN a."actorKind"='SYSTEM' THEN 'SYSTEM:RESERVATION_EXPIRY' ELSE 'USER:'||a."userId"::text END)=c."actorKey")
      THEN RAISE EXCEPTION 'MISSING_COMMITMENT_EVIDENCE' USING ERRCODE='23514'; END IF;
    IF TG_OP='INSERT' OR OLD.state IS DISTINCT FROM NEW.state THEN
  $patch$);
  marker:=$patch$THEN RAISE EXCEPTION 'MISSING_COMMITMENT_TRANSITION' USING ERRCODE='23514'; END IF;
  END IF;$patch$;
  source:=replace(source,marker,marker || E'\n  END IF;');
  marker:='SELECT * INTO STRICT p FROM';
  source:=replace(source,marker,$patch$
  IF TG_TABLE_NAME='SaleReceipt' THEN
    IF NOT EXISTS(SELECT FROM vamotors."CommandReceipt" c
      WHERE c.id=NEW."commandId" AND c.xmin=pg_current_xact_id()::xid AND c."actorKey"='USER:'||NEW."createdBy"::text
        AND (CASE NEW.category
          WHEN 'ADVANCE' THEN c."commandName" IN ('placeReservation','reviewApproval')
          WHEN 'BALANCE' THEN c."commandName"='convertReservation'
          WHEN 'DOWN_PAYMENT' THEN c."commandName" IN ('startFinance','reviewApproval')
          WHEN 'LENDER' THEN c."commandName"='recordLenderReceipt'
          WHEN 'REFUND' THEN c."commandName"='reviewApproval' AND EXISTS(
            SELECT FROM vamotors."ApprovalRequest" a WHERE a.kind='REFUND' AND a.state='APPROVED'
              AND a."appliedCommandId"=c.id AND a."saleCaseId"=sid AND a.xmin=pg_current_xact_id()::xid)
          ELSE false END))
      OR NOT vamotors.commitment_changed(s."purchaseRecordId")
      THEN RAISE EXCEPTION 'INVALID_COMMITMENT_RECEIPT_COMMAND' USING ERRCODE='23514'; END IF;
  END IF;
  $patch$||marker);
  EXECUTE source;
END $$;

REVOKE ALL ON FUNCTION vamotors.guard_commitment_case() FROM PUBLIC;
COMMIT;
