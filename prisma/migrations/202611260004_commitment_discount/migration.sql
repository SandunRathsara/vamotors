BEGIN;
DO $$
DECLARE source text; marker text;
BEGIN
 SELECT pg_get_functiondef('vamotors.approval_origin(uuid,vamotors."ApprovalRequest",vamotors."PurchaseRecord",vamotors."Vehicle",boolean)'::regprocedure) INTO source;
 marker:='IF NOT vamotors.approval_fields(uid, ''SaleCase'', ''create'', cycle_data,';
 IF strpos(source,marker)=0 THEN RAISE EXCEPTION 'COMMITMENT_DISCOUNT_AUTHORITY_BASE'; END IF;
 EXECUTE replace(source,marker,$patch$
   IF a.proposal#>>'{command,name}' IN ('placeReservation','startFinance') THEN
     RETURN vamotors.approval_fields(uid,'SaleCase','create',cycle_data,
       ARRAY[a.proposal#>>'{command,name}','cycleId','customerId','price'])
       AND vamotors.approval_fields(uid,'SaleCase','pay',cycle_data,ARRAY['amount','date','method']
         || CASE WHEN a.proposal#>'{command,input,receipt}' ? 'reference' OR a.proposal#>'{command,input,downPayment}' ? 'reference'
           THEN ARRAY['reference'] ELSE ARRAY[]::text[] END)
       AND EXISTS(SELECT FROM vamotors."Settings" settings WHERE settings.singleton=1
         AND vamotors.approval_fields(uid,'Settings','read',to_jsonb(settings),ARRAY['id','revision','policyVersion']))
       AND (a.proposal#>>'{command,name}'='placeReservation' OR EXISTS(SELECT FROM vamotors."FinanceCompany" company
         WHERE company.id::text=a.proposal#>>'{command,input,companyId}'
         AND vamotors.approval_fields(uid,'FinanceCompany','read',to_jsonb(company),ARRAY['id','revision','active','name','policy'])));
   END IF;
 $patch$||marker);

 SELECT pg_get_functiondef('vamotors.check_approval_graph()'::regprocedure) INTO source;
 marker:=$patch$a.proposal#>>'{command,name}' <> 'completeImmediate'$patch$;
 IF strpos(source,marker)=0 THEN RAISE EXCEPTION 'COMMITMENT_DISCOUNT_GRAPH_BASE'; END IF;
 source:=replace(source,marker,$patch$a.proposal#>>'{command,name}' NOT IN ('completeImmediate','placeReservation','startFinance')$patch$);
 marker:=$patch$ELSIF a.kind = 'DISCOUNT' AND (NOT EXISTS$patch$;
 source:=replace(source,marker,$patch$
      ELSIF a.kind='DISCOUNT' AND a.proposal#>>'{command,name}' IN ('placeReservation','startFinance') THEN
        IF NOT EXISTS(SELECT FROM vamotors."SaleCase" x JOIN vamotors."SaleReceipt" r ON r."saleCaseId"=x.id
          WHERE x."approvalId"=a.id AND x."commandId"=c.id AND x.xmin=pg_current_xact_id()::xid
          AND x."purchaseRecordId"=p.id AND x."customerId"::text=i->>'customerId'
          AND x."agreedPrice"=(i->>'price')::bigint AND x."listedSnapshot"=p."listedPrice"
          AND r."commandId"=c.id AND ((x.kind='ADVANCE' AND a.proposal#>>'{command,name}'='placeReservation'
            AND r.category='ADVANCE' AND r.amount=(i#>>'{receipt,amount}')::bigint)
            OR (x.kind='LEASE' AND a.proposal#>>'{command,name}'='startFinance' AND r.category='DOWN_PAYMENT'
              AND r.amount=(i#>>'{downPayment,amount}')::bigint)))
          THEN RAISE EXCEPTION 'APPROVAL_COMMITMENT_REQUIRED' USING ERRCODE='23514'; END IF;
 $patch$||marker);
 EXECUTE source;
END $$;
COMMIT;
