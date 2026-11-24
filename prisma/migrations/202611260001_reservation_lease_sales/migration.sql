BEGIN;
SELECT value FROM vamotors."BusinessSequence" WHERE id=1 FOR UPDATE;
SELECT vamotors.lock_admin_guard();

ALTER TABLE vamotors."SaleCase" DROP CONSTRAINT "SaleCase_kind_check", DROP CONSTRAINT "SaleCase_state_check",
  ADD CHECK (kind IN ('CASH','TRADE_IN','ADVANCE','LEASE')),
  ADD CHECK (state IN ('RESERVED','EXPIRED','FINANCE_PENDING','DO_RECEIVED','COMPLETED','CANCELLED'));
ALTER TABLE vamotors."SaleReceipt" DROP CONSTRAINT "SaleReceipt_category_check",
  ADD COLUMN "refundOf" uuid UNIQUE,
  ADD UNIQUE ("refundOf","saleCaseId","purchaseRecordId"),
  ADD FOREIGN KEY ("refundOf","saleCaseId","purchaseRecordId")
    REFERENCES vamotors."SaleReceipt"(id,"saleCaseId","purchaseRecordId") ON DELETE RESTRICT,
  ADD CHECK (category IN ('SALE','ADVANCE','BALANCE','DOWN_PAYMENT','LENDER','REFUND')),
  ADD CHECK ((category='REFUND')=("refundOf" IS NOT NULL)
    AND (category='SALE' OR ("reversalOf" IS NULL AND direction=CASE WHEN category='REFUND' THEN 'OUT' ELSE 'IN' END)));
CREATE UNIQUE INDEX sale_deposit_and_resolution_once ON vamotors."SaleReceipt"("saleCaseId", category)
  WHERE category IN ('ADVANCE','BALANCE','DOWN_PAYMENT');
ALTER TABLE vamotors."StatusEvent" ALTER COLUMN "userId" DROP NOT NULL,
  ADD CHECK ("userId" IS NOT NULL OR action='runExpiry');
ALTER TABLE vamotors."PurchaseRecord" DROP CONSTRAINT initial_cycle_capability,
  ADD CONSTRAINT initial_cycle_capability CHECK (
    ((status IN ('PURCHASED','IN_STOCK','IN_REPAIR','ADVANCE_PLACED','ADVANCE_EXPIRED','FINANCE_PENDING','DO_RECEIVED') AND "closedAt" IS NULL)
     OR (status IN ('WRITTEN_OFF','SOLD') AND "closedAt" IS NOT NULL AND NOT available))
    AND (("acquisitionKind"='SUPPLIER' AND "tradeInSourceSaleId" IS NULL)
      OR ("acquisitionKind"='TRADE_IN' AND "tradeInSourceSaleId" IS NOT NULL AND "purchaseType"='CASH')));
ALTER TABLE vamotors."EntityReadVersion" DROP CONSTRAINT "EntityReadVersion_entityType_check",
  ADD CONSTRAINT "EntityReadVersion_entityType_check" CHECK("entityType" IN
    ('Vehicle','PurchaseRecord','Customer','Supplier','RepairVendor','FinanceCompany','Settings','RateSheet','Quote','VehicleCost',
     'ImportBatch','Document','RepairRecord','ApprovalRequest','SaleCase','SaleCompletion','BrokerageDeal','CashFacility',
     'DispatchBatch','CommissionEntitlement','Reservation'));

