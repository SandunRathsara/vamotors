-- Restore the settlement leaves from 202610300006 alongside the current cycle audit paths.
CREATE OR REPLACE FUNCTION vamotors.cycle_cost_diff(kind text, old jsonb, after jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT coalesce(jsonb_object_agg(f, jsonb_build_object(
    'before', coalesce(old #> string_to_array(f, '.'), 'null'::jsonb),
    'after', coalesce(after #> string_to_array(f, '.'), 'null'::jsonb)
  )), '{}'::jsonb)
  FROM unnest(CASE kind
    WHEN 'VehicleCost' THEN ARRAY[
      'id','revision','category','description','amount','incurredDate','payments','outstanding','provenance'
    ]
    WHEN 'PurchaseRecord' THEN ARRAY[
      'id','revision','vehicleId','identity','identityRevision','cycleNumber','purchaseType','acquisitionKind',
      'settlement.institutionType','settlement.companyId','settlement.institutionName',
      'settlement.institutionNameSnapshot','settlement.reference','settlement.amount','settlement.cashToSeller',
      'seller','tradeInSourceSaleId','purchaseDate','purchasePrice','listedPrice','notes','status','available',
      'holdReason','receivedDate','closedAt','payments','outstanding','outstanding.seller','outstanding.settlement',
      'costs','repairs','mileage','financial','basisVersions','sales','disposal','provenance','nextActions',
      'financial.currency','financial.scale','financial.purchase','financial.repairs','financial.additionalCosts',
      'financial.basis','financial.originalBasis','financial.salePrice','financial.originalProfit',
      'financial.restatedProfit','financial.cashIn','financial.cashOut','financial.net'
    ]
    ELSE ARRAY[
      'id','identity','status','available','cycleId','revision','listedPrice','financial','identityRevision',
      'holdReason','mileage','provenance','financial.currency','financial.scale','financial.purchase',
      'financial.repairs','financial.additionalCosts','financial.basis','financial.originalProfit',
      'financial.restatedProfit','financial.cashIn','financial.cashOut','financial.net'
    ]
  END) f
  WHERE coalesce(old #> string_to_array(f, '.'), 'null'::jsonb)
    IS DISTINCT FROM coalesce(after #> string_to_array(f, '.'), 'null'::jsonb)
$$;
