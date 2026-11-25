-- A dispatch command creates one entitlement per deal. The unique source
-- columns identify the entitlements, and each keeps its receipt reference.
ALTER TABLE vamotors."CommissionEntitlement"
  DROP CONSTRAINT "CommissionEntitlement_commandId_key";
