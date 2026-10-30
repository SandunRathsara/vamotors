BEGIN;
SELECT value FROM vamotors."BusinessSequence" WHERE id=1 FOR UPDATE;
SELECT vamotors.lock_admin_guard();

CREATE TABLE vamotors."LeasePurchaseDetail" (
 id uuid PRIMARY KEY,
 "purchaseRecordId" uuid NOT NULL UNIQUE REFERENCES vamotors."PurchaseRecord"(id) ON DELETE RESTRICT,
 "institutionType" text NOT NULL CHECK("institutionType" IN ('FINANCE_COMPANY','BANK','PRIVATE_PARTY')),
 "companyId" uuid REFERENCES vamotors."FinanceCompany"(id) ON DELETE RESTRICT,
 "institutionNameSnapshot" text NOT NULL CHECK("institutionNameSnapshot"=btrim("institutionNameSnapshot") AND length("institutionNameSnapshot") BETWEEN 1 AND 200),
 reference text NOT NULL CHECK(reference=btrim(reference) AND length(reference) BETWEEN 1 AND 200),
 amount bigint NOT NULL CHECK(amount BETWEEN 0 AND 99999999999999),
 "cashToSeller" bigint NOT NULL CHECK("cashToSeller" BETWEEN 0 AND 99999999999999),
 CHECK (("institutionType"='FINANCE_COMPANY')=("companyId" IS NOT NULL)),
 CHECK (amount::numeric+"cashToSeller"::numeric BETWEEN 1 AND 9999999999999999)
);
ALTER TABLE vamotors."PurchasePayment" DROP CONSTRAINT "PurchasePayment_category_check",
 ADD CONSTRAINT "PurchasePayment_category_check" CHECK(category IN ('SELLER','SETTLEMENT'));
-- Only derived current purchase/basis storage widens to C. Entered components
-- and cash/brand-new prices stay A-bounded in the graph checks below.
ALTER TABLE vamotors."PurchaseRecord" DROP CONSTRAINT "PurchaseRecord_purchasePrice_check",
 ADD CONSTRAINT "PurchaseRecord_purchasePrice_check" CHECK("purchasePrice" BETWEEN 0 AND 9999999999999999);
ALTER TABLE vamotors."CycleBasisVersion" DROP CONSTRAINT "CycleBasisVersion_purchase_check",
 ADD CONSTRAINT "CycleBasisVersion_purchase_check" CHECK(purchase BETWEEN 0 AND 9999999999999999);

