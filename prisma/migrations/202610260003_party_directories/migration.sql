BEGIN;
SELECT value FROM vamotors."BusinessSequence" WHERE id=1 FOR UPDATE;
SELECT vamotors.lock_admin_guard();
ALTER TABLE vamotors."EntityReadVersion" DROP CONSTRAINT "EntityReadVersion_entityType_check";
ALTER TABLE vamotors."EntityReadVersion" ADD CONSTRAINT "EntityReadVersion_entityType_check" CHECK ("entityType" IN ('Vehicle','PurchaseRecord','Customer','Supplier','RepairVendor'));

CREATE TABLE vamotors."RepairVendor" (
 id uuid PRIMARY KEY, name text NOT NULL, category text NOT NULL,
 "nicOrRegNumber" text, address text, phone text, hotline text, notes text,
 recurring boolean NOT NULL DEFAULT false, specialisation text,
 active boolean NOT NULL DEFAULT true, revision integer NOT NULL DEFAULT 1 CHECK (revision>0),
 "createdBy" uuid NOT NULL REFERENCES vamotors."user"(id) ON DELETE RESTRICT,
 "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" timestamp(3) NOT NULL,
 CONSTRAINT "RepairVendor_category" CHECK (category IN ('INDIVIDUAL','COMPANY')),
 CONSTRAINT "RepairVendor_name" CHECK (length(btrim(name)) BETWEEN 1 AND 200)
);
CREATE TABLE vamotors."VendorContact" (
 id uuid PRIMARY KEY, "vendorId" uuid NOT NULL REFERENCES vamotors."RepairVendor"(id) ON DELETE RESTRICT,
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
 phone text NOT NULL CHECK (length(btrim(phone)) BETWEEN 3 AND 30),
 email text, role text NOT NULL CHECK (length(btrim(role)) BETWEEN 1 AND 200),
 "isPrimary" boolean NOT NULL DEFAULT false, active boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX "VendorContact_primary" ON vamotors."VendorContact"("vendorId") WHERE active AND "isPrimary";
CREATE INDEX "VendorContact_parent" ON vamotors."VendorContact"("vendorId");
CREATE INDEX "SupplierContact_parent" ON vamotors."SupplierContact"("supplierId");
CREATE INDEX "Supplier_name" ON vamotors."Supplier"(name,id);
CREATE INDEX "RepairVendor_name" ON vamotors."RepairVendor"(name,id);

-- Contact identities/content remain immutable even if accidental grants expand.
CREATE FUNCTION vamotors.directory_contact_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-'active') IS DISTINCT FROM (to_jsonb(OLD)-'active') THEN
  RAISE EXCEPTION 'IMMUTABLE_DIRECTORY_CONTACT' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER retained_contact BEFORE UPDATE OR DELETE ON vamotors."SupplierContact" FOR EACH ROW EXECUTE FUNCTION vamotors.directory_contact_guard();
CREATE TRIGGER retained_contact BEFORE UPDATE OR DELETE ON vamotors."VendorContact" FOR EACH ROW EXECUTE FUNCTION vamotors.directory_contact_guard();

-- One-time owner window. Old permissions are never rewritten. Freeze wildcard
-- and parent-field coverage against registry v2 before adding any new paths.
CREATE FUNCTION vamotors.party_migration_canonical(j jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE jsonb_typeof(j)
 WHEN 'object' THEN '{'||COALESCE((SELECT string_agg(to_jsonb(key)::text||':'||vamotors.party_migration_canonical(value),',' ORDER BY key COLLATE "C") FROM jsonb_each(j)),'')||'}'
 WHEN 'array' THEN '['||COALESCE((SELECT string_agg(vamotors.party_migration_canonical(value),',' ORDER BY n) FROM jsonb_array_elements(j) WITH ORDINALITY a(value,n)),'')||']'
 ELSE j::text END
$$;
ALTER TABLE vamotors."RolePermission" DISABLE TRIGGER protected_permissions;
ALTER TABLE vamotors."Role" DISABLE TRIGGER protected_role;
DO $$
DECLARE old record; replacement jsonb; fields jsonb; pid uuid; admin_id uuid; new_rule jsonb; action text; kind text;
BEGIN
 FOR old IN SELECT rp."roleId",p.id,p.rule FROM vamotors."RolePermission" rp JOIN vamotors."Permission" p ON p.id=rp."permissionId" WHERE p.rule->>'subject'='Supplier' AND p.rule->>'action'='read' LOOP
  SELECT COALESCE(jsonb_agg(f ORDER BY f),'[]') INTO fields
  FROM unnest(ARRAY['id','revision','name','category','active','contacts']) f
  WHERE EXISTS (SELECT 1 FROM jsonb_array_elements_text(old.rule->'fields') p WHERE p='*' OR f=p OR starts_with(f,p||'.'));
  replacement:=jsonb_set(old.rule,'{fields}',fields);
  INSERT INTO vamotors."Permission"(id,"ruleHash",rule) VALUES(gen_random_uuid(),encode(sha256(convert_to(vamotors.party_migration_canonical(replacement),'UTF8')),'hex'),replacement) ON CONFLICT("ruleHash") DO NOTHING;
  SELECT id INTO pid FROM vamotors."Permission" WHERE "ruleHash"=encode(sha256(convert_to(vamotors.party_migration_canonical(replacement),'UTF8')),'hex');
  DELETE FROM vamotors."RolePermission" WHERE "roleId"=old."roleId" AND "permissionId"=old.id;
  INSERT INTO vamotors."RolePermission" VALUES(old."roleId",pid) ON CONFLICT DO NOTHING;
 END LOOP;
 SELECT id INTO admin_id FROM vamotors."Role" WHERE "systemKey"='ADMINISTRATOR';
 IF admin_id IS NOT NULL THEN
  FOREACH kind IN ARRAY ARRAY['Supplier','RepairVendor'] LOOP
   FOREACH action IN ARRAY ARRAY['read','create','update','archive'] LOOP
    -- Protected Administrator alone deliberately receives the expanded universe.
    new_rule:=jsonb_build_object('subject',kind,'action',action,'fields',jsonb_build_array('*'));
    INSERT INTO vamotors."Permission"(id,"ruleHash",rule) VALUES(gen_random_uuid(),encode(sha256(convert_to(vamotors.party_migration_canonical(new_rule),'UTF8')),'hex'),new_rule) ON CONFLICT("ruleHash") DO NOTHING;
    SELECT id INTO pid FROM vamotors."Permission" WHERE "ruleHash"=encode(sha256(convert_to(vamotors.party_migration_canonical(new_rule),'UTF8')),'hex');
    INSERT INTO vamotors."RolePermission" VALUES(admin_id,pid) ON CONFLICT DO NOTHING;
   END LOOP;
  END LOOP;
 END IF;
 UPDATE vamotors."Role" SET revision=revision+1;
END $$;
SET CONSTRAINTS ALL IMMEDIATE;
ALTER TABLE vamotors."Role" ENABLE TRIGGER protected_role;
ALTER TABLE vamotors."RolePermission" ENABLE TRIGGER protected_permissions;
DROP FUNCTION vamotors.party_migration_canonical(jsonb);
COMMIT;
