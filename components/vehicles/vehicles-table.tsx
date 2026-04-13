"use client"

import * as React from "react"

import type { PaginatedResponse, Vehicle } from "@/lib/mock-data/schemas"
import { useEntityQuery } from "@/hooks/use-entity-query"
import { DataTableShell, type DataTableState } from "@/components/shared/data-table-shell"
import { vehicleColumns } from "./vehicles-columns"

export function VehiclesTable() {
  const [tableState, setTableState] = React.useState<DataTableState>({
    page: 1,
    perPage: 20,
    sortBy: "",
    sortDir: "asc",
  })

  const { data, isLoading } = useEntityQuery<PaginatedResponse<Vehicle>>(
    "vehicles",
    "/api/vehicles",
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
        <span className="text-sm text-muted-foreground">Loading vehicles...</span>
      </div>
    )
  }

  return (
    <DataTableShell
      columns={vehicleColumns}
      data={vehicles}
      pageCount={pageCount}
      emptyState={{
        heading: "No vehicles in inventory",
        body: "Record a purchase to add the first vehicle.",
      }}
      onStateChange={setTableState}
    />
  )
}
