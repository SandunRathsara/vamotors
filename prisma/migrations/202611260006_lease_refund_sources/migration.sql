BEGIN;
DO $$
DECLARE source text; marker text;
BEGIN
 SELECT pg_get_functiondef('vamotors.check_commitment_graph()'::regprocedure) INTO source;
 marker:=$patch$(x.category='REFUND' AND x."refundOf" IS DISTINCT FROM CASE WHEN s.kind='ADVANCE' THEN a.id ELSE d.id END)$patch$;
 IF strpos(source,marker)=0 THEN RAISE EXCEPTION 'LEASE_REFUND_GRAPH_BASE'; END IF;
 source:=replace(source,marker,$patch$(x.category='REFUND' AND NOT EXISTS(
   SELECT FROM vamotors."SaleReceipt" deposit
     WHERE deposit.id=x."refundOf" AND deposit."saleCaseId"=sid
       AND deposit.category IN ('ADVANCE','DOWN_PAYMENT') AND deposit.amount>=x.amount
       AND (s.kind='ADVANCE' OR deposit.amount=x.amount)
       AND deposit."occurredDate"<=x."occurredDate"))$patch$);

 source:=replace(source,$patch$OR (s.state<>'CANCELLED' AND refunded<>0)$patch$,
   $patch$OR (s.state<>'CANCELLED' AND refunded<>0)
    OR (s.kind='LEASE' AND s.state='CANCELLED' AND refunded<>advance_paid+down_paid)$patch$);
 EXECUTE source;

 SELECT pg_get_functiondef('vamotors.check_approval_graph()'::regprocedure) INTO source;
 marker:=$patch$ELSIF a.kind='REFUND' AND NOT EXISTS (SELECT FROM vamotors."SaleReceipt" r$patch$;
 IF strpos(source,marker)=0 THEN RAISE EXCEPTION 'LEASE_REFUND_APPROVAL_BASE'; END IF;
 source:=replace(source,marker,$patch$ELSIF a.kind='REFUND' AND (SELECT coalesce(sum(r.amount),0) FROM vamotors."SaleReceipt" r$patch$);
 source:=replace(source,$patch$AND r.amount=(i#>>'{refund,amount}')::bigint AND r."occurredDate"=(i#>>'{refund,date}')::date$patch$,
   $patch$AND r."occurredDate"=(i#>>'{refund,date}')::date$patch$);
 source:=replace(source,$patch$AND r.xmin=pg_current_xact_id()::xid) THEN
       RAISE EXCEPTION 'APPROVAL_REFUND_REQUIRED'$patch$,
   $patch$AND r.xmin=pg_current_xact_id()::xid) IS DISTINCT FROM (i#>>'{refund,amount}')::numeric THEN
       RAISE EXCEPTION 'APPROVAL_REFUND_REQUIRED'$patch$);
 EXECUTE source;
END $$;
COMMIT;
