-- Check original payment evidence against the original terms, even after a
-- channel correction. Historical schedules retain their separate cash checks.
DO $$
DECLARE source text; marker text; replacement text;
BEGIN
  SELECT pg_get_functiondef('vamotors.check_acquisition_graph()'::regprocedure) INTO source;
  marker := $old$IF p."purchaseType" IN ('CASH', 'BRAND_NEW') AND NOT p."historicalPaymentSchedule" THEN$old$;
  IF strpos(source, marker) = 0 THEN RAISE EXCEPTION 'ACQUISITION_SETTLEMENT_BASE_MISMATCH'; END IF;
  source := replace(source, marker,
    $new$IF initial->>'purchaseType' IN ('CASH', 'BRAND_NEW') AND NOT p."historicalPaymentSchedule" THEN$new$);
  marker := $old$    ELSIF p."purchaseType" = 'LEASE_SETTLEMENT' THEN
      IF NOT EXISTS (SELECT 1 FROM vamotors."LeasePurchaseDetail" l WHERE l."purchaseRecordId" = cid) THEN
        RAISE EXCEPTION 'INVALID_ACQUISITION_GRAPH' USING ERRCODE = '23514';
      END IF;
    END IF;$old$;
  replacement := $new$    ELSIF initial->>'purchaseType' = 'LEASE_SETTLEMENT' AND NOT p."historicalPaymentSchedule" THEN
      IF (SELECT count(*) FROM vamotors."PurchasePayment" x
          WHERE x."cycleId" = cid AND x."commandId" = p."acquisitionCommandId")
          <> (((initial #>> '{settlement,cashToSeller}')::numeric > 0)::integer
             + ((initial #>> '{settlement,amount}')::numeric > 0)::integer)
        OR EXISTS (
          SELECT 1
          FROM (VALUES
            ('SELLER', (initial #>> '{settlement,cashToSeller}')::numeric, 'seller'),
            ('SETTLEMENT', (initial #>> '{settlement,amount}')::numeric, 'settlement')
          ) component(category, amount, line_key)
          WHERE component.amount IS NULL OR component.amount NOT BETWEEN 0 AND 99999999999999
             OR (component.amount > 0 AND NOT EXISTS (
               SELECT 1 FROM vamotors."PurchasePayment" x
               WHERE x."cycleId" = cid AND x."commandId" = p."acquisitionCommandId"
                 AND x.category = component.category AND x."lineKey" = component.line_key
                 AND x.amount = component.amount AND x.direction = 'OUT' AND x."reversalOf" IS NULL
                 AND x."occurredDate" = (initial->>'purchaseDate')::date
                 AND x.currency = policy->>'currency' AND x.scale = 2
             ))
        )
        OR (initial #>> '{settlement,cashToSeller}')::numeric
           + (initial #>> '{settlement,amount}')::numeric IS DISTINCT FROM (initial->>'purchasePrice')::numeric THEN
        RAISE EXCEPTION 'INVALID_ACQUISITION_GRAPH' USING ERRCODE = '23514';
      END IF;
    END IF;
    IF p."purchaseType" = 'LEASE_SETTLEMENT' AND NOT EXISTS (
      SELECT 1 FROM vamotors."LeasePurchaseDetail" l
      WHERE l."purchaseRecordId" = cid AND l.amount::numeric + l."cashToSeller" = p."purchasePrice"
    ) THEN
      RAISE EXCEPTION 'INVALID_SETTLEMENT_TOTAL' USING ERRCODE = '23514';
    END IF;$new$;
  IF strpos(source, marker) = 0 THEN RAISE EXCEPTION 'ACQUISITION_SETTLEMENT_BASE_MISMATCH'; END IF;
  EXECUTE replace(source, marker, replacement);

  -- Preserve the active root graph's later feature branches and validate the
  -- settlement projection and the original supplier for the audit comparison.
  SELECT pg_get_functiondef('vamotors.cycle_cost_root_graph()'::regprocedure) INTO source;
  marker := $old$OR after_payload->>'notes' IS DISTINCT FROM NEW.notes$old$;
  IF strpos(source, marker) = 0 THEN RAISE EXCEPTION 'COST_SETTLEMENT_BASE_MISMATCH'; END IF;
  source := replace(source, marker, marker || $new$
         OR after_payload->>'purchaseType' IS DISTINCT FROM NEW."purchaseType"
         OR after_payload->'settlement' IS DISTINCT FROM vamotors.settlement_json(NEW.id)$new$);
  marker := $old$jsonb_set(old_payload, '{seller}', after_payload->'seller')$old$;
  IF strpos(source, marker) = 0 THEN RAISE EXCEPTION 'COST_SETTLEMENT_BASE_MISMATCH'; END IF;
  EXECUTE replace(source, marker,
    $new$jsonb_set(old_payload, '{seller}', coalesce(vamotors.cycle_seller_json(OLD), 'null'::jsonb))$new$);
END $$;
