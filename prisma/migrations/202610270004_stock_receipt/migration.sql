BEGIN;
SELECT value FROM vamotors."BusinessSequence" WHERE id=1 FOR UPDATE;
SELECT vamotors.lock_admin_guard();

-- Preserve acquisition terms/ownership and the physical identity. Only the
-- stock projection can change; its complete evidence is checked at commit.
CREATE OR REPLACE FUNCTION vamotors.acquisition_root_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF current_user='vamotors_runtime' AND NEW."acquisitionCommandId" IS NULL THEN RAISE EXCEPTION 'ACQUISITION_EVIDENCE_REQUIRED' USING ERRCODE='23514'; END IF;
  IF NEW."acquisitionCommandId" IS NOT NULL AND (NEW.revision<>1 OR NEW.status<>'PURCHASED' OR NEW.available OR NEW."cycleNumber"<>1 OR NEW."purchasePrice"<=0 OR NEW."receivedDate" IS NOT NULL OR NEW."holdReason" IS NOT NULL OR NEW."purchaseDate">(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Colombo')::date) THEN RAISE EXCEPTION 'INVALID_ACQUISITION' USING ERRCODE='23514'; END IF;
 ELSE
  IF OLD."acquisitionCommandId" IS NULL OR NEW."acquisitionCommandId" IS DISTINCT FROM OLD."acquisitionCommandId" THEN RAISE EXCEPTION 'ACQUISITION_EVIDENCE_REQUIRED' USING ERRCODE='23514'; END IF;
  IF (to_jsonb(NEW)-ARRAY['status','available','holdReason','receivedDate','revision','updatedAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','available','holdReason','receivedDate','revision','updatedAt']) THEN RAISE EXCEPTION 'IMMUTABLE_ACQUISITION' USING ERRCODE='23514'; END IF;
  IF OLD.revision=2147483647 OR NEW.revision::bigint<>OLD.revision::bigint+1 OR NEW.status<>'IN_STOCK' OR OLD.status NOT IN ('PURCHASED','IN_STOCK') OR NEW."closedAt" IS NOT NULL
   OR NEW."receivedDate" IS NULL OR NEW."receivedDate"<NEW."purchaseDate" OR NEW."receivedDate">(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Colombo')::date
   OR (OLD.status='IN_STOCK' AND NEW."receivedDate" IS DISTINCT FROM OLD."receivedDate")
   OR (NEW.available AND NEW."holdReason" IS NOT NULL)
   OR (NOT NEW.available AND (NEW."holdReason" IS NULL OR NEW."holdReason" ~ '^[[:space:]]|[[:space:]]$' OR length(NEW."holdReason") NOT BETWEEN 1 AND 2000))
   OR (OLD.status='IN_STOCK' AND NEW.available=OLD.available AND NEW."holdReason" IS NOT DISTINCT FROM OLD."holdReason")
   THEN RAISE EXCEPTION 'INVALID_STOCK_CHANGE' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION vamotors.initial_cycle_transition() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'PURCHASED' OR (NEW."purchaseType"='BRAND_NEW' AND NOT EXISTS(SELECT 1 FROM vamotors."Supplier" WHERE id=NEW."supplierId" AND category='COMPANY')) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 ELSIF NEW.status IS DISTINCT FROM OLD.status AND NOT(OLD.status='PURCHASED' AND NEW.status='IN_STOCK' AND NEW."receivedDate" IS NOT NULL) THEN RAISE EXCEPTION 'INVALID_STATE';
 END IF;
 RETURN NEW;
END $$;

-- Definer reads the root's system xmin without granting runtime whole-table or
-- system-column SELECT. Fixed search path; trigger-only, no caller SQL/GUC input.
CREATE OR REPLACE FUNCTION vamotors.purchase_status_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE p vamotors."PurchaseRecord"; c vamotors."CommandReceipt";
BEGIN
 SELECT * INTO p FROM vamotors."PurchaseRecord" WHERE id=NEW."cycleId";
 IF p."acquisitionCommandId" IS NOT NULL THEN
  IF NEW."commandId"=p."acquisitionCommandId" THEN
   IF NEW."from" IS NOT NULL OR NEW."to"<>'PURCHASED' OR NEW.action<>'recordPurchase' OR NEW."userId"<>p."createdBy" OR NEW."occurredAt"<>p."purchaseDate"::timestamp OR EXISTS(SELECT 1 FROM vamotors."StatusEvent" s WHERE s."cycleId"=p.id) THEN RAISE EXCEPTION 'INVALID_ACQUISITION_STATUS' USING ERRCODE='23514'; END IF;
  ELSE
   SELECT * INTO c FROM vamotors."CommandReceipt" WHERE id=NEW."commandId";
   IF c.id IS NULL OR c."actorKey"<>'USER:'||NEW."userId"::text OR c."commandName"<>NEW.action OR NEW.action NOT IN ('receiveStock','holdStock','releaseStock') OR NEW."to"<>'IN_STOCK' OR NEW."from"::text IS DISTINCT FROM (CASE WHEN NEW.action='receiveStock' THEN 'PURCHASED' ELSE 'IN_STOCK' END) OR c.result<>jsonb_build_object('type','PurchaseRecord','id',p.id,'revision',p.revision) OR NOT EXISTS(SELECT 1 FROM vamotors."PurchaseRecord" x WHERE x.id=p.id AND x.xmin=pg_current_xact_id()::xid) OR EXISTS(SELECT 1 FROM vamotors."StatusEvent" s WHERE s."commandId"=c.id) THEN RAISE EXCEPTION 'INVALID_STOCK_STATUS' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;

-- Initial financial evidence is validated independently from current stock.
-- Supplier activation/category is a creation prerequisite, not a later receipt
-- prerequisite: historical supplier archival must not strand purchased stock.
CREATE OR REPLACE FUNCTION vamotors.check_acquisition_graph() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE cid uuid; p vamotors."PurchaseRecord"; policy jsonb;
BEGIN
 IF TG_TABLE_NAME='PurchaseRecord' THEN cid:=NEW.id; ELSE cid:=NEW."cycleId"; END IF;
 SELECT * INTO p FROM vamotors."PurchaseRecord" WHERE id=cid;
 IF p."acquisitionCommandId" IS NULL THEN
  IF TG_TABLE_NAME<>'PurchaseRecord' THEN RAISE EXCEPTION 'ACQUISITION_EVIDENCE_REQUIRED' USING ERRCODE='23514'; END IF;
  RETURN NULL;
 END IF;
 SELECT values INTO policy FROM vamotors."SettingsVersion" WHERE id=p."settingsVersionId";
 IF NOT EXISTS(SELECT 1 FROM vamotors."CommandReceipt" c WHERE c.id=p."acquisitionCommandId" AND c."commandName"='recordPurchase' AND c."actorKey"='USER:'||p."createdBy"::text AND c."businessSequence">0 AND c.result=jsonb_build_object('type','PurchaseRecord','id',p.id,'revision',1))
 OR NOT EXISTS(SELECT 1 FROM vamotors."Vehicle" v WHERE v.id=p."vehicleId" AND v."createdBy"=p."createdBy" AND v."activePurchaseId"=p.id)
 OR (TG_TABLE_NAME='PurchaseRecord' AND TG_OP='INSERT' AND NOT EXISTS(SELECT 1 FROM vamotors."Supplier" s WHERE s.id=p."supplierId" AND s.active AND (p."purchaseType"<>'BRAND_NEW' OR s.category='COMPANY')))
 OR (SELECT count(*) FROM vamotors."PurchasePayment" x WHERE x."cycleId"=cid)<>1
 OR NOT EXISTS(SELECT 1 FROM vamotors."PurchasePayment" x WHERE x."cycleId"=cid AND x."commandId"=p."acquisitionCommandId" AND x.amount=p."purchasePrice" AND x.direction='OUT' AND x."occurredDate"=p."purchaseDate" AND x."reversalOf" IS NULL AND x.currency=policy->>'currency' AND x.scale=(policy->>'scale')::integer AND x."lineKey"='seller')
 OR (SELECT count(*) FROM vamotors."MileageReading" x WHERE x."cycleId"=cid)<>1
 OR NOT EXISTS(SELECT 1 FROM vamotors."MileageReading" x WHERE x."cycleId"=cid AND x."commandId"=p."acquisitionCommandId" AND x."recordedDate">=p."purchaseDate")
 OR (SELECT count(*) FROM vamotors."CycleBasisVersion" x WHERE x."cycleId"=cid)<>1
 OR NOT EXISTS(SELECT 1 FROM vamotors."CycleBasisVersion" x WHERE x."cycleId"=cid AND x."commandId"=p."acquisitionCommandId" AND x.version=1 AND x.purchase=p."purchasePrice" AND x.total=p."purchasePrice" AND x.components=jsonb_build_object('purchase',p."purchasePrice"::text,'repairs','[]'::jsonb,'costs','[]'::jsonb) AND x.currency=policy->>'currency' AND x.scale=2 AND x."supersedesId" IS NULL)
 OR (SELECT count(*) FROM vamotors."StatusEvent" s WHERE s."cycleId"=cid AND s."commandId"=p."acquisitionCommandId" AND s."from" IS NULL AND s."to"='PURCHASED' AND s.action='recordPurchase' AND s."userId"=p."createdBy")<>1
 OR NOT EXISTS(SELECT 1 FROM vamotors."AuditEntry" a WHERE a."commandId"=p."acquisitionCommandId" AND a."entityType"='PurchaseRecord' AND a."entityId"=cid)
 OR NOT EXISTS(SELECT 1 FROM vamotors."EntityReadVersion" v WHERE v."commandId"=p."acquisitionCommandId" AND v."entityType"='PurchaseRecord' AND v."entityId"=cid AND v.revision=1)
 OR NOT EXISTS(SELECT 1 FROM vamotors."EntityReadVersion" v WHERE v."commandId"=p."acquisitionCommandId" AND v."entityType"='Vehicle' AND v."entityId"=p."vehicleId" AND v.revision=1)
 THEN RAISE EXCEPTION 'INVALID_ACQUISITION_GRAPH' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
DROP TRIGGER acquisition_graph ON vamotors."PurchaseRecord";
CREATE CONSTRAINT TRIGGER acquisition_graph AFTER INSERT OR UPDATE ON vamotors."PurchaseRecord" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vamotors.check_acquisition_graph();

CREATE FUNCTION vamotors.check_stock_graph() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE c vamotors."CommandReceipt"; v vamotors."Vehicle"; after_payload jsonb; old_payload jsonb; delta jsonb; kind text; eid uuid; rev integer; paths text[]:=ARRAY['revision','status','available','holdReason','receivedDate'];
BEGIN
 SELECT * INTO v FROM vamotors."Vehicle" WHERE id=NEW."vehicleId";
 SELECT * INTO c FROM vamotors."CommandReceipt" WHERE result=jsonb_build_object('type','PurchaseRecord','id',NEW.id,'revision',NEW.revision) AND "commandName" IN ('receiveStock','holdStock','releaseStock') AND xmin=pg_current_xact_id()::xid;
 IF c.id IS NULL OR c."environmentId"<>(SELECT id FROM vamotors."Environment" WHERE singleton=1) OR c."businessSequence"<>(SELECT value FROM vamotors."BusinessSequence" WHERE id=1)
 OR v."activePurchaseId" IS DISTINCT FROM NEW.id
 OR (OLD.status='PURCHASED' AND c."commandName"<>'receiveStock') OR (OLD.status='IN_STOCK' AND c."commandName" NOT IN ('holdStock','releaseStock'))
 OR (c."commandName"='holdStock' AND NEW.available) OR (c."commandName"='releaseStock' AND NOT NEW.available)
  OR NOT EXISTS(SELECT 1 FROM vamotors."StatusEvent" s WHERE s."commandId"=c.id AND s."cycleId"=NEW.id AND s."from"=OLD.status AND s."to"=NEW.status AND s.action=c."commandName" AND c."actorKey"='USER:'||s."userId"::text AND s.xmin=pg_current_xact_id()::xid AND (s.action<>'receiveStock' OR s."occurredAt"=NEW."receivedDate"::timestamp))
 THEN RAISE EXCEPTION 'INVALID_STOCK_GRAPH' USING ERRCODE='23514'; END IF;
 FOREACH kind IN ARRAY ARRAY['PurchaseRecord','Vehicle'] LOOP
  paths:=CASE WHEN kind='PurchaseRecord' THEN ARRAY['revision','status','available','holdReason','receivedDate'] ELSE ARRAY['revision','status','available','holdReason'] END;
  eid:=CASE WHEN kind='PurchaseRecord' THEN NEW.id ELSE NEW."vehicleId" END;
  rev:=CASE WHEN kind='PurchaseRecord' THEN NEW.revision ELSE v.revision END;
  SELECT payload INTO old_payload FROM vamotors."EntityReadVersion" WHERE "entityType"=kind AND "entityId"=eid AND sequence<c."businessSequence" ORDER BY sequence DESC LIMIT 1;
  SELECT payload INTO after_payload FROM vamotors."EntityReadVersion" WHERE "entityType"=kind AND "entityId"=eid AND "commandId"=c.id AND revision=rev AND sequence=c."businessSequence" AND xmin=pg_current_xact_id()::xid;
  IF old_payload IS NULL OR after_payload IS NULL
   OR old_payload->'revision' IS DISTINCT FROM to_jsonb(OLD.revision)
   OR after_payload->'revision' IS DISTINCT FROM to_jsonb(NEW.revision)
   OR after_payload->'status' IS DISTINCT FROM to_jsonb(NEW.status)
   OR after_payload->'available' IS DISTINCT FROM to_jsonb(NEW.available)
   OR coalesce(after_payload->'holdReason','null'::jsonb) IS DISTINCT FROM coalesce(to_jsonb(NEW."holdReason"),'null'::jsonb)
   OR (kind='PurchaseRecord' AND after_payload->'receivedDate' IS DISTINCT FROM to_jsonb(NEW."receivedDate"::text))
   OR (kind='PurchaseRecord' AND after_payload->'seller' IS DISTINCT FROM (SELECT jsonb_build_object('type','SUPPLIER','id',s.id,'name',s.name,'active',s.active) FROM vamotors."Supplier" s WHERE s.id=NEW."supplierId"))
   OR (after_payload-paths-(CASE WHEN kind='PurchaseRecord' THEN ARRAY['seller'] ELSE ARRAY[]::text[] END)) IS DISTINCT FROM (old_payload-paths-(CASE WHEN kind='PurchaseRecord' THEN ARRAY['seller'] ELSE ARRAY[]::text[] END))
   THEN RAISE EXCEPTION 'INVALID_STOCK_VERSION' USING ERRCODE='23514'; END IF;
  SELECT coalesce(jsonb_object_agg(f,jsonb_build_object('before',coalesce(old_payload->f,'null'::jsonb),'after',coalesce(after_payload->f,'null'::jsonb))),'{}'::jsonb) INTO delta FROM unnest(paths) f WHERE coalesce(old_payload->f,'null'::jsonb) IS DISTINCT FROM coalesce(after_payload->f,'null'::jsonb);
  IF NOT EXISTS(SELECT 1 FROM vamotors."AuditEntry" a WHERE a."commandId"=c.id AND a."entityType"=kind AND a."entityId"=eid AND a.action=c."commandName" AND a."actorKind"='USER' AND c."actorKey"='USER:'||a."userId"::text AND a."fieldDiff"=delta AND a.xmin=pg_current_xact_id()::xid) THEN RAISE EXCEPTION 'INVALID_STOCK_AUDIT' USING ERRCODE='23514'; END IF;
 END LOOP;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER stock_graph AFTER UPDATE ON vamotors."PurchaseRecord" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vamotors.check_stock_graph();

-- Freeze v6 wildcard/compound ceilings (including create populations) before
-- exposing new operations. Originals remain immutable; only attachments change.
CREATE FUNCTION vamotors.stock_migration_canonical(j jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE jsonb_typeof(j)
 WHEN 'object' THEN '{'||COALESCE((SELECT string_agg(to_jsonb(key)::text||':'||vamotors.stock_migration_canonical(value),',' ORDER BY key COLLATE "C") FROM jsonb_each(j)),'')||'}'
 WHEN 'array' THEN '['||COALESCE((SELECT string_agg(vamotors.stock_migration_canonical(value),',' ORDER BY n) FROM jsonb_array_elements(j) WITH ORDINALITY a(value,n)),'')||']'
 ELSE j::text END
$$;
ALTER TABLE vamotors."RolePermission" DISABLE TRIGGER protected_permissions;
ALTER TABLE vamotors."Role" DISABLE TRIGGER protected_role;
DO $$
DECLARE old record; replacement jsonb; fields jsonb; universe text[]; pid uuid; admin_id uuid; operation text;
BEGIN
 FOR old IN SELECT rp."roleId",p.id,p.rule FROM vamotors."RolePermission" rp JOIN vamotors."Permission" p ON p.id=rp."permissionId" WHERE p.rule->>'subject' IN ('Vehicle','PurchaseRecord') LOOP
  universe:=CASE
   WHEN old.rule->>'subject'='Vehicle' AND old.rule->>'action'='create' THEN ARRAY['engineNumber','chassisNumber','make','model','year','colour','fuelType','transmission','vin','crNumber','notes']
   WHEN old.rule->>'subject'='PurchaseRecord' AND old.rule->>'action'='create' THEN ARRAY['vehicle','supplierId','purchaseDate','purchaseType','purchasePrice','listedPrice','mileage','paymentMethod']
   WHEN old.rule->>'subject'='Vehicle' AND old.rule->>'action'='read' THEN ARRAY['id','status','available','cycleId','revision','listedPrice','identityRevision','holdReason','mileage','provenance','identity.engineNumber','identity.chassisNumber','identity.make','identity.model','identity.year','identity.colour','identity.fuelType','identity.transmission','identity.vin','identity.crNumber','identity.notes','financial.currency','financial.scale','financial.purchase','financial.repairs','financial.additionalCosts','financial.basis','financial.originalProfit','financial.restatedProfit','financial.cashIn','financial.cashOut','financial.net']
   WHEN old.rule->>'subject'='PurchaseRecord' AND old.rule->>'action'='read' THEN ARRAY['id','revision','vehicleId','identityRevision','cycleNumber','purchaseType','acquisitionKind','seller','purchaseDate','purchasePrice','listedPrice','status','available','holdReason','receivedDate','closedAt','payments','outstanding','costs','repairs','mileage','basisVersions','sales','disposal','provenance','nextActions','identity.engineNumber','identity.chassisNumber','identity.make','identity.model','identity.year','identity.colour','identity.fuelType','identity.transmission','identity.vin','identity.crNumber','identity.notes','financial.currency','financial.scale','financial.purchase','financial.repairs','financial.additionalCosts','financial.basis','financial.cashIn','financial.cashOut','financial.net']
   ELSE ARRAY[]::text[] END;
  SELECT COALESCE(jsonb_agg(f ORDER BY f),'[]') INTO fields FROM unnest(universe) f WHERE EXISTS(SELECT 1 FROM jsonb_array_elements_text(old.rule->'fields') p WHERE p='*' OR f=p OR starts_with(f,p||'.'));
  replacement:=jsonb_set(old.rule,'{fields}',fields);
  INSERT INTO vamotors."Permission"(id,"ruleHash",rule) VALUES(gen_random_uuid(),encode(sha256(convert_to(vamotors.stock_migration_canonical(replacement),'UTF8')),'hex'),replacement) ON CONFLICT("ruleHash") DO NOTHING;
  SELECT id INTO pid FROM vamotors."Permission" WHERE "ruleHash"=encode(sha256(convert_to(vamotors.stock_migration_canonical(replacement),'UTF8')),'hex');
  DELETE FROM vamotors."RolePermission" WHERE "roleId"=old."roleId" AND "permissionId"=old.id;
  INSERT INTO vamotors."RolePermission" VALUES(old."roleId",pid) ON CONFLICT DO NOTHING;
 END LOOP;
 SELECT id INTO admin_id FROM vamotors."Role" WHERE "systemKey"='ADMINISTRATOR';
 IF admin_id IS NOT NULL THEN
  FOREACH operation IN ARRAY ARRAY['receive','update','release'] LOOP
   fields:=CASE operation WHEN 'receive' THEN '["date","disposition.kind","disposition.reason"]'::jsonb WHEN 'update' THEN '["reason"]'::jsonb ELSE '["cycleId"]'::jsonb END;
   replacement:=jsonb_build_object('subject','PurchaseRecord','action',operation,'fields',fields);
   INSERT INTO vamotors."Permission"(id,"ruleHash",rule) VALUES(gen_random_uuid(),encode(sha256(convert_to(vamotors.stock_migration_canonical(replacement),'UTF8')),'hex'),replacement) ON CONFLICT("ruleHash") DO NOTHING;
   SELECT id INTO pid FROM vamotors."Permission" WHERE "ruleHash"=encode(sha256(convert_to(vamotors.stock_migration_canonical(replacement),'UTF8')),'hex');
   INSERT INTO vamotors."RolePermission" VALUES(admin_id,pid) ON CONFLICT DO NOTHING;
  END LOOP;
 END IF;
 UPDATE vamotors."Role" SET revision=revision+1;
END $$;
SET CONSTRAINTS ALL IMMEDIATE;
ALTER TABLE vamotors."Role" ENABLE TRIGGER protected_role;
ALTER TABLE vamotors."RolePermission" ENABLE TRIGGER protected_permissions;
DROP FUNCTION vamotors.stock_migration_canonical(jsonb);
COMMIT;
