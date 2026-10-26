-- No role creation/grants here: T02b is the sole role writer.
INSERT INTO vamotors."AdminGuard" (id) VALUES (1);
INSERT INTO vamotors."BusinessSequence" (id, value) VALUES (1, 0);
ALTER TABLE vamotors."AdminGuard" ADD CHECK (id = 1 AND generation >= 0);
ALTER TABLE vamotors."BusinessSequence" ADD CHECK (id = 1 AND value >= 0);
ALTER TABLE vamotors."Environment" ADD CHECK (singleton = 1),
  ADD CHECK (name IN ('local','disposable-test','shared-dev','preview')),
  ADD CHECK (NOT "disposableTest" OR name = 'disposable-test'),
  ADD CHECK (("bootstrapTokenHash" IS NULL) = ("bootstrapExpiresAt" IS NULL));
ALTER TABLE vamotors."user" ADD CHECK (email = lower(btrim(email)) AND length(email) <= 254),
  ADD CHECK ("authzRevision" > 0);
ALTER TABLE vamotors."Role" ADD CHECK (revision > 0),
  ADD CHECK ("systemKey" IS NULL OR "systemKey" = 'ADMINISTRATOR');

-- Runtime needs EXECUTE, not UPDATE authority over the guard singleton.
CREATE FUNCTION vamotors.lock_admin_guard() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  -- A row lock alone does not refresh a SERIALIZABLE transaction's earlier
  -- snapshot. Updating a generation forces stale waiters to abort/retry before
  -- they may authorize using grants or sessions revoked by the prior holder.
  UPDATE vamotors."AdminGuard" SET generation = generation + 1 WHERE id = 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'ENVIRONMENT_UNAVAILABLE'; END IF;
  RETURN 1;
END $$;
REVOKE ALL ON FUNCTION vamotors.lock_admin_guard() FROM PUBLIC;

CREATE FUNCTION vamotors.lock_auth_mutation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  PERFORM vamotors.lock_admin_guard();
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION vamotors.lock_auth_mutation() FROM PUBLIC;
CREATE TRIGGER auth_guard BEFORE INSERT OR UPDATE OR DELETE ON vamotors."user"
  FOR EACH STATEMENT EXECUTE FUNCTION vamotors.lock_auth_mutation();
CREATE TRIGGER auth_guard BEFORE INSERT OR UPDATE OR DELETE ON vamotors."session"
  FOR EACH STATEMENT EXECUTE FUNCTION vamotors.lock_auth_mutation();
CREATE TRIGGER auth_guard BEFORE INSERT OR UPDATE OR DELETE ON vamotors."UserRole"
  FOR EACH STATEMENT EXECUTE FUNCTION vamotors.lock_auth_mutation();
CREATE TRIGGER auth_guard BEFORE INSERT OR UPDATE OR DELETE ON vamotors."Role"
  FOR EACH STATEMENT EXECUTE FUNCTION vamotors.lock_auth_mutation();
CREATE TRIGGER auth_guard BEFORE INSERT OR UPDATE OR DELETE ON vamotors."RolePermission"
  FOR EACH STATEMENT EXECUTE FUNCTION vamotors.lock_auth_mutation();

CREATE FUNCTION vamotors.protect_system_role() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP <> 'INSERT' AND OLD."systemKey" IS NOT NULL THEN
    RAISE EXCEPTION 'SYSTEM_ROLE_PROTECTED';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."systemKey" IS DISTINCT FROM OLD."systemKey" THEN
    RAISE EXCEPTION 'SYSTEM_ROLE_PROTECTED';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER protected_role BEFORE UPDATE OR DELETE ON vamotors."Role"
  FOR EACH ROW EXECUTE FUNCTION vamotors.protect_system_role();

CREATE FUNCTION vamotors.protect_admin_permissions() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE rid uuid;
BEGIN
  rid := CASE WHEN TG_OP = 'DELETE' THEN OLD."roleId" ELSE NEW."roleId" END;
  IF EXISTS (SELECT 1 FROM vamotors."Environment" WHERE "bootstrappedAt" IS NOT NULL)
     AND (EXISTS (SELECT 1 FROM vamotors."Role" WHERE id = rid AND "systemKey" = 'ADMINISTRATOR')
       OR (TG_OP = 'UPDATE' AND EXISTS (SELECT 1 FROM vamotors."Role" WHERE id = OLD."roleId" AND "systemKey" = 'ADMINISTRATOR'))) THEN
    RAISE EXCEPTION 'SYSTEM_ROLE_PROTECTED';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER protected_permissions BEFORE INSERT OR UPDATE OR DELETE ON vamotors."RolePermission"
  FOR EACH ROW EXECUTE FUNCTION vamotors.protect_admin_permissions();

