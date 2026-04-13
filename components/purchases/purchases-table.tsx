"use client"

import * as React from "react"
import { parseAsInteger, parseAsString, useQueryStates } from "nuqs"

import type { PaginatedResponse, Vehicle } from "@/lib/mock-data/schemas"
import { useEntityQuery } from "@/hooks/use-entity-query"
import { DataTableShell } from "@/components/shared/data-table-shell"
import { purchasesColumns } from "./purchases-columns"

export function PurchasesTable() {
  const [params, setParams] = useQueryStates({
    page: parseAsInteger.withDefault(1),
    pageSize: parseAsInteger.withDefault(20),
    q: parseAsString.withDefault(""),
    purchaseType: parseAsString.withDefault(""),
    status: parseAsString.withDefault(""),
    sortBy: parseAsString.withDefault(""),
    sortDir: parseAsString.withDefault("desc"),
  })

  const { data, isLoading } = useEntityQuery<PaginatedResponse<Vehicle>>(
    "purchases",
    "/api/purchases",
    {
      page: params.page,
      pageSize: params.pageSize,
      q: params.q || undefined,
      purchaseType: params.purchaseType || undefined,
      status: params.status || undefined,
      sortBy: params.sortBy || undefined,
      sortDir: params.sortDir || undefined,
    },
  )

  const vehicles = data?.data ?? []
  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / params.pageSize))
  const isFiltered = Boolean(params.q || params.purchaseType || params.status)

  function handleClearFilters() {
    void setParams({ q: "", purchaseType: "", status: "", page: 1 })
  }

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
      searchPlaceholder="Search purchases..."
      emptyState={{
        heading: "No purchases recorded",
        body: "Record a purchase to add vehicles to inventory.",
      }}
      isFiltered={isFiltered}
      onClearFilters={handleClearFilters}
    />
  )
}
