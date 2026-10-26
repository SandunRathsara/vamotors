"use client"

import * as React from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { parseAsString, useQueryState } from "nuqs"
import { ArrowDownLeft, ArrowUpRight, TrendingUp } from "lucide-react"

import type { CashFlowEntry } from "@/lib/mock-data/schemas"
import { useEntityQuery } from "@/hooks/use-entity-query"
import { DataTableShell, type DataTableState } from "@/components/shared/data-table-shell"
import { PageHeader } from "@/components/shared/page-header"
import { CurrencyDisplay } from "@/components/shared/currency-display"
import { StatusBadge } from "@/components/shared/status-badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// ── Types ──────────────────────────────────────────────────────────────────────

type CashFlowResponse = {
  data: CashFlowEntry[]
  total: number
  page: number
  pageSize: number
  summary: {
    totalInflow: number
    totalOutflow: number
    netPosition: number
  }
}

// ── Columns ───────────────────────────────────────────────────────────────────

const columns: ColumnDef<CashFlowEntry>[] = [
  {
    accessorKey: "date",
    header: "Date",
    cell: ({ row }) => <span>{row.original.date}</span>,
  },
  {
    accessorKey: "type",
    header: "Type",
    cell: ({ row }) => <StatusBadge status={row.original.type} />,
  },
  {
    accessorKey: "description",
    header: "Description",
    cell: ({ row }) => (
      <span className="max-w-[280px] truncate block">{row.original.description}</span>
    ),
  },
  {
    accessorKey: "reference",
    header: "Reference",
    cell: ({ row }) => (
      <span className="text-xs text-muted-foreground">{row.original.reference}</span>
    ),
  },
  {
    accessorKey: "amount",
    header: "Amount",
    cell: ({ row }) => {
      const amt = row.original.amount
      const isInflow = amt > 0
      return (
        <div className="flex items-center gap-1">
          {isInflow ? (
            <ArrowUpRight className="h-3 w-3 text-green-600 dark:text-green-400" />
          ) : (
            <ArrowDownLeft className="h-3 w-3 text-red-600 dark:text-red-400" />
          )}
          <CurrencyDisplay
            amount={Math.abs(amt)}
            className={cn(
              isInflow
                ? "text-green-600 dark:text-green-400"
                : "text-red-600 dark:text-red-400"
            )}
          />
        </div>
      )
    },
  },
]

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CashFlowPage() {
  const [tableState, setTableState] = React.useState<DataTableState>({
    page: 1,
    perPage: 20,
    sortBy: "",
    sortDir: "desc",
  })

  const [type, setType] = useQueryState("type", parseAsString.withDefault(""))
  const [dateFrom, setDateFrom] = useQueryState("dateFrom", parseAsString.withDefault(""))
  const [dateTo, setDateTo] = useQueryState("dateTo", parseAsString.withDefault(""))

  const { data, isLoading } = useEntityQuery<CashFlowResponse>(
    "cash-flow",
    "/api/cash-flow",
    {
      page: tableState.page,
      pageSize: tableState.perPage,
      sortBy: tableState.sortBy || undefined,
      sortDir: tableState.sortDir || undefined,
      type: type || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    },
  )

  const entries = data?.data ?? []
  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / tableState.perPage))
  const summary = data?.summary ?? { totalInflow: 0, totalOutflow: 0, netPosition: 0 }
  const isFiltered = Boolean(dateFrom || dateTo || type)

  function handleClearFilters() {
    void setDateFrom(null)
    void setDateTo(null)
    void setType(null)
  }

  const netIsPositive = summary.netPosition >= 0

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cash Flow"
        description="Transaction history and running financial position"
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-normal text-muted-foreground">Total Inflow</CardTitle>
            <ArrowUpRight className="h-4 w-4 text-green-600 dark:text-green-400" />
          </CardHeader>
          <CardContent>
            <CurrencyDisplay
              amount={summary.totalInflow}
              className="text-xl font-semibold text-green-600 dark:text-green-400"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-normal text-muted-foreground">Total Outflow</CardTitle>
            <ArrowDownLeft className="h-4 w-4 text-red-600 dark:text-red-400" />
          </CardHeader>
          <CardContent>
            <CurrencyDisplay
              amount={Math.abs(summary.totalOutflow)}
              className="text-xl font-semibold text-red-600 dark:text-red-400"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-normal text-muted-foreground">Net Position</CardTitle>
            <TrendingUp
              className={cn(
                "h-4 w-4",
                netIsPositive
                  ? "text-green-600 dark:text-green-400"
                  : "text-red-600 dark:text-red-400"
              )}
            />
          </CardHeader>
          <CardContent>
            <CurrencyDisplay
              amount={Math.abs(summary.netPosition)}
              className={cn(
                "text-xl font-semibold",
                netIsPositive
                  ? "text-green-600 dark:text-green-400"
                  : "text-red-600 dark:text-red-400"
              )}
            />
            {!netIsPositive && (
              <p className="text-xs text-muted-foreground mt-1">Net deficit</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Date range + type filter */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <Label htmlFor="cf-dateFrom" className="text-xs">From</Label>
          <Input
            id="cf-dateFrom"
            type="date"
            className="h-8 w-40 text-xs"
            value={dateFrom ?? ""}
            onChange={(e) => void setDateFrom(e.target.value || null)}
          />
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="cf-dateTo" className="text-xs">To</Label>
          <Input
            id="cf-dateTo"
            type="date"
            className="h-8 w-40 text-xs"
            value={dateTo ?? ""}
            onChange={(e) => void setDateTo(e.target.value || null)}
          />
        </div>
        {isFiltered && (
          <Button variant="ghost" size="sm" className="text-xs" onClick={handleClearFilters}>
            Clear filters
          </Button>
        )}
      </div>

      {/* Table */}
      {isLoading && entries.length === 0 ? (
        <div className="flex h-64 items-center justify-center">
          <span className="text-sm text-muted-foreground">Loading transactions...</span>
        </div>
      ) : (
        <DataTableShell
          columns={columns}
          data={entries}
          pageCount={pageCount}
          emptyState={{
            heading: "No transactions recorded",
            body: "Transactions appear here after purchases and sales are recorded.",
          }}
          onStateChange={setTableState}
        />
      )}
    </div>
  )
}
