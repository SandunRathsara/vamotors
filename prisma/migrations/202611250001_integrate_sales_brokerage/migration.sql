BEGIN;

-- Retain the read versions and cash legs from both feature migrations.
ALTER TABLE vamotors."EntityReadVersion" DROP CONSTRAINT "EntityReadVersion_entityType_check";
ALTER TABLE vamotors."EntityReadVersion" ADD CONSTRAINT "EntityReadVersion_entityType_check" CHECK("entityType" IN ('Vehicle','PurchaseRecord','Customer','Supplier','RepairVendor','FinanceCompany','Settings','RateSheet','Quote','VehicleCost','ImportBatch','Document','RepairRecord','ApprovalRequest','SaleCase','SaleCompletion','BrokerageDeal','CashFacility','DispatchBatch','CommissionEntitlement'));

CREATE OR REPLACE VIEW vamotors."CashMovement" AS
 SELECT 'PURCHASE'::text AS "sourceType", "cycleId" AS "sourceId", id AS "paymentId", "occurredDate" AS date, direction, amount, method, category, "commandId" FROM vamotors."PurchasePayment"
  UNION ALL SELECT 'COST'::text,"costId",id,"occurredDate",direction,amount,method,category,"commandId" FROM vamotors."CostPayment"
  UNION ALL SELECT 'DISPOSAL'::text,"disposalId",id,"occurredDate",direction,amount,method,category,"commandId" FROM vamotors."DisposalReceipt"
 UNION ALL SELECT 'REPAIR'::text,"repairId",id,"occurredDate",direction,amount,method,category,"commandId" FROM vamotors."RepairPayment"
 UNION ALL SELECT 'FACILITY'::text,"facilityId",id,"occurredDate",direction,amount,method,component,"commandId" FROM vamotors."FacilityPayment"
 UNION ALL SELECT 'BROKERAGE_FEE'::text,"dealId",id,"occurredDate",direction,amount,method,category,"commandId" FROM vamotors."BrokerageFeeReceipt"
  UNION ALL SELECT 'SALE'::text, "saleCaseId", id, "occurredDate", direction, amount, method, category, "commandId" FROM vamotors."SaleReceipt";

COMMIT;