CREATE TABLE vamotors."Reservation" (
  id uuid PRIMARY KEY,
  "saleCaseId" uuid NOT NULL UNIQUE REFERENCES vamotors."SaleCase"(id) ON DELETE RESTRICT,
  amount bigint NOT NULL CHECK(amount BETWEEN 1 AND 99999999999999),
  "placedDate" date NOT NULL,
  "listedBasis" bigint NOT NULL CHECK("listedBasis" BETWEEN 1 AND 99999999999999),
  "policySnapshot" jsonb NOT NULL,
  "validThrough" date NOT NULL,
  "expiresAt" timestamp(3) NOT NULL,
  "warningAt" timestamp(3) NOT NULL,
  "warnedAt" timestamp(3),
  "expiredAt" timestamp(3),
  state text NOT NULL CHECK(state IN ('ACTIVE','EXPIRED','CONVERTING','CONVERTED','CANCELLED','REFUNDED')),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  "retainedAmount" bigint CHECK("retainedAmount" BETWEEN 0 AND amount),
  "resolvedAt" timestamp(3),
  "resolutionReason" text,
  disposition text CHECK(disposition IN ('RELEASE','HOLD')),
  CHECK ("placedDate"<"validThrough" AND "warningAt"<"expiresAt"),
  CHECK ((state IN ('CONVERTED','CANCELLED','REFUNDED'))=("resolvedAt" IS NOT NULL)),
  CHECK ((state IN ('CANCELLED','REFUNDED'))=(disposition IS NOT NULL AND "retainedAmount" IS NOT NULL))
);
CREATE INDEX "Reservation_state_expiresAt_id_idx" ON vamotors."Reservation"(state,"expiresAt",id);

ALTER TABLE vamotors."UploadIntent" ADD COLUMN "saleCaseId" uuid REFERENCES vamotors."SaleCase"(id) ON DELETE RESTRICT;
ALTER TABLE vamotors."Attachment" ADD COLUMN "saleCaseId" uuid REFERENCES vamotors."SaleCase"(id) ON DELETE RESTRICT;
DO $$
DECLARE name text; rule text; definition text;
BEGIN
  FOREACH name IN ARRAY ARRAY['UploadIntent','Attachment'] LOOP
    FOREACH rule IN ARRAY ARRAY['target','purpose'] LOOP
      SELECT pg_get_expr(conbin, conrelid) INTO STRICT definition FROM pg_constraint
        WHERE conrelid=format('vamotors.%I',name)::regclass AND conname=name||'_'||rule||'_check';
      EXECUTE format('ALTER TABLE vamotors.%I DROP CONSTRAINT %I',name,name||'_'||rule||'_check');
      EXECUTE format('ALTER TABLE vamotors.%I ADD CONSTRAINT %I CHECK ((%s AND "saleCaseId" IS NULL) OR
        ("targetType"=''SALE_CASE'' AND "saleCaseId" IS NOT NULL AND "batchId" IS NULL AND "brokerageDealId" IS NULL
        AND "photoCategory" IS NULL AND purpose=''DO'' AND "contentType"=''application/pdf'' AND size BETWEEN 1 AND 5242880))',
        name,name||'_'||rule||'_check',definition);
    END LOOP;
  END LOOP;
END $$;

CREATE TABLE vamotors."InventoryLease" (
  "saleCaseId" uuid PRIMARY KEY REFERENCES vamotors."SaleCase"(id) ON DELETE RESTRICT,
  "companyId" uuid NOT NULL REFERENCES vamotors."FinanceCompany"(id) ON DELETE RESTRICT,
  "companyName" text NOT NULL,
  "policySnapshot" jsonb NOT NULL,
  down bigint NOT NULL CHECK(down BETWEEN 1 AND 99999999999999),
  principal bigint NOT NULL CHECK(principal BETWEEN 1 AND 99999999999999),
  "termMonths" integer NOT NULL CHECK("termMonths" BETWEEN 1 AND 120),
  "openedDate" date NOT NULL,
  "doAttachmentId" uuid UNIQUE REFERENCES vamotors."Attachment"(id) ON DELETE RESTRICT,
  "issueDate" date,
  CHECK (("doAttachmentId" IS NULL)=("issueDate" IS NULL)),
  CHECK ("issueDate">="openedDate")
);
CREATE INDEX "InventoryLease_companyId_idx" ON vamotors."InventoryLease"("companyId");
ALTER TABLE vamotors."CommissionEntitlement" ADD FOREIGN KEY ("saleCaseId") REFERENCES vamotors."SaleCase"(id) ON DELETE RESTRICT;
CREATE TABLE vamotors."JobRun" (
  id uuid PRIMARY KEY,
  "actorKey" text NOT NULL,
  "runKey" uuid NOT NULL,
  "inputHash" text NOT NULL,
  through timestamp(3) NOT NULL,
  cursor text,
  "nextCursor" text,
  status text NOT NULL CHECK(status IN ('RUNNING','SUCCESS','PARTIAL','FAILED')),
  "startedAt" timestamp(3) NOT NULL DEFAULT now(),
  "finishedAt" timestamp(3),
  outcome jsonb,
  UNIQUE("actorKey","runKey")
);
CREATE INDEX "JobRun_status_finishedAt_idx" ON vamotors."JobRun"(status,"finishedAt");

