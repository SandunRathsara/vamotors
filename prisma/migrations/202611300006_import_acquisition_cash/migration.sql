BEGIN;
ALTER TABLE vamotors."PurchaseRecord" ADD COLUMN "historicalPaymentSchedule" boolean NOT NULL DEFAULT false;
GRANT SELECT ("historicalPaymentSchedule"), INSERT ("historicalPaymentSchedule") ON vamotors."PurchaseRecord" TO vamotors_runtime;

CREATE FUNCTION vamotors.guard_historical_acquisition_cash() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
   IF NEW."historicalPaymentSchedule" IS DISTINCT FROM OLD."historicalPaymentSchedule" THEN
     RAISE EXCEPTION 'IMMUTABLE_ACQUISITION_PAYMENT_SCHEDULE' USING ERRCODE='23514';
   END IF;
 ELSIF NEW."historicalPaymentSchedule" AND (
   NEW."acquisitionKind"<>'SUPPLIER' OR vamotors.command_write_xid()=pg_current_xact_id()::xid OR NOT EXISTS (
     SELECT FROM vamotors."CommandReceipt" c WHERE c.id=NEW."acquisitionCommandId"
       AND c."commandName"='recordPurchase' AND c.result->>'id'=NEW.id::text
       AND c.xmin=vamotors.command_write_xid()
   )
 ) THEN RAISE EXCEPTION 'HISTORICAL_ACQUISITION_REQUIRED' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION vamotors.guard_historical_acquisition_cash() FROM PUBLIC;
CREATE TRIGGER guard_historical_acquisition_cash BEFORE INSERT OR UPDATE ON vamotors."PurchaseRecord"
  FOR EACH ROW EXECUTE FUNCTION vamotors.guard_historical_acquisition_cash();

DO $$
DECLARE source text; marker text := $p$IF p."purchaseType" IN ('CASH', 'BRAND_NEW') THEN$p$;
BEGIN
 SELECT pg_get_functiondef('vamotors.check_acquisition_graph()'::regprocedure) INTO source;
 IF strpos(source,marker)=0 THEN RAISE EXCEPTION 'HISTORICAL_ACQUISITION_GRAPH_BASE'; END IF;
 EXECUTE replace(source,marker,$p$IF p."purchaseType" IN ('CASH', 'BRAND_NEW') AND NOT p."historicalPaymentSchedule" THEN$p$);
END $$;
COMMIT;
