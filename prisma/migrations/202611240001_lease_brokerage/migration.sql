BEGIN;
SELECT value FROM vamotors."BusinessSequence" WHERE id=1 FOR UPDATE;
SELECT vamotors.lock_admin_guard();

-- ── Read model / registry ────────────────────────────────────────────────────
ALTER TABLE vamotors."EntityReadVersion" DROP CONSTRAINT "EntityReadVersion_entityType_check";
-- The integration migration validates the union, including any existing sale history.
ALTER TABLE vamotors."EntityReadVersion" ADD CONSTRAINT "EntityReadVersion_entityType_check" CHECK("entityType" IN ('Vehicle','PurchaseRecord','Customer','Supplier','RepairVendor','FinanceCompany','Settings','RateSheet','Quote','VehicleCost','ImportBatch','Document','RepairRecord','ApprovalRequest','BrokerageDeal','CashFacility','DispatchBatch','CommissionEntitlement')) NOT VALID;

-- ── Brokerage deal root ──────────────────────────────────────────────────────
CREATE TABLE vamotors."BrokerageDeal" (
 id uuid PRIMARY KEY,
 "customerId" uuid NOT NULL REFERENCES vamotors."Customer"(id) ON DELETE RESTRICT,
 "companyId" uuid NOT NULL REFERENCES vamotors."FinanceCompany"(id) ON DELETE RESTRICT,
 "externalVehicle" jsonb NOT NULL,
 path text NOT NULL CHECK(path IN ('APPLICATION','REFERRAL')),
 state text NOT NULL DEFAULT 'INTAKE' CHECK(state IN ('INTAKE','ELIGIBILITY_PENDING','ELIGIBLE','INSPECTED','DOCUMENTS_READY','DISPATCHED','REFERRED','COMPLETED','REJECTED')),
 "originalQuoteId" uuid NOT NULL REFERENCES vamotors."Quote"(id) ON DELETE RESTRICT,
 "currentQuoteSelectionId" uuid UNIQUE,
 "quoteStatus" text NOT NULL DEFAULT 'SUPPORTED' CHECK("quoteStatus" IN ('SUPPORTED','RESELECTION_REQUIRED')),
 "requestedLoan" bigint NOT NULL CHECK("requestedLoan" BETWEEN 1 AND 99999999999999),
 "approvedLoan" bigint NOT NULL CHECK("approvedLoan" BETWEEN 1 AND 99999999999999),
 "processingFee" bigint NOT NULL CHECK("processingFee" BETWEEN 0 AND 99999999999999),
 "processingFeeOverridden" boolean NOT NULL DEFAULT false,
 "effectivePolicySnapshot" jsonb NOT NULL,
 "chargesSnapshot" jsonb NOT NULL,
 "fileReference" text CHECK("fileReference" IS NULL OR ("fileReference"=btrim("fileReference") AND length("fileReference") BETWEEN 1 AND 200)),
 "informedContactId" uuid,
 "informedAt" timestamp(3),
 "rejectionReason" text CHECK("rejectionReason" IS NULL OR ("rejectionReason"=btrim("rejectionReason") AND length("rejectionReason") BETWEEN 1 AND 2000)),
 "rejectedAt" timestamp(3),
 "completedAt" timestamp(3),
 "commandId" uuid NOT NULL UNIQUE REFERENCES vamotors."CommandReceipt"(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 "createdBy" uuid NOT NULL REFERENCES vamotors."user"(id) ON DELETE RESTRICT,
 "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK((path='APPLICATION' AND state<>'REFERRED') OR (path='REFERRAL' AND state NOT IN ('INSPECTED','DOCUMENTS_READY','DISPATCHED'))),
 CHECK((state='REJECTED')=("rejectionReason" IS NOT NULL AND "rejectedAt" IS NOT NULL)),
 CHECK(state<>'COMPLETED' OR "completedAt" IS NOT NULL)
);
CREATE INDEX "BrokerageDeal_companyId_state_id_idx" ON vamotors."BrokerageDeal"("companyId",state,id);
CREATE INDEX "BrokerageDeal_customerId_id_idx" ON vamotors."BrokerageDeal"("customerId",id);

CREATE TABLE vamotors."DealQuoteSelection" (
 id uuid PRIMARY KEY,
 "dealId" uuid NOT NULL REFERENCES vamotors."BrokerageDeal"(id) ON DELETE RESTRICT,
 version integer NOT NULL CHECK(version>0),
 "quoteId" uuid NOT NULL REFERENCES vamotors."Quote"(id) ON DELETE RESTRICT,
 "replacedSelectionId" uuid,
 "selectedBy" uuid NOT NULL REFERENCES vamotors."user"(id) ON DELETE RESTRICT,
 "selectedAt" timestamp(3) NOT NULL,
 "contactId" uuid,
 reason text CHECK(reason IS NULL OR (reason=btrim(reason) AND length(reason) BETWEEN 1 AND 2000)),
 "rateSnapshot" jsonb NOT NULL,
 "effectivePolicySnapshot" jsonb NOT NULL,
 "chargesSnapshot" jsonb NOT NULL,
 path text NOT NULL CHECK(path IN ('APPLICATION','REFERRAL')),
 "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("dealId",version), UNIQUE(id,"dealId")
);
ALTER TABLE vamotors."BrokerageDeal" ADD CONSTRAINT "BrokerageDeal_currentSelection_fkey" FOREIGN KEY("currentQuoteSelectionId","id") REFERENCES vamotors."DealQuoteSelection"(id,"dealId") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE vamotors."GuarantorParticipation" (
 id uuid PRIMARY KEY,
 "dealId" uuid NOT NULL REFERENCES vamotors."BrokerageDeal"(id) ON DELETE RESTRICT,
 name text NOT NULL CHECK(name=btrim(name) AND length(name) BETWEEN 1 AND 200),
 identity text NOT NULL CHECK(identity=btrim(identity) AND length(identity) BETWEEN 1 AND 100),
 "normalizedIdentity" text NOT NULL CHECK(length("normalizedIdentity") BETWEEN 1 AND 100),
 address text NOT NULL CHECK(address=btrim(address) AND length(address) BETWEEN 1 AND 2000),
 phone text NOT NULL CHECK(length(phone) BETWEEN 3 AND 30),
 role text,
 "createdBy" uuid NOT NULL REFERENCES vamotors."user"(id) ON DELETE RESTRICT,
 "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("dealId","normalizedIdentity")
);

CREATE TABLE vamotors."EligibilityCheck" (
 id uuid PRIMARY KEY,
 "dealId" uuid NOT NULL REFERENCES vamotors."BrokerageDeal"(id) ON DELETE RESTRICT,
 target text NOT NULL CHECK(target IN ('CUSTOMER','GUARANTOR','VEHICLE')),
 "guarantorId" uuid,
 outcome text NOT NULL CHECK(outcome IN ('CONFIRMED','REJECTED')),
 "companyContactId" uuid NOT NULL REFERENCES vamotors."FinanceContact"(id) ON DELETE RESTRICT,
 feedback text NOT NULL CHECK(feedback=btrim(feedback) AND length(feedback) BETWEEN 1 AND 2000),
 "checkedAt" timestamp(3) NOT NULL,
 "actorId" uuid NOT NULL REFERENCES vamotors."user"(id) ON DELETE RESTRICT,
 "supersedesId" uuid,
 "commandId" uuid NOT NULL REFERENCES vamotors."CommandReceipt"(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK((target='GUARANTOR')=("guarantorId" IS NOT NULL))
);
CREATE INDEX "EligibilityCheck_dealId_createdAt_id_idx" ON vamotors."EligibilityCheck"("dealId","createdAt",id);

CREATE TABLE vamotors."InspectionPhoto" (
 id uuid PRIMARY KEY,
 "dealId" uuid NOT NULL REFERENCES vamotors."BrokerageDeal"(id) ON DELETE RESTRICT,
 category text NOT NULL CHECK(category IN ('FRONT','BACK','LEFT','RIGHT','CHASSIS','ENGINE','METER','DEALER_WITH_VEHICLE','CUSTOMER_WITH_VEHICLE')),
 version integer NOT NULL CHECK(version>0),
 "attachmentId" uuid NOT NULL REFERENCES vamotors."Attachment"(id) ON DELETE RESTRICT,
 "isCurrent" boolean NOT NULL DEFAULT true,
 "createdBy" uuid NOT NULL REFERENCES vamotors."user"(id) ON DELETE RESTRICT,
 "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "commandId" uuid NOT NULL REFERENCES vamotors."CommandReceipt"(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 UNIQUE("dealId",category,version)
);
CREATE UNIQUE INDEX "InspectionPhoto_current_category_idx" ON vamotors."InspectionPhoto"("dealId",category) WHERE "isCurrent";

CREATE TABLE vamotors."ChecklistItem" (
 id uuid PRIMARY KEY,
 "dealId" uuid NOT NULL REFERENCES vamotors."BrokerageDeal"(id) ON DELETE RESTRICT,
 "uniqueKey" text NOT NULL CHECK(length("uniqueKey") BETWEEN 1 AND 300),
 kind text NOT NULL CHECK(kind IN ('CUSTOMER_ID','GUARANTOR_ID','PASSPORT_PHOTOS','BANK_PASSBOOK','ADDRESS_PROOF','RELATIONSHIP_PROOF','AFFIDAVIT','REGISTRATION_BOOK','DELETION_LETTER','REVENUE_LICENSE','EXTRA_KEY','TRANSFER_PAPER','PREVIOUS_OWNER_ID','PROCESSING_DOCUMENT')),
 label text CHECK(label IS NULL OR (label=btrim(label) AND length(label) BETWEEN 1 AND 200)),
 "participantId" uuid,
 applicability text NOT NULL CHECK(applicability IN ('REQUIRED','NOT_REQUIRED','OPTIONAL')),
 "applicabilityReason" text CHECK("applicabilityReason" IS NULL OR ("applicabilityReason"=btrim("applicabilityReason") AND length("applicabilityReason") BETWEEN 1 AND 2000)),
 collected boolean NOT NULL,
 quantity integer NOT NULL DEFAULT 0 CHECK(quantity BETWEEN 0 AND 1000000),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 "commandId" uuid NOT NULL REFERENCES vamotors."CommandReceipt"(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("dealId","uniqueKey"),
 CHECK(kind<>'EXTRA_KEY' OR applicability='REQUIRED'),
 CHECK(applicability<>'NOT_REQUIRED' OR kind IN ('RELATIONSHIP_PROOF','DELETION_LETTER','AFFIDAVIT','PROCESSING_DOCUMENT')),
 CHECK(applicability='NOT_REQUIRED' OR kind NOT IN ('RELATIONSHIP_PROOF','DELETION_LETTER') OR true)
);
CREATE TABLE vamotors."ChecklistDocument" (
 "checklistItemId" uuid NOT NULL REFERENCES vamotors."ChecklistItem"(id) ON DELETE RESTRICT,
 "attachmentId" uuid NOT NULL REFERENCES vamotors."Attachment"(id) ON DELETE RESTRICT,
 PRIMARY KEY("checklistItemId","attachmentId")
);

CREATE TABLE vamotors."VerificationEvent" (
 id uuid PRIMARY KEY,
 "dealId" uuid NOT NULL REFERENCES vamotors."BrokerageDeal"(id) ON DELETE RESTRICT,
 "checklistHash" text NOT NULL CHECK("checklistHash" ~ '^[a-f0-9]{64}$'),
 "quoteSelectionId" uuid NOT NULL REFERENCES vamotors."DealQuoteSelection"(id) ON DELETE RESTRICT,
 outcome text NOT NULL CHECK(outcome IN ('CLEAN','ISSUES','RESOLVED')),
 issues jsonb NOT NULL,
 "companyContactId" uuid NOT NULL REFERENCES vamotors."FinanceContact"(id) ON DELETE RESTRICT,
 "confirmedAt" timestamp(3) NOT NULL,
 feedback text NOT NULL CHECK(feedback=btrim(feedback) AND length(feedback) BETWEEN 1 AND 2000),
 "actorId" uuid NOT NULL REFERENCES vamotors."user"(id) ON DELETE RESTRICT,
 "commandId" uuid NOT NULL REFERENCES vamotors."CommandReceipt"(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "VerificationEvent_dealId_createdAt_id_idx" ON vamotors."VerificationEvent"("dealId","createdAt",id);

CREATE TABLE vamotors."DealEvent" (
 id uuid PRIMARY KEY,
 "dealId" uuid NOT NULL REFERENCES vamotors."BrokerageDeal"(id) ON DELETE RESTRICT,
 kind text NOT NULL CHECK(kind IN ('LOAN_ADJUSTMENT','COMPANY_INFORMED','REFERRAL','COMPLETED','REJECTED')),
 "contactId" uuid,
 at timestamp(3) NOT NULL,
 text text NOT NULL CHECK(text=btrim(text) AND length(text) BETWEEN 1 AND 2000),
 "commandId" uuid NOT NULL REFERENCES vamotors."CommandReceipt"(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "DealEvent_dealId_createdAt_id_idx" ON vamotors."DealEvent"("dealId","createdAt",id);

CREATE TABLE vamotors."ProcessingIssue" (
 id uuid PRIMARY KEY,
 "dealId" uuid NOT NULL REFERENCES vamotors."BrokerageDeal"(id) ON DELETE RESTRICT,
 kind text NOT NULL CHECK(kind IN ('BLOCKER','DELAY_INQUIRY','NON_REMITTANCE')),
 text text NOT NULL CHECK(text=btrim(text) AND length(text) BETWEEN 1 AND 2000),
 "openedAt" timestamp(3) NOT NULL,
 "blocksStep" text CHECK("blocksStep" IS NULL OR "blocksStep" IN ('DISPATCH','COMPLETE')),
 "resolvedAt" timestamp(3),
 resolution text,
 "createdBy" uuid NOT NULL REFERENCES vamotors."user"(id) ON DELETE RESTRICT,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 "commandId" uuid NOT NULL REFERENCES vamotors."CommandReceipt"(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK("blocksStep" IS NULL OR kind='BLOCKER')
);
CREATE INDEX "ProcessingIssue_dealId_createdAt_id_idx" ON vamotors."ProcessingIssue"("dealId","createdAt",id);
CREATE TABLE vamotors."ProcessingIssueFeedback" (
 id uuid PRIMARY KEY,
 "issueId" uuid NOT NULL REFERENCES vamotors."ProcessingIssue"(id) ON DELETE RESTRICT,
 "companyContactId" uuid NOT NULL REFERENCES vamotors."FinanceContact"(id) ON DELETE RESTRICT,
 at timestamp(3) NOT NULL,
 feedback text NOT NULL CHECK(feedback=btrim(feedback) AND length(feedback) BETWEEN 1 AND 2000),
 resolve boolean NOT NULL,
 "actorId" uuid NOT NULL REFERENCES vamotors."user"(id) ON DELETE RESTRICT,
 "commandId" uuid NOT NULL REFERENCES vamotors."CommandReceipt"(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "ProcessingIssueFeedback_issueId_createdAt_id_idx" ON vamotors."ProcessingIssueFeedback"("issueId","createdAt",id);

CREATE TABLE vamotors."CashFacility" (
 id uuid PRIMARY KEY,
 "dealId" uuid NOT NULL UNIQUE REFERENCES vamotors."BrokerageDeal"(id) ON DELETE RESTRICT,
 "requestedAt" timestamp(3) NOT NULL,
 gross bigint NOT NULL CHECK(gross BETWEEN 1 AND 99999999999999),
 deductions jsonb NOT NULL,
 fee bigint NOT NULL CHECK(fee BETWEEN 0 AND 99999999999999),
 "feeMode" text NOT NULL CHECK("feeMode" IN ('WITHHELD','SEPARATE')),
 net bigint NOT NULL CHECK(net BETWEEN 0 AND 99999999999999),
 "separatelyRecoverableCharges" bigint NOT NULL CHECK("separatelyRecoverableCharges" BETWEEN 0 AND 99999999999999),
 reason text NOT NULL CHECK(reason=btrim(reason) AND length(reason) BETWEEN 1 AND 2000),
 state text NOT NULL DEFAULT 'REQUESTED' CHECK(state IN ('REQUESTED','DISBURSED','PARTIAL','RECOVERED')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 "createdBy" uuid NOT NULL REFERENCES vamotors."user"(id) ON DELETE RESTRICT,
 "commandId" uuid NOT NULL UNIQUE REFERENCES vamotors."CommandReceipt"(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE vamotors."FacilityPayment" (
 id uuid PRIMARY KEY,
 "facilityId" uuid NOT NULL REFERENCES vamotors."CashFacility"(id) ON DELETE RESTRICT,
 amount bigint NOT NULL CHECK(amount BETWEEN 1 AND 99999999999999),
 direction text NOT NULL CHECK(direction IN ('IN','OUT')),
 component text NOT NULL CHECK(component IN ('PAYOUT','DEDUCTION','PRINCIPAL','CHARGE','FEE')),
 "occurredDate" date NOT NULL CHECK("occurredDate" BETWEEN DATE '0001-01-01' AND (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Colombo')::date),
 method text NOT NULL CHECK(method IN ('CASH','BANK_TRANSFER')),
 reference text CHECK(reference IS NULL OR (reference=btrim(reference) AND length(reference) BETWEEN 1 AND 200)),
 "reversalOf" uuid UNIQUE,
 reason text CHECK(reason IS NULL OR (reason=btrim(reason) AND length(reason) BETWEEN 1 AND 2000)),
 "createdBy" uuid NOT NULL REFERENCES vamotors."user"(id) ON DELETE RESTRICT,
 "commandId" uuid NOT NULL REFERENCES vamotors."CommandReceipt"(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 "lineKey" text NOT NULL CHECK(length("lineKey") BETWEEN 1 AND 100),
 "recordedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("commandId","lineKey")
);
CREATE INDEX "FacilityPayment_facilityId_occurredDate_id_idx" ON vamotors."FacilityPayment"("facilityId","occurredDate",id);
CREATE TABLE vamotors."BrokerageFeeReceipt" (
 id uuid PRIMARY KEY,
 "dealId" uuid NOT NULL REFERENCES vamotors."BrokerageDeal"(id) ON DELETE RESTRICT,
 category text NOT NULL CHECK(category IN ('PROCESSING','ADDITIONAL')),
 amount bigint NOT NULL CHECK(amount BETWEEN 1 AND 99999999999999),
 direction text NOT NULL CHECK(direction IN ('IN','OUT')),
 "occurredDate" date NOT NULL CHECK("occurredDate" BETWEEN DATE '0001-01-01' AND (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Colombo')::date),
 method text NOT NULL CHECK(method IN ('CASH','BANK_TRANSFER')),
 reference text CHECK(reference IS NULL OR (reference=btrim(reference) AND length(reference) BETWEEN 1 AND 200)),
 "reversalOf" uuid UNIQUE,
 reason text CHECK(reason IS NULL OR (reason=btrim(reason) AND length(reason) BETWEEN 1 AND 2000)),
 "createdBy" uuid NOT NULL REFERENCES vamotors."user"(id) ON DELETE RESTRICT,
 "commandId" uuid NOT NULL REFERENCES vamotors."CommandReceipt"(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 "lineKey" text NOT NULL CHECK(length("lineKey") BETWEEN 1 AND 100),
 "recordedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("commandId","lineKey")
);
CREATE INDEX "BrokerageFeeReceipt_dealId_occurredDate_id_idx" ON vamotors."BrokerageFeeReceipt"("dealId","occurredDate",id);

CREATE TABLE vamotors."DispatchBatch" (
 id uuid PRIMARY KEY,
 "handedOverAt" timestamp(3) NOT NULL,
 courier text NOT NULL CHECK(courier=btrim(courier) AND length(courier) BETWEEN 1 AND 200),
 tracking text CHECK(tracking IS NULL OR (tracking=btrim(tracking) AND length(tracking) BETWEEN 1 AND 200)),
 "createdBy" uuid NOT NULL REFERENCES vamotors."user"(id) ON DELETE RESTRICT,
 "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "commandId" uuid NOT NULL UNIQUE REFERENCES vamotors."CommandReceipt"(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 revision integer NOT NULL DEFAULT 1 CHECK(revision=1)
);
CREATE TABLE vamotors."DispatchItem" (
 id uuid PRIMARY KEY,
 "batchId" uuid NOT NULL REFERENCES vamotors."DispatchBatch"(id) ON DELETE RESTRICT,
 "sourceType" text NOT NULL DEFAULT 'BROKERAGE' CHECK("sourceType" IN ('BROKERAGE','VEHICLE_SALE')),
 "brokerageDealId" uuid UNIQUE REFERENCES vamotors."BrokerageDeal"(id) ON DELETE RESTRICT,
 "saleCaseId" uuid UNIQUE,
 "sourceRevision" integer NOT NULL CHECK("sourceRevision">0),
 "checklistHash" text NOT NULL CHECK("checklistHash" ~ '^[a-f0-9]{64}$'),
 "sentAt" timestamp(3) NOT NULL,
 CHECK(("brokerageDealId" IS NOT NULL) <> ("saleCaseId" IS NOT NULL)),
 CHECK(("sourceType"='BROKERAGE')=("brokerageDealId" IS NOT NULL))
);

CREATE TABLE vamotors."CommissionEntitlement" (
 id uuid PRIMARY KEY,
 "companyId" uuid NOT NULL REFERENCES vamotors."FinanceCompany"(id) ON DELETE RESTRICT,
 "sourceType" text NOT NULL DEFAULT 'BROKERAGE' CHECK("sourceType" IN ('BROKERAGE','VEHICLE_SALE')),
 "brokerageDealId" uuid UNIQUE REFERENCES vamotors."BrokerageDeal"(id) ON DELETE RESTRICT,
 "saleCaseId" uuid UNIQUE,
 "expectedAmount" bigint NOT NULL CHECK("expectedAmount" BETWEEN 0 AND 99999999999999),
 "policySnapshot" jsonb NOT NULL,
 "eligibleAt" timestamp(3) NOT NULL,
 "sentDate" date NOT NULL,
 "sentDateSource" text NOT NULL CHECK("sentDateSource" IN ('DISPATCH','REFERRAL','HANDOVER')),
 state text NOT NULL DEFAULT 'OPEN' CHECK(state IN ('OPEN','PARTIAL','SETTLED','RESOLVED')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 "createdBy" uuid NOT NULL REFERENCES vamotors."user"(id) ON DELETE RESTRICT,
 "commandId" uuid NOT NULL UNIQUE REFERENCES vamotors."CommandReceipt"(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK(("brokerageDealId" IS NOT NULL) <> ("saleCaseId" IS NOT NULL))
);
CREATE INDEX "CommissionEntitlement_companyId_state_sentDate_id_idx" ON vamotors."CommissionEntitlement"("companyId",state,"sentDate",id);

-- ── Generalize private upload targets ────────────────────────────────────────
-- The original import-only purpose/filename checks are inline auto-named
-- constraints. Drop them explicitly, then enforce the combined target rule.
DO $$ DECLARE c record;
BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='vamotors."UploadIntent"'::regclass AND contype='c' AND (pg_get_constraintdef(oid) LIKE '%purpose = ''IMPORT_SOURCE''%' OR pg_get_constraintdef(oid) LIKE '%csv%') LOOP
  EXECUTE format('ALTER TABLE vamotors."UploadIntent" DROP CONSTRAINT %I',c.conname);
 END LOOP;
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='vamotors."Attachment"'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%purpose = ''IMPORT_SOURCE''%' LOOP
  EXECUTE format('ALTER TABLE vamotors."Attachment" DROP CONSTRAINT %I',c.conname);
 END LOOP;
END $$;
ALTER TABLE vamotors."UploadIntent" ALTER COLUMN "batchId" DROP NOT NULL;
ALTER TABLE vamotors."UploadIntent"
 ADD COLUMN "targetType" text NOT NULL DEFAULT 'IMPORT_BATCH',
 ADD COLUMN "brokerageDealId" uuid,
 ADD COLUMN "photoCategory" text;
ALTER TABLE vamotors."UploadIntent" ADD CONSTRAINT "UploadIntent_brokerageDealId_fkey" FOREIGN KEY("brokerageDealId") REFERENCES vamotors."BrokerageDeal"(id) ON DELETE RESTRICT;
ALTER TABLE vamotors."UploadIntent" ADD CONSTRAINT "UploadIntent_target_check" CHECK(
 (("targetType"='IMPORT_BATCH' AND "batchId" IS NOT NULL AND "brokerageDealId" IS NULL)
  OR ("targetType"='BROKERAGE_DEAL' AND "batchId" IS NULL AND "brokerageDealId" IS NOT NULL)));
ALTER TABLE vamotors."UploadIntent" ADD CONSTRAINT "UploadIntent_purpose_check" CHECK(
 ("targetType"='IMPORT_BATCH' AND purpose='IMPORT_SOURCE' AND "photoCategory" IS NULL AND "contentType" IN ('text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'))
 OR ("targetType"='BROKERAGE_DEAL' AND (
   (purpose='INSPECTION' AND "photoCategory" IN ('FRONT','BACK','LEFT','RIGHT','CHASSIS','ENGINE','METER','DEALER_WITH_VEHICLE','CUSTOMER_WITH_VEHICLE') AND "contentType" IN ('image/jpeg','image/png','image/webp') AND size BETWEEN 1 AND 2097152)
   OR (purpose IN ('PARTICIPANT_DOCUMENT','VEHICLE_DOCUMENT','PROCESSING_DOCUMENT') AND "photoCategory" IS NULL AND
       (("contentType"='application/pdf' AND size BETWEEN 1 AND 5242880) OR ("contentType" IN ('image/jpeg','image/png','image/webp') AND size BETWEEN 1 AND 2097152))))));
CREATE INDEX "UploadIntent_brokerageDealId_id_idx" ON vamotors."UploadIntent"("brokerageDealId",id);
ALTER TABLE vamotors."Attachment" ALTER COLUMN "batchId" DROP NOT NULL;
ALTER TABLE vamotors."Attachment"
 ADD COLUMN "targetType" text NOT NULL DEFAULT 'IMPORT_BATCH',
 ADD COLUMN "brokerageDealId" uuid,
 ADD COLUMN "photoCategory" text;
ALTER TABLE vamotors."Attachment" ADD CONSTRAINT "Attachment_brokerageDealId_fkey" FOREIGN KEY("brokerageDealId") REFERENCES vamotors."BrokerageDeal"(id) ON DELETE RESTRICT;
ALTER TABLE vamotors."Attachment" ADD CONSTRAINT "Attachment_target_check" CHECK(
 (("targetType"='IMPORT_BATCH' AND "batchId" IS NOT NULL AND "brokerageDealId" IS NULL)
  OR ("targetType"='BROKERAGE_DEAL' AND "batchId" IS NULL AND "brokerageDealId" IS NOT NULL)));
ALTER TABLE vamotors."Attachment" ADD CONSTRAINT "Attachment_purpose_check" CHECK(
 ("targetType"='IMPORT_BATCH' AND purpose='IMPORT_SOURCE' AND "photoCategory" IS NULL)
 OR ("targetType"='BROKERAGE_DEAL' AND (
   (purpose='INSPECTION' AND "photoCategory" IN ('FRONT','BACK','LEFT','RIGHT','CHASSIS','ENGINE','METER','DEALER_WITH_VEHICLE','CUSTOMER_WITH_VEHICLE') AND "contentType" IN ('image/jpeg','image/png','image/webp') AND size BETWEEN 1 AND 2097152)
   OR (purpose IN ('PARTICIPANT_DOCUMENT','VEHICLE_DOCUMENT','PROCESSING_DOCUMENT') AND "photoCategory" IS NULL AND
       (("contentType"='application/pdf' AND size BETWEEN 1 AND 5242880) OR ("contentType" IN ('image/jpeg','image/png','image/webp') AND size BETWEEN 1 AND 2097152))))));
CREATE INDEX "Attachment_brokerageDealId_idx" ON vamotors."Attachment"("brokerageDealId",id);

-- ── Upload graph: preserve every import invariant, add brokerage targets ─────
CREATE OR REPLACE FUNCTION vamotors.import_protocol_graph() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE b vamotors."ImportBatch"; u vamotors."UploadIntent"; a vamotors."UploadAttempt"; d vamotors."Attachment"; e vamotors."UploadEvent"; c vamotors."CommandReceipt";
 bd vamotors."BrokerageDeal"; ba vamotors."UploadAttempt"; batt vamotors."Attachment"; bev vamotors."UploadEvent"; brc vamotors."CommandReceipt"; bex vamotors."BrokerageDeal";
BEGIN
 IF TG_TABLE_NAME='ImportBatch' THEN
  b:=NEW;
  IF TG_OP='INSERT' THEN
   SELECT * INTO c FROM vamotors."CommandReceipt" WHERE id=b."commandId";
   IF c."commandName" IS DISTINCT FROM 'stageImport' OR c."actorKey" IS DISTINCT FROM 'USER:'||b."createdBy"::text OR c.result IS DISTINCT FROM jsonb_build_object('type','ImportBatch','id',b.id,'revision',1)
    OR c."environmentId" IS DISTINCT FROM b."environmentId"
    OR NOT EXISTS(SELECT 1 FROM vamotors."AuditEntry" WHERE "commandId"=c.id AND "entityType"='ImportBatch' AND "entityId"=b.id)
    OR NOT EXISTS(SELECT 1 FROM vamotors."EntityReadVersion" WHERE "commandId"=c.id AND "entityType"='ImportBatch' AND "entityId"=b.id AND revision=1)
    THEN RAISE EXCEPTION 'STAGING_EVIDENCE_REQUIRED' USING ERRCODE='23514'; END IF;
  ELSE
    IF NOT EXISTS(SELECT 1 FROM vamotors."Attachment" linked JOIN vamotors."CommandReceipt" receipt ON receipt.id=linked."commandId" WHERE linked."batchId"=b.id AND linked.xmin=pg_current_xact_id()::xid AND receipt."commandName"='completeUpload') THEN RAISE EXCEPTION 'FINAL_LINK_REQUIRED' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NULL;
 END IF;
 IF TG_TABLE_NAME='UploadIntent' THEN u:=NEW;
 ELSIF TG_TABLE_NAME='UploadAttempt' THEN SELECT * INTO u FROM vamotors."UploadIntent" WHERE id=NEW."uploadId";
 ELSIF TG_TABLE_NAME='UploadEvent' THEN SELECT * INTO u FROM vamotors."UploadIntent" WHERE id=NEW."uploadId";
 ELSE SELECT * INTO u FROM vamotors."UploadIntent" WHERE id=NEW."uploadIntentId"; END IF;
 IF u."targetType"='BROKERAGE_DEAL' THEN
  SELECT * INTO bd FROM vamotors."BrokerageDeal" WHERE id=u."brokerageDealId";
  SELECT * INTO ba FROM vamotors."UploadAttempt" WHERE id=u."currentAttemptId";
  SELECT * INTO batt FROM vamotors."Attachment" WHERE "uploadIntentId"=u.id;
  SELECT * INTO bev FROM vamotors."UploadEvent" WHERE "uploadId"=u.id AND revision=u.revision;
  SELECT * INTO brc FROM vamotors."CommandReceipt" WHERE id=bev."commandId";
  IF TG_TABLE_NAME='UploadAttempt' THEN
   IF NEW.id IS DISTINCT FROM u."currentAttemptId" THEN RAISE EXCEPTION 'UNCLAIMED_UPLOAD_ATTEMPT' USING ERRCODE='23514'; END IF;
  ELSIF TG_TABLE_NAME='UploadEvent' THEN
   IF NEW.revision IS DISTINCT FROM u.revision OR NEW.state IS DISTINCT FROM u.state OR NEW."attemptId" IS DISTINCT FROM u."currentAttemptId" THEN RAISE EXCEPTION 'INVALID_UPLOAD_EVENT' USING ERRCODE='23514'; END IF;
  END IF;
  IF bd.id IS NULL OR bd.path NOT IN ('APPLICATION','REFERRAL')
   OR u."environmentId" IS DISTINCT FROM (SELECT id FROM vamotors."Environment" WHERE singleton=1)
   OR u."stagingKey" !~ ('^s\.'||u."environmentId"::text||'\.'||u.id::text||'\.[a-f0-9-]{36}$')
   OR bev.id IS NULL OR bev.state IS DISTINCT FROM u.state OR bev."attemptId" IS DISTINCT FROM u."currentAttemptId"
   OR brc.id IS NULL OR brc."environmentId" IS DISTINCT FROM u."environmentId"
   OR NOT EXISTS(SELECT 1 FROM vamotors."AuditEntry" WHERE "commandId"=brc.id AND "entityType"='Document' AND "entityId"=u.id)
   OR NOT EXISTS(SELECT 1 FROM vamotors."EntityReadVersion" WHERE "commandId"=brc.id AND "entityType"='Document' AND "entityId"=u.id AND revision=u.revision)
   OR ((u.state='FINAL')<>(batt.id IS NOT NULL))
   THEN RAISE EXCEPTION 'BROKERAGE_UPLOAD_EVIDENCE_REQUIRED' USING ERRCODE='23514'; END IF;
  IF u.state='INIT' AND (u."capturedTargetRevision"<>bd.revision OR NOT EXISTS(SELECT 1 FROM vamotors."CommandReceipt" WHERE id=u."initCommandId" AND "commandName"='initUpload' AND "actorKey"='USER:'||u."createdBy"::text AND result=jsonb_build_object('type','UploadIntent','id',u.id,'revision',1))) THEN RAISE EXCEPTION 'INVALID_BROKERAGE_UPLOAD_TARGET' USING ERRCODE='23514'; END IF;
  IF u."currentAttemptId" IS NOT NULL AND (ba.id IS NULL OR ba."environmentId"<>u."environmentId" OR ba."uploadId"<>u.id OR ba."targetRevision"<>u."capturedTargetRevision" OR ba.size<>u.size OR ba.sha256<>u.sha256 OR ba."contentType"<>u."contentType" OR ba."claimedAt">u."expiresAt" OR ba."finalKey" !~ ('^f\.'||u."environmentId"::text||'\.'||u.id::text||'\.'||ba.id::text||'\.[a-f0-9-]{36}$')) THEN RAISE EXCEPTION 'INVALID_BROKERAGE_UPLOAD_CLAIM' USING ERRCODE='23514'; END IF;
  IF batt.id IS NOT NULL AND (batt."brokerageDealId"<>u."brokerageDealId" OR batt."targetType"<>'BROKERAGE_DEAL' OR batt."environmentId"<>u."environmentId" OR batt."createdBy"<>u."createdBy" OR batt.purpose<>u.purpose OR batt."photoCategory" IS DISTINCT FROM u."photoCategory" OR batt.filename<>u.filename OR batt.size<>ba.size OR batt.sha256<>ba.sha256 OR batt."contentType"<>ba."contentType" OR batt."attemptId"<>ba.id OR batt."finalKey"<>ba."finalKey" OR batt."commandId"<>ba."commandId" OR bd.revision<>u."capturedTargetRevision"+1 OR NOT EXISTS(SELECT 1 FROM vamotors."CommandReceipt" WHERE id=batt."commandId" AND "commandName"='completeUpload' AND "actorKey"='USER:'||ba."createdBy"::text AND "idempotencyKey"=ba."idempotencyKey" AND "inputHash"=ba."inputHash" AND result=jsonb_build_object('type','Document','id',batt.id,'revision',1))) THEN RAISE EXCEPTION 'INVALID_BROKERAGE_FINAL_ATTACHMENT' USING ERRCODE='23514'; END IF;
  RETURN NULL;
 END IF;
 SELECT * INTO b FROM vamotors."ImportBatch" WHERE id=u."batchId";
 SELECT * INTO a FROM vamotors."UploadAttempt" WHERE id=u."currentAttemptId";
 SELECT * INTO d FROM vamotors."Attachment" WHERE "uploadIntentId"=u.id;
 SELECT * INTO e FROM vamotors."UploadEvent" WHERE "uploadId"=u.id AND revision=u.revision;
 SELECT * INTO c FROM vamotors."CommandReceipt" WHERE id=e."commandId";
 IF TG_TABLE_NAME='UploadAttempt' THEN
  IF NEW.id IS DISTINCT FROM u."currentAttemptId" THEN RAISE EXCEPTION 'UNCLAIMED_UPLOAD_ATTEMPT' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='UploadEvent' THEN
  IF NEW.revision IS DISTINCT FROM u.revision OR NEW.state IS DISTINCT FROM u.state OR NEW."attemptId" IS DISTINCT FROM u."currentAttemptId" THEN RAISE EXCEPTION 'INVALID_UPLOAD_EVENT' USING ERRCODE='23514'; END IF;
 END IF;
 IF u."environmentId" IS DISTINCT FROM b."environmentId" OR u."environmentId" IS DISTINCT FROM (SELECT id FROM vamotors."Environment" WHERE singleton=1)
  OR u."stagingKey" !~ ('^s\.'||u."environmentId"::text||'\.'||u.id::text||'\.[a-f0-9-]{36}$')
  OR e.id IS NULL OR e.state IS DISTINCT FROM u.state OR e."attemptId" IS DISTINCT FROM u."currentAttemptId"
  OR c.id IS NULL OR c."environmentId" IS DISTINCT FROM u."environmentId"
  OR NOT EXISTS(SELECT 1 FROM vamotors."AuditEntry" WHERE "commandId"=c.id AND "entityType"='Document' AND "entityId"=u.id)
  OR NOT EXISTS(SELECT 1 FROM vamotors."EntityReadVersion" WHERE "commandId"=c.id AND "entityType"='Document' AND "entityId"=u.id AND revision=u.revision)
  OR ((u.state='FINAL')<>(d.id IS NOT NULL))
  THEN RAISE EXCEPTION 'UPLOAD_EVIDENCE_REQUIRED' USING ERRCODE='23514'; END IF;
 IF u.state='INIT' AND (u."capturedTargetRevision"<>b.revision OR NOT EXISTS(SELECT 1 FROM vamotors."CommandReceipt" WHERE id=u."initCommandId" AND "commandName"='initUpload' AND "actorKey"='USER:'||u."createdBy"::text AND result=jsonb_build_object('type','UploadIntent','id',u.id,'revision',1))) THEN RAISE EXCEPTION 'INVALID_UPLOAD_TARGET' USING ERRCODE='23514'; END IF;
 IF u."currentAttemptId" IS NOT NULL AND (a.id IS NULL OR a."environmentId"<>u."environmentId" OR a."uploadId"<>u.id OR a."targetRevision"<>u."capturedTargetRevision" OR a.size<>u.size OR a.sha256<>u.sha256 OR a."contentType"<>u."contentType" OR a."claimedAt">u."expiresAt" OR a."finalKey" !~ ('^f\.'||u."environmentId"::text||'\.'||u.id::text||'\.'||a.id::text||'\.[a-f0-9-]{36}$')) THEN RAISE EXCEPTION 'INVALID_UPLOAD_CLAIM' USING ERRCODE='23514'; END IF;
 IF d.id IS NOT NULL AND (d."batchId"<>u."batchId" OR d."environmentId"<>u."environmentId" OR d."createdBy"<>u."createdBy" OR d.purpose<>u.purpose OR d.filename<>u.filename OR d.size<>a.size OR d.sha256<>a.sha256 OR d."contentType"<>a."contentType" OR d."attemptId"<>a.id OR d."finalKey"<>a."finalKey" OR d."commandId"<>a."commandId" OR b.revision<>u."capturedTargetRevision"+1 OR NOT EXISTS(SELECT 1 FROM vamotors."CommandReceipt" WHERE id=d."commandId" AND "commandName"='completeUpload' AND "actorKey"='USER:'||a."createdBy"::text AND "idempotencyKey"=a."idempotencyKey" AND "inputHash"=a."inputHash" AND result=jsonb_build_object('type','Document','id',d.id,'revision',1))) THEN RAISE EXCEPTION 'INVALID_FINAL_ATTACHMENT' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;

-- ── Append-only and guarded mutable brokerage tables ────────────────────────
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON vamotors."DealQuoteSelection" FOR EACH STATEMENT EXECUTE FUNCTION vamotors.append_only();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON vamotors."EligibilityCheck" FOR EACH STATEMENT EXECUTE FUNCTION vamotors.append_only();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON vamotors."VerificationEvent" FOR EACH STATEMENT EXECUTE FUNCTION vamotors.append_only();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON vamotors."DealEvent" FOR EACH STATEMENT EXECUTE FUNCTION vamotors.append_only();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON vamotors."ProcessingIssueFeedback" FOR EACH STATEMENT EXECUTE FUNCTION vamotors.append_only();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON vamotors."FacilityPayment" FOR EACH STATEMENT EXECUTE FUNCTION vamotors.append_only();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON vamotors."BrokerageFeeReceipt" FOR EACH STATEMENT EXECUTE FUNCTION vamotors.append_only();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON vamotors."DispatchItem" FOR EACH STATEMENT EXECUTE FUNCTION vamotors.append_only();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON vamotors."DispatchBatch" FOR EACH STATEMENT EXECUTE FUNCTION vamotors.append_only();

CREATE FUNCTION vamotors.brokerage_deal_mutation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'RETAINED_BROKERAGE_DEAL' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.revision<>1 THEN RAISE EXCEPTION 'INVALID_BROKERAGE_DEAL' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.path<>OLD.path OR NEW."customerId"<>OLD."customerId" OR NEW."companyId"<>OLD."companyId" OR NEW."originalQuoteId"<>OLD."originalQuoteId" OR NEW."createdBy"<>OLD."createdBy" OR NEW."createdAt"<>OLD."createdAt" OR NEW."commandId"<>OLD."commandId"
  OR NEW.revision::bigint<>OLD.revision::bigint+1
  OR (NEW.state='COMPLETED' AND NEW."completedAt" IS NULL)
  THEN RAISE EXCEPTION 'IMMUTABLE_BROKERAGE_DEAL' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guarded BEFORE INSERT OR UPDATE OR DELETE ON vamotors."BrokerageDeal" FOR EACH ROW EXECUTE FUNCTION vamotors.brokerage_deal_mutation();

CREATE FUNCTION vamotors.inspection_photo_retain() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'RETAINED_INSPECTION_PHOTO' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND ((to_jsonb(NEW)-'isCurrent')<>(to_jsonb(OLD)-'isCurrent') OR (OLD."isCurrent"=false AND NEW."isCurrent"=true)) THEN RAISE EXCEPTION 'IMMUTABLE_INSPECTION_PHOTO' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guarded BEFORE UPDATE OR DELETE ON vamotors."InspectionPhoto" FOR EACH ROW EXECUTE FUNCTION vamotors.inspection_photo_retain();
CREATE TRIGGER no_truncate BEFORE TRUNCATE ON vamotors."InspectionPhoto" FOR EACH STATEMENT EXECUTE FUNCTION vamotors.append_only();

CREATE FUNCTION vamotors.checklist_item_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.revision<>1 THEN RAISE EXCEPTION 'INVALID_CHECKLIST_ITEM' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF NEW."dealId"<>OLD."dealId" OR NEW."uniqueKey"<>OLD."uniqueKey" OR NEW.kind<>OLD.kind OR NEW.revision::bigint<>OLD.revision::bigint+1 THEN RAISE EXCEPTION 'IMMUTABLE_CHECKLIST_ITEM' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guarded BEFORE INSERT OR UPDATE OR DELETE ON vamotors."ChecklistItem" FOR EACH ROW EXECUTE FUNCTION vamotors.checklist_item_guard();

CREATE FUNCTION vamotors.processing_issue_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'RETAINED_PROCESSING_ISSUE' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.kind='NON_REMITTANCE' AND (SELECT path FROM vamotors."BrokerageDeal" WHERE id=NEW."dealId")<>'REFERRAL' THEN RAISE EXCEPTION 'PATH_MISMATCH' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF NEW."dealId"<>OLD."dealId" OR NEW.kind<>OLD.kind OR NEW.text<>OLD.text OR NEW."openedAt"<>OLD."openedAt" OR NEW."blocksStep" IS DISTINCT FROM OLD."blocksStep" THEN RAISE EXCEPTION 'IMMUTABLE_PROCESSING_ISSUE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guarded BEFORE INSERT OR UPDATE OR DELETE ON vamotors."ProcessingIssue" FOR EACH ROW EXECUTE FUNCTION vamotors.processing_issue_guard();

-- ── Deferred cross-table invariants ────────────────────────────────────────
CREATE FUNCTION vamotors.brokerage_guarantor_graph() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE d vamotors."BrokerageDeal"; n integer;
BEGIN
 SELECT * INTO d FROM vamotors."BrokerageDeal" WHERE id=coalesce(NEW."dealId",OLD."dealId");
 SELECT count(*) INTO n FROM vamotors."GuarantorParticipation" WHERE "dealId"=d.id;
 IF n<1 THEN RAISE EXCEPTION 'GUARANTOR_REQUIRED' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM vamotors."GuarantorParticipation" g JOIN vamotors."Customer" c ON c.id=d."customerId" WHERE g."dealId"=d.id AND g."normalizedIdentity"=c."normalizedIdentity") THEN RAISE EXCEPTION 'GUARANTOR_IDENTITY_CONFLICT' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER graph AFTER INSERT OR UPDATE ON vamotors."GuarantorParticipation" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vamotors.brokerage_guarantor_graph();

CREATE FUNCTION vamotors.checklist_document_graph() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE i vamotors."ChecklistItem"; a vamotors."Attachment";
BEGIN
 SELECT * INTO i FROM vamotors."ChecklistItem" WHERE id=NEW."checklistItemId";
 SELECT * INTO a FROM vamotors."Attachment" WHERE id=NEW."attachmentId";
 IF i.id IS NULL OR a.id IS NULL OR a."brokerageDealId" IS DISTINCT FROM i."dealId" THEN RAISE EXCEPTION 'CHECKLIST_DOCUMENT_OWNER' USING ERRCODE='23514'; END IF;
 IF (i.kind IN ('CUSTOMER_ID','GUARANTOR_ID','PASSPORT_PHOTOS','BANK_PASSBOOK','ADDRESS_PROOF','RELATIONSHIP_PROOF','AFFIDAVIT') AND a.purpose<>'PARTICIPANT_DOCUMENT')
  OR (i.kind IN ('REGISTRATION_BOOK','DELETION_LETTER','REVENUE_LICENSE','TRANSFER_PAPER','PREVIOUS_OWNER_ID') AND a.purpose<>'VEHICLE_DOCUMENT')
  OR (i.kind='PROCESSING_DOCUMENT' AND a.purpose<>'PROCESSING_DOCUMENT')
  OR (i.kind='EXTRA_KEY')
  THEN RAISE EXCEPTION 'CHECKLIST_DOCUMENT_PURPOSE' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER graph AFTER INSERT ON vamotors."ChecklistDocument" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vamotors.checklist_document_graph();

CREATE FUNCTION vamotors.checklist_item_graph() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE i vamotors."ChecklistItem";
BEGIN
 i:=NEW;
 IF i."participantId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM vamotors."GuarantorParticipation" WHERE id=i."participantId" AND "dealId"=i."dealId") THEN RAISE EXCEPTION 'CHECKLIST_PARTICIPANT' USING ERRCODE='23514'; END IF;
 IF i.kind='PASSPORT_PHOTOS' AND i.applicability='REQUIRED' AND (i.quantity<4 OR NOT EXISTS(SELECT 1 FROM vamotors."ChecklistDocument" WHERE "checklistItemId"=i.id)) THEN RAISE EXCEPTION 'CHECKLIST_INCOMPLETE' USING ERRCODE='23514'; END IF;
 IF i.applicability='NOT_REQUIRED' AND i.kind IN ('RELATIONSHIP_PROOF','DELETION_LETTER') AND i."applicabilityReason" IS NULL THEN RAISE EXCEPTION 'CHECKLIST_REASON_REQUIRED' USING ERRCODE='23514'; END IF;
 IF i.kind='PROCESSING_DOCUMENT' AND i.label IS NULL THEN RAISE EXCEPTION 'CHECKLIST_LABEL_REQUIRED' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER graph AFTER INSERT OR UPDATE ON vamotors."ChecklistItem" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vamotors.checklist_item_graph();

CREATE FUNCTION vamotors.brokerage_facility_graph() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE f vamotors."CashFacility"; withheld bigint; paid bigint;
BEGIN
 IF TG_TABLE_NAME='CashFacility' THEN SELECT * INTO f FROM vamotors."CashFacility" WHERE id=NEW.id;
 ELSE SELECT * INTO f FROM vamotors."CashFacility" WHERE id=NEW."facilityId"; END IF;
 IF f.id IS NULL THEN RETURN NULL; END IF;
 SELECT coalesce(sum((d->>'amount')::bigint),0) INTO withheld FROM jsonb_array_elements(f.deductions) d WHERE d->>'handling'='WITHHELD';
 SELECT coalesce(sum((d->>'amount')::bigint),0) INTO paid FROM jsonb_array_elements(f.deductions) d WHERE d->>'handling'='PAID_BY_DEALERSHIP';
 IF f.net<>f.gross-withheld-(CASE WHEN f."feeMode"='WITHHELD' THEN f.fee ELSE 0 END) OR f.net<0 OR f."separatelyRecoverableCharges">paid THEN RAISE EXCEPTION 'BALANCE_MISMATCH' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER graph AFTER INSERT OR UPDATE ON vamotors."CashFacility" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vamotors.brokerage_facility_graph();
CREATE CONSTRAINT TRIGGER graph AFTER INSERT ON vamotors."FacilityPayment" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vamotors.brokerage_facility_graph();

CREATE FUNCTION vamotors.dispatch_batch_graph() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE b vamotors."DispatchBatch"; n integer; item vamotors."DispatchItem"; d vamotors."BrokerageDeal";
BEGIN
 IF TG_TABLE_NAME='DispatchBatch' THEN SELECT * INTO b FROM vamotors."DispatchBatch" WHERE id=NEW.id;
 ELSE SELECT * INTO b FROM vamotors."DispatchBatch" WHERE id=NEW."batchId"; END IF;
 IF b.id IS NULL THEN RETURN NULL; END IF;
 SELECT count(*) INTO n FROM vamotors."DispatchItem" WHERE "batchId"=b.id;
 IF n<1 OR n>50 THEN RAISE EXCEPTION 'DISPATCH_MANIFEST_SIZE' USING ERRCODE='23514'; END IF;
 FOR item IN SELECT * FROM vamotors."DispatchItem" WHERE "batchId"=b.id LOOP
  IF item."sourceType"<>'BROKERAGE' OR item."brokerageDealId" IS NULL THEN RAISE EXCEPTION 'DISPATCH_SOURCE_REQUIRED' USING ERRCODE='23514'; END IF;
  SELECT * INTO d FROM vamotors."BrokerageDeal" WHERE id=item."brokerageDealId";
  IF d.id IS NULL OR d.state<>'DISPATCHED' OR d.revision<>item."sourceRevision"+1 THEN RAISE EXCEPTION 'DISPATCH_STATE_MISMATCH' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM vamotors."CommissionEntitlement" WHERE "brokerageDealId"=d.id AND "sourceType"='BROKERAGE') THEN RAISE EXCEPTION 'DISPATCH_ENTITLEMENT_REQUIRED' USING ERRCODE='23514'; END IF;
 END LOOP;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER graph AFTER INSERT OR UPDATE ON vamotors."DispatchBatch" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vamotors.dispatch_batch_graph();
CREATE CONSTRAINT TRIGGER graph AFTER INSERT ON vamotors."DispatchItem" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vamotors.dispatch_batch_graph();

-- ── Cash movement view ──────────────────────────────────────────────────────
CREATE OR REPLACE VIEW vamotors."CashMovement" AS
 SELECT 'PURCHASE'::text AS "sourceType", "cycleId" AS "sourceId", id AS "paymentId", "occurredDate" AS date, direction, amount, method, category, "commandId" FROM vamotors."PurchasePayment"
  UNION ALL SELECT 'COST'::text,"costId",id,"occurredDate",direction,amount,method,category,"commandId" FROM vamotors."CostPayment"
  UNION ALL SELECT 'DISPOSAL'::text,"disposalId",id,"occurredDate",direction,amount,method,category,"commandId" FROM vamotors."DisposalReceipt"
 UNION ALL SELECT 'REPAIR'::text,"repairId",id,"occurredDate",direction,amount,method,category,"commandId" FROM vamotors."RepairPayment"
 UNION ALL SELECT 'FACILITY'::text,"facilityId",id,"occurredDate",direction,amount,method,component,"commandId" FROM vamotors."FacilityPayment"
 UNION ALL SELECT 'BROKERAGE_FEE'::text,"dealId",id,"occurredDate",direction,amount,method,category,"commandId" FROM vamotors."BrokerageFeeReceipt";

-- ── Permissions v14 -> v15: new subjects on the protected role only ─────────
CREATE FUNCTION vamotors.brokerage_migration_canonical(j jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE jsonb_typeof(j) WHEN 'object' THEN '{'||COALESCE((SELECT string_agg(to_jsonb(key)::text||':'||vamotors.brokerage_migration_canonical(value),',' ORDER BY key COLLATE "C") FROM jsonb_each(j)),'')||'}' WHEN 'array' THEN '['||COALESCE((SELECT string_agg(vamotors.brokerage_migration_canonical(value),',' ORDER BY n) FROM jsonb_array_elements(j) WITH ORDINALITY a(value,n)),'')||']' ELSE j::text END
$$;
ALTER TABLE vamotors."RolePermission" DISABLE TRIGGER protected_permissions;
ALTER TABLE vamotors."Role" DISABLE TRIGGER protected_role;
DO $$ DECLARE aid uuid; pid uuid; new_rule jsonb; kind text; operation text;
BEGIN
 IF EXISTS(SELECT 1 FROM vamotors."Permission" WHERE "ruleHash" IS DISTINCT FROM encode(sha256(convert_to(vamotors.brokerage_migration_canonical(rule),'UTF8')),'hex') OR rule->>'subject' IN ('BrokerageDeal','CashFacility','DispatchBatch','CommissionEntitlement'))
 THEN RAISE EXCEPTION 'INVALID_PRIOR_PERMISSION' USING ERRCODE='23514'; END IF;
 SELECT id INTO aid FROM vamotors."Role" WHERE "systemKey"='ADMINISTRATOR';
 IF aid IS NOT NULL THEN
  FOREACH kind IN ARRAY ARRAY['BrokerageDeal','CashFacility','DispatchBatch','CommissionEntitlement'] LOOP
   FOREACH operation IN ARRAY ARRAY['read','create','update','dispatch','pay'] LOOP
    IF NOT ((kind='BrokerageDeal' AND operation IN ('read','create','update','dispatch'))
      OR (kind='CashFacility' AND operation IN ('read','create','update','pay'))
      OR (kind='DispatchBatch' AND operation IN ('read','create','dispatch'))
      OR (kind='CommissionEntitlement' AND operation IN ('read','create'))) THEN CONTINUE; END IF;
    new_rule:=jsonb_build_object('subject',kind,'action',operation,'fields',jsonb_build_array('*'));
    INSERT INTO vamotors."Permission"(id,"ruleHash",rule) VALUES(gen_random_uuid(),encode(sha256(convert_to(vamotors.brokerage_migration_canonical(new_rule),'UTF8')),'hex'),new_rule) ON CONFLICT("ruleHash") DO NOTHING;
    SELECT id INTO pid FROM vamotors."Permission" WHERE "ruleHash"=encode(sha256(convert_to(vamotors.brokerage_migration_canonical(new_rule),'UTF8')),'hex');
    INSERT INTO vamotors."RolePermission" VALUES(aid,pid) ON CONFLICT DO NOTHING;
   END LOOP;
  END LOOP;
  UPDATE vamotors."Role" SET revision=revision+1 WHERE id=aid;
 END IF;
END $$;
SET CONSTRAINTS ALL IMMEDIATE;
ALTER TABLE vamotors."Role" ENABLE TRIGGER protected_role;
ALTER TABLE vamotors."RolePermission" ENABLE TRIGGER protected_permissions;
DROP FUNCTION vamotors.brokerage_migration_canonical(jsonb);
COMMIT;