-- Keep all historical cash legs. T10 source categories share the existing sale ledger.
CREATE OR REPLACE VIEW vamotors."CashMovement" AS
 SELECT 'PURCHASE'::text AS "sourceType", "cycleId" AS "sourceId", id AS "paymentId", "occurredDate" AS date, direction, amount, method, category, "commandId" FROM vamotors."PurchasePayment"
 UNION ALL SELECT 'COST',"costId",id,"occurredDate",direction,amount,method,category,"commandId" FROM vamotors."CostPayment"
 UNION ALL SELECT 'DISPOSAL',"disposalId",id,"occurredDate",direction,amount,method,category,"commandId" FROM vamotors."DisposalReceipt"
 UNION ALL SELECT 'REPAIR',"repairId",id,"occurredDate",direction,amount,method,category,"commandId" FROM vamotors."RepairPayment"
 UNION ALL SELECT 'FACILITY',"facilityId",id,"occurredDate",direction,amount,method,component,"commandId" FROM vamotors."FacilityPayment"
 UNION ALL SELECT 'BROKERAGE_FEE',"dealId",id,"occurredDate",direction,amount,method,category,"commandId" FROM vamotors."BrokerageFeeReceipt"
 UNION ALL SELECT 'SALE',"saleCaseId",id,"occurredDate",direction,amount,method,category,"commandId" FROM vamotors."SaleReceipt";

