BEGIN;
ALTER TABLE "vamotors"."FinanceCompany" ADD COLUMN     "reconciliationWatermark" DATE;

ALTER TABLE "vamotors"."UploadIntent" ADD COLUMN     "remittanceId" UUID;

ALTER TABLE "vamotors"."Attachment" ADD COLUMN     "remittanceId" UUID;

CREATE TABLE "vamotors"."Remittance" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'STAGED',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "method" TEXT NOT NULL,
    "policyVersion" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "scale" INTEGER NOT NULL,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "commandId" UUID NOT NULL,
    "noticeAttachmentId" UUID,

    CONSTRAINT "Remittance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "vamotors"."RemittancePayment" (
    "id" UUID NOT NULL,
    "remittanceId" UUID NOT NULL,
    "discrepancyId" UUID,
    "amount" BIGINT NOT NULL,
    "occurredDate" DATE NOT NULL,
    "direction" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "reversalOf" UUID,
    "reason" TEXT,
    "commandId" UUID NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RemittancePayment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "vamotors"."NoticeLine" (
    "id" UUID NOT NULL,
    "remittanceId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "sourceType" TEXT,
    "sourceId" UUID,
    "amount" BIGINT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "NoticeLine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "vamotors"."ReconciliationRun" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "policyId" UUID NOT NULL,
    "policyVersion" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "asOfDate" DATE NOT NULL,
    "previousWatermarkDate" DATE,
    "newWatermarkDate" DATE,
    "snapshot" JSONB NOT NULL,
    "completedBy" UUID NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "commandId" UUID NOT NULL,

    CONSTRAINT "ReconciliationRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "vamotors"."CommissionAllocation" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "remittanceId" UUID NOT NULL,
    "entitlementId" UUID NOT NULL,
    "noticeLineId" UUID,
    "amount" BIGINT NOT NULL,
    "reversalOf" UUID,
    "reason" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "commandId" UUID NOT NULL,

    CONSTRAINT "CommissionAllocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "vamotors"."CommissionDiscrepancy" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "entitlementId" UUID NOT NULL,
    "remittanceId" UUID,
    "allocationId" UUID,
    "classification" TEXT NOT NULL,
    "expectedMinusAllocated" BIGINT NOT NULL,
    "resolution" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommissionDiscrepancy_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Remittance_commandId_key" ON "vamotors"."Remittance"("commandId");

CREATE UNIQUE INDEX "Remittance_noticeAttachmentId_key" ON "vamotors"."Remittance"("noticeAttachmentId");

CREATE UNIQUE INDEX "Remittance_companyId_reference_key" ON "vamotors"."Remittance"("companyId", "reference");

CREATE UNIQUE INDEX "Remittance_id_companyId_key" ON "vamotors"."Remittance"("id", "companyId");

CREATE UNIQUE INDEX "RemittancePayment_reversalOf_key" ON "vamotors"."RemittancePayment"("reversalOf");

CREATE UNIQUE INDEX "RemittancePayment_commandId_key" ON "vamotors"."RemittancePayment"("commandId");

CREATE INDEX "RemittancePayment_remittanceId_occurredDate_id_idx" ON "vamotors"."RemittancePayment"("remittanceId", "occurredDate", "id");

CREATE INDEX "RemittancePayment_occurredDate_id_idx" ON "vamotors"."RemittancePayment"("occurredDate", "id");

CREATE UNIQUE INDEX "NoticeLine_id_remittanceId_key" ON "vamotors"."NoticeLine"("id", "remittanceId");

CREATE UNIQUE INDEX "NoticeLine_remittanceId_key_key" ON "vamotors"."NoticeLine"("remittanceId", "key");

CREATE UNIQUE INDEX "ReconciliationRun_commandId_key" ON "vamotors"."ReconciliationRun"("commandId");

CREATE INDEX "ReconciliationRun_companyId_completedAt_id_idx" ON "vamotors"."ReconciliationRun"("companyId", "completedAt", "id");

CREATE UNIQUE INDEX "ReconciliationRun_id_companyId_key" ON "vamotors"."ReconciliationRun"("id", "companyId");

CREATE UNIQUE INDEX "CommissionAllocation_reversalOf_key" ON "vamotors"."CommissionAllocation"("reversalOf");

CREATE INDEX "CommissionAllocation_remittanceId_entitlementId_idx" ON "vamotors"."CommissionAllocation"("remittanceId", "entitlementId");

CREATE INDEX "CommissionAllocation_entitlementId_id_idx" ON "vamotors"."CommissionAllocation"("entitlementId", "id");

CREATE UNIQUE INDEX "allocation_discrepancy_owner_key" ON "vamotors"."CommissionAllocation"("id", "entitlementId", "remittanceId");

CREATE INDEX "CommissionDiscrepancy_entitlementId_id_idx" ON "vamotors"."CommissionDiscrepancy"("entitlementId", "id");

CREATE INDEX "CommissionDiscrepancy_remittanceId_id_idx" ON "vamotors"."CommissionDiscrepancy"("remittanceId", "id");

CREATE UNIQUE INDEX "CommissionDiscrepancy_id_remittanceId_key" ON "vamotors"."CommissionDiscrepancy"("id", "remittanceId");

CREATE UNIQUE INDEX "CommissionEntitlement_id_companyId_key" ON "vamotors"."CommissionEntitlement"("id", "companyId");

ALTER TABLE "vamotors"."UploadIntent" ADD CONSTRAINT "UploadIntent_remittanceId_fkey" FOREIGN KEY ("remittanceId") REFERENCES "vamotors"."Remittance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vamotors"."Attachment" ADD CONSTRAINT "Attachment_remittanceId_fkey" FOREIGN KEY ("remittanceId") REFERENCES "vamotors"."Remittance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vamotors"."Remittance" ADD CONSTRAINT "Remittance_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "vamotors"."FinanceCompany"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vamotors"."Remittance" ADD CONSTRAINT "Remittance_commandId_fkey" FOREIGN KEY ("commandId") REFERENCES "vamotors"."CommandReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vamotors"."Remittance" ADD CONSTRAINT "Remittance_noticeAttachmentId_fkey" FOREIGN KEY ("noticeAttachmentId") REFERENCES "vamotors"."Attachment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vamotors"."RemittancePayment" ADD CONSTRAINT "RemittancePayment_remittanceId_fkey" FOREIGN KEY ("remittanceId") REFERENCES "vamotors"."Remittance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vamotors"."RemittancePayment" ADD CONSTRAINT "RemittancePayment_discrepancyId_remittanceId_fkey" FOREIGN KEY ("discrepancyId", "remittanceId") REFERENCES "vamotors"."CommissionDiscrepancy"("id", "remittanceId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vamotors"."RemittancePayment" ADD CONSTRAINT "RemittancePayment_reversalOf_fkey" FOREIGN KEY ("reversalOf") REFERENCES "vamotors"."RemittancePayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vamotors"."RemittancePayment" ADD CONSTRAINT "RemittancePayment_commandId_fkey" FOREIGN KEY ("commandId") REFERENCES "vamotors"."CommandReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vamotors"."NoticeLine" ADD CONSTRAINT "NoticeLine_remittanceId_fkey" FOREIGN KEY ("remittanceId") REFERENCES "vamotors"."Remittance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vamotors"."ReconciliationRun" ADD CONSTRAINT "ReconciliationRun_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "vamotors"."FinanceCompany"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vamotors"."ReconciliationRun" ADD CONSTRAINT "ReconciliationRun_policyId_companyId_fkey" FOREIGN KEY ("policyId", "companyId") REFERENCES "vamotors"."FinancePolicyVersion"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vamotors"."ReconciliationRun" ADD CONSTRAINT "ReconciliationRun_commandId_fkey" FOREIGN KEY ("commandId") REFERENCES "vamotors"."CommandReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vamotors"."CommissionAllocation" ADD CONSTRAINT "CommissionAllocation_runId_companyId_fkey" FOREIGN KEY ("runId", "companyId") REFERENCES "vamotors"."ReconciliationRun"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vamotors"."CommissionAllocation" ADD CONSTRAINT "CommissionAllocation_remittanceId_companyId_fkey" FOREIGN KEY ("remittanceId", "companyId") REFERENCES "vamotors"."Remittance"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vamotors"."CommissionAllocation" ADD CONSTRAINT "CommissionAllocation_entitlementId_companyId_fkey" FOREIGN KEY ("entitlementId", "companyId") REFERENCES "vamotors"."CommissionEntitlement"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vamotors"."CommissionAllocation" ADD CONSTRAINT "CommissionAllocation_noticeLineId_remittanceId_fkey" FOREIGN KEY ("noticeLineId", "remittanceId") REFERENCES "vamotors"."NoticeLine"("id", "remittanceId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vamotors"."CommissionAllocation" ADD CONSTRAINT "CommissionAllocation_reversalOf_fkey" FOREIGN KEY ("reversalOf") REFERENCES "vamotors"."CommissionAllocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vamotors"."CommissionAllocation" ADD CONSTRAINT "CommissionAllocation_commandId_fkey" FOREIGN KEY ("commandId") REFERENCES "vamotors"."CommandReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vamotors"."CommissionDiscrepancy" ADD CONSTRAINT "CommissionDiscrepancy_runId_companyId_fkey" FOREIGN KEY ("runId", "companyId") REFERENCES "vamotors"."ReconciliationRun"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vamotors"."CommissionDiscrepancy" ADD CONSTRAINT "CommissionDiscrepancy_entitlementId_companyId_fkey" FOREIGN KEY ("entitlementId", "companyId") REFERENCES "vamotors"."CommissionEntitlement"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vamotors"."CommissionDiscrepancy" ADD CONSTRAINT "CommissionDiscrepancy_remittanceId_companyId_fkey" FOREIGN KEY ("remittanceId", "companyId") REFERENCES "vamotors"."Remittance"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vamotors"."CommissionDiscrepancy" ADD CONSTRAINT "CommissionDiscrepancy_allocationId_entitlementId_remittanc_fkey" FOREIGN KEY ("allocationId", "entitlementId", "remittanceId") REFERENCES "vamotors"."CommissionAllocation"("id", "entitlementId", "remittanceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backstop the company/source pair for legacy and new entitlements.
ALTER TABLE vamotors."BrokerageDeal" ADD UNIQUE (id, "companyId");
ALTER TABLE vamotors."InventoryLease" ADD UNIQUE ("saleCaseId", "companyId");
ALTER TABLE vamotors."CommissionEntitlement"
  ADD CHECK (("sourceType" = 'BROKERAGE') = ("brokerageDealId" IS NOT NULL)),
  ADD FOREIGN KEY ("brokerageDealId", "companyId") REFERENCES vamotors."BrokerageDeal"(id, "companyId") ON DELETE RESTRICT,
  ADD FOREIGN KEY ("saleCaseId", "companyId") REFERENCES vamotors."InventoryLease"("saleCaseId", "companyId") ON DELETE RESTRICT;
UPDATE vamotors."CommissionEntitlement" SET state = 'SETTLED'
  WHERE "sourceType" = 'BROKERAGE' AND "expectedAmount" = 0 AND state = 'OPEN';

ALTER TABLE vamotors."Remittance"
  ADD CHECK (state IN ('STAGED', 'RECEIVED', 'REVERSED') AND revision > 0),
  ADD CHECK (btrim(reference) <> '' AND method IN ('PERIOD_NOTICE', 'PER_DEAL')),
  ADD FOREIGN KEY ("companyId", "policyVersion") REFERENCES vamotors."FinancePolicyVersion"("companyId", version) ON DELETE RESTRICT;
ALTER TABLE vamotors."NoticeLine"
  ADD CHECK (amount BETWEEN 1 AND 99999999999999 AND btrim(key) <> '' AND btrim(description) <> ''),
  ADD CHECK (("sourceType" IS NULL AND "sourceId" IS NULL) OR
    ("sourceType" IS NOT NULL AND "sourceType" IN ('VEHICLE_SALE', 'BROKERAGE') AND "sourceId" IS NOT NULL));
ALTER TABLE vamotors."ReconciliationRun"
  ADD CHECK (method IN ('PERIOD_NOTICE','PER_DEAL') AND jsonb_typeof(snapshot) = 'array'),
  ADD CHECK ("previousWatermarkDate" IS NULL OR
    ("newWatermarkDate" IS NOT NULL AND "newWatermarkDate" >= "previousWatermarkDate"));
ALTER TABLE vamotors."CommissionAllocation"
  ADD CHECK (amount BETWEEN 1 AND 99999999999999 AND (reason IS NOT NULL) = ("reversalOf" IS NOT NULL));
ALTER TABLE vamotors."CommissionDiscrepancy"
  ADD CHECK (btrim(reason) <> '' AND ("allocationId" IS NULL) = ("remittanceId" IS NULL)),
  ADD CHECK (
    (classification = 'SHORTFALL' AND "expectedMinusAllocated" > 0 AND resolution IN ('KEEP_OPEN', 'ACCEPT_SHORTFALL'))
    OR (classification = 'OVERPAYMENT' AND "expectedMinusAllocated" < 0 AND "allocationId" IS NOT NULL
      AND resolution IN ('CARRY_CREDIT', 'RETURN_OVERPAYMENT')));
ALTER TABLE vamotors."RemittancePayment"
  ADD CHECK (amount BETWEEN 1 AND 99999999999999 AND btrim(reference) <> '' AND method = 'BANK_TRANSFER'),
  ADD CHECK (
    (category = 'REMITTANCE_RECEIPT' AND direction = 'IN' AND "discrepancyId" IS NULL AND "reversalOf" IS NULL AND reason IS NULL)
    OR (category = 'REMITTANCE_RETURN' AND direction = 'OUT' AND "discrepancyId" IS NOT NULL AND "reversalOf" IS NULL AND btrim(reason) <> '' AND reason IS NOT NULL)
    OR (category = 'REMITTANCE_REVERSAL' AND direction IN ('IN','OUT') AND "reversalOf" IS NOT NULL AND btrim(reason) <> '' AND reason IS NOT NULL));
CREATE UNIQUE INDEX "RemittancePayment_original_receipt" ON vamotors."RemittancePayment" ("remittanceId")
  WHERE category = 'REMITTANCE_RECEIPT';

-- The existing private-byte protocol validates attempts, hashes, audit and final links.
DO $$
DECLARE tbl text; rule text; definition text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['UploadIntent','Attachment'] LOOP
    FOREACH rule IN ARRAY ARRAY['target','purpose'] LOOP
      SELECT pg_get_expr(conbin, conrelid) INTO STRICT definition FROM pg_constraint
        WHERE conrelid = format('vamotors.%I',tbl)::regclass AND conname = tbl||'_'||rule||'_check';
      EXECUTE format('ALTER TABLE vamotors.%I DROP CONSTRAINT %I',tbl,tbl||'_'||rule||'_check');
      EXECUTE format('ALTER TABLE vamotors.%I ADD CONSTRAINT %I CHECK ((%s AND "remittanceId" IS NULL) OR
        ("targetType"=''REMITTANCE'' AND "remittanceId" IS NOT NULL AND "saleCaseId" IS NULL AND "batchId" IS NULL
        AND "brokerageDealId" IS NULL AND "photoCategory" IS NULL AND purpose IN (''RECONCILIATION_NOTICE'',''REMITTANCE_RECEIPT'')
        AND (("contentType"=''application/pdf'' AND size BETWEEN 1 AND 5242880)
          OR ("contentType" IN (''image/jpeg'',''image/png'',''image/webp'') AND size BETWEEN 1 AND 2097152))))',
        tbl,tbl||'_'||rule||'_check',definition);
    END LOOP;
  END LOOP;
END $$;

DO $$
DECLARE source text; branch text;
  sale_marker text := 'IF u."targetType"=''SALE_CASE'' THEN';
  brokerage_marker text := 'IF u."targetType"=''BROKERAGE_DEAL'' THEN';
BEGIN
  SELECT pg_get_functiondef('vamotors.import_protocol_graph()'::regprocedure) INTO source;
  branch := split_part(split_part(source,sale_marker,2),brokerage_marker,1);
  IF branch='' THEN RAISE EXCEPTION 'REMITTANCE_UPLOAD_GRAPH_BASE'; END IF;
  branch := replace(branch, 'sale.kind<>''LEASE'' OR sale.state<>''FINANCE_PENDING''', 'sale.state<>''STAGED''');
  branch := replace(branch, '"SaleCase"', '"Remittance"');
  branch := replace(branch, '"saleCaseId"', '"remittanceId"');
  branch := replace(branch, '''SALE_CASE''', '''REMITTANCE''');
  branch := replace(branch, 'DO_', 'REMITTANCE_');
  source := replace(source, 'DECLARE sale vamotors."SaleCase";', 'DECLARE remittance vamotors."Remittance"; sale vamotors."SaleCase";');
  branch := replace(branch, 'INTO sale ', 'INTO remittance ');
  branch := replace(branch, 'sale.', 'remittance.');
  EXECUTE replace(source,sale_marker,'IF u."targetType"=''REMITTANCE'' THEN'||branch||sale_marker);
END $$;

-- Only movement facts reach the view. Allocation, expected amounts and notices never do.
CREATE OR REPLACE VIEW vamotors."CashMovement" AS
 SELECT 'PURCHASE'::text AS "sourceType", "cycleId" AS "sourceId", id AS "paymentId", "occurredDate" AS date, direction, amount, method, category, "commandId" FROM vamotors."PurchasePayment"
 UNION ALL SELECT 'COST',"costId",id,"occurredDate",direction,amount,method,category,"commandId" FROM vamotors."CostPayment"
 UNION ALL SELECT 'DISPOSAL',"disposalId",id,"occurredDate",direction,amount,method,category,"commandId" FROM vamotors."DisposalReceipt"
 UNION ALL SELECT 'REPAIR',"repairId",id,"occurredDate",direction,amount,method,category,"commandId" FROM vamotors."RepairPayment"
 UNION ALL SELECT 'FACILITY',"facilityId",id,"occurredDate",direction,amount,method,component,"commandId" FROM vamotors."FacilityPayment"
 UNION ALL SELECT 'BROKERAGE_FEE',"dealId",id,"occurredDate",direction,amount,method,category,"commandId" FROM vamotors."BrokerageFeeReceipt"
 UNION ALL SELECT 'SALE',"saleCaseId",id,"occurredDate",direction,amount,method,category,"commandId" FROM vamotors."SaleReceipt"
 UNION ALL SELECT 'REMITTANCE',"remittanceId",id,"occurredDate",direction,amount,method,category,"commandId" FROM vamotors."RemittancePayment";

DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['RemittancePayment','NoticeLine','ReconciliationRun','CommissionAllocation','CommissionDiscrepancy'] LOOP
    EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON vamotors.%I FOR EACH STATEMENT EXECUTE FUNCTION vamotors.append_only()',tbl);
  END LOOP;
END $$;

-- Protected administrators receive the dedicated reconciliation grants on upgrade.
SELECT vamotors.lock_admin_guard();
DO $$
DECLARE guard text; role_guard text; admin_id uuid; permission_id uuid; rule jsonb; hash text;
BEGIN
 SELECT id INTO admin_id FROM vamotors."Role" WHERE "systemKey"='ADMINISTRATOR';
 IF admin_id IS NULL THEN RETURN; END IF;
 SELECT pg_get_functiondef('vamotors.protect_admin_permissions()'::regprocedure) INTO guard;
 SELECT pg_get_functiondef('vamotors.protect_system_role()'::regprocedure) INTO role_guard;
 EXECUTE replace(guard,'BEGIN',E'BEGIN\n IF current_user=''vamotors_migrator'' THEN RETURN CASE WHEN TG_OP=''DELETE'' THEN OLD ELSE NEW END; END IF;');
 EXECUTE replace(role_guard,'BEGIN',E'BEGIN\n IF current_user=''vamotors_migrator'' AND TG_OP=''UPDATE'' AND NEW.revision=OLD.revision+1 AND (to_jsonb(NEW)-''revision'')=(to_jsonb(OLD)-''revision'') THEN RETURN NEW; END IF;');
 FOR rule IN SELECT value FROM jsonb_array_elements('[
   {"subject":"ReconciliationRun","action":"read","fields":["*"]},
   {"subject":"ReconciliationRun","action":"reconcile","fields":["*"]},
   {"subject":"Remittance","action":"read","fields":["*"]},
   {"subject":"Remittance","action":"create","fields":["*"]},
   {"subject":"Remittance","action":"receive","fields":["*"]},
   {"subject":"Remittance","action":"reconcile","fields":["*"]},
   {"subject":"Remittance","action":"pay","fields":["*"]},
   {"subject":"CommissionEntitlement","action":"reconcile","fields":["*"]}
 ]'::jsonb) LOOP
   hash:=encode(sha256(convert_to(vamotors.sale_canonical(rule),'UTF8')),'hex');
   INSERT INTO vamotors."Permission"(id,"ruleHash",rule) VALUES(gen_random_uuid(),hash,rule) ON CONFLICT ("ruleHash") DO NOTHING;
   SELECT id INTO permission_id FROM vamotors."Permission" WHERE "ruleHash"=hash;
   INSERT INTO vamotors."RolePermission"("roleId","permissionId") VALUES(admin_id,permission_id) ON CONFLICT DO NOTHING;
 END LOOP;
 UPDATE vamotors."Role" SET revision=revision+1 WHERE id=admin_id;
 EXECUTE guard;
 EXECUTE role_guard;
END $$;
COMMIT;
