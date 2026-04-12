"use client"

import * as React from "react"
import { parseAsInteger, parseAsString, useQueryStates } from "nuqs"

import type { PaginatedResponse, Repair } from "@/lib/mock-data/schemas"
import { useEntityQuery } from "@/hooks/use-entity-query"
import { DataTableShell } from "@/components/shared/data-table-shell"
import { repairsColumns } from "./repairs-columns"

export function RepairsTable() {
  const [params, setParams] = useQueryStates({
    page: parseAsInteger.withDefault(1),
    pageSize: parseAsInteger.withDefault(20),
    q: parseAsString.withDefault(""),
    status: parseAsString.withDefault(""),
    sortBy: parseAsString.withDefault(""),
    sortDir: parseAsString.withDefault("asc"),
  })

  const { data, isLoading } = useEntityQuery<PaginatedResponse<Repair>>(
    "repairs",
    "/api/repairs",
    {
      page: params.page,
      pageSize: params.pageSize,
      q: params.q || undefined,
      status: params.status || undefined,
      sortBy: params.sortBy || undefined,
      sortDir: params.sortDir || undefined,
    },
  )

  const repairs = data?.data ?? []
  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / params.pageSize))
  const isFiltered = Boolean(params.q || params.status)

  function handleClearFilters() {
    void setParams({ q: "", status: "", page: 1 })
  }

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
      searchPlaceholder="Search repairs..."
      emptyState={{
        heading: "No repairs recorded",
        body: "Send a vehicle for repair from the Vehicles screen.",
      }}
      isFiltered={isFiltered}
      onClearFilters={handleClearFilters}
    />
  )
}