CREATE FUNCTION vamotors.commitment_edge(old_status text, new_status text, sale_state text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT CASE sale_state
   WHEN 'RESERVED' THEN old_status='IN_STOCK' AND new_status='ADVANCE_PLACED'
   WHEN 'EXPIRED' THEN old_status='ADVANCE_PLACED' AND new_status='ADVANCE_EXPIRED'
   WHEN 'FINANCE_PENDING' THEN old_status IN ('IN_STOCK','ADVANCE_PLACED','ADVANCE_EXPIRED') AND new_status='FINANCE_PENDING'
   WHEN 'DO_RECEIVED' THEN old_status='FINANCE_PENDING' AND new_status='DO_RECEIVED'
   WHEN 'COMPLETED' THEN old_status IN ('ADVANCE_PLACED','ADVANCE_EXPIRED','DO_RECEIVED') AND new_status='SOLD'
   WHEN 'CANCELLED' THEN old_status IN ('ADVANCE_PLACED','ADVANCE_EXPIRED','FINANCE_PENDING','DO_RECEIVED') AND new_status='IN_STOCK'
   ELSE false END;
$$;
CREATE FUNCTION vamotors.commitment_changed(cid uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT EXISTS (SELECT FROM vamotors."SaleCase" s WHERE s."purchaseRecordId"=cid AND s.kind IN ('ADVANCE','LEASE')
   AND s.xmin=pg_current_xact_id()::xid);
$$;
CREATE FUNCTION vamotors.commitment_transition(cid uuid, old_status text, new_status text) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT EXISTS (SELECT FROM vamotors."SaleCase" s WHERE s."purchaseRecordId"=cid AND s.kind IN ('ADVANCE','LEASE')
   AND s.xmin=pg_current_xact_id()::xid AND vamotors.commitment_edge(old_status,new_status,s.state));
$$;

-- Extend the prior guards in place. Ordinary sale, repair, stock and disposal
-- branches still execute their original validations.
DO $$
DECLARE source text; fragment text;
BEGIN
  SELECT pg_get_functiondef('vamotors.acquisition_root_guard()'::regprocedure) INTO source;
  fragment := 'IF EXISTS (SELECT 1 FROM vamotors."RepairRecord" WHERE';
  IF strpos(source, fragment)=0 THEN RAISE EXCEPTION 'COMMITMENT_ROOT_GUARD_BASE'; END IF;
  EXECUTE replace(source, fragment, $patch$IF vamotors.commitment_transition(NEW.id,OLD.status::text,NEW.status::text)
    AND NEW.revision::bigint=OLD.revision::bigint+1
    AND (to_jsonb(NEW)-ARRAY['status','available','holdReason','closedAt','revision','updatedAt'])
      =(to_jsonb(OLD)-ARRAY['status','available','holdReason','closedAt','revision','updatedAt'])
    AND (OLD.status<>'IN_STOCK' OR OLD.available)
    THEN RETURN NEW; END IF;
  $patch$ || fragment);
  SELECT pg_get_functiondef('vamotors.initial_cycle_transition()'::regprocedure) INTO source;
  fragment := 'IF NEW.status IS DISTINCT FROM OLD.status THEN';
  IF strpos(source, fragment)=0 THEN RAISE EXCEPTION 'COMMITMENT_TRANSITION_BASE'; END IF;
  EXECUTE replace(source, fragment, fragment || $patch$
    IF vamotors.commitment_transition(NEW.id,OLD.status::text,NEW.status::text) THEN RETURN NEW; END IF;
  $patch$);
  SELECT pg_get_functiondef('vamotors.purchase_vehicle_guard()'::regprocedure) INTO source;
  fragment := 'IF TG_OP = ''UPDATE'' THEN';
  EXECUTE replace(source, fragment, fragment || $patch$
    IF NEW."activePurchaseId"=OLD."activePurchaseId" AND vamotors.commitment_changed(NEW."activePurchaseId")
      AND NEW.revision::bigint=OLD.revision::bigint+1
      AND (to_jsonb(NEW)-ARRAY['revision','updatedAt'])=(to_jsonb(OLD)-ARRAY['revision','updatedAt'])
      THEN RETURN NEW; END IF;
  $patch$);
  SELECT pg_get_functiondef('vamotors.cycle_edit_vehicle_graph()'::regprocedure) INTO source;
  fragment := 'BEGIN';
  EXECUTE replace(source, fragment, fragment || $patch$
    IF NEW."activePurchaseId"=OLD."activePurchaseId" AND vamotors.commitment_changed(NEW."activePurchaseId")
      AND (to_jsonb(NEW)-ARRAY['revision','updatedAt'])=(to_jsonb(OLD)-ARRAY['revision','updatedAt'])
      THEN RETURN NULL; END IF;
  $patch$);
  SELECT pg_get_functiondef('vamotors.check_stock_graph()'::regprocedure) INTO source;
  EXECUTE replace(source,'BEGIN',$patch$BEGIN
    IF vamotors.commitment_transition(NEW.id,OLD.status::text,NEW.status::text) THEN RETURN NULL; END IF;
  $patch$);
  SELECT pg_get_functiondef('vamotors.purchase_status_guard()'::regprocedure) INTO source;
  fragment := 'IF c.id IS NULL OR c."actorKey"';
  IF strpos(source,fragment)=0 THEN RAISE EXCEPTION 'COMMITMENT_STATUS_BASE'; END IF;
  EXECUTE replace(source,fragment,$patch$
    IF c."commandName" IN ('placeReservation','startFinance','convertReservation','cancelRetained','recordDO','confirmDOAndHandover','runExpiry','reviewApproval')
      AND NEW.action=c."commandName" AND p.status=NEW."to"
      AND c."actorKey"=coalesce('USER:'||NEW."userId"::text,'SYSTEM:RESERVATION_EXPIRY')
      AND vamotors.commitment_transition(p.id,NEW."from"::text,NEW."to"::text)
      AND NOT EXISTS(SELECT FROM vamotors."StatusEvent" se WHERE se."commandId"=c.id)
      THEN RETURN NEW; END IF;
  $patch$ || fragment);
  SELECT pg_get_functiondef('vamotors.check_sale_graph()'::regprocedure) INTO source;
  fragment := 'IF s.id IS NULL OR sc.id IS NULL';
  IF strpos(source,fragment)=0 THEN RAISE EXCEPTION 'COMMITMENT_SALE_GRAPH_BASE'; END IF;
  EXECUTE replace(source,fragment,$patch$IF s.kind IN ('ADVANCE','LEASE') THEN RETURN NULL; END IF;
  $patch$ || fragment);
END $$;

CREATE FUNCTION vamotors.check_commitment_graph() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE s vamotors."SaleCase"; p vamotors."PurchaseRecord"; r vamotors."Reservation"; l vamotors."InventoryLease";
  f vamotors."SaleCompletion"; a vamotors."SaleReceipt"; d vamotors."SaleReceipt";
  sid uuid; advance_paid numeric; balance_paid numeric; down_paid numeric; lender_paid numeric; refunded numeric;
BEGIN
  IF TG_TABLE_NAME='SaleCase' THEN sid:=NEW.id;
  ELSIF TG_TABLE_NAME='PurchaseRecord' THEN
    SELECT id INTO sid FROM vamotors."SaleCase" WHERE "purchaseRecordId"=NEW.id AND state<>'CANCELLED';
    IF sid IS NULL AND NEW.status IN ('ADVANCE_PLACED','ADVANCE_EXPIRED','FINANCE_PENDING','DO_RECEIVED')
      THEN RAISE EXCEPTION 'MISSING_SALE_COMMITMENT' USING ERRCODE='23514'; END IF;
  ELSE sid:=NEW."saleCaseId"; END IF;
  SELECT * INTO s FROM vamotors."SaleCase" WHERE id=sid;
  IF s.id IS NULL OR s.kind NOT IN ('ADVANCE','LEASE') THEN RETURN NULL; END IF;
  SELECT * INTO STRICT p FROM vamotors."PurchaseRecord" WHERE id=s."purchaseRecordId";
  SELECT * INTO r FROM vamotors."Reservation" WHERE "saleCaseId"=sid;
  SELECT * INTO l FROM vamotors."InventoryLease" WHERE "saleCaseId"=sid;
  SELECT * INTO f FROM vamotors."SaleCompletion" WHERE "saleCaseId"=sid;
  SELECT * INTO a FROM vamotors."SaleReceipt" WHERE "saleCaseId"=sid AND category='ADVANCE';
  SELECT * INTO d FROM vamotors."SaleReceipt" WHERE "saleCaseId"=sid AND category='DOWN_PAYMENT';
  SELECT coalesce(sum(amount) FILTER (WHERE category='ADVANCE'),0),
    coalesce(sum(amount) FILTER (WHERE category='BALANCE'),0),
    coalesce(sum(amount) FILTER (WHERE category='DOWN_PAYMENT'),0),
    coalesce(sum(amount) FILTER (WHERE category='LENDER'),0),
    coalesce(sum(amount) FILTER (WHERE category='REFUND'),0)
    INTO advance_paid,balance_paid,down_paid,lender_paid,refunded
    FROM vamotors."SaleReceipt" WHERE "saleCaseId"=sid;
  IF (s.kind='LEASE')<>(l."saleCaseId" IS NOT NULL)
    OR (s.kind='ADVANCE' AND r.id IS NULL)
    OR (s.state='COMPLETED')<>(f.id IS NOT NULL)
    OR (s.state<>'CANCELLED' AND (p.available OR p.status::text IS DISTINCT FROM CASE s.state
      WHEN 'RESERVED' THEN 'ADVANCE_PLACED' WHEN 'EXPIRED' THEN 'ADVANCE_EXPIRED'
      WHEN 'FINANCE_PENDING' THEN 'FINANCE_PENDING' WHEN 'DO_RECEIVED' THEN 'DO_RECEIVED' WHEN 'COMPLETED' THEN 'SOLD' END))
    OR (s."listedSnapshot">s."agreedPrice" AND s."approvalId" IS NULL)
    OR EXISTS(SELECT FROM vamotors."TradeInConsideration" t WHERE t."saleCaseId"=sid)
    OR EXISTS(SELECT FROM vamotors."SaleReceipt" x WHERE x."saleCaseId"=sid AND (x.category='SALE'
      OR (x.category='REFUND' AND x."refundOf" IS DISTINCT FROM CASE WHEN s.kind='ADVANCE' THEN a.id ELSE d.id END)))
    OR advance_paid<>coalesce(r.amount,0)
    OR (r.id IS NOT NULL AND (r."listedBasis" IS DISTINCT FROM s."listedSnapshot" OR r."placedDate"<>a."occurredDate"
        OR r.state IS DISTINCT FROM CASE s.state WHEN 'RESERVED' THEN 'ACTIVE' WHEN 'EXPIRED' THEN 'EXPIRED'
          WHEN 'COMPLETED' THEN 'CONVERTED' WHEN 'CANCELLED' THEN CASE WHEN refunded>0 THEN 'REFUNDED' ELSE 'CANCELLED' END
          ELSE 'CONVERTING' END))
    OR (s.state='CANCELLED' AND (refunded>advance_paid+down_paid OR
      (r.id IS NOT NULL AND r."retainedAmount"<>advance_paid+down_paid-refunded)))
    OR (s.state<>'CANCELLED' AND refunded<>0)
    OR (s.kind='ADVANCE' AND (down_paid<>0 OR lender_paid<>0 OR
      balance_paid<>CASE WHEN s.state='COMPLETED' THEN s."agreedPrice"-advance_paid ELSE 0 END))
    OR (s.kind='LEASE' AND (balance_paid<>0 OR l.down<>down_paid OR d."occurredDate"<>l."openedDate"
      OR l.down::numeric+l.principal+advance_paid<>s."agreedPrice" OR lender_paid>l.principal
      OR (s.state<>'COMPLETED' AND lender_paid<>0)
      OR (s.state IN ('DO_RECEIVED','COMPLETED') AND l."doAttachmentId" IS NULL)
      OR (l."doAttachmentId" IS NOT NULL AND NOT EXISTS(SELECT FROM vamotors."Attachment" x
        WHERE x.id=l."doAttachmentId" AND x."saleCaseId"=sid AND x.purpose='DO'))))
    THEN RAISE EXCEPTION 'INVALID_SALE_COMMITMENT' USING ERRCODE='23514'; END IF;

  IF f.id IS NOT NULL AND (f."agreedPrice"<>s."agreedPrice"
    OR NOT EXISTS(SELECT FROM vamotors."CycleBasisVersion" b WHERE b.id=f."basisVersionId" AND b."cycleId"=p.id
      AND f."originalProfit"::numeric=s."agreedPrice"::numeric-b.total)
    OR NOT EXISTS(SELECT FROM vamotors."MileageReading" m WHERE m."sourceSaleCompletionId"=f.id AND m."cycleId"=p.id
      AND m."vehicleId"=p."vehicleId" AND m.reading=f."handoverMileage" AND m."recordedDate"=f."saleDate" AND m."commandId"=f."commandId")
    OR (l."saleCaseId" IS NOT NULL AND NOT EXISTS(SELECT FROM vamotors."CommissionEntitlement" e
      WHERE e."saleCaseId"=sid AND e."companyId"=l."companyId" AND e."sourceType"='VEHICLE_SALE'
        AND e."commandId"=f."commandId" AND e."sentDate"=f."saleDate")))
    THEN RAISE EXCEPTION 'INVALID_COMMITMENT_COMPLETION' USING ERRCODE='23514'; END IF;

  IF TG_TABLE_NAME='SaleCase' AND (TG_OP='INSERT' OR OLD.state IS DISTINCT FROM NEW.state) THEN
    IF NOT EXISTS(SELECT FROM vamotors."StatusEvent" e JOIN vamotors."AuditEntry" audit ON audit."commandId"=e."commandId"
      WHERE e."cycleId"=p.id AND e.xmin=pg_current_xact_id()::xid
        AND audit."entityType"='SaleCase' AND audit."entityId"=sid AND audit.xmin=pg_current_xact_id()::xid
        AND vamotors.commitment_edge(e."from"::text,e."to"::text,s.state))
      THEN RAISE EXCEPTION 'MISSING_COMMITMENT_TRANSITION' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER commitment_graph AFTER INSERT OR UPDATE ON vamotors."SaleCase" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vamotors.check_commitment_graph();
CREATE CONSTRAINT TRIGGER commitment_graph AFTER INSERT OR UPDATE ON vamotors."PurchaseRecord" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vamotors.check_commitment_graph();
CREATE CONSTRAINT TRIGGER commitment_graph AFTER INSERT ON vamotors."SaleReceipt" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vamotors.check_commitment_graph();
CREATE CONSTRAINT TRIGGER commitment_graph AFTER INSERT ON vamotors."SaleCompletion" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vamotors.check_commitment_graph();
CREATE CONSTRAINT TRIGGER commitment_graph AFTER INSERT OR UPDATE ON vamotors."Reservation" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vamotors.check_commitment_graph();
CREATE CONSTRAINT TRIGGER commitment_graph AFTER INSERT OR UPDATE ON vamotors."InventoryLease" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vamotors.check_commitment_graph();

-- The sale target uses the same attempt, event and byte checks as brokerage.
-- Upload finalization leaves sale revision unchanged until recordDO consumes it.
DO $$
DECLARE source text; branch text; start_marker text := 'IF u."targetType"=''BROKERAGE_DEAL'' THEN';
  end_marker text := 'SELECT * INTO b FROM vamotors."ImportBatch" WHERE id=u."batchId";';
BEGIN
  SELECT pg_get_functiondef('vamotors.import_protocol_graph()'::regprocedure) INTO source;
  branch:=split_part(split_part(source,start_marker,2),end_marker,1);
  IF branch='' THEN RAISE EXCEPTION 'DO_UPLOAD_GRAPH_BASE'; END IF;
  branch:=replace(branch,'SELECT * INTO bd FROM vamotors."BrokerageDeal" WHERE id=u."brokerageDealId";',
    'SELECT * INTO sale FROM vamotors."SaleCase" WHERE id=u."saleCaseId";');
  branch:=replace(branch,'bd.id IS NULL OR bd.path NOT IN (''APPLICATION'',''REFERRAL'')','sale.id IS NULL OR sale.kind<>''LEASE'' OR sale.state<>''FINANCE_PENDING''');
  branch:=replace(branch,'bd.revision<>u."capturedTargetRevision"+1','sale.revision<>u."capturedTargetRevision"');
  branch:=replace(branch,'bd.revision','sale.revision');
  branch:=replace(branch,'"brokerageDealId"','"saleCaseId"');
  branch:=replace(branch,'''BROKERAGE_DEAL''','''SALE_CASE''');
  branch:=replace(branch,'BROKERAGE_','DO_');
  source:=replace(source,'DECLARE b vamotors."ImportBatch";','DECLARE sale vamotors."SaleCase"; b vamotors."ImportBatch";');
  EXECUTE replace(source,start_marker,'IF u."targetType"=''SALE_CASE'' THEN'||branch||start_marker);
END $$;

REVOKE ALL ON FUNCTION vamotors.check_commitment_graph(), vamotors.commitment_changed(uuid),
  vamotors.commitment_transition(uuid,text,text), vamotors.commitment_edge(text,text,text) FROM PUBLIC;
GRANT SELECT, INSERT ON vamotors."Reservation", vamotors."InventoryLease", vamotors."JobRun" TO vamotors_runtime;
GRANT UPDATE ("warnedAt","expiredAt",state,revision,"retainedAmount","resolvedAt","resolutionReason",disposition) ON vamotors."Reservation" TO vamotors_runtime;
GRANT UPDATE ("doAttachmentId","issueDate") ON vamotors."InventoryLease" TO vamotors_runtime;
GRANT UPDATE (status,"startedAt","finishedAt","nextCursor",outcome) ON vamotors."JobRun" TO vamotors_runtime;
GRANT UPDATE (state,kind) ON vamotors."SaleCase" TO vamotors_runtime;
GRANT SELECT ("saleCaseId"), INSERT ("saleCaseId") ON vamotors."Attachment", vamotors."UploadIntent" TO vamotors_runtime;
COMMIT;
