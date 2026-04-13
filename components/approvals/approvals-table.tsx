"use client"

import * as React from "react"
import { parseAsString, useQueryState } from "nuqs"

import type { PaginatedResponse, Approval } from "@/lib/mock-data/schemas"
import { useEntityQuery } from "@/hooks/use-entity-query"
import { DataTableShell, type DataTableState } from "@/components/shared/data-table-shell"
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
  const [tableState, setTableState] = React.useState<DataTableState>({
    page: 1,
    perPage: 20,
    sortBy: "requestDate",
    sortDir: "desc",
  })

  const [q, setQ] = useQueryState("q", parseAsString.withDefault(""))
  const [status, setStatus] = useQueryState("status", parseAsString.withDefault(""))
  const [category, setCategory] = useQueryState("category", parseAsString.withDefault(""))

  const { data, isLoading } = useEntityQuery<PaginatedResponse<Approval>>(
    "approvals",
    "/api/approvals",
    {
      page: tableState.page,
      pageSize: tableState.perPage,
      q: q || undefined,
      status: status || undefined,
      category: category || undefined,
      sortBy: tableState.sortBy || undefined,
      sortDir: tableState.sortDir || undefined,
    },
  )

  const approvals = data?.data ?? []
  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / tableState.perPage))

  const columns = React.useMemo(() => getApprovalsColumns(onAction), [onAction])

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
      onStateChange={setTableState}
      onRowClick={(approval) =>
        onAction({ approval, action: approval.status === "Pending" ? "approve" : "view" })
      }
      toolbarChildren={
        <div className="flex items-center gap-2">
          <Input
            placeholder="Search approvals..."
            value={q}
            onChange={(e) => void setQ(e.target.value || null)}
            className="h-8 w-56"
          />
          <Select
            value={status || "all"}
            onValueChange={(v) => void setStatus(v === "all" ? null : v)}
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
            value={category || "all"}
            onValueChange={(v) => void setCategory(v === "all" ? null : v)}
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
