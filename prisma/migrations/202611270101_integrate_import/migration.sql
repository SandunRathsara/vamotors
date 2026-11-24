BEGIN;

-- Install the import privileges during migration as well as local setup.
-- Existing attachment, sale, invoice and cash movement privileges stay in place.
GRANT UPDATE ("workflowCommandId", validation, state)
  ON vamotors."ImportBatch" TO vamotors_runtime;
GRANT SELECT, INSERT
  ON vamotors."ImportedFile", vamotors."ImportSourceRow" TO vamotors_runtime;
GRANT SELECT, UPDATE (id)
  ON vamotors."ImportCommandAnchor" TO vamotors_runtime;
GRANT EXECUTE ON FUNCTION vamotors.command_write_xid() TO vamotors_runtime;

COMMIT;