CREATE FUNCTION vamotors.settlement_json(cid uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_strip_nulls(jsonb_build_object('institutionType',d."institutionType",'companyId',d."companyId",'institutionName',CASE WHEN d."institutionType"<>'FINANCE_COMPANY' THEN d."institutionNameSnapshot" END,'institutionNameSnapshot',d."institutionNameSnapshot",'reference',d.reference,'amount',d.amount::text,'cashToSeller',d."cashToSeller"::text))
 FROM vamotors."LeasePurchaseDetail" d JOIN vamotors."PurchaseRecord" p ON p.id=d."purchaseRecordId" WHERE p.id=cid AND p."purchaseType"='LEASE_SETTLEMENT'
$$;
CREATE FUNCTION vamotors.purchase_outstanding_json(cid uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('seller',((CASE WHEN p."purchaseType"='LEASE_SETTLEMENT' THEN d."cashToSeller" ELSE p."purchasePrice" END)-coalesce((SELECT sum(CASE direction WHEN 'OUT' THEN amount::numeric ELSE -amount::numeric END) FROM vamotors."PurchasePayment" WHERE "cycleId"=cid AND category='SELLER'),0))::text,
 'settlement',((CASE WHEN p."purchaseType"='LEASE_SETTLEMENT' THEN d.amount ELSE 0 END)-coalesce((SELECT sum(CASE direction WHEN 'OUT' THEN amount::numeric ELSE -amount::numeric END) FROM vamotors."PurchasePayment" WHERE "cycleId"=cid AND category='SETTLEMENT'),0))::text)
 FROM vamotors."PurchaseRecord" p LEFT JOIN vamotors."LeasePurchaseDetail" d ON d."purchaseRecordId"=p.id WHERE p.id=cid
$$;
CREATE FUNCTION vamotors.purchase_payee(terms jsonb, category text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT CASE WHEN category='SELLER' THEN terms#>>'{seller,type}'||':'||(terms#>>'{seller,id}')
 WHEN terms->>'purchaseType'<>'LEASE_SETTLEMENT' THEN NULL
 WHEN terms#>>'{settlement,institutionType}'='FINANCE_COMPANY' THEN 'FINANCE_COMPANY:'||(terms#>>'{settlement,companyId}')
 ELSE terms#>>'{settlement,institutionType}'||':'||(terms#>>'{settlement,institutionNameSnapshot}') END
$$;

CREATE OR REPLACE FUNCTION vamotors.check_acquisition_graph() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE cid uuid; p vamotors."PurchaseRecord"; initial jsonb; policy jsonb; latest vamotors."CycleBasisVersion"; total numeric; paid numeric; seller_amount numeric; settlement_amount numeric; original_payment vamotors."PurchasePayment"; original_terms jsonb; current_terms jsonb;
BEGIN
 IF TG_TABLE_NAME='PurchaseRecord' THEN cid:=NEW.id; ELSE cid:=NEW."cycleId"; END IF;
 SELECT * INTO p FROM vamotors."PurchaseRecord" WHERE id=cid;
 IF p."acquisitionCommandId" IS NULL THEN
  IF TG_TABLE_NAME<>'PurchaseRecord' THEN RAISE EXCEPTION 'ACQUISITION_EVIDENCE_REQUIRED' USING ERRCODE='23514'; END IF; RETURN NULL;
 END IF;
 SELECT payload INTO initial FROM vamotors."EntityReadVersion" WHERE "commandId"=p."acquisitionCommandId" AND "entityType"='PurchaseRecord' AND "entityId"=cid AND revision=1;
 SELECT values INTO policy FROM vamotors."SettingsVersion" WHERE id=p."settingsVersionId";
 seller_amount:=CASE WHEN initial->>'purchaseType'='LEASE_SETTLEMENT' THEN (initial#>>'{settlement,cashToSeller}')::numeric ELSE (initial->>'purchasePrice')::numeric END;
 settlement_amount:=CASE WHEN initial->>'purchaseType'='LEASE_SETTLEMENT' THEN (initial#>>'{settlement,amount}')::numeric ELSE 0 END;
 IF initial IS NULL OR initial->>'purchaseType' NOT IN ('CASH','BRAND_NEW','LEASE_SETTLEMENT') OR seller_amount IS NULL OR settlement_amount IS NULL
 OR seller_amount NOT BETWEEN 0 AND 99999999999999 OR settlement_amount NOT BETWEEN 0 AND 99999999999999 OR seller_amount+settlement_amount NOT BETWEEN 1 AND 9999999999999999 OR (initial->>'purchasePrice')::numeric<>seller_amount+settlement_amount
 OR NOT EXISTS(SELECT 1 FROM vamotors."CommandReceipt" c WHERE c.id=p."acquisitionCommandId" AND c."commandName"='recordPurchase' AND c."actorKey"='USER:'||p."createdBy"::text AND c."businessSequence">0 AND c.result=jsonb_build_object('type','PurchaseRecord','id',p.id,'revision',1))
 OR NOT EXISTS(SELECT 1 FROM vamotors."Vehicle" v WHERE v.id=p."vehicleId" AND v."createdBy"=p."createdBy" AND v."activePurchaseId"=p.id)
 OR (TG_TABLE_NAME='PurchaseRecord' AND TG_OP='INSERT' AND NOT EXISTS(SELECT 1 FROM vamotors."Supplier" s WHERE s.id=p."supplierId" AND s.active AND (p."purchaseType"<>'BRAND_NEW' OR s.category='COMPANY')))
 OR (SELECT count(*) FROM vamotors."PurchasePayment" x WHERE x."cycleId"=cid AND x."commandId"=p."acquisitionCommandId")<>((seller_amount>0)::integer+(settlement_amount>0)::integer)
 OR EXISTS(SELECT 1 FROM (VALUES ('SELLER',seller_amount,'seller'),('SETTLEMENT',settlement_amount,'settlement')) component(category,amount,key) WHERE component.amount>0 AND NOT EXISTS(SELECT 1 FROM vamotors."PurchasePayment" x WHERE x."cycleId"=cid AND x."commandId"=p."acquisitionCommandId" AND x.category=component.category AND x.amount=component.amount AND x.direction='OUT' AND x."occurredDate"=(initial->>'purchaseDate')::date AND x."reversalOf" IS NULL AND x.currency=policy->>'currency' AND x.scale=2 AND x."lineKey"=component.key))
 OR (SELECT count(DISTINCT method) FROM vamotors."PurchasePayment" WHERE "commandId"=p."acquisitionCommandId")<>1
 OR (SELECT count(*) FROM vamotors."MileageReading" x WHERE x."cycleId"=cid AND x."commandId"=p."acquisitionCommandId")<>1
 OR (SELECT count(*) FROM vamotors."MileageReading" x WHERE x."cycleId"=cid)<>1
 OR NOT EXISTS(SELECT 1 FROM vamotors."MileageReading" x WHERE x."cycleId"=cid AND x."commandId"=p."acquisitionCommandId" AND x."recordedDate">=(initial->>'purchaseDate')::date AND x."recordedDate">=p."purchaseDate")
 OR NOT EXISTS(SELECT 1 FROM vamotors."CycleBasisVersion" x WHERE x."cycleId"=cid AND x."commandId"=p."acquisitionCommandId" AND x.version=1 AND x.purchase=(initial->>'purchasePrice')::bigint AND x.total=x.purchase AND x.components=jsonb_build_object('purchase',x.purchase::text,'repairs','[]'::jsonb,'costs','[]'::jsonb) AND x.currency=policy->>'currency' AND x.scale=2 AND x."supersedesId" IS NULL)
 OR (SELECT count(*) FROM vamotors."StatusEvent" s WHERE s."cycleId"=cid AND s."commandId"=p."acquisitionCommandId" AND s."from" IS NULL AND s."to"='PURCHASED' AND s.action='recordPurchase' AND s."userId"=p."createdBy" AND s."occurredAt"=(initial->>'purchaseDate')::date::timestamp)<>1
 OR NOT EXISTS(SELECT 1 FROM vamotors."AuditEntry" a WHERE a."commandId"=p."acquisitionCommandId" AND a."entityType"='PurchaseRecord' AND a."entityId"=cid)
 OR NOT EXISTS(SELECT 1 FROM vamotors."EntityReadVersion" v WHERE v."commandId"=p."acquisitionCommandId" AND v."entityType"='Vehicle' AND v."entityId"=p."vehicleId" AND v.revision=1)
 THEN RAISE EXCEPTION 'INVALID_ACQUISITION_GRAPH' USING ERRCODE='23514'; END IF;
 IF p."purchaseType"='LEASE_SETTLEMENT' THEN
  IF NOT EXISTS(SELECT 1 FROM vamotors."LeasePurchaseDetail" d WHERE d."purchaseRecordId"=cid AND d.amount::numeric+d."cashToSeller"=p."purchasePrice") THEN RAISE EXCEPTION 'INVALID_SETTLEMENT_TOTAL' USING ERRCODE='23514'; END IF;
 ELSIF p."purchasePrice">99999999999999 THEN RAISE EXCEPTION 'MONEY_OVERFLOW' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='PurchaseRecord' AND TG_OP='INSERT' THEN
  IF initial->>'purchaseType' IS DISTINCT FROM p."purchaseType" OR initial->>'purchaseDate' IS DISTINCT FROM p."purchaseDate"::text OR initial->>'purchasePrice' IS DISTINCT FROM p."purchasePrice"::text OR initial->'settlement' IS DISTINCT FROM vamotors.settlement_json(cid)
   OR initial->>'status'<>'PURCHASED' OR initial->'available'<>'false'::jsonb OR initial->>'revision'<>'1'
   OR (p."purchaseType"='LEASE_SETTLEMENT' AND EXISTS(SELECT 1 FROM vamotors."LeasePurchaseDetail" d JOIN vamotors."FinanceCompany" f ON f.id=d."companyId" WHERE d."purchaseRecordId"=cid AND (NOT f.active OR f.name<>d."institutionNameSnapshot"))) THEN RAISE EXCEPTION 'INVALID_INITIAL_SETTLEMENT' USING ERRCODE='23514'; END IF;
 END IF;
 SELECT p."purchasePrice"+coalesce(sum(amount::numeric),0) INTO total FROM vamotors."VehicleCost" WHERE "cycleId"=cid;
 SELECT * INTO latest FROM vamotors."CycleBasisVersion" WHERE "cycleId"=cid ORDER BY version DESC LIMIT 1;
 IF total>9999999999999999 OR latest.total IS DISTINCT FROM total OR latest.purchase<>p."purchasePrice" OR latest.components<>jsonb_build_object('purchase',p."purchasePrice"::text,'repairs','[]'::jsonb,'costs',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'amount',amount::text) ORDER BY id) FROM vamotors."VehicleCost" WHERE "cycleId"=cid),'[]'::jsonb))
 OR (SELECT count(*) FROM vamotors."CycleBasisVersion" WHERE "cycleId"=cid)<>latest.version
 OR EXISTS(SELECT 1 FROM vamotors."CycleBasisVersion" b LEFT JOIN vamotors."CycleBasisVersion" prev ON prev.id=b."supersedesId" AND prev."cycleId"=cid AND prev.version=b.version-1 WHERE b."cycleId"=cid AND (b.currency<>policy->>'currency' OR b.scale<>2 OR (b.version>1 AND prev.id IS NULL)))
 OR EXISTS(SELECT 1 FROM vamotors."VehicleCost" WHERE "cycleId"=cid AND "incurredDate"<p."purchaseDate")
 OR EXISTS(SELECT 1 FROM vamotors."MileageReading" WHERE "cycleId"=cid AND "recordedDate"<p."purchaseDate")
 OR (p."receivedDate" IS NOT NULL AND p."receivedDate"<p."purchaseDate") THEN RAISE EXCEPTION 'INVALID_CYCLE_BASIS' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_each_text(vamotors.purchase_outstanding_json(cid)) x WHERE x.value::numeric<0)
 OR EXISTS(SELECT 1 FROM vamotors."PurchasePayment" x WHERE x."cycleId"=cid AND x."reversalOf" IS NULL AND NOT EXISTS(SELECT 1 FROM vamotors."PurchasePayment" r WHERE r."reversalOf"=x.id) AND x."occurredDate"<p."purchaseDate") THEN RAISE EXCEPTION 'INVALID_PURCHASE_BALANCE' USING ERRCODE='23514'; END IF;
 SELECT jsonb_build_object('purchaseType',p."purchaseType",'seller',jsonb_build_object('type','SUPPLIER','id',p."supplierId"),'settlement',vamotors.settlement_json(cid)) INTO current_terms;
 FOR original_payment IN SELECT * FROM vamotors."PurchasePayment" x WHERE x."cycleId"=cid AND x."reversalOf" IS NULL AND NOT EXISTS(SELECT 1 FROM vamotors."PurchasePayment" r WHERE r."reversalOf"=x.id) LOOP
  SELECT e.payload INTO original_terms FROM vamotors."EntityReadVersion" e JOIN vamotors."CommandReceipt" c ON c.id=original_payment."commandId" AND e.sequence=c."businessSequence" AND e."commandId"=c.id WHERE e."entityType"='PurchaseRecord' AND e."entityId"=cid;
  IF original_terms IS NULL OR vamotors.purchase_payee(original_terms,original_payment.category) IS DISTINCT FROM vamotors.purchase_payee(current_terms,original_payment.category) THEN RAISE EXCEPTION 'LIVE_PAYEE_CHANGE' USING ERRCODE='23514'; END IF;
 END LOOP;
 RETURN NULL;
