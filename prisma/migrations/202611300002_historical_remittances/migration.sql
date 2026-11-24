BEGIN;
ALTER TABLE vamotors."ImportBatch" DROP CONSTRAINT "ImportBatch_types_check",
 ADD CONSTRAINT "ImportBatch_types_check" CHECK (cardinality(types) BETWEEN 1 AND 10
   AND types <@ ARRAY['SUPPLIERS','CUSTOMERS','REPAIR_VENDORS','VEHICLES','SALES','REPAIRS','ADVANCES','FINANCE_COMPANIES','BROKERAGE','REMITTANCES']::text[]
   AND array_position(types,NULL) IS NULL);
COMMIT;
