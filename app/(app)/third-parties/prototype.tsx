"use client"

import * as React from "react"

import { PageHeader } from "@/components/shared/page-header"
import { Button } from "@/components/ui/button"
import { ThirdPartiesTable } from "@/components/third-parties/third-parties-table"
import { AddThirdPartyDialog } from "@/components/third-parties/add-third-party-dialog"

export default function ThirdPartiesPage() {
  const [dialogOpen, setDialogOpen] = React.useState(false)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Third Parties"
        description="Manage suppliers, repair vendors, and finance companies"
        actions={
          <Button onClick={() => setDialogOpen(true)}>Add Third Party</Button>
        }
      />
      <ThirdPartiesTable />
      <AddThirdPartyDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  )
}
