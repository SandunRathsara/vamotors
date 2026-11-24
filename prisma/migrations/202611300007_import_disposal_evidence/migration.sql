BEGIN;
ALTER TABLE vamotors."Disposal" ALTER COLUMN "approvalId" DROP NOT NULL,
  DROP CONSTRAINT "Disposal_approvalKind_check",
  ADD COLUMN "importedApproval" jsonb,
  ADD CHECK ((
    ("approvalKind"='CURRENT' AND "approvalId" IS NOT NULL AND "importedApproval" IS NULL)
    OR ("approvalKind"='IMPORTED' AND "approvalId" IS NULL AND "importedApproval" IS NOT NULL
      AND ("importedApproval"->>'kind')='IMPORTED'
      AND ("importedApproval"->'historicalApprovalBypass')='true'::jsonb
      AND ("importedApproval"->>'initiatedByAdminId')="createdBy"::text
      AND "importedApproval" ?& ARRAY['rowId','batchId','legacy']
      AND nullif(btrim("importedApproval"#>>'{legacy,approverName}'),'') IS NOT NULL)
  ) IS TRUE);

ALTER TABLE vamotors."EntityReadVersion" DROP CONSTRAINT "EntityReadVersion_entityType_check",
  ADD CONSTRAINT "EntityReadVersion_entityType_check" CHECK("entityType" IN
    ('Vehicle','PurchaseRecord','Customer','Supplier','RepairVendor','FinanceCompany','Settings','RateSheet','Quote','VehicleCost',
     'ImportBatch','Document','RepairRecord','ApprovalRequest','SaleCase','SaleCompletion','BrokerageDeal','CashFacility',
     'DispatchBatch','CommissionEntitlement','Reservation','Remittance','ReconciliationRun','Disposal'));

DO $$
DECLARE source text; marker text;
BEGIN
 SELECT pg_get_functiondef('vamotors.purchase_status_guard()'::regprocedure) INTO source;
 marker:=$p$NEW.action='approvedWriteOff'$p$;
 IF strpos(source,marker)=0 THEN RAISE EXCEPTION 'IMPORT_DISPOSAL_STATUS_BASE'; END IF;
 EXECUTE replace(source,marker,$p$NEW.action IN ('approvedWriteOff','importWriteOff')$p$);

 SELECT pg_get_functiondef('vamotors.check_disposal_graph()'::regprocedure) INTO source;
 marker:=$p$i:=a.proposal->'input';$p$;
 IF strpos(source,marker)=0 THEN RAISE EXCEPTION 'IMPORT_DISPOSAL_GRAPH_BASE'; END IF;
 EXECUTE replace(source,marker,$p$
 IF d."approvalKind"='IMPORTED' THEN
   IF vamotors.command_write_xid()=pg_current_xact_id()::xid OR c.id IS NULL
     OR c."commandName"<>'importWriteOff' OR c."actorKey"<>'USER:'||d."createdBy"::text
     OR c.result<>jsonb_build_object('type','Disposal','id',d.id,'revision',1)
     OR NOT EXISTS (SELECT FROM vamotors."ImportBatch" batch WHERE batch.id=(d."importedApproval"->>'batchId')::uuid
       AND batch.state IN ('STAGED','VALIDATED') AND batch."environmentId"=c."environmentId")
     OR p.status<>'WRITTEN_OFF' OR p.available OR p."holdReason" IS NOT NULL
     OR p."closedAt" IS NULL OR (p."closedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Colombo')::date<d."occurredDate" OR d."occurredDate"<p."purchaseDate"
     OR v."activePurchaseId" IS NOT NULL
     OR EXISTS (SELECT FROM vamotors."RepairRecord" WHERE "cycleId"=cid AND "returnedDate" IS NULL)
     OR EXISTS (SELECT FROM vamotors."SaleCase" WHERE "purchaseRecordId"=cid AND state<>'CANCELLED')
     OR b.id IS DISTINCT FROM (SELECT id FROM vamotors."CycleBasisVersion" WHERE "cycleId"=cid ORDER BY version DESC LIMIT 1)
     OR d."netLoss" IS DISTINCT FROM b.total-d.proceeds
     OR NOT EXISTS (SELECT FROM vamotors."StatusEvent" se WHERE se."cycleId"=cid AND se."commandId"=c.id
       AND se."from" IN ('PURCHASED','IN_STOCK') AND se."to"='WRITTEN_OFF' AND se.action='importWriteOff'
       AND se."userId"=d."createdBy" AND se."occurredAt"=d."occurredDate"::timestamp AND se.xmin=vamotors.command_write_xid())
     OR EXISTS (SELECT FROM (VALUES ('PurchaseRecord',p.id),('Vehicle',v.id),('Disposal',d.id)) k(kind,id)
       WHERE NOT EXISTS (SELECT FROM vamotors."EntityReadVersion" ver JOIN vamotors."AuditEntry" audit
         ON audit."commandId"=ver."commandId" AND audit."entityType"=k.kind AND audit."entityId"=k.id
         WHERE ver."commandId"=c.id AND ver."entityType"=k.kind AND ver."entityId"=k.id
           AND ver.sequence=c."businessSequence" AND ver.xmin=vamotors.command_write_xid()
           AND audit.action='importWriteOff' AND audit."userId"=d."createdBy"))
   THEN RAISE EXCEPTION 'IMPORTED_DISPOSAL_GRAPH_INVALID' USING ERRCODE='23514'; END IF;
   IF d.proceeds=0 THEN
     IF EXISTS (SELECT FROM vamotors."DisposalReceipt" WHERE "disposalId"=d.id OR "commandId"=c.id)
       THEN RAISE EXCEPTION 'ZERO_DISPOSAL_PAYMENT' USING ERRCODE='23514'; END IF;
   ELSIF NOT EXISTS (SELECT FROM vamotors."DisposalReceipt" dr WHERE dr."disposalId"=d.id AND dr."cycleId"=cid
       AND dr."commandId"=c.id AND dr.amount=d.proceeds AND dr.currency=b.currency AND dr.scale=b.scale
       AND dr.direction='IN' AND dr.category='DISPOSAL' AND dr.xmin=vamotors.command_write_xid())
     THEN RAISE EXCEPTION 'IMPORTED_DISPOSAL_RECEIPT_INVALID' USING ERRCODE='23514';
   END IF;
   RETURN NULL;
 END IF;
 i:=a.proposal->'input';
 $p$);

 SELECT pg_get_functiondef('vamotors.check_disposal_root()'::regprocedure) INTO source;
 marker:=$p$FOREACH kind IN ARRAY ARRAY['PurchaseRecord','Vehicle'] LOOP$p$;
 IF strpos(source,marker)=0 THEN RAISE EXCEPTION 'IMPORT_DISPOSAL_ROOT_BASE'; END IF;
 EXECUTE replace(source,marker,$p$
 IF d."approvalKind"='IMPORTED' THEN RETURN NULL; END IF;
 FOREACH kind IN ARRAY ARRAY['PurchaseRecord','Vehicle'] LOOP
 $p$);
END $$;

CREATE FUNCTION vamotors.check_imported_disposal_source() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF EXISTS (
   SELECT FROM vamotors."Disposal" d WHERE d."approvalKind"='IMPORTED'
     AND d."importedApproval"->>'batchId'=NEW.id::text
     AND NOT EXISTS (
       SELECT FROM vamotors."ImportSourceRow" s JOIN vamotors."EntityReadVersion" v ON v.id=s."targetVersionId"
       WHERE s.id=(d."importedApproval"->>'rowId')::uuid AND s."batchId"=NEW.id
         AND s."sourceType"='VEHICLE_DISPOSAL'
         AND v."entityType"='Disposal' AND v."entityId"=d.id AND v."commandId"=d."commandId"
         AND vamotors.import_own_write(d.xmin) AND vamotors.import_own_write(s.xmin)
     )
 ) THEN RAISE EXCEPTION 'IMPORTED_DISPOSAL_SOURCE_REQUIRED' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION vamotors.check_imported_disposal_source() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER imported_disposal_source AFTER UPDATE ON vamotors."ImportBatch"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (OLD.state<>'COMMITTED' AND NEW.state='COMMITTED')
  EXECUTE FUNCTION vamotors.check_imported_disposal_source();
COMMIT;
