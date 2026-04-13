"use client"

import * as React from "react"

import type { PaginatedResponse, Sale } from "@/lib/mock-data/schemas"
import { useEntityQuery } from "@/hooks/use-entity-query"
import { DataTableShell, type DataTableState } from "@/components/shared/data-table-shell"
import { salesColumns } from "./sales-columns"

export function SalesTable() {
  const [tableState, setTableState] = React.useState<DataTableState>({
    page: 1,
    perPage: 20,
    sortBy: "",
    sortDir: "asc",
  })

  const { data, isLoading } = useEntityQuery<PaginatedResponse<Sale>>(
    "sales",
    "/api/sales",
    {
      page: tableState.page,
      pageSize: tableState.perPage,
      sortBy: tableState.sortBy || undefined,
      sortDir: tableState.sortDir || undefined,
    },
  )

  const sales = data?.data ?? []
  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / tableState.perPage))

  if (isLoading && sales.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center">
        <span className="text-sm text-muted-foreground">Loading sales...</span>
      </div>
    )
  }

  return (
    <DataTableShell
      columns={salesColumns}
      data={sales}
      pageCount={pageCount}
      emptyState={{
        heading: "No sales recorded",
        body: "Record a sale from the Vehicles or Purchases screen.",
      }}
      onStateChange={setTableState}
    />
  )
}
