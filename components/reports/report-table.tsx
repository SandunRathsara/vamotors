"use client"

import * as React from "react"
import Link from "next/link"
import type { ColumnDef } from "@tanstack/react-table"
import { parseAsString, useQueryState } from "nuqs"

import type { PaginatedResponse } from "@/lib/mock-data/schemas"
import { useEntityQuery } from "@/hooks/use-entity-query"
import { DataTableShell, type DataTableState } from "@/components/shared/data-table-shell"
import { PageHeader } from "@/components/shared/page-header"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ChevronLeft } from "lucide-react"

// ── Types ──────────────────────────────────────────────────────────────────────

interface ReportTableProps<TData> {
  title: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns: ColumnDef<TData, any>[]
  endpoint: string
  queryKey: string
  dateRangeFilter?: boolean
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ReportTable<TData>({
  title,
  columns,
  endpoint,
  queryKey,
  dateRangeFilter = true,
}: ReportTableProps<TData>) {
  const [tableState, setTableState] = React.useState<DataTableState>({
    page: 1,
    perPage: 20,
    sortBy: "",
    sortDir: "asc",
  })

  const [dateFrom, setDateFrom] = useQueryState("dateFrom", parseAsString.withDefault(""))
  const [dateTo, setDateTo] = useQueryState("dateTo", parseAsString.withDefault(""))

  const { data, isLoading } = useEntityQuery<PaginatedResponse<TData>>(
    queryKey,
    endpoint,
    {
      page: tableState.page,
      pageSize: tableState.perPage,
      sortBy: tableState.sortBy || undefined,
      sortDir: tableState.sortDir || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    },
  )

  const rows = data?.data ?? []
  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / tableState.perPage))
  const isFiltered = Boolean(dateFrom || dateTo)

  function handleClearFilters() {
    void setDateFrom(null)
    void setDateTo(null)
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/reports">Reports</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{title}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <PageHeader
        title={title}
        actions={
          <Button variant="ghost" size="sm" asChild>
            <Link href="/reports">
              <ChevronLeft className="mr-1 h-4 w-4" />
              Back to Reports
            </Link>
          </Button>
        }
      />

      {/* Date range filter */}
      {dateRangeFilter && (
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Label htmlFor={`${queryKey}-dateFrom`} className="text-xs">
              From
            </Label>
            <Input
              id={`${queryKey}-dateFrom`}
              type="date"
              className="h-8 w-40 text-xs"
              value={dateFrom ?? ""}
              onChange={(e) => void setDateFrom(e.target.value || null)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor={`${queryKey}-dateTo`} className="text-xs">
              To
            </Label>
            <Input
              id={`${queryKey}-dateTo`}
              type="date"
              className="h-8 w-40 text-xs"
              value={dateTo ?? ""}
              onChange={(e) => void setDateTo(e.target.value || null)}
            />
          </div>
          {isFiltered && (
            <Button variant="ghost" size="sm" className="text-xs" onClick={handleClearFilters}>
              Clear dates
            </Button>
          )}
        </div>
      )}

      {isLoading && rows.length === 0 ? (
        <div className="flex h-64 items-center justify-center">
          <span className="text-sm text-muted-foreground">Loading {title.toLowerCase()}...</span>
        </div>
      ) : (
        <DataTableShell
          columns={columns}
          data={rows}
          pageCount={pageCount}
          emptyState={{
            heading: "No data for this period",
            body: "Adjust the date range or filters to find records.",
          }}
          onStateChange={setTableState}
        />
      )}
    </div>
  )
}
