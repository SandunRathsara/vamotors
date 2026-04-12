"use client"

import * as React from "react"
import { parseAsInteger, parseAsString, useQueryStates } from "nuqs"

import type { PaginatedResponse, Sale } from "@/lib/mock-data/schemas"
import { useEntityQuery } from "@/hooks/use-entity-query"
import { DataTableShell } from "@/components/shared/data-table-shell"
import { salesColumns } from "./sales-columns"

export function SalesTable() {
  const [params, setParams] = useQueryStates({
    page: parseAsInteger.withDefault(1),
    pageSize: parseAsInteger.withDefault(20),
    q: parseAsString.withDefault(""),
    saleType: parseAsString.withDefault(""),
    status: parseAsString.withDefault(""),
    sortBy: parseAsString.withDefault(""),
    sortDir: parseAsString.withDefault("asc"),
    dateFrom: parseAsString.withDefault(""),
    dateTo: parseAsString.withDefault(""),
  })

  const { data, isLoading } = useEntityQuery<PaginatedResponse<Sale>>(
    "sales",
    "/api/sales",
    {
      page: params.page,
      pageSize: params.pageSize,
      q: params.q || undefined,
      saleType: params.saleType || undefined,
      status: params.status || undefined,
      sortBy: params.sortBy || undefined,
      sortDir: params.sortDir || undefined,
      dateFrom: params.dateFrom || undefined,
      dateTo: params.dateTo || undefined,
    },
  )

  const sales = data?.data ?? []
  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / params.pageSize))
  const isFiltered = Boolean(params.q || params.saleType || params.status || params.dateFrom || params.dateTo)

  function handleClearFilters() {
    void setParams({ q: "", saleType: "", status: "", dateFrom: "", dateTo: "", page: 1 })
  }

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
      searchPlaceholder="Search sales..."
      emptyState={{
        heading: "No sales recorded",
        body: "Record a sale from the Vehicles or Purchases screen.",
      }}
      isFiltered={isFiltered}
      onClearFilters={handleClearFilters}
    />
  )
}
