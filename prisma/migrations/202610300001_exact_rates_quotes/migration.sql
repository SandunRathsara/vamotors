BEGIN;
SELECT value FROM vamotors."BusinessSequence" WHERE id=1 FOR UPDATE;
SELECT vamotors.lock_admin_guard();
ALTER TABLE vamotors."EntityReadVersion" DROP CONSTRAINT "EntityReadVersion_entityType_check";
ALTER TABLE vamotors."EntityReadVersion" ADD CONSTRAINT "EntityReadVersion_entityType_check" CHECK("entityType" IN ('Vehicle','PurchaseRecord','Customer','Supplier','RepairVendor','FinanceCompany','Settings','RateSheet','Quote'));

CREATE TABLE vamotors."RateSheetVersion" (
 id uuid PRIMARY KEY, "companyId" uuid NOT NULL REFERENCES vamotors."FinanceCompany"(id) ON DELETE RESTRICT,
 version integer NOT NULL CHECK(version>0), revision integer NOT NULL DEFAULT 1 CHECK(revision=1),
 make text NOT NULL CHECK(length(btrim(make)) BETWEEN 1 AND 200), model text NOT NULL CHECK(length(btrim(model)) BETWEEN 1 AND 200),
 year integer NOT NULL CHECK(year BETWEEN 1886 AND 9999), maximum bigint NOT NULL CHECK(maximum BETWEEN 1 AND 99999999999999),
 "validFrom" date NOT NULL, "validThrough" date NOT NULL CHECK("validThrough">="validFrom"),
 "publishedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "createdBy" uuid NOT NULL REFERENCES vamotors."user"(id) ON DELETE RESTRICT,
 "commandId" uuid NOT NULL UNIQUE REFERENCES vamotors."CommandReceipt"(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 UNIQUE("companyId",make,model,year,version)
);
CREATE INDEX "RateSheetVersion_companyId_make_model_year_validFrom_idx" ON vamotors."RateSheetVersion"("companyId",make,model,year,"validFrom");
CREATE TABLE vamotors."RateCardEntry" (
 id uuid PRIMARY KEY, "sheetVersionId" uuid NOT NULL REFERENCES vamotors."RateSheetVersion"(id) ON DELETE RESTRICT,
 principal bigint NOT NULL CHECK(principal BETWEEN 1 AND 99999999999999), months integer NOT NULL CHECK(months BETWEEN 1 AND 120),
 installment bigint NOT NULL CHECK(installment BETWEEN 1 AND 99999999999999),
 UNIQUE("sheetVersionId",principal,months), UNIQUE(id,"sheetVersionId")
);
CREATE TABLE vamotors."Quote" (
 id uuid PRIMARY KEY, revision integer NOT NULL DEFAULT 1 CHECK(revision=1),
 "sheetId" uuid NOT NULL REFERENCES vamotors."RateSheetVersion"(id) ON DELETE RESTRICT,
 "cardId" uuid NOT NULL, FOREIGN KEY("cardId","sheetId") REFERENCES vamotors."RateCardEntry"(id,"sheetVersionId") ON DELETE RESTRICT,
 "companyId" uuid NOT NULL REFERENCES vamotors."FinanceCompany"(id) ON DELETE RESTRICT,
 vehicle jsonb NOT NULL,
 principal bigint NOT NULL CHECK(principal BETWEEN 1 AND 99999999999999), months integer NOT NULL CHECK(months BETWEEN 1 AND 120),
 installment bigint NOT NULL CHECK(installment BETWEEN 1 AND 99999999999999), maximum bigint NOT NULL CHECK(maximum BETWEEN principal AND 99999999999999),
 charges jsonb NOT NULL CHECK(jsonb_typeof(charges)='array' AND jsonb_array_length(charges)<=100),
 "policyVersionId" uuid NOT NULL, FOREIGN KEY("policyVersionId","companyId") REFERENCES vamotors."FinancePolicyVersion"(id,"companyId") ON DELETE RESTRICT,
 "policySnapshot" jsonb NOT NULL CHECK(vamotors.valid_finance_policy("policySnapshot")), "companySnapshot" jsonb NOT NULL,
 "settingsVersionId" uuid NOT NULL REFERENCES vamotors."SettingsVersion"(id) ON DELETE RESTRICT, "settingsSnapshot" jsonb NOT NULL,
 "commissionExpected" bigint NOT NULL CHECK("commissionExpected" BETWEEN 0 AND 9999999999999999),
 "createdBy" uuid NOT NULL REFERENCES vamotors."user"(id) ON DELETE RESTRICT,
 "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "expiresAt" timestamp(3) NOT NULL,
 "commandId" uuid NOT NULL UNIQUE REFERENCES vamotors."CommandReceipt"(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 CHECK("expiresAt">"createdAt" AND "expiresAt"<="createdAt"+interval '24 hours')
);
CREATE INDEX "Quote_createdBy_createdAt_id_idx" ON vamotors."Quote"("createdBy","createdAt",id);
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON vamotors."RateSheetVersion" FOR EACH STATEMENT EXECUTE FUNCTION vamotors.append_only();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON vamotors."RateCardEntry" FOR EACH STATEMENT EXECUTE FUNCTION vamotors.append_only();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON vamotors."Quote" FOR EACH STATEMENT EXECUTE FUNCTION vamotors.append_only();

CREATE FUNCTION vamotors.rate_publication_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 PERFORM id FROM vamotors."FinanceCompany" WHERE id=NEW."companyId" FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM vamotors."FinanceCompany" WHERE id=NEW."companyId" AND active) THEN RAISE EXCEPTION 'PARTY_INACTIVE' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM vamotors."RateSheetVersion" s WHERE s."companyId"=NEW."companyId" AND lower(s.make)=lower(NEW.make) AND lower(s.model)=lower(NEW.model) AND s.year=NEW.year AND s."validFrom"<=NEW."validThrough" AND s."validThrough">=NEW."validFrom") THEN RAISE EXCEPTION 'RATE_OVERLAP' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER publication BEFORE INSERT ON vamotors."RateSheetVersion" FOR EACH ROW EXECUTE FUNCTION vamotors.rate_publication_guard();
CREATE FUNCTION vamotors.rate_graph_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE s vamotors."RateSheetVersion"; q vamotors."Quote"; cid uuid; kind text; eid uuid; creator uuid; policy jsonb; charge jsonb; total numeric:=0;
BEGIN
 IF TG_TABLE_NAME='RateCardEntry' THEN
  SELECT * INTO s FROM vamotors."RateSheetVersion" WHERE id=NEW."sheetVersionId";
  IF NEW.principal>s.maximum THEN RAISE EXCEPTION 'RATE_BOUNDS' USING ERRCODE='23514'; END IF;
  -- Adding a card in a later transaction would mutate an immutable publication.
  IF NOT EXISTS(SELECT 1 FROM vamotors."CommandReceipt" c WHERE c.id=s."commandId" AND c.xmin::text=pg_current_xact_id()::text) THEN RAISE EXCEPTION 'IMMUTABLE_RATE_CARDS' USING ERRCODE='23514'; END IF;
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
CREATE CONSTRAINT TRIGGER rate_graph AFTER INSERT ON vamotors."RateSheetVersion" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vamotors.rate_graph_guard();
CREATE CONSTRAINT TRIGGER rate_graph AFTER INSERT ON vamotors."RateCardEntry" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vamotors.rate_graph_guard();
CREATE CONSTRAINT TRIGGER rate_graph AFTER INSERT ON vamotors."Quote" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vamotors.rate_graph_guard();

