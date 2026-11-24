BEGIN;

DO $$
DECLARE source text; marker text;
BEGIN
 SELECT pg_get_functiondef('vamotors.check_commitment_graph()'::regprocedure) INTO source;
 source:=replace(source,'JOIN vamotors."AuditEntry" a ON a.', 'JOIN vamotors."AuditEntry" ae ON ae.');
 source:=replace(source,'AND a."entityType"=''SaleCase'' AND a."entityId"=sid','AND ae."entityType"=''SaleCase'' AND ae."entityId"=sid');
 source:=replace(source,'AND a.xmin=pg_current_xact_id()::xid','AND ae.xmin=pg_current_xact_id()::xid');
 source:=replace(source,'AND a.action=c."commandName"','AND ae.action=c."commandName"');
 source:=replace(source,'CASE WHEN a."actorKind"=''SYSTEM'' THEN ''SYSTEM:RESERVATION_EXPIRY'' ELSE ''USER:''||a."userId"::text END',
  'CASE WHEN ae."actorKind"=''SYSTEM'' THEN ''SYSTEM:RESERVATION_EXPIRY'' ELSE ''USER:''||ae."userId"::text END');
 source:=replace(source,'FROM vamotors."ApprovalRequest" a WHERE a.kind=''REFUND'' AND a.state=''APPROVED''',
  'FROM vamotors."ApprovalRequest" ap WHERE ap.kind=''REFUND'' AND ap.state=''APPROVED''');
 source:=replace(source,'AND a."appliedCommandId"=c.id AND a."saleCaseId"=sid AND ae.xmin',
  'AND ap."appliedCommandId"=c.id AND ap."saleCaseId"=sid AND ap.xmin');
 EXECUTE source;

 SELECT pg_get_functiondef('vamotors.acquisition_root_guard()'::regprocedure) INTO source;
 marker := 'OR NEW.status NOT IN (''PURCHASED'', ''IN_STOCK'', ''IN_REPAIR'')';
 IF strpos(source,marker)=0 THEN RAISE EXCEPTION 'RESERVED_LISTED_PRICE_GUARD_BASE'; END IF;
 EXECUTE replace(source,marker,$patch$
   OR (NEW.status NOT IN ('PURCHASED','IN_STOCK','IN_REPAIR')
      AND NOT (NEW.status IN ('ADVANCE_PLACED','ADVANCE_EXPIRED')
        AND (to_jsonb(NEW)-ARRAY['listedPrice','revision','updatedAt'])=(to_jsonb(OLD)-ARRAY['listedPrice','revision','updatedAt'])))
 $patch$);

 SELECT pg_get_functiondef('vamotors.check_cycle_edit(vamotors."PurchaseRecord",vamotors."PurchaseRecord",vamotors."CommandReceipt")'::regprocedure) INTO source;
 marker:='new_root.status NOT IN (''PURCHASED'',''IN_STOCK'')';
 IF strpos(source,marker)=0 THEN RAISE EXCEPTION 'RESERVED_LISTED_PRICE_EDIT_BASE'; END IF;
 EXECUTE replace(source,marker,$patch$(new_root.status NOT IN ('PURCHASED','IN_STOCK') AND NOT
   (c."commandName"='setListedPrice' AND new_root.status IN ('ADVANCE_PLACED','ADVANCE_EXPIRED')))$patch$);
END $$;

COMMIT;
