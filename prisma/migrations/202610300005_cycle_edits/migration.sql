BEGIN;
SELECT value FROM vamotors."BusinessSequence" WHERE id=1 FOR UPDATE;
SELECT vamotors.lock_admin_guard();

-- Exact business DTO diffs, including identity leaves. Array leaves are masked
-- by readers; their immutable complete facts live in the top-level mileage diff.
CREATE FUNCTION vamotors.cycle_edit_diff(old jsonb, after jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT coalesce(jsonb_object_agg(f,jsonb_build_object('before',coalesce(old #> string_to_array(f,'.'),'null'::jsonb),'after',coalesce(after #> string_to_array(f,'.'),'null'::jsonb))),'{}'::jsonb)
 FROM (SELECT jsonb_object_keys(coalesce(old,'{}'::jsonb)||after) f
 UNION SELECT 'identity.'||jsonb_object_keys(coalesce(old->'identity','{}'::jsonb)||coalesce(after->'identity','{}'::jsonb))
 UNION SELECT 'financial.'||jsonb_object_keys(coalesce(old->'financial','{}'::jsonb)||coalesce(after->'financial','{}'::jsonb))
 UNION SELECT 'outstanding.'||jsonb_object_keys(coalesce(old->'outstanding','{}'::jsonb)||coalesce(after->'outstanding','{}'::jsonb))) paths
 WHERE coalesce(old #> string_to_array(f,'.'),'null'::jsonb) IS DISTINCT FROM coalesce(after #> string_to_array(f,'.'),'null'::jsonb)
$$;

CREATE FUNCTION vamotors.check_cycle_edit(old_root vamotors."PurchaseRecord", new_root vamotors."PurchaseRecord", c vamotors."CommandReceipt") RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE v vamotors."Vehicle"; old_payload jsonb; after_payload jsonb; expected jsonb; physical jsonb; miles jsonb; vehicle_miles jsonb; old_vehicle jsonb; kind text; eid uuid; rev integer; correction_reason text;
BEGIN
 SELECT * INTO v FROM vamotors."Vehicle" WHERE id=new_root."vehicleId";
 SELECT payload INTO old_vehicle FROM vamotors."EntityReadVersion" WHERE "entityType"='Vehicle' AND "entityId"=v.id AND sequence<c."businessSequence" ORDER BY sequence DESC LIMIT 1;
 IF c."commandName" NOT IN ('addMileage','setListedPrice','editVehicle') OR c."actorKey" NOT LIKE 'USER:%'
 OR c."environmentId"<>(SELECT id FROM vamotors."Environment" WHERE singleton=1)
 OR NOT EXISTS(SELECT 1 FROM vamotors."BusinessSequence" WHERE id=1 AND value=c."businessSequence" AND xmin=pg_current_xact_id()::xid)
 OR new_root."acquisitionCommandId" IS NULL OR new_root."closedAt" IS NOT NULL OR new_root.status NOT IN ('PURCHASED','IN_STOCK') OR new_root."acquisitionKind"<>'SUPPLIER' OR new_root."purchaseType" NOT IN ('CASH','BRAND_NEW')
 OR v."activePurchaseId" IS DISTINCT FROM new_root.id OR old_vehicle IS NULL
 OR (to_jsonb(new_root)-ARRAY['listedPrice','revision','updatedAt']) IS DISTINCT FROM (to_jsonb(old_root)-ARRAY['listedPrice','revision','updatedAt'])
 OR old_root.revision=2147483647 OR new_root.revision::bigint<>old_root.revision::bigint+1
 OR c.result<>(CASE WHEN c."commandName"='editVehicle' THEN jsonb_build_object('type','Vehicle','id',v.id,'revision',v.revision) ELSE jsonb_build_object('type','PurchaseRecord','id',new_root.id,'revision',new_root.revision) END)
 OR (c."commandName"='setListedPrice' AND (new_root."listedPrice" IS NULL OR new_root."listedPrice" IS NOT DISTINCT FROM old_root."listedPrice" OR v.revision<>(old_vehicle->>'identityRevision')::integer OR EXISTS(SELECT 1 FROM vamotors."Vehicle" WHERE id=v.id AND xmin=pg_current_xact_id()::xid)))
 OR (c."commandName"<>'setListedPrice' AND (new_root."listedPrice" IS DISTINCT FROM old_root."listedPrice" OR v.revision::bigint<>(old_vehicle->>'identityRevision')::bigint+1 OR NOT EXISTS(SELECT 1 FROM vamotors."Vehicle" WHERE id=v.id AND xmin=pg_current_xact_id()::xid)))
 OR EXISTS(SELECT 1 FROM vamotors."StatusEvent" WHERE "commandId"=c.id)
 OR EXISTS(SELECT 1 FROM vamotors."PurchasePayment" WHERE "commandId"=c.id)
 OR EXISTS(SELECT 1 FROM vamotors."CostPayment" WHERE "commandId"=c.id)
 OR EXISTS(SELECT 1 FROM vamotors."CycleBasisVersion" WHERE "commandId"=c.id)
 OR EXISTS(SELECT 1 FROM vamotors."VehicleCost" WHERE xmin=pg_current_xact_id()::xid)
 OR (SELECT count(*) FROM vamotors."EntityReadVersion" WHERE "commandId"=c.id)<>2
 OR (SELECT count(*) FROM vamotors."AuditEntry" WHERE "commandId"=c.id)<>2
 THEN RAISE EXCEPTION 'INVALID_CYCLE_EDIT_GRAPH' USING ERRCODE='23514'; END IF;
 physical:=jsonb_strip_nulls(jsonb_build_object('engineNumber',v."engineNumber",'chassisNumber',v."chassisNumber",'make',v.make,'model',v.model,'year',v.year,'colour',v.colour,'fuelType',v."fuelType",'transmission',v.transmission,'vin',v.vin,'crNumber',v."crNumber",'notes',v.notes));
 SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id',id,'reading',reading,'date',"recordedDate"::text,'remark',remark,'decreaseReason',"decreaseReason")) ORDER BY "recordedDate",id),'[]'::jsonb),
 coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('reading',reading,'date',"recordedDate"::text,'remark',remark,'decreaseReason',"decreaseReason")) ORDER BY "recordedDate",id),'[]'::jsonb)
 INTO miles,vehicle_miles FROM vamotors."MileageReading" WHERE "cycleId"=new_root.id;
 IF (SELECT count(*) FROM vamotors."MileageReading" WHERE "commandId"=c.id)<>(CASE WHEN c."commandName"='addMileage' THEN 1 ELSE 0 END)
 OR EXISTS(SELECT 1 FROM vamotors."MileageReading" m WHERE m."commandId"=c.id AND (m."cycleId"<>new_root.id OR m."vehicleId"<>v.id OR m.xmin<>pg_current_xact_id()::xid OR m."recordedDate"<new_root."purchaseDate"))
 OR EXISTS(SELECT 1 FROM (SELECT reading,"decreaseReason",lag(reading) OVER(ORDER BY "recordedDate",id) previous FROM vamotors."MileageReading" WHERE "vehicleId"=v.id) h WHERE reading<previous AND nullif(btrim("decreaseReason"),'') IS NULL)
 OR (c."commandName"='editVehicle' AND physical IS NOT DISTINCT FROM old_vehicle->'identity')
 OR (c."commandName"<>'editVehicle' AND physical IS DISTINCT FROM old_vehicle->'identity')
 THEN RAISE EXCEPTION 'INVALID_CYCLE_EDIT_HISTORY' USING ERRCODE='23514'; END IF;
 SELECT a.reason INTO correction_reason FROM vamotors."AuditEntry" a WHERE a."commandId"=c.id AND a."entityType"='PurchaseRecord' AND a."entityId"=new_root.id;
 IF (c."commandName"='editVehicle' AND (correction_reason IS NULL OR length(btrim(correction_reason)) NOT BETWEEN 1 AND 2000))
 OR (c."commandName"='addMileage' AND correction_reason IS DISTINCT FROM (SELECT "decreaseReason" FROM vamotors."MileageReading" WHERE "commandId"=c.id)) THEN RAISE EXCEPTION 'INVALID_CYCLE_EDIT_REASON' USING ERRCODE='23514'; END IF;
 FOREACH kind IN ARRAY ARRAY['PurchaseRecord','Vehicle'] LOOP
  eid:=CASE WHEN kind='Vehicle' THEN v.id ELSE new_root.id END; rev:=CASE WHEN kind='Vehicle' THEN v.revision ELSE new_root.revision END;
  SELECT payload INTO old_payload FROM vamotors."EntityReadVersion" WHERE "entityType"=kind AND "entityId"=eid AND sequence<c."businessSequence" ORDER BY sequence DESC LIMIT 1;
  SELECT payload INTO after_payload FROM vamotors."EntityReadVersion" WHERE "commandId"=c.id AND "entityType"=kind AND "entityId"=eid AND revision=rev AND sequence=c."businessSequence" AND xmin=pg_current_xact_id()::xid;
  IF old_payload IS NULL OR after_payload IS NULL OR old_payload->>'revision'<>old_root.revision::text THEN RAISE EXCEPTION 'INVALID_CYCLE_EDIT_VERSION' USING ERRCODE='23514'; END IF;
  -- A current directory presentation is not an edit to immutable old evidence.
  IF kind='PurchaseRecord' THEN old_payload:=jsonb_set(old_payload,'{seller}',(SELECT jsonb_build_object('type','SUPPLIER','id',s.id,'name',s.name,'active',s.active) FROM vamotors."Supplier" s WHERE s.id=new_root."supplierId")); END IF;
  expected:=old_payload||jsonb_build_object('revision',new_root.revision,'identityRevision',v.revision,'identity',physical,'mileage',CASE WHEN kind='Vehicle' THEN vehicle_miles ELSE miles END);
  IF new_root."listedPrice" IS NOT NULL THEN expected:=expected||jsonb_build_object('listedPrice',new_root."listedPrice"::text); END IF;
  IF after_payload IS DISTINCT FROM expected
  OR (c."commandName"<>'addMileage' AND after_payload->'mileage' IS DISTINCT FROM old_payload->'mileage')
  OR (c."commandName"='addMileage' AND (SELECT coalesce(jsonb_agg(value ORDER BY value->>'date',value->>'id'),'[]'::jsonb) FROM jsonb_array_elements(miles) WHERE value->>'id' NOT IN (SELECT id::text FROM vamotors."MileageReading" WHERE "commandId"=c.id)) IS DISTINCT FROM (SELECT payload->'mileage' FROM vamotors."EntityReadVersion" WHERE "entityType"='PurchaseRecord' AND "entityId"=new_root.id AND sequence<c."businessSequence" ORDER BY sequence DESC LIMIT 1))
  OR NOT EXISTS(SELECT 1 FROM vamotors."AuditEntry" a WHERE a."commandId"=c.id AND a."entityType"=kind AND a."entityId"=eid AND a.action=c."commandName" AND a."actorKind"='USER' AND c."actorKey"='USER:'||a."userId"::text AND a."fieldDiff"=vamotors.cycle_edit_diff(old_payload,after_payload) AND a.reason IS NOT DISTINCT FROM correction_reason AND a.xmin=pg_current_xact_id()::xid)
  THEN RAISE EXCEPTION 'INVALID_CYCLE_EDIT_VERSION_AUDIT' USING ERRCODE='23514'; END IF;
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION vamotors.purchase_vehicle_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='INSERT' AND current_user='vamotors_runtime' AND NEW."activePurchaseId" IS NULL THEN RAISE EXCEPTION 'ACQUISITION_EVIDENCE_REQUIRED' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-ARRAY['engineNumber','chassisNumber','normalizedEngine','normalizedChassis','make','model','year','colour','fuelType','transmission','vin','crNumber','notes','revision','updatedAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['engineNumber','chassisNumber','normalizedEngine','normalizedChassis','make','model','year','colour','fuelType','transmission','vin','crNumber','notes','revision','updatedAt'])
  OR OLD.revision=2147483647 OR NEW.revision::bigint<>OLD.revision::bigint+1 OR NOT EXISTS(SELECT 1 FROM vamotors."PurchaseRecord" p WHERE p.id=OLD."activePurchaseId" AND p."vehicleId"=OLD.id AND p."acquisitionCommandId" IS NOT NULL AND p."closedAt" IS NULL AND p.status IN ('PURCHASED','IN_STOCK'))
  OR NEW."normalizedEngine"<>regexp_replace(upper(NEW."engineNumber"),E'[\\t\\n\\r\\f\\v ]','','g') OR NEW."normalizedChassis"<>regexp_replace(upper(NEW."chassisNumber"),E'[\\t\\n\\r\\f\\v ]','','g')
  OR length(NEW."normalizedEngine") NOT BETWEEN 1 AND 100 OR length(NEW."normalizedChassis") NOT BETWEEN 1 AND 100
  OR NEW.year NOT BETWEEN 1886 AND extract(year FROM CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Colombo')::integer+1 OR NEW."fuelType" NOT IN ('PETROL','DIESEL','HYBRID','ELECTRIC','OTHER') OR NEW.transmission NOT IN ('MANUAL','AUTOMATIC','CVT','OTHER')
  THEN RAISE EXCEPTION 'INVALID_PHYSICAL_EDIT' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION vamotors.cycle_edit_vehicle_graph() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE c vamotors."CommandReceipt";
BEGIN
 SELECT r.* INTO c FROM vamotors."CommandReceipt" r JOIN vamotors."EntityReadVersion" e ON e."commandId"=r.id AND e."entityType"='Vehicle' AND e."entityId"=NEW.id AND e.revision=NEW.revision WHERE r.xmin=pg_current_xact_id()::xid AND e.xmin=pg_current_xact_id()::xid;
 IF c.id IS NULL OR c."commandName" NOT IN ('addMileage','editVehicle') OR NOT EXISTS(SELECT 1 FROM vamotors."PurchaseRecord" p WHERE p.id=NEW."activePurchaseId" AND p."vehicleId"=NEW.id AND p.xmin=pg_current_xact_id()::xid)
 OR (c."commandName"='addMileage' AND (to_jsonb(NEW)-ARRAY['revision','updatedAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['revision','updatedAt'])) THEN RAISE EXCEPTION 'PHYSICAL_EDIT_COMMAND_REQUIRED' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER cycle_edit_vehicle_graph AFTER UPDATE ON vamotors."Vehicle" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vamotors.cycle_edit_vehicle_graph();
CREATE FUNCTION vamotors.cycle_edit_mileage_graph() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM vamotors."PurchaseRecord" p JOIN vamotors."CommandReceipt" c ON c.id=NEW."commandId" WHERE p.id=NEW."cycleId" AND p."vehicleId"=NEW."vehicleId" AND (NEW."commandId"=p."acquisitionCommandId" OR (c."commandName"='addMileage' AND p.xmin=pg_current_xact_id()::xid AND c.xmin=pg_current_xact_id()::xid))) THEN RAISE EXCEPTION 'MILEAGE_COMMAND_REQUIRED' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER cycle_edit_mileage_graph AFTER INSERT ON vamotors."MileageReading" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vamotors.cycle_edit_mileage_graph();

-- Forward, guarded textual extensions keep all unrelated accepted guard bytes.
DO $$
DECLARE source text; updated text;
BEGIN
 SELECT pg_get_functiondef('vamotors.acquisition_root_guard()'::regprocedure) INTO source;
 updated:=replace(source,'''purchaseDate'',''purchasePrice'',''notes'',''revision'',''updatedAt''','''purchaseDate'',''purchasePrice'',''notes'',''listedPrice'',''revision'',''updatedAt''');
 IF updated=source THEN RAISE EXCEPTION 'CYCLE_ROOT_BASE_MISMATCH'; END IF; EXECUTE updated;
 SELECT pg_get_functiondef('vamotors.check_acquisition_graph()'::regprocedure) INTO source;
 updated:=replace(source,'FROM vamotors."MileageReading" x WHERE x."cycleId"=cid)<>1','FROM vamotors."MileageReading" x WHERE x."cycleId"=cid AND x."commandId"=p."acquisitionCommandId")<>1');
 updated:=replace(updated,'x."commandId"=p."acquisitionCommandId" AND x."recordedDate">=','x."commandId"=p."acquisitionCommandId" AND x.id=(initial #>> ''{mileage,0,id}'')::uuid AND x.reading=(initial #>> ''{mileage,0,reading}'')::integer AND x."recordedDate"=(initial #>> ''{mileage,0,date}'')::date AND x."recordedDate">=');
 updated:=replace(updated,'OR (p."receivedDate" IS NOT NULL','OR EXISTS(SELECT 1 FROM vamotors."MileageReading" m WHERE m."cycleId"=cid AND m."recordedDate"<p."purchaseDate") OR (p."receivedDate" IS NOT NULL');
 IF updated=source THEN RAISE EXCEPTION 'ACQUISITION_BASE_MISMATCH'; END IF; EXECUTE updated;
 SELECT pg_get_functiondef('vamotors.cycle_cost_root_graph()'::regprocedure) INTO source;
 updated:=replace(source,'IF c.id IS NULL OR c."commandName" NOT IN (''addCost''',E'IF c."commandName" IN (''addMileage'',''setListedPrice'',''editVehicle'') THEN\n  PERFORM vamotors.check_cycle_edit(OLD,NEW,c); RETURN NULL;\n END IF;\n IF c.id IS NULL OR c."commandName" NOT IN (''addCost''');
 IF updated=source THEN RAISE EXCEPTION 'COST_GRAPH_BASE_MISMATCH'; END IF; EXECUTE updated;
END $$;

-- Registry freeze appended below: actual accepted v9, never an unaccepted v10.
CREATE FUNCTION vamotors.cycle_edit_canonical(j jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE jsonb_typeof(j)
 WHEN 'object' THEN '{'||coalesce((SELECT string_agg(to_jsonb(key)::text||':'||vamotors.cycle_edit_canonical(value),',' ORDER BY key COLLATE "C") FROM jsonb_each(j)),'')||'}'
 WHEN 'array' THEN '['||coalesce((SELECT string_agg(vamotors.cycle_edit_canonical(value),',' ORDER BY n) FROM jsonb_array_elements(j) WITH ORDINALITY a(value,n)),'')||']'
 ELSE j::text END
$$;
ALTER TABLE vamotors."RolePermission" DISABLE TRIGGER protected_permissions;
ALTER TABLE vamotors."Role" DISABLE TRIGGER protected_role;
DO $$
DECLARE old record; replacement jsonb; fields jsonb; universe text[]; pid uuid; admin_id uuid;
BEGIN
 -- These are the only growing old actions. All other action universes (including
 -- create/delegation/Quote/RateSheet) are byte-unchanged and retain their ceilings.
 FOR old IN SELECT rp."roleId",p.id,p.rule FROM vamotors."RolePermission" rp JOIN vamotors."Permission" p ON p.id=rp."permissionId" WHERE (p.rule->>'subject' IN ('Vehicle','PurchaseRecord') AND p.rule->>'action'='read') OR (p.rule->>'subject'='PurchaseRecord' AND p.rule->>'action'='update') LOOP
  universe:=CASE
  WHEN old.rule->>'action'='update' THEN ARRAY['reason','cycleId','patch.purchaseDate','patch.purchasePrice','patch.notes']
  WHEN old.rule->>'subject'='Vehicle' THEN ARRAY['id','status','available','cycleId','revision','listedPrice','identityRevision','holdReason','mileage.reading','mileage.date','mileage.remark','mileage.decreaseReason','provenance','identity.engineNumber','identity.chassisNumber','identity.make','identity.model','identity.year','identity.colour','identity.fuelType','identity.transmission','identity.vin','identity.crNumber','identity.notes','financial.currency','financial.scale','financial.purchase','financial.repairs','financial.additionalCosts','financial.basis','financial.originalProfit','financial.restatedProfit','financial.cashIn','financial.cashOut','financial.net']
  ELSE ARRAY['id','revision','vehicleId','identityRevision','cycleNumber','purchaseType','acquisitionKind','seller','purchaseDate','purchasePrice','listedPrice','notes','status','available','holdReason','receivedDate','closedAt','payments.id','payments.owner.type','payments.owner.id','payments.commandId','payments.amount','payments.direction','payments.category','payments.date','payments.method','payments.recordedAt','payments.reference','payments.reversalOf','payments.reason','outstanding.seller','outstanding.settlement','costs.id','costs.revision','costs.category','costs.description','costs.amount','costs.incurredDate','costs.payments.id','costs.payments.owner.type','costs.payments.owner.id','costs.payments.commandId','costs.payments.amount','costs.payments.direction','costs.payments.category','costs.payments.date','costs.payments.method','costs.payments.recordedAt','costs.payments.reference','costs.payments.reversalOf','costs.payments.reason','costs.outstanding','costs.provenance','repairs','mileage.id','mileage.reading','mileage.date','mileage.remark','mileage.decreaseReason','basisVersions.id','basisVersions.version','basisVersions.total','basisVersions.reason','sales','disposal','provenance','nextActions','identity.engineNumber','identity.chassisNumber','identity.make','identity.model','identity.year','identity.colour','identity.fuelType','identity.transmission','identity.vin','identity.crNumber','identity.notes','financial.currency','financial.scale','financial.purchase','financial.repairs','financial.additionalCosts','financial.basis','financial.cashIn','financial.cashOut','financial.net'] END;
  SELECT coalesce(jsonb_agg(f ORDER BY f),'[]'::jsonb) INTO fields FROM unnest(universe) f WHERE EXISTS(SELECT 1 FROM jsonb_array_elements_text(old.rule->'fields') selected WHERE selected='*' OR selected=f OR starts_with(f,selected||'.'));
  replacement:=jsonb_set(old.rule,'{fields}',fields);
  INSERT INTO vamotors."Permission"(id,"ruleHash",rule) VALUES(gen_random_uuid(),encode(sha256(convert_to(vamotors.cycle_edit_canonical(replacement),'UTF8')),'hex'),replacement) ON CONFLICT("ruleHash") DO NOTHING;
  SELECT id INTO pid FROM vamotors."Permission" WHERE "ruleHash"=encode(sha256(convert_to(vamotors.cycle_edit_canonical(replacement),'UTF8')),'hex');
  DELETE FROM vamotors."RolePermission" WHERE "roleId"=old."roleId" AND "permissionId"=old.id;
  INSERT INTO vamotors."RolePermission" VALUES(old."roleId",pid) ON CONFLICT DO NOTHING;
 END LOOP;
 SELECT id INTO admin_id FROM vamotors."Role" WHERE "systemKey"='ADMINISTRATOR';
 IF admin_id IS NOT NULL THEN
  FOR replacement IN SELECT value FROM jsonb_array_elements('[{"subject":"Vehicle","action":"read","fields":["*"]},{"subject":"PurchaseRecord","action":"read","fields":["*"]},{"subject":"Vehicle","action":"update","fields":["*"]},{"subject":"PurchaseRecord","action":"update","fields":["*"]}]'::jsonb) LOOP
   INSERT INTO vamotors."Permission"(id,"ruleHash",rule) VALUES(gen_random_uuid(),encode(sha256(convert_to(vamotors.cycle_edit_canonical(replacement),'UTF8')),'hex'),replacement) ON CONFLICT("ruleHash") DO NOTHING;
   SELECT id INTO pid FROM vamotors."Permission" WHERE "ruleHash"=encode(sha256(convert_to(vamotors.cycle_edit_canonical(replacement),'UTF8')),'hex');
   INSERT INTO vamotors."RolePermission" VALUES(admin_id,pid) ON CONFLICT DO NOTHING;
  END LOOP;
 END IF;
 UPDATE vamotors."Role" SET revision=revision+1;
END $$;
SET CONSTRAINTS ALL IMMEDIATE;
ALTER TABLE vamotors."Role" ENABLE TRIGGER protected_role;
ALTER TABLE vamotors."RolePermission" ENABLE TRIGGER protected_permissions;
DROP FUNCTION vamotors.cycle_edit_canonical(jsonb);
COMMIT;