-- No existing subject/action universe expands. Existing immutable permissions,
-- memberships and delegated ceilings remain byte-identical. Only the protected
-- Administrator explicitly receives these newly implemented subjects.
CREATE FUNCTION vamotors.rate_migration_canonical(j jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE jsonb_typeof(j) WHEN 'object' THEN '{'||COALESCE((SELECT string_agg(to_jsonb(key)::text||':'||vamotors.rate_migration_canonical(value),',' ORDER BY key COLLATE "C") FROM jsonb_each(j)),'')||'}' WHEN 'array' THEN '['||COALESCE((SELECT string_agg(vamotors.rate_migration_canonical(value),',' ORDER BY n) FROM jsonb_array_elements(j) WITH ORDINALITY a(value,n)),'')||']' ELSE j::text END
$$;
ALTER TABLE vamotors."RolePermission" DISABLE TRIGGER protected_permissions;
ALTER TABLE vamotors."Role" DISABLE TRIGGER protected_role;
DO $$ DECLARE aid uuid; pid uuid; new_rule jsonb; kind text; action text;
BEGIN
 SELECT id INTO aid FROM vamotors."Role" WHERE "systemKey"='ADMINISTRATOR';
 IF aid IS NOT NULL THEN
  FOREACH kind IN ARRAY ARRAY['RateSheet','Quote'] LOOP
   FOREACH action IN ARRAY ARRAY['read','create'] LOOP
    new_rule:=jsonb_build_object('subject',kind,'action',action,'fields',jsonb_build_array('*'));
    INSERT INTO vamotors."Permission"(id,"ruleHash",rule) VALUES(gen_random_uuid(),encode(sha256(convert_to(vamotors.rate_migration_canonical(new_rule),'UTF8')),'hex'),new_rule) ON CONFLICT("ruleHash") DO NOTHING;
    SELECT p.id INTO pid FROM vamotors."Permission" p WHERE p."ruleHash"=encode(sha256(convert_to(vamotors.rate_migration_canonical(new_rule),'UTF8')),'hex');
    INSERT INTO vamotors."RolePermission" VALUES(aid,pid) ON CONFLICT DO NOTHING;
   END LOOP;
  END LOOP;
  UPDATE vamotors."Role" SET revision=revision+1 WHERE id=aid;
 END IF;
END $$;
SET CONSTRAINTS ALL IMMEDIATE;
ALTER TABLE vamotors."Role" ENABLE TRIGGER protected_role;
ALTER TABLE vamotors."RolePermission" ENABLE TRIGGER protected_permissions;
DROP FUNCTION vamotors.rate_migration_canonical(jsonb);
COMMIT;
