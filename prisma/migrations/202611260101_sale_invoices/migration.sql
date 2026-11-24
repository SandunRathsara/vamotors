BEGIN;

CREATE UNIQUE INDEX "SaleCorrection_id_completionId_key"
  ON vamotors."SaleCorrection" (id, "completionId");

CREATE TABLE vamotors."InvoiceVersion" (
  id uuid PRIMARY KEY,
  "completionId" uuid NOT NULL REFERENCES vamotors."SaleCompletion"(id) ON DELETE RESTRICT,
  "correctionId" uuid,
  version integer NOT NULL CHECK (version > 0),
  "saleRevision" integer NOT NULL CHECK ("saleRevision" > 0),
  number text NOT NULL UNIQUE,
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  "finalKey" text NOT NULL UNIQUE,
  state text NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING', 'FAILED', 'READY')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "generationAt" timestamp(3),
  "generatorId" uuid,
  "generatorName" text,
  size integer,
  sha256 text,
  UNIQUE ("completionId", version),
  FOREIGN KEY ("correctionId", "completionId")
    REFERENCES vamotors."SaleCorrection"(id, "completionId") ON DELETE RESTRICT,
  CHECK (
    ("generationAt" IS NULL AND "generatorId" IS NULL AND "generatorName" IS NULL AND state = 'PENDING')
    OR ("generationAt" IS NOT NULL AND "generatorId" IS NOT NULL AND "generatorName" IS NOT NULL)
  ),
  CHECK (
    (state = 'READY' AND size IS NOT NULL AND size BETWEEN 1 AND 5242880
      AND sha256 IS NOT NULL AND sha256 ~ '^[0-9a-f]{64}$')
    OR (state <> 'READY' AND size IS NULL AND sha256 IS NULL)
  )
);

CREATE FUNCTION vamotors.protect_invoice_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state = 'READY' OR NEW.revision <> OLD.revision + 1
    OR (to_jsonb(OLD) - ARRAY['state', 'revision', 'generationAt', 'generatorId', 'generatorName', 'size', 'sha256'])
       IS DISTINCT FROM
       (to_jsonb(NEW) - ARRAY['state', 'revision', 'generationAt', 'generatorId', 'generatorName', 'size', 'sha256'])
    OR (OLD."generationAt" IS NOT NULL AND
      (OLD."generationAt", OLD."generatorId", OLD."generatorName") IS DISTINCT FROM
      (NEW."generationAt", NEW."generatorId", NEW."generatorName"))
  THEN
    RAISE EXCEPTION 'IMMUTABLE_INVOICE_VERSION' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER invoice_version_update BEFORE UPDATE ON vamotors."InvoiceVersion"
  FOR EACH ROW EXECUTE FUNCTION vamotors.protect_invoice_version();
CREATE TRIGGER invoice_version_retention BEFORE DELETE OR TRUNCATE ON vamotors."InvoiceVersion"
  FOR EACH STATEMENT EXECUTE FUNCTION vamotors.append_only();

REVOKE ALL ON FUNCTION vamotors.protect_invoice_version() FROM PUBLIC;
GRANT SELECT, INSERT ON vamotors."InvoiceVersion" TO vamotors_runtime;
GRANT UPDATE (state, revision, "generationAt", "generatorId", "generatorName", size, sha256)
  ON vamotors."InvoiceVersion" TO vamotors_runtime;

COMMIT;
