BEGIN;
SELECT value FROM vamotors."BusinessSequence" WHERE id=1 FOR UPDATE;
SELECT vamotors.lock_admin_guard();

-- No existing subject/action field universe expands in v5: Settings.read and
-- every parent/compound read grant retain precisely their v4 coverage. New
-- Settings.update is a distinct action, never implied by any old wildcard.
-- Retain immutable permissions and delegated ceilings without rewriting them.
ALTER TABLE vamotors."RolePermission" DISABLE TRIGGER protected_permissions;
ALTER TABLE vamotors."Role" DISABLE TRIGGER protected_role;
DO $$
DECLARE new_rule jsonb; pid uuid; admin_id uuid;
BEGIN
 SELECT id INTO admin_id FROM vamotors."Role" WHERE "systemKey"='ADMINISTRATOR';
 IF admin_id IS NOT NULL THEN
  new_rule:='{"action":"update","fields":["company.name","company.identity","company.address","company.phone","company.email","declarations","currency","scale","timezone","tiers","warningLeadDays","processingFee","dateFormat","itemsPerPage","theme"],"subject":"Settings"}'::jsonb;
  -- The canonical digest sorts object keys and preserves array order, exactly
  -- matching the existing owner tooling's canonical(rule).
  INSERT INTO vamotors."Permission"(id,"ruleHash",rule)
  VALUES(gen_random_uuid(),encode(sha256(convert_to('{"action":"update","fields":["company.name","company.identity","company.address","company.phone","company.email","declarations","currency","scale","timezone","tiers","warningLeadDays","processingFee","dateFormat","itemsPerPage","theme"],"subject":"Settings"}','UTF8')),'hex'),new_rule)
  ON CONFLICT("ruleHash") DO NOTHING;
  SELECT id INTO pid FROM vamotors."Permission" p WHERE p.rule=new_rule;
  INSERT INTO vamotors."RolePermission" VALUES(admin_id,pid) ON CONFLICT DO NOTHING;
  UPDATE vamotors."Role" SET revision=revision+1 WHERE id=admin_id;
 END IF;
END $$;
SET CONSTRAINTS ALL IMMEDIATE;
ALTER TABLE vamotors."Role" ENABLE TRIGGER protected_role;
ALTER TABLE vamotors."RolePermission" ENABLE TRIGGER protected_permissions;
COMMIT;
