BEGIN;
SELECT value FROM vamotors."BusinessSequence" WHERE id=1 FOR UPDATE;
SELECT vamotors.lock_admin_guard();

ALTER TABLE vamotors."EntityReadVersion" DROP CONSTRAINT "EntityReadVersion_entityType_check";
ALTER TABLE vamotors."EntityReadVersion" ADD CONSTRAINT "EntityReadVersion_entityType_check" CHECK("entityType" IN ('Vehicle','PurchaseRecord','Customer','Supplier','RepairVendor','FinanceCompany','Settings','RateSheet','Quote','VehicleCost','ImportBatch','Document','ApprovalRequest','RepairRecord'));

-- Additive to EXACT accepted c462: all17 accepted migration bytes are retained.
CREATE TABLE vamotors."RepairRecord" (
 id uuid PRIMARY KEY, "cycleId" uuid NOT NULL REFERENCES vamotors."PurchaseRecord"(id) ON DELETE RESTRICT,
 "vendorId" uuid NOT NULL REFERENCES vamotors."RepairVendor"(id) ON DELETE RESTRICT,
 request text NOT NULL CHECK(request=btrim(request) AND length(request) BETWEEN 1 AND 2000),
 "sentDate" date NOT NULL CHECK("sentDate" BETWEEN DATE '0001-01-01' AND (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Colombo')::date),
 "returnedDate" date, summary text CHECK(summary IS NULL OR (summary=btrim(summary) AND length(summary) BETWEEN 1 AND 2000)),
 "invoiceAmount" bigint CHECK("invoiceAmount" BETWEEN 0 AND 99999999999999), "invoiceDate" date CHECK("invoiceDate">=DATE '0001-01-01'),
 revision integer NOT NULL DEFAULT 1 CHECK(revision BETWEEN 1 AND 2147483647),
 "createdBy" uuid NOT NULL REFERENCES vamotors."user"(id) ON DELETE RESTRICT,
 "commandId" uuid NOT NULL UNIQUE REFERENCES vamotors."CommandReceipt"(id) ON DELETE RESTRICT,
 "returnCommandId" uuid UNIQUE REFERENCES vamotors."CommandReceipt"(id) ON DELETE RESTRICT,
 "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(id,"cycleId"),
 CHECK (("returnedDate" IS NULL AND summary IS NULL AND "invoiceAmount" IS NULL AND "invoiceDate" IS NULL AND "returnCommandId" IS NULL)
  OR ("returnedDate" IS NOT NULL AND summary IS NOT NULL AND "invoiceAmount" IS NOT NULL AND "invoiceDate" IS NOT NULL AND "returnCommandId" IS NOT NULL AND "returnedDate">="sentDate" AND "invoiceDate"<="returnedDate" AND "returnedDate"<=(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Colombo')::date))
);
CREATE UNIQUE INDEX one_open_repair ON vamotors."RepairRecord"("cycleId") WHERE "returnedDate" IS NULL;
CREATE INDEX "RepairRecord_cycleId_sentDate_id_idx" ON vamotors."RepairRecord"("cycleId","sentDate",id);
CREATE INDEX "RepairRecord_vendorId_returnedDate_sentDate_id_idx" ON vamotors."RepairRecord"("vendorId","returnedDate","sentDate",id);
CREATE TABLE vamotors."RepairPayment" (
 id uuid PRIMARY KEY, "repairId" uuid NOT NULL, "cycleId" uuid NOT NULL REFERENCES vamotors."PurchaseRecord"(id) ON DELETE RESTRICT,
 FOREIGN KEY("repairId","cycleId") REFERENCES vamotors."RepairRecord"(id,"cycleId") ON DELETE RESTRICT,
 amount bigint NOT NULL CHECK(amount BETWEEN 1 AND 99999999999999), direction text NOT NULL CHECK(direction IN ('IN','OUT')),
 category text NOT NULL CHECK(category='REPAIR'), "occurredDate" date NOT NULL CHECK("occurredDate" BETWEEN DATE '0001-01-01' AND (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Colombo')::date),
 method text NOT NULL CHECK(method IN ('CASH','BANK_TRANSFER')), currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'), scale integer NOT NULL CHECK(scale=2),
 reference text CHECK(reference IS NULL OR (reference=btrim(reference) AND length(reference) BETWEEN 1 AND 200)),
 "reversalOf" uuid UNIQUE, reason text CHECK(reason IS NULL OR (reason=btrim(reason) AND length(reason) BETWEEN 1 AND 2000)),
 "createdBy" uuid NOT NULL REFERENCES vamotors."user"(id) ON DELETE RESTRICT,
 "commandId" uuid NOT NULL REFERENCES vamotors."CommandReceipt"(id) ON DELETE RESTRICT,
 "lineKey" text NOT NULL CHECK(length("lineKey") BETWEEN 1 AND 100), "recordedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(id,"repairId","cycleId"), UNIQUE("commandId","lineKey"), UNIQUE("reversalOf","repairId","cycleId"),
 FOREIGN KEY("reversalOf","repairId","cycleId") REFERENCES vamotors."RepairPayment"(id,"repairId","cycleId") ON DELETE RESTRICT
);
CREATE INDEX "RepairPayment_repairId_occurredDate_id_idx" ON vamotors."RepairPayment"("repairId","occurredDate",id);
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON vamotors."RepairPayment" FOR EACH STATEMENT EXECUTE FUNCTION vamotors.append_only();
CREATE TRIGGER no_delete BEFORE DELETE OR TRUNCATE ON vamotors."RepairRecord" FOR EACH STATEMENT EXECUTE FUNCTION vamotors.append_only();

CREATE OR REPLACE VIEW vamotors."CashMovement" AS
 SELECT 'PURCHASE'::text AS "sourceType", "cycleId" AS "sourceId", id AS "paymentId", "occurredDate" AS date, direction, amount, method, category, "commandId" FROM vamotors."PurchasePayment"
  UNION ALL SELECT 'COST'::text,"costId",id,"occurredDate",direction,amount,method,category,"commandId" FROM vamotors."CostPayment"
  UNION ALL SELECT 'DISPOSAL'::text,"disposalId",id,"occurredDate",direction,amount,method,category,"commandId" FROM vamotors."DisposalReceipt"
 UNION ALL SELECT 'REPAIR'::text,"repairId",id,"occurredDate",direction,amount,method,category,"commandId" FROM vamotors."RepairPayment";

CREATE FUNCTION vamotors.repair_components(cid uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'amount',"invoiceAmount"::text) ORDER BY id),'[]'::jsonb) FROM vamotors."RepairRecord" WHERE "cycleId"=cid AND "returnedDate" IS NOT NULL
$$;
DO $$
DECLARE source text; updated text;
BEGIN
 SELECT pg_get_functiondef('vamotors.cycle_cost_payments_json(text,uuid)'::regprocedure) INTO source;
 updated:=replace(source,') p',E'\n UNION ALL SELECT id,"commandId",amount,direction,category,"occurredDate",method,"recordedAt",reference,"reversalOf",reason FROM vamotors."RepairPayment" WHERE source=''REPAIR'' AND "repairId"=owner) p');
 IF updated=source THEN RAISE EXCEPTION 'REPAIR_PAYMENT_JSON_BASE_MISMATCH'; END IF; EXECUTE updated;
END $$;
CREATE FUNCTION vamotors.repair_json(rid uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_strip_nulls(jsonb_build_object('id',id,'revision',revision,'vendorId',"vendorId",'request',request,'sentDate',"sentDate"::text,'returnedDate',"returnedDate"::text,'summary',summary,'invoiceAmount',"invoiceAmount"::text,'invoiceDate',"invoiceDate"::text,'payments',vamotors.cycle_cost_payments_json('REPAIR',id))) FROM vamotors."RepairRecord" WHERE id=rid
$$;
CREATE FUNCTION vamotors.repairs_json(cid uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT coalesce(jsonb_agg(vamotors.repair_json(id) ORDER BY "sentDate",id),'[]'::jsonb) FROM vamotors."RepairRecord" WHERE "cycleId"=cid
$$;
CREATE FUNCTION vamotors.repair_diff(old jsonb, after jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT coalesce(jsonb_object_agg(f,jsonb_build_object('before',coalesce(old#>string_to_array(f,'.'),'null'::jsonb),'after',coalesce(after#>string_to_array(f,'.'),'null'::jsonb))),'{}'::jsonb)
 FROM unnest(ARRAY['id','revision','vendorId','request','sentDate','returnedDate','summary','invoiceAmount','invoiceDate','payments','payments.id','payments.owner.type','payments.owner.id','payments.commandId','payments.amount','payments.direction','payments.category','payments.date','payments.method','payments.recordedAt','payments.reference','payments.reversalOf','payments.reason']) f
 WHERE coalesce(old#>string_to_array(f,'.'),'null'::jsonb) IS DISTINCT FROM coalesce(after#>string_to_array(f,'.'),'null'::jsonb)
$$;
-- Positive current grants only, with trusted row conditions. No caller GUC,
-- executable client expressions, saved recipient authority or definer EXECUTE.
CREATE FUNCTION vamotors.repair_fields(uid uuid, typ text, act text, row_data jsonb, paths text[]) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT NOT EXISTS(SELECT 1 FROM unnest(paths) path WHERE NOT EXISTS(
  SELECT 1 FROM vamotors."user" u JOIN vamotors."UserRole" ur ON ur."userId"=u.id JOIN vamotors."Role" r ON r.id=ur."roleId" AND r.active JOIN vamotors."RolePermission" rp ON rp."roleId"=r.id JOIN vamotors."Permission" p ON p.id=rp."permissionId"
  WHERE u.id=uid AND u.active AND p.rule->>'subject'=typ AND p.rule->>'action'=act
  AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(p.rule->'fields') f WHERE f='*' OR f=path OR starts_with(path,f||'.'))
  AND NOT EXISTS(SELECT 1 FROM jsonb_each(coalesce(p.rule->'conditions','{}'::jsonb)) c WHERE row_data->>c.key IS DISTINCT FROM CASE WHEN c.value='"$actor.id"'::jsonb THEN uid::text ELSE c.value#>>'{}' END)))
$$;
CREATE FUNCTION vamotors.repair_return_recipient(uid uuid, rid uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT vamotors.repair_fields(uid,'PurchaseRecord','read',to_jsonb(p),ARRAY['id','repairs']) AND vamotors.repair_fields(uid,'RepairRecord','read',to_jsonb(r),ARRAY['id'])
 AND (vamotors.repair_fields(uid,'PurchaseRecord','release',to_jsonb(p),ARRAY['cycleId'])
  OR (vamotors.repair_fields(uid,'PurchaseRecord','update',to_jsonb(p),ARRAY['cycleId']) AND vamotors.repair_fields(uid,'RepairRecord','update',to_jsonb(r),ARRAY['repairId']))
  OR (vamotors.repair_fields(uid,'PurchaseRecord','pay',to_jsonb(p),ARRAY['cycleId']) AND vamotors.repair_fields(uid,'RepairRecord','pay',to_jsonb(r),ARRAY['repairId'])))
 FROM vamotors."RepairRecord" r JOIN vamotors."PurchaseRecord" p ON p.id=r."cycleId" WHERE r.id=rid
$$;

CREATE FUNCTION vamotors.repair_owner_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='INSERT' AND (NEW.revision<>1 OR NEW."returnedDate" IS NOT NULL) THEN RAISE EXCEPTION 'REPAIR_DISPATCH_REQUIRED' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND ((to_jsonb(NEW)-ARRAY['returnedDate','summary','invoiceAmount','invoiceDate','returnCommandId','revision','updatedAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['returnedDate','summary','invoiceAmount','invoiceDate','returnCommandId','revision','updatedAt']) OR OLD.revision=2147483647 OR NEW.revision::bigint<>OLD.revision::bigint+1
  OR (OLD."returnedDate" IS NOT NULL AND ROW(NEW."returnedDate",NEW.summary,NEW."invoiceAmount",NEW."invoiceDate",NEW."returnCommandId") IS DISTINCT FROM ROW(OLD."returnedDate",OLD.summary,OLD."invoiceAmount",OLD."invoiceDate",OLD."returnCommandId"))) THEN RAISE EXCEPTION 'IMMUTABLE_REPAIR_TERMS' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER repair_owner BEFORE INSERT OR UPDATE ON vamotors."RepairRecord" FOR EACH ROW EXECUTE FUNCTION vamotors.repair_owner_guard();

CREATE FUNCTION vamotors.check_repair_root() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE c vamotors."CommandReceipt"; r vamotors."RepairRecord"; v vamotors."Vehicle"; prior jsonb; current_payload jsonb; expected jsonb; child_before jsonb; child_after jsonb; financial jsonb; basis jsonb; repairs jsonb; incoming numeric; outgoing numeric; incurred numeric; repair_total numeric; kind text; eid uuid; rev integer; n integer; uid uuid; operation text; fields text[]; pmt vamotors."RepairPayment";
BEGIN
 SELECT x.* INTO c FROM vamotors."CommandReceipt" x JOIN vamotors."EntityReadVersion" e ON e."commandId"=x.id AND e."entityType"='PurchaseRecord' AND e."entityId"=NEW.id AND e.revision=NEW.revision WHERE x.xmin=pg_current_xact_id()::xid AND e.xmin=pg_current_xact_id()::xid;
 -- Other owners still validate their own updates. Once a repair was changed in
 -- this transaction, missing parent evidence is a rejection, NEVER an opt-out.
 IF NOT EXISTS(SELECT 1 FROM vamotors."RepairRecord" x WHERE x."cycleId"=NEW.id AND x.xmin=pg_current_xact_id()::xid) THEN RETURN NULL; END IF;
 IF TG_OP<>'UPDATE' OR c.id IS NULL OR c.result->>'type' IS DISTINCT FROM 'RepairRecord' OR c."commandName" NOT IN ('sendRepair','returnRepair','payRepair','reversePayment') THEN RAISE EXCEPTION 'REPAIR_ROOT_EVIDENCE_REQUIRED' USING ERRCODE='23514'; END IF;
 SELECT * INTO r FROM vamotors."RepairRecord" WHERE id=(c.result->>'id')::uuid AND "cycleId"=NEW.id AND xmin=pg_current_xact_id()::xid;
 SELECT * INTO v FROM vamotors."Vehicle" WHERE id=NEW."vehicleId";
 uid:=substring(c."actorKey" FROM 6)::uuid;
 IF r.id IS NULL OR c."actorKey"<>'USER:'||uid::text OR NOT EXISTS(SELECT 1 FROM vamotors."user" WHERE id=uid AND active)
 OR c."environmentId"<>(SELECT id FROM vamotors."Environment" WHERE singleton=1) OR c."businessSequence" IS NULL OR NOT EXISTS(SELECT 1 FROM vamotors."BusinessSequence" WHERE id=1 AND value=c."businessSequence" AND xmin=pg_current_xact_id()::xid)
 OR c.result<>jsonb_build_object('type','RepairRecord','id',r.id,'revision',r.revision)
 OR OLD.revision=2147483647 OR NEW.revision::bigint<>OLD.revision::bigint+1
 OR NEW."acquisitionCommandId" IS NULL OR (to_jsonb(NEW)-ARRAY['status','available','holdReason','revision','updatedAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','available','holdReason','revision','updatedAt'])
 OR EXISTS(SELECT 1 FROM vamotors."Vehicle" WHERE id=v.id AND xmin=pg_current_xact_id()::xid)
 OR EXISTS(SELECT 1 FROM vamotors."RepairRecord" WHERE xmin=pg_current_xact_id()::xid AND id<>r.id)
 OR EXISTS(SELECT 1 FROM vamotors."PurchasePayment" WHERE "commandId"=c.id) OR EXISTS(SELECT 1 FROM vamotors."CostPayment" WHERE "commandId"=c.id) OR EXISTS(SELECT 1 FROM vamotors."VehicleCost" WHERE xmin=pg_current_xact_id()::xid) OR EXISTS(SELECT 1 FROM vamotors."MileageReading" WHERE "commandId"=c.id)
 OR (SELECT count(*) FROM vamotors."AuditEntry" WHERE "commandId"=c.id)<>3 OR (SELECT count(*) FROM vamotors."EntityReadVersion" WHERE "commandId"=c.id)<>3
 THEN RAISE EXCEPTION 'INVALID_REPAIR_ROOT_GRAPH' USING ERRCODE='23514'; END IF;
 SELECT payload INTO child_before FROM vamotors."EntityReadVersion" WHERE "entityType"='RepairRecord' AND "entityId"=r.id AND sequence<c."businessSequence" ORDER BY sequence DESC LIMIT 1;
 child_after:=vamotors.repair_json(r.id);
  -- Vehicle.status is the resolved cycle's originating status, not a physical
  -- table column or the command's resulting status. Match JS vehicleAuth(row).
  IF NOT vamotors.repair_fields(uid,'PurchaseRecord','read',to_jsonb(NEW),ARRAY['id','revision','vehicleId','status','closedAt','purchaseDate','repairs']) OR NOT vamotors.repair_fields(uid,'Vehicle','read',to_jsonb(v)||jsonb_build_object('status',OLD.status),ARRAY['id','identityRevision','cycleId']) OR NOT vamotors.repair_fields(uid,'RepairRecord','read',to_jsonb(r),ARRAY['id','revision']) THEN RAISE EXCEPTION 'REPAIR_READ_AUTHORITY_REQUIRED' USING ERRCODE='23514'; END IF;
 IF c."commandName"='sendRepair' THEN
  IF child_before IS NOT NULL OR r.revision<>1 OR r."commandId"<>c.id OR r."createdBy"<>uid OR r."returnedDate" IS NOT NULL OR OLD.status<>'IN_STOCK' OR NEW.status<>'IN_REPAIR' OR NEW.available OR NEW."holdReason" IS NOT NULL OR NEW."closedAt" IS NOT NULL OR NEW."receivedDate" IS NULL OR v."activePurchaseId" IS DISTINCT FROM NEW.id OR r."sentDate"<NEW."purchaseDate"
  OR NOT EXISTS(SELECT 1 FROM vamotors."RepairVendor" WHERE id=r."vendorId" AND active) OR NOT vamotors.repair_fields(uid,'RepairVendor','read',(SELECT to_jsonb(x) FROM vamotors."RepairVendor" x WHERE id=r."vendorId"),ARRAY['id','revision','active'])
   OR NOT vamotors.repair_fields(uid,'PurchaseRecord','read',to_jsonb(NEW),ARRAY['receivedDate']) OR NOT vamotors.repair_fields(uid,'PurchaseRecord','update',to_jsonb(NEW),ARRAY['cycleId']) OR NOT vamotors.repair_fields(uid,'RepairRecord','create',to_jsonb(r),ARRAY['cycleId','vendorId','request','sentDate']) THEN RAISE EXCEPTION 'INVALID_REPAIR_DISPATCH' USING ERRCODE='23514'; END IF;
 ELSE
  IF child_before IS NULL OR r.revision::bigint<>(child_before->>'revision')::bigint+1 OR NOT vamotors.repair_fields(uid,'RepairRecord','read',to_jsonb(r),ARRAY['sentDate','returnedDate','invoiceAmount','payments.amount','payments.direction']) THEN RAISE EXCEPTION 'REPAIR_SOURCE_REQUIRED' USING ERRCODE='23514'; END IF;
   IF NOT vamotors.repair_fields(uid,'PurchaseRecord','read',to_jsonb(NEW),ARRAY['financial.currency','financial.scale','financial.cashIn','financial.cashOut','financial.basis','purchasePrice','payments.amount','payments.direction'])
   OR (NEW."purchaseType"='LEASE_SETTLEMENT' AND NOT vamotors.repair_fields(uid,'PurchaseRecord','read',to_jsonb(NEW),ARRAY['settlement.amount','settlement.cashToSeller']))
  OR EXISTS(SELECT 1 FROM vamotors."VehicleCost" k WHERE k."cycleId"=NEW.id AND (NOT vamotors.repair_fields(uid,'PurchaseRecord','read',to_jsonb(NEW),ARRAY['costs.amount','costs.payments.amount','costs.payments.direction']) OR NOT vamotors.repair_fields(uid,'VehicleCost','read',to_jsonb(k),ARRAY['amount','payments.amount','payments.direction'])))
  OR EXISTS(SELECT 1 FROM vamotors."RepairRecord" k WHERE k."cycleId"=NEW.id AND NOT vamotors.repair_fields(uid,'RepairRecord','read',to_jsonb(k),ARRAY['invoiceAmount','returnedDate','payments.amount','payments.direction'])) THEN RAISE EXCEPTION 'REPAIR_CONSUMED_SOURCE_READ_REQUIRED' USING ERRCODE='23514'; END IF;
  IF c."commandName"='reversePayment' AND NOT vamotors.repair_fields(uid,'RepairRecord','read',to_jsonb(r),ARRAY['payments.id','payments.owner.type','payments.owner.id','payments.amount','payments.direction','payments.date','payments.method','payments.reference','payments.reversalOf']) THEN RAISE EXCEPTION 'REPAIR_REVERSAL_SOURCE_READ_REQUIRED' USING ERRCODE='23514'; END IF;
  IF c."commandName"='returnRepair' THEN
   IF child_before ? 'returnedDate' OR r."returnCommandId"<>c.id OR OLD.status<>'IN_REPAIR' OR NEW.status<>'IN_STOCK' OR NEW.available OR NEW."holdReason" IS DISTINCT FROM 'RETURNED_AWAITING_RELEASE' OR NEW."closedAt" IS NOT NULL OR v."activePurchaseId" IS DISTINCT FROM NEW.id OR r."returnedDate" IS NULL
   OR NOT vamotors.repair_fields(uid,'PurchaseRecord','update',to_jsonb(NEW),ARRAY['cycleId']) OR NOT vamotors.repair_fields(uid,'RepairRecord','update',to_jsonb(r),ARRAY['repairId','invoiceAmount','invoiceDate','returnedDate','summary']) THEN RAISE EXCEPTION 'INVALID_REPAIR_RETURN' USING ERRCODE='23514'; END IF;
  ELSIF r."returnedDate" IS NULL OR ROW(NEW.status,NEW.available,NEW."holdReason") IS DISTINCT FROM ROW(OLD.status,OLD.available,OLD."holdReason") OR (child_after-ARRAY['revision','payments']) IS DISTINCT FROM (child_before-ARRAY['revision','payments']) THEN RAISE EXCEPTION 'INVALID_REPAIR_PAYMENT_ROOT' USING ERRCODE='23514'; END IF;
 END IF;
 n:=CASE WHEN c."commandName" IN ('sendRepair','returnRepair') THEN 1 ELSE 0 END;
 IF (SELECT count(*) FROM vamotors."StatusEvent" WHERE "commandId"=c.id)<>n OR (n=1 AND NOT EXISTS(SELECT 1 FROM vamotors."StatusEvent" WHERE "commandId"=c.id AND "cycleId"=NEW.id AND "from"=OLD.status AND "to"=NEW.status AND action=c."commandName" AND "userId"=uid AND xmin=pg_current_xact_id()::xid AND "occurredAt"=CASE WHEN c."commandName"='sendRepair' THEN r."sentDate" ELSE r."returnedDate" END::timestamp)) THEN RAISE EXCEPTION 'INVALID_REPAIR_STATUS_GRAPH' USING ERRCODE='23514'; END IF;
 IF (SELECT count(*) FROM vamotors."RepairPayment" WHERE "commandId"=c.id) NOT BETWEEN (CASE WHEN c."commandName" IN ('payRepair','reversePayment') THEN 1 ELSE 0 END) AND (CASE WHEN c."commandName"='sendRepair' THEN 0 WHEN c."commandName"='reversePayment' THEN 2 ELSE 1 END) THEN RAISE EXCEPTION 'INVALID_REPAIR_CASH_CARDINALITY' USING ERRCODE='23514'; END IF;
 IF c."commandName"='reversePayment' AND ((SELECT count(*) FROM vamotors."RepairPayment" WHERE "commandId"=c.id AND "reversalOf" IS NOT NULL)<>1 OR (SELECT count(*) FROM vamotors."RepairPayment" WHERE "commandId"=c.id AND direction='OUT')>1) THEN RAISE EXCEPTION 'INVALID_REPAIR_REVERSAL_CARDINALITY' USING ERRCODE='23514'; END IF;
 IF (SELECT count(*) FROM vamotors."CycleBasisVersion" WHERE "commandId"=c.id)<>(CASE WHEN c."commandName"='returnRepair' THEN 1 ELSE 0 END) OR EXISTS(SELECT 1 FROM vamotors."CycleBasisVersion" b WHERE b."commandId"=c.id AND (b."cycleId"<>NEW.id OR b.reason<>'Actual repair invoice' OR b.xmin<>pg_current_xact_id()::xid)) THEN RAISE EXCEPTION 'INVALID_REPAIR_BASIS_CARDINALITY' USING ERRCODE='23514'; END IF;
 IF c."commandName"='returnRepair' THEN
   IF EXISTS(SELECT 1 FROM vamotors."user" u WHERE u.active AND vamotors.repair_return_recipient(u.id,r.id) AND NOT EXISTS(SELECT 1 FROM vamotors."Notification" n WHERE n."recipientUserId"=u.id AND n."eventKey"='repair:returned:'||r.id::text||':2' AND n.kind='REPAIR_RETURNED' AND n."targetType"='RepairRecord' AND n."targetId"=r.id AND n.xmin=pg_current_xact_id()::xid))
   OR EXISTS(SELECT 1 FROM vamotors."Notification" n WHERE n."eventKey"='repair:returned:'||r.id::text||':2' AND (n.kind<>'REPAIR_RETURNED' OR n."targetType"<>'RepairRecord' OR n."targetId"<>r.id OR NOT vamotors.repair_return_recipient(n."recipientUserId",r.id))) THEN RAISE EXCEPTION 'REPAIR_RETURN_NOTIFICATION_REQUIRED' USING ERRCODE='23514'; END IF;
 END IF;
  SELECT coalesce(sum(CASE direction WHEN 'IN' THEN amount::numeric ELSE 0 END),0),coalesce(sum(CASE direction WHEN 'OUT' THEN amount::numeric ELSE 0 END),0) INTO incoming,outgoing FROM vamotors."CashMovement" m WHERE (m."sourceType"='PURCHASE' AND m."sourceId"=NEW.id) OR (m."sourceType"='COST' AND m."sourceId" IN (SELECT id FROM vamotors."VehicleCost" WHERE "cycleId"=NEW.id)) OR (m."sourceType"='REPAIR' AND m."sourceId" IN (SELECT id FROM vamotors."RepairRecord" WHERE "cycleId"=NEW.id)) OR (m."sourceType"='DISPOSAL' AND m."sourceId" IN (SELECT id FROM vamotors."Disposal" WHERE "cycleId"=NEW.id));
 IF incoming>9999999999999999 OR outgoing>9999999999999999 THEN RAISE EXCEPTION 'MONEY_OVERFLOW' USING ERRCODE='23514'; END IF;
 SELECT coalesce(sum(amount::numeric),0) INTO incurred FROM vamotors."VehicleCost" WHERE "cycleId"=NEW.id;
 SELECT coalesce(sum("invoiceAmount"::numeric),0) INTO repair_total FROM vamotors."RepairRecord" WHERE "cycleId"=NEW.id AND "returnedDate" IS NOT NULL;
 SELECT jsonb_build_object('currency',b.currency,'scale',2,'purchase',NEW."purchasePrice"::text,'repairs',repair_total::text,'additionalCosts',incurred::text,'basis',b.total::text,'cashIn',incoming::text,'cashOut',outgoing::text,'net',(incoming-outgoing)::text) INTO financial FROM vamotors."CycleBasisVersion" b WHERE b."cycleId"=NEW.id ORDER BY version DESC LIMIT 1;
 SELECT jsonb_agg(jsonb_build_object('id',id,'version',version,'total',total::text,'reason',reason) ORDER BY version) INTO basis FROM vamotors."CycleBasisVersion" WHERE "cycleId"=NEW.id;
 repairs:=vamotors.repairs_json(NEW.id);
 FOREACH kind IN ARRAY ARRAY['PurchaseRecord','Vehicle','RepairRecord'] LOOP
  eid:=CASE kind WHEN 'PurchaseRecord' THEN NEW.id WHEN 'Vehicle' THEN v.id ELSE r.id END;
  rev:=CASE kind WHEN 'PurchaseRecord' THEN NEW.revision WHEN 'Vehicle' THEN v.revision ELSE r.revision END;
  SELECT payload INTO prior FROM vamotors."EntityReadVersion" WHERE "entityType"=kind AND "entityId"=eid AND sequence<c."businessSequence" ORDER BY sequence DESC LIMIT 1;
  SELECT payload INTO current_payload FROM vamotors."EntityReadVersion" WHERE "entityType"=kind AND "entityId"=eid AND "commandId"=c.id AND sequence=c."businessSequence" AND revision=rev AND xmin=pg_current_xact_id()::xid;
  IF kind='RepairRecord' THEN expected:=child_after;
  ELSE
   IF prior IS NULL OR (prior->>'revision')::integer IS DISTINCT FROM OLD.revision OR (prior->>'identityRevision')::integer IS DISTINCT FROM v.revision THEN RAISE EXCEPTION 'REPAIR_PARENT_SOURCE_REQUIRED' USING ERRCODE='23514'; END IF;
   IF kind='PurchaseRecord' THEN prior:=jsonb_set(prior,'{seller}',(SELECT jsonb_build_object('type','SUPPLIER','id',s.id,'name',s.name,'active',s.active) FROM vamotors."Supplier" s WHERE s.id=NEW."supplierId")); END IF;
   expected:=(prior-'holdReason')||jsonb_build_object('revision',NEW.revision,'status',NEW.status,'available',NEW.available,'financial',financial);
   IF NEW."holdReason" IS NOT NULL THEN expected:=expected||jsonb_build_object('holdReason',NEW."holdReason"); END IF;
   IF kind='PurchaseRecord' THEN expected:=expected||jsonb_build_object('repairs',repairs,'basisVersions',basis); END IF;
  END IF;
  IF current_payload IS DISTINCT FROM expected OR NOT EXISTS(SELECT 1 FROM vamotors."AuditEntry" a WHERE a."commandId"=c.id AND a."entityType"=kind AND a."entityId"=eid AND a.action=c."commandName" AND a."actorKind"='USER' AND a."userId"=uid AND a.xmin=pg_current_xact_id()::xid AND a."fieldDiff"=CASE WHEN kind='RepairRecord' THEN vamotors.repair_diff(prior,current_payload) ELSE vamotors.cycle_cost_diff(kind,prior,current_payload) END AND a.reason IS NOT DISTINCT FROM CASE WHEN c."commandName"='reversePayment' THEN (SELECT reason FROM vamotors."RepairPayment" WHERE "commandId"=c.id AND "reversalOf" IS NOT NULL) END) THEN RAISE EXCEPTION 'INVALID_REPAIR_VERSION_AUDIT' USING ERRCODE='23514'; END IF;
 END LOOP;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER repair_root_graph AFTER INSERT OR UPDATE ON vamotors."PurchaseRecord" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vamotors.check_repair_root();

CREATE FUNCTION vamotors.check_repair_child() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r vamotors."RepairRecord"; p vamotors."PurchaseRecord"; c vamotors."CommandReceipt"; original vamotors."RepairPayment"; paid numeric; policy jsonb; fields text[]; rid uuid;
BEGIN
 IF TG_TABLE_NAME='RepairRecord' THEN rid:=NEW.id; ELSE rid:=NEW."repairId"; END IF;
 SELECT * INTO r FROM vamotors."RepairRecord" WHERE id=rid AND xmin=pg_current_xact_id()::xid;
 SELECT * INTO p FROM vamotors."PurchaseRecord" WHERE id=r."cycleId" AND xmin=pg_current_xact_id()::xid;
 SELECT x.* INTO c FROM vamotors."CommandReceipt" x JOIN vamotors."EntityReadVersion" e ON e."commandId"=x.id AND e."entityType"='RepairRecord' AND e."entityId"=r.id AND e.revision=r.revision WHERE x.xmin=pg_current_xact_id()::xid AND e.xmin=pg_current_xact_id()::xid;
 IF r.id IS NULL OR p.id IS NULL OR c.id IS NULL OR c.result<>jsonb_build_object('type','RepairRecord','id',r.id,'revision',r.revision) OR c."commandName" NOT IN ('sendRepair','returnRepair','payRepair','reversePayment') THEN RAISE EXCEPTION 'REPAIR_COMMAND_REQUIRED' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='RepairPayment' THEN
  SELECT values INTO policy FROM vamotors."SettingsVersion" WHERE id=p."settingsVersionId";
  IF NEW."commandId"<>c.id OR c."actorKey"<>'USER:'||NEW."createdBy"::text OR NEW.currency<>policy->>'currency' OR NEW.scale<>2 OR r."returnedDate" IS NULL OR c."commandName" NOT IN ('returnRepair','payRepair','reversePayment') OR NOT vamotors.repair_fields(NEW."createdBy",'PurchaseRecord','pay',to_jsonb(p),ARRAY['cycleId']) THEN RAISE EXCEPTION 'INVALID_REPAIR_PAYMENT_COMMAND' USING ERRCODE='23514'; END IF;
  fields:=CASE WHEN c."commandName"='reversePayment' THEN ARRAY['sourceType','sourceId','paymentId','reason'] ELSE ARRAY['repairId','payment.amount','payment.date','payment.method'] END;
  IF NEW.reference IS NOT NULL AND c."commandName"<>'reversePayment' THEN fields:=fields||ARRAY['payment.reference']; END IF;
  IF c."commandName"='reversePayment' AND NEW.direction='OUT' THEN fields:=fields||ARRAY['replacement.amount','replacement.date','replacement.method']||CASE WHEN NEW.reference IS NOT NULL THEN ARRAY['replacement.reference'] ELSE ARRAY[]::text[] END; END IF;
  IF NOT vamotors.repair_fields(NEW."createdBy",'RepairRecord','pay',to_jsonb(r),fields) THEN RAISE EXCEPTION 'REPAIR_PAYMENT_AUTHORITY_REQUIRED' USING ERRCODE='23514'; END IF;
  IF NEW."reversalOf" IS NOT NULL THEN
   SELECT * INTO original FROM vamotors."RepairPayment" WHERE id=NEW."reversalOf" AND "repairId"=r.id AND "cycleId"=p.id;
   IF c."commandName"<>'reversePayment' OR original.id IS NULL OR original."reversalOf" IS NOT NULL OR original.direction<>'OUT' OR NEW.direction<>'IN' OR ROW(NEW.amount,NEW."occurredDate",NEW.method,NEW.currency,NEW.scale,NEW.reference) IS DISTINCT FROM ROW(original.amount,original."occurredDate",original.method,original.currency,original.scale,original.reference) OR NEW.reason IS NULL OR NEW."lineKey"<>'reverse:'||original.id::text THEN RAISE EXCEPTION 'INVALID_REPAIR_EXACT_REVERSAL' USING ERRCODE='23514'; END IF;
  ELSIF NEW.direction<>'OUT' OR (c."commandName"<>'reversePayment' AND (NEW."lineKey"<>'payment' OR NEW.reason IS NOT NULL)) OR (c."commandName"='reversePayment' AND (NEW.reason IS NULL OR NOT EXISTS(SELECT 1 FROM vamotors."RepairPayment" x WHERE x."commandId"=c.id AND x."repairId"=r.id AND x."reversalOf" IS NOT NULL AND NEW."lineKey"='replace:'||x."reversalOf"::text AND x.reason=NEW.reason))) THEN RAISE EXCEPTION 'INVALID_REPAIR_REPLACEMENT' USING ERRCODE='23514'; END IF;
 END IF;
 SELECT coalesce(sum(CASE direction WHEN 'OUT' THEN amount::numeric ELSE -amount::numeric END),0) INTO paid FROM vamotors."RepairPayment" WHERE "repairId"=r.id;
 IF paid<0 OR paid>coalesce(r."invoiceAmount",0) THEN RAISE EXCEPTION 'INVALID_REPAIR_BALANCE' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER repair_child_graph AFTER INSERT OR UPDATE ON vamotors."RepairRecord" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vamotors.check_repair_child();
CREATE CONSTRAINT TRIGGER repair_payment_graph AFTER INSERT ON vamotors."RepairPayment" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vamotors.check_repair_child();
CREATE FUNCTION vamotors.repair_notification_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF NEW.kind='REPAIR_RETURNED' AND (NEW."readAt" IS NOT NULL OR NEW.revision<>1 OR NOT EXISTS(SELECT 1 FROM vamotors."RepairRecord" r JOIN vamotors."CommandReceipt" c ON c.id=r."returnCommandId" WHERE r.id=NEW."targetId" AND NEW."targetType"='RepairRecord' AND NEW."eventKey"='repair:returned:'||r.id::text||':2' AND r.xmin=pg_current_xact_id()::xid AND c.xmin=pg_current_xact_id()::xid AND c."commandName"='returnRepair' AND vamotors.repair_return_recipient(NEW."recipientUserId",r.id))) THEN RAISE EXCEPTION 'REPAIR_NOTIFICATION_COMMAND_REQUIRED' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER repair_notification BEFORE INSERT ON vamotors."Notification" FOR EACH ROW EXECUTE FUNCTION vamotors.repair_notification_guard();

-- Evidence cannot be appended independently and poison later source snapshots.
-- Requiring a mutated child AND root means the strict root constraint above must
-- run too, including INSERT roots (which are not lawful repair command roots).
CREATE FUNCTION vamotors.check_repair_evidence() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE rid uuid; cid uuid;
BEGIN
 IF TG_TABLE_NAME='CommandReceipt' THEN rid:=(NEW.result->>'id')::uuid; cid:=NEW.id;
 ELSE rid:=NEW."entityId"; cid:=NEW."commandId"; END IF;
 IF NOT EXISTS(
  SELECT 1 FROM vamotors."RepairRecord" r JOIN vamotors."PurchaseRecord" p ON p.id=r."cycleId" JOIN vamotors."CommandReceipt" c ON c.id=cid
  JOIN vamotors."EntityReadVersion" e ON e."commandId"=c.id AND e."entityType"='PurchaseRecord' AND e."entityId"=p.id AND e.revision=p.revision AND e.sequence=c."businessSequence"
  WHERE r.id=rid AND r.xmin=pg_current_xact_id()::xid AND p.xmin=pg_current_xact_id()::xid AND c.xmin=pg_current_xact_id()::xid AND e.xmin=pg_current_xact_id()::xid
  AND c.result=jsonb_build_object('type','RepairRecord','id',r.id,'revision',r.revision) AND c."commandName" IN ('sendRepair','returnRepair','payRepair','reversePayment')
 ) THEN RAISE EXCEPTION 'ORPHAN_REPAIR_EVIDENCE' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER repair_receipt_graph AFTER INSERT ON vamotors."CommandReceipt" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.result->>'type'='RepairRecord' OR NEW."commandName" IN ('sendRepair','returnRepair','payRepair')) EXECUTE FUNCTION vamotors.check_repair_evidence();
CREATE CONSTRAINT TRIGGER repair_version_graph AFTER INSERT ON vamotors."EntityReadVersion" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW."entityType"='RepairRecord') EXECUTE FUNCTION vamotors.check_repair_evidence();
CREATE CONSTRAINT TRIGGER repair_audit_graph AFTER INSERT ON vamotors."AuditEntry" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW."entityType"='RepairRecord') EXECUTE FUNCTION vamotors.check_repair_evidence();

-- A real CURRENT disposal is immutable. Only named existing financial owners
-- may append evidence after it; no terminal status, identity or pointer escape.
CREATE FUNCTION vamotors.current_written_off(cid uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM vamotors."PurchaseRecord" p JOIN vamotors."Vehicle" v ON v.id=p."vehicleId"
 JOIN vamotors."Disposal" d ON d."cycleId"=p.id JOIN vamotors."ApprovalRequest" a ON a.id=d."approvalId" AND a."cycleId"=p.id
 JOIN vamotors."CycleBasisVersion" b ON b.id=d."basisVersionId" AND b."cycleId"=p.id JOIN vamotors."CommandReceipt" c ON c.id=d."commandId"
 WHERE p.id=cid AND p.status='WRITTEN_OFF' AND p."closedAt" IS NOT NULL AND NOT p.available AND p."holdReason" IS NULL AND v."activePurchaseId" IS NULL
 AND d."approvalKind"='CURRENT' AND a.kind='WRITE_OFF' AND a.state='APPROVED' AND a."appliedCommandId"=c.id AND a."reviewCommandId"=c.id AND a."reviewedAt"=p."closedAt" AND a."reviewedBy"=d."createdBy" AND a."reviewedBy"<>a."requestedBy"
 AND c."commandName"='reviewApproval' AND c."actorKey"='USER:'||d."createdBy"::text AND c.result=jsonb_build_object('type','ApprovalRequest','id',a.id,'revision',a.revision)
 AND d."basisVersionId"::text=a.snapshot->>'basisVersionId' AND d."netLoss"=b.total-d.proceeds
 AND d."occurredDate"::text=a.proposal#>>'{input,date}' AND d.reason=a.proposal#>>'{input,reason}' AND d.method=a.proposal#>>'{input,method}' AND d.proceeds::text=a.proposal#>>'{input,proceeds}')
$$;
CREATE FUNCTION vamotors.check_closed_financial(old_root vamotors."PurchaseRecord", new_root vamotors."PurchaseRecord") RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE c vamotors."CommandReceipt"; uid uuid; k vamotors."VehicleCost"; r vamotors."RepairRecord"; correction_reason text; allowed_delta text[]:=ARRAY['revision','updatedAt']; payment record; fields text[]; settlement_changed boolean;
BEGIN
 SELECT x.* INTO c FROM vamotors."CommandReceipt" x JOIN vamotors."EntityReadVersion" e ON e."commandId"=x.id AND e."entityType"='PurchaseRecord' AND e."entityId"=new_root.id AND e.revision=new_root.revision AND e.sequence=x."businessSequence" WHERE x.xmin=pg_current_xact_id()::xid AND e.xmin=pg_current_xact_id()::xid;
 IF old_root.status<>'WRITTEN_OFF' OR NOT vamotors.current_written_off(new_root.id) OR c.id IS NULL OR c."actorKey" NOT LIKE 'USER:%'
 OR c."environmentId"<>(SELECT id FROM vamotors."Environment" WHERE singleton=1) OR NOT EXISTS(SELECT 1 FROM vamotors."BusinessSequence" WHERE id=1 AND value=c."businessSequence" AND xmin=pg_current_xact_id()::xid)
 OR old_root.revision=2147483647 OR new_root.revision::bigint<>old_root.revision::bigint+1 OR new_root."acquisitionCommandId" IS NULL
 OR EXISTS(SELECT 1 FROM vamotors."Vehicle" WHERE id=new_root."vehicleId" AND xmin=pg_current_xact_id()::xid)
 OR EXISTS(SELECT 1 FROM vamotors."Disposal" WHERE "cycleId"=new_root.id AND xmin=pg_current_xact_id()::xid)
 OR EXISTS(SELECT 1 FROM vamotors."DisposalReceipt" WHERE "commandId"=c.id) OR EXISTS(SELECT 1 FROM vamotors."StatusEvent" WHERE "commandId"=c.id) OR EXISTS(SELECT 1 FROM vamotors."MileageReading" WHERE "commandId"=c.id)
 THEN RAISE EXCEPTION 'CLOSED_FINANCIAL_OWNER_REQUIRED' USING ERRCODE='23514'; END IF;
 uid:=substring(c."actorKey" FROM 6)::uuid;
 IF c.result->>'type'='RepairRecord' AND c."commandName" IN ('payRepair','reversePayment') THEN
  SELECT * INTO r FROM vamotors."RepairRecord" WHERE id=(c.result->>'id')::uuid AND "cycleId"=new_root.id AND xmin=pg_current_xact_id()::xid;
  IF r.id IS NULL OR r."returnedDate" IS NULL OR EXISTS(SELECT 1 FROM vamotors."CycleBasisVersion" WHERE "commandId"=c.id) THEN RAISE EXCEPTION 'CLOSED_REPAIR_LIABILITY_REQUIRED' USING ERRCODE='23514'; END IF;
  -- repair_root/child/evidence independently validate the complete cash-only graph.
 ELSIF c.result->>'type' IN ('VehicleCost','PurchaseRecord') AND c."commandName" IN ('editCost','payCost','editPurchase','payPurchase','reversePayment') THEN
  IF c.result->>'type'='VehicleCost' THEN
   SELECT * INTO k FROM vamotors."VehicleCost" WHERE id=(c.result->>'id')::uuid AND "cycleId"=new_root.id AND xmin=pg_current_xact_id()::xid;
   IF k.id IS NULL OR c."commandName" NOT IN ('editCost','payCost','reversePayment') THEN RAISE EXCEPTION 'CLOSED_COST_OWNER_REQUIRED' USING ERRCODE='23514'; END IF;
   IF NOT vamotors.repair_fields(uid,'VehicleCost','read',to_jsonb(k),ARRAY['id','revision']) OR (c."commandName" IN ('payCost','reversePayment') AND (NOT vamotors.repair_fields(uid,'VehicleCost','read',to_jsonb(k),ARRAY['amount','outstanding','payments.amount','payments.direction']) OR NOT vamotors.repair_fields(uid,'PurchaseRecord','read',to_jsonb(new_root),ARRAY['costs.id','costs.revision','costs.amount','costs.outstanding','costs.payments.amount','costs.payments.direction']))) THEN RAISE EXCEPTION 'CLOSED_COST_SOURCE_READ_REQUIRED' USING ERRCODE='23514'; END IF;
   IF c."commandName"='editCost' AND (NOT vamotors.repair_fields(uid,'PurchaseRecord','update',to_jsonb(new_root),ARRAY['cycleId']) OR NOT vamotors.repair_fields(uid,'VehicleCost','update',to_jsonb(k),ARRAY['costId','category','description','amount','incurredDate','reason'])) THEN RAISE EXCEPTION 'CLOSED_COST_AUTHORITY_REQUIRED' USING ERRCODE='23514'; END IF;
  ELSE
   IF c.result->>'id'<>new_root.id::text OR c."commandName" NOT IN ('editPurchase','payPurchase','reversePayment') THEN RAISE EXCEPTION 'CLOSED_PURCHASE_OWNER_REQUIRED' USING ERRCODE='23514'; END IF;
   IF c."commandName"='editPurchase' THEN
    allowed_delta:=allowed_delta||ARRAY['purchasePrice'];
    IF NOT vamotors.repair_fields(uid,'PurchaseRecord','read',to_jsonb(new_root),ARRAY['purchaseType','purchaseDate','purchasePrice','seller','payments.amount','payments.direction','payments.category']||CASE WHEN new_root."purchaseType"='LEASE_SETTLEMENT' THEN ARRAY['settlement.institutionType','settlement.companyId','settlement.institutionNameSnapshot','settlement.amount','settlement.cashToSeller'] ELSE ARRAY[]::text[] END) THEN RAISE EXCEPTION 'CLOSED_PURCHASE_SOURCE_READ_REQUIRED' USING ERRCODE='23514'; END IF;
    SELECT vamotors.settlement_json(new_root.id) IS DISTINCT FROM payload->'settlement' INTO settlement_changed FROM vamotors."EntityReadVersion" WHERE "entityType"='PurchaseRecord' AND "entityId"=new_root.id AND sequence<c."businessSequence" ORDER BY sequence DESC LIMIT 1;
    fields:=CASE WHEN settlement_changed AND new_root."purchaseType"='LEASE_SETTLEMENT' THEN ARRAY['patch.settlement.institutionType','patch.settlement.reference','patch.settlement.amount','patch.settlement.cashToSeller']||CASE WHEN vamotors.settlement_json(new_root.id)->>'institutionType'='FINANCE_COMPANY' THEN ARRAY['patch.settlement.companyId'] ELSE ARRAY['patch.settlement.institutionName'] END
      WHEN new_root."purchasePrice"<>old_root."purchasePrice" THEN ARRAY['patch.purchasePrice'] ELSE ARRAY[]::text[] END;
    IF NOT vamotors.repair_fields(uid,'PurchaseRecord','update',to_jsonb(new_root),ARRAY['cycleId','reason']||fields) THEN RAISE EXCEPTION 'CLOSED_PURCHASE_AUTHORITY_REQUIRED' USING ERRCODE='23514'; END IF;
    IF settlement_changed AND EXISTS(SELECT 1 FROM vamotors."LeasePurchaseDetail" l JOIN vamotors."FinanceCompany" f ON f.id=l."companyId" WHERE l."purchaseRecordId"=new_root.id AND NOT vamotors.repair_fields(uid,'FinanceCompany','read',to_jsonb(f),ARRAY['id','revision','active','name'])) THEN RAISE EXCEPTION 'CLOSED_SELECTED_COMPANY_READ_REQUIRED' USING ERRCODE='23514'; END IF;
   END IF;
  END IF;
  SELECT reason INTO correction_reason FROM vamotors."AuditEntry" WHERE "commandId"=c.id AND "entityType"='PurchaseRecord' AND "entityId"=new_root.id AND xmin=pg_current_xact_id()::xid;
  IF c."commandName" IN ('editCost','editPurchase','reversePayment') AND (correction_reason IS NULL OR length(btrim(correction_reason)) NOT BETWEEN 1 AND 2000) THEN RAISE EXCEPTION 'CLOSED_CORRECTION_REASON_REQUIRED' USING ERRCODE='23514'; END IF;
  IF (SELECT count(*) FROM vamotors."EntityReadVersion" WHERE "commandId"=c.id)<>2 OR (SELECT count(*) FROM vamotors."AuditEntry" WHERE "commandId"=c.id)<>(CASE WHEN k.id IS NULL THEN 2 ELSE 3 END) OR EXISTS(SELECT 1 FROM vamotors."RepairRecord" WHERE "cycleId"=new_root.id AND xmin=pg_current_xact_id()::xid) THEN RAISE EXCEPTION 'CLOSED_MONEY_EVIDENCE_REQUIRED' USING ERRCODE='23514'; END IF;
  IF c.result->>'type'='PurchaseRecord' AND new_root."purchaseType"='LEASE_SETTLEMENT' AND EXISTS(SELECT 1 FROM vamotors."FinanceCompany" f WHERE f.id=(SELECT (e.payload#>>'{settlement,companyId}')::uuid FROM vamotors."EntityReadVersion" e WHERE e."entityType"='PurchaseRecord' AND e."entityId"=new_root.id AND e.sequence<c."businessSequence" ORDER BY e.sequence DESC LIMIT 1) AND NOT vamotors.repair_fields(uid,'FinanceCompany','read',to_jsonb(f),ARRAY['id','name'])) THEN RAISE EXCEPTION 'CLOSED_ORIGINAL_COMPANY_READ_REQUIRED' USING ERRCODE='23514'; END IF;
  FOR payment IN SELECT 'PurchaseRecord' typ,p.direction,p.reference,p.category,uid AS "createdBy" FROM vamotors."PurchasePayment" p WHERE p."commandId"=c.id
    UNION ALL SELECT 'VehicleCost',p.direction,p.reference,p.category,p."createdBy" FROM vamotors."CostPayment" p WHERE p."commandId"=c.id LOOP
   IF c."commandName"='payPurchase' AND NOT vamotors.repair_fields(uid,'PurchaseRecord','read',to_jsonb(new_root),ARRAY['purchasePrice','payments.amount','payments.direction','payments.category',CASE WHEN payment.category='SETTLEMENT' THEN 'outstanding.settlement' ELSE 'outstanding.seller' END]) THEN RAISE EXCEPTION 'CLOSED_PAYEE_SOURCE_READ_REQUIRED' USING ERRCODE='23514'; END IF;
   IF c."commandName" IN ('reversePayment','editPurchase') AND (NOT vamotors.repair_fields(uid,'PurchaseRecord','read',to_jsonb(new_root),CASE WHEN payment.typ='VehicleCost' THEN ARRAY['costs.payments.id','costs.payments.amount','costs.payments.direction','costs.payments.category','costs.payments.date','costs.payments.method','costs.payments.reversalOf'] ELSE ARRAY['payments.id','payments.amount','payments.direction','payments.category','payments.date','payments.method','payments.reversalOf'] END) OR (payment.typ='VehicleCost' AND NOT vamotors.repair_fields(uid,'VehicleCost','read',to_jsonb(k),ARRAY['payments.id','payments.amount','payments.direction','payments.category','payments.date','payments.method','payments.reversalOf']))) THEN RAISE EXCEPTION 'CLOSED_REVERSAL_SOURCE_READ_REQUIRED' USING ERRCODE='23514'; END IF;
   fields:=CASE c."commandName"
    WHEN 'reversePayment' THEN ARRAY['sourceType','sourceId','paymentId','reason']||CASE WHEN payment.direction='OUT' THEN ARRAY['replacement.amount','replacement.date','replacement.method']||CASE WHEN payment.reference IS NULL THEN ARRAY[]::text[] ELSE ARRAY['replacement.reference'] END ELSE ARRAY[]::text[] END
    WHEN 'editPurchase' THEN ARRAY['cycleId','cashCorrections.paymentId','cashCorrections.reason']||CASE WHEN payment.direction='OUT' THEN ARRAY['cashCorrections.replacement.amount','cashCorrections.replacement.date','cashCorrections.replacement.method']||CASE WHEN payment.reference IS NULL THEN ARRAY[]::text[] ELSE ARRAY['cashCorrections.replacement.reference'] END ELSE ARRAY[]::text[] END
    ELSE CASE WHEN payment.typ='VehicleCost' THEN ARRAY['costId'] ELSE ARRAY['cycleId','recipient'] END||ARRAY['payment.amount','payment.date','payment.method']||CASE WHEN payment.reference IS NULL THEN ARRAY[]::text[] ELSE ARRAY['payment.reference'] END END;
   IF payment."createdBy"<>uid OR NOT vamotors.repair_fields(uid,'PurchaseRecord','pay',to_jsonb(new_root),CASE WHEN payment.typ='VehicleCost' THEN ARRAY['cycleId'] ELSE fields END)
   OR (payment.typ='VehicleCost' AND NOT vamotors.repair_fields(uid,'VehicleCost','pay',to_jsonb(k),fields)) THEN RAISE EXCEPTION 'CLOSED_CASH_AUTHORITY_REQUIRED' USING ERRCODE='23514'; END IF;
  END LOOP;
  -- Existing cycle_cost_root/child/settlement graphs still validate every delta,
  -- exact opposite/replacement, payment source/currency/net cap and new basis.
 ELSE RAISE EXCEPTION 'UNSUPPORTED_CLOSED_OWNER' USING ERRCODE='23514';
 END IF;
 IF (to_jsonb(new_root)-allowed_delta) IS DISTINCT FROM (to_jsonb(old_root)-allowed_delta) THEN RAISE EXCEPTION 'IMMUTABLE_CLOSED_PHYSICAL_TERMS' USING ERRCODE='23514'; END IF;
 IF NOT vamotors.repair_fields(uid,'PurchaseRecord','read',to_jsonb(new_root),ARRAY['id','revision','vehicleId','status','closedAt','financial.currency','financial.scale','financial.cashIn','financial.cashOut','financial.basis','purchasePrice','payments.amount','payments.direction'])
 OR NOT vamotors.repair_fields(uid,'Vehicle','read',(SELECT to_jsonb(v)||jsonb_build_object('status',old_root.status) FROM vamotors."Vehicle" v WHERE v.id=new_root."vehicleId"),ARRAY['id','identityRevision'])
 OR (new_root."purchaseType"='LEASE_SETTLEMENT' AND NOT vamotors.repair_fields(uid,'PurchaseRecord','read',to_jsonb(new_root),ARRAY['settlement.amount','settlement.cashToSeller']))
 OR EXISTS(SELECT 1 FROM vamotors."VehicleCost" x WHERE x."cycleId"=new_root.id AND (NOT vamotors.repair_fields(uid,'PurchaseRecord','read',to_jsonb(new_root),ARRAY['costs.amount','costs.payments.amount','costs.payments.direction']) OR NOT vamotors.repair_fields(uid,'VehicleCost','read',to_jsonb(x),ARRAY['amount','payments.amount','payments.direction'])))
 OR EXISTS(SELECT 1 FROM vamotors."RepairRecord" x WHERE x."cycleId"=new_root.id AND (NOT vamotors.repair_fields(uid,'PurchaseRecord','read',to_jsonb(new_root),ARRAY['repairs']) OR NOT vamotors.repair_fields(uid,'RepairRecord','read',to_jsonb(x),ARRAY['invoiceAmount','returnedDate','payments.amount','payments.direction'])))
 OR EXISTS(SELECT 1 FROM vamotors."DisposalReceipt" WHERE "cycleId"=new_root.id) AND (NOT vamotors.repair_fields(uid,'PurchaseRecord','read',to_jsonb(new_root),ARRAY['disposal']) OR NOT vamotors.repair_fields(uid,'Disposal','read',(SELECT to_jsonb(d) FROM vamotors."Disposal" d WHERE d."cycleId"=new_root.id),ARRAY['payments.amount','payments.direction'])) THEN RAISE EXCEPTION 'CLOSED_CURRENT_SOURCE_READ_REQUIRED' USING ERRCODE='23514'; END IF;
END $$;

-- Forward-only, fragment-asserted extensions to the accepted owners. A repair
-- branch needs an actual same-transaction child and the separate complete graph.
ALTER TABLE vamotors."PurchaseRecord" DROP CONSTRAINT initial_cycle_capability,
 ADD CONSTRAINT initial_cycle_capability CHECK(((status IN ('PURCHASED','IN_STOCK','IN_REPAIR') AND "closedAt" IS NULL) OR (status='WRITTEN_OFF' AND "closedAt" IS NOT NULL AND NOT available)) AND "purchaseType" IN ('CASH','BRAND_NEW','LEASE_SETTLEMENT') AND "acquisitionKind"='SUPPLIER');
DO $$
DECLARE source text; updated text; fragment text;
BEGIN
  SELECT pg_get_functiondef('vamotors.acquisition_root_guard()'::regprocedure) INTO source;
  -- This owner becomes trigger-only definer below to inspect xmin. Preserve the
  -- original runtime insertion restriction against the LOGIN identity, not the
  -- definer's current_user (which would silently exempt runtime inserts).
  fragment:='current_user=''vamotors_runtime''';
  IF strpos(source,fragment)=0 THEN RAISE EXCEPTION 'REPAIR_RUNTIME_IDENTITY_BASE_MISMATCH'; END IF;
  source:=replace(source,fragment,'session_user=''vamotors_runtime''');
 fragment:='ELSE';
 updated:=replace(source,fragment,E'ELSE\n  IF EXISTS(SELECT 1 FROM vamotors."RepairRecord" WHERE "cycleId"=NEW.id AND xmin=pg_current_xact_id()::xid) THEN RETURN NEW; END IF;');
 IF updated=source THEN RAISE EXCEPTION 'REPAIR_ROOT_BASE_MISMATCH'; END IF; EXECUTE updated;
 SELECT pg_get_functiondef('vamotors.initial_cycle_transition()'::regprocedure) INTO source;
 updated:=replace(source,'ELSIF NEW.status IS DISTINCT',E'ELSIF TG_OP=''UPDATE'' AND EXISTS(SELECT 1 FROM vamotors."RepairRecord" r WHERE r."cycleId"=NEW.id AND r.xmin=pg_current_xact_id()::xid AND ((OLD.status=''IN_STOCK'' AND NEW.status=''IN_REPAIR'' AND r."returnedDate" IS NULL) OR (OLD.status=''IN_REPAIR'' AND NEW.status=''IN_STOCK'' AND r."returnedDate" IS NOT NULL))) THEN RETURN NEW;\n ELSIF NEW.status IS DISTINCT');
 IF updated=source THEN RAISE EXCEPTION 'REPAIR_TRANSITION_BASE_MISMATCH'; END IF; EXECUTE updated;
 SELECT pg_get_functiondef('vamotors.purchase_status_guard()'::regprocedure) INTO source;
 fragment:='IF c.id IS NULL OR c."actorKey"';
 updated:=replace(source,fragment,E'IF c."commandName" IN (''sendRepair'',''returnRepair'') AND c.result->>''type''=''RepairRecord'' AND EXISTS(SELECT 1 FROM vamotors."RepairRecord" r WHERE r.id=(c.result->>''id'')::uuid AND r."cycleId"=p.id AND r.xmin=pg_current_xact_id()::xid) THEN RETURN NEW; END IF;\n IF c.id IS NULL OR c."actorKey"');
 IF updated=source THEN RAISE EXCEPTION 'REPAIR_STATUS_BASE_MISMATCH'; END IF; EXECUTE updated;
 SELECT pg_get_functiondef('vamotors.check_stock_graph()'::regprocedure) INTO source;
 updated:=replace(source,'BEGIN',E'BEGIN\n IF EXISTS(SELECT 1 FROM vamotors."RepairRecord" WHERE "cycleId"=NEW.id AND xmin=pg_current_xact_id()::xid) THEN RETURN NULL; END IF;\n IF EXISTS(SELECT 1 FROM vamotors."RepairRecord" WHERE "cycleId"=NEW.id AND "returnedDate" IS NULL) THEN RAISE EXCEPTION ''REPAIR_OBLIGATION_OPEN'' USING ERRCODE=''23514''; END IF;');
 IF updated=source THEN RAISE EXCEPTION 'REPAIR_STOCK_BASE_MISMATCH'; END IF; EXECUTE updated;
 SELECT pg_get_functiondef('vamotors.cycle_cost_root_graph()'::regprocedure) INTO source;
  updated:=replace(source,'BEGIN',E'BEGIN\n IF EXISTS(SELECT 1 FROM vamotors."RepairRecord" WHERE "cycleId"=NEW.id AND xmin=pg_current_xact_id()::xid) THEN RETURN NULL; END IF;');
  fragment:='SELECT coalesce(jsonb_agg(vamotors.cycle_cost_json(id)';
  IF strpos(updated,fragment)=0 THEN RAISE EXCEPTION 'REPAIR_CONSUMED_FIELDS_BASE_MISMATCH'; END IF;
  updated:=replace(updated,fragment,E'IF EXISTS(SELECT 1 FROM vamotors."RepairRecord" WHERE "cycleId"=NEW.id) AND (NOT vamotors.repair_fields(substring(c."actorKey" FROM 6)::uuid,''PurchaseRecord'',''read'',to_jsonb(NEW),ARRAY[''repairs'']) OR EXISTS(SELECT 1 FROM vamotors."RepairRecord" k WHERE k."cycleId"=NEW.id AND NOT vamotors.repair_fields(substring(c."actorKey" FROM 6)::uuid,''RepairRecord'',''read'',to_jsonb(k),ARRAY[''invoiceAmount'',''returnedDate'',''payments.amount'',''payments.direction'']||CASE WHEN c."commandName"=''editPurchase'' THEN ARRAY[''sentDate''] ELSE ARRAY[]::text[] END))) THEN RAISE EXCEPTION ''REPAIR_CONTRIBUTOR_READ_REQUIRED'' USING ERRCODE=''23514''; END IF;\n '||fragment);
 fragment:='''repairs'',''0'''; IF strpos(updated,fragment)=0 THEN RAISE EXCEPTION 'REPAIR_FINANCIAL_BASE_MISMATCH'; END IF;
 updated:=replace(updated,fragment,'''repairs'',coalesce((SELECT sum("invoiceAmount"::numeric) FROM vamotors."RepairRecord" WHERE "cycleId"=NEW.id AND "returnedDate" IS NOT NULL),0)::text');
 fragment:='OR (m."sourceType"=''COST'' AND m."sourceId" IN (SELECT id FROM vamotors."VehicleCost" WHERE "cycleId"=NEW.id))'; IF strpos(updated,fragment)=0 THEN RAISE EXCEPTION 'REPAIR_CASH_BASE_MISMATCH'; END IF;
 updated:=replace(updated,fragment,fragment||' OR (m."sourceType"=''REPAIR'' AND m."sourceId" IN (SELECT id FROM vamotors."RepairRecord" WHERE "cycleId"=NEW.id))');
 EXECUTE updated;
 SELECT pg_get_functiondef('vamotors.check_acquisition_graph()'::regprocedure) INTO source;
 fragment:='SELECT p."purchasePrice"+coalesce(sum(amount::numeric),0) INTO total';
 updated:=replace(source,fragment,'SELECT p."purchasePrice"+coalesce(sum(amount::numeric),0)+coalesce((SELECT sum("invoiceAmount"::numeric) FROM vamotors."RepairRecord" WHERE "cycleId"=cid AND "returnedDate" IS NOT NULL),0) INTO total');
 IF updated=source THEN RAISE EXCEPTION 'REPAIR_CURRENT_BASIS_BASE_MISMATCH'; END IF;
 fragment:='latest.components<>jsonb_build_object(''purchase'',p."purchasePrice"::text,''repairs'',''[]''::jsonb';
 IF strpos(updated,fragment)=0 THEN RAISE EXCEPTION 'REPAIR_COMPONENT_BASE_MISMATCH'; END IF;
 updated:=replace(updated,fragment,'latest.components<>jsonb_build_object(''purchase'',p."purchasePrice"::text,''repairs'',vamotors.repair_components(cid)');
 fragment:='OR (p."receivedDate" IS NOT NULL'; IF strpos(updated,fragment)=0 THEN RAISE EXCEPTION 'REPAIR_PURCHASE_CHRONOLOGY_BASE_MISMATCH'; END IF;
 updated:=replace(updated,fragment,'OR EXISTS(SELECT 1 FROM vamotors."RepairRecord" r WHERE r."cycleId"=cid AND r."sentDate"<p."purchaseDate") OR (p."receivedDate" IS NOT NULL');
 EXECUTE updated;
END $$;

-- Reconcile the accepted approval/disposal graphs instead of replacing them.
-- The original immutable disposal remains pinned to its original basis version.
DO $$
DECLARE source text; updated text; fragment text;
BEGIN
 SELECT pg_get_functiondef('vamotors.check_disposal_graph()'::regprocedure) INTO source;
 updated:=replace(source,'BEGIN',E'BEGIN\n IF TG_TABLE_NAME=''PurchaseRecord'' THEN\n  IF OLD.status=''WRITTEN_OFF'' THEN PERFORM vamotors.check_closed_financial(OLD,NEW); RETURN NULL; END IF;\n END IF;');
 IF updated=source THEN RAISE EXCEPTION 'REPAIR_DISPOSAL_GRAPH_BASE_MISMATCH'; END IF;
 fragment:='i:=a.proposal->''input'';';
 IF strpos(updated,fragment)=0 THEN RAISE EXCEPTION 'REPAIR_DISPOSAL_OBLIGATION_BASE_MISMATCH'; END IF;
 updated:=replace(updated,fragment,fragment||E'\n IF EXISTS(SELECT 1 FROM vamotors."RepairRecord" WHERE "cycleId"=cid AND "returnedDate" IS NULL) THEN RAISE EXCEPTION ''REPAIR_OBLIGATION_OPEN'' USING ERRCODE=''23514''; END IF;');
 EXECUTE updated;
 SELECT pg_get_functiondef('vamotors.check_disposal_root()'::regprocedure) INTO source;
 updated:=replace(source,'BEGIN',E'BEGIN\n IF OLD.status=''WRITTEN_OFF'' THEN PERFORM vamotors.check_closed_financial(OLD,NEW); RETURN NULL; END IF;');
 IF updated=source THEN RAISE EXCEPTION 'REPAIR_DISPOSAL_ROOT_BASE_MISMATCH'; END IF;
 fragment:='OR (m."sourceType"=''DISPOSAL'' AND m."sourceId"=d.id)';
 IF strpos(updated,fragment)=0 THEN RAISE EXCEPTION 'REPAIR_DISPOSAL_CASH_BASE_MISMATCH'; END IF;
 EXECUTE replace(updated,fragment,fragment||' OR (m."sourceType"=''REPAIR'' AND m."sourceId" IN (SELECT id FROM vamotors."RepairRecord" WHERE "cycleId"=NEW.id))');
 SELECT pg_get_functiondef('vamotors.approval_origin(uuid,vamotors."ApprovalRequest",vamotors."PurchaseRecord",vamotors."Vehicle",boolean)'::regprocedure) INTO source;
 fragment:='IF reviewing THEN';
 updated:=replace(source,fragment,E'IF EXISTS(SELECT 1 FROM vamotors."RepairRecord" r WHERE r."cycleId"=p.id AND (NOT vamotors.approval_fields(uid,''PurchaseRecord'',''read'',cycle_data,ARRAY[''repairs'']) OR NOT vamotors.approval_fields(uid,''RepairRecord'',''read'',to_jsonb(r),ARRAY[''id'',''returnedDate'',''invoiceAmount'',''payments.amount'',''payments.direction'']))) THEN RETURN false; END IF;\n '||fragment);
 IF updated=source THEN RAISE EXCEPTION 'REPAIR_APPROVAL_READ_BASE_MISMATCH'; END IF; EXECUTE updated;
 SELECT pg_get_functiondef('vamotors.check_approval_graph()'::regprocedure) INTO source;
 fragment:='i:=a.proposal->''input'';';
 updated:=replace(source,fragment,fragment||E'\n IF EXISTS(SELECT 1 FROM vamotors."RepairRecord" WHERE "cycleId"=p.id AND "returnedDate" IS NULL) THEN RAISE EXCEPTION ''REPAIR_OBLIGATION_OPEN'' USING ERRCODE=''23514''; END IF;');
 IF updated=source THEN RAISE EXCEPTION 'REPAIR_APPROVAL_OBLIGATION_BASE_MISMATCH'; END IF; EXECUTE updated;
 SELECT pg_get_functiondef('vamotors.cycle_cost_root_graph()'::regprocedure) INTO source;
 fragment:='OR v."activePurchaseId" IS DISTINCT FROM NEW.id';
 updated:=replace(source,fragment,'OR (v."activePurchaseId" IS DISTINCT FROM NEW.id AND NOT vamotors.current_written_off(NEW.id))');
 IF updated=source THEN RAISE EXCEPTION 'REPAIR_CLOSED_MONEY_POINTER_BASE_MISMATCH'; END IF;
 fragment:='OR (m."sourceType"=''COST'' AND m."sourceId" IN (SELECT id FROM vamotors."VehicleCost" WHERE "cycleId"=NEW.id))';
 IF strpos(updated,fragment)=0 THEN RAISE EXCEPTION 'REPAIR_CLOSED_CASH_BASE_MISMATCH'; END IF;
 EXECUTE replace(updated,fragment,fragment||' OR (m."sourceType"=''DISPOSAL'' AND m."sourceId" IN (SELECT id FROM vamotors."Disposal" WHERE "cycleId"=NEW.id))');
 SELECT pg_get_functiondef('vamotors.cycle_cost_child_graph()'::regprocedure) INTO source;
 fragment:='p."closedAt" IS NOT NULL OR p.status NOT IN (''PURCHASED'',''IN_STOCK'')';
 updated:=replace(source,fragment,'((p."closedAt" IS NOT NULL OR p.status NOT IN (''PURCHASED'',''IN_STOCK'')) AND NOT vamotors.current_written_off(p.id))');
 IF updated=source THEN RAISE EXCEPTION 'REPAIR_CLOSED_MONEY_CHILD_BASE_MISMATCH'; END IF; EXECUTE updated;
 SELECT pg_get_functiondef('vamotors.settlement_detail_guard()'::regprocedure) INTO source;
 updated:=replace(source,fragment,'((p."closedAt" IS NOT NULL OR p.status NOT IN (''PURCHASED'',''IN_STOCK'')) AND NOT vamotors.current_written_off(p.id))');
 IF updated=source THEN RAISE EXCEPTION 'REPAIR_CLOSED_SETTLEMENT_BASE_MISMATCH'; END IF; EXECUTE updated;
END $$;

-- New subject only: unchanged old universes mean old wildcard/compound and
-- delegation ceilings remain exactly the accepted v13 populations and hashes.
CREATE FUNCTION vamotors.repair_canonical(j jsonb) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT CASE jsonb_typeof(j) WHEN 'object' THEN '{'||coalesce((SELECT string_agg(to_jsonb(key)::text||':'||vamotors.repair_canonical(value),',' ORDER BY key COLLATE "C") FROM jsonb_each(j)),'')||'}' WHEN 'array' THEN '['||coalesce((SELECT string_agg(vamotors.repair_canonical(value),',' ORDER BY n) FROM jsonb_array_elements(j) WITH ORDINALITY a(value,n)),'')||']' ELSE j::text END
$$;
DO $$
DECLARE new_rule jsonb; pid uuid; admin_id uuid; protected_permissions text; protected_role text; temporary text;
BEGIN
  IF EXISTS(SELECT 1 FROM vamotors."Permission" p WHERE p.rule->>'subject'='RepairRecord') THEN RAISE EXCEPTION 'UNEXPECTED_PARENT_REPAIR_GRANT'; END IF;
  IF EXISTS(SELECT 1 FROM vamotors."Permission" p WHERE p."ruleHash"<>encode(sha256(convert_to(vamotors.repair_canonical(p.rule),'UTF8')),'hex')) THEN RAISE EXCEPTION 'INVALID_PARENT_HASH'; END IF;
  SELECT pg_get_functiondef('vamotors.protect_admin_permissions()'::regprocedure) INTO protected_permissions;
  SELECT pg_get_functiondef('vamotors.protect_system_role()'::regprocedure) INTO protected_role;
  temporary:=replace(protected_permissions,'BEGIN',E'BEGIN\n IF current_user=''vamotors_migrator'' AND TG_OP=''INSERT'' AND EXISTS(SELECT 1 FROM vamotors."Permission" p WHERE p.id=NEW."permissionId" AND p.rule->>''subject''=''RepairRecord'') THEN RETURN NEW; END IF;');
  IF temporary=protected_permissions THEN RAISE EXCEPTION 'REPAIR_PERMISSION_GUARD_BASE_MISMATCH'; END IF; EXECUTE temporary;
  temporary:=replace(protected_role,'BEGIN',E'BEGIN\n IF current_user=''vamotors_migrator'' AND TG_OP=''UPDATE'' AND NEW.revision=OLD.revision+1 AND (to_jsonb(NEW)-''revision'')=(to_jsonb(OLD)-''revision'') THEN RETURN NEW; END IF;');
  IF temporary=protected_role THEN RAISE EXCEPTION 'REPAIR_ROLE_GUARD_BASE_MISMATCH'; END IF; EXECUTE temporary;
 SELECT id INTO admin_id FROM vamotors."Role" WHERE "systemKey"='ADMINISTRATOR';
 IF admin_id IS NOT NULL THEN
  FOR new_rule IN SELECT value FROM jsonb_array_elements('[{"subject":"RepairRecord","action":"read","fields":["id","revision","vendorId","request","sentDate","returnedDate","summary","invoiceAmount","invoiceDate","payments","payments.id","payments.owner.type","payments.owner.id","payments.commandId","payments.amount","payments.direction","payments.category","payments.date","payments.method","payments.recordedAt","payments.reference","payments.reversalOf","payments.reason"]},{"subject":"RepairRecord","action":"create","fields":["cycleId","vendorId","request","sentDate"]},{"subject":"RepairRecord","action":"update","fields":["repairId","invoiceAmount","invoiceDate","returnedDate","summary"]},{"subject":"RepairRecord","action":"pay","fields":["repairId","payment.amount","payment.date","payment.method","payment.reference","sourceType","sourceId","paymentId","reason","replacement.amount","replacement.date","replacement.method","replacement.reference"]}]'::jsonb) LOOP
   INSERT INTO vamotors."Permission"(id,"ruleHash",rule) VALUES(gen_random_uuid(),encode(sha256(convert_to(vamotors.repair_canonical(new_rule),'UTF8')),'hex'),new_rule) ON CONFLICT("ruleHash") DO NOTHING;
   SELECT id INTO pid FROM vamotors."Permission" p WHERE p."ruleHash"=encode(sha256(convert_to(vamotors.repair_canonical(new_rule),'UTF8')),'hex');
   INSERT INTO vamotors."RolePermission" VALUES(admin_id,pid) ON CONFLICT DO NOTHING;
  END LOOP;
  UPDATE vamotors."Role" SET revision=revision+1 WHERE id=admin_id;
 END IF;
 EXECUTE protected_permissions; EXECUTE protected_role;
END $$;
SET CONSTRAINTS ALL IMMEDIATE;
DROP FUNCTION vamotors.repair_canonical(jsonb);
REVOKE ALL ON FUNCTION vamotors.repair_json(uuid),vamotors.repairs_json(uuid),vamotors.repair_diff(jsonb,jsonb),vamotors.repair_fields(uuid,text,text,jsonb,text[]),vamotors.repair_return_recipient(uuid,uuid),vamotors.repair_owner_guard(),vamotors.check_repair_root(),vamotors.check_repair_child(),vamotors.repair_notification_guard(),vamotors.check_repair_evidence() FROM PUBLIC;
REVOKE ALL ON FUNCTION vamotors.repair_components(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION vamotors.current_written_off(uuid),vamotors.check_closed_financial(vamotors."PurchaseRecord",vamotors."PurchaseRecord") FROM PUBLIC;
-- These existing trigger-only owners now inspect same-transaction xmin evidence.
-- Do not widen runtime system-column SELECT or grant callable definer entrypoints.
ALTER FUNCTION vamotors.acquisition_root_guard() SECURITY DEFINER SET search_path=pg_catalog,pg_temp;
ALTER FUNCTION vamotors.initial_cycle_transition() SECURITY DEFINER SET search_path=pg_catalog,pg_temp;
ALTER FUNCTION vamotors.check_stock_graph() SECURITY DEFINER SET search_path=pg_catalog,pg_temp;
REVOKE ALL ON FUNCTION vamotors.acquisition_root_guard(),vamotors.initial_cycle_transition(),vamotors.check_stock_graph() FROM PUBLIC;
COMMIT;
