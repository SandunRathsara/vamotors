BEGIN;
-- Import commands use savepoints to validate each operation in isolation.
DO $$
DECLARE owner regprocedure; source text;
BEGIN
 FOREACH owner IN ARRAY ARRAY['vamotors.check_remittance_ledger()',
   'vamotors.check_reconciliation_resolution()']::regprocedure[] LOOP
   source:=pg_get_functiondef(owner);
   IF strpos(source,'pg_current_xact_id()::xid')=0 THEN RAISE EXCEPTION 'IMPORT_RECONCILIATION_GUARD_BASE'; END IF;
   EXECUTE replace(source,'pg_current_xact_id()::xid','vamotors.command_write_xid()');
 END LOOP;
END $$;
COMMIT;
