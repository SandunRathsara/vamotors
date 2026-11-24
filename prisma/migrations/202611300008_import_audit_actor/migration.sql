BEGIN;
DO $$
DECLARE source text; marker text;
BEGIN
  SELECT pg_get_functiondef('vamotors.check_disposal_graph()'::regprocedure) INTO source;
  marker:=$p$audit.action='importWriteOff' AND audit."userId"=d."createdBy"$p$;
  IF strpos(source,marker)=0 THEN RAISE EXCEPTION 'IMPORT_DISPOSAL_AUDIT_BASE'; END IF;
  EXECUTE replace(source,marker,$p$audit.action='importWriteOff' AND audit."actorKind"='IMPORT'
     AND audit."initiatedBy"=d."createdBy" AND audit.xmin=vamotors.command_write_xid()$p$);

  SELECT pg_get_functiondef('vamotors.import_workflow_graph()'::regprocedure) INTO source;
  marker:=$p$a."entityId"=NEW.id))$p$;
  IF strpos(source,marker)=0 THEN RAISE EXCEPTION 'IMPORT_AUDIT_BASE'; END IF;
  EXECUTE replace(source,marker,$p$a."entityId"=NEW.id AND a.action=expected_command
    AND a.xmin=pg_current_xact_id()::xid AND (NEW.state<>'COMMITTED'
      OR (a."actorKind"='IMPORT' AND c."actorKey"='USER:'||a."initiatedBy"::text))))$p$);
END $$;
COMMIT;
