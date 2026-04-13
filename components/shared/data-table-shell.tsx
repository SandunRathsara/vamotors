"use client"

import type { ColumnDef } from "@tanstack/react-table"
import * as React from "react"

import { DataTable } from "@/components/data-table/data-table"
import { DataTableAdvancedToolbar } from "@/components/data-table/data-table-advanced-toolbar"
import { DataTableFilterList } from "@/components/data-table/data-table-filter-list"
import { DataTableSortList } from "@/components/data-table/data-table-sort-list"
import { EmptyState } from "@/components/shared/empty-state"
import { useDataTable } from "@/hooks/use-data-table"

// ── Types ──────────────────────────────────────────────────────────────────────

export interface DataTableState {
  page: number
  perPage: number
  sortBy: string
  sortDir: "asc" | "desc"
}

interface DataTableShellEmptyState {
  heading: string
  body: string
}

interface DataTableShellProps<TData> {
  columns: ColumnDef<TData>[]
  data: TData[]
  pageCount: number
  /** Placeholder text for the search input (not rendered here — pass to toolbar children) */
  searchPlaceholder?: string
  emptyState?: DataTableShellEmptyState
  /** Optional toolbar children (search input, filter triggers, etc.) */
  toolbarChildren?: React.ReactNode
  /** Set to true when URL filters are active and data came back empty */
  isFiltered?: boolean
  /** Called when user clicks "Clear filters" on filter empty state */
  onClearFilters?: () => void
  /** Callback fired when useDataTable URL state changes. Consumer reads this to drive API calls. */
  onStateChange?: (state: DataTableState) => void
  /** Optional row click handler. Receives the row data. Not fired when clicking buttons/links inside the row. */
  onRowClick?: (row: TData) => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export function DataTableShell<TData>({
  columns,
  data,
  pageCount,
  emptyState,
  toolbarChildren,
  isFiltered = false,
  onClearFilters,
  onStateChange,
  onRowClick,
}: DataTableShellProps<TData>) {
  const { table } = useDataTable({
    data,
    columns,
    pageCount,
    enableAdvancedFilter: false,
    initialState: {
      pagination: { pageIndex: 0, pageSize: 20 },
    },
  })

  const { pagination, sorting } = table.getState()

  React.useEffect(() => {
    if (!onStateChange) return
    const sortEntry = sorting[0]
    onStateChange({
      page: pagination.pageIndex + 1,
      perPage: pagination.pageSize,
      sortBy: sortEntry?.id ?? "",
      sortDir: sortEntry?.desc ? "desc" : "asc",
    })
  }, [pagination.pageIndex, pagination.pageSize, sorting, onStateChange])

  const isEmpty = data.length === 0

  return (
    <DataTable table={table} onRowClick={onRowClick}>
      <DataTableAdvancedToolbar table={table}>
        {toolbarChildren}
        <DataTableFilterList table={table} shallow={false} />
        <DataTableSortList table={table} />
      </DataTableAdvancedToolbar>

      {isEmpty && (
        <div className="min-h-[300px] flex items-center justify-center">
          <EmptyState
            heading={emptyState?.heading ?? "No records found"}
            body={emptyState?.body ?? "No data is available yet."}
            isFilterEmpty={isFiltered}
            onClearFilters={onClearFilters}
          />
        </div>
      )}
    </DataTable>
  )
}
