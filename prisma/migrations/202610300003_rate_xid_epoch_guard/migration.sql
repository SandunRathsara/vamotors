BEGIN;
SELECT value FROM vamotors."BusinessSequence" WHERE id=1 FOR UPDATE;
SELECT vamotors.lock_admin_guard();

-- F1: xmin is xid (32-bit); pg_current_xact_id() is epoch-bearing xid8.
-- Normalize exactly as the accepted stock guard does. CREATE OR REPLACE retains
-- function identity, owner and ACL; every other accepted rate guard is unchanged.
-- PostgreSQL 18: /docs/18/transaction-id.html and /docs/18/functions-info.html.
CREATE OR REPLACE FUNCTION vamotors.rate_graph_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE s vamotors."RateSheetVersion"; q vamotors."Quote"; cid uuid; kind text; eid uuid; creator uuid; policy jsonb; charge jsonb; total numeric:=0;
BEGIN
 IF TG_TABLE_NAME='RateCardEntry' THEN
  SELECT * INTO s FROM vamotors."RateSheetVersion" WHERE id=NEW."sheetVersionId";
  IF NEW.principal>s.maximum THEN RAISE EXCEPTION 'RATE_BOUNDS' USING ERRCODE='23514'; END IF;
  -- Adding a card in a later transaction would mutate an immutable publication.
  IF NOT EXISTS(SELECT 1 FROM vamotors."CommandReceipt" c WHERE c.id=s."commandId" AND c.xmin=pg_current_xact_id()::xid) THEN RAISE EXCEPTION 'IMMUTABLE_RATE_CARDS' USING ERRCODE='23514'; END IF;
  RETURN NULL;
 ELSIF TG_TABLE_NAME='RateSheetVersion' THEN
  s:=NEW; cid:=s."commandId"; kind:='RateSheet'; eid:=s.id; creator:=s."createdBy";
  IF (SELECT count(*) FROM vamotors."RateCardEntry" WHERE "sheetVersionId"=s.id) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'RATE_CARDS_REQUIRED' USING ERRCODE='23514'; END IF;
 ELSE
  q:=NEW; cid:=q."commandId"; kind:='Quote'; eid:=q.id; creator:=q."createdBy";
  SELECT * INTO s FROM vamotors."RateSheetVersion" WHERE id=q."sheetId";
  SELECT values INTO policy FROM vamotors."FinancePolicyVersion" WHERE id=q."policyVersionId";
  IF q."companyId" IS DISTINCT FROM s."companyId" OR q.maximum IS DISTINCT FROM s.maximum OR lower(q.vehicle->>'make') IS DISTINCT FROM lower(s.make) OR lower(q.vehicle->>'model') IS DISTINCT FROM lower(s.model) OR (q.vehicle->>'year')::integer IS DISTINCT FROM s.year
   OR jsonb_typeof(q.vehicle)<>'object' OR length(btrim(COALESCE(q.vehicle->>'description',''))) NOT BETWEEN 1 AND 2000
   OR q."createdAt" < (s."validFrom"::timestamp AT TIME ZONE 'Asia/Colombo') AT TIME ZONE 'UTC'
   OR q."expiresAt"> ((s."validThrough"+1)::timestamp AT TIME ZONE 'Asia/Colombo') AT TIME ZONE 'UTC'
   OR NOT EXISTS(SELECT 1 FROM vamotors."RateCardEntry" c WHERE c.id=q."cardId" AND c.principal=q.principal AND c.months=q.months AND c.installment=q.installment)
   OR q."policySnapshot"<>policy
   OR q."commissionExpected"<>(CASE WHEN policy->'commission'->>'basis'='FIXED' THEN (policy->'commission'->>'fixed')::numeric ELSE floor((q.principal::numeric*(policy->'commission'->>'rateBps')::numeric+5000)/10000) END)
   OR q."expiresAt"<>least(q."createdAt"+interval '24 hours', ((s."validThrough"+1)::timestamp AT TIME ZONE 'Asia/Colombo') AT TIME ZONE 'UTC')
   OR NOT EXISTS(SELECT 1 FROM vamotors."FinanceCompany" c WHERE c.id=q."companyId" AND c.active AND c."currentPolicyId"=q."policyVersionId")
   OR NOT EXISTS(SELECT 1 FROM vamotors."SettingsVersion" v WHERE v.id=q."settingsVersionId" AND v.values=q."settingsSnapshot")
  THEN RAISE EXCEPTION 'INVALID_QUOTE_SNAPSHOT' USING ERRCODE='23514'; END IF;
  FOR charge IN SELECT value FROM jsonb_array_elements(q.charges) LOOP
   IF jsonb_typeof(charge)<>'object' OR length(btrim(COALESCE(charge->>'category',''))) NOT BETWEEN 1 AND 200 OR COALESCE(charge->>'amount','') !~ '^(0|[1-9][0-9]{0,13})$' THEN RAISE EXCEPTION 'INVALID_CHARGE' USING ERRCODE='23514'; END IF;
   total:=total+(charge->>'amount')::numeric;
  END LOOP;
  IF total>9999999999999999 THEN RAISE EXCEPTION 'MONEY_OVERFLOW' USING ERRCODE='23514'; END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM vamotors."CommandReceipt" c WHERE c.id=cid AND c."actorKey"='USER:'||creator::text AND c."commandName"=(CASE kind WHEN 'Quote' THEN 'selectQuote' ELSE 'publishRates' END) AND c.result=jsonb_build_object('type',kind,'id',eid,'revision',1) AND c."businessSequence">0)
 OR NOT EXISTS(SELECT 1 FROM vamotors."AuditEntry" a WHERE a."commandId"=cid AND a."entityType"=kind AND a."entityId"=eid)
 OR NOT EXISTS(SELECT 1 FROM vamotors."EntityReadVersion" v WHERE v."commandId"=cid AND v."entityType"=kind AND v."entityId"=eid AND v.revision=1)
 THEN RAISE EXCEPTION 'RATE_EVIDENCE_REQUIRED' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
COMMIT;
