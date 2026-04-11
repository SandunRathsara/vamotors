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
}: DataTableShellProps<TData>) {
  const { table } = useDataTable({
    data,
    columns,
    pageCount,
    initialState: {
      pagination: { pageIndex: 0, pageSize: 20 },
    },
  })

  const isEmpty = data.length === 0

  return (
    <DataTable table={table}>
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
