BEGIN;
ALTER TABLE vamotors."EntityReadVersion" DROP CONSTRAINT "EntityReadVersion_entityType_check",
  ADD CONSTRAINT "EntityReadVersion_entityType_check" CHECK("entityType" IN
    ('Vehicle','PurchaseRecord','Customer','Supplier','RepairVendor','FinanceCompany','Settings','RateSheet','Quote','VehicleCost',
     'ImportBatch','Document','RepairRecord','ApprovalRequest','SaleCase','SaleCompletion','BrokerageDeal','CashFacility',
     'DispatchBatch','CommissionEntitlement','Reservation','Remittance','ReconciliationRun'));
COMMIT;
