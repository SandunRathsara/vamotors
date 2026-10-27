BEGIN;
SELECT value FROM vamotors."BusinessSequence" WHERE id=1 FOR UPDATE;
SELECT vamotors.lock_admin_guard();

CREATE TABLE vamotors."SettingsVersion" (
 id uuid PRIMARY KEY, version integer NOT NULL UNIQUE CHECK (version>0),
 "effectiveAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 values jsonb NOT NULL CHECK (jsonb_typeof(values)='object')
);
CREATE TABLE vamotors."Settings" (
 id uuid PRIMARY KEY, singleton integer NOT NULL UNIQUE DEFAULT 1 CHECK(singleton=1),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 "currentVersionId" uuid NOT NULL UNIQUE REFERENCES vamotors."SettingsVersion"(id) ON DELETE RESTRICT
);
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON vamotors."SettingsVersion" FOR EACH STATEMENT EXECUTE FUNCTION vamotors.append_only();
CREATE FUNCTION vamotors.settings_currency_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE old_values jsonb;
BEGIN
 SELECT v.values INTO old_values FROM vamotors."Settings" s JOIN vamotors."SettingsVersion" v ON v.id=s."currentVersionId" WHERE s.singleton=1;
 IF old_values IS NOT NULL AND (NEW.values->'currency' IS DISTINCT FROM old_values->'currency' OR NEW.values->'scale' IS DISTINCT FROM old_values->'scale')
 AND (EXISTS(SELECT 1 FROM vamotors."PurchaseRecord") OR EXISTS(SELECT 1 FROM vamotors."Vehicle") OR EXISTS(SELECT 1 FROM vamotors."Customer") OR EXISTS(SELECT 1 FROM vamotors."Supplier") OR EXISTS(SELECT 1 FROM vamotors."RepairVendor") OR EXISTS(SELECT 1 FROM vamotors."FinanceCompany")) THEN
  RAISE EXCEPTION 'IMMUTABLE_CURRENCY' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER frozen_currency BEFORE INSERT ON vamotors."SettingsVersion" FOR EACH ROW EXECUTE FUNCTION vamotors.settings_currency_guard();

