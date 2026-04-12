"use client"

import * as React from "react"
import { parseAsInteger, parseAsString, useQueryStates } from "nuqs"

import type { PaginatedResponse, Customer } from "@/lib/mock-data/schemas"
import { useEntityQuery } from "@/hooks/use-entity-query"
import { DataTableShell } from "@/components/shared/data-table-shell"
import { customersColumns } from "./customers-columns"
import { Input } from "@/components/ui/input"

export function CustomersTable() {
  const [params, setParams] = useQueryStates({
    page: parseAsInteger.withDefault(1),
    pageSize: parseAsInteger.withDefault(20),
    q: parseAsString.withDefault(""),
    sortBy: parseAsString.withDefault(""),
    sortDir: parseAsString.withDefault("asc"),
  })

  const { data, isLoading } = useEntityQuery<PaginatedResponse<Customer>>(
    "customers",
    "/api/customers",
    {
      page: params.page,
      pageSize: params.pageSize,
      q: params.q || undefined,
      sortBy: params.sortBy || undefined,
      sortDir: params.sortDir || undefined,
    },
  )

  const customers = data?.data ?? []
  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / params.pageSize))
  const isFiltered = Boolean(params.q)

  function handleClearFilters() {
    void setParams({ q: "", page: 1 })
  }

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
      searchPlaceholder="Search by name, NIC, phone..."
      emptyState={{
        heading: "No customers yet",
        body: "Add a customer when recording your first sale.",
      }}
      isFiltered={isFiltered}
      onClearFilters={handleClearFilters}
      toolbarChildren={
        <Input
          placeholder="Search by name, NIC, phone..."
          value={params.q}
          onChange={(e) => void setParams({ q: e.target.value, page: 1 })}
          className="h-8 w-64"
        />
      }
    />
  )
}
