BEGIN;
SELECT value FROM vamotors."BusinessSequence" WHERE id=1 FOR UPDATE;
SELECT vamotors.lock_admin_guard();

-- Existing foundation fixtures retain their provenance. Only new, complete
-- command-owned acquisitions are writable by runtime; no legacy bypass grant.
ALTER TABLE vamotors."PurchaseRecord"
 ADD COLUMN "acquisitionCommandId" uuid UNIQUE REFERENCES vamotors."CommandReceipt"(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 ADD COLUMN "settingsVersionId" uuid REFERENCES vamotors."SettingsVersion"(id) ON DELETE RESTRICT,
 ADD CHECK (("acquisitionCommandId" IS NULL)=("settingsVersionId" IS NULL));
CREATE TABLE vamotors."PurchasePayment" (
 id uuid PRIMARY KEY, "cycleId" uuid NOT NULL REFERENCES vamotors."PurchaseRecord"(id) ON DELETE RESTRICT,
 amount bigint NOT NULL CHECK(amount BETWEEN 1 AND 99999999999999),
 direction text NOT NULL CHECK(direction IN ('IN','OUT')), category text NOT NULL CHECK(category='SELLER'),
 "occurredDate" date NOT NULL CHECK("occurredDate" <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Colombo')::date),
 method text NOT NULL CHECK(method IN ('CASH','BANK_TRANSFER')), currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'), scale integer NOT NULL CHECK(scale=2),
 reference text CHECK(reference IS NULL OR length(btrim(reference)) BETWEEN 1 AND 200),
 "reversalOf" uuid UNIQUE, reason text CHECK(reason IS NULL OR length(btrim(reason)) BETWEEN 1 AND 2000),
 "commandId" uuid NOT NULL REFERENCES vamotors."CommandReceipt"(id) ON DELETE RESTRICT,
 "lineKey" text NOT NULL CHECK(length("lineKey") BETWEEN 1 AND 100), "recordedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(id,"cycleId"), UNIQUE("commandId","lineKey"), UNIQUE("reversalOf","cycleId"),
 FOREIGN KEY("reversalOf","cycleId") REFERENCES vamotors."PurchasePayment"(id,"cycleId") ON DELETE RESTRICT
);
CREATE INDEX "PurchasePayment_cycleId_occurredDate_id_idx" ON vamotors."PurchasePayment"("cycleId","occurredDate",id);
CREATE TABLE vamotors."MileageReading" (
 id uuid PRIMARY KEY, "vehicleId" uuid NOT NULL REFERENCES vamotors."Vehicle"(id) ON DELETE RESTRICT,
 "cycleId" uuid NOT NULL, FOREIGN KEY("cycleId","vehicleId") REFERENCES vamotors."PurchaseRecord"(id,"vehicleId") ON DELETE RESTRICT,
 reading integer NOT NULL CHECK(reading BETWEEN 0 AND 99999999),
 "recordedDate" date NOT NULL CHECK("recordedDate" <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Colombo')::date),
 remark text CHECK(remark IS NULL OR length(btrim(remark)) BETWEEN 1 AND 2000),
 "decreaseReason" text CHECK("decreaseReason" IS NULL OR length(btrim("decreaseReason")) BETWEEN 1 AND 2000),
 "commandId" uuid NOT NULL REFERENCES vamotors."CommandReceipt"(id) ON DELETE RESTRICT,
 "recordedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE("commandId","cycleId")
);
CREATE INDEX "MileageReading_cycleId_recordedDate_id_idx" ON vamotors."MileageReading"("cycleId","recordedDate",id);
CREATE TABLE vamotors."CycleBasisVersion" (
 id uuid PRIMARY KEY, "cycleId" uuid NOT NULL REFERENCES vamotors."PurchaseRecord"(id) ON DELETE RESTRICT,
 version integer NOT NULL CHECK(version>0), purchase bigint NOT NULL CHECK(purchase BETWEEN 0 AND 99999999999999),
 components jsonb NOT NULL, total bigint NOT NULL CHECK(total BETWEEN 0 AND 9999999999999999),
 currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'), scale integer NOT NULL CHECK(scale=2), reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),
 "commandId" uuid NOT NULL REFERENCES vamotors."CommandReceipt"(id) ON DELETE RESTRICT,
 "supersedesId" uuid UNIQUE, "recordedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(id,"cycleId"), UNIQUE("cycleId",version), UNIQUE("supersedesId","cycleId"), FOREIGN KEY("supersedesId","cycleId") REFERENCES vamotors."CycleBasisVersion"(id,"cycleId") ON DELETE RESTRICT
);
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON vamotors."PurchasePayment" FOR EACH STATEMENT EXECUTE FUNCTION vamotors.append_only();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON vamotors."MileageReading" FOR EACH STATEMENT EXECUTE FUNCTION vamotors.append_only();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON vamotors."CycleBasisVersion" FOR EACH STATEMENT EXECUTE FUNCTION vamotors.append_only();

CREATE FUNCTION vamotors.acquisition_root_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF current_user='vamotors_runtime' AND NEW."acquisitionCommandId" IS NULL THEN RAISE EXCEPTION 'ACQUISITION_EVIDENCE_REQUIRED' USING ERRCODE='23514'; END IF;
  IF NEW."acquisitionCommandId" IS NOT NULL AND (NEW.status<>'PURCHASED' OR NEW.available OR NEW."cycleNumber"<>1 OR NEW."purchasePrice"<=0 OR NEW."receivedDate" IS NOT NULL OR NEW."holdReason" IS NOT NULL OR NEW."purchaseDate">(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Colombo')::date) THEN RAISE EXCEPTION 'INVALID_ACQUISITION' USING ERRCODE='23514'; END IF;
 ELSIF OLD."acquisitionCommandId" IS NOT NULL OR NEW."acquisitionCommandId" IS DISTINCT FROM OLD."acquisitionCommandId" THEN
  -- Receive/edit/correction commands are not enabled in this slice.
  RAISE EXCEPTION 'IMMUTABLE_ACQUISITION' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER acquisition_root BEFORE INSERT OR UPDATE ON vamotors."PurchaseRecord" FOR EACH ROW EXECUTE FUNCTION vamotors.acquisition_root_guard();

CREATE FUNCTION vamotors.check_acquisition_graph() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE cid uuid; p vamotors."PurchaseRecord"; policy jsonb;
BEGIN
 cid:=CASE WHEN TG_TABLE_NAME='PurchaseRecord' THEN NEW.id ELSE NEW."cycleId" END;
 SELECT * INTO p FROM vamotors."PurchaseRecord" WHERE id=cid;
 IF p."acquisitionCommandId" IS NULL THEN
  IF TG_TABLE_NAME<>'PurchaseRecord' THEN RAISE EXCEPTION 'ACQUISITION_EVIDENCE_REQUIRED' USING ERRCODE='23514'; END IF;
  RETURN NULL;
 END IF;
 SELECT values INTO policy FROM vamotors."SettingsVersion" WHERE id=p."settingsVersionId";
 IF NOT EXISTS(SELECT 1 FROM vamotors."CommandReceipt" c WHERE c.id=p."acquisitionCommandId" AND c."commandName"='recordPurchase' AND c."actorKey"='USER:'||p."createdBy"::text AND c."businessSequence">0 AND c.result=jsonb_build_object('type','PurchaseRecord','id',p.id,'revision',1))
 OR NOT EXISTS(SELECT 1 FROM vamotors."Vehicle" v WHERE v.id=p."vehicleId" AND v."createdBy"=p."createdBy" AND v."activePurchaseId"=p.id)
 OR NOT EXISTS(SELECT 1 FROM vamotors."Supplier" s WHERE s.id=p."supplierId" AND s.active AND (p."purchaseType"<>'BRAND_NEW' OR s.category='COMPANY'))
 OR (SELECT count(*) FROM vamotors."PurchasePayment" x WHERE x."cycleId"=cid)<>1
 OR NOT EXISTS(SELECT 1 FROM vamotors."PurchasePayment" x WHERE x."cycleId"=cid AND x."commandId"=p."acquisitionCommandId" AND x.amount=p."purchasePrice" AND x.direction='OUT' AND x."occurredDate"=p."purchaseDate" AND x."reversalOf" IS NULL AND x.currency=policy->>'currency' AND x.scale=(policy->>'scale')::integer AND x."lineKey"='seller')
 OR (SELECT count(*) FROM vamotors."MileageReading" x WHERE x."cycleId"=cid)<>1
 OR NOT EXISTS(SELECT 1 FROM vamotors."MileageReading" x WHERE x."cycleId"=cid AND x."commandId"=p."acquisitionCommandId" AND x."recordedDate">=p."purchaseDate")
 OR (SELECT count(*) FROM vamotors."CycleBasisVersion" x WHERE x."cycleId"=cid)<>1
 OR NOT EXISTS(SELECT 1 FROM vamotors."CycleBasisVersion" x WHERE x."cycleId"=cid AND x."commandId"=p."acquisitionCommandId" AND x.version=1 AND x.purchase=p."purchasePrice" AND x.total=p."purchasePrice" AND x.components=jsonb_build_object('purchase',p."purchasePrice"::text,'repairs','[]'::jsonb,'costs','[]'::jsonb) AND x.currency=policy->>'currency' AND x.scale=2 AND x."supersedesId" IS NULL)
 OR NOT EXISTS(SELECT 1 FROM vamotors."StatusEvent" s WHERE s."cycleId"=cid AND s."commandId"=p."acquisitionCommandId" AND s."from" IS NULL AND s."to"='PURCHASED' AND s.action='recordPurchase' AND s."userId"=p."createdBy")
 OR NOT EXISTS(SELECT 1 FROM vamotors."AuditEntry" a WHERE a."commandId"=p."acquisitionCommandId" AND a."entityType"='PurchaseRecord' AND a."entityId"=cid)
 OR NOT EXISTS(SELECT 1 FROM vamotors."EntityReadVersion" v WHERE v."commandId"=p."acquisitionCommandId" AND v."entityType"='PurchaseRecord' AND v."entityId"=cid AND v.revision=1)
 OR NOT EXISTS(SELECT 1 FROM vamotors."EntityReadVersion" v WHERE v."commandId"=p."acquisitionCommandId" AND v."entityType"='Vehicle' AND v."entityId"=p."vehicleId" AND v.revision=1)
 THEN RAISE EXCEPTION 'INVALID_ACQUISITION_GRAPH' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER acquisition_graph AFTER INSERT ON vamotors."PurchaseRecord" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vamotors.check_acquisition_graph();
CREATE CONSTRAINT TRIGGER acquisition_graph AFTER INSERT ON vamotors."PurchasePayment" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vamotors.check_acquisition_graph();
CREATE CONSTRAINT TRIGGER acquisition_graph AFTER INSERT ON vamotors."MileageReading" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vamotors.check_acquisition_graph();
CREATE CONSTRAINT TRIGGER acquisition_graph AFTER INSERT ON vamotors."CycleBasisVersion" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vamotors.check_acquisition_graph();
CREATE VIEW vamotors."CashMovement" AS SELECT 'PURCHASE'::text AS "sourceType", "cycleId" AS "sourceId", id AS "paymentId", "occurredDate" AS date, direction, amount, method, category, "commandId" FROM vamotors."PurchasePayment";

-- Append replacement permissions; never rewrite immutable rules. Freeze v5
-- wildcards AND financial parent grants before expanding the registry. Only
-- protected Administrator deliberately gains the new create/read capabilities.
CREATE FUNCTION vamotors.purchase_migration_canonical(j jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE jsonb_typeof(j)
 WHEN 'object' THEN '{'||COALESCE((SELECT string_agg(to_jsonb(key)::text||':'||vamotors.purchase_migration_canonical(value),',' ORDER BY key COLLATE "C") FROM jsonb_each(j)),'')||'}'
 WHEN 'array' THEN '['||COALESCE((SELECT string_agg(vamotors.purchase_migration_canonical(value),',' ORDER BY n) FROM jsonb_array_elements(j) WITH ORDINALITY a(value,n)),'')||']'
 ELSE j::text END
$$;
ALTER TABLE vamotors."RolePermission" DISABLE TRIGGER protected_permissions;
ALTER TABLE vamotors."Role" DISABLE TRIGGER protected_role;
DO $$
DECLARE old record; replacement jsonb; fields jsonb; universe text[]; pid uuid; admin_id uuid; new_rule jsonb; kind text; action text;
BEGIN
 FOR old IN SELECT rp."roleId",p.id,p.rule FROM vamotors."RolePermission" rp JOIN vamotors."Permission" p ON p.id=rp."permissionId" WHERE p.rule->>'subject' IN ('Vehicle','PurchaseRecord') AND p.rule->>'action'='read' LOOP
  universe:=CASE WHEN old.rule->>'subject'='PurchaseRecord' THEN ARRAY['id','purchaseDate','status','purchasePrice'] ELSE ARRAY['id','identity.engineNumber','identity.chassisNumber','identity.make','identity.model','identity.year','identity.colour','identity.fuelType','identity.transmission','identity.vin','identity.crNumber','identity.notes','status','available','cycleId','revision','listedPrice','financial.purchase','financial.repairs','financial.additionalCosts','financial.basis','financial.originalProfit','financial.restatedProfit'] END;
  SELECT COALESCE(jsonb_agg(f ORDER BY f),'[]') INTO fields FROM unnest(universe) f WHERE EXISTS(SELECT 1 FROM jsonb_array_elements_text(old.rule->'fields') p WHERE p='*' OR f=p OR starts_with(f,p||'.'));
  replacement:=jsonb_set(old.rule,'{fields}',fields);
  INSERT INTO vamotors."Permission"(id,"ruleHash",rule) VALUES(gen_random_uuid(),encode(sha256(convert_to(vamotors.purchase_migration_canonical(replacement),'UTF8')),'hex'),replacement) ON CONFLICT("ruleHash") DO NOTHING;
  SELECT id INTO pid FROM vamotors."Permission" WHERE "ruleHash"=encode(sha256(convert_to(vamotors.purchase_migration_canonical(replacement),'UTF8')),'hex');
  DELETE FROM vamotors."RolePermission" WHERE "roleId"=old."roleId" AND "permissionId"=old.id;
  INSERT INTO vamotors."RolePermission" VALUES(old."roleId",pid) ON CONFLICT DO NOTHING;
 END LOOP;
 SELECT id INTO admin_id FROM vamotors."Role" WHERE "systemKey"='ADMINISTRATOR';
 IF admin_id IS NOT NULL THEN
  FOREACH kind IN ARRAY ARRAY['Vehicle','PurchaseRecord'] LOOP
   FOREACH action IN ARRAY ARRAY['read','create'] LOOP
    new_rule:=jsonb_build_object('subject',kind,'action',action,'fields',jsonb_build_array('*'));
    INSERT INTO vamotors."Permission"(id,"ruleHash",rule) VALUES(gen_random_uuid(),encode(sha256(convert_to(vamotors.purchase_migration_canonical(new_rule),'UTF8')),'hex'),new_rule) ON CONFLICT("ruleHash") DO NOTHING;
    SELECT id INTO pid FROM vamotors."Permission" WHERE "ruleHash"=encode(sha256(convert_to(vamotors.purchase_migration_canonical(new_rule),'UTF8')),'hex');
    INSERT INTO vamotors."RolePermission" VALUES(admin_id,pid) ON CONFLICT DO NOTHING;
   END LOOP;
  END LOOP;
 END IF;
 UPDATE vamotors."Role" SET revision=revision+1;
END $$;
SET CONSTRAINTS ALL IMMEDIATE;
ALTER TABLE vamotors."Role" ENABLE TRIGGER protected_role;
ALTER TABLE vamotors."RolePermission" ENABLE TRIGGER protected_permissions;
DROP FUNCTION vamotors.purchase_migration_canonical(jsonb);
COMMIT;