END $$;

-- Extend the existing guards, not replace their unrelated stock/cost proofs.
-- Assert each old fragment exists: a changed accepted base must be reconciled,
-- never silently install a partly transformed guard.
DO $$
DECLARE definition text; before text; replacement text; target text; pair text[];
BEGIN
 SELECT pg_get_functiondef('vamotors.acquisition_root_guard()'::regprocedure) INTO definition;
 FOREACH pair SLICE 1 IN ARRAY ARRAY[
  ARRAY['ARRAY[''purchaseDate'',''purchasePrice'',''notes'',''revision'',''updatedAt'']','ARRAY[''purchaseDate'',''purchasePrice'',''purchaseType'',''supplierId'',''notes'',''revision'',''updatedAt'']'],
  ARRAY['NEW."purchaseType" NOT IN (''CASH'',''BRAND_NEW'')','NEW."purchaseType" NOT IN (''CASH'',''BRAND_NEW'',''LEASE_SETTLEMENT'')']
 ] LOOP
  IF strpos(definition,pair[1])=0 THEN RAISE EXCEPTION 'SETTLEMENT_ROOT_BASE_MISMATCH'; END IF;
  definition:=replace(definition,pair[1],pair[2]);
 END LOOP;
 EXECUTE definition;
 SELECT pg_get_functiondef('vamotors.cycle_cost_root_graph()'::regprocedure) INTO definition;
 FOREACH pair SLICE 1 IN ARRAY ARRAY[
  ARRAY['ROW(NEW."purchaseDate",NEW."purchasePrice",NEW.notes) IS DISTINCT FROM ROW(OLD."purchaseDate",OLD."purchasePrice",OLD.notes)','ROW(NEW."purchaseDate",NEW."purchasePrice",NEW."purchaseType",NEW."supplierId",NEW.notes) IS DISTINCT FROM ROW(OLD."purchaseDate",OLD."purchasePrice",OLD."purchaseType",OLD."supplierId",OLD.notes)'],
  ARRAY['jsonb_build_object(''seller'',(NEW."purchasePrice"-coalesce((SELECT sum(CASE direction WHEN ''OUT'' THEN amount::numeric ELSE -amount::numeric END) FROM vamotors."PurchasePayment" WHERE "cycleId"=NEW.id),0))::text,''settlement'',''0'')','vamotors.purchase_outstanding_json(NEW.id)'],
  ARRAY['OR after_payload->>''notes'' IS DISTINCT FROM NEW.notes','OR after_payload->>''notes'' IS DISTINCT FROM NEW.notes OR after_payload->>''purchaseType'' IS DISTINCT FROM NEW."purchaseType" OR after_payload->''settlement'' IS DISTINCT FROM vamotors.settlement_json(NEW.id)'],
  ARRAY['''purchasePrice'',''notes'',''outstanding'',''seller'']','''purchasePrice'',''purchaseType'',''settlement'',''notes'',''outstanding'',''seller'']'],
  ARRAY['IF kind=''PurchaseRecord'' THEN old_payload:=jsonb_set(old_payload,''{seller}'',after_payload->''seller''); END IF;','IF kind=''PurchaseRecord'' THEN old_payload:=jsonb_set(old_payload,''{seller}'',(SELECT jsonb_build_object(''type'',''SUPPLIER'',''id'',s.id,''name'',s.name,''active'',s.active) FROM vamotors."Supplier" s WHERE s.id=OLD."supplierId")); END IF;']
 ] LOOP
  IF strpos(definition,pair[1])=0 THEN RAISE EXCEPTION 'SETTLEMENT_MONEY_BASE_MISMATCH'; END IF;
  definition:=replace(definition,pair[1],pair[2]);
 END LOOP;
 EXECUTE definition;
 SELECT pg_get_functiondef('vamotors.cycle_cost_diff(text,jsonb,jsonb)'::regprocedure) INTO definition;
 before:='''purchaseType'',''acquisitionKind''';
 IF strpos(definition,before)=0 THEN RAISE EXCEPTION 'SETTLEMENT_DIFF_BASE_MISMATCH'; END IF;
 EXECUTE replace(definition,before,'''purchaseType'',''settlement.institutionType'',''settlement.companyId'',''settlement.institutionName'',''settlement.institutionNameSnapshot'',''settlement.reference'',''settlement.amount'',''settlement.cashToSeller'',''acquisitionKind''');
 SELECT pg_get_functiondef('vamotors.cycle_cost_child_graph()'::regprocedure) INTO definition;
 before:='AND NEW."lineKey"=''seller''';
 IF strpos(definition,before)=0 THEN RAISE EXCEPTION 'SETTLEMENT_CHILD_BASE_MISMATCH'; END IF;
 definition:=replace(definition,before,'AND NEW."lineKey" IN (''seller'',''settlement'')');
 -- A replacement must inherit the reversed component, not merely its owner.
 before:='m.direction=''IN'' AND m."sourceType"';
 IF strpos(definition,before)=0 THEN RAISE EXCEPTION 'SETTLEMENT_REPLACEMENT_BASE_MISMATCH'; END IF;
 definition:=replace(definition,before,'m.direction=''IN'' AND m.category=NEW.category AND m."sourceType"');
 EXECUTE definition;
