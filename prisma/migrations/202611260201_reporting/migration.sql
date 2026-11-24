BEGIN;
CREATE INDEX "PurchaseRecord_purchaseDate_id_idx" ON vamotors."PurchaseRecord" ("purchaseDate", "id");
CREATE INDEX "Disposal_occurredDate_id_idx" ON vamotors."Disposal" ("occurredDate", "id");
CREATE INDEX "SaleCompletion_saleDate_id_idx" ON vamotors."SaleCompletion" ("saleDate", "id");
CREATE INDEX "RepairRecord_returnedDate_sentDate_id_idx" ON vamotors."RepairRecord" ("returnedDate", "sentDate", "id");
CREATE INDEX "PurchasePayment_occurredDate_id_idx" ON vamotors."PurchasePayment" ("occurredDate", "id");
CREATE INDEX "CostPayment_occurredDate_id_idx" ON vamotors."CostPayment" ("occurredDate", "id");
CREATE INDEX "DisposalReceipt_occurredDate_id_idx" ON vamotors."DisposalReceipt" ("occurredDate", "id");
CREATE INDEX "RepairPayment_occurredDate_id_idx" ON vamotors."RepairPayment" ("occurredDate", "id");
CREATE INDEX "SaleReceipt_occurredDate_id_idx" ON vamotors."SaleReceipt" ("occurredDate", "id");
CREATE INDEX "FacilityPayment_occurredDate_id_idx" ON vamotors."FacilityPayment" ("occurredDate", "id");
CREATE INDEX "BrokerageFeeReceipt_occurredDate_id_idx" ON vamotors."BrokerageFeeReceipt" ("occurredDate", "id");
CREATE INDEX "SaleCorrection_effective_sale_date_idx"
  ON vamotors."SaleCorrection" (("correctedSnapshot"->>'saleDate'));

-- Fresh bootstrap already derives its grants from the application registry.
-- Extend the protected role on upgrades without granting reports to other roles.
SELECT vamotors.lock_admin_guard();
DO $$
DECLARE
  admin_id uuid;
  permissions_guard text;
  role_guard text;
  rule_value jsonb;
  hash_value text;
BEGIN
  SELECT id INTO admin_id FROM vamotors."Role" WHERE "systemKey" = 'ADMINISTRATOR';
  IF admin_id IS NULL THEN RETURN; END IF;

  SELECT pg_get_functiondef('vamotors.protect_admin_permissions()'::regprocedure) INTO permissions_guard;
  SELECT pg_get_functiondef('vamotors.protect_system_role()'::regprocedure) INTO role_guard;
  EXECUTE replace(permissions_guard, 'BEGIN', E'BEGIN
 IF current_user = ''vamotors_migrator'' AND TG_OP = ''INSERT'' THEN RETURN NEW; END IF;');
  EXECUTE replace(role_guard, 'BEGIN', E'BEGIN
 IF current_user = ''vamotors_migrator'' AND TG_OP = ''UPDATE'' AND NEW.revision = OLD.revision + 1 AND (to_jsonb(NEW) - ''revision'') = (to_jsonb(OLD) - ''revision'') THEN RETURN NEW; END IF;');

  FOR rule_value IN SELECT value FROM jsonb_array_elements('[
    {"subject":"Report","action":"read","fields":["*"]},
    {"subject":"Report","action":"export","fields":["*"]}
  ]'::jsonb) LOOP
    hash_value := encode(sha256(convert_to(vamotors.sale_canonical(rule_value), 'UTF8')), 'hex');
    INSERT INTO vamotors."Permission" (id, "ruleHash", rule)
      VALUES (gen_random_uuid(), hash_value, rule_value) ON CONFLICT ("ruleHash") DO NOTHING;
    INSERT INTO vamotors."RolePermission" ("roleId", "permissionId")
      SELECT admin_id, id FROM vamotors."Permission" WHERE "ruleHash" = hash_value ON CONFLICT DO NOTHING;
  END LOOP;
  UPDATE vamotors."Role" SET revision = revision + 1 WHERE id = admin_id;

  EXECUTE permissions_guard;
  EXECUTE role_guard;
END $$;
COMMIT;
