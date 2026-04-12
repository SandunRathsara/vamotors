"use client"

import * as React from "react"
import { parseAsInteger, parseAsString, useQueryStates } from "nuqs"

import type { PaginatedResponse, Approval } from "@/lib/mock-data/schemas"
import { useEntityQuery } from "@/hooks/use-entity-query"
import { DataTableShell } from "@/components/shared/data-table-shell"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { getApprovalsColumns, type ApprovalActionPayload } from "./approvals-columns"

// ── Types ──────────────────────────────────────────────────────────────────────

interface ApprovalsTableProps {
  onAction: (payload: ApprovalActionPayload) => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ApprovalsTable({ onAction }: ApprovalsTableProps) {
  const [params, setParams] = useQueryStates({
    page: parseAsInteger.withDefault(1),
    pageSize: parseAsInteger.withDefault(20),
    q: parseAsString.withDefault(""),
    status: parseAsString.withDefault(""),
    category: parseAsString.withDefault(""),
    sortBy: parseAsString.withDefault("requestDate"),
    sortDir: parseAsString.withDefault("desc"),
  })

  const { data, isLoading } = useEntityQuery<PaginatedResponse<Approval>>(
    "approvals",
    "/api/approvals",
    {
      page: params.page,
      pageSize: params.pageSize,
      q: params.q || undefined,
      status: params.status || undefined,
      category: params.category || undefined,
      sortBy: params.sortBy || undefined,
      sortDir: params.sortDir || undefined,
    },
  )

  const approvals = data?.data ?? []
  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / params.pageSize))
  const isFiltered = Boolean(params.q || params.status || params.category)

  const columns = React.useMemo(() => getApprovalsColumns(onAction), [onAction])

  function handleClearFilters() {
    void setParams({ q: "", status: "", category: "", page: 1 })
  }

  if (isLoading && approvals.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center">
        <span className="text-sm text-muted-foreground">Loading approvals...</span>
      </div>
    )
  }

  return (
    <DataTableShell
      columns={columns}
      data={approvals}
      pageCount={pageCount}
      emptyState={{
        heading: "No pending approvals",
        body: "Approved and rejected requests will appear here.",
      }}
      isFiltered={isFiltered}
      onClearFilters={handleClearFilters}
      toolbarChildren={
        <div className="flex items-center gap-2">
          <Input
            placeholder="Search approvals..."
            value={params.q}
            onChange={(e) => void setParams({ q: e.target.value, page: 1 })}
            className="h-8 w-56"
          />
          <Select
            value={params.status || "all"}
            onValueChange={(v) => void setParams({ status: v === "all" ? "" : v, page: 1 })}
          >
            <SelectTrigger className="h-8 w-36">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="Pending">Pending</SelectItem>
              <SelectItem value="Approved">Approved</SelectItem>
              <SelectItem value="Rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={params.category || "all"}
            onValueChange={(v) => void setParams({ category: v === "all" ? "" : v, page: 1 })}
          >
            <SelectTrigger className="h-8 w-36">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              <SelectItem value="Discount">Discount</SelectItem>
              <SelectItem value="WriteOff">Write-Off</SelectItem>
              <SelectItem value="Refund">Refund</SelectItem>
              <SelectItem value="SaleEdit">Sale Edit</SelectItem>
            </SelectContent>
          </Select>
        </div>
      }
    />
  )
}