END $$;

CREATE FUNCTION vamotors.settlement_detail_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE p vamotors."PurchaseRecord"; c vamotors."CommandReceipt"; payload jsonb; prior jsonb; payment vamotors."PurchasePayment"; old_terms jsonb;
BEGIN
 IF TG_OP='UPDATE' AND (NEW.id<>OLD.id OR NEW."purchaseRecordId"<>OLD."purchaseRecordId") THEN RAISE EXCEPTION 'IMMUTABLE_SETTLEMENT_OWNER' USING ERRCODE='23514'; END IF;
 SELECT * INTO p FROM vamotors."PurchaseRecord" WHERE id=NEW."purchaseRecordId" AND xmin=pg_current_xact_id()::xid;
 SELECT r.* INTO c FROM vamotors."CommandReceipt" r JOIN vamotors."EntityReadVersion" e ON e."commandId"=r.id AND e."entityType"='PurchaseRecord' AND e."entityId"=p.id AND e.revision=p.revision WHERE r.xmin=pg_current_xact_id()::xid AND e.xmin=pg_current_xact_id()::xid;
 IF p.id IS NULL OR p."purchaseType"<>'LEASE_SETTLEMENT' OR p."closedAt" IS NOT NULL OR p.status NOT IN ('PURCHASED','IN_STOCK') OR c.id IS NULL OR c."commandName" NOT IN ('recordPurchase','editPurchase') OR c."businessSequence"<>(SELECT value FROM vamotors."BusinessSequence" WHERE id=1) THEN RAISE EXCEPTION 'SETTLEMENT_COMMAND_REQUIRED' USING ERRCODE='23514'; END IF;
 SELECT e.payload INTO payload FROM vamotors."EntityReadVersion" e WHERE e."commandId"=c.id AND e."entityType"='PurchaseRecord' AND e."entityId"=p.id;
 IF payload->'settlement' IS DISTINCT FROM vamotors.settlement_json(p.id) OR NEW.amount::numeric+NEW."cashToSeller"<>p."purchasePrice" THEN RAISE EXCEPTION 'INVALID_SETTLEMENT_VERSION' USING ERRCODE='23514'; END IF;
 -- References/amounts may change; immutable original payment payees may not.
 SELECT e.payload INTO prior FROM vamotors."EntityReadVersion" e WHERE e."entityType"='PurchaseRecord' AND e."entityId"=p.id AND e.sequence<c."businessSequence" ORDER BY e.sequence DESC LIMIT 1;
 IF NEW."companyId" IS NOT NULL AND (prior#>>'{settlement,companyId}' IS DISTINCT FROM NEW."companyId"::text) AND NOT EXISTS(SELECT 1 FROM vamotors."FinanceCompany" f WHERE f.id=NEW."companyId" AND f.active AND f.name=NEW."institutionNameSnapshot") THEN RAISE EXCEPTION 'INVALID_SETTLEMENT_COMPANY' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER settlement_graph AFTER INSERT OR UPDATE ON vamotors."LeasePurchaseDetail" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vamotors.settlement_detail_guard();
-- No deletion is needed on leaving lease: omit the current projection, retain
-- the last detail and every immutable historical version/payment/audit.
CREATE TRIGGER no_delete BEFORE DELETE OR TRUNCATE ON vamotors."LeasePurchaseDetail" FOR EACH STATEMENT EXECUTE FUNCTION vamotors.append_only();

-- Actual accepted d0 v10: all 16 subjects / 50 actions, including compound
-- ImportBatch.uploads and Document.target gates. Preserve compound fields when
-- their subtree is unchanged; flattening every compound loses gate authority.
CREATE FUNCTION vamotors.settlement_migration_canonical(j jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE jsonb_typeof(j)
 WHEN 'object' THEN '{'||coalesce((SELECT string_agg(to_jsonb(key)::text||':'||vamotors.settlement_migration_canonical(value),',' ORDER BY key COLLATE "C") FROM jsonb_each(j)),'')||'}'
 WHEN 'array' THEN '['||coalesce((SELECT string_agg(vamotors.settlement_migration_canonical(value),',' ORDER BY n) FROM jsonb_array_elements(j) WITH ORDINALITY a(value,n)),'')||']'
 ELSE j::text END
$$;
ALTER TABLE vamotors."RolePermission" DISABLE TRIGGER protected_permissions;
ALTER TABLE vamotors."Role" DISABLE TRIGGER protected_role;
DO $$
DECLARE old record; replacement jsonb; fields jsonb; pid uuid; admin_id uuid; universe jsonb :=
'{"User":{"read":["id","revision","name","email","active","roles","authzRevision","createdAt","updatedAt","adminProtection"],"create":["name","email","password","roleIds"],"update":["name","active","roleIds"]},"Role":{"read":["id","revision","name","active","systemKey","grants"],"create":["name","grants"],"update":["name","grants"],"archive":["active"]},"Vehicle":{"read":["id","identity","status","available","cycleId","revision","listedPrice","financial","financial.purchase","financial.repairs","financial.additionalCosts","financial.basis","financial.originalProfit","financial.restatedProfit","identityRevision","holdReason","mileage","provenance","identity.engineNumber","identity.chassisNumber","identity.make","identity.model","identity.year","identity.colour","identity.fuelType","identity.transmission","identity.vin","identity.crNumber","identity.notes","financial.currency","financial.scale","financial.cashIn","financial.cashOut","financial.net"],"create":["engineNumber","chassisNumber","make","model","year","colour","fuelType","transmission","vin","crNumber","notes"]},"Customer":{"read":["id","revision","fullName","callingName","nicOrPassport","address","phone","email","drivingLicence","notes","active","provenance","links"],"create":["fullName","callingName","nicOrPassport","address","phone","email","drivingLicence","notes"],"update":["fullName","callingName","nicOrPassport","address","phone","email","drivingLicence","notes"],"archive":["active"]},"PurchaseRecord":{"read":["id","revision","vehicleId","identity","identityRevision","cycleNumber","purchaseType","acquisitionKind","seller","purchaseDate","purchasePrice","listedPrice","status","available","holdReason","receivedDate","closedAt","payments","outstanding","costs","repairs","mileage","financial","basisVersions","sales","disposal","provenance","nextActions","notes","payments.id","payments.owner.type","payments.owner.id","payments.commandId","payments.amount","payments.direction","payments.category","payments.date","payments.method","payments.recordedAt","payments.reference","payments.reversalOf","payments.reason","outstanding.seller","outstanding.settlement","costs.id","costs.revision","costs.category","costs.description","costs.amount","costs.incurredDate","costs.payments","costs.payments.id","costs.payments.owner.type","costs.payments.owner.id","costs.payments.commandId","costs.payments.amount","costs.payments.direction","costs.payments.category","costs.payments.date","costs.payments.method","costs.payments.recordedAt","costs.payments.reference","costs.payments.reversalOf","costs.payments.reason","costs.outstanding","costs.provenance","basisVersions.id","basisVersions.version","basisVersions.total","basisVersions.reason","identity.engineNumber","identity.chassisNumber","identity.make","identity.model","identity.year","identity.colour","identity.fuelType","identity.transmission","identity.vin","identity.crNumber","identity.notes","financial.currency","financial.scale","financial.purchase","financial.repairs","financial.additionalCosts","financial.basis","financial.cashIn","financial.cashOut","financial.net"],"create":["vehicle","supplierId","purchaseDate","purchaseType","purchasePrice","listedPrice","mileage","paymentMethod"],"receive":["date","disposition.kind","disposition.reason"],"update":["reason","cycleId","patch.purchaseDate","patch.purchasePrice","patch.notes"],"release":["cycleId"],"pay":["cycleId","recipient","payment.amount","payment.date","payment.method","payment.reference","sourceType","sourceId","paymentId","reason","replacement.amount","replacement.date","replacement.method","replacement.reference","cashCorrections.paymentId","cashCorrections.reason","cashCorrections.replacement.amount","cashCorrections.replacement.date","cashCorrections.replacement.method","cashCorrections.replacement.reference"]},"VehicleCost":{"read":["id","revision","category","description","amount","incurredDate","payments","payments.id","payments.owner.type","payments.owner.id","payments.commandId","payments.amount","payments.direction","payments.category","payments.date","payments.method","payments.recordedAt","payments.reference","payments.reversalOf","payments.reason","outstanding","provenance"],"create":["cycleId","category","description","amount","incurredDate"],"update":["costId","category","description","amount","incurredDate","reason"],"pay":["costId","payment.amount","payment.date","payment.method","payment.reference","sourceType","sourceId","paymentId","reason","replacement.amount","replacement.date","replacement.method","replacement.reference"]},"Supplier":{"read":["id","revision","type","name","category","active","contacts","provenance","directory.name","directory.category","directory.nicOrRegNumber","directory.address","directory.phone","directory.hotline","directory.recurring","directory.notes","directory.contacts","contributions.purchases"],"create":["name","category","nicOrRegNumber","address","phone","hotline","recurring","notes","contacts"],"update":["name","category","nicOrRegNumber","address","phone","hotline","recurring","notes","contacts"],"archive":["active"]},"RepairVendor":{"read":["id","revision","type","name","active","contacts","provenance","directory.name","directory.category","directory.nicOrRegNumber","directory.address","directory.phone","directory.hotline","directory.recurring","directory.specialisation","directory.notes","directory.contacts","contributions.repairs"],"create":["name","category","nicOrRegNumber","address","phone","hotline","recurring","specialisation","notes","contacts"],"update":["name","category","nicOrRegNumber","address","phone","hotline","recurring","specialisation","notes","contacts"],"archive":["active"]},"Settings":{"read":["id","revision","policyVersion","company","company.name","company.identity","company.address","company.phone","company.email","declarations","currency","scale","timezone","tiers","warningLeadDays","processingFee","dateFormat","itemsPerPage","theme"],"update":["company","company.name","company.identity","company.address","company.phone","company.email","declarations","currency","scale","timezone","tiers","warningLeadDays","processingFee","dateFormat","itemsPerPage","theme"]},"FinanceCompany":{"read":["id","revision","type","name","active","contacts","provenance","policy","policy.path","policy.commission.basis","policy.commission.rateBps","policy.commission.fixed","policy.processingFee","policy.reconciliationMethod","contributions.settlementPurchases","contributions.leaseSales","contributions.brokerage","contributions.entitlements","contributions.remittances"],"create":["name","contacts","policy","policy.path","policy.commission.basis","policy.commission.rateBps","policy.commission.fixed","policy.processingFee","policy.reconciliationMethod"],"update":["name","contacts","policy","policy.path","policy.commission.basis","policy.commission.rateBps","policy.commission.fixed","policy.processingFee","policy.reconciliationMethod"],"archive":["active"]},"Notification":{"read":["id","revision","kind","target","createdAt","readAt"],"update":["readAt"]},"RateSheet":{"read":["id","revision","companyId","version","make","model","year","maximum","validFrom","validThrough","publishedAt","cards"],"create":["companyId","make","model","year","maximum","validFrom","validThrough","cards"]},"Quote":{"read":["id","revision","createdBy","vehicle","vehicle.make","vehicle.model","vehicle.year","vehicle.description","vehicle.engineNumber","vehicle.chassisNumber","sheetId","sheetRevision","cardId","companyId","companyRevision","principal","months","installment","maximum","charges","policy","policy.path","policy.commission.basis","policy.commission.fixed","policy.commission.rateBps","policy.processingFee","policy.reconciliationMethod","expiresAt"],"create":["sheetId","cardId","vehicle","charges"]},"AuditLog":{"read":["id","entityType","entityId","action","at","actor","reason","fields"]},"ImportBatch":{"create":["types","namespace"],"read":["id","revision","state","types","namespace","createdAt","uploads","uploads.uploadId","uploads.revision","uploads.filename","uploads.expiresAt","uploads.state","uploads.attachmentId","uploads.claimExpiresAt"],"update":["uploads"]},"Document":{"create":["target","purpose","filename","contentType","size","sha256"],"read":["uploadId","revision","filename","expiresAt","state","attachmentId","claimExpiresAt","contentType","size","sha256","bytes"],"update":["uploadId"]}}'::jsonb;
BEGIN
 IF (SELECT count(*) FROM jsonb_object_keys(universe))<>16 OR (SELECT count(*) FROM jsonb_each(universe) s CROSS JOIN LATERAL jsonb_object_keys(s.value))<>50 THEN RAISE EXCEPTION 'INVALID_PREBASE_UNIVERSE'; END IF;
 IF EXISTS(SELECT 1 FROM vamotors."Permission" WHERE "ruleHash"<>encode(sha256(convert_to(vamotors.settlement_migration_canonical(rule),'UTF8')),'hex')) THEN RAISE EXCEPTION 'INVALID_PREBASE_HASH'; END IF;
 FOR old IN SELECT rp."roleId",p.id,p.rule FROM vamotors."RolePermission" rp JOIN vamotors."Permission" p ON p.id=rp."permissionId" LOOP
  IF universe#>ARRAY[old.rule->>'subject',old.rule->>'action'] IS NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(old.rule->'fields') f WHERE f<>'*' AND NOT (universe#>ARRAY[old.rule->>'subject',old.rule->>'action']) ? f) THEN RAISE EXCEPTION 'UNKNOWN_PREBASE_GRANT'; END IF;
  SELECT coalesce(jsonb_agg(f ORDER BY f),'[]'::jsonb) INTO fields FROM jsonb_array_elements_text(universe#>ARRAY[old.rule->>'subject',old.rule->>'action']) f WHERE EXISTS(SELECT 1 FROM jsonb_array_elements_text(old.rule->'fields') selected WHERE selected='*' OR selected=f);
  replacement:=jsonb_set(old.rule,'{fields}',fields);
  INSERT INTO vamotors."Permission"(id,"ruleHash",rule) VALUES(gen_random_uuid(),encode(sha256(convert_to(vamotors.settlement_migration_canonical(replacement),'UTF8')),'hex'),replacement) ON CONFLICT("ruleHash") DO NOTHING;
  SELECT id INTO pid FROM vamotors."Permission" WHERE "ruleHash"=encode(sha256(convert_to(vamotors.settlement_migration_canonical(replacement),'UTF8')),'hex');
  DELETE FROM vamotors."RolePermission" WHERE "roleId"=old."roleId" AND "permissionId"=old.id;
  INSERT INTO vamotors."RolePermission" VALUES(old."roleId",pid) ON CONFLICT DO NOTHING;
 END LOOP;
 SELECT id INTO admin_id FROM vamotors."Role" WHERE "systemKey"='ADMINISTRATOR';
 IF admin_id IS NOT NULL THEN
  FOR replacement IN SELECT value FROM jsonb_array_elements('[{"subject":"PurchaseRecord","action":"read","fields":["*"]},{"subject":"PurchaseRecord","action":"create","fields":["*"]},{"subject":"PurchaseRecord","action":"update","fields":["reason","cycleId","patch.purchaseDate","patch.purchasePrice","patch.notes","patch.purchaseType","patch.seller.type","patch.seller.id","patch.settlement","patch.settlement.institutionType","patch.settlement.companyId","patch.settlement.institutionName","patch.settlement.reference","patch.settlement.amount","patch.settlement.cashToSeller"]}]'::jsonb) LOOP
   INSERT INTO vamotors."Permission"(id,"ruleHash",rule) VALUES(gen_random_uuid(),encode(sha256(convert_to(vamotors.settlement_migration_canonical(replacement),'UTF8')),'hex'),replacement) ON CONFLICT("ruleHash") DO NOTHING;
   SELECT id INTO pid FROM vamotors."Permission" WHERE "ruleHash"=encode(sha256(convert_to(vamotors.settlement_migration_canonical(replacement),'UTF8')),'hex');
   INSERT INTO vamotors."RolePermission" VALUES(admin_id,pid) ON CONFLICT DO NOTHING;
  END LOOP;
 END IF;
 UPDATE vamotors."Role" SET revision=revision+1;
END $$;
SET CONSTRAINTS ALL IMMEDIATE;
ALTER TABLE vamotors."Role" ENABLE TRIGGER protected_role;
ALTER TABLE vamotors."RolePermission" ENABLE TRIGGER protected_permissions;
DROP FUNCTION vamotors.settlement_migration_canonical(jsonb);
COMMIT;
