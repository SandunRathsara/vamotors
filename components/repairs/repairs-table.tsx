"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import type { PaginatedResponse, Repair } from "@/lib/mock-data/schemas"
import { useEntityQuery } from "@/hooks/use-entity-query"
import { DataTableShell, type DataTableState } from "@/components/shared/data-table-shell"
import { repairsColumns } from "./repairs-columns"

export function RepairsTable() {
  const router = useRouter()
  const [tableState, setTableState] = React.useState<DataTableState>({
    page: 1,
    perPage: 20,
    sortBy: "",
    sortDir: "asc",
  })

  const { data, isLoading } = useEntityQuery<PaginatedResponse<Repair>>(
    "repairs",
    "/api/repairs",
    {
      page: tableState.page,
      pageSize: tableState.perPage,
      sortBy: tableState.sortBy || undefined,
      sortDir: tableState.sortDir || undefined,
    },
  )

  const repairs = data?.data ?? []
  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / tableState.perPage))

  if (isLoading && repairs.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center">
        <span className="text-sm text-muted-foreground">Loading repairs...</span>
      </div>
    )
  }

  return (
    <DataTableShell
      columns={repairsColumns}
      data={repairs}
      pageCount={pageCount}
      emptyState={{
        heading: "No repairs recorded",
        body: "Send a vehicle for repair from the Vehicles screen.",
      }}
      onStateChange={setTableState}
      onRowClick={(repair) => router.push(`/vehicles/${repair.vehicleId}`)}
    />
  )
}
