BEGIN;
SELECT value FROM vamotors."BusinessSequence" WHERE id=1 FOR UPDATE;
SELECT vamotors.lock_admin_guard();
ALTER TABLE vamotors."ApprovalRequest"
  DROP CONSTRAINT "ApprovalRequest_kind_check", DROP CONSTRAINT "ApprovalRequest_kind_saleCaseId_check",
  ADD CHECK (kind IN ('WRITE_OFF','DISCOUNT','SALE_EDIT','REFUND')),
  ADD CHECK ((kind IN ('SALE_EDIT','REFUND'))=("saleCaseId" IS NOT NULL));
DO $$
DECLARE source text; marker text;
BEGIN
 SELECT pg_get_functiondef('vamotors.approval_origin(uuid,vamotors."ApprovalRequest",vamotors."PurchaseRecord",vamotors."Vehicle",boolean)'::regprocedure) INTO source;
 marker := 'ELSIF a.kind = ''SALE_EDIT'' THEN';
 IF strpos(source,marker)=0 THEN RAISE EXCEPTION 'REFUND_AUTHORITY_BASE'; END IF;
 EXECUTE replace(source,marker,$patch$
   ELSIF a.kind = 'REFUND' THEN
     SELECT * INTO sale_row FROM vamotors."SaleCase" WHERE id=a."saleCaseId" AND "purchaseRecordId"=p.id;
     IF sale_row.id IS NULL THEN RETURN false; END IF;
     sale_data:=to_jsonb(sale_row);
     RETURN vamotors.approval_fields(uid,'PurchaseRecord','read',cycle_data,ARRAY['listedPrice'])
       AND vamotors.approval_fields(uid,'SaleCase','read',sale_data,ARRAY['id','revision','state','payments.amount','payments.direction','payments.date'])
       AND vamotors.approval_fields(uid,'SaleCase','update',sale_data,ARRAY['refund'])
       AND vamotors.approval_fields(uid,'SaleCase','pay',sale_data,ARRAY['amount','date','method']
         || CASE WHEN a.proposal#>'{input,refund}' ? 'reference' THEN ARRAY['reference'] ELSE ARRAY[]::text[] END);
 $patch$ || marker);

 SELECT pg_get_functiondef('vamotors.check_approval_graph()'::regprocedure) INTO source;
 marker := 'ELSIF a.kind = ''SALE_EDIT'' THEN';
 IF strpos(source,marker)=0 THEN RAISE EXCEPTION 'REFUND_APPROVAL_BASE'; END IF;
 source:=replace(source,marker,$patch$
   ELSIF a.kind='REFUND' THEN
     i:=a.proposal->'input';
     SELECT * INTO s FROM vamotors."SaleCase" WHERE id=a."saleCaseId" AND "purchaseRecordId"=p.id;
     IF s.id IS NULL OR a.proposal->>'kind' IS DISTINCT FROM 'REFUND'
       OR (i->>'saleCaseId' IS DISTINCT FROM s.id::text AND NOT EXISTS
          (SELECT FROM vamotors."Reservation" r WHERE r.id::text=i->>'reservationId' AND r."saleCaseId"=s.id))
       OR (a.state<>'APPROVED' AND s.state NOT IN ('RESERVED','EXPIRED','FINANCE_PENDING','DO_RECEIVED'))
       OR (a.state='APPROVED' AND s.state<>'CANCELLED')
       THEN RAISE EXCEPTION 'INVALID_REFUND_PROPOSAL' USING ERRCODE='23514'; END IF;
 $patch$ || marker);
 marker:='''proposal.input.receipt.reference'',';
 source:=replace(source,marker,marker || $patch$
    'proposal.input.refund','proposal.input.reservationId','proposal.input.saleCaseId','proposal.input.disposition','proposal.input.retainedAmount',
 $patch$);
 marker:='ELSIF a.kind = ''SALE_EDIT'' AND NOT EXISTS';
 source:=replace(source,marker,$patch$
     ELSIF a.kind='REFUND' AND NOT EXISTS (SELECT FROM vamotors."SaleReceipt" r
       WHERE r."commandId"=c.id AND r."saleCaseId"=s.id AND r.category='REFUND'
         AND r.amount=(i#>>'{refund,amount}')::bigint AND r."occurredDate"=(i#>>'{refund,date}')::date
         AND r.method=i#>>'{refund,method}' AND r.reference IS NOT DISTINCT FROM i#>>'{refund,reference}'
         AND r.xmin=pg_current_xact_id()::xid) THEN
       RAISE EXCEPTION 'APPROVAL_REFUND_REQUIRED' USING ERRCODE='23514';
 $patch$ || marker);
 EXECUTE source;
END $$;

DO $$
DECLARE guard text; role_guard text; admin_id uuid; permission_id uuid; rule jsonb; hash text;
BEGIN
 SELECT id INTO admin_id FROM vamotors."Role" WHERE "systemKey"='ADMINISTRATOR';
 IF admin_id IS NULL THEN RETURN; END IF;
 SELECT pg_get_functiondef('vamotors.protect_admin_permissions()'::regprocedure) INTO guard;
 SELECT pg_get_functiondef('vamotors.protect_system_role()'::regprocedure) INTO role_guard;
 EXECUTE replace(guard,'BEGIN',E'BEGIN\n IF current_user=''vamotors_migrator'' THEN RETURN CASE WHEN TG_OP=''DELETE'' THEN OLD ELSE NEW END; END IF;');
 EXECUTE replace(role_guard,'BEGIN',E'BEGIN\n IF current_user=''vamotors_migrator'' AND TG_OP=''UPDATE'' AND NEW.revision=OLD.revision+1 AND (to_jsonb(NEW)-''revision'')=(to_jsonb(OLD)-''revision'') THEN RETURN NEW; END IF;');
 FOR rule IN SELECT value FROM jsonb_array_elements('[
   {"subject":"Reservation","action":"read","fields":["*"]},
   {"subject":"ReservationExpiryJob","action":"read","fields":["*"]},
   {"subject":"ReservationExpiryJob","action":"run","fields":["*"]}
 ]'::jsonb) LOOP
   hash:=encode(sha256(convert_to(vamotors.sale_canonical(rule),'UTF8')),'hex');
   INSERT INTO vamotors."Permission"(id,"ruleHash",rule) VALUES(gen_random_uuid(),hash,rule) ON CONFLICT ("ruleHash") DO NOTHING;
   SELECT id INTO permission_id FROM vamotors."Permission" WHERE "ruleHash"=hash;
   INSERT INTO vamotors."RolePermission"("roleId","permissionId") VALUES(admin_id,permission_id) ON CONFLICT DO NOTHING;
 END LOOP;
 UPDATE vamotors."Role" SET revision=revision+1 WHERE id=admin_id;
 EXECUTE guard;
 EXECUTE role_guard;
END $$;
COMMIT;
