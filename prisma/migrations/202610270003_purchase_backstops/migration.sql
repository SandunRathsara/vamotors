BEGIN;
SELECT value FROM vamotors."BusinessSequence" WHERE id=1 FOR UPDATE;
SELECT vamotors.lock_admin_guard();
ALTER TABLE vamotors."Vehicle"
 ADD CONSTRAINT physical_required CHECK(length(btrim(make)) BETWEEN 1 AND 200 AND length(btrim(model)) BETWEEN 1 AND 200 AND length(btrim(colour)) BETWEEN 1 AND 200) NOT VALID,
 ADD CONSTRAINT physical_optional CHECK((vin IS NULL OR length(btrim(vin)) BETWEEN 1 AND 100) AND ("crNumber" IS NULL OR length(btrim("crNumber")) BETWEEN 1 AND 100) AND (notes IS NULL OR length(btrim(notes)) BETWEEN 1 AND 2000)) NOT VALID;
-- NOT VALID preserves preexisting foundation fixtures; both checks are enforced
-- for every new or changed row. No grandfathering path is granted to runtime.
CREATE FUNCTION vamotors.purchase_vehicle_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='INSERT' AND current_user='vamotors_runtime' AND NEW."activePurchaseId" IS NULL THEN RAISE EXCEPTION 'ACQUISITION_EVIDENCE_REQUIRED' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (NEW."createdBy" IS DISTINCT FROM OLD."createdBy" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt") THEN RAISE EXCEPTION 'IMMUTABLE_OWNER' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM vamotors."PurchaseRecord" p WHERE p."vehicleId"=OLD.id AND p."acquisitionCommandId" IS NOT NULL) THEN RAISE EXCEPTION 'IMMUTABLE_ACQUISITION' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER acquisition_vehicle BEFORE INSERT OR UPDATE ON vamotors."Vehicle" FOR EACH ROW EXECUTE FUNCTION vamotors.purchase_vehicle_guard();
CREATE FUNCTION vamotors.purchase_status_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE p vamotors."PurchaseRecord";
BEGIN
 SELECT * INTO p FROM vamotors."PurchaseRecord" WHERE id=NEW."cycleId";
 IF p."acquisitionCommandId" IS NOT NULL AND (NEW."commandId"<>p."acquisitionCommandId" OR NEW."from" IS NOT NULL OR NEW."to"<>'PURCHASED' OR NEW.action<>'recordPurchase' OR NEW."userId"<>p."createdBy" OR NEW."occurredAt"<>p."purchaseDate"::timestamp OR EXISTS(SELECT 1 FROM vamotors."StatusEvent" s WHERE s."cycleId"=p.id)) THEN RAISE EXCEPTION 'INVALID_ACQUISITION_STATUS' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER acquisition_status BEFORE INSERT ON vamotors."StatusEvent" FOR EACH ROW EXECUTE FUNCTION vamotors.purchase_status_guard();
COMMIT;
