"use client"

import * as React from "react"

import { PageHeader } from "@/components/shared/page-header"
import { Button } from "@/components/ui/button"
import { SalesTable } from "@/components/sales/sales-table"
import { RecordSaleDialog } from "@/components/sales/record-sale-dialog"

export default function SalesPage() {
  const [dialogOpen, setDialogOpen] = React.useState(false)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sales"
        description="Track all vehicle sales"
        actions={
          <Button onClick={() => setDialogOpen(true)}>Record Sale</Button>
        }
      />
      <SalesTable />
      <RecordSaleDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  )
}