CREATE TABLE vamotors."FinanceCompany" (
 id uuid PRIMARY KEY, name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 200),
 active boolean NOT NULL DEFAULT true, revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 "createdBy" uuid NOT NULL REFERENCES vamotors."user"(id) ON DELETE RESTRICT,
 "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" timestamp(3) NOT NULL,
 "currentPolicyId" uuid NOT NULL UNIQUE,
 UNIQUE("currentPolicyId",id)
);
CREATE TABLE vamotors."FinancePolicyVersion" (
 id uuid PRIMARY KEY, "companyId" uuid NOT NULL REFERENCES vamotors."FinanceCompany"(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 version integer NOT NULL CHECK(version>0), "effectiveAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 values jsonb NOT NULL CHECK(jsonb_typeof(values)='object'),
 UNIQUE(id,"companyId"), UNIQUE("companyId",version)
);
-- The API validates the whole strict variant; storage independently rejects
-- malformed policy variants, rates and canonical M1 money even under direct DML.
CREATE FUNCTION vamotors.valid_finance_policy(p jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT COALESCE(
  jsonb_typeof(p)='object'
  AND p ?& ARRAY['path','commission','processingFee','reconciliationMethod']
  AND p-ARRAY['path','commission','processingFee','reconciliationMethod']='{}'::jsonb
  AND p->>'path' IN ('APPLICATION','REFERRAL')
  AND p->>'reconciliationMethod' IN ('PERIOD_NOTICE','PER_DEAL')
  AND jsonb_typeof(p->'processingFee')='string' AND p->>'processingFee' ~ '^(0|[1-9][0-9]{0,13})$'
  AND jsonb_typeof(p->'commission')='object'
  AND CASE WHEN jsonb_typeof(p#>'{commission,rateBps}')='number' THEN
    (p#>>'{commission,rateBps}')::numeric BETWEEN 0 AND 10000 AND trunc((p#>>'{commission,rateBps}')::numeric)=(p#>>'{commission,rateBps}')::numeric ELSE false END
  AND CASE p#>>'{commission,basis}'
    WHEN 'FIXED' THEN p->'commission' ?& ARRAY['basis','rateBps','fixed'] AND (p->'commission')-ARRAY['basis','rateBps','fixed']='{}'::jsonb AND jsonb_typeof(p#>'{commission,fixed}')='string' AND p#>>'{commission,fixed}' ~ '^(0|[1-9][0-9]{0,13})$'
    WHEN 'FINANCED_PRINCIPAL' THEN p->'commission' ?& ARRAY['basis','rateBps'] AND (p->'commission')-ARRAY['basis','rateBps']='{}'::jsonb
    ELSE false END,
  false)
$$;
ALTER TABLE vamotors."FinancePolicyVersion" ADD CONSTRAINT valid_policy CHECK(vamotors.valid_finance_policy(values));
ALTER TABLE vamotors."FinanceCompany" ADD FOREIGN KEY("currentPolicyId",id) REFERENCES vamotors."FinancePolicyVersion"(id,"companyId") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON vamotors."FinancePolicyVersion" FOR EACH STATEMENT EXECUTE FUNCTION vamotors.append_only();
CREATE TABLE vamotors."FinanceContact" (
 id uuid PRIMARY KEY, "companyId" uuid NOT NULL REFERENCES vamotors."FinanceCompany"(id) ON DELETE RESTRICT,
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 200), phone text NOT NULL CHECK(length(btrim(phone)) BETWEEN 3 AND 30),
 email text CHECK(email IS NULL OR length(email) BETWEEN 1 AND 254), role text NOT NULL CHECK(length(btrim(role)) BETWEEN 1 AND 200),
 "isPrimary" boolean NOT NULL DEFAULT false, active boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX "FinanceContact_primary" ON vamotors."FinanceContact"("companyId") WHERE active AND "isPrimary";
CREATE INDEX "FinanceContact_parent" ON vamotors."FinanceContact"("companyId");
CREATE INDEX "FinanceCompany_name" ON vamotors."FinanceCompany"(name,id);
CREATE TRIGGER retained_contact BEFORE UPDATE OR DELETE ON vamotors."FinanceContact" FOR EACH ROW EXECUTE FUNCTION vamotors.directory_contact_guard();
ALTER TABLE vamotors."EntityReadVersion" DROP CONSTRAINT "EntityReadVersion_entityType_check";
ALTER TABLE vamotors."EntityReadVersion" ADD CONSTRAINT "EntityReadVersion_entityType_check" CHECK("entityType" IN ('Vehicle','PurchaseRecord','Customer','Supplier','RepairVendor','FinanceCompany','Settings'));

-- Immutable permissions remain retained. Freeze the v3 universes, including
-- compound grants, before adding any contribution paths. No runtime bypass.
CREATE FUNCTION vamotors.detail_migration_canonical(j jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE jsonb_typeof(j)
 WHEN 'object' THEN '{'||COALESCE((SELECT string_agg(to_jsonb(key)::text||':'||vamotors.detail_migration_canonical(value),',' ORDER BY key COLLATE "C") FROM jsonb_each(j)),'')||'}'
 WHEN 'array' THEN '['||COALESCE((SELECT string_agg(vamotors.detail_migration_canonical(value),',' ORDER BY n) FROM jsonb_array_elements(j) WITH ORDINALITY a(value,n)),'')||']'
 ELSE j::text END
$$;
ALTER TABLE vamotors."RolePermission" DISABLE TRIGGER protected_permissions;
ALTER TABLE vamotors."Role" DISABLE TRIGGER protected_role;
DO $$
DECLARE old record; replacement jsonb; fields jsonb; universe text[]; pid uuid; admin_id uuid; new_rule jsonb; kind text; action text;
BEGIN
 FOR old IN SELECT rp."roleId",p.id,p.rule FROM vamotors."RolePermission" rp JOIN vamotors."Permission" p ON p.id=rp."permissionId" WHERE p.rule->>'subject' IN ('Supplier','RepairVendor') AND p.rule->>'action'='read' LOOP
  universe:=ARRAY['id','revision','type','name','active','contacts','provenance','directory.name','directory.category','directory.nicOrRegNumber','directory.address','directory.phone','directory.hotline','directory.recurring','directory.notes','directory.contacts'];
  IF old.rule->>'subject'='Supplier' THEN universe:=array_append(universe,'category'); ELSE universe:=array_append(universe,'directory.specialisation'); END IF;
  SELECT COALESCE(jsonb_agg(f ORDER BY f),'[]') INTO fields FROM unnest(universe) f WHERE EXISTS(SELECT 1 FROM jsonb_array_elements_text(old.rule->'fields') p WHERE p='*' OR f=p OR starts_with(f,p||'.'));
  replacement:=jsonb_set(old.rule,'{fields}',fields);
  INSERT INTO vamotors."Permission"(id,"ruleHash",rule) VALUES(gen_random_uuid(),encode(sha256(convert_to(vamotors.detail_migration_canonical(replacement),'UTF8')),'hex'),replacement) ON CONFLICT("ruleHash") DO NOTHING;
  SELECT id INTO pid FROM vamotors."Permission" WHERE "ruleHash"=encode(sha256(convert_to(vamotors.detail_migration_canonical(replacement),'UTF8')),'hex');
  DELETE FROM vamotors."RolePermission" WHERE "roleId"=old."roleId" AND "permissionId"=old.id;
  INSERT INTO vamotors."RolePermission" VALUES(old."roleId",pid) ON CONFLICT DO NOTHING;
 END LOOP;
 SELECT id INTO admin_id FROM vamotors."Role" WHERE "systemKey"='ADMINISTRATOR';
 IF admin_id IS NOT NULL THEN
  FOREACH kind IN ARRAY ARRAY['Supplier','RepairVendor','Settings','FinanceCompany'] LOOP
   FOREACH action IN ARRAY ARRAY['read','create','update','archive'] LOOP
    IF (kind IN ('Supplier','RepairVendor','Settings') AND action<>'read') THEN CONTINUE; END IF;
    new_rule:=jsonb_build_object('subject',kind,'action',action,'fields',jsonb_build_array('*'));
    INSERT INTO vamotors."Permission"(id,"ruleHash",rule) VALUES(gen_random_uuid(),encode(sha256(convert_to(vamotors.detail_migration_canonical(new_rule),'UTF8')),'hex'),new_rule) ON CONFLICT("ruleHash") DO NOTHING;
    SELECT id INTO pid FROM vamotors."Permission" WHERE "ruleHash"=encode(sha256(convert_to(vamotors.detail_migration_canonical(new_rule),'UTF8')),'hex');
    INSERT INTO vamotors."RolePermission" VALUES(admin_id,pid) ON CONFLICT DO NOTHING;
   END LOOP;
  END LOOP;
 END IF;
 UPDATE vamotors."Role" SET revision=revision+1;
END $$;
SET CONSTRAINTS ALL IMMEDIATE;
ALTER TABLE vamotors."Role" ENABLE TRIGGER protected_role;
ALTER TABLE vamotors."RolePermission" ENABLE TRIGGER protected_permissions;
DROP FUNCTION vamotors.detail_migration_canonical(jsonb);
COMMIT;
