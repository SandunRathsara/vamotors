BEGIN;

-- A marked historical receipt is valid only as one half of an exact pair
-- added by the owning sale command in the import savepoint.
CREATE FUNCTION vamotors.guard_historical_sale_reversal() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE original vamotors."SaleReceipt"; reversal vamotors."SaleReceipt"; ordinal text;
BEGIN
  ordinal := split_part(NEW."lineKey", ':', 2);
  IF NEW."lineKey" LIKE 'historical-original:%' THEN
    original := NEW;
    SELECT * INTO reversal FROM vamotors."SaleReceipt" WHERE "reversalOf"=NEW.id;
  ELSE
    reversal := NEW;
    SELECT * INTO original FROM vamotors."SaleReceipt" WHERE id=NEW."reversalOf";
  END IF;
  IF ordinal !~ '^[0-9]+$' OR original.id IS NULL OR reversal.id IS NULL
    OR original."lineKey" <> 'historical-original:'||ordinal
    OR reversal."lineKey" <> 'historical-reversal:'||ordinal
    OR original."reversalOf" IS NOT NULL OR reversal."reversalOf"<>original.id
    OR original.direction<>'IN' OR reversal.direction<>'OUT'
    OR original."refundOf" IS NOT NULL OR reversal."refundOf" IS NOT NULL
    OR (to_jsonb(original)-ARRAY['id','direction','lineKey','reversalOf','reason','recordedAt'])
       IS DISTINCT FROM
       (to_jsonb(reversal)-ARRAY['id','direction','lineKey','reversalOf','reason','recordedAt'])
    OR vamotors.command_write_xid()=pg_current_xact_id()::xid
    OR NOT EXISTS (
      SELECT FROM vamotors."CommandReceipt" c
      WHERE c.id=NEW."commandId" AND c.xmin=vamotors.command_write_xid()
        AND c."actorKey"='USER:'||NEW."createdBy"::text
        AND c.result->>'id'=NEW."saleCaseId"::text
        AND c."commandName"=CASE NEW.category
          WHEN 'SALE' THEN 'completeImmediate'
          WHEN 'ADVANCE' THEN 'placeReservation'
          WHEN 'BALANCE' THEN 'convertReservation'
          WHEN 'DOWN_PAYMENT' THEN 'startFinance'
          WHEN 'LENDER' THEN 'confirmDOAndHandover'
        END
    )
  THEN RAISE EXCEPTION 'INVALID_HISTORICAL_SALE_REVERSAL' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION vamotors.guard_historical_sale_reversal() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER historical_sale_reversal AFTER INSERT ON vamotors."SaleReceipt"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
WHEN (NEW."lineKey" LIKE 'historical-original:%' OR NEW."lineKey" LIKE 'historical-reversal:%')
EXECUTE FUNCTION vamotors.guard_historical_sale_reversal();

DO $$
DECLARE source text; marker text;
BEGIN
  SELECT pg_get_functiondef('vamotors.check_sale_graph()'::regprocedure) INTO source;
  marker := $p$AND direction = 'IN';$p$;
  IF strpos(source,marker)=0 THEN RAISE EXCEPTION 'HISTORICAL_SALE_RECEIPT_BASE'; END IF;
  source := replace(source,marker, $p$AND direction = 'IN' AND "lineKey" NOT LIKE 'historical-original:%';$p$);
  marker := $p$IF r_in = 0 AND EXISTS (SELECT 1 FROM vamotors."SaleReceipt" WHERE "saleCaseId" = sid AND "commandId" = c.id) THEN$p$;
  IF strpos(source,marker)=0 THEN RAISE EXCEPTION 'HISTORICAL_SALE_ZERO_RECEIPT_BASE'; END IF;
  EXECUTE replace(source,marker,$p$IF r_in = 0 AND EXISTS (SELECT 1 FROM vamotors."SaleReceipt"
    WHERE "saleCaseId" = sid AND "commandId" = c.id AND "lineKey" NOT LIKE 'historical-original:%'
      AND "lineKey" NOT LIKE 'historical-reversal:%') THEN$p$);

  SELECT pg_get_functiondef('vamotors.check_commitment_graph()'::regprocedure) INTO source;
  marker := $p$coalesce(vamotors.commitment_review_receipt(NEW),false) OR$p$;
  IF strpos(source,marker)=0 THEN RAISE EXCEPTION 'HISTORICAL_COMMITMENT_RECEIPT_BASE'; END IF;
  EXECUTE replace(source,marker,marker||$p$
    NEW."lineKey" LIKE 'historical-original:%' OR NEW."lineKey" LIKE 'historical-reversal:%' OR$p$);
END $$;

COMMIT;
