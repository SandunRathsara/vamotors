"use client"

import * as React from "react"

import { PageHeader } from "@/components/shared/page-header"
import { Button } from "@/components/ui/button"
import { PurchasesTable } from "@/components/purchases/purchases-table"
import { RecordPurchaseSheet } from "@/components/purchases/record-purchase-sheet"

export default function PurchasesPage() {
  const [sheetOpen, setSheetOpen] = React.useState(false)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Purchases"
        description="Track all vehicle purchases"
        actions={
          <Button onClick={() => setSheetOpen(true)}>Record Purchase</Button>
        }
      />
      <PurchasesTable />
      <RecordPurchaseSheet open={sheetOpen} onOpenChange={setSheetOpen} />
    </div>
  )
}
