BEGIN;
-- Existing command guards validate one command's writes by xmin. Savepoints
-- give an import's commands distinct write IDs inside one atomic transaction.
CREATE TABLE vamotors."ImportCommandAnchor" (id integer PRIMARY KEY CHECK (id=1));
INSERT INTO vamotors."ImportCommandAnchor" VALUES (1);

CREATE FUNCTION vamotors.command_write_xid() RETURNS xid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE step xid;
BEGIN
 IF current_setting('vamotors.import_command', true) = 'on' THEN
  SELECT a.xmin INTO step FROM vamotors."ImportCommandAnchor" a
  WHERE EXISTS (SELECT 1 FROM pg_locks l WHERE l.pid=pg_backend_pid()
    AND l.locktype='transactionid' AND l.transactionid=a.xmin
    AND l.granted AND l.mode='ExclusiveLock');
 END IF;
 RETURN coalesce(step, pg_current_xact_id()::xid);
END $$;
REVOKE ALL ON FUNCTION vamotors.command_write_xid() FROM PUBLIC;

DO $$
DECLARE owner regprocedure; source text; revised text;
BEGIN
 FOREACH owner IN ARRAY ARRAY[
   'vamotors.acquisition_root_guard()',
   'vamotors.check_closed_financial(vamotors."PurchaseRecord",vamotors."PurchaseRecord")',
   'vamotors.check_cycle_edit(vamotors."PurchaseRecord",vamotors."PurchaseRecord",vamotors."CommandReceipt")',
   'vamotors.check_disposal_graph()', 'vamotors.check_disposal_root()',
   'vamotors.check_repair_child()', 'vamotors.check_repair_evidence()', 'vamotors.check_repair_root()',
   'vamotors.check_sale_graph()', 'vamotors.check_stock_graph()',
   'vamotors.cycle_cost_child_graph()', 'vamotors.cycle_cost_root_graph()',
   'vamotors.cycle_edit_mileage_graph()', 'vamotors.cycle_edit_vehicle_graph()',
   'vamotors.initial_cycle_transition()', 'vamotors.purchase_status_guard()',
   'vamotors.purchase_vehicle_guard()', 'vamotors.repair_notification_guard()',
   'vamotors.settlement_detail_guard()'
 ]::regprocedure[] LOOP
  source := pg_get_functiondef(owner);
  revised := replace(source, 'pg_current_xact_id()::xid', 'vamotors.command_write_xid()');
  IF revised = source THEN RAISE EXCEPTION 'IMPORT_COMMAND_GUARD_MISMATCH: %', owner; END IF;
  EXECUTE revised;
 END LOOP;
END $$;

-- A row visible to this SERIALIZABLE transaction with an in-progress writer
-- was written here. Include released subtransactions and the xid wrap epoch.
CREATE FUNCTION vamotors.import_own_write(written xid) RETURNS boolean
LANGUAGE sql SET search_path=pg_catalog AS $$
 SELECT pg_xact_status((top - mod(top, 4294967296) + child
     + CASE WHEN child < mod(top, 4294967296) THEN 4294967296 ELSE 0 END)::text::xid8) = 'in progress'
 FROM (SELECT pg_current_xact_id()::text::numeric AS top, written::text::numeric AS child) x
 WHERE child >= 3 AND (
   child >= mod(top, 4294967296) OR mod(top, 4294967296) - child > 2147483648
 )
$$;
REVOKE ALL ON FUNCTION vamotors.import_own_write(xid) FROM PUBLIC;

ALTER TABLE vamotors."ImportBatch" DROP CONSTRAINT "ImportBatch_state_check",
  DROP CONSTRAINT "ImportBatch_types_check",
  ADD CHECK (cardinality(types) BETWEEN 1 AND 9
    AND types <@ ARRAY['SUPPLIERS','CUSTOMERS','REPAIR_VENDORS','VEHICLES','SALES','REPAIRS','ADVANCES','FINANCE_COMPANIES','BROKERAGE']::text[]
    AND array_position(types,NULL) IS NULL),
  ADD COLUMN "workflowCommandId" uuid UNIQUE REFERENCES vamotors."CommandReceipt"(id) ON DELETE RESTRICT,
  ADD COLUMN validation jsonb,
  ADD CHECK ((state='STAGED' AND "workflowCommandId" IS NULL AND validation IS NULL)
    OR (state IN ('VALIDATED','COMMITTED') AND "workflowCommandId" IS NOT NULL AND validation IS NOT NULL));

CREATE TABLE vamotors."ImportedFile" (
  sha256 text PRIMARY KEY CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  "attachmentId" uuid NOT NULL UNIQUE REFERENCES vamotors."Attachment"(id) ON DELETE RESTRICT,
  "batchId" uuid NOT NULL REFERENCES vamotors."ImportBatch"(id) ON DELETE RESTRICT
);
CREATE TABLE vamotors."ImportSourceRow" (
  id uuid PRIMARY KEY,
  "batchId" uuid NOT NULL REFERENCES vamotors."ImportBatch"(id) ON DELETE RESTRICT,
  "fileHash" text NOT NULL REFERENCES vamotors."ImportedFile"(sha256) ON DELETE RESTRICT,
  namespace text NOT NULL,
  "sourceType" text NOT NULL,
  "sourceKey" text NOT NULL CHECK (length("sourceKey") BETWEEN 1 AND 200),
  "rowNumber" integer NOT NULL CHECK ("rowNumber">1),
  aliases text[] NOT NULL DEFAULT ARRAY[]::text[],
  metadata jsonb,
  "targetVersionId" uuid NOT NULL UNIQUE REFERENCES vamotors."EntityReadVersion"(id) ON DELETE RESTRICT,
  UNIQUE(namespace,"sourceType","sourceKey")
);
CREATE INDEX "ImportSourceRow_batchId_idx" ON vamotors."ImportSourceRow"("batchId");
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON vamotors."ImportedFile"
  FOR EACH STATEMENT EXECUTE FUNCTION vamotors.append_only();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON vamotors."ImportSourceRow"
  FOR EACH STATEMENT EXECUTE FUNCTION vamotors.append_only();

