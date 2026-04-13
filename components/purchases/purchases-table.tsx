"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import type { PaginatedResponse, Vehicle } from "@/lib/mock-data/schemas"
import { useEntityQuery } from "@/hooks/use-entity-query"
import { DataTableShell, type DataTableState } from "@/components/shared/data-table-shell"
import { purchasesColumns } from "./purchases-columns"

export function PurchasesTable() {
  const router = useRouter()
  const [tableState, setTableState] = React.useState<DataTableState>({
    page: 1,
    perPage: 20,
    sortBy: "",
    sortDir: "desc",
  })

  const { data, isLoading } = useEntityQuery<PaginatedResponse<Vehicle>>(
    "purchases",
    "/api/purchases",
    {
      page: tableState.page,
      pageSize: tableState.perPage,
      sortBy: tableState.sortBy || undefined,
      sortDir: tableState.sortDir || undefined,
    },
  )

  const vehicles = data?.data ?? []
  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / tableState.perPage))

  if (isLoading && vehicles.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center">
        <span className="text-sm text-muted-foreground">Loading purchases...</span>
      </div>
    )
  }

  return (
    <DataTableShell
      columns={purchasesColumns}
      data={vehicles}
      pageCount={pageCount}
      emptyState={{
        heading: "No purchases recorded",
        body: "Record a purchase to add vehicles to inventory.",
      }}
      onStateChange={setTableState}
      onRowClick={(vehicle) => router.push(`/vehicles/${vehicle.id}`)}
    />
  )
}
