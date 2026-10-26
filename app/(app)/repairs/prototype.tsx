"use client"

import * as React from "react"

import { PageHeader } from "@/components/shared/page-header"
import { Button } from "@/components/ui/button"
import { RepairsTable } from "@/components/repairs/repairs-table"
import { SendRepairDialog } from "@/components/repairs/send-repair-dialog"

export default function RepairsPage() {
  const [dialogOpen, setDialogOpen] = React.useState(false)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Repairs"
        description="Track vehicle repair history"
        actions={
          <Button onClick={() => setDialogOpen(true)}>Send for Repair</Button>
        }
      />
      <RepairsTable />
      <SendRepairDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  )
}
