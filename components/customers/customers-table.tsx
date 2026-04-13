"use client"

import * as React from "react"

import type { PaginatedResponse, Customer } from "@/lib/mock-data/schemas"
import { useEntityQuery } from "@/hooks/use-entity-query"
import { DataTableShell, type DataTableState } from "@/components/shared/data-table-shell"
import { customersColumns } from "./customers-columns"

export function CustomersTable() {
  const [tableState, setTableState] = React.useState<DataTableState>({
    page: 1,
    perPage: 20,
    sortBy: "",
    sortDir: "asc",
  })

  const { data, isLoading } = useEntityQuery<PaginatedResponse<Customer>>(
    "customers",
    "/api/customers",
    {
      page: tableState.page,
      pageSize: tableState.perPage,
      sortBy: tableState.sortBy || undefined,
      sortDir: tableState.sortDir || undefined,
    },
  )

  const customers = data?.data ?? []
  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / tableState.perPage))

  if (isLoading && customers.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center">
        <span className="text-sm text-muted-foreground">Loading customers...</span>
      </div>
    )
  }

  return (
    <DataTableShell
      columns={customersColumns}
      data={customers}
      pageCount={pageCount}
      emptyState={{
        heading: "No customers yet",
        body: "Add a customer when recording your first sale.",
      }}
      onStateChange={setTableState}
    />
  )
}
