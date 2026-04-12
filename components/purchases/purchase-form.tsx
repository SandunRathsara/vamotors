"use client"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { CashPurchaseTab } from "./cash-purchase-tab"
import { LeaseSettlementTab } from "./lease-settlement-tab"
import { BrandNewTab } from "./brand-new-tab"

export function PurchaseForm() {
  return (
    <Tabs defaultValue="cash">
      <TabsList className="mb-6">
        <TabsTrigger value="cash">Cash Purchase</TabsTrigger>
        <TabsTrigger value="lease-settlement">Lease Settlement</TabsTrigger>
        <TabsTrigger value="brand-new">Brand-New</TabsTrigger>
      </TabsList>

      <TabsContent value="cash">
        <CashPurchaseTab />
      </TabsContent>

      <TabsContent value="lease-settlement">
        <LeaseSettlementTab />
      </TabsContent>

      <TabsContent value="brand-new">
        <BrandNewTab />
      </TabsContent>
    </Tabs>
  )
}
