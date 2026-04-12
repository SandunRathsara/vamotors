"use client"

import * as React from "react"

import { PageHeader } from "@/components/shared/page-header"
import { Button } from "@/components/ui/button"
import { CustomersTable } from "@/components/customers/customers-table"
import { AddCustomerDialog } from "@/components/customers/add-customer-dialog"

export default function CustomersPage() {
  const [dialogOpen, setDialogOpen] = React.useState(false)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customers"
        description="Manage customer records"
        actions={
          <Button onClick={() => setDialogOpen(true)}>Add Customer</Button>
        }
      />
      <CustomersTable />
      <AddCustomerDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  )
}
