-- PurchaseRecord was not grantable in the old registry. Deliberately enable
-- only existing-link read fields for Administrator; no delegate gains a rule.
BEGIN;
SELECT value FROM vamotors."BusinessSequence" WHERE id=1 FOR UPDATE;
SELECT vamotors.lock_admin_guard();
ALTER TABLE vamotors."RolePermission" DISABLE TRIGGER protected_permissions;
ALTER TABLE vamotors."Role" DISABLE TRIGGER protected_role;
DO $$
DECLARE rid uuid; pid uuid;
BEGIN
 SELECT id INTO rid FROM vamotors."Role" WHERE "systemKey"='ADMINISTRATOR';
 IF rid IS NOT NULL THEN
  INSERT INTO vamotors."Permission" (id,"ruleHash",rule) VALUES
   (gen_random_uuid(),encode(sha256(convert_to('{"action":"read","fields":["id","purchaseDate","status","purchasePrice"],"subject":"PurchaseRecord"}','UTF8')),'hex'),
    '{"action":"read","fields":["id","purchaseDate","status","purchasePrice"],"subject":"PurchaseRecord"}') ON CONFLICT ("ruleHash") DO NOTHING;
  SELECT id INTO pid FROM vamotors."Permission" WHERE "ruleHash"=encode(sha256(convert_to('{"action":"read","fields":["id","purchaseDate","status","purchasePrice"],"subject":"PurchaseRecord"}','UTF8')),'hex');
  INSERT INTO vamotors."RolePermission" VALUES (rid,pid) ON CONFLICT DO NOTHING;
  UPDATE vamotors."Role" SET revision=revision+1 WHERE id=rid;
 END IF;
END $$;
SET CONSTRAINTS ALL IMMEDIATE;
ALTER TABLE vamotors."Role" ENABLE TRIGGER protected_role;
ALTER TABLE vamotors."RolePermission" ENABLE TRIGGER protected_permissions;
COMMIT;
