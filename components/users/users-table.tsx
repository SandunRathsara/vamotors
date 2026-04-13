"use client"

import * as React from "react"

import type { PaginatedResponse, User } from "@/lib/mock-data/schemas"
import { useEntityQuery } from "@/hooks/use-entity-query"
import { DataTableShell, type DataTableState } from "@/components/shared/data-table-shell"
import { usersColumns } from "./users-columns"

export function UsersTable() {
  const [tableState, setTableState] = React.useState<DataTableState>({
    page: 1,
    perPage: 20,
    sortBy: "name",
    sortDir: "asc",
  })

  const { data, isLoading } = useEntityQuery<PaginatedResponse<User>>(
    "users",
    "/api/users",
    {
      page: tableState.page,
      pageSize: tableState.perPage,
      sortBy: tableState.sortBy || undefined,
      sortDir: tableState.sortDir || undefined,
    },
  )

  const users = data?.data ?? []
  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / tableState.perPage))

  if (isLoading && users.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center">
        <span className="text-sm text-muted-foreground">Loading users...</span>
      </div>
    )
  }

  return (
    <DataTableShell
      columns={usersColumns}
      data={users}
      pageCount={pageCount}
      emptyState={{
        heading: "No users added",
        body: "Add the first user to grant access to the system.",
      }}
      onStateChange={setTableState}
    />
  )
}