CREATE FUNCTION vamotors.require_active_admin() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  PERFORM vamotors.lock_admin_guard();
  IF EXISTS (SELECT 1 FROM vamotors."Environment" WHERE "bootstrappedAt" IS NOT NULL)
    AND NOT EXISTS (SELECT 1 FROM vamotors."user" u
      JOIN vamotors."UserRole" ur ON ur."userId" = u.id
      JOIN vamotors."Role" r ON r.id = ur."roleId"
      WHERE u.active AND r.active AND r."systemKey" = 'ADMINISTRATOR') THEN
    RAISE EXCEPTION 'LAST_ADMIN';
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION vamotors.require_active_admin() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER last_admin AFTER INSERT OR UPDATE OR DELETE ON vamotors."user"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vamotors.require_active_admin();
CREATE CONSTRAINT TRIGGER last_admin AFTER INSERT OR UPDATE OR DELETE ON vamotors."UserRole"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vamotors.require_active_admin();
CREATE CONSTRAINT TRIGGER last_admin AFTER INSERT OR UPDATE OR DELETE ON vamotors."Role"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vamotors.require_active_admin();

CREATE FUNCTION vamotors.append_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN RAISE EXCEPTION 'APPEND_ONLY'; END $$;
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON vamotors."AuditEntry"
  FOR EACH STATEMENT EXECUTE FUNCTION vamotors.append_only();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON vamotors."CommandReceipt"
  FOR EACH STATEMENT EXECUTE FUNCTION vamotors.append_only();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON vamotors."EntityReadVersion"
  FOR EACH STATEMENT EXECUTE FUNCTION vamotors.append_only();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON vamotors."StatusEvent"
  FOR EACH STATEMENT EXECUTE FUNCTION vamotors.append_only();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON vamotors."Permission"
  FOR EACH STATEMENT EXECUTE FUNCTION vamotors.append_only();
ALTER TABLE vamotors."CommandReceipt" ADD CONSTRAINT receipt_environment
  FOREIGN KEY ("environmentId") REFERENCES vamotors."Environment" (id) ON DELETE RESTRICT;
ALTER TABLE vamotors."CommandReceipt" ADD CHECK ("responseSchemaVersion" = 1),
  ADD CHECK ("businessSequence" IS NULL OR "businessSequence" > 0);
ALTER TABLE vamotors."EntityReadVersion" ADD CHECK (revision > 0 AND sequence > 0),
  ADD CHECK ("entityType" IN ('Vehicle','PurchaseRecord','Customer','Supplier'));
ALTER TABLE vamotors."AuditEntry"
  ADD FOREIGN KEY ("userId") REFERENCES vamotors."user" (id) ON DELETE RESTRICT,
  ADD FOREIGN KEY ("initiatedBy") REFERENCES vamotors."user" (id) ON DELETE RESTRICT,
  ADD FOREIGN KEY ("approverId") REFERENCES vamotors."user" (id) ON DELETE RESTRICT,
  ADD CHECK (("actorKind" = 'USER' AND "userId" IS NOT NULL AND "systemScope" IS NULL)
    OR ("actorKind" = 'SYSTEM' AND "userId" IS NULL AND "systemScope" = 'RESERVATION_EXPIRY')
    OR ("actorKind" = 'IMPORT' AND "userId" IS NULL AND "initiatedBy" IS NOT NULL));
ALTER TABLE vamotors."Notification" ADD CHECK (revision > 0),
  ADD CHECK (kind IN ('ADVANCE_EXPIRING','ADVANCE_EXPIRED','REPAIR_RETURNED','APPROVAL_REQUIRED','APPROVAL_OUTCOME'));

CREATE UNIQUE INDEX supplier_primary ON vamotors."SupplierContact" ("supplierId") WHERE "isPrimary" AND active;
ALTER TABLE vamotors."Supplier" ADD CHECK (category IN ('INDIVIDUAL','COMPANY')), ADD CHECK (revision > 0);
ALTER TABLE vamotors."Customer" ADD CHECK (revision > 0),
  ADD CHECK ("normalizedIdentity" = upper(regexp_replace("nicOrPassport", '[\t\n\r\f\v ]', '', 'g')) AND length("normalizedIdentity") BETWEEN 1 AND 100);
ALTER TABLE vamotors."Vehicle"
  ADD CHECK (revision > 0), ADD CHECK (year >= 1886 AND year <= extract(year FROM CURRENT_DATE)::integer + 1),
  ADD CHECK ("fuelType" IN ('PETROL','DIESEL','HYBRID','ELECTRIC','OTHER')),
  ADD CHECK (transmission IN ('MANUAL','AUTOMATIC','CVT','OTHER')),
  ADD CHECK ("normalizedEngine" = upper(regexp_replace("engineNumber", '[\t\n\r\f\v ]', '', 'g')) AND length("normalizedEngine") BETWEEN 1 AND 100),
  ADD CHECK ("normalizedChassis" = upper(regexp_replace("chassisNumber", '[\t\n\r\f\v ]', '', 'g')) AND length("normalizedChassis") BETWEEN 1 AND 100);
