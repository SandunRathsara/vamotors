BEGIN;

-- Only the historical recordDO command may record a dated order whose original
-- document is missing. Existing attached orders still require an issue date.
ALTER TABLE vamotors."InventoryLease" DROP CONSTRAINT "InventoryLease_check",
  ADD CONSTRAINT "InventoryLease_document_date_check"
    CHECK ("doAttachmentId" IS NULL OR "issueDate" IS NOT NULL);

CREATE FUNCTION vamotors.guard_historical_delivery_order() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW."issueDate" IS NOT NULL AND NEW."doAttachmentId" IS NULL AND (
   TG_OP='INSERT' OR OLD."issueDate" IS DISTINCT FROM NEW."issueDate" OR OLD."doAttachmentId" IS NOT NULL
 ) AND (
   vamotors.command_write_xid()=pg_current_xact_id()::xid OR NOT EXISTS (
     SELECT FROM vamotors."CommandReceipt" c
     WHERE c."commandName"='recordDO' AND c.result->>'id'=NEW."saleCaseId"::text
       AND c.xmin=vamotors.command_write_xid()
   )
 ) THEN RAISE EXCEPTION 'HISTORICAL_DELIVERY_ORDER_REQUIRED' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION vamotors.guard_historical_delivery_order() FROM PUBLIC;
CREATE TRIGGER guard_historical_delivery_order BEFORE INSERT OR UPDATE ON vamotors."InventoryLease"
  FOR EACH ROW EXECUTE FUNCTION vamotors.guard_historical_delivery_order();

DO $$
DECLARE owner regprocedure; source text; marker text;
BEGIN
 FOREACH owner IN ARRAY ARRAY['vamotors.check_commitment_graph()','vamotors.commitment_transition(uuid,text,text)',
  'vamotors.commitment_changed(uuid)']::regprocedure[] LOOP
   source:=pg_get_functiondef(owner);
   IF strpos(source,'pg_current_xact_id()::xid')=0 THEN RAISE EXCEPTION 'HISTORICAL_COMMITMENT_GUARD_BASE'; END IF;
   source:=replace(source,'pg_current_xact_id()::xid','vamotors.command_write_xid()');
   IF owner='vamotors.check_commitment_graph()'::regprocedure THEN
     marker:=$p$s.state IN ('DO_RECEIVED','COMPLETED') AND l."doAttachmentId" IS NULL$p$;
     IF strpos(source,marker)=0 THEN RAISE EXCEPTION 'HISTORICAL_DELIVERY_ORDER_BASE'; END IF;
     source:=replace(source,marker,$p$s.state IN ('DO_RECEIVED','COMPLETED') AND l."issueDate" IS NULL$p$);
     marker:=$p$WHEN 'REFUND' THEN c."commandName"='reviewApproval' AND EXISTS($p$;
     IF strpos(source,marker)=0 THEN RAISE EXCEPTION 'HISTORICAL_REFUND_BASE'; END IF;
     source:=replace(source,marker,$p$WHEN 'REFUND' THEN
       (c."commandName"='cancelRetained' AND vamotors.command_write_xid()<>pg_current_xact_id()::xid AND s.kind='ADVANCE')
       OR c."commandName"='reviewApproval' AND EXISTS($p$);
   END IF;
   EXECUTE source;
 END LOOP;
END $$;

COMMIT;
