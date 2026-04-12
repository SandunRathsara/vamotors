"use client"

import * as React from "react"

import { PageHeader } from "@/components/shared/page-header"
import { Button } from "@/components/ui/button"
import { UsersTable } from "@/components/users/users-table"
import { AddUserDialog } from "@/components/users/add-user-dialog"

export default function UsersPage() {
  const [dialogOpen, setDialogOpen] = React.useState(false)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Users & Roles"
        description="Manage user accounts and access permissions"
        actions={
          <Button onClick={() => setDialogOpen(true)}>Add User</Button>
        }
      />
      <UsersTable />
      <AddUserDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  )
}