ALTER TABLE vamotors."Vehicle" ALTER CONSTRAINT "Vehicle_activePurchaseId_id_fkey" DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE vamotors."PurchaseRecord" ALTER CONSTRAINT "PurchaseRecord_vehicleId_fkey" DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE vamotors."PurchaseRecord"
  ADD CHECK (revision > 0 AND "cycleNumber" > 0),
  ADD CHECK ("purchaseType" IN ('CASH','LEASE_SETTLEMENT','BRAND_NEW')),
  ADD CHECK (("acquisitionKind" = 'SUPPLIER' AND "supplierId" IS NOT NULL AND "sellerCustomerId" IS NULL)
    OR ("acquisitionKind" = 'TRADE_IN' AND "supplierId" IS NULL AND "sellerCustomerId" IS NOT NULL)),
  ADD CHECK ("purchasePrice" BETWEEN 0 AND 99999999999999),
  ADD CHECK ("listedPrice" IS NULL OR "listedPrice" BETWEEN 0 AND 99999999999999),
  ADD CHECK (NOT available OR status = 'IN_STOCK'),
  ADD CHECK (status <> 'IN_STOCK' OR ("receivedDate" IS NOT NULL AND "receivedDate" >= "purchaseDate")),
  ADD CHECK (status <> 'IN_STOCK' OR available OR length(btrim(coalesce("holdReason", ''))) > 0),
  -- Fail closed until completion/disposal/import/repair/settlement evidence tables ship.
  ADD CONSTRAINT initial_cycle_capability CHECK (status IN ('PURCHASED','IN_STOCK') AND "closedAt" IS NULL AND "purchaseType" <> 'LEASE_SETTLEMENT' AND "acquisitionKind" = 'SUPPLIER');
CREATE UNIQUE INDEX one_open_cycle ON vamotors."PurchaseRecord" ("vehicleId") WHERE "closedAt" IS NULL;

CREATE FUNCTION vamotors.check_cycle_pointer() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM vamotors."Vehicle" v
    LEFT JOIN vamotors."PurchaseRecord" p ON p.id = v."activePurchaseId" AND p."vehicleId" = v.id
    WHERE (v."activePurchaseId" IS NOT NULL AND (p.id IS NULL OR p."closedAt" IS NOT NULL))
      OR EXISTS (SELECT 1 FROM vamotors."PurchaseRecord" o WHERE o."vehicleId" = v.id AND o."closedAt" IS NULL AND o.id IS DISTINCT FROM v."activePurchaseId")) THEN
    RAISE EXCEPTION 'INVALID_CYCLE_POINTER';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER cycle_pointer AFTER INSERT OR UPDATE ON vamotors."Vehicle"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vamotors.check_cycle_pointer();
CREATE CONSTRAINT TRIGGER cycle_pointer AFTER INSERT OR UPDATE OR DELETE ON vamotors."PurchaseRecord"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vamotors.check_cycle_pointer();

CREATE FUNCTION vamotors.initial_cycle_transition() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status <> 'PURCHASED' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  IF NEW."purchaseType" = 'BRAND_NEW' AND NOT EXISTS (SELECT 1 FROM vamotors."Supplier" WHERE id = NEW."supplierId" AND category = 'COMPANY') THEN
    RAISE EXCEPTION 'INVALID_STATE';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status
    AND NOT (OLD.status = 'PURCHASED' AND NEW.status = 'IN_STOCK' AND NEW."receivedDate" IS NOT NULL) THEN
    RAISE EXCEPTION 'INVALID_STATE';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER initial_transition BEFORE INSERT OR UPDATE ON vamotors."PurchaseRecord"
  FOR EACH ROW EXECUTE FUNCTION vamotors.initial_cycle_transition();

-- Only append matching version evidence to a committed-prefix receipt.
CREATE FUNCTION vamotors.check_version_sequence() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vamotors."CommandReceipt" c WHERE c.id = NEW."commandId" AND c."businessSequence" = NEW.sequence) THEN
    RAISE EXCEPTION 'INVALID_BUSINESS_SEQUENCE';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER source_sequence BEFORE INSERT ON vamotors."EntityReadVersion"
  FOR EACH ROW EXECUTE FUNCTION vamotors.check_version_sequence();

ALTER TABLE vamotors."Customer" ADD FOREIGN KEY ("createdBy") REFERENCES vamotors."user" (id) ON DELETE RESTRICT;
ALTER TABLE vamotors."Supplier" ADD FOREIGN KEY ("createdBy") REFERENCES vamotors."user" (id) ON DELETE RESTRICT;
ALTER TABLE vamotors."Vehicle" ADD FOREIGN KEY ("createdBy") REFERENCES vamotors."user" (id) ON DELETE RESTRICT;
ALTER TABLE vamotors."PurchaseRecord" ADD FOREIGN KEY ("createdBy") REFERENCES vamotors."user" (id) ON DELETE RESTRICT;
ALTER TABLE vamotors."StatusEvent" ADD FOREIGN KEY ("userId") REFERENCES vamotors."user" (id) ON DELETE RESTRICT;
