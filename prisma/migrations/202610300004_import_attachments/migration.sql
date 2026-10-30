BEGIN;
SELECT value FROM vamotors."BusinessSequence" WHERE id=1 FOR UPDATE;
SELECT vamotors.lock_admin_guard();

-- Exact accepted ac registry v9 -> v10. No old subject/action/field universe changes,
-- including VehicleCost and all purchase/cost payment/correction leaves.
-- Old wildcard, compound, create and delegation rules/joins stay byte-identical;
-- the two new subjects cannot be reached by any old subject-specific wildcard.
ALTER TABLE vamotors."EntityReadVersion" DROP CONSTRAINT "EntityReadVersion_entityType_check";
ALTER TABLE vamotors."EntityReadVersion" ADD CONSTRAINT "EntityReadVersion_entityType_check" CHECK("entityType" IN ('Vehicle','PurchaseRecord','Customer','Supplier','RepairVendor','FinanceCompany','Settings','RateSheet','Quote','VehicleCost','ImportBatch','Document'));

CREATE TABLE vamotors."ImportBatch" (
 id uuid PRIMARY KEY, "environmentId" uuid NOT NULL REFERENCES vamotors."Environment"(id) ON DELETE RESTRICT,
 "createdBy" uuid NOT NULL REFERENCES vamotors."user"(id) ON DELETE RESTRICT,
 "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), "schemaVersion" integer NOT NULL DEFAULT 1 CHECK("schemaVersion"=1),
 state text NOT NULL DEFAULT 'STAGED' CHECK(state='STAGED'),
 types text[] NOT NULL CHECK(cardinality(types) BETWEEN 1 AND 7 AND types <@ ARRAY['SUPPLIERS','CUSTOMERS','REPAIR_VENDORS','VEHICLES','SALES','REPAIRS','ADVANCES']::text[] AND array_position(types,NULL) IS NULL),
 namespace text NOT NULL CHECK(length(namespace) BETWEEN 1 AND 200 AND namespace=btrim(namespace)),
 "commandId" uuid NOT NULL UNIQUE REFERENCES vamotors."CommandReceipt"(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX "ImportBatch_createdBy_createdAt_id_idx" ON vamotors."ImportBatch"("createdBy","createdAt",id);
CREATE TABLE vamotors."UploadIntent" (
 id uuid PRIMARY KEY, "batchId" uuid NOT NULL REFERENCES vamotors."ImportBatch"(id) ON DELETE RESTRICT,
 "environmentId" uuid NOT NULL REFERENCES vamotors."Environment"(id) ON DELETE RESTRICT,
 "createdBy" uuid NOT NULL REFERENCES vamotors."user"(id) ON DELETE RESTRICT,
 "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 purpose text NOT NULL CHECK(purpose='IMPORT_SOURCE'),
 filename text NOT NULL CHECK(length(filename) BETWEEN 1 AND 200 AND filename !~ '[\\/[:cntrl:]]'),
 "contentType" text NOT NULL CHECK("contentType" IN ('text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')),
 size integer NOT NULL CHECK(size BETWEEN 1 AND 5242880), sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 "stagingKey" text NOT NULL UNIQUE,
 "capturedTargetRevision" integer NOT NULL CHECK("capturedTargetRevision">0),
 "expiresAt" timestamp(3) NOT NULL CHECK("expiresAt"="createdAt"+interval '5 minutes'),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), state text NOT NULL DEFAULT 'INIT' CHECK(state IN ('INIT','FINALIZING','FAILED','FINAL')),
 "initCommandId" uuid NOT NULL UNIQUE REFERENCES vamotors."CommandReceipt"(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 "currentAttemptId" uuid UNIQUE, "claimExpiresAt" timestamp(3),
 CHECK((state='INIT' AND "currentAttemptId" IS NULL AND "claimExpiresAt" IS NULL) OR (state<>'INIT' AND "currentAttemptId" IS NOT NULL AND ((state='FINALIZING')=("claimExpiresAt" IS NOT NULL)))),
 CHECK(("contentType"='text/csv' AND filename ~* '\.csv$') OR ("contentType"<>'text/csv' AND filename ~* '\.xlsx$'))
);
CREATE INDEX "UploadIntent_batchId_id_idx" ON vamotors."UploadIntent"("batchId",id);
CREATE TABLE vamotors."UploadAttempt" (
 id uuid PRIMARY KEY, "environmentId" uuid NOT NULL REFERENCES vamotors."Environment"(id) ON DELETE RESTRICT,
 "uploadId" uuid NOT NULL REFERENCES vamotors."UploadIntent"(id) ON DELETE RESTRICT,
 "createdBy" uuid NOT NULL REFERENCES vamotors."user"(id) ON DELETE RESTRICT,
 "claimedAt" timestamp(3) NOT NULL, "claimExpiresAt" timestamp(3) NOT NULL CHECK("claimExpiresAt"="claimedAt"+interval '5 minutes'),
 "commandId" uuid NOT NULL UNIQUE, "idempotencyKey" uuid NOT NULL, "inputHash" text NOT NULL CHECK("inputHash" ~ '^[a-f0-9]{64}$'),
 "uploadRevision" integer NOT NULL CHECK("uploadRevision">0), "targetRevision" integer NOT NULL CHECK("targetRevision">0),
 "finalKey" text NOT NULL UNIQUE,
 size integer NOT NULL CHECK(size BETWEEN 1 AND 5242880), sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'), "contentType" text NOT NULL,
 UNIQUE("environmentId","createdBy","idempotencyKey")
);
ALTER TABLE vamotors."UploadIntent" ADD CONSTRAINT "UploadIntent_currentAttemptId_fkey" FOREIGN KEY("currentAttemptId") REFERENCES vamotors."UploadAttempt"(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE vamotors."Attachment" (
 id uuid PRIMARY KEY, "batchId" uuid NOT NULL REFERENCES vamotors."ImportBatch"(id) ON DELETE RESTRICT,
 "uploadIntentId" uuid NOT NULL UNIQUE REFERENCES vamotors."UploadIntent"(id) ON DELETE RESTRICT,
 "attemptId" uuid NOT NULL UNIQUE REFERENCES vamotors."UploadAttempt"(id) ON DELETE RESTRICT,
 "environmentId" uuid NOT NULL REFERENCES vamotors."Environment"(id) ON DELETE RESTRICT,
 "createdBy" uuid NOT NULL REFERENCES vamotors."user"(id) ON DELETE RESTRICT,
 purpose text NOT NULL CHECK(purpose='IMPORT_SOURCE'), filename text NOT NULL,
 "contentType" text NOT NULL, size integer NOT NULL CHECK(size BETWEEN 1 AND 5242880), sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 "finalKey" text NOT NULL UNIQUE, "verifiedAt" timestamp(3) NOT NULL,
 "commandId" uuid NOT NULL UNIQUE REFERENCES vamotors."CommandReceipt"(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE vamotors."UploadEvent" (
 id uuid PRIMARY KEY, "uploadId" uuid NOT NULL REFERENCES vamotors."UploadIntent"(id) ON DELETE RESTRICT,
 revision integer NOT NULL CHECK(revision>0), state text NOT NULL CHECK(state IN ('INIT','FINALIZING','FAILED','FINAL')),
 "attemptId" uuid REFERENCES vamotors."UploadAttempt"(id) ON DELETE RESTRICT,
 "recordedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "errorCode" text CHECK("errorCode" IN ('DOCUMENT_NOT_READY','UPLOAD_MISMATCH','UPLOAD_EXPIRED','STORAGE_UNAVAILABLE','QUOTA_STOP')),
 "commandId" uuid NOT NULL REFERENCES vamotors."CommandReceipt"(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 UNIQUE("uploadId",revision)
);
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON vamotors."Attachment" FOR EACH STATEMENT EXECUTE FUNCTION vamotors.append_only();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON vamotors."UploadAttempt" FOR EACH STATEMENT EXECUTE FUNCTION vamotors.append_only();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON vamotors."UploadEvent" FOR EACH STATEMENT EXECUTE FUNCTION vamotors.append_only();

CREATE FUNCTION vamotors.import_protocol_mutation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'RETAINED_IMPORT_METADATA' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='ImportBatch' THEN
  IF TG_OP='INSERT' THEN
   IF NEW.revision<>1 OR cardinality(NEW.types)<>(SELECT count(DISTINCT t) FROM unnest(NEW.types) t) THEN RAISE EXCEPTION 'INVALID_STAGING' USING ERRCODE='23514'; END IF;
  ELSIF NEW.revision::bigint<>OLD.revision::bigint+1 OR (to_jsonb(NEW)-'revision')<>(to_jsonb(OLD)-'revision') THEN RAISE EXCEPTION 'IMMUTABLE_STAGING' USING ERRCODE='23514'; END IF;
 ELSE
  IF TG_OP='INSERT' THEN
   IF NEW.revision<>1 OR NEW.state<>'INIT' THEN RAISE EXCEPTION 'INVALID_UPLOAD' USING ERRCODE='23514'; END IF;
  ELSIF NEW.revision::bigint<>OLD.revision::bigint+1
   OR (to_jsonb(NEW)-ARRAY['revision','state','currentAttemptId','claimExpiresAt'])<>(to_jsonb(OLD)-ARRAY['revision','state','currentAttemptId','claimExpiresAt'])
   OR NOT ((OLD.state='INIT' AND NEW.state='FINALIZING') OR (OLD.state='FINALIZING' AND NEW.state IN ('FINALIZING','FAILED','FINAL') AND NEW."currentAttemptId"=OLD."currentAttemptId"))
   OR (OLD.state='FINALIZING' AND NEW.state='FINALIZING' AND (OLD."claimExpiresAt">(CURRENT_TIMESTAMP AT TIME ZONE 'UTC') OR NEW."claimExpiresAt"<=OLD."claimExpiresAt"))
   THEN RAISE EXCEPTION 'INVALID_UPLOAD_TRANSITION' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER retained BEFORE INSERT OR UPDATE OR DELETE ON vamotors."ImportBatch" FOR EACH ROW EXECUTE FUNCTION vamotors.import_protocol_mutation();
CREATE TRIGGER retained BEFORE INSERT OR UPDATE OR DELETE ON vamotors."UploadIntent" FOR EACH ROW EXECUTE FUNCTION vamotors.import_protocol_mutation();

-- Deferred checks see the complete evidence graph, never an intermediate claim/link.
CREATE FUNCTION vamotors.import_protocol_graph() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE b vamotors."ImportBatch"; u vamotors."UploadIntent"; a vamotors."UploadAttempt"; d vamotors."Attachment"; e vamotors."UploadEvent"; c vamotors."CommandReceipt";
BEGIN
 IF TG_TABLE_NAME='ImportBatch' THEN
  b:=NEW;
  IF TG_OP='INSERT' THEN
   SELECT * INTO c FROM vamotors."CommandReceipt" WHERE id=b."commandId";
   IF c."commandName" IS DISTINCT FROM 'stageImport' OR c."actorKey" IS DISTINCT FROM 'USER:'||b."createdBy"::text OR c.result IS DISTINCT FROM jsonb_build_object('type','ImportBatch','id',b.id,'revision',1)
    OR c."environmentId" IS DISTINCT FROM b."environmentId"
    OR NOT EXISTS(SELECT 1 FROM vamotors."AuditEntry" WHERE "commandId"=c.id AND "entityType"='ImportBatch' AND "entityId"=b.id)
    OR NOT EXISTS(SELECT 1 FROM vamotors."EntityReadVersion" WHERE "commandId"=c.id AND "entityType"='ImportBatch' AND "entityId"=b.id AND revision=1)
    THEN RAISE EXCEPTION 'STAGING_EVIDENCE_REQUIRED' USING ERRCODE='23514'; END IF;
  ELSE
    IF NOT EXISTS(SELECT 1 FROM vamotors."Attachment" linked JOIN vamotors."CommandReceipt" receipt ON receipt.id=linked."commandId" WHERE linked."batchId"=b.id AND linked.xmin=pg_current_xact_id()::xid AND receipt."commandName"='completeUpload') THEN RAISE EXCEPTION 'FINAL_LINK_REQUIRED' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NULL;
 END IF;
 IF TG_TABLE_NAME='UploadIntent' THEN u:=NEW;
 ELSIF TG_TABLE_NAME='UploadAttempt' THEN SELECT * INTO u FROM vamotors."UploadIntent" WHERE id=NEW."uploadId";
 ELSIF TG_TABLE_NAME='UploadEvent' THEN SELECT * INTO u FROM vamotors."UploadIntent" WHERE id=NEW."uploadId";
 ELSE SELECT * INTO u FROM vamotors."UploadIntent" WHERE id=NEW."uploadIntentId"; END IF;
 SELECT * INTO b FROM vamotors."ImportBatch" WHERE id=u."batchId";
 SELECT * INTO a FROM vamotors."UploadAttempt" WHERE id=u."currentAttemptId";
 SELECT * INTO d FROM vamotors."Attachment" WHERE "uploadIntentId"=u.id;
 SELECT * INTO e FROM vamotors."UploadEvent" WHERE "uploadId"=u.id AND revision=u.revision;
 SELECT * INTO c FROM vamotors."CommandReceipt" WHERE id=e."commandId";
 IF TG_TABLE_NAME='UploadAttempt' THEN
  IF NEW.id IS DISTINCT FROM u."currentAttemptId" THEN RAISE EXCEPTION 'UNCLAIMED_UPLOAD_ATTEMPT' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='UploadEvent' THEN
  IF NEW.revision IS DISTINCT FROM u.revision OR NEW.state IS DISTINCT FROM u.state OR NEW."attemptId" IS DISTINCT FROM u."currentAttemptId" THEN RAISE EXCEPTION 'INVALID_UPLOAD_EVENT' USING ERRCODE='23514'; END IF;
 END IF;
 IF u."environmentId" IS DISTINCT FROM b."environmentId" OR u."environmentId" IS DISTINCT FROM (SELECT id FROM vamotors."Environment" WHERE singleton=1)
  OR u."stagingKey" !~ ('^s\.'||u."environmentId"::text||'\.'||u.id::text||'\.[a-f0-9-]{36}$')
  OR e.id IS NULL OR e.state IS DISTINCT FROM u.state OR e."attemptId" IS DISTINCT FROM u."currentAttemptId"
  OR c.id IS NULL OR c."environmentId" IS DISTINCT FROM u."environmentId"
  OR NOT EXISTS(SELECT 1 FROM vamotors."AuditEntry" WHERE "commandId"=c.id AND "entityType"='Document' AND "entityId"=u.id)
  OR NOT EXISTS(SELECT 1 FROM vamotors."EntityReadVersion" WHERE "commandId"=c.id AND "entityType"='Document' AND "entityId"=u.id AND revision=u.revision)
  OR ((u.state='FINAL')<>(d.id IS NOT NULL))
  THEN RAISE EXCEPTION 'UPLOAD_EVIDENCE_REQUIRED' USING ERRCODE='23514'; END IF;
 IF u.state='INIT' AND (u."capturedTargetRevision"<>b.revision OR NOT EXISTS(SELECT 1 FROM vamotors."CommandReceipt" WHERE id=u."initCommandId" AND "commandName"='initUpload' AND "actorKey"='USER:'||u."createdBy"::text AND result=jsonb_build_object('type','UploadIntent','id',u.id,'revision',1))) THEN RAISE EXCEPTION 'INVALID_UPLOAD_TARGET' USING ERRCODE='23514'; END IF;
 IF u."currentAttemptId" IS NOT NULL AND (a.id IS NULL OR a."environmentId"<>u."environmentId" OR a."uploadId"<>u.id OR a."targetRevision"<>u."capturedTargetRevision" OR a.size<>u.size OR a.sha256<>u.sha256 OR a."contentType"<>u."contentType" OR a."claimedAt">u."expiresAt" OR a."finalKey" !~ ('^f\.'||u."environmentId"::text||'\.'||u.id::text||'\.'||a.id::text||'\.[a-f0-9-]{36}$')) THEN RAISE EXCEPTION 'INVALID_UPLOAD_CLAIM' USING ERRCODE='23514'; END IF;
 IF d.id IS NOT NULL AND (d."batchId"<>u."batchId" OR d."environmentId"<>u."environmentId" OR d."createdBy"<>u."createdBy" OR d.purpose<>u.purpose OR d.filename<>u.filename OR d.size<>a.size OR d.sha256<>a.sha256 OR d."contentType"<>a."contentType" OR d."attemptId"<>a.id OR d."finalKey"<>a."finalKey" OR d."commandId"<>a."commandId" OR b.revision<>u."capturedTargetRevision"+1 OR NOT EXISTS(SELECT 1 FROM vamotors."CommandReceipt" WHERE id=d."commandId" AND "commandName"='completeUpload' AND "actorKey"='USER:'||a."createdBy"::text AND "idempotencyKey"=a."idempotencyKey" AND "inputHash"=a."inputHash" AND result=jsonb_build_object('type','Document','id',d.id,'revision',1))) THEN RAISE EXCEPTION 'INVALID_FINAL_ATTACHMENT' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER import_graph AFTER INSERT OR UPDATE ON vamotors."ImportBatch" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vamotors.import_protocol_graph();
CREATE CONSTRAINT TRIGGER import_graph AFTER INSERT OR UPDATE ON vamotors."UploadIntent" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vamotors.import_protocol_graph();
CREATE CONSTRAINT TRIGGER import_graph AFTER INSERT ON vamotors."UploadAttempt" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vamotors.import_protocol_graph();
CREATE CONSTRAINT TRIGGER import_graph AFTER INSERT ON vamotors."Attachment" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vamotors.import_protocol_graph();
CREATE CONSTRAINT TRIGGER import_graph AFTER INSERT ON vamotors."UploadEvent" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vamotors.import_protocol_graph();

-- Append new immutable permissions only. No existing permission, assignment,
-- purchase ACL or delegated ceiling changes. The protected role alone gains them.
CREATE FUNCTION vamotors.import_migration_canonical(j jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE jsonb_typeof(j) WHEN 'object' THEN '{'||COALESCE((SELECT string_agg(to_jsonb(key)::text||':'||vamotors.import_migration_canonical(value),',' ORDER BY key COLLATE "C") FROM jsonb_each(j)),'')||'}' WHEN 'array' THEN '['||COALESCE((SELECT string_agg(vamotors.import_migration_canonical(value),',' ORDER BY n) FROM jsonb_array_elements(j) WITH ORDINALITY a(value,n)),'')||']' ELSE j::text END
$$;
ALTER TABLE vamotors."RolePermission" DISABLE TRIGGER protected_permissions;
ALTER TABLE vamotors."Role" DISABLE TRIGGER protected_role;
DO $$ DECLARE aid uuid; pid uuid; new_rule jsonb; kind text; operation text;
BEGIN
 -- No old rule/join/scope is replaced: unchanged v9 universes already freeze every
 -- wildcard/compound/create/delegation population, including accepted costs.
 -- Refuse corrupt hashes or unexpected preexisting T06b rules, rather than repair
 -- or widen an old nonadmin ceiling. Setup also revalidates every rule against v10.
 IF EXISTS(SELECT 1 FROM vamotors."Permission" WHERE "ruleHash" IS DISTINCT FROM encode(sha256(convert_to(vamotors.import_migration_canonical(rule),'UTF8')),'hex') OR rule->>'subject' IN ('ImportBatch','Document'))
 THEN RAISE EXCEPTION 'INVALID_PRIOR_PERMISSION' USING ERRCODE='23514'; END IF;
 SELECT id INTO aid FROM vamotors."Role" WHERE "systemKey"='ADMINISTRATOR';
 IF aid IS NOT NULL THEN
  FOREACH kind IN ARRAY ARRAY['ImportBatch','Document'] LOOP
   FOREACH operation IN ARRAY ARRAY['read','create','update'] LOOP
    new_rule:=jsonb_build_object('subject',kind,'action',operation,'fields',jsonb_build_array('*'));
    INSERT INTO vamotors."Permission"(id,"ruleHash",rule) VALUES(gen_random_uuid(),encode(sha256(convert_to(vamotors.import_migration_canonical(new_rule),'UTF8')),'hex'),new_rule) ON CONFLICT("ruleHash") DO NOTHING;
    SELECT id INTO pid FROM vamotors."Permission" WHERE "ruleHash"=encode(sha256(convert_to(vamotors.import_migration_canonical(new_rule),'UTF8')),'hex');
    INSERT INTO vamotors."RolePermission" VALUES(aid,pid) ON CONFLICT DO NOTHING;
   END LOOP;
  END LOOP;
  UPDATE vamotors."Role" SET revision=revision+1 WHERE id=aid;
 END IF;
END $$;
SET CONSTRAINTS ALL IMMEDIATE;
ALTER TABLE vamotors."Role" ENABLE TRIGGER protected_role;
ALTER TABLE vamotors."RolePermission" ENABLE TRIGGER protected_permissions;
DROP FUNCTION vamotors.import_migration_canonical(jsonb);
COMMIT;
