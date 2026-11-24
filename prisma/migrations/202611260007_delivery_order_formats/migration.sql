BEGIN;
-- Delivery orders share the PDF and image limits of other private documents.
DO $$
DECLARE name text; rule text; definition text;
  marker text := $patch$(purpose = 'DO'::text) AND ("contentType" = 'application/pdf'::text) AND ((size >= 1) AND (size <= 5242880))$patch$;
  formats text := $patch$(purpose = 'DO'::text) AND size>=1 AND (
    ("contentType"='application/pdf' AND size<=5242880) OR
    ("contentType" IN ('image/jpeg','image/png','image/webp') AND size<=2097152)
  )$patch$;
BEGIN
  FOREACH name IN ARRAY ARRAY['UploadIntent','Attachment'] LOOP
    FOREACH rule IN ARRAY ARRAY['target','purpose'] LOOP
      SELECT pg_get_expr(conbin,conrelid) INTO STRICT definition FROM pg_constraint
        WHERE conrelid=format('vamotors.%I',name)::regclass AND conname=name||'_'||rule||'_check';
      IF strpos(definition,marker)=0 THEN RAISE EXCEPTION 'DO_FORMAT_BASE'; END IF;
      EXECUTE format('ALTER TABLE vamotors.%I DROP CONSTRAINT %I',name,name||'_'||rule||'_check');
      EXECUTE format('ALTER TABLE vamotors.%I ADD CONSTRAINT %I CHECK (%s)',
        name,name||'_'||rule||'_check',replace(definition,marker,formats));
    END LOOP;
  END LOOP;
END $$;
COMMIT;
