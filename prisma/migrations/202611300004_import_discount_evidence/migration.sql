BEGIN;
ALTER TABLE vamotors."SaleCase" ADD COLUMN "legacyApproval" jsonb,
  ADD CONSTRAINT "SaleCase_legacy_approval_check" CHECK (
    "legacyApproval" IS NULL OR (
      "approvalId" IS NULL AND "listedSnapshot" IS NOT NULL
      AND jsonb_typeof("legacyApproval")='object'
      AND nullif(btrim("legacyApproval"->>'approverName'),'') IS NOT NULL
      AND ("legacyApproval"-ARRAY['approverName','approvalReference'])='{}'::jsonb
    )
  );
-- Normal discount approvals remain the only route available to live commands.
CREATE FUNCTION vamotors.guard_import_discount_evidence() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
   IF NEW."legacyApproval" IS DISTINCT FROM OLD."legacyApproval" THEN
     RAISE EXCEPTION 'HISTORICAL_DISCOUNT_IS_IMMUTABLE' USING ERRCODE='23514';
   END IF;
 ELSIF NEW."legacyApproval" IS NOT NULL AND (
   vamotors.command_write_xid()=pg_current_xact_id()::xid OR NOT EXISTS (
     SELECT FROM vamotors."CommandReceipt" c WHERE c.id=NEW."commandId"
       AND c."commandName" IN ('completeImmediate','placeReservation','startFinance')
       AND c.xmin=vamotors.command_write_xid()
   )
 ) THEN RAISE EXCEPTION 'HISTORICAL_DISCOUNT_EVIDENCE_REQUIRED' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION vamotors.guard_import_discount_evidence() FROM PUBLIC;
CREATE TRIGGER guard_import_discount_evidence BEFORE INSERT OR UPDATE ON vamotors."SaleCase"
  FOR EACH ROW EXECUTE FUNCTION vamotors.guard_import_discount_evidence();

DO $$
DECLARE source text; marker text;
BEGIN
 SELECT pg_get_functiondef('vamotors.check_sale_graph()'::regprocedure) INTO source;
 marker:=$p$IF s."listedSnapshot" IS NOT NULL AND sc."agreedPrice" < s."listedSnapshot" THEN$p$;
 IF strpos(source,marker)=0 THEN RAISE EXCEPTION 'HISTORICAL_IMMEDIATE_DISCOUNT_BASE'; END IF;
 EXECUTE replace(source,marker,$p$IF s."listedSnapshot" IS NOT NULL AND sc."agreedPrice" < s."listedSnapshot"
   AND s."legacyApproval" IS NULL THEN$p$);

 SELECT pg_get_functiondef('vamotors.check_commitment_graph()'::regprocedure) INTO source;
 marker:=$p$s."approvalId" IS NULL)$p$;
 IF strpos(source,marker)=0 THEN RAISE EXCEPTION 'HISTORICAL_COMMITMENT_DISCOUNT_BASE'; END IF;
 EXECUTE replace(source,marker,$p$s."approvalId" IS NULL AND s."legacyApproval" IS NULL)$p$);
END $$;
COMMIT;
