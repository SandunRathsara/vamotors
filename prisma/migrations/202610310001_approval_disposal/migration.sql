BEGIN;
SELECT value FROM vamotors."BusinessSequence" WHERE id=1 FOR UPDATE;
SELECT vamotors.lock_admin_guard();

-- CURRENT WRITE_OFF only. No import/proposal-policy/repair/sale stand-ins.
CREATE TABLE vamotors."ApprovalRequest" (
 id uuid PRIMARY KEY, "cycleId" uuid NOT NULL REFERENCES vamotors."PurchaseRecord"(id) ON DELETE RESTRICT,
 kind text NOT NULL CHECK(kind='WRITE_OFF'), "schemaVersion" integer NOT NULL DEFAULT 1 CHECK("schemaVersion"=1),
 proposal jsonb NOT NULL, expected jsonb NOT NULL CHECK(jsonb_typeof(expected)='array' AND jsonb_array_length(expected)=2), snapshot jsonb NOT NULL,
 "payloadHash" text NOT NULL CHECK("payloadHash" ~ '^[a-f0-9]{64}$'), reason text NOT NULL CHECK(reason=btrim(reason) AND length(reason) BETWEEN 1 AND 2000),
 "requestedBy" uuid NOT NULL REFERENCES vamotors."user"(id) ON DELETE RESTRICT, "requestedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','APPROVED','REJECTED')), revision integer NOT NULL DEFAULT 1 CHECK(revision BETWEEN 1 AND 2147483647),
 "reviewedBy" uuid REFERENCES vamotors."user"(id) ON DELETE RESTRICT, "reviewedAt" timestamp(3), "reviewNote" text CHECK("reviewNote" IS NULL OR ("reviewNote"=btrim("reviewNote") AND length("reviewNote") BETWEEN 1 AND 2000)),
 "reviewerName" text, "requiredRecipientIds" jsonb NOT NULL CHECK(jsonb_typeof("requiredRecipientIds")='array' AND jsonb_array_length("requiredRecipientIds")>0),
 "requestCommandId" uuid NOT NULL UNIQUE REFERENCES vamotors."CommandReceipt"(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 "reviewCommandId" uuid UNIQUE REFERENCES vamotors."CommandReceipt"(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 "appliedCommandId" uuid UNIQUE REFERENCES vamotors."CommandReceipt"(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 UNIQUE(id,"cycleId"), CHECK("reviewedBy" IS NULL OR "reviewedBy"<>"requestedBy"),
 CHECK((state='PENDING' AND revision=1 AND "reviewedBy" IS NULL AND "reviewedAt" IS NULL AND "reviewNote" IS NULL AND "reviewerName" IS NULL AND "reviewCommandId" IS NULL AND "appliedCommandId" IS NULL)
 OR (state IN ('APPROVED','REJECTED') AND revision=2 AND "reviewedBy" IS NOT NULL AND "reviewedAt" IS NOT NULL AND "reviewerName" IS NOT NULL AND "reviewCommandId" IS NOT NULL AND ((state='APPROVED' AND "appliedCommandId"="reviewCommandId") OR (state='REJECTED' AND "appliedCommandId" IS NULL AND "reviewNote" IS NOT NULL))))
);
CREATE INDEX "ApprovalRequest_state_requestedAt_id_idx" ON vamotors."ApprovalRequest"(state,"requestedAt",id);
CREATE INDEX "ApprovalRequest_requestedBy_requestedAt_id_idx" ON vamotors."ApprovalRequest"("requestedBy","requestedAt",id);
CREATE TABLE vamotors."Disposal" (
 id uuid PRIMARY KEY, "cycleId" uuid NOT NULL UNIQUE REFERENCES vamotors."PurchaseRecord"(id) ON DELETE RESTRICT,
 "approvalId" uuid NOT NULL UNIQUE, FOREIGN KEY("approvalId","cycleId") REFERENCES vamotors."ApprovalRequest"(id,"cycleId") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 "approvalKind" text NOT NULL DEFAULT 'CURRENT' CHECK("approvalKind"='CURRENT'), "occurredDate" date NOT NULL CHECK("occurredDate"<=(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Colombo')::date),
 reason text NOT NULL CHECK(reason=btrim(reason) AND length(reason) BETWEEN 1 AND 2000), method text NOT NULL CHECK(method IN ('SCRAPPED','AUCTIONED','DONATED','OTHER')),
 proceeds bigint NOT NULL CHECK(proceeds BETWEEN 0 AND 99999999999999), "basisVersionId" uuid NOT NULL,
 FOREIGN KEY("basisVersionId","cycleId") REFERENCES vamotors."CycleBasisVersion"(id,"cycleId") ON DELETE RESTRICT,
 "netLoss" bigint NOT NULL, "createdBy" uuid NOT NULL REFERENCES vamotors."user"(id) ON DELETE RESTRICT,
 "commandId" uuid NOT NULL UNIQUE REFERENCES vamotors."CommandReceipt"(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 "recordedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(id,"cycleId"), UNIQUE("approvalId","cycleId")
);
CREATE TABLE vamotors."DisposalReceipt" (
 id uuid PRIMARY KEY, "disposalId" uuid NOT NULL UNIQUE, "cycleId" uuid NOT NULL,
 FOREIGN KEY("disposalId","cycleId") REFERENCES vamotors."Disposal"(id,"cycleId") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 amount bigint NOT NULL CHECK(amount BETWEEN 1 AND 99999999999999), direction text NOT NULL CHECK(direction='IN'), category text NOT NULL CHECK(category='DISPOSAL'),
 "occurredDate" date NOT NULL CHECK("occurredDate"<=(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Colombo')::date), method text NOT NULL CHECK(method IN ('CASH','BANK_TRANSFER')),
 currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'), scale integer NOT NULL CHECK(scale=2), reference text CHECK(reference IS NULL OR (reference=btrim(reference) AND length(reference) BETWEEN 1 AND 200)),
 "commandId" uuid NOT NULL REFERENCES vamotors."CommandReceipt"(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 "lineKey" text NOT NULL CHECK("lineKey"='proceeds'), "recordedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE("commandId","lineKey")
);
CREATE INDEX "DisposalReceipt_cycleId_occurredDate_id_idx" ON vamotors."DisposalReceipt"("cycleId","occurredDate",id);
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON vamotors."Disposal" FOR EACH STATEMENT EXECUTE FUNCTION vamotors.append_only();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON vamotors."DisposalReceipt" FOR EACH STATEMENT EXECUTE FUNCTION vamotors.append_only();
CREATE TRIGGER immutable_delete BEFORE DELETE OR TRUNCATE ON vamotors."ApprovalRequest" FOR EACH STATEMENT EXECUTE FUNCTION vamotors.append_only();

CREATE FUNCTION vamotors.approval_canonical(j jsonb) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT CASE jsonb_typeof(j) WHEN 'object' THEN '{'||coalesce((SELECT string_agg(to_jsonb(key)::text||':'||vamotors.approval_canonical(value),',' ORDER BY key COLLATE "C") FROM jsonb_each(j)),'')||'}'
 WHEN 'array' THEN '['||coalesce((SELECT string_agg(vamotors.approval_canonical(value),',' ORDER BY n) FROM jsonb_array_elements(j) WITH ORDINALITY a(value,n)),'')||']' ELSE j::text END
$$;
CREATE FUNCTION vamotors.approval_fields(uid uuid, typ text, act text, row_data jsonb, paths text[]) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM vamotors."user" WHERE id=uid AND active) AND NOT EXISTS (
 SELECT 1 FROM unnest(paths) f WHERE NOT EXISTS (
 SELECT 1 FROM vamotors."UserRole" ur JOIN vamotors."Role" r ON r.id=ur."roleId" AND r.active JOIN vamotors."RolePermission" rp ON rp."roleId"=r.id JOIN vamotors."Permission" p ON p.id=rp."permissionId"
 WHERE ur."userId"=uid AND p.rule->>'subject'=typ AND p.rule->>'action'=act
 AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(p.rule->'fields') selected WHERE selected='*' OR selected=f OR starts_with(f,selected||'.'))
 AND NOT EXISTS(SELECT 1 FROM jsonb_each_text(coalesce(p.rule->'conditions','{}')) c WHERE row_data->>c.key IS DISTINCT FROM CASE WHEN c.value='$actor.id' THEN uid::text ELSE c.value END)))
$$;
CREATE FUNCTION vamotors.approval_input_fields(i jsonb) RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT ARRAY['cycleId','date','reason','method','proceeds'] || coalesce((SELECT array_agg('receipt.'||key ORDER BY key) FROM jsonb_object_keys(coalesce(i->'receipt','{}')) key),ARRAY[]::text[])
$$;
CREATE FUNCTION vamotors.approval_origin(uid uuid, a vamotors."ApprovalRequest", p vamotors."PurchaseRecord", v vamotors."Vehicle", reviewing boolean) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE i jsonb:=a.proposal->'input'; fields text[]:=vamotors.approval_input_fields(i); f text; c record; cycle_data jsonb:=jsonb_build_object('createdBy',p."createdBy"); vehicle_data jsonb:=jsonb_build_object('createdBy',v."createdBy",'status',p.status); candidate jsonb:=jsonb_build_object('createdBy',uid);
BEGIN
 IF a.state='APPROVED' THEN vehicle_data:=jsonb_set(vehicle_data,'{status}',(SELECT to_jsonb(s."from"::text) FROM vamotors."StatusEvent" s WHERE s."commandId"=a."appliedCommandId" AND s."cycleId"=p.id)); END IF;
 IF NOT vamotors.approval_fields(uid,'PurchaseRecord','update',cycle_data,ARRAY['cycleId'])
 OR NOT vamotors.approval_fields(uid,'Disposal','create',candidate,fields)
 OR NOT vamotors.approval_fields(uid,'PurchaseRecord','read',cycle_data,ARRAY['id','revision','vehicleId','identityRevision','status','available','closedAt','purchaseDate','purchasePrice','purchaseType','financial.basis','financial.currency','financial.scale','basisVersions.id','basisVersions.total'] || CASE WHEN p."listedPrice" IS NULL THEN ARRAY[]::text[] ELSE ARRAY['listedPrice'] END)
 OR NOT vamotors.approval_fields(uid,'Vehicle','read',vehicle_data,ARRAY['id','identityRevision']) THEN RETURN false; END IF;
 IF i ? 'receipt' AND NOT vamotors.approval_fields(uid,'Disposal','pay',candidate,ARRAY(SELECT f FROM unnest(fields) f WHERE starts_with(f,'receipt.'))) THEN RETURN false; END IF;
 FOR c IN SELECT * FROM vamotors."VehicleCost" WHERE "cycleId"=p.id LOOP
  IF NOT vamotors.approval_fields(uid,'PurchaseRecord','read',cycle_data,ARRAY['costs.amount']) OR NOT vamotors.approval_fields(uid,'VehicleCost','read',jsonb_build_object('createdBy',c."createdBy"),ARRAY['amount']) THEN RETURN false; END IF;
 END LOOP;
 IF reviewing THEN
  IF NOT vamotors.approval_fields(uid,'ApprovalRequest','read',jsonb_build_object('createdBy',a."requestedBy"),ARRAY['id','revision','proposal.kind','expected','payloadHash','reason']||ARRAY(SELECT 'proposal.input.'||f FROM unnest(fields) f)) THEN RETURN false; END IF;
  IF NOT vamotors.approval_fields(uid,'Disposal','read',jsonb_build_object('createdBy',a."requestedBy"),ARRAY(SELECT replace(f,'receipt.','payments.') FROM unnest(fields) f WHERE f<>'cycleId')) THEN RETURN false; END IF;
 END IF;
 RETURN true;
END $$;
CREATE FUNCTION vamotors.approval_dto(a vamotors."ApprovalRequest") RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_strip_nulls(jsonb_build_object('id',a.id,'revision',a.revision,'proposal',a.proposal,'expected',a.expected,'payloadHash',a."payloadHash",'reason',a.reason,'requestedBy',a."requestedBy",'requestedAt',to_char(a."requestedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'state',a.state,'reviewedBy',a."reviewedBy",'reviewedAt',to_char(a."reviewedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'reviewNote',a."reviewNote",'appliedCommandId',a."appliedCommandId"))
$$;
CREATE FUNCTION vamotors.approval_diff(old jsonb, after jsonb, paths text[]) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT coalesce(jsonb_object_agg(f,jsonb_build_object('before',coalesce(old #> string_to_array(f,'.'),'null'::jsonb),'after',coalesce(after #> string_to_array(f,'.'),'null'::jsonb))),'{}'::jsonb) FROM unnest(paths) f WHERE coalesce(old #> string_to_array(f,'.'),'null'::jsonb) IS DISTINCT FROM coalesce(after #> string_to_array(f,'.'),'null'::jsonb)
$$;
CREATE FUNCTION vamotors.disposal_json(did uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('id',d.id,'date',d."occurredDate"::text,'reason',d.reason,'method',d.method,'proceeds',d.proceeds::text,'basisVersionId',d."basisVersionId",'approval',jsonb_build_object('kind','CURRENT','approvalId',a.id,'reviewerId',a."reviewedBy",'reviewerName',a."reviewerName",'reviewedAt',to_char(a."reviewedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),'payments',coalesce((SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id',r.id,'owner',jsonb_build_object('type','DISPOSAL','id',d.id),'commandId',r."commandId",'amount',r.amount::text,'direction',r.direction,'category',r.category,'date',r."occurredDate"::text,'method',r.method,'recordedAt',to_char(r."recordedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'reference',r.reference)) ORDER BY r."occurredDate",r.id) FROM vamotors."DisposalReceipt" r WHERE r."disposalId"=d.id),'[]'::jsonb)) FROM vamotors."Disposal" d JOIN vamotors."ApprovalRequest" a ON a.id=d."approvalId" WHERE d.id=did
$$;

CREATE FUNCTION vamotors.approval_owner_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'PENDING' OR NEW.revision<>1 THEN RAISE EXCEPTION 'PENDING_APPROVAL_REQUIRED' USING ERRCODE='23514'; END IF;
 ELSE
  IF OLD.state<>'PENDING' OR NEW.state NOT IN ('APPROVED','REJECTED') OR NEW.revision<>OLD.revision+1
  OR (to_jsonb(NEW)-ARRAY['state','revision','reviewedBy','reviewedAt','reviewNote','reviewerName','reviewCommandId','appliedCommandId']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','revision','reviewedBy','reviewedAt','reviewNote','reviewerName','reviewCommandId','appliedCommandId']) THEN RAISE EXCEPTION 'IMMUTABLE_PROPOSAL' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER approval_owner BEFORE INSERT OR UPDATE ON vamotors."ApprovalRequest" FOR EACH ROW EXECUTE FUNCTION vamotors.approval_owner_guard();

-- Existing parents gain no field descendants or actions: all old wildcard,
-- compound gates (including uploads), conditions and delegation ceilings remain
-- exactly the v11 populations. Only the two NEW subject universes are seeded.
-- Trigger bodies below remain enabled. Owner maintenance is bounded to these
-- additions and revision-only change, and exact original definitions restored
-- before COMMIT; there is no persistent runtime/definer maintenance escape.
DO $$
DECLARE protected_permissions text; protected_role text; temporary text; rule jsonb; pid uuid; rid uuid;
BEGIN
 SELECT pg_get_functiondef('vamotors.protect_admin_permissions()'::regprocedure) INTO protected_permissions;
 SELECT pg_get_functiondef('vamotors.protect_system_role()'::regprocedure) INTO protected_role;
 temporary:=replace(protected_permissions,'BEGIN',E'BEGIN\n IF current_user=''vamotors_migrator'' AND TG_OP=''INSERT'' AND EXISTS(SELECT 1 FROM vamotors."Permission" p WHERE p.id=NEW."permissionId" AND p.rule->>''subject'' IN (''ApprovalRequest'',''Disposal'')) THEN RETURN NEW; END IF;');
 IF temporary=protected_permissions THEN RAISE EXCEPTION 'PERMISSION_GUARD_BASE_MISMATCH'; END IF; EXECUTE temporary;
 temporary:=replace(protected_role,'BEGIN',E'BEGIN\n IF current_user=''vamotors_migrator'' AND TG_OP=''UPDATE'' AND NEW.revision=OLD.revision+1 AND (to_jsonb(NEW)-''revision'')=(to_jsonb(OLD)-''revision'') THEN RETURN NEW; END IF;');
 IF temporary=protected_role THEN RAISE EXCEPTION 'ROLE_GUARD_BASE_MISMATCH'; END IF; EXECUTE temporary;
 SELECT id INTO rid FROM vamotors."Role" WHERE "systemKey"='ADMINISTRATOR';
 IF rid IS NOT NULL THEN
  FOR rule IN SELECT value FROM jsonb_array_elements('[{"subject":"ApprovalRequest","action":"read","fields":["*"]},{"subject":"ApprovalRequest","action":"create","fields":["*"]},{"subject":"ApprovalRequest","action":"approve","fields":["*"]},{"subject":"Disposal","action":"read","fields":["*"]},{"subject":"Disposal","action":"create","fields":["*"]},{"subject":"Disposal","action":"pay","fields":["*"]}]'::jsonb) LOOP
   INSERT INTO vamotors."Permission"(id,"ruleHash",rule) VALUES(gen_random_uuid(),encode(sha256(convert_to(vamotors.approval_canonical(rule),'UTF8')),'hex'),rule) ON CONFLICT("ruleHash") DO NOTHING;
   SELECT id INTO pid FROM vamotors."Permission" WHERE "ruleHash"=encode(sha256(convert_to(vamotors.approval_canonical(rule),'UTF8')),'hex');
   INSERT INTO vamotors."RolePermission" VALUES(rid,pid) ON CONFLICT DO NOTHING;
  END LOOP;
  UPDATE vamotors."Role" SET revision=revision+1 WHERE id=rid;
 END IF;
 EXECUTE protected_permissions; EXECUTE protected_role;
END $$;

-- Final-graph checks and strictly evidenced parent extensions follow.
CREATE FUNCTION vamotors.check_approval_graph() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a vamotors."ApprovalRequest"; p vamotors."PurchaseRecord"; v vamotors."Vehicle"; b vamotors."CycleBasisVersion"; c vamotors."CommandReceipt"; i jsonb; initial jsonb; expected jsonb; snap jsonb; after_dto jsonb; old_dto jsonb; recipients jsonb; uid uuid; audit_paths text[]:=ARRAY['id','revision','proposal.kind','proposal.input.cycleId','proposal.input.date','proposal.input.reason','proposal.input.method','proposal.input.proceeds','proposal.input.receipt.amount','proposal.input.receipt.date','proposal.input.receipt.method','proposal.input.receipt.reference','expected','payloadHash','reason','requestedBy','requestedAt','state','reviewedBy','reviewedAt','reviewNote','appliedCommandId'];
BEGIN
 SELECT * INTO a FROM vamotors."ApprovalRequest" WHERE id=NEW.id;
 SELECT * INTO p FROM vamotors."PurchaseRecord" WHERE id=a."cycleId";
 SELECT * INTO v FROM vamotors."Vehicle" WHERE id=p."vehicleId";
 SELECT * INTO b FROM vamotors."CycleBasisVersion" WHERE "cycleId"=p.id ORDER BY version DESC LIMIT 1;
 i:=a.proposal->'input';
 IF a.proposal->>'kind'<>'WRITE_OFF' OR a.proposal-ARRAY['kind','input']<>'{}'::jsonb OR jsonb_typeof(i)<>'object' OR i-ARRAY['cycleId','date','reason','method','proceeds','receipt']<>'{}'::jsonb
 OR i->>'cycleId'<>p.id::text OR NOT(i ?& ARRAY['cycleId','date','reason','method','proceeds']) OR i->>'method' NOT IN ('SCRAPPED','AUCTIONED','DONATED','OTHER')
 OR i->>'proceeds' !~ '^(0|[1-9][0-9]{0,13})$' OR i->>'reason' IS NULL OR i->>'reason'<>btrim(i->>'reason') OR length(i->>'reason') NOT BETWEEN 1 AND 2000
 OR (i->>'date')::date<p."purchaseDate" OR (i->>'date')::date>(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Colombo')::date
 OR (i->>'proceeds'='0' AND i ? 'receipt') OR ((i->>'proceeds')::numeric>0 AND (NOT(i ? 'receipt') OR i#>>'{receipt,amount}' IS DISTINCT FROM i->>'proceeds'))
 OR (i ? 'receipt' AND (jsonb_typeof(i->'receipt')<>'object' OR (i->'receipt')-ARRAY['amount','date','method','reference']<>'{}'::jsonb OR NOT((i->'receipt') ?& ARRAY['amount','date','method']) OR i#>>'{receipt,method}' NOT IN ('CASH','BANK_TRANSFER') OR (i#>>'{receipt,date}')::date>(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Colombo')::date))
 OR p."acquisitionCommandId" IS NULL OR b.id IS NULL OR p."acquisitionKind"<>'SUPPLIER' OR p."purchaseType" NOT IN ('CASH','BRAND_NEW') THEN RAISE EXCEPTION 'INVALID_APPROVAL_PAYLOAD' USING ERRCODE='23514'; END IF;
 expected:=jsonb_build_array(jsonb_build_object('type','PurchaseRecord','id',p.id,'revision',p.revision-CASE WHEN a.state='APPROVED' THEN 1 ELSE 0 END),jsonb_build_object('type','Vehicle','id',v.id,'revision',v.revision-CASE WHEN a.state='APPROVED' THEN 1 ELSE 0 END));
 snap:=jsonb_strip_nulls(jsonb_build_object('cycleId',p.id,'vehicleId',v.id,'basisVersionId',b.id,'basis',b.total::text,'currency',b.currency,'scale',b.scale,'purchasePrice',p."purchasePrice"::text,'purchaseType',p."purchaseType",'listedPrice',p."listedPrice"::text));
 IF a.expected IS DISTINCT FROM expected OR a.snapshot IS DISTINCT FROM snap OR a."payloadHash"<>encode(sha256(convert_to(vamotors.approval_canonical(jsonb_build_object('schemaVersion',1,'proposal',a.proposal,'expected',a.expected,'snapshot',a.snapshot,'reason',a.reason)),'UTF8')),'hex') THEN RAISE EXCEPTION 'APPROVAL_BINDING_MISMATCH' USING ERRCODE='23514'; END IF;
 SELECT * INTO c FROM vamotors."CommandReceipt" WHERE id=CASE WHEN TG_OP='INSERT' THEN a."requestCommandId" ELSE a."reviewCommandId" END AND xmin=pg_current_xact_id()::xid;
 IF c.id IS NULL OR c."environmentId"<>(SELECT id FROM vamotors."Environment" WHERE singleton=1) OR c.result<>jsonb_build_object('type','ApprovalRequest','id',a.id,'revision',a.revision)
 OR NOT EXISTS(SELECT 1 FROM vamotors."BusinessSequence" WHERE id=1 AND value=c."businessSequence" AND xmin=pg_current_xact_id()::xid) THEN RAISE EXCEPTION 'APPROVAL_COMMAND_REQUIRED' USING ERRCODE='23514'; END IF;
 uid:=CASE WHEN TG_OP='INSERT' THEN a."requestedBy" ELSE a."reviewedBy" END;
 IF c."actorKey"<>'USER:'||uid::text OR c."commandName"<>(CASE WHEN TG_OP='INSERT' THEN 'requestApproval' ELSE 'reviewApproval' END) THEN RAISE EXCEPTION 'APPROVAL_ACTOR_MISMATCH' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF a.state<>'PENDING' OR p."closedAt" IS NOT NULL OR p.status NOT IN ('PURCHASED','IN_STOCK') OR v."activePurchaseId" IS DISTINCT FROM p.id
  OR EXISTS(SELECT 1 FROM vamotors."PurchaseRecord" WHERE id=p.id AND xmin=pg_current_xact_id()::xid) OR EXISTS(SELECT 1 FROM vamotors."Vehicle" WHERE id=v.id AND xmin=pg_current_xact_id()::xid)
  OR NOT vamotors.approval_origin(uid,a,p,v,false)
  OR NOT vamotors.approval_fields(uid,'ApprovalRequest','create',jsonb_build_object('createdBy',uid),ARRAY['proposal','proposal.kind','reason']||ARRAY(SELECT 'proposal.input.'||f FROM unnest(vamotors.approval_input_fields(i)) f)) THEN RAISE EXCEPTION 'INVALID_PENDING_APPROVAL' USING ERRCODE='23514'; END IF;
  SELECT coalesce(jsonb_agg(u.id::text ORDER BY u.id),'[]'::jsonb) INTO recipients FROM vamotors."user" u WHERE u.active AND u.id<>uid AND vamotors.approval_origin(u.id,a,p,v,true) AND vamotors.approval_fields(u.id,'ApprovalRequest','approve',jsonb_build_object('createdBy',uid),ARRAY['approvalId','decision','note']);
  IF recipients='[]'::jsonb OR recipients IS DISTINCT FROM a."requiredRecipientIds"
  OR (SELECT coalesce(jsonb_agg(n."recipientUserId"::text ORDER BY n."recipientUserId"),'[]'::jsonb) FROM vamotors."Notification" n WHERE n."targetId"=a.id AND n.kind='APPROVAL_REQUIRED' AND n."targetType"='ApprovalRequest' AND n."eventKey"='approval:required:'||a.id::text||':1' AND n.xmin=pg_current_xact_id()::xid) IS DISTINCT FROM recipients THEN RAISE EXCEPTION 'APPROVAL_RECIPIENT_REQUIRED' USING ERRCODE='23514'; END IF;
  old_dto:=NULL;
 ELSE
  IF NOT vamotors.approval_origin(uid,a,p,v,true) OR NOT vamotors.approval_origin(a."requestedBy",a,p,v,false)
  OR NOT vamotors.approval_fields(uid,'ApprovalRequest','approve',jsonb_build_object('createdBy',a."requestedBy"),ARRAY['approvalId','decision']||CASE WHEN a."reviewNote" IS NULL THEN ARRAY[]::text[] ELSE ARRAY['note'] END)
  OR a."reviewerName" IS DISTINCT FROM (SELECT name FROM vamotors."user" WHERE id=uid AND active)
  OR (SELECT count(*) FROM vamotors."Notification" n WHERE n."recipientUserId"=a."requestedBy" AND n."targetType"='ApprovalRequest' AND n."targetId"=a.id AND n.kind='APPROVAL_OUTCOME' AND n."eventKey"='approval:outcome:'||a.id::text||':2' AND n.xmin=pg_current_xact_id()::xid)<>1 THEN RAISE EXCEPTION 'INVALID_APPROVAL_REVIEW' USING ERRCODE='23514'; END IF;
  IF a.state='REJECTED' AND (p."closedAt" IS NOT NULL OR p.status NOT IN ('PURCHASED','IN_STOCK') OR v."activePurchaseId" IS DISTINCT FROM p.id OR EXISTS(SELECT 1 FROM vamotors."Disposal" WHERE "approvalId"=a.id)
   OR EXISTS(SELECT 1 FROM vamotors."PurchaseRecord" WHERE id=p.id AND xmin=pg_current_xact_id()::xid) OR EXISTS(SELECT 1 FROM vamotors."Vehicle" WHERE id=v.id AND xmin=pg_current_xact_id()::xid)) THEN RAISE EXCEPTION 'REJECTION_DOMAIN_EFFECT' USING ERRCODE='23514'; END IF;
  IF a.state='APPROVED' AND NOT EXISTS(SELECT 1 FROM vamotors."Disposal" d WHERE d."approvalId"=a.id AND d."commandId"=c.id AND d.xmin=pg_current_xact_id()::xid) THEN RAISE EXCEPTION 'APPROVAL_APPLICATION_REQUIRED' USING ERRCODE='23514'; END IF;
  old_dto:=vamotors.approval_dto(OLD);
 END IF;
 after_dto:=vamotors.approval_dto(a);
 IF NOT EXISTS(SELECT 1 FROM vamotors."EntityReadVersion" e WHERE e."entityType"='ApprovalRequest' AND e."entityId"=a.id AND e."commandId"=c.id AND e.revision=a.revision AND e.sequence=c."businessSequence" AND e.payload=after_dto AND e.xmin=pg_current_xact_id()::xid)
 OR NOT EXISTS(SELECT 1 FROM vamotors."AuditEntry" e WHERE e."entityType"='ApprovalRequest' AND e."entityId"=a.id AND e."commandId"=c.id AND e."actorKind"='USER' AND e."userId"=uid AND e."initiatedBy"=a."requestedBy" AND e."approverId" IS NOT DISTINCT FROM CASE WHEN TG_OP='INSERT' THEN NULL::uuid ELSE uid END AND e.action=c."commandName" AND e.reason=CASE WHEN TG_OP='INSERT' THEN a.reason ELSE coalesce(a."reviewNote",a.reason) END AND e."fieldDiff"=vamotors.approval_diff(old_dto,after_dto,audit_paths) AND e.xmin=pg_current_xact_id()::xid)
 OR (SELECT count(*) FROM vamotors."EntityReadVersion" WHERE "commandId"=c.id)<>(CASE WHEN a.state='APPROVED' THEN 3 ELSE 1 END)
 OR (SELECT count(*) FROM vamotors."AuditEntry" WHERE "commandId"=c.id)<>(CASE WHEN a.state='APPROVED' THEN 4 ELSE 1 END)
 OR (SELECT count(*) FROM vamotors."StatusEvent" WHERE "commandId"=c.id)<>(CASE WHEN a.state='APPROVED' THEN 1 ELSE 0 END)
 OR EXISTS(SELECT 1 FROM vamotors."PurchasePayment" WHERE "commandId"=c.id) OR EXISTS(SELECT 1 FROM vamotors."CostPayment" WHERE "commandId"=c.id)
 OR EXISTS(SELECT 1 FROM vamotors."MileageReading" WHERE "commandId"=c.id) OR EXISTS(SELECT 1 FROM vamotors."CycleBasisVersion" WHERE "commandId"=c.id)
 THEN RAISE EXCEPTION 'INVALID_APPROVAL_EVIDENCE' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER approval_graph AFTER INSERT OR UPDATE ON vamotors."ApprovalRequest" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vamotors.check_approval_graph();

CREATE FUNCTION vamotors.check_disposal_graph() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE d vamotors."Disposal"; a vamotors."ApprovalRequest"; p vamotors."PurchaseRecord"; v vamotors."Vehicle"; b vamotors."CycleBasisVersion"; c vamotors."CommandReceipt"; i jsonb; r vamotors."DisposalReceipt"; cid uuid;
BEGIN
 cid:=CASE WHEN TG_TABLE_NAME='Disposal' THEN NEW."cycleId" WHEN TG_TABLE_NAME='DisposalReceipt' THEN NEW."cycleId" WHEN TG_TABLE_NAME='Vehicle' THEN OLD."activePurchaseId" ELSE NEW.id END;
 SELECT * INTO p FROM vamotors."PurchaseRecord" WHERE id=cid;
 SELECT * INTO d FROM vamotors."Disposal" WHERE "cycleId"=cid;
 SELECT * INTO v FROM vamotors."Vehicle" WHERE id=p."vehicleId";
 SELECT * INTO a FROM vamotors."ApprovalRequest" WHERE id=d."approvalId";
 SELECT * INTO b FROM vamotors."CycleBasisVersion" WHERE id=d."basisVersionId" AND "cycleId"=cid;
 SELECT * INTO c FROM vamotors."CommandReceipt" WHERE id=d."commandId" AND xmin=pg_current_xact_id()::xid;
 i:=a.proposal->'input';
 IF d.id IS NULL OR a.state<>'APPROVED' OR a.kind<>'WRITE_OFF' OR a."cycleId"<>cid OR a."appliedCommandId" IS DISTINCT FROM c.id OR a."reviewCommandId" IS DISTINCT FROM c.id OR a."reviewedBy" IS DISTINCT FROM d."createdBy" OR a."reviewedBy"=a."requestedBy"
 OR c.id IS NULL OR c."commandName"<>'reviewApproval' OR c."actorKey"<>'USER:'||d."createdBy"::text OR c.result<>jsonb_build_object('type','ApprovalRequest','id',a.id,'revision',a.revision)
 OR d."occurredDate"::text IS DISTINCT FROM i->>'date' OR d.reason IS DISTINCT FROM i->>'reason' OR d.method IS DISTINCT FROM i->>'method' OR d.proceeds::text IS DISTINCT FROM i->>'proceeds'
 OR d."approvalKind"<>'CURRENT' OR d."basisVersionId"::text IS DISTINCT FROM a.snapshot->>'basisVersionId' OR d."netLoss" IS DISTINCT FROM b.total-d.proceeds
 OR b.id IS DISTINCT FROM (SELECT id FROM vamotors."CycleBasisVersion" WHERE "cycleId"=cid ORDER BY version DESC LIMIT 1)
 OR p.status<>'WRITTEN_OFF' OR p.available OR p."closedAt" IS DISTINCT FROM a."reviewedAt" OR p."holdReason" IS NOT NULL OR v."activePurchaseId" IS NOT NULL
 OR NOT EXISTS(SELECT 1 FROM vamotors."Disposal" WHERE id=d.id AND xmin=pg_current_xact_id()::xid)
 OR NOT EXISTS(SELECT 1 FROM vamotors."PurchaseRecord" WHERE id=p.id AND xmin=pg_current_xact_id()::xid)
 OR NOT EXISTS(SELECT 1 FROM vamotors."Vehicle" WHERE id=v.id AND xmin=pg_current_xact_id()::xid)
 OR NOT EXISTS(SELECT 1 FROM vamotors."ApprovalRequest" WHERE id=a.id AND xmin=pg_current_xact_id()::xid)
 OR NOT EXISTS(SELECT 1 FROM vamotors."BusinessSequence" WHERE id=1 AND value=c."businessSequence" AND xmin=pg_current_xact_id()::xid)
 OR (SELECT count(*) FROM vamotors."StatusEvent" s WHERE s."cycleId"=cid AND s."commandId"=c.id AND s."from" IN ('PURCHASED','IN_STOCK') AND s."to"='WRITTEN_OFF' AND s.action='approvedWriteOff' AND s."userId"=d."createdBy" AND s."occurredAt"=d."occurredDate"::timestamp AND s.xmin=pg_current_xact_id()::xid)<>1 THEN RAISE EXCEPTION 'INVALID_DISPOSAL_GRAPH' USING ERRCODE='23514'; END IF;
 IF d.proceeds=0 THEN
  IF EXISTS(SELECT 1 FROM vamotors."DisposalReceipt" WHERE "disposalId"=d.id OR "commandId"=c.id) THEN RAISE EXCEPTION 'ZERO_DISPOSAL_PAYMENT' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO r FROM vamotors."DisposalReceipt" WHERE "disposalId"=d.id;
  IF r.id IS NULL OR r."cycleId"<>cid OR r.amount<>d.proceeds OR r."occurredDate"::text IS DISTINCT FROM i#>>'{receipt,date}' OR r.method IS DISTINCT FROM i#>>'{receipt,method}' OR r.reference IS DISTINCT FROM i#>>'{receipt,reference}' OR r."commandId"<>c.id OR r.currency<>b.currency OR r.scale<>b.scale OR r.direction<>'IN' OR r.category<>'DISPOSAL' OR r."lineKey"<>'proceeds'
  OR NOT EXISTS(SELECT 1 FROM vamotors."DisposalReceipt" WHERE id=r.id AND xmin=pg_current_xact_id()::xid) THEN RAISE EXCEPTION 'INVALID_DISPOSAL_RECEIPT' USING ERRCODE='23514'; END IF;
 END IF;
 IF (SELECT count(*) FROM vamotors."DisposalReceipt" WHERE "commandId"=c.id)<>(CASE WHEN d.proceeds=0 THEN 0 ELSE 1 END) THEN RAISE EXCEPTION 'DISPOSAL_PAYMENT_CARDINALITY' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER disposal_graph AFTER INSERT ON vamotors."Disposal" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vamotors.check_disposal_graph();
CREATE CONSTRAINT TRIGGER disposal_receipt_graph AFTER INSERT ON vamotors."DisposalReceipt" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vamotors.check_disposal_graph();
CREATE CONSTRAINT TRIGGER disposal_cycle_graph AFTER UPDATE ON vamotors."PurchaseRecord" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN(NEW.status='WRITTEN_OFF') EXECUTE FUNCTION vamotors.check_disposal_graph();
CREATE CONSTRAINT TRIGGER disposal_vehicle_graph AFTER UPDATE ON vamotors."Vehicle" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN(OLD."activePurchaseId" IS NOT NULL AND NEW."activePurchaseId" IS NULL) EXECUTE FUNCTION vamotors.check_disposal_graph();

CREATE FUNCTION vamotors.check_disposal_root() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE d vamotors."Disposal"; a vamotors."ApprovalRequest"; c vamotors."CommandReceipt"; v vamotors."Vehicle"; old_payload jsonb; after_payload jsonb; expected jsonb; financial jsonb; paths text[]; kind text; eid uuid; rev integer;
BEGIN
 SELECT * INTO d FROM vamotors."Disposal" WHERE "cycleId"=NEW.id;
 SELECT * INTO a FROM vamotors."ApprovalRequest" WHERE id=d."approvalId";
 SELECT * INTO c FROM vamotors."CommandReceipt" WHERE id=d."commandId" AND xmin=pg_current_xact_id()::xid;
 SELECT * INTO v FROM vamotors."Vehicle" WHERE id=NEW."vehicleId";
 IF OLD.status NOT IN ('PURCHASED','IN_STOCK') OR OLD."closedAt" IS NOT NULL OR NEW.revision::bigint<>OLD.revision::bigint+1
 OR (to_jsonb(NEW)-ARRAY['status','available','holdReason','closedAt','revision','updatedAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','available','holdReason','closedAt','revision','updatedAt'])
 OR NOT EXISTS(SELECT 1 FROM vamotors."StatusEvent" s WHERE s."commandId"=c.id AND s."cycleId"=NEW.id AND s."from"=OLD.status)
 THEN RAISE EXCEPTION 'INVALID_DISPOSAL_ROOT_DELTA' USING ERRCODE='23514'; END IF;
 FOREACH kind IN ARRAY ARRAY['PurchaseRecord','Vehicle'] LOOP
  eid:=CASE WHEN kind='PurchaseRecord' THEN NEW.id ELSE NEW."vehicleId" END; rev:=CASE WHEN kind='PurchaseRecord' THEN NEW.revision ELSE v.revision END;
  SELECT payload INTO old_payload FROM vamotors."EntityReadVersion" WHERE "entityType"=kind AND "entityId"=eid AND sequence<c."businessSequence" ORDER BY sequence DESC LIMIT 1;
  SELECT payload INTO after_payload FROM vamotors."EntityReadVersion" WHERE "entityType"=kind AND "entityId"=eid AND "commandId"=c.id AND sequence=c."businessSequence" AND revision=rev AND xmin=pg_current_xact_id()::xid;
  IF old_payload IS NULL OR after_payload IS NULL OR (old_payload->>'revision')::integer<>OLD.revision OR (old_payload->>'identityRevision')::bigint+1<>v.revision THEN RAISE EXCEPTION 'DISPOSAL_SOURCE_VERSION_REQUIRED' USING ERRCODE='23514'; END IF;
  IF kind='PurchaseRecord' THEN old_payload:=jsonb_set(old_payload,'{seller}',(SELECT jsonb_build_object('type','SUPPLIER','id',s.id,'name',s.name,'active',s.active) FROM vamotors."Supplier" s WHERE s.id=NEW."supplierId")); END IF;
  financial:=old_payload->'financial';
  IF (financial->>'cashIn')::numeric+d.proceeds>9223372036854775807 THEN RAISE EXCEPTION 'MONEY_OVERFLOW' USING ERRCODE='23514'; END IF;
  financial:=financial||jsonb_build_object('cashIn',((financial->>'cashIn')::numeric+d.proceeds)::text,'net',((financial->>'net')::numeric+d.proceeds)::text);
  expected:=(old_payload-'holdReason')||jsonb_build_object('revision',NEW.revision,'identityRevision',v.revision,'status','WRITTEN_OFF','available',false,'financial',financial);
  IF kind='PurchaseRecord' THEN expected:=expected||jsonb_build_object('closedAt',to_char(NEW."closedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'disposal',vamotors.disposal_json(d.id)); END IF;
  IF after_payload IS DISTINCT FROM expected THEN RAISE EXCEPTION 'INVALID_DISPOSAL_SOURCE_VERSION' USING ERRCODE='23514'; END IF;
  paths:=ARRAY(SELECT key FROM jsonb_object_keys(coalesce(old_payload,'{}')||after_payload) key UNION SELECT 'financial.'||key FROM jsonb_object_keys(coalesce(old_payload->'financial','{}')||after_payload->'financial') key);
  IF NOT EXISTS(SELECT 1 FROM vamotors."AuditEntry" e WHERE e."commandId"=c.id AND e."entityType"=kind AND e."entityId"=eid AND e.action='approvedWriteOff' AND e."actorKind"='USER' AND e."userId"=a."reviewedBy" AND e."initiatedBy"=a."requestedBy" AND e."approverId"=a."reviewedBy" AND e.reason=d.reason AND e."fieldDiff"=vamotors.approval_diff(old_payload,after_payload,paths) AND e.xmin=pg_current_xact_id()::xid) THEN RAISE EXCEPTION 'INVALID_DISPOSAL_AUDIT' USING ERRCODE='23514'; END IF;
 END LOOP;
 paths:=ARRAY['id','date','reason','method','proceeds','basisVersionId','approval.kind','approval.approvalId','approval.reviewerId','approval.reviewerName','approval.reviewedAt','payments'];
 IF NOT EXISTS(SELECT 1 FROM vamotors."AuditEntry" e WHERE e."commandId"=c.id AND e."entityType"='Disposal' AND e."entityId"=d.id AND e.action='approvedWriteOff' AND e."actorKind"='USER' AND e."userId"=a."reviewedBy" AND e."initiatedBy"=a."requestedBy" AND e."approverId"=a."reviewedBy" AND e.reason=d.reason AND e."fieldDiff"=vamotors.approval_diff(NULL,vamotors.disposal_json(d.id),paths) AND e.xmin=pg_current_xact_id()::xid) THEN RAISE EXCEPTION 'DISPOSAL_AUDIT_REQUIRED' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER disposal_root_delta AFTER UPDATE ON vamotors."PurchaseRecord" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN(NEW.status='WRITTEN_OFF') EXECUTE FUNCTION vamotors.check_disposal_root();

-- Append a new, evidenced close branch; leave all accepted open-cycle branches.
ALTER TABLE vamotors."PurchaseRecord" DROP CONSTRAINT initial_cycle_capability;
ALTER TABLE vamotors."PurchaseRecord" ADD CONSTRAINT initial_cycle_capability CHECK(((status IN ('PURCHASED','IN_STOCK') AND "closedAt" IS NULL) OR (status='WRITTEN_OFF' AND "closedAt" IS NOT NULL AND NOT available)) AND "purchaseType"<>'LEASE_SETTLEMENT' AND "acquisitionKind"='SUPPLIER');
DO $$
DECLARE source text; updated text; expression text;
BEGIN
 SELECT pg_get_constraintdef(oid) INTO expression FROM pg_constraint WHERE conrelid='vamotors."EntityReadVersion"'::regclass AND conname='EntityReadVersion_entityType_check';
 IF expression IS NULL THEN RAISE EXCEPTION 'SOURCE_TYPES_BASE_MISMATCH'; END IF;
 ALTER TABLE vamotors."EntityReadVersion" DROP CONSTRAINT "EntityReadVersion_entityType_check";
 EXECUTE 'ALTER TABLE vamotors."EntityReadVersion" ADD CONSTRAINT "EntityReadVersion_entityType_check" CHECK ('||substr(expression,7)||' OR "entityType"=''ApprovalRequest'')';
 SELECT pg_get_functiondef('vamotors.initial_cycle_transition()'::regprocedure) INTO source;
 updated:=replace(source,'BEGIN',E'BEGIN\n IF TG_OP=''UPDATE'' AND OLD.status IN (''PURCHASED'',''IN_STOCK'') AND NEW.status=''WRITTEN_OFF'' THEN RETURN NEW; END IF;');
 IF updated=source THEN RAISE EXCEPTION 'TRANSITION_BASE_MISMATCH'; END IF; EXECUTE updated;
 SELECT pg_get_functiondef('vamotors.acquisition_root_guard()'::regprocedure) INTO source;
 updated:=replace(source,'BEGIN',E'BEGIN\n IF TG_OP=''UPDATE'' AND NEW.status=''WRITTEN_OFF'' THEN RETURN NEW; END IF;');
 IF updated=source THEN RAISE EXCEPTION 'CYCLE_ROOT_BASE_MISMATCH'; END IF; EXECUTE updated;
 SELECT pg_get_functiondef('vamotors.check_acquisition_graph()'::regprocedure) INTO source;
 updated:=replace(source,'v."activePurchaseId"=p.id','(v."activePurchaseId"=p.id OR (p.status=''WRITTEN_OFF'' AND p."closedAt" IS NOT NULL AND v."activePurchaseId" IS NULL AND EXISTS(SELECT 1 FROM vamotors."Disposal" d WHERE d."cycleId"=p.id)))');
 IF updated=source THEN RAISE EXCEPTION 'ACQUISITION_POINTER_BASE_MISMATCH'; END IF; EXECUTE updated;
 SELECT pg_get_functiondef('vamotors.purchase_vehicle_guard()'::regprocedure) INTO source;
 updated:=replace(source,'BEGIN',E'BEGIN\n IF TG_OP=''UPDATE'' AND OLD."activePurchaseId" IS NOT NULL AND NEW."activePurchaseId" IS NULL AND NEW.revision::bigint=OLD.revision::bigint+1 AND (to_jsonb(NEW)-ARRAY[''activePurchaseId'',''revision'',''updatedAt''])=(to_jsonb(OLD)-ARRAY[''activePurchaseId'',''revision'',''updatedAt'']) THEN RETURN NEW; END IF;');
 IF updated=source THEN RAISE EXCEPTION 'VEHICLE_BASE_MISMATCH'; END IF; EXECUTE updated;
 SELECT pg_get_functiondef('vamotors.cycle_edit_vehicle_graph()'::regprocedure) INTO source;
 updated:=replace(source,'BEGIN',E'BEGIN\n IF OLD."activePurchaseId" IS NOT NULL AND NEW."activePurchaseId" IS NULL THEN RETURN NULL; END IF;');
 IF updated=source THEN RAISE EXCEPTION 'PHYSICAL_GRAPH_BASE_MISMATCH'; END IF; EXECUTE updated;
 SELECT pg_get_functiondef('vamotors.purchase_status_guard()'::regprocedure) INTO source;
 updated:=replace(source,'BEGIN',E'BEGIN\n IF NEW."to"=''WRITTEN_OFF'' AND NEW.action=''approvedWriteOff'' THEN RETURN NEW; END IF;');
 IF updated=source THEN RAISE EXCEPTION 'STATUS_BASE_MISMATCH'; END IF; EXECUTE updated;
 SELECT pg_get_functiondef('vamotors.check_stock_graph()'::regprocedure) INTO source;
 updated:=replace(source,'BEGIN',E'BEGIN\n IF NEW.status=''WRITTEN_OFF'' THEN RETURN NULL; END IF;');
 IF updated=source THEN RAISE EXCEPTION 'STOCK_BASE_MISMATCH'; END IF; EXECUTE updated;
END $$;
-- cycle_cost_root_graph already excludes changed lifecycle. New close graph
-- resolves the ApprovalRequest result through appliedCommandId, never invents
-- a PurchaseRecord-result receipt or widens that old graph's receipt binding.
CREATE OR REPLACE VIEW vamotors."CashMovement" AS
 SELECT 'PURCHASE'::text AS "sourceType", "cycleId" AS "sourceId", id AS "paymentId", "occurredDate" AS date, direction, amount, method, category, "commandId" FROM vamotors."PurchasePayment"
 UNION ALL SELECT 'COST'::text,"costId",id,"occurredDate",direction,amount,method,category,"commandId" FROM vamotors."CostPayment"
 UNION ALL SELECT 'DISPOSAL'::text,"disposalId",id,"occurredDate",direction,amount,method,category,"commandId" FROM vamotors."DisposalReceipt";
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA vamotors FROM PUBLIC;
SET CONSTRAINTS ALL IMMEDIATE;
COMMIT;
