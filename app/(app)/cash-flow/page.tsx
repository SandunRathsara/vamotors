"use client"

import * as React from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { parseAsInteger, parseAsString, useQueryStates } from "nuqs"
import { ArrowDownLeft, ArrowUpRight, TrendingUp } from "lucide-react"

import type { CashFlowEntry } from "@/lib/mock-data/schemas"
import { useEntityQuery } from "@/hooks/use-entity-query"
import { DataTableShell } from "@/components/shared/data-table-shell"
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
  const [params, setParams] = useQueryStates({
    page: parseAsInteger.withDefault(1),
    pageSize: parseAsInteger.withDefault(20),
    sortBy: parseAsString.withDefault(""),
    sortDir: parseAsString.withDefault("desc"),
    type: parseAsString.withDefault(""),
    dateFrom: parseAsString.withDefault(""),
    dateTo: parseAsString.withDefault(""),
  })

  const { data, isLoading } = useEntityQuery<CashFlowResponse>(
    "cash-flow",
    "/api/cash-flow",
    {
      page: params.page,
      pageSize: params.pageSize,
      sortBy: params.sortBy || undefined,
      sortDir: params.sortDir || undefined,
      type: params.type || undefined,
      dateFrom: params.dateFrom || undefined,
      dateTo: params.dateTo || undefined,
    },
  )

  const entries = data?.data ?? []
  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / params.pageSize))
  const summary = data?.summary ?? { totalInflow: 0, totalOutflow: 0, netPosition: 0 }
  const isFiltered = Boolean(params.dateFrom || params.dateTo || params.type)

  function handleClearFilters() {
    void setParams({ dateFrom: "", dateTo: "", type: "", page: 1 })
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
            value={params.dateFrom}
            onChange={(e) => void setParams({ dateFrom: e.target.value, page: 1 })}
          />
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="cf-dateTo" className="text-xs">To</Label>
          <Input
            id="cf-dateTo"
            type="date"
            className="h-8 w-40 text-xs"
            value={params.dateTo}
            onChange={(e) => void setParams({ dateTo: e.target.value, page: 1 })}
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
          isFiltered={isFiltered}
          onClearFilters={handleClearFilters}
        />
      )}
    </div>
  )
}