-- Leave the existing staging/finalization guards in place for uploads.
DROP TRIGGER retained ON vamotors."ImportBatch";
CREATE TRIGGER retained_insert_or_delete BEFORE INSERT OR DELETE ON vamotors."ImportBatch"
  FOR EACH ROW EXECUTE FUNCTION vamotors.import_protocol_mutation();
CREATE TRIGGER retained BEFORE UPDATE ON vamotors."ImportBatch"
  FOR EACH ROW WHEN (OLD."workflowCommandId" IS NOT DISTINCT FROM NEW."workflowCommandId")
  EXECUTE FUNCTION vamotors.import_protocol_mutation();
DROP TRIGGER import_graph ON vamotors."ImportBatch";
CREATE CONSTRAINT TRIGGER import_graph_insert AFTER INSERT ON vamotors."ImportBatch"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vamotors.import_protocol_graph();
CREATE CONSTRAINT TRIGGER import_graph AFTER UPDATE ON vamotors."ImportBatch"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  WHEN (OLD."workflowCommandId" IS NOT DISTINCT FROM NEW."workflowCommandId")
  EXECUTE FUNCTION vamotors.import_protocol_graph();

CREATE FUNCTION vamotors.import_workflow_graph() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE expected_command text;
BEGIN
 IF TG_TABLE_NAME='ImportedFile' THEN
  IF NOT EXISTS (SELECT 1 FROM vamotors."Attachment" a JOIN vamotors."ImportBatch" b ON b.id=a."batchId"
    WHERE a.id=NEW."attachmentId" AND a.sha256=NEW.sha256 AND a."batchId"=NEW."batchId"
    AND a.purpose='IMPORT_SOURCE' AND b.state='COMMITTED' AND b.xmin=pg_current_xact_id()::xid)
  THEN RAISE EXCEPTION 'IMPORT_FILE_EVIDENCE_REQUIRED' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='ImportSourceRow' THEN
  IF NOT EXISTS (SELECT 1 FROM vamotors."ImportedFile" f JOIN vamotors."ImportBatch" b ON b.id=f."batchId"
    JOIN vamotors."EntityReadVersion" v ON v.id=NEW."targetVersionId"
    WHERE f.sha256=NEW."fileHash" AND f."batchId"=NEW."batchId" AND b.namespace=NEW.namespace
    AND f.xmin=pg_current_xact_id()::xid AND vamotors.import_own_write(v.xmin))
  THEN RAISE EXCEPTION 'IMPORT_ROW_EVIDENCE_REQUIRED' USING ERRCODE='23514'; END IF;
 ELSE
  expected_command := CASE NEW.state WHEN 'VALIDATED' THEN 'previewImport' WHEN 'COMMITTED' THEN 'confirmImport' END;
  IF expected_command IS NULL OR OLD.state='COMMITTED'
    OR (NEW.state='COMMITTED' AND (OLD.state<>'VALIDATED' OR OLD.validation IS DISTINCT FROM NEW.validation))
    OR NEW.revision::bigint<>OLD.revision::bigint+1
    OR (to_jsonb(NEW)-ARRAY['workflowCommandId','validation','state','revision'])<>(to_jsonb(OLD)-ARRAY['workflowCommandId','validation','state','revision'])
    OR NOT EXISTS (SELECT 1 FROM vamotors."CommandReceipt" c WHERE c.id=NEW."workflowCommandId"
      AND c."commandName"=expected_command AND c."environmentId"=NEW."environmentId"
      AND c.result=jsonb_build_object('type','ImportBatch','id',NEW.id,'revision',NEW.revision)
      AND c.xmin=pg_current_xact_id()::xid
      AND EXISTS (SELECT 1 FROM vamotors."EntityReadVersion" v WHERE v."commandId"=c.id AND v."entityType"='ImportBatch' AND v."entityId"=NEW.id AND v.revision=NEW.revision)
      AND EXISTS (SELECT 1 FROM vamotors."AuditEntry" a WHERE a."commandId"=c.id AND a."entityType"='ImportBatch' AND a."entityId"=NEW.id))
    OR (NEW.state='COMMITTED' AND NOT EXISTS (SELECT 1 FROM vamotors."ImportSourceRow" r WHERE r."batchId"=NEW.id))
  THEN RAISE EXCEPTION 'INVALID_IMPORT_TRANSITION' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER import_workflow AFTER UPDATE ON vamotors."ImportBatch"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  WHEN (OLD."workflowCommandId" IS DISTINCT FROM NEW."workflowCommandId")
  EXECUTE FUNCTION vamotors.import_workflow_graph();
CREATE CONSTRAINT TRIGGER import_workflow AFTER INSERT ON vamotors."ImportedFile"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vamotors.import_workflow_graph();
CREATE CONSTRAINT TRIGGER import_workflow AFTER INSERT ON vamotors."ImportSourceRow"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vamotors.import_workflow_graph();
COMMIT;
