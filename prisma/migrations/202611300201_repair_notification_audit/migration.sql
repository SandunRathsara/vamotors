BEGIN;

-- Keep the repair graph's exact cardinality for domain audit rows. A returned
-- repair can also create notifications under the same command receipt.
DO $$
DECLARE
  source text := pg_get_functiondef('vamotors.check_repair_root()'::regprocedure);
  old_count constant text := 'SELECT count(*) FROM vamotors."AuditEntry" WHERE "commandId"=c.id)<>3';
  new_count constant text := $audit$
    SELECT count(*) FROM vamotors."AuditEntry" e WHERE e."commandId"=c.id
    AND NOT (
      c."commandName"='returnRepair' AND e."entityType"='Notification'
      AND e.action='createNotification' AND EXISTS (
        SELECT 1 FROM vamotors."Notification" n
        WHERE n.id=e."entityId" AND n.kind='REPAIR_RETURNED'
        AND n."targetType"='RepairRecord' AND n."targetId"=r.id
        AND n.xmin=vamotors.command_write_xid()
      )
    )
  )<>3$audit$;
BEGIN
  IF strpos(source, old_count) = 0 THEN
    RAISE EXCEPTION 'REPAIR_AUDIT_GUARD_MISMATCH';
  END IF;
  EXECUTE replace(source, old_count, new_count);
END $$;

COMMIT;
