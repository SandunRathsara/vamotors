BEGIN;
SELECT value FROM vamotors."BusinessSequence" WHERE id=1 FOR UPDATE;
SELECT vamotors.lock_admin_guard();

ALTER TABLE vamotors."PurchaseRecord" ADD COLUMN notes text CHECK(notes IS NULL OR (notes=btrim(notes) AND length(notes) BETWEEN 1 AND 2000));
CREATE TABLE vamotors."VehicleCost" (
 id uuid PRIMARY KEY, "cycleId" uuid NOT NULL REFERENCES vamotors."PurchaseRecord"(id) ON DELETE RESTRICT,
 category text NOT NULL CHECK(category=btrim(category) AND length(category) BETWEEN 1 AND 2000),
 description text NOT NULL CHECK(description=btrim(description) AND length(description) BETWEEN 1 AND 2000),
 amount bigint NOT NULL CHECK(amount BETWEEN 0 AND 99999999999999),
 "incurredDate" date NOT NULL CHECK("incurredDate"<=(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Colombo')::date),
 revision integer NOT NULL DEFAULT 1 CHECK(revision BETWEEN 1 AND 2147483647),
 "createdBy" uuid NOT NULL REFERENCES vamotors."user"(id) ON DELETE RESTRICT,
 "commandId" uuid NOT NULL REFERENCES vamotors."CommandReceipt"(id) ON DELETE RESTRICT,
 "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(id,"cycleId")
);
CREATE INDEX "VehicleCost_cycleId_incurredDate_id_idx" ON vamotors."VehicleCost"("cycleId","incurredDate",id);
CREATE TABLE vamotors."CostPayment" (
 id uuid PRIMARY KEY, "costId" uuid NOT NULL, "cycleId" uuid NOT NULL REFERENCES vamotors."PurchaseRecord"(id) ON DELETE RESTRICT,
 FOREIGN KEY("costId","cycleId") REFERENCES vamotors."VehicleCost"(id,"cycleId") ON DELETE RESTRICT,
 amount bigint NOT NULL CHECK(amount BETWEEN 1 AND 99999999999999), direction text NOT NULL CHECK(direction IN ('IN','OUT')),
 category text NOT NULL CHECK(category='COST'), "occurredDate" date NOT NULL CHECK("occurredDate"<=(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Colombo')::date),
 method text NOT NULL CHECK(method IN ('CASH','BANK_TRANSFER')), currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'), scale integer NOT NULL CHECK(scale=2),
 reference text CHECK(reference IS NULL OR (reference=btrim(reference) AND length(reference) BETWEEN 1 AND 200)),
 "reversalOf" uuid UNIQUE, reason text CHECK(reason IS NULL OR (reason=btrim(reason) AND length(reason) BETWEEN 1 AND 2000)),
 "createdBy" uuid NOT NULL REFERENCES vamotors."user"(id) ON DELETE RESTRICT,
 "commandId" uuid NOT NULL REFERENCES vamotors."CommandReceipt"(id) ON DELETE RESTRICT,
 "lineKey" text NOT NULL CHECK(length("lineKey") BETWEEN 1 AND 100), "recordedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(id,"costId","cycleId"), UNIQUE("commandId","lineKey"), UNIQUE("reversalOf","costId","cycleId"),
 FOREIGN KEY("reversalOf","costId","cycleId") REFERENCES vamotors."CostPayment"(id,"costId","cycleId") ON DELETE RESTRICT
);
CREATE INDEX "CostPayment_costId_occurredDate_id_idx" ON vamotors."CostPayment"("costId","occurredDate",id);
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON vamotors."CostPayment" FOR EACH STATEMENT EXECUTE FUNCTION vamotors.append_only();

CREATE OR REPLACE VIEW vamotors."CashMovement" AS
 SELECT 'PURCHASE'::text AS "sourceType", "cycleId" AS "sourceId", id AS "paymentId", "occurredDate" AS date, direction, amount, method, category, "commandId" FROM vamotors."PurchasePayment"
 UNION ALL SELECT 'COST'::text,"costId",id,"occurredDate",direction,amount,method,category,"commandId" FROM vamotors."CostPayment";

-- Stock still uses the exact v7 final-graph validator. Only unchanged-lifecycle
-- money commands take the separately validated branch below; mixed deltas fail.
DROP TRIGGER stock_graph ON vamotors."PurchaseRecord";
CREATE CONSTRAINT TRIGGER stock_graph AFTER UPDATE ON vamotors."PurchaseRecord" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
 WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.available IS DISTINCT FROM NEW.available OR OLD."holdReason" IS DISTINCT FROM NEW."holdReason" OR OLD."receivedDate" IS DISTINCT FROM NEW."receivedDate") EXECUTE FUNCTION vamotors.check_stock_graph();
CREATE OR REPLACE FUNCTION vamotors.acquisition_root_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF current_user='vamotors_runtime' AND NEW."acquisitionCommandId" IS NULL THEN RAISE EXCEPTION 'ACQUISITION_EVIDENCE_REQUIRED' USING ERRCODE='23514'; END IF;
  IF NEW."acquisitionCommandId" IS NOT NULL AND (NEW.revision<>1 OR NEW.status<>'PURCHASED' OR NEW.available OR NEW."cycleNumber"<>1 OR NEW."purchasePrice"<=0 OR NEW."receivedDate" IS NOT NULL OR NEW."holdReason" IS NOT NULL OR NEW.notes IS NOT NULL OR NEW."purchaseDate">(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Colombo')::date) THEN RAISE EXCEPTION 'INVALID_ACQUISITION' USING ERRCODE='23514'; END IF;
 ELSE
  IF OLD."acquisitionCommandId" IS NULL OR NEW."acquisitionCommandId" IS DISTINCT FROM OLD."acquisitionCommandId" THEN RAISE EXCEPTION 'ACQUISITION_EVIDENCE_REQUIRED' USING ERRCODE='23514'; END IF;
  IF ROW(NEW.status,NEW.available,NEW."holdReason",NEW."receivedDate") IS NOT DISTINCT FROM ROW(OLD.status,OLD.available,OLD."holdReason",OLD."receivedDate") THEN
   IF (to_jsonb(NEW)-ARRAY['purchaseDate','purchasePrice','notes','revision','updatedAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['purchaseDate','purchasePrice','notes','revision','updatedAt'])
    OR NEW.status NOT IN ('PURCHASED','IN_STOCK') OR NEW."closedAt" IS NOT NULL OR NEW."acquisitionKind"<>'SUPPLIER' OR NEW."purchaseType" NOT IN ('CASH','BRAND_NEW') OR NEW."purchasePrice"<=0 OR NEW."purchaseDate">(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Colombo')::date
    OR OLD.revision=2147483647 OR NEW.revision::bigint<>OLD.revision::bigint+1 THEN RAISE EXCEPTION 'INVALID_CYCLE_MONEY_CHANGE' USING ERRCODE='23514'; END IF;
   RETURN NEW;
  END IF;
  IF (to_jsonb(NEW)-ARRAY['status','available','holdReason','receivedDate','revision','updatedAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','available','holdReason','receivedDate','revision','updatedAt']) THEN RAISE EXCEPTION 'IMMUTABLE_ACQUISITION' USING ERRCODE='23514'; END IF;
  IF OLD.revision=2147483647 OR NEW.revision::bigint<>OLD.revision::bigint+1 OR NEW.status<>'IN_STOCK' OR OLD.status NOT IN ('PURCHASED','IN_STOCK') OR NEW."closedAt" IS NOT NULL
   OR NEW."receivedDate" IS NULL OR NEW."receivedDate"<NEW."purchaseDate" OR NEW."receivedDate">(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Colombo')::date
   OR (OLD.status='IN_STOCK' AND NEW."receivedDate" IS DISTINCT FROM OLD."receivedDate") OR (NEW.available AND NEW."holdReason" IS NOT NULL)
   OR (NOT NEW.available AND (NEW."holdReason" IS NULL OR NEW."holdReason" ~ '^[[:space:]]|[[:space:]]$' OR length(NEW."holdReason") NOT BETWEEN 1 AND 2000))
   OR (OLD.status='IN_STOCK' AND NEW.available=OLD.available AND NEW."holdReason" IS NOT DISTINCT FROM OLD."holdReason") THEN RAISE EXCEPTION 'INVALID_STOCK_CHANGE' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;

-- Original proof comes from immutable acquisition versions, never corrected terms.
CREATE OR REPLACE FUNCTION vamotors.check_acquisition_graph() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE cid uuid; p vamotors."PurchaseRecord"; initial jsonb; policy jsonb; latest vamotors."CycleBasisVersion"; total numeric; paid numeric;
BEGIN
 IF TG_TABLE_NAME='PurchaseRecord' THEN cid:=NEW.id; ELSE cid:=NEW."cycleId"; END IF;
 SELECT * INTO p FROM vamotors."PurchaseRecord" WHERE id=cid;
 IF p."acquisitionCommandId" IS NULL THEN
  IF TG_TABLE_NAME<>'PurchaseRecord' THEN RAISE EXCEPTION 'ACQUISITION_EVIDENCE_REQUIRED' USING ERRCODE='23514'; END IF; RETURN NULL;
 END IF;
 SELECT payload INTO initial FROM vamotors."EntityReadVersion" WHERE "commandId"=p."acquisitionCommandId" AND "entityType"='PurchaseRecord' AND "entityId"=cid AND revision=1;
 SELECT values INTO policy FROM vamotors."SettingsVersion" WHERE id=p."settingsVersionId";
 IF initial IS NULL OR NOT EXISTS(SELECT 1 FROM vamotors."CommandReceipt" c WHERE c.id=p."acquisitionCommandId" AND c."commandName"='recordPurchase' AND c."actorKey"='USER:'||p."createdBy"::text AND c."businessSequence">0 AND c.result=jsonb_build_object('type','PurchaseRecord','id',p.id,'revision',1))
 OR NOT EXISTS(SELECT 1 FROM vamotors."Vehicle" v WHERE v.id=p."vehicleId" AND v."createdBy"=p."createdBy" AND v."activePurchaseId"=p.id)
 OR (TG_TABLE_NAME='PurchaseRecord' AND TG_OP='INSERT' AND NOT EXISTS(SELECT 1 FROM vamotors."Supplier" s WHERE s.id=p."supplierId" AND s.active AND (p."purchaseType"<>'BRAND_NEW' OR s.category='COMPANY')))
 OR (SELECT count(*) FROM vamotors."PurchasePayment" x WHERE x."cycleId"=cid AND x."commandId"=p."acquisitionCommandId")<>1
 OR NOT EXISTS(SELECT 1 FROM vamotors."PurchasePayment" x WHERE x."cycleId"=cid AND x."commandId"=p."acquisitionCommandId" AND x.amount=(initial->>'purchasePrice')::bigint AND x.direction='OUT' AND x."occurredDate"=(initial->>'purchaseDate')::date AND x."reversalOf" IS NULL AND x.currency=policy->>'currency' AND x.scale=2 AND x."lineKey"='seller')
 OR (SELECT count(*) FROM vamotors."MileageReading" x WHERE x."cycleId"=cid)<>1
 OR NOT EXISTS(SELECT 1 FROM vamotors."MileageReading" x WHERE x."cycleId"=cid AND x."commandId"=p."acquisitionCommandId" AND x."recordedDate">=(initial->>'purchaseDate')::date AND x."recordedDate">=p."purchaseDate")
 OR NOT EXISTS(SELECT 1 FROM vamotors."CycleBasisVersion" x WHERE x."cycleId"=cid AND x."commandId"=p."acquisitionCommandId" AND x.version=1 AND x.purchase=(initial->>'purchasePrice')::bigint AND x.total=x.purchase AND x.components=jsonb_build_object('purchase',x.purchase::text,'repairs','[]'::jsonb,'costs','[]'::jsonb) AND x.currency=policy->>'currency' AND x.scale=2 AND x."supersedesId" IS NULL)
 OR (SELECT count(*) FROM vamotors."StatusEvent" s WHERE s."cycleId"=cid AND s."commandId"=p."acquisitionCommandId" AND s."from" IS NULL AND s."to"='PURCHASED' AND s.action='recordPurchase' AND s."userId"=p."createdBy")<>1
 OR NOT EXISTS(SELECT 1 FROM vamotors."AuditEntry" a WHERE a."commandId"=p."acquisitionCommandId" AND a."entityType"='PurchaseRecord' AND a."entityId"=cid)
 OR NOT EXISTS(SELECT 1 FROM vamotors."EntityReadVersion" v WHERE v."commandId"=p."acquisitionCommandId" AND v."entityType"='Vehicle' AND v."entityId"=p."vehicleId" AND v.revision=1)
 THEN RAISE EXCEPTION 'INVALID_ACQUISITION_GRAPH' USING ERRCODE='23514'; END IF;
 SELECT p."purchasePrice"+coalesce(sum(amount::numeric),0) INTO total FROM vamotors."VehicleCost" WHERE "cycleId"=cid;
 SELECT * INTO latest FROM vamotors."CycleBasisVersion" WHERE "cycleId"=cid ORDER BY version DESC LIMIT 1;
 IF total>9999999999999999 OR latest.total IS DISTINCT FROM total OR latest.purchase<>p."purchasePrice" OR latest.components<>jsonb_build_object('purchase',p."purchasePrice"::text,'repairs','[]'::jsonb,'costs',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'amount',amount::text) ORDER BY id) FROM vamotors."VehicleCost" WHERE "cycleId"=cid),'[]'::jsonb))
 OR (SELECT count(*) FROM vamotors."CycleBasisVersion" WHERE "cycleId"=cid)<>latest.version
 OR EXISTS(SELECT 1 FROM vamotors."CycleBasisVersion" b LEFT JOIN vamotors."CycleBasisVersion" prev ON prev.id=b."supersedesId" AND prev."cycleId"=cid AND prev.version=b.version-1 WHERE b."cycleId"=cid AND (b.currency<>policy->>'currency' OR b.scale<>2 OR (b.version>1 AND prev.id IS NULL)))
 OR EXISTS(SELECT 1 FROM vamotors."VehicleCost" WHERE "cycleId"=cid AND "incurredDate"<p."purchaseDate")
 OR (p."receivedDate" IS NOT NULL AND p."receivedDate"<p."purchaseDate") THEN RAISE EXCEPTION 'INVALID_CYCLE_BASIS' USING ERRCODE='23514'; END IF;
 SELECT coalesce(sum(CASE direction WHEN 'OUT' THEN amount::numeric ELSE -amount::numeric END),0) INTO paid FROM vamotors."PurchasePayment" WHERE "cycleId"=cid;
 IF paid<0 OR paid>p."purchasePrice" OR EXISTS(SELECT 1 FROM vamotors."PurchasePayment" x WHERE x."cycleId"=cid AND x."reversalOf" IS NULL AND NOT EXISTS(SELECT 1 FROM vamotors."PurchasePayment" r WHERE r."reversalOf"=x.id) AND x."occurredDate"<p."purchaseDate") THEN RAISE EXCEPTION 'INVALID_PURCHASE_BALANCE' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;

CREATE FUNCTION vamotors.cycle_cost_payments_json(source text, owner uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id',id,'owner',jsonb_build_object('type',source,'id',owner),'commandId',"commandId",'amount',amount::text,'direction',direction,'category',category,'date',"occurredDate"::text,'method',method,'recordedAt',to_char("recordedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'reference',reference,'reversalOf',"reversalOf",'reason',reason)) ORDER BY "occurredDate",id),'[]'::jsonb)
 FROM (SELECT id,"commandId",amount,direction,category,"occurredDate",method,"recordedAt",reference,"reversalOf",reason FROM vamotors."PurchasePayment" WHERE source='PURCHASE' AND "cycleId"=owner
 UNION ALL SELECT id,"commandId",amount,direction,category,"occurredDate",method,"recordedAt",reference,"reversalOf",reason FROM vamotors."CostPayment" WHERE source='COST' AND "costId"=owner) p
$$;
CREATE FUNCTION vamotors.cycle_cost_json(cid uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('id',c.id,'revision',revision,'category',category,'description',description,'amount',amount::text,'incurredDate',"incurredDate"::text,'payments',vamotors.cycle_cost_payments_json('COST',c.id),'outstanding',(amount-coalesce((SELECT sum(CASE direction WHEN 'OUT' THEN p.amount::numeric ELSE -p.amount::numeric END) FROM vamotors."CostPayment" p WHERE p."costId"=c.id),0))::text,'provenance',jsonb_build_object('imported',false)) FROM vamotors."VehicleCost" c WHERE c.id=cid
$$;
CREATE FUNCTION vamotors.cycle_cost_diff(kind text, old jsonb, after jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT coalesce(jsonb_object_agg(f,jsonb_build_object('before',coalesce(old #> string_to_array(f,'.'),'null'::jsonb),'after',coalesce(after #> string_to_array(f,'.'),'null'::jsonb))),'{}'::jsonb)
 FROM unnest(CASE kind
 WHEN 'VehicleCost' THEN ARRAY['id','revision','category','description','amount','incurredDate','payments','outstanding','provenance']
 WHEN 'PurchaseRecord' THEN ARRAY['id','revision','vehicleId','identity','identityRevision','cycleNumber','purchaseType','acquisitionKind','seller','purchaseDate','purchasePrice','listedPrice','notes','status','available','holdReason','receivedDate','closedAt','payments','outstanding','outstanding.seller','outstanding.settlement','costs','repairs','mileage','financial','basisVersions','sales','disposal','provenance','nextActions','financial.currency','financial.scale','financial.purchase','financial.repairs','financial.additionalCosts','financial.basis','financial.cashIn','financial.cashOut','financial.net']
 ELSE ARRAY['id','identity','status','available','cycleId','revision','listedPrice','financial','identityRevision','holdReason','mileage','provenance','financial.currency','financial.scale','financial.purchase','financial.repairs','financial.additionalCosts','financial.basis','financial.cashIn','financial.cashOut','financial.net'] END) f
 WHERE coalesce(old #> string_to_array(f,'.'),'null'::jsonb) IS DISTINCT FROM coalesce(after #> string_to_array(f,'.'),'null'::jsonb)
$$;

CREATE FUNCTION vamotors.cycle_cost_root_graph() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE c vamotors."CommandReceipt"; v vamotors."Vehicle"; after_payload jsonb; old_payload jsonb; kind text; eid uuid; rev integer; costs jsonb; payments jsonb; financial jsonb; basis jsonb; cost_id uuid; before_cost jsonb; after_cost jsonb; incoming numeric; outgoing numeric; incurred numeric; changed_basis boolean;
BEGIN
 IF ROW(NEW.status,NEW.available,NEW."holdReason",NEW."receivedDate") IS DISTINCT FROM ROW(OLD.status,OLD.available,OLD."holdReason",OLD."receivedDate") THEN RETURN NULL; END IF;
 SELECT * INTO v FROM vamotors."Vehicle" WHERE id=NEW."vehicleId";
 SELECT r.* INTO c FROM vamotors."CommandReceipt" r JOIN vamotors."EntityReadVersion" e ON e."commandId"=r.id AND e."entityType"='PurchaseRecord' AND e."entityId"=NEW.id AND e.revision=NEW.revision WHERE r.xmin=pg_current_xact_id()::xid AND e.xmin=pg_current_xact_id()::xid;
 IF c.id IS NULL OR c."commandName" NOT IN ('addCost','editCost','payCost','payPurchase','editPurchase','reversePayment') OR c."actorKey" NOT LIKE 'USER:%' OR c."environmentId"<>(SELECT id FROM vamotors."Environment" WHERE singleton=1) OR c."businessSequence"<>(SELECT value FROM vamotors."BusinessSequence" WHERE id=1) OR v."activePurchaseId" IS DISTINCT FROM NEW.id
 OR NOT EXISTS(SELECT 1 FROM vamotors."PurchaseRecord" p WHERE p.id=NEW.id AND p.xmin=pg_current_xact_id()::xid)
 OR (c."commandName"<>'editPurchase' AND ROW(NEW."purchaseDate",NEW."purchasePrice",NEW.notes) IS DISTINCT FROM ROW(OLD."purchaseDate",OLD."purchasePrice",OLD.notes))
 OR EXISTS(SELECT 1 FROM vamotors."StatusEvent" WHERE "commandId"=c.id) OR EXISTS(SELECT 1 FROM vamotors."MileageReading" WHERE "commandId"=c.id)
 THEN RAISE EXCEPTION 'INVALID_CYCLE_MONEY_GRAPH' USING ERRCODE='23514'; END IF;
 SELECT coalesce(jsonb_agg(vamotors.cycle_cost_json(id) ORDER BY id),'[]'::jsonb),coalesce(sum(amount::numeric),0) INTO costs,incurred FROM vamotors."VehicleCost" WHERE "cycleId"=NEW.id;
 SELECT coalesce(sum(CASE direction WHEN 'IN' THEN amount::numeric ELSE 0 END),0),coalesce(sum(CASE direction WHEN 'OUT' THEN amount::numeric ELSE 0 END),0) INTO incoming,outgoing FROM vamotors."CashMovement" m WHERE (m."sourceType"='PURCHASE' AND m."sourceId"=NEW.id) OR (m."sourceType"='COST' AND m."sourceId" IN (SELECT id FROM vamotors."VehicleCost" WHERE "cycleId"=NEW.id));
 IF incoming>9223372036854775807 OR outgoing>9223372036854775807 THEN RAISE EXCEPTION 'MONEY_OVERFLOW' USING ERRCODE='23514'; END IF;
 SELECT jsonb_build_object('currency',b.currency,'scale',2,'purchase',NEW."purchasePrice"::text,'repairs','0','additionalCosts',incurred::text,'basis',b.total::text,'cashIn',incoming::text,'cashOut',outgoing::text,'net',(incoming-outgoing)::text) INTO financial FROM vamotors."CycleBasisVersion" b WHERE b."cycleId"=NEW.id ORDER BY version DESC LIMIT 1;
 SELECT jsonb_agg(jsonb_build_object('id',id,'version',version,'total',total::text,'reason',reason) ORDER BY version) INTO basis FROM vamotors."CycleBasisVersion" WHERE "cycleId"=NEW.id;
 payments:=vamotors.cycle_cost_payments_json('PURCHASE',NEW.id);
 IF (c."commandName"='payPurchase' AND (SELECT count(*) FROM vamotors."PurchasePayment" WHERE "commandId"=c.id AND direction='OUT' AND "reversalOf" IS NULL)<>1)
 OR (c."commandName"='payCost' AND (SELECT count(*) FROM vamotors."CostPayment" WHERE "commandId"=c.id AND direction='OUT' AND "reversalOf" IS NULL)<>1)
 OR (c."commandName"='addCost' AND (SELECT count(*) FROM vamotors."CostPayment" WHERE "commandId"=c.id)>1)
 OR (c."commandName"='reversePayment' AND ((SELECT count(*) FROM vamotors."CashMovement" WHERE "commandId"=c.id AND direction='IN')<>1 OR (SELECT count(*) FROM vamotors."CashMovement" WHERE "commandId"=c.id AND direction='OUT')>1))
 OR (c."commandName"='editPurchase' AND ((SELECT count(*) FROM vamotors."PurchasePayment" WHERE "commandId"=c.id AND direction='IN')>100 OR (SELECT count(*) FROM vamotors."PurchasePayment" WHERE "commandId"=c.id AND direction='OUT')>100))
 THEN RAISE EXCEPTION 'INVALID_MONEY_COMMAND_CARDINALITY' USING ERRCODE='23514'; END IF;
 changed_basis:=c."commandName" IN ('addCost','editCost') OR NEW."purchasePrice"<>OLD."purchasePrice";
 IF (SELECT count(*) FROM vamotors."CycleBasisVersion" WHERE "commandId"=c.id)<>(CASE WHEN changed_basis THEN 1 ELSE 0 END)
 OR EXISTS(SELECT 1 FROM vamotors."CycleBasisVersion" b WHERE b."commandId"=c.id AND (b."cycleId"<>NEW.id OR b.xmin<>pg_current_xact_id()::xid OR b.reason IS DISTINCT FROM CASE WHEN c."commandName"='addCost' THEN 'Additional incurred cost' ELSE (SELECT reason FROM vamotors."AuditEntry" WHERE "commandId"=c.id AND "entityType"='PurchaseRecord' AND "entityId"=NEW.id) END)) THEN RAISE EXCEPTION 'INVALID_CORRECTION_BASIS' USING ERRCODE='23514'; END IF;
 FOREACH kind IN ARRAY ARRAY['PurchaseRecord','Vehicle'] LOOP
  eid:=CASE WHEN kind='PurchaseRecord' THEN NEW.id ELSE NEW."vehicleId" END; rev:=CASE WHEN kind='PurchaseRecord' THEN NEW.revision ELSE v.revision END;
  SELECT payload INTO old_payload FROM vamotors."EntityReadVersion" WHERE "entityType"=kind AND "entityId"=eid AND sequence<c."businessSequence" ORDER BY sequence DESC LIMIT 1;
  SELECT payload INTO after_payload FROM vamotors."EntityReadVersion" WHERE "entityType"=kind AND "entityId"=eid AND "commandId"=c.id AND revision=rev AND sequence=c."businessSequence" AND xmin=pg_current_xact_id()::xid;
  IF old_payload IS NULL OR after_payload IS NULL OR old_payload->'revision' IS DISTINCT FROM to_jsonb(OLD.revision) OR after_payload->'revision' IS DISTINCT FROM to_jsonb(NEW.revision) OR after_payload->'financial' IS DISTINCT FROM financial
   OR (kind='PurchaseRecord' AND (after_payload->'costs' IS DISTINCT FROM costs OR after_payload->'payments' IS DISTINCT FROM payments OR after_payload->'basisVersions' IS DISTINCT FROM basis OR after_payload->>'purchaseDate' IS DISTINCT FROM NEW."purchaseDate"::text OR after_payload->>'purchasePrice' IS DISTINCT FROM NEW."purchasePrice"::text OR after_payload->>'notes' IS DISTINCT FROM NEW.notes
    OR after_payload->'outstanding' IS DISTINCT FROM jsonb_build_object('seller',(NEW."purchasePrice"-coalesce((SELECT sum(CASE direction WHEN 'OUT' THEN amount::numeric ELSE -amount::numeric END) FROM vamotors."PurchasePayment" WHERE "cycleId"=NEW.id),0))::text,'settlement','0')
    OR after_payload->'seller' IS DISTINCT FROM (SELECT jsonb_build_object('type','SUPPLIER','id',s.id,'name',s.name,'active',s.active) FROM vamotors."Supplier" s WHERE s.id=NEW."supplierId")))
   OR (after_payload-ARRAY['revision','financial','costs','payments','basisVersions','purchaseDate','purchasePrice','notes','outstanding','seller']) IS DISTINCT FROM (old_payload-ARRAY['revision','financial','costs','payments','basisVersions','purchaseDate','purchasePrice','notes','outstanding','seller']) THEN RAISE EXCEPTION 'INVALID_CYCLE_MONEY_VERSION' USING ERRCODE='23514'; END IF;
  -- Directory presentation is current, not a mutation of immutable old versions.
  IF kind='PurchaseRecord' THEN old_payload:=jsonb_set(old_payload,'{seller}',after_payload->'seller'); END IF;
  IF NOT EXISTS(SELECT 1 FROM vamotors."AuditEntry" a WHERE a."commandId"=c.id AND a."entityType"=kind AND a."entityId"=eid AND a.action=c."commandName" AND a."actorKind"='USER' AND c."actorKey"='USER:'||a."userId"::text AND a."fieldDiff"=vamotors.cycle_cost_diff(kind,old_payload,after_payload) AND a.xmin=pg_current_xact_id()::xid AND (c."commandName" NOT IN ('editCost','editPurchase','reversePayment') OR length(btrim(a.reason)) BETWEEN 1 AND 2000)) THEN RAISE EXCEPTION 'INVALID_CYCLE_MONEY_AUDIT' USING ERRCODE='23514'; END IF;
 END LOOP;
 IF c."commandName" IN ('addCost','editCost','payCost') OR (c."commandName"='reversePayment' AND c.result->>'type'='VehicleCost') THEN
  cost_id:=(c.result->>'id')::uuid;
  SELECT value INTO before_cost FROM jsonb_array_elements((SELECT payload->'costs' FROM vamotors."EntityReadVersion" WHERE "entityType"='PurchaseRecord' AND "entityId"=NEW.id AND sequence<c."businessSequence" ORDER BY sequence DESC LIMIT 1)) WHERE value->>'id'=cost_id::text;
  after_cost:=vamotors.cycle_cost_json(cost_id);
  IF after_cost IS NULL OR c.result<>jsonb_build_object('type','VehicleCost','id',cost_id,'revision',(after_cost->>'revision')::integer)
   OR NOT EXISTS(SELECT 1 FROM vamotors."VehicleCost" x WHERE x.id=cost_id AND x."cycleId"=NEW.id AND x.xmin=pg_current_xact_id()::xid AND x.revision=coalesce((before_cost->>'revision')::integer,0)+1)
   OR (c."commandName"='addCost' AND before_cost IS NOT NULL) OR (c."commandName"<>'addCost' AND before_cost IS NULL)
   OR NOT EXISTS(SELECT 1 FROM vamotors."AuditEntry" a WHERE a."commandId"=c.id AND a."entityType"='VehicleCost' AND a."entityId"=cost_id AND a.action=c."commandName" AND a."actorKind"='USER' AND c."actorKey"='USER:'||a."userId"::text AND a."fieldDiff"=vamotors.cycle_cost_diff('VehicleCost',before_cost,after_cost) AND a.xmin=pg_current_xact_id()::xid AND a.reason IS NOT DISTINCT FROM (SELECT reason FROM vamotors."AuditEntry" WHERE "commandId"=c.id AND "entityType"='PurchaseRecord' AND "entityId"=NEW.id))
   OR EXISTS(SELECT 1 FROM vamotors."VehicleCost" x WHERE x."cycleId"=NEW.id AND x.xmin=pg_current_xact_id()::xid AND x.id<>cost_id)
   OR EXISTS(SELECT 1 FROM vamotors."PurchasePayment" WHERE "commandId"=c.id)
   OR (c."commandName" IN ('payCost','reversePayment') AND after_cost-ARRAY['revision','payments','outstanding'] IS DISTINCT FROM before_cost-ARRAY['revision','payments','outstanding'])
   OR (c."commandName"='editCost' AND after_cost->'payments' IS DISTINCT FROM before_cost->'payments') THEN RAISE EXCEPTION 'INVALID_COST_GRAPH' USING ERRCODE='23514'; END IF;
 ELSE
  IF c.result<>jsonb_build_object('type','PurchaseRecord','id',NEW.id,'revision',NEW.revision) OR EXISTS(SELECT 1 FROM vamotors."CostPayment" WHERE "commandId"=c.id) OR EXISTS(SELECT 1 FROM vamotors."VehicleCost" x WHERE x."cycleId"=NEW.id AND x.xmin=pg_current_xact_id()::xid) THEN RAISE EXCEPTION 'INVALID_PURCHASE_CORRECTION_GRAPH' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER cycle_cost_graph AFTER UPDATE ON vamotors."PurchaseRecord" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vamotors.cycle_cost_root_graph();

CREATE FUNCTION vamotors.cycle_cost_child_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='UPDATE' AND ((to_jsonb(NEW)-ARRAY['category','description','amount','incurredDate','revision','updatedAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['category','description','amount','incurredDate','revision','updatedAt']) OR OLD.revision=2147483647 OR NEW.revision::bigint<>OLD.revision::bigint+1) THEN RAISE EXCEPTION 'IMMUTABLE_COST_OWNER' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' AND NEW.revision<>1 THEN RAISE EXCEPTION 'INVALID_COST_REVISION' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER cost_owner BEFORE INSERT OR UPDATE ON vamotors."VehicleCost" FOR EACH ROW EXECUTE FUNCTION vamotors.cycle_cost_child_guard();
CREATE FUNCTION vamotors.cycle_cost_child_graph() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE cid uuid; p vamotors."PurchaseRecord"; c vamotors."CommandReceipt"; policy jsonb; cost_id uuid; paid numeric; incoming numeric; outgoing numeric; original jsonb;
BEGIN
 cid:=NEW."cycleId";
 SELECT * INTO p FROM vamotors."PurchaseRecord" WHERE id=cid;
 IF TG_TABLE_NAME='PurchasePayment' THEN
  IF NEW."commandId"=p."acquisitionCommandId" AND NEW."lineKey"='seller' THEN RETURN NULL; END IF;
 END IF;
 IF p."acquisitionCommandId" IS NULL OR p."closedAt" IS NOT NULL OR p.status NOT IN ('PURCHASED','IN_STOCK') OR NOT EXISTS(SELECT 1 FROM vamotors."PurchaseRecord" WHERE id=cid AND xmin=pg_current_xact_id()::xid) THEN RAISE EXCEPTION 'CYCLE_MONEY_COMMAND_REQUIRED' USING ERRCODE='23514'; END IF;
 SELECT r.* INTO c FROM vamotors."CommandReceipt" r JOIN vamotors."EntityReadVersion" e ON e."commandId"=r.id AND e."entityType"='PurchaseRecord' AND e."entityId"=cid AND e.revision=p.revision WHERE r.xmin=pg_current_xact_id()::xid AND e.xmin=pg_current_xact_id()::xid;
 IF c.id IS NULL THEN RAISE EXCEPTION 'CYCLE_MONEY_COMMAND_REQUIRED' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='VehicleCost' THEN
  IF c.result->>'type'<>'VehicleCost' OR c.result->>'id'<>NEW.id::text OR (TG_OP='INSERT' AND (c."commandName"<>'addCost' OR NEW."commandId"<>c.id OR c."actorKey"<>'USER:'||NEW."createdBy"::text)) THEN RAISE EXCEPTION 'INVALID_COST_COMMAND' USING ERRCODE='23514'; END IF;
  cost_id:=NEW.id;
 ELSE
  IF NEW."commandId"<>c.id THEN RAISE EXCEPTION 'INVALID_PAYMENT_COMMAND' USING ERRCODE='23514'; END IF;
  SELECT values INTO policy FROM vamotors."SettingsVersion" WHERE id=p."settingsVersionId";
  IF NEW.currency<>policy->>'currency' OR NEW.scale<>2 THEN RAISE EXCEPTION 'INVALID_PAYMENT_CURRENCY' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='CostPayment' THEN
   cost_id:=NEW."costId";
   IF c."commandName" NOT IN ('addCost','payCost','reversePayment') OR c.result->>'type'<>'VehicleCost' OR c.result->>'id'<>cost_id::text OR c."actorKey"<>'USER:'||NEW."createdBy"::text THEN RAISE EXCEPTION 'INVALID_COST_PAYMENT_COMMAND' USING ERRCODE='23514'; END IF;
   IF NEW."reversalOf" IS NOT NULL THEN SELECT to_jsonb(x) INTO original FROM vamotors."CostPayment" x WHERE x.id=NEW."reversalOf" AND x."costId"=cost_id AND x."cycleId"=cid; END IF;
  ELSE
   IF c."commandName" NOT IN ('payPurchase','editPurchase','reversePayment') OR c.result->>'type'<>'PurchaseRecord' OR c.result->>'id'<>cid::text THEN RAISE EXCEPTION 'INVALID_PURCHASE_PAYMENT_COMMAND' USING ERRCODE='23514'; END IF;
   IF NEW."reversalOf" IS NOT NULL THEN SELECT to_jsonb(x) INTO original FROM vamotors."PurchasePayment" x WHERE x.id=NEW."reversalOf" AND x."cycleId"=cid; END IF;
  END IF;
  IF NEW."reversalOf" IS NOT NULL THEN
   IF c."commandName" NOT IN ('editPurchase','reversePayment') OR original IS NULL OR original->>'reversalOf' IS NOT NULL OR NEW.direction<>'IN' OR original->>'direction'<>'OUT' OR NEW.amount<>(original->>'amount')::bigint OR NEW."occurredDate"<>(original->>'occurredDate')::date OR NEW.method<>original->>'method' OR NEW.currency<>original->>'currency' OR NEW.category<>original->>'category' OR NEW.reference IS DISTINCT FROM original->>'reference' OR NEW.reason IS NULL OR NEW."lineKey"<>'reverse:'||NEW."reversalOf"::text THEN RAISE EXCEPTION 'INVALID_EXACT_REVERSAL' USING ERRCODE='23514'; END IF;
  ELSIF NEW.direction<>'OUT' OR (c."commandName" IN ('editPurchase','reversePayment') AND (NEW.reason IS NULL OR NOT EXISTS(SELECT 1 FROM vamotors."CashMovement" m WHERE m."commandId"=c.id AND m.direction='IN' AND m."sourceType"=CASE WHEN cost_id IS NULL THEN 'PURCHASE' ELSE 'COST' END AND m."sourceId"=coalesce(cost_id,cid) AND m."paymentId" IN (SELECT x.id FROM vamotors."PurchasePayment" x WHERE x."commandId"=c.id AND NEW."lineKey"='replace:'||x."reversalOf"::text UNION ALL SELECT x.id FROM vamotors."CostPayment" x WHERE x."commandId"=c.id AND NEW."lineKey"='replace:'||x."reversalOf"::text)))) OR (c."commandName" NOT IN ('editPurchase','reversePayment') AND NEW."lineKey"<>'payment') THEN RAISE EXCEPTION 'INVALID_REPLACEMENT_PAYMENT' USING ERRCODE='23514'; END IF;
 END IF;
 SELECT coalesce(sum(CASE direction WHEN 'OUT' THEN amount::numeric ELSE -amount::numeric END),0),coalesce(sum(CASE direction WHEN 'IN' THEN amount::numeric ELSE 0 END),0),coalesce(sum(CASE direction WHEN 'OUT' THEN amount::numeric ELSE 0 END),0) INTO paid,incoming,outgoing FROM vamotors."CashMovement" WHERE "sourceType"=CASE WHEN cost_id IS NULL THEN 'PURCHASE' ELSE 'COST' END AND "sourceId"=coalesce(cost_id,cid);
 IF paid<0 OR paid>(CASE WHEN cost_id IS NULL THEN p."purchasePrice" ELSE (SELECT amount FROM vamotors."VehicleCost" WHERE id=cost_id) END) OR incoming>9999999999999999 OR outgoing>9999999999999999
 OR EXISTS(SELECT 1 FROM vamotors."CostPayment" x JOIN vamotors."VehicleCost" k ON k.id=x."costId" WHERE x."costId"=cost_id AND x."reversalOf" IS NULL AND NOT EXISTS(SELECT 1 FROM vamotors."CostPayment" r WHERE r."reversalOf"=x.id) AND x."occurredDate"<k."incurredDate") THEN RAISE EXCEPTION 'INVALID_SOURCE_BALANCE' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER cost_graph AFTER INSERT OR UPDATE ON vamotors."VehicleCost" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vamotors.cycle_cost_child_graph();
CREATE CONSTRAINT TRIGGER cost_payment_graph AFTER INSERT ON vamotors."CostPayment" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vamotors.cycle_cost_child_graph();
CREATE CONSTRAINT TRIGGER purchase_correction_graph AFTER INSERT ON vamotors."PurchasePayment" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vamotors.cycle_cost_child_graph();

-- v7 -> AUTHOR PREBASE v8. This exact prebase universe must be extended with the
-- accepted rates universe on rebase, never inferred from unaccepted rates code.
CREATE FUNCTION vamotors.cost_migration_canonical(j jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE jsonb_typeof(j)
 WHEN 'object' THEN '{'||coalesce((SELECT string_agg(to_jsonb(key)::text||':'||vamotors.cost_migration_canonical(value),',' ORDER BY key COLLATE "C") FROM jsonb_each(j)),'')||'}'
 WHEN 'array' THEN '['||coalesce((SELECT string_agg(vamotors.cost_migration_canonical(value),',' ORDER BY n) FROM jsonb_array_elements(j) WITH ORDINALITY a(value,n)),'')||']'
 ELSE j::text END
$$;
ALTER TABLE vamotors."RolePermission" DISABLE TRIGGER protected_permissions;
ALTER TABLE vamotors."Role" DISABLE TRIGGER protected_role;
DO $$
DECLARE old record; replacement jsonb; fields jsonb; universe jsonb := '{"User":{"read":["id","revision","name","email","active","roles","authzRevision","createdAt","updatedAt","adminProtection"],"create":["name","email","password","roleIds"],"update":["name","active","roleIds"]},"Role":{"read":["id","revision","name","active","systemKey","grants"],"create":["name","grants"],"update":["name","grants"],"archive":["active"]},"Vehicle":{"read":["id","identity","status","available","cycleId","revision","listedPrice","financial","financial.purchase","financial.repairs","financial.additionalCosts","financial.basis","financial.originalProfit","financial.restatedProfit","identityRevision","holdReason","mileage","provenance","identity.engineNumber","identity.chassisNumber","identity.make","identity.model","identity.year","identity.colour","identity.fuelType","identity.transmission","identity.vin","identity.crNumber","identity.notes","financial.currency","financial.scale","financial.cashIn","financial.cashOut","financial.net"],"create":["engineNumber","chassisNumber","make","model","year","colour","fuelType","transmission","vin","crNumber","notes"]},"Customer":{"read":["id","revision","fullName","callingName","nicOrPassport","address","phone","email","drivingLicence","notes","active","provenance","links"],"create":["fullName","callingName","nicOrPassport","address","phone","email","drivingLicence","notes"],"update":["fullName","callingName","nicOrPassport","address","phone","email","drivingLicence","notes"],"archive":["active"]},"PurchaseRecord":{"read":["id","revision","vehicleId","identity","identityRevision","cycleNumber","purchaseType","acquisitionKind","seller","purchaseDate","purchasePrice","listedPrice","status","available","holdReason","receivedDate","closedAt","payments.id","payments.owner.type","payments.owner.id","payments.commandId","payments.amount","payments.direction","payments.category","payments.date","payments.method","payments.recordedAt","payments.reference","payments.reversalOf","payments.reason","outstanding.seller","outstanding.settlement","repairs","mileage","financial","basisVersions.id","basisVersions.version","basisVersions.total","basisVersions.reason","sales","disposal","provenance","nextActions","identity.engineNumber","identity.chassisNumber","identity.make","identity.model","identity.year","identity.colour","identity.fuelType","identity.transmission","identity.vin","identity.crNumber","identity.notes","financial.currency","financial.scale","financial.purchase","financial.repairs","financial.additionalCosts","financial.basis","financial.cashIn","financial.cashOut","financial.net"],"create":["vehicle","supplierId","purchaseDate","purchaseType","purchasePrice","listedPrice","mileage","paymentMethod"],"receive":["date","disposition.kind","disposition.reason"],"update":["reason"],"release":["cycleId"]},"Supplier":{"read":["id","revision","type","name","category","active","contacts","provenance","directory.name","directory.category","directory.nicOrRegNumber","directory.address","directory.phone","directory.hotline","directory.recurring","directory.notes","directory.contacts","contributions.purchases"],"create":["name","category","nicOrRegNumber","address","phone","hotline","recurring","notes","contacts"],"update":["name","category","nicOrRegNumber","address","phone","hotline","recurring","notes","contacts"],"archive":["active"]},"RepairVendor":{"read":["id","revision","type","name","active","contacts","provenance","directory.name","directory.category","directory.nicOrRegNumber","directory.address","directory.phone","directory.hotline","directory.recurring","directory.specialisation","directory.notes","directory.contacts","contributions.repairs"],"create":["name","category","nicOrRegNumber","address","phone","hotline","recurring","specialisation","notes","contacts"],"update":["name","category","nicOrRegNumber","address","phone","hotline","recurring","specialisation","notes","contacts"],"archive":["active"]},"Settings":{"read":["id","revision","policyVersion","company","company.name","company.identity","company.address","company.phone","company.email","declarations","currency","scale","timezone","tiers","warningLeadDays","processingFee","dateFormat","itemsPerPage","theme"],"update":["company","company.name","company.identity","company.address","company.phone","company.email","declarations","currency","scale","timezone","tiers","warningLeadDays","processingFee","dateFormat","itemsPerPage","theme"]},"FinanceCompany":{"read":["id","revision","type","name","active","contacts","provenance","policy","policy.path","policy.commission.basis","policy.commission.rateBps","policy.commission.fixed","policy.processingFee","policy.reconciliationMethod","contributions.settlementPurchases","contributions.leaseSales","contributions.brokerage","contributions.entitlements","contributions.remittances"],"create":["name","contacts","policy","policy.path","policy.commission.basis","policy.commission.rateBps","policy.commission.fixed","policy.processingFee","policy.reconciliationMethod"],"update":["name","contacts","policy","policy.path","policy.commission.basis","policy.commission.rateBps","policy.commission.fixed","policy.processingFee","policy.reconciliationMethod"],"archive":["active"]},"Notification":{"read":["id","revision","kind","target","createdAt","readAt"],"update":["readAt"]},"AuditLog":{"read":["id","entityType","entityId","action","at","actor","reason","fields"]}}'; pid uuid; admin_id uuid; rule jsonb;
BEGIN
 FOR old IN SELECT rp."roleId",p.id,p.rule FROM vamotors."RolePermission" rp JOIN vamotors."Permission" p ON p.id=rp."permissionId" LOOP
  IF universe #> ARRAY[old.rule->>'subject',old.rule->>'action'] IS NULL THEN RAISE EXCEPTION 'UNKNOWN_PREBASE_GRANT'; END IF;
  SELECT coalesce(jsonb_agg(f ORDER BY f),'[]'::jsonb) INTO fields FROM jsonb_array_elements_text(universe #> ARRAY[old.rule->>'subject',old.rule->>'action']) f
   WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(universe #> ARRAY[old.rule->>'subject',old.rule->>'action']) child WHERE starts_with(child,f||'.'))
   AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(old.rule->'fields') selected WHERE selected='*' OR selected=f OR starts_with(f,selected||'.'));
  replacement:=jsonb_set(old.rule,'{fields}',fields);
  INSERT INTO vamotors."Permission"(id,"ruleHash",rule) VALUES(gen_random_uuid(),encode(sha256(convert_to(vamotors.cost_migration_canonical(replacement),'UTF8')),'hex'),replacement) ON CONFLICT("ruleHash") DO NOTHING;
  SELECT id INTO pid FROM vamotors."Permission" WHERE "ruleHash"=encode(sha256(convert_to(vamotors.cost_migration_canonical(replacement),'UTF8')),'hex');
  DELETE FROM vamotors."RolePermission" WHERE "roleId"=old."roleId" AND "permissionId"=old.id;
  INSERT INTO vamotors."RolePermission" VALUES(old."roleId",pid) ON CONFLICT DO NOTHING;
 END LOOP;
 SELECT id INTO admin_id FROM vamotors."Role" WHERE "systemKey"='ADMINISTRATOR';
 IF admin_id IS NOT NULL THEN
  FOR rule IN SELECT value FROM jsonb_array_elements('[{"subject":"PurchaseRecord","action":"read","fields":["*"]},{"subject":"PurchaseRecord","action":"update","fields":["reason","cycleId","patch.purchaseDate","patch.purchasePrice","patch.notes"]},{"subject":"PurchaseRecord","action":"pay","fields":["*"]},{"subject":"VehicleCost","action":"read","fields":["*"]},{"subject":"VehicleCost","action":"create","fields":["*"]},{"subject":"VehicleCost","action":"update","fields":["*"]},{"subject":"VehicleCost","action":"pay","fields":["*"]}]'::jsonb) LOOP
   INSERT INTO vamotors."Permission"(id,"ruleHash",rule) VALUES(gen_random_uuid(),encode(sha256(convert_to(vamotors.cost_migration_canonical(rule),'UTF8')),'hex'),rule) ON CONFLICT("ruleHash") DO NOTHING;
   SELECT id INTO pid FROM vamotors."Permission" WHERE "ruleHash"=encode(sha256(convert_to(vamotors.cost_migration_canonical(rule),'UTF8')),'hex');
   INSERT INTO vamotors."RolePermission" VALUES(admin_id,pid) ON CONFLICT DO NOTHING;
  END LOOP;
 END IF;
 UPDATE vamotors."Role" SET revision=revision+1;
END $$;
SET CONSTRAINTS ALL IMMEDIATE;
ALTER TABLE vamotors."Role" ENABLE TRIGGER protected_role;
ALTER TABLE vamotors."RolePermission" ENABLE TRIGGER protected_permissions;
DROP FUNCTION vamotors.cost_migration_canonical(jsonb);
COMMIT;
