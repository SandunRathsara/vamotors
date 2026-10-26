-- One-time registry expansion. Run only as migration owner. No runtime bypass.
-- Freeze OLD Customer read wildcard authority, then deliberately extend only
-- the protected Administrator. Immutable Permission rows are never rewritten.
BEGIN;
SELECT value FROM vamotors."BusinessSequence" WHERE id = 1 FOR UPDATE;
SELECT vamotors.lock_admin_guard();
CREATE FUNCTION vamotors.customer_migration_canonical(j jsonb) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE jsonb_typeof(j)
 WHEN 'object' THEN '{' || COALESCE((SELECT string_agg(to_jsonb(key)::text || ':' || vamotors.customer_migration_canonical(value), ',' ORDER BY key COLLATE "C") FROM jsonb_each(j)), '') || '}'
 WHEN 'array' THEN '[' || COALESCE((SELECT string_agg(vamotors.customer_migration_canonical(value), ',' ORDER BY n) FROM jsonb_array_elements(j) WITH ORDINALITY a(value,n)), '') || ']'
 ELSE j::text END
$$;
-- Trigger definitions/policy remain unchanged; this owner-only transactional
-- DDL window is necessary to replace protected stored grants on existing DBs.
ALTER TABLE vamotors."RolePermission" DISABLE TRIGGER protected_permissions;
ALTER TABLE vamotors."Role" DISABLE TRIGGER protected_role;
DO $$
DECLARE old record; replacement jsonb; pid uuid; admin_id uuid; new_rule jsonb; affected uuid[] := '{}';
BEGIN
 FOR old IN SELECT r.id AS role_id, p.id AS permission_id, p.rule
   FROM vamotors."Role" r JOIN vamotors."RolePermission" rp ON rp."roleId"=r.id
   JOIN vamotors."Permission" p ON p.id=rp."permissionId"
   WHERE p.rule->>'subject'='Customer' AND p.rule->>'action'='read'
     AND p.rule->'fields' @> '["*"]'::jsonb
 LOOP
   replacement := jsonb_set(old.rule, '{fields}', '["id","revision","fullName","callingName","nicOrPassport","address","phone","email","drivingLicence","notes","active"]');
   INSERT INTO vamotors."Permission" (id,"ruleHash",rule)
    VALUES (gen_random_uuid(),encode(sha256(convert_to(vamotors.customer_migration_canonical(replacement),'UTF8')),'hex'),replacement)
    ON CONFLICT ("ruleHash") DO NOTHING;
   SELECT id INTO pid FROM vamotors."Permission" WHERE "ruleHash"=encode(sha256(convert_to(vamotors.customer_migration_canonical(replacement),'UTF8')),'hex');
   DELETE FROM vamotors."RolePermission" WHERE "roleId"=old.role_id AND "permissionId"=old.permission_id;
   INSERT INTO vamotors."RolePermission" VALUES (old.role_id,pid) ON CONFLICT DO NOTHING;
   affected := array_append(affected,old.role_id);
 END LOOP;
 SELECT id INTO admin_id FROM vamotors."Role" WHERE "systemKey"='ADMINISTRATOR';
 IF admin_id IS NOT NULL THEN
  FOR new_rule IN SELECT value FROM jsonb_array_elements('[
   {"subject":"Customer","action":"read","fields":["provenance","links"]},
   {"subject":"Customer","action":"create","fields":["fullName","callingName","nicOrPassport","address","phone","email","drivingLicence","notes"]},
   {"subject":"Customer","action":"update","fields":["fullName","callingName","nicOrPassport","address","phone","email","drivingLicence","notes"]},
   {"subject":"Customer","action":"archive","fields":["active"]}]'::jsonb)
  LOOP
   SELECT id INTO pid FROM vamotors."Permission" WHERE "ruleHash"=encode(sha256(convert_to(vamotors.customer_migration_canonical(new_rule),'UTF8')),'hex');
   IF pid IS NULL THEN
    INSERT INTO vamotors."Permission" (id,"ruleHash",rule) VALUES (gen_random_uuid(),encode(sha256(convert_to(vamotors.customer_migration_canonical(new_rule),'UTF8')),'hex'),new_rule) RETURNING id INTO pid;
   END IF;
   INSERT INTO vamotors."RolePermission" VALUES (admin_id,pid) ON CONFLICT DO NOTHING;
  END LOOP;
 END IF;
 UPDATE vamotors."Role" SET revision=revision+1 WHERE id=admin_id OR id=ANY(affected);
END $$;
SET CONSTRAINTS ALL IMMEDIATE;
ALTER TABLE vamotors."Role" ENABLE TRIGGER protected_role;
ALTER TABLE vamotors."RolePermission" ENABLE TRIGGER protected_permissions;
DROP FUNCTION vamotors.customer_migration_canonical(jsonb);
COMMIT;
