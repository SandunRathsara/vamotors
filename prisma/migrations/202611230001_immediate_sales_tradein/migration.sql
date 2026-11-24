BEGIN;

-- 1. Existing table schema extensions
ALTER TABLE vamotors."PurchaseRecord"
  ADD COLUMN "tradeInSourceSaleId" uuid,
  ADD CONSTRAINT "PurchaseRecord_tradeInSourceSaleId_key" UNIQUE ("tradeInSourceSaleId"),
  ADD CONSTRAINT "PurchaseRecord_tradeInSourceSaleId_sellerCustomerId_key" UNIQUE ("tradeInSourceSaleId", "sellerCustomerId");

ALTER TABLE vamotors."PurchaseRecord"
  DROP CONSTRAINT initial_cycle_capability,
  ADD CONSTRAINT initial_cycle_capability CHECK (
    (
      (status IN ('PURCHASED', 'IN_STOCK', 'IN_REPAIR') AND "closedAt" IS NULL)
      OR (status IN ('WRITTEN_OFF', 'SOLD') AND "closedAt" IS NOT NULL AND NOT available)
    )
    AND "purchaseType" IN ('CASH', 'BRAND_NEW', 'LEASE_SETTLEMENT')
    AND (
      ("acquisitionKind" = 'SUPPLIER' AND "tradeInSourceSaleId" IS NULL)
      OR ("acquisitionKind" = 'TRADE_IN' AND "tradeInSourceSaleId" IS NOT NULL AND "purchaseType" = 'CASH')
    )
  );

ALTER TABLE vamotors."MileageReading"
  ADD COLUMN "sourceSaleCompletionId" uuid,
  ADD CONSTRAINT "MileageReading_sourceSaleCompletionId_key" UNIQUE ("sourceSaleCompletionId"),
  ADD CONSTRAINT "MileageReading_sourceSaleCompletionId_cycleId_key" UNIQUE ("sourceSaleCompletionId", "cycleId");

DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'vamotors."ApprovalRequest"'::regclass
      AND contype = 'c'
      AND (pg_get_constraintdef(oid) LIKE '%WRITE_OFF%' OR pg_get_constraintdef(oid) LIKE '%jsonb_array_length(expected)%')
  LOOP
    EXECUTE format('ALTER TABLE vamotors."ApprovalRequest" DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE vamotors."ApprovalRequest"
  ADD COLUMN "saleCaseId" uuid,
  ADD CONSTRAINT "ApprovalRequest_kind_check" CHECK (kind IN ('WRITE_OFF', 'DISCOUNT', 'SALE_EDIT')),
  ADD CONSTRAINT "ApprovalRequest_expected_check" CHECK (jsonb_typeof(expected) = 'array' AND jsonb_array_length(expected) BETWEEN 2 AND 10),
  ADD CONSTRAINT "ApprovalRequest_kind_saleCaseId_check" CHECK ((kind = 'SALE_EDIT') = ("saleCaseId" IS NOT NULL));

ALTER TABLE vamotors."EntityReadVersion"
  DROP CONSTRAINT "EntityReadVersion_entityType_check",
  ADD CONSTRAINT "EntityReadVersion_entityType_check" CHECK (
    "entityType" IN (
      'Vehicle', 'PurchaseRecord', 'Customer', 'Supplier', 'RepairVendor',
      'FinanceCompany', 'Settings', 'RateSheet', 'Quote', 'VehicleCost',
      'ImportBatch', 'Document', 'ApprovalRequest', 'RepairRecord',
      'SaleCase', 'SaleCompletion'
    )
  );

-- 2. New SaleCase, SaleReceipt, SaleCompletion, SaleCorrection, TradeInConsideration tables
CREATE TABLE vamotors."SaleCase" (
  id uuid PRIMARY KEY,
  "purchaseRecordId" uuid NOT NULL REFERENCES vamotors."PurchaseRecord"(id) ON DELETE RESTRICT,
  "customerId" uuid NOT NULL REFERENCES vamotors."Customer"(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('CASH', 'TRADE_IN')),
  "agreedPrice" bigint NOT NULL CHECK ("agreedPrice" BETWEEN 1 AND 99999999999999),
  "listedSnapshot" bigint CHECK ("listedSnapshot" IS NULL OR "listedSnapshot" BETWEEN 0 AND 99999999999999),
  reference text CHECK (reference IS NULL OR (reference = btrim(reference) AND length(reference) BETWEEN 1 AND 200)),
  notes text CHECK (notes IS NULL OR (notes = btrim(notes) AND length(notes) BETWEEN 1 AND 2000)),
  state text NOT NULL CHECK (state IN ('COMPLETED', 'CANCELLED')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 2147483647),
  "openedAt" timestamp(3) NOT NULL,
  "createdBy" uuid NOT NULL,
  "commandId" uuid NOT NULL UNIQUE REFERENCES vamotors."CommandReceipt"(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  "approvalId" uuid UNIQUE,
  FOREIGN KEY ("approvalId", "purchaseRecordId") REFERENCES vamotors."ApprovalRequest"(id, "cycleId") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  UNIQUE (id, "purchaseRecordId"),
  UNIQUE (id, "customerId"),
  UNIQUE ("approvalId", "purchaseRecordId")
);
CREATE UNIQUE INDEX one_active_sale_per_cycle ON vamotors."SaleCase" ("purchaseRecordId") WHERE state <> 'CANCELLED';
CREATE INDEX "SaleCase_purchaseRecordId_state_openedAt_id_idx" ON vamotors."SaleCase" ("purchaseRecordId", state, "openedAt", id);
CREATE INDEX "SaleCase_customerId_openedAt_id_idx" ON vamotors."SaleCase" ("customerId", "openedAt", id);

CREATE TABLE vamotors."SaleReceipt" (
  id uuid PRIMARY KEY,
  "saleCaseId" uuid NOT NULL,
  "purchaseRecordId" uuid NOT NULL REFERENCES vamotors."PurchaseRecord"(id) ON DELETE RESTRICT,
  FOREIGN KEY ("saleCaseId", "purchaseRecordId") REFERENCES vamotors."SaleCase"(id, "purchaseRecordId") ON DELETE RESTRICT,
  amount bigint NOT NULL CHECK (amount BETWEEN 1 AND 99999999999999),
  direction text NOT NULL CHECK (direction IN ('IN', 'OUT')),
  category text NOT NULL CHECK (category = 'SALE'),
  "occurredDate" date NOT NULL CHECK ("occurredDate" <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Colombo')::date),
  method text NOT NULL CHECK (method IN ('CASH', 'BANK_TRANSFER')),
  currency text NOT NULL,
  scale integer NOT NULL CHECK (scale = 2),
  reference text CHECK (reference IS NULL OR (reference = btrim(reference) AND length(reference) BETWEEN 1 AND 200)),
  "reversalOf" uuid UNIQUE,
  FOREIGN KEY ("reversalOf", "saleCaseId", "purchaseRecordId") REFERENCES vamotors."SaleReceipt"(id, "saleCaseId", "purchaseRecordId") ON DELETE RESTRICT,
  reason text CHECK (reason IS NULL OR (reason = btrim(reason) AND length(reason) BETWEEN 1 AND 2000)),
  CHECK (("reversalOf" IS NULL AND reason IS NULL) OR ("reversalOf" IS NOT NULL AND reason IS NOT NULL)),
  "createdBy" uuid NOT NULL,
  "commandId" uuid NOT NULL REFERENCES vamotors."CommandReceipt"(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  "lineKey" text NOT NULL,
  "recordedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (id, "saleCaseId", "purchaseRecordId"),
  UNIQUE ("commandId", "lineKey"),
  UNIQUE ("reversalOf", "saleCaseId", "purchaseRecordId")
);
CREATE INDEX "SaleReceipt_saleCaseId_occurredDate_id_idx" ON vamotors."SaleReceipt" ("saleCaseId", "occurredDate", id);
CREATE INDEX "SaleReceipt_purchaseRecordId_occurredDate_id_idx" ON vamotors."SaleReceipt" ("purchaseRecordId", "occurredDate", id);
CREATE TRIGGER append_only_sale_receipt BEFORE UPDATE OR DELETE ON vamotors."SaleReceipt" FOR EACH ROW EXECUTE FUNCTION vamotors.append_only();

CREATE TABLE vamotors."SaleCompletion" (
  id uuid PRIMARY KEY,
  "saleCaseId" uuid NOT NULL UNIQUE,
  "purchaseRecordId" uuid NOT NULL UNIQUE REFERENCES vamotors."PurchaseRecord"(id) ON DELETE RESTRICT,
  FOREIGN KEY ("saleCaseId", "purchaseRecordId") REFERENCES vamotors."SaleCase"(id, "purchaseRecordId") ON DELETE RESTRICT,
  "saleDate" date NOT NULL CHECK ("saleDate" <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Colombo')::date),
  "handoverMileage" integer NOT NULL CHECK ("handoverMileage" BETWEEN 0 AND 99999999),
  "agreedPrice" bigint NOT NULL CHECK ("agreedPrice" BETWEEN 1 AND 99999999999999),
  "basisVersionId" uuid NOT NULL,
  FOREIGN KEY ("basisVersionId", "purchaseRecordId") REFERENCES vamotors."CycleBasisVersion"(id, "cycleId") ON DELETE RESTRICT,
  "originalProfit" bigint NOT NULL,
  snapshot jsonb NOT NULL,
  "approvalId" uuid UNIQUE,
  FOREIGN KEY ("approvalId", "purchaseRecordId") REFERENCES vamotors."ApprovalRequest"(id, "cycleId") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  "createdBy" uuid NOT NULL,
  "commandId" uuid NOT NULL UNIQUE REFERENCES vamotors."CommandReceipt"(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  "recordedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (id, "saleCaseId"),
  UNIQUE (id, "purchaseRecordId"),
  UNIQUE ("saleCaseId", "purchaseRecordId")
);
CREATE TRIGGER append_only_sale_completion BEFORE UPDATE OR DELETE ON vamotors."SaleCompletion" FOR EACH ROW EXECUTE FUNCTION vamotors.append_only();

CREATE TABLE vamotors."SaleCorrection" (
  id uuid PRIMARY KEY,
  "completionId" uuid NOT NULL,
  "saleCaseId" uuid NOT NULL,
  "purchaseRecordId" uuid NOT NULL REFERENCES vamotors."PurchaseRecord"(id) ON DELETE RESTRICT,
  FOREIGN KEY ("completionId", "saleCaseId") REFERENCES vamotors."SaleCompletion"(id, "saleCaseId") ON DELETE RESTRICT,
  FOREIGN KEY ("saleCaseId", "purchaseRecordId") REFERENCES vamotors."SaleCase"(id, "purchaseRecordId") ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version >= 1),
  patch jsonb NOT NULL,
  reason text NOT NULL CHECK (reason = btrim(reason) AND length(reason) BETWEEN 1 AND 2000),
  "approvalId" uuid NOT NULL UNIQUE,
  FOREIGN KEY ("approvalId", "purchaseRecordId") REFERENCES vamotors."ApprovalRequest"(id, "cycleId") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  "correctedSnapshot" jsonb NOT NULL,
  "basisVersionId" uuid NOT NULL,
  FOREIGN KEY ("basisVersionId", "purchaseRecordId") REFERENCES vamotors."CycleBasisVersion"(id, "cycleId") ON DELETE RESTRICT,
  "priorVersionId" uuid UNIQUE REFERENCES vamotors."SaleCorrection"(id) ON DELETE RESTRICT,
  "restatedProfit" bigint NOT NULL,
  "createdBy" uuid NOT NULL,
  "commandId" uuid NOT NULL UNIQUE REFERENCES vamotors."CommandReceipt"(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  "recordedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("completionId", version)
);
CREATE TRIGGER append_only_sale_correction BEFORE UPDATE OR DELETE ON vamotors."SaleCorrection" FOR EACH ROW EXECUTE FUNCTION vamotors.append_only();

CREATE TABLE vamotors."TradeInConsideration" (
  id uuid PRIMARY KEY,
  "saleCaseId" uuid NOT NULL UNIQUE,
  "purchaseRecordId" uuid NOT NULL REFERENCES vamotors."PurchaseRecord"(id) ON DELETE RESTRICT,
  "customerId" uuid NOT NULL REFERENCES vamotors."Customer"(id) ON DELETE RESTRICT,
  FOREIGN KEY ("saleCaseId", "purchaseRecordId") REFERENCES vamotors."SaleCase"(id, "purchaseRecordId") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY ("saleCaseId", "customerId") REFERENCES vamotors."SaleCase"(id, "customerId") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  description text NOT NULL CHECK (description = btrim(description) AND length(description) BETWEEN 1 AND 2000),
  value bigint NOT NULL CHECK (value BETWEEN 1 AND 99999999999999),
  "acquiredVehicleId" uuid REFERENCES vamotors."Vehicle"(id) ON DELETE RESTRICT,
  "acquiredPurchaseId" uuid UNIQUE,
  FOREIGN KEY ("acquiredPurchaseId", "acquiredVehicleId") REFERENCES vamotors."PurchaseRecord"(id, "vehicleId") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  "intakeCommandId" uuid UNIQUE REFERENCES vamotors."CommandReceipt"(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CHECK (("acquiredVehicleId" IS NULL) = ("acquiredPurchaseId" IS NULL)),
  CHECK (("intakeCommandId" IS NULL) = ("acquiredPurchaseId" IS NULL)),
  UNIQUE ("saleCaseId", "customerId"),
  UNIQUE ("saleCaseId", "purchaseRecordId")
);

ALTER TABLE vamotors."PurchaseRecord"
  ADD CONSTRAINT "PurchaseRecord_tradeInSourceSaleId_sellerCustomerId_fkey"
  FOREIGN KEY ("tradeInSourceSaleId", "sellerCustomerId")
  REFERENCES vamotors."TradeInConsideration"("saleCaseId", "customerId")
  ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE vamotors."MileageReading"
  ADD CONSTRAINT "MileageReading_sourceSaleCompletionId_cycleId_fkey"
  FOREIGN KEY ("sourceSaleCompletionId", "cycleId")
  REFERENCES vamotors."SaleCompletion"(id, "purchaseRecordId")
  ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE vamotors."ApprovalRequest"
  ADD CONSTRAINT "ApprovalRequest_saleCaseId_cycleId_fkey"
  FOREIGN KEY ("saleCaseId", "cycleId")
  REFERENCES vamotors."SaleCase"(id, "purchaseRecordId")
  ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

-- 3. Widen CashMovement view to include SaleReceipt
CREATE OR REPLACE VIEW vamotors."CashMovement" AS
  SELECT 'PURCHASE'::text AS "sourceType", "cycleId" AS "sourceId", id AS "paymentId", "occurredDate" AS date, direction, amount, method, category, "commandId" FROM vamotors."PurchasePayment"
  UNION ALL SELECT 'COST'::text, "costId", id, "occurredDate", direction, amount, method, category, "commandId" FROM vamotors."CostPayment"
  UNION ALL SELECT 'REPAIR'::text, "repairId", id, "occurredDate", direction, amount, method, category, "commandId" FROM vamotors."RepairPayment"
  UNION ALL SELECT 'DISPOSAL'::text, "disposalId", id, "occurredDate", direction, amount, method, category, "commandId" FROM vamotors."DisposalReceipt"
  UNION ALL SELECT 'SALE'::text, "saleCaseId", id, "occurredDate", direction, amount, method, category, "commandId" FROM vamotors."SaleReceipt";

-- 4. Helpers for canonical JSON, seller projection, financial projection, sold verification, and sale diffs
CREATE FUNCTION vamotors.sale_canonical(j jsonb) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT CASE jsonb_typeof(j)
    WHEN 'object' THEN '{' || coalesce((SELECT string_agg(to_jsonb(key)::text || ':' || vamotors.sale_canonical(value), ',' ORDER BY key COLLATE "C") FROM jsonb_each(j)), '') || '}'
    WHEN 'array' THEN '[' || coalesce((SELECT string_agg(vamotors.sale_canonical(value), ',' ORDER BY n) FROM jsonb_array_elements(j) WITH ORDINALITY a(value, n)), '') || ']'
    ELSE j::text
  END
$$;

CREATE FUNCTION vamotors.cycle_seller_json(p vamotors."PurchaseRecord") RETURNS jsonb LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT CASE WHEN p."acquisitionKind" = 'TRADE_IN'
    THEN (SELECT jsonb_build_object('type', 'CUSTOMER', 'id', c.id, 'name', c."fullName", 'active', c.active) FROM vamotors."Customer" c WHERE c.id = p."sellerCustomerId")
    ELSE (SELECT jsonb_build_object('type', 'SUPPLIER', 'id', s.id, 'name', s.name, 'active', s.active) FROM vamotors."Supplier" s WHERE s.id = p."supplierId")
  END
$$;

CREATE FUNCTION vamotors.cycle_financial_json(cid uuid, subj text, incoming numeric, outgoing numeric) RETURNS jsonb LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT CASE WHEN sc.id IS NULL THEN
    jsonb_build_object(
      'currency', b.currency, 'scale', 2,
      'purchase', p."purchasePrice"::text, 'repairs', repair_total::text,
      'additionalCosts', incurred::text, 'basis', b.total::text,
      'cashIn', incoming::text, 'cashOut', outgoing::text, 'net', (incoming - outgoing)::text
    )
  ELSE
    jsonb_build_object(
      'currency', b.currency, 'scale', 2,
      'purchase', p."purchasePrice"::text, 'repairs', repair_total::text,
      'additionalCosts', incurred::text, 'basis', b.total::text
    )
    || CASE WHEN subj = 'PurchaseRecord' THEN
      jsonb_build_object('originalBasis', orig_b.total::text, 'salePrice', s."agreedPrice"::text)
    ELSE '{}'::jsonb END
    || jsonb_build_object(
      'originalProfit', sc."originalProfit"::text,
      'restatedProfit', (s."agreedPrice"::numeric - b.total::numeric)::text,
      'cashIn', incoming::text, 'cashOut', outgoing::text, 'net', (incoming - outgoing)::text
    )
  END
  FROM vamotors."PurchaseRecord" p
  JOIN vamotors."CycleBasisVersion" b ON b."cycleId" = p.id
  CROSS JOIN LATERAL (SELECT coalesce(sum(amount::numeric), 0) AS incurred FROM vamotors."VehicleCost" WHERE "cycleId" = p.id) c_tot
  CROSS JOIN LATERAL (SELECT coalesce(sum("invoiceAmount"::numeric), 0) AS repair_total FROM vamotors."RepairRecord" WHERE "cycleId" = p.id AND "returnedDate" IS NOT NULL) r_tot
  LEFT JOIN vamotors."SaleCompletion" sc ON sc."purchaseRecordId" = p.id
  LEFT JOIN vamotors."SaleCase" s ON s.id = sc."saleCaseId"
  LEFT JOIN vamotors."CycleBasisVersion" orig_b ON orig_b.id = sc."basisVersionId"
  WHERE p.id = cid
  ORDER BY b.version DESC LIMIT 1
$$;

CREATE FUNCTION vamotors.current_sold(cid uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1
    FROM vamotors."PurchaseRecord" p
    JOIN vamotors."Vehicle" v ON v.id = p."vehicleId"
    JOIN vamotors."SaleCase" s ON s."purchaseRecordId" = p.id AND s.state = 'COMPLETED'
    JOIN vamotors."SaleCompletion" sc ON sc."saleCaseId" = s.id AND sc."purchaseRecordId" = p.id
    JOIN vamotors."CycleBasisVersion" b ON b.id = sc."basisVersionId" AND b."cycleId" = p.id
    WHERE p.id = cid
      AND p.status = 'SOLD'
      AND p."closedAt" IS NOT NULL
      AND NOT p.available
      AND p."holdReason" IS NULL
      AND v."activePurchaseId" IS DISTINCT FROM p.id
      AND NOT EXISTS (SELECT 1 FROM vamotors."Disposal" d WHERE d."cycleId" = p.id)
  )
$$;

CREATE FUNCTION vamotors.sale_payments_json(sid uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'id', id,
    'amount', amount::text,
    'direction', direction,
    'category', category,
    'date', "occurredDate"::text,
    'method', method,
    'recordedAt', to_char("recordedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'reference', reference,
    'reversalOf', "reversalOf"
  )) ORDER BY "occurredDate", "recordedAt", id), '[]'::jsonb)
  FROM vamotors."SaleReceipt"
  WHERE "saleCaseId" = sid
$$;

CREATE FUNCTION vamotors.sale_diff(old_payload jsonb, new_payload jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT coalesce(jsonb_object_agg(f, jsonb_build_object(
    'before', coalesce(old_payload #> string_to_array(f, '.'), 'null'::jsonb),
    'after', coalesce(new_payload #> string_to_array(f, '.'), 'null'::jsonb)
  )), '{}'::jsonb)
  FROM unnest(ARRAY[
    'id', 'cycleId', 'customerId', 'revision', 'kind', 'state', 'price', 'reference',
    'tradeIn', 'tradeIn.description', 'tradeIn.value', 'tradeIn.acquiredCycleId',
    'completion', 'completion.id', 'completion.date', 'completion.mileage', 'completion.basisVersionId',
    'payments', 'payments.id', 'payments.amount', 'payments.direction', 'payments.category',
    'payments.date', 'payments.method', 'payments.recordedAt', 'payments.reference', 'payments.reversalOf',
    'timeline', 'nextActions', 'invoices', 'provenance'
  ]) f
  WHERE coalesce(old_payload #> string_to_array(f, '.'), 'null'::jsonb)
    IS DISTINCT FROM coalesce(new_payload #> string_to_array(f, '.'), 'null'::jsonb)
$$;

CREATE OR REPLACE FUNCTION vamotors.cycle_cost_diff(kind text, old jsonb, after jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT coalesce(jsonb_object_agg(f, jsonb_build_object(
    'before', coalesce(old #> string_to_array(f, '.'), 'null'::jsonb),
    'after', coalesce(after #> string_to_array(f, '.'), 'null'::jsonb)
  )), '{}'::jsonb)
  FROM unnest(CASE kind
    WHEN 'VehicleCost' THEN ARRAY[
      'id','revision','category','description','amount','incurredDate','payments','outstanding','provenance'
    ]
    WHEN 'PurchaseRecord' THEN ARRAY[
      'id','revision','vehicleId','identity','identityRevision','cycleNumber','purchaseType','acquisitionKind',
      'seller','tradeInSourceSaleId','purchaseDate','purchasePrice','listedPrice','notes','status','available',
      'holdReason','receivedDate','closedAt','payments','outstanding','outstanding.seller','outstanding.settlement',
      'costs','repairs','mileage','financial','basisVersions','sales','disposal','provenance','nextActions',
      'financial.currency','financial.scale','financial.purchase','financial.repairs','financial.additionalCosts',
      'financial.basis','financial.originalBasis','financial.salePrice','financial.originalProfit',
      'financial.restatedProfit','financial.cashIn','financial.cashOut','financial.net'
    ]
    ELSE ARRAY[
      'id','identity','status','available','cycleId','revision','listedPrice','financial','identityRevision',
      'holdReason','mileage','provenance','financial.currency','financial.scale','financial.purchase',
      'financial.repairs','financial.additionalCosts','financial.basis','financial.originalProfit',
      'financial.restatedProfit','financial.cashIn','financial.cashOut','financial.net'
    ]
  END) f
  WHERE coalesce(old #> string_to_array(f, '.'), 'null'::jsonb)
    IS DISTINCT FROM coalesce(after #> string_to_array(f, '.'), 'null'::jsonb)
$$;

-- 5. Update Vehicle, Mileage, Acquisition, Stock, Cost, Repair, Disposal, Approval functions
CREATE OR REPLACE FUNCTION vamotors.purchase_vehicle_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' AND session_user = 'vamotors_runtime' AND NEW."activePurchaseId" IS NULL THEN
    RAISE EXCEPTION 'ACQUISITION_EVIDENCE_REQUIRED' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD."activePurchaseId" IS NOT NULL AND NEW."activePurchaseId" IS NULL
       AND (to_jsonb(NEW) - ARRAY['activePurchaseId', 'revision', 'updatedAt']) IS NOT DISTINCT FROM (to_jsonb(OLD) - ARRAY['activePurchaseId', 'revision', 'updatedAt'])
       AND OLD.revision < 2147483647 AND NEW.revision::bigint = OLD.revision::bigint + 1
       AND (
         EXISTS (SELECT 1 FROM vamotors."PurchaseRecord" p WHERE p.id = OLD."activePurchaseId" AND p.status = 'WRITTEN_OFF' AND p.xmin = pg_current_xact_id()::xid)
         OR EXISTS (SELECT 1 FROM vamotors."SaleCompletion" sc WHERE sc."purchaseRecordId" = OLD."activePurchaseId" AND sc.xmin = pg_current_xact_id()::xid)
       ) THEN
      RETURN NEW;
    END IF;
    IF OLD."activePurchaseId" IS NULL AND NEW."activePurchaseId" IS NOT NULL
       AND (to_jsonb(NEW) - ARRAY['activePurchaseId', 'revision', 'updatedAt']) IS NOT DISTINCT FROM (to_jsonb(OLD) - ARRAY['activePurchaseId', 'revision', 'updatedAt'])
       AND OLD.revision < 2147483647 AND NEW.revision::bigint = OLD.revision::bigint + 1
       AND EXISTS (SELECT 1 FROM vamotors."PurchaseRecord" p WHERE p.id = NEW."activePurchaseId" AND p."vehicleId" = NEW.id AND p."cycleNumber" > 1 AND p.xmin = pg_current_xact_id()::xid) THEN
      RETURN NEW;
    END IF;
    IF (to_jsonb(NEW) - ARRAY['engineNumber','chassisNumber','normalizedEngine','normalizedChassis','make','model','year','colour','fuelType','transmission','vin','crNumber','notes','revision','updatedAt']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['engineNumber','chassisNumber','normalizedEngine','normalizedChassis','make','model','year','colour','fuelType','transmission','vin','crNumber','notes','revision','updatedAt'])
       OR OLD.revision = 2147483647 OR NEW.revision::bigint <> OLD.revision::bigint + 1
       OR NOT EXISTS (SELECT 1 FROM vamotors."PurchaseRecord" p WHERE p.id = OLD."activePurchaseId" AND p."vehicleId" = OLD.id AND p."acquisitionCommandId" IS NOT NULL AND p."closedAt" IS NULL AND p.status IN ('PURCHASED', 'IN_STOCK', 'IN_REPAIR'))
       OR NEW."normalizedEngine" <> regexp_replace(upper(NEW."engineNumber"), E'[\\t\\n\\r\\f\\v ]', '', 'g')
       OR NEW."normalizedChassis" <> regexp_replace(upper(NEW."chassisNumber"), E'[\\t\\n\\r\\f\\v ]', '', 'g')
       OR length(NEW."normalizedEngine") NOT BETWEEN 1 AND 100
       OR length(NEW."normalizedChassis") NOT BETWEEN 1 AND 100
       OR NEW.year NOT BETWEEN 1886 AND extract(year FROM CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Colombo')::integer + 1
       OR NEW."fuelType" NOT IN ('PETROL', 'DIESEL', 'HYBRID', 'ELECTRIC', 'OTHER')
       OR NEW.transmission NOT IN ('MANUAL', 'AUTOMATIC', 'CVT', 'OTHER') THEN
      RAISE EXCEPTION 'INVALID_PHYSICAL_EDIT' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION vamotors.cycle_edit_vehicle_graph() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE c vamotors."CommandReceipt";
BEGIN
  IF OLD."activePurchaseId" IS NOT NULL AND NEW."activePurchaseId" IS NULL AND (
    EXISTS (SELECT 1 FROM vamotors."Disposal" d WHERE d."cycleId" = OLD."activePurchaseId" AND d.xmin = pg_current_xact_id()::xid)
    OR EXISTS (SELECT 1 FROM vamotors."SaleCompletion" sc WHERE sc."purchaseRecordId" = OLD."activePurchaseId" AND sc.xmin = pg_current_xact_id()::xid)
  ) THEN RETURN NULL; END IF;
  IF OLD."activePurchaseId" IS NULL AND NEW."activePurchaseId" IS NOT NULL
     AND EXISTS (SELECT 1 FROM vamotors."PurchaseRecord" p WHERE p.id = NEW."activePurchaseId" AND p."vehicleId" = NEW.id AND p."cycleNumber" > 1 AND p.xmin = pg_current_xact_id()::xid) THEN
    RETURN NULL;
  END IF;
  SELECT r.* INTO c FROM vamotors."CommandReceipt" r JOIN vamotors."EntityReadVersion" e ON e."commandId" = r.id AND e."entityType" = 'Vehicle' AND e."entityId" = NEW.id AND e.revision = NEW.revision WHERE r.xmin = pg_current_xact_id()::xid AND e.xmin = pg_current_xact_id()::xid;
  IF c.id IS NULL OR c."commandName" NOT IN ('addMileage', 'editVehicle') OR NOT EXISTS (SELECT 1 FROM vamotors."PurchaseRecord" p WHERE p.id = NEW."activePurchaseId" AND p."vehicleId" = NEW.id AND p.xmin = pg_current_xact_id()::xid)
     OR (c."commandName" = 'addMileage' AND (to_jsonb(NEW) - ARRAY['revision', 'updatedAt']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['revision', 'updatedAt'])) THEN
    RAISE EXCEPTION 'PHYSICAL_EDIT_COMMAND_REQUIRED' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION vamotors.cycle_edit_mileage_graph() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW."sourceSaleCompletionId" IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM vamotors."SaleCompletion" sc JOIN vamotors."CommandReceipt" c ON c.id = NEW."commandId" WHERE sc.id = NEW."sourceSaleCompletionId" AND sc."purchaseRecordId" = NEW."cycleId" AND sc."commandId" = NEW."commandId" AND sc.xmin = pg_current_xact_id()::xid AND c.xmin = pg_current_xact_id()::xid) THEN
      RAISE EXCEPTION 'MILEAGE_COMMAND_REQUIRED' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vamotors."PurchaseRecord" p JOIN vamotors."CommandReceipt" c ON c.id = NEW."commandId" WHERE p.id = NEW."cycleId" AND p."vehicleId" = NEW."vehicleId" AND (NEW."commandId" = p."acquisitionCommandId" OR (c."commandName" = 'addMileage' AND p.xmin = pg_current_xact_id()::xid AND c.xmin = pg_current_xact_id()::xid))) THEN
    RAISE EXCEPTION 'MILEAGE_COMMAND_REQUIRED' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION vamotors.acquisition_root_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF session_user = 'vamotors_runtime' AND NEW."acquisitionCommandId" IS NULL THEN
      RAISE EXCEPTION 'ACQUISITION_EVIDENCE_REQUIRED' USING ERRCODE = '23514';
    END IF;
    IF NEW."acquisitionCommandId" IS NOT NULL AND (
      NEW.revision <> 1 OR NEW.status <> 'PURCHASED' OR NEW.available OR NEW."cycleNumber" < 1
      OR NEW."purchasePrice" <= 0 OR NEW."receivedDate" IS NOT NULL OR NEW."holdReason" IS NOT NULL
      OR NEW.notes IS NOT NULL OR NEW."purchaseDate" > (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Colombo')::date
      OR (NEW."acquisitionKind" = 'TRADE_IN' AND (NEW."supplierId" IS NOT NULL OR NEW."sellerCustomerId" IS NULL OR NEW."tradeInSourceSaleId" IS NULL OR NEW."purchaseType" <> 'CASH'))
      OR (NEW."acquisitionKind" = 'SUPPLIER' AND (NEW."supplierId" IS NULL OR NEW."sellerCustomerId" IS NOT NULL OR NEW."tradeInSourceSaleId" IS NOT NULL))
    ) THEN
      RAISE EXCEPTION 'INVALID_ACQUISITION' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF OLD."acquisitionCommandId" IS NULL OR NEW."acquisitionCommandId" IS DISTINCT FROM OLD."acquisitionCommandId" THEN
      RAISE EXCEPTION 'ACQUISITION_EVIDENCE_REQUIRED' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM vamotors."RepairRecord" WHERE "cycleId" = NEW.id AND xmin = pg_current_xact_id()::xid) THEN
      RETURN NEW;
    END IF;
    IF OLD.status IN ('PURCHASED', 'IN_STOCK') AND NEW.status = 'WRITTEN_OFF' AND NOT NEW.available AND NEW."holdReason" IS NULL AND NEW."closedAt" IS NOT NULL THEN
      RETURN NEW;
    END IF;
    IF EXISTS (SELECT 1 FROM vamotors."SaleCompletion" sc WHERE sc."purchaseRecordId" = NEW.id AND sc.xmin = pg_current_xact_id()::xid) THEN
      IF OLD.status = 'IN_STOCK' AND OLD.available AND OLD."closedAt" IS NULL AND NEW.status = 'SOLD' AND NOT NEW.available AND NEW."holdReason" IS NULL AND NEW."closedAt" IS NOT NULL AND OLD.revision < 2147483647 AND NEW.revision::bigint = OLD.revision::bigint + 1
         AND (to_jsonb(NEW) - ARRAY['status','available','holdReason','closedAt','revision','updatedAt']) IS NOT DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','available','holdReason','closedAt','revision','updatedAt']) THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'INVALID_SALE_COMPLETION_ROOT' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM vamotors."SaleCorrection" sc WHERE sc."purchaseRecordId" = NEW.id AND sc.xmin = pg_current_xact_id()::xid) THEN
      IF OLD.status = 'SOLD' AND NEW.status = 'SOLD' AND OLD.revision < 2147483647 AND NEW.revision::bigint = OLD.revision::bigint + 1
         AND (to_jsonb(NEW) - ARRAY['revision','updatedAt']) IS NOT DISTINCT FROM (to_jsonb(OLD) - ARRAY['revision','updatedAt']) THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'INVALID_SALE_CORRECTION_ROOT' USING ERRCODE = '23514';
    END IF;
    IF NEW."acquisitionKind" = 'TRADE_IN' AND NEW."tradeInSourceSaleId" IS NOT NULL
       AND EXISTS (SELECT 1 FROM vamotors."SaleCorrection" sc WHERE sc."saleCaseId" = NEW."tradeInSourceSaleId" AND sc.xmin = pg_current_xact_id()::xid) THEN
      IF OLD.revision < 2147483647 AND NEW.revision::bigint = OLD.revision::bigint + 1 AND NEW."purchasePrice" > 0
         AND (to_jsonb(NEW) - ARRAY['purchasePrice','sellerCustomerId','revision','updatedAt']) IS NOT DISTINCT FROM (to_jsonb(OLD) - ARRAY['purchasePrice','sellerCustomerId','revision','updatedAt'])
         AND (NEW."purchasePrice" = OLD."purchasePrice" OR OLD."closedAt" IS NULL) THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'INVALID_TRADEIN_CORRECTION_ROOT' USING ERRCODE = '23514';
    END IF;
    IF OLD.status IN ('WRITTEN_OFF', 'SOLD') THEN
      RETURN NEW;
    END IF;
    IF ROW(NEW.status, NEW.available, NEW."holdReason", NEW."receivedDate") IS NOT DISTINCT FROM ROW(OLD.status, OLD.available, OLD."holdReason", OLD."receivedDate") THEN
      IF (to_jsonb(NEW) - ARRAY['purchaseDate','purchasePrice','listedPrice','purchaseType','supplierId','notes','revision','updatedAt']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['purchaseDate','purchasePrice','listedPrice','purchaseType','supplierId','notes','revision','updatedAt'])
         OR NEW.status NOT IN ('PURCHASED', 'IN_STOCK', 'IN_REPAIR') OR NEW."closedAt" IS NOT NULL
         OR NEW."purchasePrice" <= 0 OR NEW."purchaseDate" > (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Colombo')::date
         OR (NEW."listedPrice" IS NOT NULL AND NEW."listedPrice" < 0)
         OR (NEW."acquisitionKind" = 'TRADE_IN' AND (NEW."purchaseType" <> OLD."purchaseType" OR NEW."supplierId" IS DISTINCT FROM OLD."supplierId" OR NEW."purchasePrice" <> OLD."purchasePrice"))
         OR OLD.revision = 2147483647 OR NEW.revision::bigint <> OLD.revision::bigint + 1 THEN
        RAISE EXCEPTION 'INVALID_CYCLE_MONEY_CHANGE' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END IF;
    IF (to_jsonb(NEW) - ARRAY['status','available','holdReason','receivedDate','revision','updatedAt']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','available','holdReason','receivedDate','revision','updatedAt']) THEN
      RAISE EXCEPTION 'IMMUTABLE_ACQUISITION' USING ERRCODE = '23514';
    END IF;
    IF OLD.revision = 2147483647 OR NEW.revision::bigint <> OLD.revision::bigint + 1 OR NEW.status <> 'IN_STOCK' OR OLD.status NOT IN ('PURCHASED', 'IN_STOCK') OR NEW."closedAt" IS NOT NULL
       OR NEW."receivedDate" IS NULL OR NEW."receivedDate" < NEW."purchaseDate" OR NEW."receivedDate" > (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Colombo')::date
       OR (OLD.status = 'IN_STOCK' AND NEW."receivedDate" IS DISTINCT FROM OLD."receivedDate")
       OR (NEW.available AND NEW."holdReason" IS NOT NULL)
       OR (NOT NEW.available AND (NEW."holdReason" IS NULL OR NEW."holdReason" ~ '^[[:space:]]|[[:space:]]$' OR length(NEW."holdReason") NOT BETWEEN 1 AND 2000))
       OR (OLD.status = 'IN_STOCK' AND NEW.available = OLD.available AND NEW."holdReason" IS NOT DISTINCT FROM OLD."holdReason") THEN
      RAISE EXCEPTION 'INVALID_STOCK_CHANGE' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION vamotors.initial_cycle_transition() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PURCHASED' OR NEW."closedAt" IS NOT NULL
       OR (NEW."purchaseType" = 'BRAND_NEW' AND NOT EXISTS (SELECT 1 FROM vamotors."Supplier" WHERE id = NEW."supplierId" AND category = 'COMPANY'))
       OR (NEW."acquisitionKind" = 'TRADE_IN' AND (NEW."supplierId" IS NOT NULL OR NEW."sellerCustomerId" IS NULL OR NEW."tradeInSourceSaleId" IS NULL OR NEW."purchaseType" <> 'CASH'))
       OR (NEW."acquisitionKind" = 'SUPPLIER' AND (NEW."supplierId" IS NULL OR NEW."sellerCustomerId" IS NOT NULL OR NEW."tradeInSourceSaleId" IS NOT NULL)) THEN
      RAISE EXCEPTION 'INVALID_CYCLE_STATUS' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status IN ('PURCHASED', 'IN_STOCK') AND NEW.status = 'WRITTEN_OFF' AND NOT NEW.available AND NEW."closedAt" IS NOT NULL THEN
      RETURN NEW;
    END IF;
    IF EXISTS (
      SELECT 1 FROM vamotors."SaleCompletion" sc WHERE sc."purchaseRecordId" = NEW.id AND sc.xmin = pg_current_xact_id()::xid
      AND OLD.status = 'IN_STOCK' AND OLD.available AND NEW.status = 'SOLD' AND NOT NEW.available AND NEW."closedAt" IS NOT NULL
    ) THEN RETURN NEW; END IF;
    IF EXISTS (
      SELECT 1 FROM vamotors."RepairRecord" r WHERE r."cycleId" = NEW.id AND r.xmin = pg_current_xact_id()::xid
      AND ((OLD.status = 'IN_STOCK' AND NEW.status = 'IN_REPAIR' AND r."returnedDate" IS NULL)
        OR (OLD.status = 'IN_REPAIR' AND NEW.status = 'IN_STOCK' AND r."returnedDate" IS NOT NULL))
    ) THEN RETURN NEW; END IF;
    IF OLD.status = 'PURCHASED' AND NEW.status = 'IN_STOCK' AND NEW."receivedDate" IS NOT NULL AND NEW."closedAt" IS NULL THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'INVALID_CYCLE_STATUS' USING ERRCODE = '23514';
  END IF;
  IF (NEW.status IN ('WRITTEN_OFF', 'SOLD')) <> (NEW."closedAt" IS NOT NULL) THEN
    RAISE EXCEPTION 'INVALID_CYCLE_CLOSE' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE source text; updated text; fragment text;
BEGIN
  SELECT pg_get_functiondef('vamotors.purchase_status_guard()'::regprocedure) INTO source;
  fragment := 'IF c.id IS NULL OR c."actorKey"';
  IF strpos(source, fragment) = 0 THEN RAISE EXCEPTION 'SALE_STATUS_GUARD_BASE_MISMATCH'; END IF;
  updated := replace(source, fragment, E'IF c."commandName" IN (''completeImmediate'',''reviewApproval'') AND EXISTS(SELECT 1 FROM vamotors."SaleCompletion" sc WHERE sc."purchaseRecordId"=p.id AND sc."commandId"=c.id AND sc.xmin=pg_current_xact_id()::xid) THEN RETURN NEW; END IF;\n ' || fragment);
  fragment := E'NEW.action<>''recordPurchase''';
  IF strpos(updated, fragment) = 0 THEN RAISE EXCEPTION 'SALE_STATUS_ACTION_MISMATCH'; END IF;
  updated := replace(updated, fragment, E'((p."acquisitionKind"=''SUPPLIER'' AND NEW.action<>''recordPurchase'') OR (p."acquisitionKind"=''TRADE_IN'' AND NEW.action NOT IN (''intakeTradeIn'',''completeImmediate'',''reviewApproval'')))');
  EXECUTE updated;

  SELECT pg_get_functiondef('vamotors.check_stock_graph()'::regprocedure) INTO source;
  IF strpos(source, 'BEGIN') = 0 THEN RAISE EXCEPTION 'SALE_STOCK_BASE_MISMATCH'; END IF;
  updated := replace(source, 'BEGIN', E'BEGIN\n IF NEW.status=''SOLD'' AND EXISTS(SELECT 1 FROM vamotors."SaleCompletion" sc WHERE sc."purchaseRecordId"=NEW.id AND sc.xmin=pg_current_xact_id()::xid) THEN RETURN NULL; END IF;');
  EXECUTE updated;
END $$;

-- 6. check_acquisition_graph (handles repurchase cycleNumber>1 and TRADE_IN acquisition)
CREATE OR REPLACE FUNCTION vamotors.check_acquisition_graph() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE cid uuid; p vamotors."PurchaseRecord"; initial jsonb; policy jsonb; latest vamotors."CycleBasisVersion"; total numeric; paid numeric; max_prev_cycle integer; max_prev_sale date; repairs numeric; costs numeric; expected_v_rev integer;
BEGIN
  IF TG_TABLE_NAME = 'PurchaseRecord' THEN cid := NEW.id; ELSE cid := NEW."cycleId"; END IF;
  SELECT * INTO p FROM vamotors."PurchaseRecord" WHERE id = cid;
  IF p."acquisitionCommandId" IS NULL THEN
    IF TG_TABLE_NAME <> 'PurchaseRecord' THEN RAISE EXCEPTION 'ACQUISITION_EVIDENCE_REQUIRED' USING ERRCODE = '23514'; END IF;
    RETURN NULL;
  END IF;
  SELECT payload INTO initial FROM vamotors."EntityReadVersion" WHERE "commandId" = p."acquisitionCommandId" AND "entityType" = 'PurchaseRecord' AND "entityId" = cid AND revision = 1;
  SELECT values INTO policy FROM vamotors."SettingsVersion" WHERE id = p."settingsVersionId";

  -- Cycle chaining check (repurchase)
  SELECT coalesce(max("cycleNumber"), 0) INTO max_prev_cycle FROM vamotors."PurchaseRecord" WHERE "vehicleId" = p."vehicleId" AND id <> p.id;
  IF p."cycleNumber" <> max_prev_cycle + 1
     OR EXISTS (SELECT 1 FROM vamotors."PurchaseRecord" x WHERE x."vehicleId" = p."vehicleId" AND x.id <> p.id AND x.status <> 'SOLD') THEN
    RAISE EXCEPTION 'INVALID_REPURCHASE_CYCLE' USING ERRCODE = '23514';
  END IF;
  IF p."cycleNumber" > 1 THEN
    SELECT max(sc."saleDate") INTO max_prev_sale FROM vamotors."SaleCompletion" sc JOIN vamotors."PurchaseRecord" prev ON prev.id = sc."purchaseRecordId" WHERE prev."vehicleId" = p."vehicleId" AND prev.id <> p.id;
    IF max_prev_sale IS NULL OR p."purchaseDate" < max_prev_sale THEN
      RAISE EXCEPTION 'INVALID_REPURCHASE_DATE' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF p."acquisitionKind" = 'SUPPLIER' THEN
    IF initial IS NULL OR NOT EXISTS (
      SELECT 1 FROM vamotors."CommandReceipt" c
      WHERE c.id = p."acquisitionCommandId" AND c."commandName" = 'recordPurchase'
        AND c."actorKey" = 'USER:' || p."createdBy"::text AND c."businessSequence" > 0
        AND c.result = jsonb_build_object('type', 'PurchaseRecord', 'id', p.id, 'revision', 1)
    )
    OR NOT EXISTS (
      SELECT 1 FROM vamotors."Vehicle" v
      WHERE v.id = p."vehicleId"
        AND (p."cycleNumber" > 1 OR v."createdBy" = p."createdBy")
        AND ((p."closedAt" IS NULL AND v."activePurchaseId" = p.id) OR (p."closedAt" IS NOT NULL AND v."activePurchaseId" IS DISTINCT FROM p.id))
    )
    OR (TG_TABLE_NAME = 'PurchaseRecord' AND TG_OP = 'INSERT' AND NOT EXISTS (SELECT 1 FROM vamotors."Supplier" s WHERE s.id = p."supplierId" AND s.active AND (p."purchaseType" <> 'BRAND_NEW' OR s.category = 'COMPANY'))) THEN
      RAISE EXCEPTION 'INVALID_ACQUISITION_GRAPH' USING ERRCODE = '23514';
    END IF;
    IF p."purchaseType" IN ('CASH', 'BRAND_NEW') THEN
      IF (SELECT count(*) FROM vamotors."PurchasePayment" x WHERE x."cycleId" = cid AND x."commandId" = p."acquisitionCommandId") <> 1
         OR NOT EXISTS (SELECT 1 FROM vamotors."PurchasePayment" x WHERE x."cycleId" = cid AND x."commandId" = p."acquisitionCommandId" AND x.amount = (initial->>'purchasePrice')::bigint AND x.direction = 'OUT' AND x."occurredDate" = (initial->>'purchaseDate')::date AND x."reversalOf" IS NULL AND x.currency = policy->>'currency' AND x.scale = 2 AND x."lineKey" = 'seller') THEN
        RAISE EXCEPTION 'INVALID_ACQUISITION_GRAPH' USING ERRCODE = '23514';
      END IF;
    ELSIF p."purchaseType" = 'LEASE_SETTLEMENT' THEN
      IF NOT EXISTS (SELECT 1 FROM vamotors."LeasePurchaseDetail" l WHERE l."purchaseRecordId" = cid) THEN
        RAISE EXCEPTION 'INVALID_ACQUISITION_GRAPH' USING ERRCODE = '23514';
      END IF;
    END IF;
    SELECT coalesce(sum(CASE direction WHEN 'OUT' THEN amount::numeric ELSE -amount::numeric END), 0) INTO paid FROM vamotors."PurchasePayment" WHERE "cycleId" = cid;
    IF paid < 0 OR paid > p."purchasePrice" OR EXISTS (SELECT 1 FROM vamotors."PurchasePayment" x WHERE x."cycleId" = cid AND x."reversalOf" IS NULL AND NOT EXISTS (SELECT 1 FROM vamotors."PurchasePayment" r WHERE r."reversalOf" = x.id) AND x."occurredDate" < p."purchaseDate") THEN
      RAISE EXCEPTION 'INVALID_PURCHASE_BALANCE' USING ERRCODE = '23514';
    END IF;
  ELSIF p."acquisitionKind" = 'TRADE_IN' THEN
    IF initial IS NULL
       OR p."purchaseType" <> 'CASH' OR p."supplierId" IS NOT NULL OR p."sellerCustomerId" IS NULL OR p."tradeInSourceSaleId" IS NULL
       OR EXISTS (SELECT 1 FROM vamotors."PurchasePayment" x WHERE x."cycleId" = cid)
       OR NOT EXISTS (
         SELECT 1 FROM vamotors."CommandReceipt" c
         WHERE c.id = p."acquisitionCommandId"
           AND c."commandName" IN ('completeImmediate', 'intakeTradeIn', 'reviewApproval')
           AND c."actorKey" = 'USER:' || p."createdBy"::text AND c."businessSequence" > 0
       )
       OR NOT EXISTS (
         SELECT 1 FROM vamotors."TradeInConsideration" t
         JOIN vamotors."SaleCase" sc ON sc.id = t."saleCaseId"
         JOIN vamotors."PurchaseRecord" src_p ON src_p.id = sc."purchaseRecordId"
         WHERE t."saleCaseId" = p."tradeInSourceSaleId"
           AND t."acquiredPurchaseId" = p.id
           AND t."acquiredVehicleId" = p."vehicleId"
           AND t."customerId" = p."sellerCustomerId"
           AND t.value = p."purchasePrice"
           AND t."intakeCommandId" = p."acquisitionCommandId"
           AND sc.state = 'COMPLETED'
           AND src_p."vehicleId" <> p."vehicleId"
       )
       OR NOT EXISTS (
         SELECT 1 FROM vamotors."Vehicle" v
         WHERE v.id = p."vehicleId"
           AND ((p."closedAt" IS NULL AND v."activePurchaseId" = p.id) OR (p."closedAt" IS NOT NULL AND v."activePurchaseId" IS DISTINCT FROM p.id))
       ) THEN
      RAISE EXCEPTION 'INVALID_TRADEIN_ACQUISITION_GRAPH' USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'INVALID_ACQUISITION_KIND' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM vamotors."MileageReading" x WHERE x."cycleId" = cid AND x."commandId" = p."acquisitionCommandId" AND x."recordedDate" >= (initial->>'purchaseDate')::date AND x."recordedDate" >= p."purchaseDate")
     OR NOT EXISTS (SELECT 1 FROM vamotors."CycleBasisVersion" x WHERE x."cycleId" = cid AND x."commandId" = p."acquisitionCommandId" AND x.version = 1 AND x.purchase = (initial->>'purchasePrice')::bigint AND x.total = x.purchase AND x.components = jsonb_build_object('purchase', x.purchase::text, 'repairs', '[]'::jsonb, 'costs', '[]'::jsonb) AND x.currency = policy->>'currency' AND x.scale = 2 AND x."supersedesId" IS NULL)
     OR (SELECT count(*) FROM vamotors."StatusEvent" s WHERE s."cycleId" = cid AND s."commandId" = p."acquisitionCommandId" AND s."from" IS NULL AND s."to" = 'PURCHASED' AND s."userId" = p."createdBy") <> 1
     OR NOT EXISTS (SELECT 1 FROM vamotors."AuditEntry" a WHERE a."commandId" = p."acquisitionCommandId" AND a."entityType" = 'PurchaseRecord' AND a."entityId" = cid)
     OR NOT EXISTS (SELECT 1 FROM vamotors."EntityReadVersion" ev WHERE ev."commandId" = p."acquisitionCommandId" AND ev."entityType" = 'Vehicle' AND ev."entityId" = p."vehicleId") THEN
    RAISE EXCEPTION 'INVALID_ACQUISITION_GRAPH' USING ERRCODE = '23514';
  END IF;

  SELECT coalesce(sum(amount::numeric), 0) INTO costs FROM vamotors."VehicleCost" WHERE "cycleId" = cid;
  SELECT coalesce(sum("invoiceAmount"::numeric), 0) INTO repairs FROM vamotors."RepairRecord" WHERE "cycleId" = cid AND "returnedDate" IS NOT NULL;
  total := p."purchasePrice"::numeric + costs + repairs;
  SELECT * INTO latest FROM vamotors."CycleBasisVersion" WHERE "cycleId" = cid ORDER BY version DESC LIMIT 1;
  IF total > 9999999999999999 OR latest.total IS DISTINCT FROM total OR latest.purchase <> p."purchasePrice"
     OR latest.components <> jsonb_build_object(
       'purchase', p."purchasePrice"::text,
       'repairs', vamotors.repair_components(cid),
       'costs', coalesce((SELECT jsonb_agg(jsonb_build_object('id', id, 'amount', amount::text) ORDER BY id) FROM vamotors."VehicleCost" WHERE "cycleId" = cid), '[]'::jsonb)
     )
     OR (SELECT count(*) FROM vamotors."CycleBasisVersion" WHERE "cycleId" = cid) <> latest.version
     OR EXISTS (SELECT 1 FROM vamotors."CycleBasisVersion" b LEFT JOIN vamotors."CycleBasisVersion" prev ON prev.id = b."supersedesId" AND prev."cycleId" = cid AND prev.version = b.version - 1 WHERE b."cycleId" = cid AND (b.currency <> policy->>'currency' OR b.scale <> 2 OR (b.version > 1 AND prev.id IS NULL)))
     OR EXISTS (SELECT 1 FROM vamotors."VehicleCost" WHERE "cycleId" = cid AND "incurredDate" < p."purchaseDate")
     OR EXISTS (SELECT 1 FROM vamotors."RepairRecord" r WHERE r."cycleId" = cid AND r."sentDate" < p."purchaseDate")
     OR (p."receivedDate" IS NOT NULL AND p."receivedDate" < p."purchaseDate") THEN
    RAISE EXCEPTION 'INVALID_CYCLE_BASIS' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;

-- 7. Closed financial & cycle cost & repair graphs (extend WRITTEN_OFF -> WRITTEN_OFF/SOLD + TRADE_IN seller + SALE cash movements)
CREATE OR REPLACE FUNCTION vamotors.check_closed_financial(old_root vamotors."PurchaseRecord", new_root vamotors."PurchaseRecord") RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE c vamotors."CommandReceipt"; uid uuid; k vamotors."VehicleCost"; r vamotors."RepairRecord"; correction_reason text; allowed_delta text[] := ARRAY['revision','updatedAt']; payment record; fields text[]; settlement_changed boolean;
BEGIN
  SELECT x.* INTO c FROM vamotors."CommandReceipt" x JOIN vamotors."EntityReadVersion" e ON e."commandId" = x.id AND e."entityType" = 'PurchaseRecord' AND e."entityId" = new_root.id AND e.revision = new_root.revision AND e.sequence = x."businessSequence" WHERE x.xmin = pg_current_xact_id()::xid AND e.xmin = pg_current_xact_id()::xid;
  IF old_root.status NOT IN ('WRITTEN_OFF', 'SOLD')
     OR (old_root.status = 'WRITTEN_OFF' AND NOT vamotors.current_written_off(new_root.id))
     OR (old_root.status = 'SOLD' AND NOT vamotors.current_sold(new_root.id))
     OR new_root.status IS DISTINCT FROM old_root.status
     OR c.id IS NULL OR c."actorKey" NOT LIKE 'USER:%'
     OR c."environmentId" <> (SELECT id FROM vamotors."Environment" WHERE singleton = 1)
     OR NOT EXISTS (SELECT 1 FROM vamotors."BusinessSequence" WHERE id = 1 AND value = c."businessSequence" AND xmin = pg_current_xact_id()::xid)
     OR old_root.revision = 2147483647 OR new_root.revision::bigint <> old_root.revision::bigint + 1 OR new_root."acquisitionCommandId" IS NULL
     OR EXISTS (SELECT 1 FROM vamotors."Vehicle" WHERE id = new_root."vehicleId" AND xmin = pg_current_xact_id()::xid)
     OR EXISTS (SELECT 1 FROM vamotors."Disposal" WHERE "cycleId" = new_root.id AND xmin = pg_current_xact_id()::xid)
     OR EXISTS (SELECT 1 FROM vamotors."DisposalReceipt" WHERE "commandId" = c.id)
     OR EXISTS (SELECT 1 FROM vamotors."SaleCompletion" WHERE "purchaseRecordId" = new_root.id AND xmin = pg_current_xact_id()::xid)
     OR EXISTS (SELECT 1 FROM vamotors."SaleCorrection" WHERE "purchaseRecordId" = new_root.id AND xmin = pg_current_xact_id()::xid)
     OR EXISTS (SELECT 1 FROM vamotors."SaleReceipt" WHERE "commandId" = c.id)
     OR EXISTS (SELECT 1 FROM vamotors."StatusEvent" WHERE "commandId" = c.id)
     OR EXISTS (SELECT 1 FROM vamotors."MileageReading" WHERE "commandId" = c.id) THEN
    RAISE EXCEPTION 'CLOSED_FINANCIAL_OWNER_REQUIRED' USING ERRCODE = '23514';
  END IF;
  uid := substring(c."actorKey" FROM 6)::uuid;
  IF c.result->>'type' = 'RepairRecord' AND c."commandName" IN ('payRepair', 'reversePayment') THEN
    SELECT * INTO r FROM vamotors."RepairRecord" WHERE id = (c.result->>'id')::uuid AND "cycleId" = new_root.id AND xmin = pg_current_xact_id()::xid;
    IF r.id IS NULL OR r."returnedDate" IS NULL OR EXISTS (SELECT 1 FROM vamotors."CycleBasisVersion" WHERE "commandId" = c.id) THEN
      RAISE EXCEPTION 'CLOSED_REPAIR_LIABILITY_REQUIRED' USING ERRCODE = '23514';
    END IF;
  ELSIF c.result->>'type' IN ('VehicleCost', 'PurchaseRecord') AND c."commandName" IN ('editCost', 'payCost', 'editPurchase', 'payPurchase', 'reversePayment') THEN
    IF c.result->>'type' = 'VehicleCost' THEN
      SELECT * INTO k FROM vamotors."VehicleCost" WHERE id = (c.result->>'id')::uuid AND "cycleId" = new_root.id AND xmin = pg_current_xact_id()::xid;
      IF k.id IS NULL OR c."commandName" NOT IN ('editCost', 'payCost', 'reversePayment') THEN
        RAISE EXCEPTION 'CLOSED_COST_OWNER_REQUIRED' USING ERRCODE = '23514';
      END IF;
      IF NOT vamotors.repair_fields(uid, 'VehicleCost', 'read', to_jsonb(k), ARRAY['id','revision'])
         OR (c."commandName" IN ('payCost', 'reversePayment') AND (NOT vamotors.repair_fields(uid, 'VehicleCost', 'read', to_jsonb(k), ARRAY['amount','outstanding','payments.amount','payments.direction']) OR NOT vamotors.repair_fields(uid, 'PurchaseRecord', 'read', to_jsonb(new_root), ARRAY['costs.id','costs.revision','costs.amount','costs.outstanding','costs.payments.amount','costs.payments.direction']))) THEN
        RAISE EXCEPTION 'CLOSED_COST_SOURCE_READ_REQUIRED' USING ERRCODE = '23514';
      END IF;
      IF c."commandName" = 'editCost' AND (NOT vamotors.repair_fields(uid, 'PurchaseRecord', 'update', to_jsonb(new_root), ARRAY['cycleId']) OR NOT vamotors.repair_fields(uid, 'VehicleCost', 'update', to_jsonb(k), ARRAY['costId','category','description','amount','incurredDate','reason'])) THEN
        RAISE EXCEPTION 'CLOSED_COST_AUTHORITY_REQUIRED' USING ERRCODE = '23514';
      END IF;
    ELSE
      IF c.result->>'id' <> new_root.id::text OR c."commandName" NOT IN ('editPurchase', 'payPurchase', 'reversePayment') THEN
        RAISE EXCEPTION 'CLOSED_PURCHASE_OWNER_REQUIRED' USING ERRCODE = '23514';
      END IF;
      IF c."commandName" = 'editPurchase' THEN
        IF new_root."acquisitionKind" = 'TRADE_IN' THEN
          allowed_delta := allowed_delta || ARRAY['notes', 'purchaseDate'];
          IF new_root."purchasePrice" <> old_root."purchasePrice" THEN RAISE EXCEPTION 'TRADEIN_PRICE_VIA_SALE_EDIT_ONLY' USING ERRCODE = '23514'; END IF;
        ELSE
          allowed_delta := allowed_delta || ARRAY['purchasePrice', 'purchaseDate', 'notes'];
        END IF;
        IF NOT vamotors.repair_fields(uid, 'PurchaseRecord', 'read', to_jsonb(new_root), ARRAY['purchaseType','purchaseDate','purchasePrice','seller','payments.amount','payments.direction','payments.category'] || CASE WHEN new_root."purchaseType" = 'LEASE_SETTLEMENT' THEN ARRAY['settlement.institutionType','settlement.companyId','settlement.institutionNameSnapshot','settlement.amount','settlement.cashToSeller'] ELSE ARRAY[]::text[] END) THEN
          RAISE EXCEPTION 'CLOSED_PURCHASE_SOURCE_READ_REQUIRED' USING ERRCODE = '23514';
        END IF;
        SELECT vamotors.settlement_json(new_root.id) IS DISTINCT FROM payload->'settlement' INTO settlement_changed FROM vamotors."EntityReadVersion" WHERE "entityType" = 'PurchaseRecord' AND "entityId" = new_root.id AND sequence < c."businessSequence" ORDER BY sequence DESC LIMIT 1;
        fields := CASE WHEN settlement_changed AND new_root."purchaseType" = 'LEASE_SETTLEMENT' THEN ARRAY['patch.settlement.institutionType','patch.settlement.reference','patch.settlement.amount','patch.settlement.cashToSeller'] || CASE WHEN vamotors.settlement_json(new_root.id)->>'institutionType' = 'FINANCE_COMPANY' THEN ARRAY['patch.settlement.companyId'] ELSE ARRAY['patch.settlement.institutionName'] END
          WHEN new_root."purchasePrice" <> old_root."purchasePrice" THEN ARRAY['patch.purchasePrice'] ELSE ARRAY[]::text[] END;
        IF NOT vamotors.repair_fields(uid, 'PurchaseRecord', 'update', to_jsonb(new_root), ARRAY['cycleId','reason'] || fields) THEN
          RAISE EXCEPTION 'CLOSED_PURCHASE_AUTHORITY_REQUIRED' USING ERRCODE = '23514';
        END IF;
        IF settlement_changed AND EXISTS (SELECT 1 FROM vamotors."LeasePurchaseDetail" l JOIN vamotors."FinanceCompany" f ON f.id = l."companyId" WHERE l."purchaseRecordId" = new_root.id AND NOT vamotors.repair_fields(uid, 'FinanceCompany', 'read', to_jsonb(f), ARRAY['id','revision','active','name'])) THEN
          RAISE EXCEPTION 'CLOSED_SELECTED_COMPANY_READ_REQUIRED' USING ERRCODE = '23514';
        END IF;
      END IF;
    END IF;
    SELECT reason INTO correction_reason FROM vamotors."AuditEntry" WHERE "commandId" = c.id AND "entityType" = 'PurchaseRecord' AND "entityId" = new_root.id AND xmin = pg_current_xact_id()::xid;
    IF c."commandName" IN ('editCost', 'editPurchase', 'reversePayment') AND (correction_reason IS NULL OR length(btrim(correction_reason)) NOT BETWEEN 1 AND 2000) THEN
      RAISE EXCEPTION 'CLOSED_CORRECTION_REASON_REQUIRED' USING ERRCODE = '23514';
    END IF;
    IF (SELECT count(*) FROM vamotors."EntityReadVersion" WHERE "commandId" = c.id) <> 2 OR (SELECT count(*) FROM vamotors."AuditEntry" WHERE "commandId" = c.id) <> (CASE WHEN k.id IS NULL THEN 2 ELSE 3 END) OR EXISTS (SELECT 1 FROM vamotors."RepairRecord" WHERE "cycleId" = new_root.id AND xmin = pg_current_xact_id()::xid) THEN
      RAISE EXCEPTION 'CLOSED_MONEY_EVIDENCE_REQUIRED' USING ERRCODE = '23514';
    END IF;
    IF c.result->>'type' = 'PurchaseRecord' AND new_root."purchaseType" = 'LEASE_SETTLEMENT' AND EXISTS (SELECT 1 FROM vamotors."FinanceCompany" f WHERE f.id = (SELECT (e.payload#>>'{settlement,companyId}')::uuid FROM vamotors."EntityReadVersion" e WHERE e."entityType" = 'PurchaseRecord' AND e."entityId" = new_root.id AND e.sequence < c."businessSequence" ORDER BY e.sequence DESC LIMIT 1) AND NOT vamotors.repair_fields(uid, 'FinanceCompany', 'read', to_jsonb(f), ARRAY['id','name'])) THEN
      RAISE EXCEPTION 'CLOSED_ORIGINAL_COMPANY_READ_REQUIRED' USING ERRCODE = '23514';
    END IF;
    FOR payment IN SELECT 'PurchaseRecord' typ, p.direction, p.reference, p.category, uid AS "createdBy" FROM vamotors."PurchasePayment" p WHERE p."commandId" = c.id
      UNION ALL SELECT 'VehicleCost', p.direction, p.reference, p.category, p."createdBy" FROM vamotors."CostPayment" p WHERE p."commandId" = c.id LOOP
      IF c."commandName" = 'payPurchase' AND NOT vamotors.repair_fields(uid, 'PurchaseRecord', 'read', to_jsonb(new_root), ARRAY['purchasePrice','payments.amount','payments.direction','payments.category', CASE WHEN payment.category = 'SETTLEMENT' THEN 'outstanding.settlement' ELSE 'outstanding.seller' END]) THEN
        RAISE EXCEPTION 'CLOSED_PAYEE_SOURCE_READ_REQUIRED' USING ERRCODE = '23514';
      END IF;
      IF c."commandName" IN ('reversePayment', 'editPurchase') AND (NOT vamotors.repair_fields(uid, 'PurchaseRecord', 'read', to_jsonb(new_root), CASE WHEN payment.typ = 'VehicleCost' THEN ARRAY['costs.payments.id','costs.payments.amount','costs.payments.direction','costs.payments.category','costs.payments.date','costs.payments.method','costs.payments.reversalOf'] ELSE ARRAY['payments.id','payments.amount','payments.direction','payments.category','payments.date','payments.method','payments.reversalOf'] END) OR (payment.typ = 'VehicleCost' AND NOT vamotors.repair_fields(uid, 'VehicleCost', 'read', to_jsonb(k), ARRAY['payments.id','payments.amount','payments.direction','payments.category','payments.date','payments.method','payments.reversalOf']))) THEN
        RAISE EXCEPTION 'CLOSED_REVERSAL_SOURCE_READ_REQUIRED' USING ERRCODE = '23514';
      END IF;
      fields := CASE c."commandName"
        WHEN 'reversePayment' THEN ARRAY['sourceType','sourceId','paymentId','reason'] || CASE WHEN payment.direction = 'OUT' THEN ARRAY['replacement.amount','replacement.date','replacement.method'] || CASE WHEN payment.reference IS NULL THEN ARRAY[]::text[] ELSE ARRAY['replacement.reference'] END ELSE ARRAY[]::text[] END
        WHEN 'editPurchase' THEN ARRAY['cycleId','cashCorrections.paymentId','cashCorrections.reason'] || CASE WHEN payment.direction = 'OUT' THEN ARRAY['cashCorrections.replacement.amount','cashCorrections.replacement.date','cashCorrections.replacement.method'] || CASE WHEN payment.reference IS NULL THEN ARRAY[]::text[] ELSE ARRAY['cashCorrections.replacement.reference'] END ELSE ARRAY[]::text[] END
        ELSE CASE WHEN payment.typ = 'VehicleCost' THEN ARRAY['costId'] ELSE ARRAY['cycleId','recipient'] END || ARRAY['payment.amount','payment.date','payment.method'] || CASE WHEN payment.reference IS NULL THEN ARRAY[]::text[] ELSE ARRAY['payment.reference'] END END;
      IF payment."createdBy" <> uid OR NOT vamotors.repair_fields(uid, 'PurchaseRecord', 'pay', to_jsonb(new_root), CASE WHEN payment.typ = 'VehicleCost' THEN ARRAY['cycleId'] ELSE fields END)
         OR (payment.typ = 'VehicleCost' AND NOT vamotors.repair_fields(uid, 'VehicleCost', 'pay', to_jsonb(k), fields)) THEN
        RAISE EXCEPTION 'CLOSED_CASH_AUTHORITY_REQUIRED' USING ERRCODE = '23514';
      END IF;
    END LOOP;
  ELSE
    RAISE EXCEPTION 'UNSUPPORTED_CLOSED_OWNER' USING ERRCODE = '23514';
  END IF;
  IF (to_jsonb(new_root) - allowed_delta) IS DISTINCT FROM (to_jsonb(old_root) - allowed_delta) THEN
    RAISE EXCEPTION 'IMMUTABLE_CLOSED_PHYSICAL_TERMS' USING ERRCODE = '23514';
  END IF;
  IF NOT vamotors.repair_fields(uid, 'PurchaseRecord', 'read', to_jsonb(new_root), ARRAY['id','revision','vehicleId','status','closedAt','financial.currency','financial.scale','financial.cashIn','financial.cashOut','financial.basis','purchasePrice','payments.amount','payments.direction'])
     OR NOT vamotors.repair_fields(uid, 'Vehicle', 'read', (SELECT to_jsonb(v) || jsonb_build_object('status', old_root.status) FROM vamotors."Vehicle" v WHERE v.id = new_root."vehicleId"), ARRAY['id','identityRevision'])
     OR (new_root."purchaseType" = 'LEASE_SETTLEMENT' AND NOT vamotors.repair_fields(uid, 'PurchaseRecord', 'read', to_jsonb(new_root), ARRAY['settlement.amount','settlement.cashToSeller']))
     OR EXISTS (SELECT 1 FROM vamotors."VehicleCost" x WHERE x."cycleId" = new_root.id AND (NOT vamotors.repair_fields(uid, 'PurchaseRecord', 'read', to_jsonb(new_root), ARRAY['costs.amount','costs.payments.amount','costs.payments.direction']) OR NOT vamotors.repair_fields(uid, 'VehicleCost', 'read', to_jsonb(x), ARRAY['amount','payments.amount','payments.direction'])))
     OR EXISTS (SELECT 1 FROM vamotors."RepairRecord" x WHERE x."cycleId" = new_root.id AND (NOT vamotors.repair_fields(uid, 'PurchaseRecord', 'read', to_jsonb(new_root), ARRAY['repairs']) OR NOT vamotors.repair_fields(uid, 'RepairRecord', 'read', to_jsonb(x), ARRAY['invoiceAmount','returnedDate','payments.amount','payments.direction'])))
     OR (old_root.status = 'WRITTEN_OFF' AND EXISTS (SELECT 1 FROM vamotors."DisposalReceipt" WHERE "cycleId" = new_root.id) AND (NOT vamotors.repair_fields(uid, 'PurchaseRecord', 'read', to_jsonb(new_root), ARRAY['disposal']) OR NOT vamotors.repair_fields(uid, 'Disposal', 'read', (SELECT to_jsonb(d) FROM vamotors."Disposal" d WHERE d."cycleId" = new_root.id), ARRAY['payments.amount','payments.direction'])))
     OR (old_root.status = 'SOLD' AND (
       NOT vamotors.repair_fields(uid, 'PurchaseRecord', 'read', to_jsonb(new_root), ARRAY['sales','financial.originalBasis','financial.salePrice','financial.originalProfit','financial.restatedProfit'])
       OR NOT vamotors.repair_fields(uid, 'Vehicle', 'read', (SELECT to_jsonb(v) || jsonb_build_object('status', old_root.status) FROM vamotors."Vehicle" v WHERE v.id = new_root."vehicleId"), ARRAY['financial.originalProfit','financial.restatedProfit'])
       OR NOT vamotors.repair_fields(uid, 'SaleCase', 'read', (SELECT to_jsonb(s) FROM vamotors."SaleCase" s WHERE s."purchaseRecordId" = new_root.id AND s.state = 'COMPLETED'), ARRAY['id','price','payments.amount','payments.direction'])
     )) THEN
    RAISE EXCEPTION 'CLOSED_CURRENT_SOURCE_READ_REQUIRED' USING ERRCODE = '23514';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION vamotors.cycle_cost_root_graph() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE c vamotors."CommandReceipt"; v vamotors."Vehicle"; after_payload jsonb; old_payload jsonb; kind text; eid uuid; rev integer; costs jsonb; payments jsonb; financial jsonb; basis jsonb; cost_id uuid; before_cost jsonb; after_cost jsonb; incoming numeric; outgoing numeric; incurred numeric; changed_basis boolean; closed_sold boolean;
BEGIN
  IF EXISTS (SELECT 1 FROM vamotors."RepairRecord" WHERE "cycleId" = NEW.id AND xmin = pg_current_xact_id()::xid) THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM vamotors."SaleCompletion" WHERE "purchaseRecordId" = NEW.id AND xmin = pg_current_xact_id()::xid) THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM vamotors."SaleCorrection" WHERE "purchaseRecordId" = NEW.id AND xmin = pg_current_xact_id()::xid) THEN RETURN NULL; END IF;
  IF NEW."acquisitionKind" = 'TRADE_IN' AND NEW."tradeInSourceSaleId" IS NOT NULL AND EXISTS (SELECT 1 FROM vamotors."SaleCorrection" WHERE "saleCaseId" = NEW."tradeInSourceSaleId" AND xmin = pg_current_xact_id()::xid) THEN RETURN NULL; END IF;
  IF ROW(NEW.status, NEW.available, NEW."holdReason", NEW."receivedDate") IS DISTINCT FROM ROW(OLD.status, OLD.available, OLD."holdReason", OLD."receivedDate") THEN RETURN NULL; END IF;

  SELECT * INTO v FROM vamotors."Vehicle" WHERE id = NEW."vehicleId";
  SELECT r.* INTO c FROM vamotors."CommandReceipt" r JOIN vamotors."EntityReadVersion" e ON e."commandId" = r.id AND e."entityType" = 'PurchaseRecord' AND e."entityId" = NEW.id AND e.revision = NEW.revision WHERE r.xmin = pg_current_xact_id()::xid AND e.xmin = pg_current_xact_id()::xid;
  -- Late intake updates the sale summary on its closed source cycle.
  IF c."commandName" = 'intakeTradeIn' AND OLD.status = 'SOLD'
     AND NEW.revision::bigint = OLD.revision::bigint + 1
     AND (to_jsonb(NEW) - ARRAY['revision','updatedAt']) = (to_jsonb(OLD) - ARRAY['revision','updatedAt'])
     AND EXISTS (
       SELECT 1 FROM vamotors."TradeInConsideration" t
       JOIN vamotors."SaleCase" s ON s.id = t."saleCaseId"
       WHERE t."purchaseRecordId" = NEW.id AND t."intakeCommandId" = c.id
         AND t."acquiredPurchaseId" IS NOT NULL
         AND t.xmin = pg_current_xact_id()::xid AND s.xmin = pg_current_xact_id()::xid
         AND c.result = jsonb_build_object('type', 'SaleCase', 'id', s.id, 'revision', s.revision)
     )
     AND EXISTS (
       SELECT 1 FROM vamotors."AuditEntry" a
       WHERE a."commandId" = c.id AND a."entityType" = 'PurchaseRecord'
         AND a."entityId" = NEW.id AND a.action = c."commandName"
         AND c."actorKey" = 'USER:' || a."userId"::text AND a.xmin = pg_current_xact_id()::xid
     ) THEN
    RETURN NULL;
  END IF;
  IF OLD.status IN ('WRITTEN_OFF', 'SOLD') THEN
    PERFORM vamotors.check_closed_financial(OLD, NEW);
    IF c.id IS NOT NULL AND c."commandName" = 'payRepair' AND c.result->>'type' = 'RepairRecord' THEN
      RETURN NULL;
    END IF;
  END IF;
  IF c.id IS NOT NULL AND c."commandName" IN ('addMileage', 'setListedPrice', 'editVehicle') THEN
    PERFORM vamotors.check_cycle_edit(OLD, NEW, c);
    RETURN NULL;
  END IF;
  closed_sold := vamotors.current_sold(NEW.id);
  IF c.id IS NULL OR c."commandName" NOT IN ('addCost','editCost','payCost','payPurchase','editPurchase','reversePayment')
     OR c."actorKey" NOT LIKE 'USER:%'
     OR c."environmentId" <> (SELECT id FROM vamotors."Environment" WHERE singleton = 1)
     OR c."businessSequence" <> (SELECT value FROM vamotors."BusinessSequence" WHERE id = 1)
     OR (v."activePurchaseId" IS DISTINCT FROM NEW.id AND NOT vamotors.current_written_off(NEW.id) AND NOT closed_sold)
     OR NOT EXISTS (SELECT 1 FROM vamotors."PurchaseRecord" p WHERE p.id = NEW.id AND p.xmin = pg_current_xact_id()::xid)
     OR (c."commandName" <> 'editPurchase' AND ROW(NEW."purchaseDate", NEW."purchasePrice", NEW.notes) IS DISTINCT FROM ROW(OLD."purchaseDate", OLD."purchasePrice", OLD.notes))
     OR EXISTS (SELECT 1 FROM vamotors."StatusEvent" WHERE "commandId" = c.id)
     OR EXISTS (SELECT 1 FROM vamotors."MileageReading" WHERE "commandId" = c.id) THEN
    RAISE EXCEPTION 'INVALID_CYCLE_MONEY_GRAPH' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (SELECT 1 FROM vamotors."RepairRecord" WHERE "cycleId" = NEW.id)
     AND (NOT vamotors.repair_fields(substring(c."actorKey" FROM 6)::uuid, 'PurchaseRecord', 'read', to_jsonb(NEW), ARRAY['repairs'])
       OR EXISTS (SELECT 1 FROM vamotors."RepairRecord" k WHERE k."cycleId" = NEW.id AND NOT vamotors.repair_fields(substring(c."actorKey" FROM 6)::uuid, 'RepairRecord', 'read', to_jsonb(k), ARRAY['invoiceAmount','returnedDate','payments.amount','payments.direction'] || CASE WHEN c."commandName" = 'editPurchase' THEN ARRAY['sentDate'] ELSE ARRAY[]::text[] END))) THEN
    RAISE EXCEPTION 'REPAIR_CONTRIBUTOR_READ_REQUIRED' USING ERRCODE = '23514';
  END IF;

  SELECT coalesce(jsonb_agg(vamotors.cycle_cost_json(id) ORDER BY id), '[]'::jsonb), coalesce(sum(amount::numeric), 0) INTO costs, incurred FROM vamotors."VehicleCost" WHERE "cycleId" = NEW.id;
  SELECT coalesce(sum(CASE direction WHEN 'IN' THEN amount::numeric ELSE 0 END), 0), coalesce(sum(CASE direction WHEN 'OUT' THEN amount::numeric ELSE 0 END), 0)
    INTO incoming, outgoing
    FROM vamotors."CashMovement" m
    WHERE (m."sourceType" = 'PURCHASE' AND m."sourceId" = NEW.id)
       OR (m."sourceType" = 'COST' AND m."sourceId" IN (SELECT id FROM vamotors."VehicleCost" WHERE "cycleId" = NEW.id))
       OR (m."sourceType" = 'REPAIR' AND m."sourceId" IN (SELECT id FROM vamotors."RepairRecord" WHERE "cycleId" = NEW.id))
       OR (m."sourceType" = 'DISPOSAL' AND m."sourceId" IN (SELECT id FROM vamotors."Disposal" WHERE "cycleId" = NEW.id))
       OR (m."sourceType" = 'SALE' AND m."sourceId" IN (SELECT id FROM vamotors."SaleCase" WHERE "purchaseRecordId" = NEW.id));
  IF incoming > 9223372036854775807 OR outgoing > 9223372036854775807 THEN
    RAISE EXCEPTION 'MONEY_OVERFLOW' USING ERRCODE = '23514';
  END IF;
  SELECT jsonb_agg(jsonb_build_object('id', id, 'version', version, 'total', total::text, 'reason', reason) ORDER BY version) INTO basis FROM vamotors."CycleBasisVersion" WHERE "cycleId" = NEW.id;
  payments := vamotors.cycle_cost_payments_json('PURCHASE', NEW.id);

  IF (c."commandName" = 'payPurchase' AND (SELECT count(*) FROM vamotors."PurchasePayment" WHERE "commandId" = c.id AND direction = 'OUT' AND "reversalOf" IS NULL) <> 1)
     OR (c."commandName" = 'payCost' AND (SELECT count(*) FROM vamotors."CostPayment" WHERE "commandId" = c.id AND direction = 'OUT' AND "reversalOf" IS NULL) <> 1)
     OR (c."commandName" = 'addCost' AND (SELECT count(*) FROM vamotors."CostPayment" WHERE "commandId" = c.id) > 1)
     OR (c."commandName" = 'reversePayment' AND ((SELECT count(*) FROM vamotors."CashMovement" WHERE "commandId" = c.id AND direction = 'IN') <> 1 OR (SELECT count(*) FROM vamotors."CashMovement" WHERE "commandId" = c.id AND direction = 'OUT') > 1))
     OR (c."commandName" = 'editPurchase' AND ((SELECT count(*) FROM vamotors."PurchasePayment" WHERE "commandId" = c.id AND direction = 'IN') > 100 OR (SELECT count(*) FROM vamotors."PurchasePayment" WHERE "commandId" = c.id AND direction = 'OUT') > 100)) THEN
    RAISE EXCEPTION 'INVALID_MONEY_COMMAND_CARDINALITY' USING ERRCODE = '23514';
  END IF;

  changed_basis := c."commandName" IN ('addCost', 'editCost') OR NEW."purchasePrice" <> OLD."purchasePrice";
  IF (SELECT count(*) FROM vamotors."CycleBasisVersion" WHERE "commandId" = c.id) <> (CASE WHEN changed_basis THEN 1 ELSE 0 END)
     OR EXISTS (SELECT 1 FROM vamotors."CycleBasisVersion" b WHERE b."commandId" = c.id AND (b."cycleId" <> NEW.id OR b.xmin <> pg_current_xact_id()::xid OR b.reason IS DISTINCT FROM CASE WHEN c."commandName" = 'addCost' THEN 'Additional incurred cost' ELSE (SELECT reason FROM vamotors."AuditEntry" WHERE "commandId" = c.id AND "entityType" = 'PurchaseRecord' AND "entityId" = NEW.id) END)) THEN
    RAISE EXCEPTION 'INVALID_CORRECTION_BASIS' USING ERRCODE = '23514';
  END IF;

  FOREACH kind IN ARRAY ARRAY['PurchaseRecord', 'Vehicle'] LOOP
    eid := CASE WHEN kind = 'PurchaseRecord' THEN NEW.id ELSE NEW."vehicleId" END;
    rev := CASE WHEN kind = 'PurchaseRecord' THEN NEW.revision ELSE v.revision END;
    financial := vamotors.cycle_financial_json(NEW.id, kind, incoming, outgoing);
    SELECT payload INTO old_payload FROM vamotors."EntityReadVersion" WHERE "entityType" = kind AND "entityId" = eid AND sequence < c."businessSequence" ORDER BY sequence DESC LIMIT 1;
    SELECT payload INTO after_payload FROM vamotors."EntityReadVersion" WHERE "entityType" = kind AND "entityId" = eid AND "commandId" = c.id AND revision = rev AND sequence = c."businessSequence" AND xmin = pg_current_xact_id()::xid;
    IF old_payload IS NULL OR after_payload IS NULL
       OR old_payload->'revision' IS DISTINCT FROM to_jsonb(OLD.revision)
       OR after_payload->'revision' IS DISTINCT FROM to_jsonb(NEW.revision)
       OR after_payload->'financial' IS DISTINCT FROM financial
       OR (kind = 'PurchaseRecord' AND (
         after_payload->'costs' IS DISTINCT FROM costs
         OR after_payload->'payments' IS DISTINCT FROM payments
         OR after_payload->'basisVersions' IS DISTINCT FROM basis
         OR after_payload->>'purchaseDate' IS DISTINCT FROM NEW."purchaseDate"::text
         OR after_payload->>'purchasePrice' IS DISTINCT FROM NEW."purchasePrice"::text
         OR after_payload->>'notes' IS DISTINCT FROM NEW.notes
         OR after_payload->'outstanding' IS DISTINCT FROM CASE
           WHEN NEW."acquisitionKind" = 'TRADE_IN' THEN jsonb_build_object('seller', '0', 'settlement', '0')
           ELSE vamotors.purchase_outstanding_json(NEW.id) END
         OR after_payload->'seller' IS DISTINCT FROM vamotors.cycle_seller_json(NEW)
       ))
       OR (after_payload - ARRAY['revision','financial','costs','payments','basisVersions','purchaseDate','purchasePrice','notes','outstanding','seller','purchaseType','settlement']) IS DISTINCT FROM (old_payload - ARRAY['revision','financial','costs','payments','basisVersions','purchaseDate','purchasePrice','notes','outstanding','seller','purchaseType','settlement']) THEN
      RAISE EXCEPTION 'INVALID_CYCLE_MONEY_VERSION' USING ERRCODE = '23514';
    END IF;
    IF kind = 'PurchaseRecord' THEN old_payload := jsonb_set(old_payload, '{seller}', after_payload->'seller'); END IF;
    IF NOT EXISTS (SELECT 1 FROM vamotors."AuditEntry" a WHERE a."commandId" = c.id AND a."entityType" = kind AND a."entityId" = eid AND a.action = c."commandName" AND a."actorKind" = 'USER' AND c."actorKey" = 'USER:' || a."userId"::text AND a."fieldDiff" = vamotors.cycle_cost_diff(kind, old_payload, after_payload) AND a.xmin = pg_current_xact_id()::xid AND (c."commandName" NOT IN ('editCost','editPurchase','reversePayment') OR length(btrim(a.reason)) BETWEEN 1 AND 2000)) THEN
      RAISE EXCEPTION 'INVALID_CYCLE_MONEY_AUDIT' USING ERRCODE = '23514';
    END IF;
  END LOOP;

  IF c."commandName" IN ('addCost', 'editCost', 'payCost') OR (c."commandName" = 'reversePayment' AND c.result->>'type' = 'VehicleCost') THEN
    cost_id := (c.result->>'id')::uuid;
    SELECT value INTO before_cost FROM jsonb_array_elements((SELECT payload->'costs' FROM vamotors."EntityReadVersion" WHERE "entityType" = 'PurchaseRecord' AND "entityId" = NEW.id AND sequence < c."businessSequence" ORDER BY sequence DESC LIMIT 1)) WHERE value->>'id' = cost_id::text;
    after_cost := vamotors.cycle_cost_json(cost_id);
    IF after_cost IS NULL OR c.result <> jsonb_build_object('type', 'VehicleCost', 'id', cost_id, 'revision', (after_cost->>'revision')::integer)
       OR NOT EXISTS (SELECT 1 FROM vamotors."VehicleCost" x WHERE x.id = cost_id AND x."cycleId" = NEW.id AND x.xmin = pg_current_xact_id()::xid AND x.revision = coalesce((before_cost->>'revision')::integer, 0) + 1)
       OR (c."commandName" = 'addCost' AND before_cost IS NOT NULL) OR (c."commandName" <> 'addCost' AND before_cost IS NULL)
       OR NOT EXISTS (SELECT 1 FROM vamotors."AuditEntry" a WHERE a."commandId" = c.id AND a."entityType" = 'VehicleCost' AND a."entityId" = cost_id AND a.action = c."commandName" AND a."actorKind" = 'USER' AND c."actorKey" = 'USER:' || a."userId"::text AND a."fieldDiff" = vamotors.cycle_cost_diff('VehicleCost', before_cost, after_cost) AND a.xmin = pg_current_xact_id()::xid AND a.reason IS NOT DISTINCT FROM (SELECT reason FROM vamotors."AuditEntry" WHERE "commandId" = c.id AND "entityType" = 'PurchaseRecord' AND "entityId" = NEW.id))
       OR EXISTS (SELECT 1 FROM vamotors."VehicleCost" x WHERE x."cycleId" = NEW.id AND x.xmin = pg_current_xact_id()::xid AND x.id <> cost_id)
       OR EXISTS (SELECT 1 FROM vamotors."PurchasePayment" WHERE "commandId" = c.id)
       OR (c."commandName" IN ('payCost', 'reversePayment') AND after_cost - ARRAY['revision','payments','outstanding'] IS DISTINCT FROM before_cost - ARRAY['revision','payments','outstanding'])
       OR (c."commandName" = 'editCost' AND after_cost->'payments' IS DISTINCT FROM before_cost->'payments') THEN
      RAISE EXCEPTION 'INVALID_COST_GRAPH' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF c.result <> jsonb_build_object('type', 'PurchaseRecord', 'id', NEW.id, 'revision', NEW.revision) OR EXISTS (SELECT 1 FROM vamotors."CostPayment" WHERE "commandId" = c.id) OR EXISTS (SELECT 1 FROM vamotors."VehicleCost" x WHERE x."cycleId" = NEW.id AND x.xmin = pg_current_xact_id()::xid) THEN
      RAISE EXCEPTION 'INVALID_PURCHASE_CORRECTION_GRAPH' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NULL;
END $$;

DO $$
DECLARE source text; updated text; fragment text;
BEGIN
  SELECT pg_get_functiondef('vamotors.cycle_cost_child_graph()'::regprocedure) INTO source;
  fragment := 'NOT vamotors.current_written_off(p.id)';
  IF strpos(source, fragment) = 0 THEN RAISE EXCEPTION 'SALE_COST_CHILD_BASE_MISMATCH'; END IF;
  updated := replace(source, fragment, 'NOT vamotors.current_written_off(p.id) AND NOT vamotors.current_sold(p.id)');
  EXECUTE updated;

  SELECT pg_get_functiondef('vamotors.settlement_detail_guard()'::regprocedure) INTO source;
  IF strpos(source, fragment) = 0 THEN RAISE EXCEPTION 'SALE_SETTLEMENT_BASE_MISMATCH'; END IF;
  updated := replace(source, fragment, 'NOT vamotors.current_written_off(p.id) AND NOT vamotors.current_sold(p.id)');
  EXECUTE updated;

  -- Patch check_repair_root for TRADE_IN seller, SALE cash movements, and SOLD financial metrics
  SELECT pg_get_functiondef('vamotors.check_repair_root()'::regprocedure) INTO source;
  fragment := '(SELECT jsonb_build_object(''type'',''SUPPLIER'',''id'',s.id,''name'',s.name,''active'',s.active) FROM vamotors."Supplier" s WHERE s.id=NEW."supplierId")';
  IF strpos(source, fragment) = 0 THEN RAISE EXCEPTION 'REPAIR_ROOT_SELLER_MISMATCH'; END IF;
  updated := replace(source, fragment, 'vamotors.cycle_seller_json(NEW)');
  fragment := 'OR (m."sourceType"=''DISPOSAL'' AND m."sourceId" IN (SELECT id FROM vamotors."Disposal" WHERE "cycleId"=NEW.id))';
  IF strpos(updated, fragment) = 0 THEN RAISE EXCEPTION 'REPAIR_ROOT_CASH_MISMATCH'; END IF;
  updated := replace(updated, fragment, fragment || ' OR (m."sourceType"=''SALE'' AND m."sourceId" IN (SELECT id FROM vamotors."SaleCase" WHERE "purchaseRecordId"=NEW.id))');
  fragment := 'SELECT jsonb_build_object(''currency'',b.currency,''scale'',2,''purchase'',NEW."purchasePrice"::text,''repairs'',repair_total::text,''additionalCosts'',incurred::text,''basis'',b.total::text,''cashIn'',incoming::text,''cashOut'',outgoing::text,''net'',(incoming-outgoing)::text) INTO financial FROM vamotors."CycleBasisVersion" b WHERE b."cycleId"=NEW.id ORDER BY version DESC LIMIT 1;';
  IF strpos(updated, fragment) = 0 THEN RAISE EXCEPTION 'REPAIR_ROOT_FINANCIAL_MISMATCH'; END IF;
  updated := replace(updated, fragment, 'financial := vamotors.cycle_financial_json(NEW.id, ''PurchaseRecord'', incoming, outgoing);');
  EXECUTE updated;

  -- Patch check_disposal_graph so Vehicle.activePurchaseId->NULL on SaleCompletion doesn't fail and WRITE_OFF blocks on active SaleCase
  SELECT pg_get_functiondef('vamotors.check_disposal_graph()'::regprocedure) INTO source;
  fragment := 'SELECT * INTO p FROM vamotors."PurchaseRecord" WHERE id=cid;';
  IF strpos(source, fragment) = 0 THEN RAISE EXCEPTION 'DISPOSAL_GRAPH_SALE_MISMATCH'; END IF;
  updated := replace(source, fragment, E'IF TG_TABLE_NAME=''Vehicle'' AND EXISTS(SELECT 1 FROM vamotors."SaleCompletion" sc WHERE sc."purchaseRecordId"=cid AND sc.xmin=pg_current_xact_id()::xid) THEN RETURN NULL; END IF;\n ' || fragment);
  fragment := 'IF EXISTS(SELECT 1 FROM vamotors."RepairRecord" WHERE "cycleId"=cid AND "returnedDate" IS NULL)';
  IF strpos(updated, fragment) = 0 THEN RAISE EXCEPTION 'DISPOSAL_GRAPH_OBLIGATION_MISMATCH'; END IF;
  updated := replace(updated, fragment, E'IF EXISTS(SELECT 1 FROM vamotors."SaleCase" WHERE "purchaseRecordId"=cid AND state<>''CANCELLED'') THEN RAISE EXCEPTION ''SALE_OBLIGATION_OPEN'' USING ERRCODE=''23514''; END IF;\n ' || fragment);
  EXECUTE updated;

  -- Patch check_disposal_root seller projection for TRADE_IN cycles
  SELECT pg_get_functiondef('vamotors.check_disposal_root()'::regprocedure) INTO source;
  fragment := '(SELECT jsonb_build_object(''type'',''SUPPLIER'',''id'',s.id,''name'',s.name,''active'',s.active) FROM vamotors."Supplier" s WHERE s.id=NEW."supplierId")';
  IF strpos(source, fragment) = 0 THEN RAISE EXCEPTION 'DISPOSAL_ROOT_SELLER_MISMATCH'; END IF;
  updated := replace(source, fragment, 'vamotors.cycle_seller_json(NEW)');
  EXECUTE updated;

  -- Patch check_stock_graph seller projection for TRADE_IN cycles
  SELECT pg_get_functiondef('vamotors.check_stock_graph()'::regprocedure) INTO source;
  IF strpos(source, fragment) = 0 THEN RAISE EXCEPTION 'STOCK_GRAPH_SELLER_MISMATCH'; END IF;
  updated := replace(source, fragment, 'vamotors.cycle_seller_json(NEW)');
  EXECUTE updated;

  -- Patch check_cycle_edit seller projection for TRADE_IN cycles
  SELECT pg_get_functiondef('vamotors.check_cycle_edit(vamotors."PurchaseRecord",vamotors."PurchaseRecord",vamotors."CommandReceipt")'::regprocedure) INTO source;
  fragment := '(SELECT jsonb_build_object(''type'',''SUPPLIER'',''id'',s.id,''name'',s.name,''active'',s.active) FROM vamotors."Supplier" s WHERE s.id=new_root."supplierId")';
  IF strpos(source, fragment) = 0 THEN RAISE EXCEPTION 'CYCLE_EDIT_SELLER_MISMATCH'; END IF;
  updated := replace(source, fragment, 'vamotors.cycle_seller_json(new_root)');
  EXECUTE updated;
END $$;

-- 8. Sale Graph Constraint Trigger (completeImmediate, intakeTradeIn, DISCOUNT, SALE_EDIT)
CREATE FUNCTION vamotors.check_sale_graph() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE sid uuid; s vamotors."SaleCase"; sc vamotors."SaleCompletion"; p vamotors."PurchaseRecord"; v vamotors."Vehicle"; t vamotors."TradeInConsideration"; b vamotors."CycleBasisVersion"; c vamotors."CommandReceipt"; a vamotors."ApprovalRequest"; ap vamotors."PurchaseRecord"; uid uuid; r_in numeric; corr vamotors."SaleCorrection"; latest_b vamotors."CycleBasisVersion"; orig_b vamotors."CycleBasisVersion";
BEGIN
  IF TG_TABLE_NAME = 'SaleCase' THEN sid := NEW.id;
  ELSE sid := NEW."saleCaseId";
  END IF;
  SELECT * INTO s FROM vamotors."SaleCase" WHERE id = sid;
  SELECT * INTO sc FROM vamotors."SaleCompletion" WHERE "saleCaseId" = sid;
  SELECT * INTO p FROM vamotors."PurchaseRecord" WHERE id = s."purchaseRecordId";
  SELECT * INTO v FROM vamotors."Vehicle" WHERE id = p."vehicleId";
  SELECT * INTO t FROM vamotors."TradeInConsideration" WHERE "saleCaseId" = sid;

  IF s.id IS NULL OR sc.id IS NULL OR sc."purchaseRecordId" <> s."purchaseRecordId"
     OR sc."agreedPrice" IS NULL OR p.id IS NULL OR p.status <> 'SOLD' OR p.available
     OR p."closedAt" IS NULL OR v."activePurchaseId" = p.id
     OR EXISTS (SELECT 1 FROM vamotors."Disposal" d WHERE d."cycleId" = p.id)
     OR EXISTS (SELECT 1 FROM vamotors."RepairRecord" r WHERE r."cycleId" = p.id AND r."returnedDate" IS NULL) THEN
    RAISE EXCEPTION 'INVALID_SALE_GRAPH' USING ERRCODE = '23514';
  END IF;

  -- Check SaleCase opening / below-listed approval
  SELECT * INTO b FROM vamotors."CycleBasisVersion" WHERE id = sc."basisVersionId" AND "cycleId" = p.id;
  IF b.id IS NULL OR sc."originalProfit" IS DISTINCT FROM (sc."agreedPrice"::numeric - b.total::numeric) THEN
    RAISE EXCEPTION 'INVALID_SALE_COMPLETION_PROFIT' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vamotors."MileageReading" m WHERE m."sourceSaleCompletionId" = sc.id AND m."cycleId" = p.id AND m."vehicleId" = p."vehicleId" AND m.reading = sc."handoverMileage" AND m."recordedDate" = sc."saleDate" AND m."commandId" = sc."commandId") THEN
    RAISE EXCEPTION 'INVALID_SALE_MILEAGE' USING ERRCODE = '23514';
  END IF;
  IF TG_TABLE_NAME = 'SaleReceipt' THEN
    IF NOT EXISTS (SELECT 1 FROM vamotors."SaleCase" x WHERE x.id = sid AND x.xmin = pg_current_xact_id()::xid)
       OR NOT EXISTS (SELECT 1 FROM vamotors."CommandReceipt" x WHERE x.id = NEW."commandId" AND x.xmin = pg_current_xact_id()::xid)
       OR (NEW."commandId" <> s."commandId" AND NOT EXISTS (
         SELECT 1 FROM vamotors."SaleCorrection" x
         WHERE x."saleCaseId" = sid AND x."commandId" = NEW."commandId"
           AND x.xmin = pg_current_xact_id()::xid
       )) THEN
      RAISE EXCEPTION 'SALE_RECEIPT_COMMAND_REQUIRED' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF s."listedSnapshot" IS NOT NULL AND sc."agreedPrice" < s."listedSnapshot" THEN
    SELECT * INTO a FROM vamotors."ApprovalRequest" WHERE id = s."approvalId";
    IF a.id IS NULL OR a.kind <> 'DISCOUNT' OR a.state <> 'APPROVED' OR a."cycleId" <> p.id
       OR s."approvalId" IS DISTINCT FROM sc."approvalId" OR a."appliedCommandId" IS DISTINCT FROM s."commandId"
       OR a."reviewedBy" = a."requestedBy" THEN
      RAISE EXCEPTION 'BELOW_LISTED_APPROVAL_REQUIRED' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF s."approvalId" IS NOT NULL OR sc."approvalId" IS NOT NULL THEN
      RAISE EXCEPTION 'UNEXPECTED_DISCOUNT_APPROVAL' USING ERRCODE = '23514';
    END IF;
  END IF;

  -- Check Trade-In consideration vs receipts
  IF s.kind = 'CASH' THEN
    IF t.id IS NOT NULL THEN RAISE EXCEPTION 'UNEXPECTED_TRADEIN' USING ERRCODE = '23514'; END IF;
  ELSIF s.kind = 'TRADE_IN' THEN
    IF t.id IS NULL OR t."purchaseRecordId" <> s."purchaseRecordId" OR t."customerId" <> s."customerId" OR t.value > s."agreedPrice" THEN
      RAISE EXCEPTION 'INVALID_TRADEIN_CONSIDERATION' USING ERRCODE = '23514';
    END IF;
    IF t."acquiredPurchaseId" IS NOT NULL THEN
      SELECT * INTO ap FROM vamotors."PurchaseRecord" WHERE id = t."acquiredPurchaseId";
      IF ap.id IS NULL OR ap."acquisitionKind" <> 'TRADE_IN' OR ap."tradeInSourceSaleId" <> s.id OR ap."sellerCustomerId" <> s."customerId" OR ap."vehicleId" <> t."acquiredVehicleId" OR ap."vehicleId" = p."vehicleId" THEN
        RAISE EXCEPTION 'INVALID_TRADEIN_LINK' USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  -- Check active command evidence on whichever part mutated in this tx
  IF EXISTS (SELECT 1 FROM vamotors."SaleCase" x WHERE x.id = sid AND x.xmin = pg_current_xact_id()::xid) THEN
    SELECT * INTO c FROM vamotors."CommandReceipt" WHERE "businessSequence" = (SELECT value FROM vamotors."BusinessSequence" WHERE id = 1) AND xmin = pg_current_xact_id()::xid;
    IF c.id IS NULL OR c."environmentId" <> (SELECT id FROM vamotors."Environment" WHERE singleton = 1) OR c."actorKey" NOT LIKE 'USER:%' THEN
      RAISE EXCEPTION 'SALE_COMMAND_REQUIRED' USING ERRCODE = '23514';
    END IF;
    uid := substring(c."actorKey" FROM 6)::uuid;

    IF s."commandId" = c.id AND EXISTS (SELECT 1 FROM vamotors."SaleCompletion" x WHERE x.id = sc.id AND x.xmin = pg_current_xact_id()::xid) THEN
      IF c."commandName" NOT IN ('completeImmediate', 'reviewApproval') THEN RAISE EXCEPTION 'INVALID_SALE_OPEN_COMMAND' USING ERRCODE = '23514'; END IF;
      SELECT coalesce(sum(amount::numeric), 0) INTO r_in FROM vamotors."SaleReceipt" WHERE "saleCaseId" = sid AND "commandId" = c.id AND direction = 'IN';
      IF r_in <> s."agreedPrice"::numeric - coalesce(t.value::numeric, 0) THEN
        RAISE EXCEPTION 'INVALID_SALE_OPEN_RECEIPT' USING ERRCODE = '23514';
      END IF;
      IF r_in = 0 AND EXISTS (SELECT 1 FROM vamotors."SaleReceipt" WHERE "saleCaseId" = sid AND "commandId" = c.id) THEN
        RAISE EXCEPTION 'ZERO_NET_NO_RECEIPT' USING ERRCODE = '23514';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM vamotors."StatusEvent" st WHERE st."cycleId" = p.id AND st."commandId" = c.id AND st."from" = 'IN_STOCK' AND st."to" = 'SOLD' AND st.xmin = pg_current_xact_id()::xid)
         OR NOT EXISTS (SELECT 1 FROM vamotors."EntityReadVersion" e WHERE e."entityType" = 'SaleCase' AND e."entityId" = sid AND e."commandId" = c.id AND e.revision = s.revision AND e.xmin = pg_current_xact_id()::xid)
         OR NOT EXISTS (SELECT 1 FROM vamotors."AuditEntry" ae WHERE ae."entityType" = 'SaleCase' AND ae."entityId" = sid AND ae."commandId" = c.id AND ae.xmin = pg_current_xact_id()::xid) THEN
        RAISE EXCEPTION 'INVALID_SALE_OPEN_EVIDENCE' USING ERRCODE = '23514';
      END IF;
    ELSIF t.id IS NOT NULL AND t."intakeCommandId" = c.id AND c."commandName" = 'intakeTradeIn' THEN
      IF NOT EXISTS (SELECT 1 FROM vamotors."PurchaseRecord" ap_x WHERE ap_x.id = t."acquiredPurchaseId" AND ap_x.xmin = pg_current_xact_id()::xid)
         OR NOT EXISTS (SELECT 1 FROM vamotors."EntityReadVersion" e WHERE e."entityType" = 'SaleCase' AND e."entityId" = sid AND e."commandId" = c.id AND e.revision = s.revision AND e.xmin = pg_current_xact_id()::xid) THEN
        RAISE EXCEPTION 'INVALID_TRADEIN_INTAKE_EVIDENCE' USING ERRCODE = '23514';
      END IF;
    ELSIF c."commandName" = 'reviewApproval' THEN
      SELECT * INTO corr FROM vamotors."SaleCorrection" WHERE "saleCaseId" = sid AND "commandId" = c.id AND xmin = pg_current_xact_id()::xid;
      IF corr.id IS NULL THEN RAISE EXCEPTION 'SALE_CORRECTION_REQUIRED' USING ERRCODE = '23514'; END IF;
      SELECT * INTO a FROM vamotors."ApprovalRequest" WHERE id = corr."approvalId" AND kind = 'SALE_EDIT' AND state = 'APPROVED' AND "saleCaseId" = sid AND "appliedCommandId" = c.id AND "reviewedBy" <> "requestedBy" AND xmin = pg_current_xact_id()::xid;
      IF a.id IS NULL THEN RAISE EXCEPTION 'SALE_EDIT_APPROVAL_REQUIRED' USING ERRCODE = '23514'; END IF;
      SELECT * INTO latest_b FROM vamotors."CycleBasisVersion" WHERE "cycleId" = p.id ORDER BY version DESC LIMIT 1;
      IF corr."basisVersionId" <> latest_b.id OR corr."restatedProfit" IS DISTINCT FROM (s."agreedPrice"::numeric - latest_b.total::numeric) THEN
        RAISE EXCEPTION 'INVALID_SALE_CORRECTION_PROFIT' USING ERRCODE = '23514';
      END IF;
    ELSE
      RAISE EXCEPTION 'UNAUTHORIZED_SALE_MUTATION' USING ERRCODE = '23514';
    END IF;
  END IF;

  -- Completed sale cash must always equal agreedPrice - tradeIn.value, including
  -- after approved append-only receipt reversals/replacements.
  IF s.state = 'COMPLETED' THEN
    SELECT coalesce(sum(CASE direction WHEN 'IN' THEN amount::numeric ELSE -amount::numeric END), 0) INTO r_in FROM vamotors."SaleReceipt" WHERE "saleCaseId" = sid;
    IF r_in < 0 THEN RAISE EXCEPTION 'NEGATIVE_SALE_RECEIPTS' USING ERRCODE = '23514'; END IF;
    IF r_in <> s."agreedPrice"::numeric - coalesce(t.value::numeric, 0) THEN
      RAISE EXCEPTION 'SALE_BALANCE_MISMATCH' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER sale_case_graph AFTER INSERT OR UPDATE ON vamotors."SaleCase" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vamotors.check_sale_graph();
CREATE CONSTRAINT TRIGGER sale_receipt_graph AFTER INSERT ON vamotors."SaleReceipt" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vamotors.check_sale_graph();
CREATE CONSTRAINT TRIGGER sale_completion_graph AFTER INSERT ON vamotors."SaleCompletion" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vamotors.check_sale_graph();
CREATE CONSTRAINT TRIGGER sale_correction_graph AFTER INSERT ON vamotors."SaleCorrection" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vamotors.check_sale_graph();
CREATE CONSTRAINT TRIGGER tradein_graph AFTER INSERT OR UPDATE ON vamotors."TradeInConsideration" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vamotors.check_sale_graph();

-- 9. Update Approval origin & graph trigger for WRITE_OFF, DISCOUNT, SALE_EDIT
CREATE OR REPLACE FUNCTION vamotors.approval_origin(uid uuid, a vamotors."ApprovalRequest", p vamotors."PurchaseRecord", v vamotors."Vehicle", reviewing boolean) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE cycle_data jsonb; vehicle_data jsonb; cust_id uuid; cust_data jsonb; sale_row vamotors."SaleCase"; sale_data jsonb; cust_patch uuid;
BEGIN
  cycle_data := to_jsonb(p);
  vehicle_data := to_jsonb(v) || jsonb_build_object('status', p.status);
  IF NOT vamotors.approval_fields(uid, 'PurchaseRecord', 'read', cycle_data, ARRAY['id','revision','vehicleId','status','available','closedAt'])
     OR NOT vamotors.approval_fields(uid, 'Vehicle', 'read', vehicle_data, ARRAY['id','identityRevision']) THEN
    RETURN false;
  END IF;
  IF EXISTS (SELECT 1 FROM vamotors."RepairRecord" r WHERE r."cycleId" = p.id AND (NOT vamotors.approval_fields(uid, 'PurchaseRecord', 'read', cycle_data, ARRAY['repairs']) OR NOT vamotors.approval_fields(uid, 'RepairRecord', 'read', to_jsonb(r), ARRAY['id','returnedDate','invoiceAmount','payments.amount','payments.direction']))) THEN
    RETURN false;
  END IF;
  -- A pending proposal continues to require the requester's current ApprovalRequest.create
  -- authority; the reviewer path keeps its separate approve grant.
  IF NOT reviewing AND NOT vamotors.approval_fields(uid, 'ApprovalRequest', 'create', jsonb_build_object('createdBy', a."requestedBy"), ARRAY['proposal','proposal.kind']) THEN
    RETURN false;
  END IF;

  IF a.kind = 'WRITE_OFF' THEN
    IF EXISTS (SELECT 1 FROM vamotors."SaleCase" s WHERE s."purchaseRecordId" = p.id AND s.state <> 'CANCELLED') THEN
      RETURN false;
    END IF;
    IF NOT vamotors.approval_fields(uid, 'PurchaseRecord', 'read', cycle_data, ARRAY['purchasePrice','purchaseType','listedPrice','financial.basis','financial.currency','financial.scale','costs.id','costs.amount','payments.amount','payments.direction'] || CASE WHEN p."purchaseType" = 'LEASE_SETTLEMENT' THEN ARRAY['settlement.institutionType','settlement.companyId','settlement.institutionNameSnapshot','settlement.amount','settlement.cashToSeller'] ELSE ARRAY[]::text[] END) THEN
      RETURN false;
    END IF;
    IF reviewing THEN
      RETURN vamotors.approval_fields(uid, 'PurchaseRecord', 'update', cycle_data, ARRAY['cycleId'])
        AND vamotors.approval_fields(uid, 'Disposal', 'create', jsonb_build_object('createdBy', uid), ARRAY['cycleId','date','reason','method','proceeds'] || CASE WHEN (a.proposal#>>'{input,proceeds}') <> '0' THEN ARRAY['receipt.amount','receipt.date','receipt.method'] || CASE WHEN (a.proposal->'input'->'receipt') ? 'reference' THEN ARRAY['receipt.reference'] ELSE ARRAY[]::text[] END ELSE ARRAY[]::text[] END)
        AND ((a.proposal#>>'{input,proceeds}') = '0' OR vamotors.approval_fields(uid, 'Disposal', 'pay', jsonb_build_object('createdBy', uid), ARRAY['receipt.amount','receipt.date','receipt.method'] || CASE WHEN (a.proposal->'input'->'receipt') ? 'reference' THEN ARRAY['receipt.reference'] ELSE ARRAY[]::text[] END));
    END IF;
    RETURN true;

  ELSIF a.kind = 'DISCOUNT' THEN
    cust_id := (a.proposal#>>'{command,input,customerId}')::uuid;
    IF NOT vamotors.approval_fields(uid, 'PurchaseRecord', 'read', cycle_data, ARRAY['listedPrice','purchasePrice','financial.basis']) THEN
      RETURN false;
    END IF;
    SELECT to_jsonb(cu) INTO cust_data FROM vamotors."Customer" cu WHERE cu.id = cust_id;
    IF cust_data IS NULL OR NOT vamotors.approval_fields(uid, 'Customer', 'read', cust_data, ARRAY['id','revision','active']) THEN
      RETURN false;
    END IF;
    cycle_data := jsonb_build_object('createdBy', CASE WHEN reviewing THEN a."requestedBy" ELSE uid END, 'customerId', cust_id);
    IF NOT vamotors.approval_fields(uid, 'SaleCase', 'create', cycle_data,
      ARRAY['cycleId','customerId','kind','price','date','mileage','method']
      || CASE WHEN (a.proposal#>'{command,input}') ? 'reference' THEN ARRAY['reference'] ELSE ARRAY[]::text[] END
      || CASE WHEN (a.proposal#>'{command,input}') ? 'reason' THEN ARRAY['reason'] ELSE ARRAY[]::text[] END
      || CASE WHEN (a.proposal#>>'{command,input,kind}') = 'TRADE_IN' THEN
           ARRAY['tradeIn.description','tradeIn.value']
           || CASE WHEN (a.proposal#>'{command,input,tradeIn}') ? 'intake' THEN
                ARRAY['tradeIn.intake.vehicle','tradeIn.intake.mileage']
                || CASE WHEN (a.proposal#>'{command,input,tradeIn,intake}') ? 'listedPrice' THEN ARRAY['tradeIn.intake.listedPrice'] ELSE ARRAY[]::text[] END
              ELSE ARRAY[]::text[] END
         ELSE ARRAY[]::text[] END) THEN
      RETURN false;
    END IF;
    IF ((a.proposal#>>'{command,input,price}')::numeric - coalesce((a.proposal#>>'{command,input,tradeIn,value}')::numeric, 0)) <> 0
       AND NOT vamotors.approval_fields(uid, 'SaleCase', 'pay', cycle_data,
         ARRAY['amount','date','method']
         || CASE WHEN (a.proposal#>'{command,input}') ? 'reference' THEN ARRAY['reference'] ELSE ARRAY[]::text[] END) THEN
      RETURN false;
    END IF;
    IF (a.proposal#>'{command,input,tradeIn}') ? 'intake'
       AND NOT vamotors.approval_fields(uid, 'PurchaseRecord', 'create',
         jsonb_build_object('createdBy', uid, 'status', 'PURCHASED'),
         ARRAY['vehicle','purchaseDate','purchasePrice','mileage']
         || CASE WHEN (a.proposal#>'{command,input,tradeIn,intake}') ? 'listedPrice' THEN ARRAY['listedPrice'] ELSE ARRAY[]::text[] END) THEN
      RETURN false;
    END IF;
    RETURN true;

  ELSIF a.kind = 'SALE_EDIT' THEN
    SELECT * INTO sale_row FROM vamotors."SaleCase" WHERE id = a."saleCaseId";
    IF sale_row.id IS NULL THEN RETURN false; END IF;
    sale_data := to_jsonb(sale_row);
    IF NOT vamotors.approval_fields(uid, 'SaleCase', 'read', sale_data, ARRAY['id','revision','cycleId','customerId','kind','state','price','payments.id','payments.amount','payments.direction']) THEN
      RETURN false;
    END IF;
    IF (a.proposal#>'{input,patch}') ? 'customerId' THEN
      cust_patch := (a.proposal#>>'{input,patch,customerId}')::uuid;
      SELECT to_jsonb(cu) INTO cust_data FROM vamotors."Customer" cu WHERE cu.id = cust_patch;
      IF cust_data IS NULL OR NOT vamotors.approval_fields(uid, 'Customer', 'read', cust_data, ARRAY['id','revision','active']) THEN
        RETURN false;
      END IF;
    END IF;
    IF reviewing THEN
      RETURN vamotors.approval_fields(uid, 'SaleCase', 'update', sale_data, ARRAY['saleId','reason']);
    END IF;
    RETURN true;
  END IF;
  RETURN false;
END $$;

CREATE OR REPLACE FUNCTION vamotors.check_approval_graph() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE a vamotors."ApprovalRequest"; p vamotors."PurchaseRecord"; v vamotors."Vehicle"; b vamotors."CycleBasisVersion"; c vamotors."CommandReceipt"; i jsonb; expected jsonb; snap jsonb; after_dto jsonb; old_dto jsonb; recipients jsonb; uid uuid; s vamotors."SaleCase";
  audit_paths text[] := ARRAY[
    'id','revision','proposal.kind','proposal.operation',
    'proposal.input.cycleId','proposal.input.date','proposal.input.reason','proposal.input.method',
    'proposal.input.proceeds','proposal.input.receipt.amount','proposal.input.receipt.date',
    'proposal.input.receipt.method','proposal.input.receipt.reference',
    'proposal.command','proposal.command.name','proposal.command.input',
    'proposal.command.input.cycleId','proposal.command.input.customerId','proposal.command.input.kind',
    'proposal.command.input.price','proposal.command.input.date','proposal.command.input.mileage',
    'proposal.command.input.method','proposal.command.input.reference','proposal.command.input.reason',
    'proposal.command.input.tradeIn','proposal.command.input.tradeIn.description',
    'proposal.command.input.tradeIn.value','proposal.command.input.tradeIn.intake',
    'proposal.command.input.tradeIn.intake.vehicle','proposal.command.input.tradeIn.intake.mileage',
    'proposal.command.input.tradeIn.intake.listedPrice',
    'proposal.input.saleId','proposal.input.patch.customerId','proposal.input.patch.price',
    'proposal.input.patch.reference','proposal.input.patch.saleDate','proposal.input.patch.handoverMileage',
    'proposal.input.patch.notes','proposal.input.patch.tradeIn','proposal.input.patch.tradeIn.description',
    'proposal.input.patch.tradeIn.value','proposal.input.cashCorrections',
    'expected','payloadHash','reason','requestedBy','requestedAt','state',
    'reviewedBy','reviewedAt','reviewNote','appliedCommandId'
  ];
BEGIN
  SELECT * INTO a FROM vamotors."ApprovalRequest" WHERE id = NEW.id;
  SELECT * INTO p FROM vamotors."PurchaseRecord" WHERE id = a."cycleId";
  SELECT * INTO v FROM vamotors."Vehicle" WHERE id = p."vehicleId";
  SELECT * INTO b FROM vamotors."CycleBasisVersion" WHERE "cycleId" = p.id ORDER BY version DESC LIMIT 1;

  IF p."acquisitionCommandId" IS NULL OR b.id IS NULL THEN
    RAISE EXCEPTION 'INVALID_APPROVAL_PAYLOAD' USING ERRCODE = '23514';
  END IF;

  IF a.kind = 'WRITE_OFF' THEN
    i := a.proposal->'input';
    IF EXISTS (SELECT 1 FROM vamotors."SaleCase" WHERE "purchaseRecordId" = p.id AND state <> 'CANCELLED') THEN
      RAISE EXCEPTION 'SALE_OBLIGATION_OPEN' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM vamotors."RepairRecord" WHERE "cycleId" = p.id AND "returnedDate" IS NULL) THEN
      RAISE EXCEPTION 'REPAIR_OBLIGATION_OPEN' USING ERRCODE = '23514';
    END IF;
    IF jsonb_typeof(a.proposal) IS DISTINCT FROM 'object' OR a.proposal->>'kind' IS DISTINCT FROM 'WRITE_OFF' OR a.proposal - ARRAY['kind','input'] <> '{}'::jsonb
       OR jsonb_typeof(i) IS DISTINCT FROM 'object' OR i - ARRAY['cycleId','date','reason','method','proceeds','receipt'] <> '{}'::jsonb
       OR EXISTS (SELECT 1 FROM unnest(ARRAY['cycleId','date','reason','method','proceeds']) k WHERE jsonb_typeof(i->k) IS DISTINCT FROM 'string')
       OR i->>'cycleId' <> p.id::text OR NOT (i ?& ARRAY['cycleId','date','reason','method','proceeds'])
       OR i->>'method' NOT IN ('SCRAPPED','AUCTIONED','DONATED','OTHER')
       OR i->>'proceeds' !~ '^(0|[1-9][0-9]{0,13})$'
       OR i->>'reason' IS NULL OR i->>'reason' <> btrim(i->>'reason') OR length(i->>'reason') NOT BETWEEN 1 AND 2000
       OR i->>'date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR (i->>'date')::date < p."purchaseDate" OR (i->>'date')::date > (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Colombo')::date
       OR (i->>'proceeds' = '0' AND i ? 'receipt')
       OR ((i->>'proceeds')::numeric > 0 AND (NOT (i ? 'receipt') OR i#>>'{receipt,amount}' IS DISTINCT FROM i->>'proceeds'))
       OR (i ? 'receipt' AND (
         jsonb_typeof(i->'receipt') IS DISTINCT FROM 'object' OR (i->'receipt') - ARRAY['amount','date','method','reference'] <> '{}'::jsonb
         OR NOT ((i->'receipt') ?& ARRAY['amount','date','method'])
         OR EXISTS (SELECT 1 FROM jsonb_each(i->'receipt') e WHERE jsonb_typeof(e.value) IS DISTINCT FROM 'string')
         OR i#>>'{receipt,date}' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
         OR i#>>'{receipt,method}' NOT IN ('CASH','BANK_TRANSFER')
         OR (i#>>'{receipt,date}')::date > (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Colombo')::date
         OR ((i->'receipt') ? 'reference' AND (i#>>'{receipt,reference}' <> btrim(i#>>'{receipt,reference}') OR length(i#>>'{receipt,reference}') NOT BETWEEN 1 AND 200))
       )) THEN
      RAISE EXCEPTION 'INVALID_APPROVAL_PAYLOAD' USING ERRCODE = '23514';
    END IF;
    snap := jsonb_strip_nulls(jsonb_build_object('cycleId', p.id, 'vehicleId', v.id, 'basisVersionId', b.id, 'basis', b.total::text, 'currency', b.currency, 'scale', b.scale, 'purchasePrice', p."purchasePrice"::text, 'purchaseType', p."purchaseType", 'settlement', vamotors.settlement_json(p.id), 'listedPrice', p."listedPrice"::text));
    IF a.snapshot IS DISTINCT FROM snap THEN RAISE EXCEPTION 'APPROVAL_BINDING_MISMATCH' USING ERRCODE = '23514'; END IF;
  ELSIF a.kind = 'DISCOUNT' THEN
    i := a.proposal#>'{command,input}';
    IF a."saleCaseId" IS NOT NULL OR a.proposal->>'kind' <> 'DISCOUNT' OR a.proposal#>>'{command,name}' <> 'completeImmediate'
       OR i->>'cycleId' <> p.id::text OR p."listedPrice" IS NULL OR (i->>'price')::numeric >= p."listedPrice"::numeric THEN
      RAISE EXCEPTION 'INVALID_DISCOUNT_PAYLOAD' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM vamotors."RepairRecord" WHERE "cycleId" = p.id AND "returnedDate" IS NULL) THEN
      RAISE EXCEPTION 'REPAIR_OBLIGATION_OPEN' USING ERRCODE = '23514';
    END IF;
  ELSIF a.kind = 'SALE_EDIT' THEN
    i := a.proposal->'input';
    SELECT * INTO s FROM vamotors."SaleCase" WHERE id = a."saleCaseId";
    IF s.id IS NULL OR s."purchaseRecordId" <> p.id OR s.state <> 'COMPLETED' OR a.proposal->>'kind' <> 'SALE_EDIT' OR a.proposal->>'operation' <> 'EDIT_COMPLETION' OR i->>'saleId' <> s.id::text THEN
      RAISE EXCEPTION 'INVALID_SALE_EDIT_PAYLOAD' USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'INVALID_APPROVAL_KIND' USING ERRCODE = '23514';
  END IF;

  IF a."payloadHash" <> encode(sha256(convert_to(vamotors.sale_canonical(jsonb_build_object('schemaVersion', 1, 'proposal', a.proposal, 'expected', a.expected, 'snapshot', a.snapshot, 'reason', a.reason)), 'UTF8')), 'hex') THEN
    RAISE EXCEPTION 'APPROVAL_BINDING_MISMATCH' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO c FROM vamotors."CommandReceipt" WHERE id = CASE WHEN TG_OP = 'INSERT' THEN a."requestCommandId" ELSE a."reviewCommandId" END AND xmin = pg_current_xact_id()::xid;
  IF c.id IS NULL OR c."environmentId" <> (SELECT id FROM vamotors."Environment" WHERE singleton = 1)
     OR c.result <> jsonb_build_object('type', 'ApprovalRequest', 'id', a.id, 'revision', a.revision)
     OR NOT EXISTS (SELECT 1 FROM vamotors."BusinessSequence" WHERE id = 1 AND value = c."businessSequence" AND xmin = pg_current_xact_id()::xid) THEN
    RAISE EXCEPTION 'APPROVAL_COMMAND_REQUIRED' USING ERRCODE = '23514';
  END IF;

  uid := CASE WHEN TG_OP = 'INSERT' THEN a."requestedBy" ELSE a."reviewedBy" END;
  IF c."actorKey" <> 'USER:' || uid::text OR c."commandName" <> (CASE WHEN TG_OP = 'INSERT' THEN 'requestApproval' ELSE 'reviewApproval' END) THEN
    RAISE EXCEPTION 'APPROVAL_ACTOR_MISMATCH' USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF a.state <> 'PENDING'
       OR (a.kind IN ('WRITE_OFF', 'DISCOUNT') AND (p."closedAt" IS NOT NULL OR v."activePurchaseId" IS DISTINCT FROM p.id OR EXISTS (SELECT 1 FROM vamotors."PurchaseRecord" WHERE id = p.id AND xmin = pg_current_xact_id()::xid) OR EXISTS (SELECT 1 FROM vamotors."Vehicle" WHERE id = v.id AND xmin = pg_current_xact_id()::xid)))
       OR (a.kind = 'WRITE_OFF' AND p.status NOT IN ('PURCHASED', 'IN_STOCK'))
       OR (a.kind = 'DISCOUNT' AND (p.status <> 'IN_STOCK' OR NOT p.available))
       OR (a.kind = 'SALE_EDIT' AND p.status <> 'SOLD')
       OR NOT vamotors.approval_origin(uid, a, p, v, false)
       OR NOT vamotors.approval_fields(uid, 'ApprovalRequest', 'create', jsonb_build_object('createdBy', uid), ARRAY['proposal','proposal.kind','reason']) THEN
      RAISE EXCEPTION 'INVALID_PENDING_APPROVAL' USING ERRCODE = '23514';
    END IF;
    SELECT coalesce(jsonb_agg(u.id::text ORDER BY u.id), '[]'::jsonb) INTO recipients FROM vamotors."user" u WHERE u.active AND u.id <> uid AND vamotors.approval_origin(u.id, a, p, v, true) AND vamotors.approval_fields(u.id, 'ApprovalRequest', 'approve', jsonb_build_object('createdBy', uid), ARRAY['approvalId','decision']);
    IF recipients = '[]'::jsonb OR recipients IS DISTINCT FROM a."requiredRecipientIds"
       OR (SELECT coalesce(jsonb_agg(n."recipientUserId"::text ORDER BY n."recipientUserId"), '[]'::jsonb) FROM vamotors."Notification" n WHERE n."targetId" = a.id AND n.kind = 'APPROVAL_REQUIRED' AND n."targetType" = 'ApprovalRequest' AND n."eventKey" = 'approval:required:' || a.id::text || ':1' AND n.xmin = pg_current_xact_id()::xid) IS DISTINCT FROM recipients THEN
      RAISE EXCEPTION 'APPROVAL_RECIPIENT_REQUIRED' USING ERRCODE = '23514';
    END IF;
    old_dto := NULL;
  ELSE
    IF NOT vamotors.approval_origin(uid, a, p, v, true) OR NOT vamotors.approval_origin(a."requestedBy", a, p, v, false)
       OR NOT vamotors.approval_fields(uid, 'ApprovalRequest', 'approve', jsonb_build_object('createdBy', a."requestedBy"), ARRAY['approvalId','decision'] || CASE WHEN a."reviewNote" IS NULL THEN ARRAY[]::text[] ELSE ARRAY['note'] END)
       OR a."reviewerName" IS DISTINCT FROM (SELECT name FROM vamotors."user" WHERE id = uid AND active)
       OR (SELECT count(*) FROM vamotors."Notification" n WHERE n."recipientUserId" = a."requestedBy" AND n."targetType" = 'ApprovalRequest' AND n."targetId" = a.id AND n.kind = 'APPROVAL_OUTCOME' AND n."eventKey" = 'approval:outcome:' || a.id::text || ':2' AND n.xmin = pg_current_xact_id()::xid) <> 1 THEN
      RAISE EXCEPTION 'INVALID_APPROVAL_REVIEW' USING ERRCODE = '23514';
    END IF;
    IF a.state = 'REJECTED' THEN
      IF (a.kind IN ('WRITE_OFF','DISCOUNT') AND (p."closedAt" IS NOT NULL OR v."activePurchaseId" IS DISTINCT FROM p.id))
         OR EXISTS (SELECT 1 FROM vamotors."Disposal" WHERE "approvalId" = a.id)
         OR EXISTS (SELECT 1 FROM vamotors."SaleCase" WHERE "approvalId" = a.id)
         OR EXISTS (SELECT 1 FROM vamotors."SaleCorrection" WHERE "approvalId" = a.id) THEN
        RAISE EXCEPTION 'REJECTION_DOMAIN_EFFECT' USING ERRCODE = '23514';
      END IF;
    END IF;
    IF a.state = 'APPROVED' THEN
      IF a.kind = 'WRITE_OFF' AND NOT EXISTS (SELECT 1 FROM vamotors."Disposal" d WHERE d."approvalId" = a.id AND d."commandId" = c.id AND d.xmin = pg_current_xact_id()::xid) THEN
        RAISE EXCEPTION 'APPROVAL_APPLICATION_REQUIRED' USING ERRCODE = '23514';
      ELSIF a.kind = 'DISCOUNT' AND (NOT EXISTS (SELECT 1 FROM vamotors."SaleCase" x WHERE x."approvalId" = a.id AND x."commandId" = c.id AND x.xmin = pg_current_xact_id()::xid) OR NOT EXISTS (SELECT 1 FROM vamotors."SaleCompletion" x WHERE x."approvalId" = a.id AND x."commandId" = c.id AND x.xmin = pg_current_xact_id()::xid)) THEN
        RAISE EXCEPTION 'APPROVAL_APPLICATION_REQUIRED' USING ERRCODE = '23514';
      ELSIF a.kind = 'SALE_EDIT' AND NOT EXISTS (SELECT 1 FROM vamotors."SaleCorrection" x WHERE x."approvalId" = a.id AND x."commandId" = c.id AND x.xmin = pg_current_xact_id()::xid) THEN
        RAISE EXCEPTION 'APPROVAL_APPLICATION_REQUIRED' USING ERRCODE = '23514';
      END IF;
    END IF;
    old_dto := vamotors.approval_dto(OLD);
  END IF;

  after_dto := vamotors.approval_dto(a);
  IF NOT EXISTS (SELECT 1 FROM vamotors."EntityReadVersion" e WHERE e."entityType" = 'ApprovalRequest' AND e."entityId" = a.id AND e."commandId" = c.id AND e.revision = a.revision AND e.sequence = c."businessSequence" AND e.payload = after_dto AND e.xmin = pg_current_xact_id()::xid)
     OR NOT EXISTS (SELECT 1 FROM vamotors."AuditEntry" e WHERE e."entityType" = 'ApprovalRequest' AND e."entityId" = a.id AND e."commandId" = c.id AND e."actorKind" = 'USER' AND e."userId" = uid AND e."initiatedBy" = a."requestedBy" AND e."approverId" IS NOT DISTINCT FROM CASE WHEN TG_OP = 'INSERT' THEN NULL::uuid ELSE uid END AND e.action = c."commandName" AND e.reason = CASE WHEN TG_OP = 'INSERT' THEN a.reason ELSE coalesce(a."reviewNote", a.reason) END AND e."fieldDiff" = vamotors.approval_diff(old_dto, after_dto, audit_paths) AND e.xmin = pg_current_xact_id()::xid) THEN
    RAISE EXCEPTION 'INVALID_APPROVAL_EVIDENCE' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;

-- 10. Permission Freeze (v14 -> v15) and ADMINISTRATOR SaleCase Grants
DO $$
DECLARE
  v14_purchase_read jsonb := '["id","revision","vehicleId","identity","identityRevision","cycleNumber","purchaseType","acquisitionKind","seller","purchaseDate","purchasePrice","listedPrice","status","available","holdReason","receivedDate","closedAt","payments","outstanding","costs","repairs","mileage","financial","basisVersions","sales","disposal","provenance","nextActions","notes","payments.id","payments.owner.type","payments.owner.id","payments.commandId","payments.amount","payments.direction","payments.category","payments.date","payments.method","payments.recordedAt","payments.reference","payments.reversalOf","payments.reason","settlement.institutionType","settlement.companyId","settlement.institutionName","settlement.institutionNameSnapshot","settlement.reference","settlement.amount","settlement.cashToSeller","outstanding.seller","outstanding.settlement","costs.id","costs.revision","costs.category","costs.description","costs.amount","costs.incurredDate","costs.payments","costs.payments.id","costs.payments.owner.type","costs.payments.owner.id","costs.payments.commandId","costs.payments.amount","costs.payments.direction","costs.payments.category","costs.payments.date","costs.payments.method","costs.payments.recordedAt","costs.payments.reference","costs.payments.reversalOf","costs.payments.reason","costs.outstanding","costs.provenance","basisVersions.id","basisVersions.version","basisVersions.total","basisVersions.reason","identity.engineNumber","identity.chassisNumber","identity.make","identity.model","identity.year","identity.colour","identity.fuelType","identity.transmission","identity.vin","identity.crNumber","identity.notes","financial.currency","financial.scale","financial.purchase","financial.repairs","financial.additionalCosts","financial.basis","financial.cashIn","financial.cashOut","financial.net"]'::jsonb;
  v14_purchase_financial jsonb := '["financial.currency","financial.scale","financial.purchase","financial.repairs","financial.additionalCosts","financial.basis","financial.cashIn","financial.cashOut","financial.net"]'::jsonb;
  v14_approval_read jsonb := '["id","revision","proposal.kind","proposal.input.cycleId","proposal.input.date","proposal.input.reason","proposal.input.method","proposal.input.proceeds","proposal.input.receipt.amount","proposal.input.receipt.date","proposal.input.receipt.method","proposal.input.receipt.reference","expected","payloadHash","reason","requestedBy","requestedAt","state","reviewedBy","reviewedAt","reviewNote","appliedCommandId"]'::jsonb;
  v14_approval_create jsonb := '["proposal.kind","proposal.input.cycleId","proposal.input.date","proposal.input.reason","proposal.input.method","proposal.input.proceeds","proposal.input.receipt.amount","proposal.input.receipt.date","proposal.input.receipt.method","proposal.input.receipt.reference","reason"]'::jsonb;
  v14_approval_proposal jsonb := '["proposal.kind","proposal.input.cycleId","proposal.input.date","proposal.input.reason","proposal.input.method","proposal.input.proceeds","proposal.input.receipt.amount","proposal.input.receipt.date","proposal.input.receipt.method","proposal.input.receipt.reference"]'::jsonb;
  protected_permissions text; protected_role text; temporary text;
  rp record; expanded_fields jsonb; next_rule jsonb; next_hash text; pid uuid; admin_id uuid; new_rule jsonb;
BEGIN
  IF EXISTS (SELECT 1 FROM vamotors."Permission" p WHERE p.rule->>'subject' = 'SaleCase') THEN
    RAISE EXCEPTION 'UNEXPECTED_PARENT_SALECASE_GRANT';
  END IF;
  IF EXISTS (SELECT 1 FROM vamotors."Permission" p WHERE p."ruleHash" <> encode(sha256(convert_to(vamotors.sale_canonical(p.rule), 'UTF8')), 'hex')) THEN
    RAISE EXCEPTION 'INVALID_PARENT_HASH';
  END IF;

  SELECT pg_get_functiondef('vamotors.protect_admin_permissions()'::regprocedure) INTO protected_permissions;
  SELECT pg_get_functiondef('vamotors.protect_system_role()'::regprocedure) INTO protected_role;
  temporary := replace(protected_permissions, 'BEGIN', E'BEGIN\n IF current_user=''vamotors_migrator'' THEN RETURN CASE WHEN TG_OP=''DELETE'' THEN OLD ELSE NEW END; END IF;');
  IF temporary = protected_permissions THEN RAISE EXCEPTION 'SALE_PERMISSION_GUARD_MISMATCH'; END IF;
  EXECUTE temporary;
  temporary := replace(protected_role, 'BEGIN', E'BEGIN\n IF current_user=''vamotors_migrator'' AND TG_OP=''UPDATE'' AND NEW.revision=OLD.revision+1 AND (to_jsonb(NEW)-''revision'')=(to_jsonb(OLD)-''revision'') THEN RETURN NEW; END IF;');
  IF temporary = protected_role THEN RAISE EXCEPTION 'SALE_ROLE_GUARD_MISMATCH'; END IF;
  EXECUTE temporary;

  -- Freeze existing non-ADMINISTRATOR grants against v14 field universes so v15 additions are never silently conferred
  FOR rp IN
    SELECT j."roleId", j."permissionId", p.rule
    FROM vamotors."RolePermission" j
    JOIN vamotors."Role" r ON r.id = j."roleId"
    JOIN vamotors."Permission" p ON p.id = j."permissionId"
    WHERE r."systemKey" IS DISTINCT FROM 'ADMINISTRATOR'
      AND (
        (p.rule->>'subject' = 'PurchaseRecord' AND p.rule->>'action' = 'read' AND (p.rule->'fields' ? '*' OR p.rule->'fields' ? 'financial'))
        OR (p.rule->>'subject' = 'ApprovalRequest' AND p.rule->>'action' = 'read' AND p.rule->'fields' ? '*')
        OR (p.rule->>'subject' = 'ApprovalRequest' AND p.rule->>'action' = 'create' AND (p.rule->'fields' ? '*' OR p.rule->'fields' ? 'proposal'))
      )
  LOOP
    SELECT coalesce(jsonb_agg(DISTINCT val), '[]'::jsonb) INTO expanded_fields
    FROM (
      SELECT jsonb_array_elements_text(rp.rule->'fields') AS f
    ) src
    CROSS JOIN LATERAL (
      SELECT jsonb_array_elements_text(
        CASE
          WHEN rp.rule->>'subject' = 'PurchaseRecord' AND rp.rule->>'action' = 'read' AND src.f = '*' THEN v14_purchase_read
          WHEN rp.rule->>'subject' = 'PurchaseRecord' AND rp.rule->>'action' = 'read' AND src.f = 'financial' THEN v14_purchase_financial
          WHEN rp.rule->>'subject' = 'ApprovalRequest' AND rp.rule->>'action' = 'read' AND src.f = '*' THEN v14_approval_read
          WHEN rp.rule->>'subject' = 'ApprovalRequest' AND rp.rule->>'action' = 'create' AND src.f = '*' THEN v14_approval_create
          WHEN rp.rule->>'subject' = 'ApprovalRequest' AND rp.rule->>'action' = 'create' AND src.f = 'proposal' THEN v14_approval_proposal
          ELSE jsonb_build_array(src.f)
        END
      ) AS val
    ) exp;
    next_rule := jsonb_set(rp.rule, '{fields}', expanded_fields);
    next_hash := encode(sha256(convert_to(vamotors.sale_canonical(next_rule), 'UTF8')), 'hex');
    INSERT INTO vamotors."Permission"(id, "ruleHash", rule) VALUES (gen_random_uuid(), next_hash, next_rule) ON CONFLICT ("ruleHash") DO NOTHING;
    SELECT id INTO pid FROM vamotors."Permission" p WHERE p."ruleHash" = next_hash;
    DELETE FROM vamotors."RolePermission" WHERE "roleId" = rp."roleId" AND "permissionId" = rp."permissionId";
    INSERT INTO vamotors."RolePermission"("roleId", "permissionId") VALUES (rp."roleId", pid) ON CONFLICT DO NOTHING;
    UPDATE vamotors."Role" SET revision = revision + 1 WHERE id = rp."roleId";
  END LOOP;

  -- Seed SaleCase permissions onto ADMINISTRATOR
  SELECT id INTO admin_id FROM vamotors."Role" WHERE "systemKey" = 'ADMINISTRATOR';
  IF admin_id IS NOT NULL THEN
    FOR new_rule IN
      SELECT value FROM jsonb_array_elements('[
        {"subject":"SaleCase","action":"read","fields":["*"]},
        {"subject":"SaleCase","action":"create","fields":["*"]},
        {"subject":"SaleCase","action":"update","fields":["*"]},
        {"subject":"SaleCase","action":"pay","fields":["*"]}
      ]'::jsonb)
    LOOP
      next_hash := encode(sha256(convert_to(vamotors.sale_canonical(new_rule), 'UTF8')), 'hex');
      INSERT INTO vamotors."Permission"(id, "ruleHash", rule) VALUES (gen_random_uuid(), next_hash, new_rule) ON CONFLICT ("ruleHash") DO NOTHING;
      SELECT id INTO pid FROM vamotors."Permission" p WHERE p."ruleHash" = next_hash;
      INSERT INTO vamotors."RolePermission"("roleId", "permissionId") VALUES (admin_id, pid) ON CONFLICT DO NOTHING;
    END LOOP;
    UPDATE vamotors."Role" SET revision = revision + 1 WHERE id = admin_id;
  END IF;

  EXECUTE protected_permissions;
  EXECUTE protected_role;
END $$;

SET CONSTRAINTS ALL IMMEDIATE;

REVOKE ALL ON FUNCTION vamotors.sale_canonical(jsonb), vamotors.purchase_vehicle_guard(), vamotors.cycle_edit_vehicle_graph(), vamotors.cycle_edit_mileage_graph(),
  vamotors.acquisition_root_guard(), vamotors.initial_cycle_transition(), vamotors.check_acquisition_graph(),
  vamotors.check_closed_financial(vamotors."PurchaseRecord", vamotors."PurchaseRecord"), vamotors.cycle_cost_root_graph(),
  vamotors.current_sold(uuid), vamotors.check_sale_graph(),
  vamotors.approval_origin(uuid, vamotors."ApprovalRequest", vamotors."PurchaseRecord", vamotors."Vehicle", boolean),
  vamotors.check_approval_graph() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vamotors.cycle_seller_json(vamotors."PurchaseRecord"),
  vamotors.cycle_financial_json(uuid, text, numeric, numeric),
  vamotors.sale_payments_json(uuid),
  vamotors.sale_diff(jsonb, jsonb) TO vamotors_runtime;

COMMIT;
