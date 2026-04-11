"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { parseAsInteger, parseAsString, useQueryStates } from "nuqs"

import type { PaginatedResponse, Vehicle } from "@/lib/mock-data/schemas"
import { useEntityQuery } from "@/hooks/use-entity-query"
import { DataTableShell } from "@/components/shared/data-table-shell"
import { vehicleColumns } from "./vehicles-columns"

export function VehiclesTable() {
  const router = useRouter()

  const [params, setParams] = useQueryStates({
    page: parseAsInteger.withDefault(1),
    pageSize: parseAsInteger.withDefault(20),
    q: parseAsString.withDefault(""),
    status: parseAsString.withDefault(""),
    sortBy: parseAsString.withDefault(""),
    sortDir: parseAsString.withDefault("asc"),
  })

  const { data, isLoading } = useEntityQuery<PaginatedResponse<Vehicle>>(
    "vehicles",
    "/api/vehicles",
    {
      page: params.page,
      pageSize: params.pageSize,
      q: params.q || undefined,
      status: params.status || undefined,
      sortBy: params.sortBy || undefined,
      sortDir: params.sortDir || undefined,
    },
  )

  const vehicles = data?.data ?? []
  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / params.pageSize))
  const isFiltered = Boolean(params.q || params.status)

  function handleClearFilters() {
    void setParams({ q: "", status: "", page: 1 })
  }

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
      searchPlaceholder="Search vehicles..."
      emptyState={{
        heading: "No vehicles in inventory",
        body: "Record a purchase to add the first vehicle.",
      }}
      isFiltered={isFiltered}
      onClearFilters={handleClearFilters}
    />
  )
}
