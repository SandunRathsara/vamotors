"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { format } from "date-fns"
import { CheckCircle, XCircle, Eye } from "lucide-react"

import type { Approval } from "@/lib/mock-data/schemas"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/shared/status-badge"

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDate(dateStr?: string) {
  if (!dateStr) return "—"
  try {
    return format(new Date(dateStr), "dd MMM yyyy")
  } catch {
    return dateStr
  }
}

const categoryVariant: Record<string, string> = {
  Discount: "secondary",
  WriteOff: "destructive",
  Refund: "outline",
  SaleEdit: "secondary",
}

// ── Types for action callback ──────────────────────────────────────────────────

export type ApprovalActionType = "approve" | "reject" | "view"

export interface ApprovalActionPayload {
  approval: Approval
  action: ApprovalActionType
}

// ── Columns factory ────────────────────────────────────────────────────────────

export function getApprovalsColumns(
  onAction: (payload: ApprovalActionPayload) => void,
): ColumnDef<Approval>[] {
  return [
    {
      id: "index",
      header: "#",
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground tabular-nums">{row.index + 1}</span>
      ),
      enableSorting: false,
      enableHiding: false,
      size: 48,
    },
    {
      id: "requestDate",
      accessorKey: "requestDate",
      header: "Date",
      cell: ({ row }) => (
        <span className="text-sm tabular-nums text-muted-foreground">
          {formatDate(row.original.requestDate)}
        </span>
      ),
      enableSorting: true,
      meta: { label: "Date" },
    },
    {
      id: "requestedBy",
      accessorKey: "requestedBy",
      header: "Requested By",
      cell: ({ row }) => (
        <span className="text-sm">{row.original.requestedBy}</span>
      ),
      enableSorting: false,
    },
    {
      id: "category",
      accessorKey: "category",
      header: "Category",
      cell: ({ row }) => {
        const cat = row.original.category
        const variant = categoryVariant[cat] ?? "secondary"
        return (
          <Badge variant={variant as "default" | "secondary" | "outline" | "destructive"}>
            {cat}
          </Badge>
        )
      },
      enableSorting: true,
      meta: { label: "Category" },
    },
    {
      id: "entity",
      header: "Item / Deal",
      cell: ({ row }) => {
        const { entityType, entityId } = row.original
        const truncatedId = entityId.length > 12 ? `${entityId.slice(0, 12)}…` : entityId
        return (
          <span className="text-sm">
            <span className="text-muted-foreground">{entityType} / </span>
            <span className="tabular-nums font-mono text-xs">{truncatedId}</span>
          </span>
        )
      },
      enableSorting: false,
    },
    {
      id: "valueChange",
      accessorKey: "valueChange",
      header: "Value Change",
      cell: ({ row }) => {
        const text = row.original.valueChange
        const truncated = text.length > 50 ? `${text.slice(0, 50)}…` : text
        return (
          <span className="text-sm text-muted-foreground" title={text}>
            {truncated}
          </span>
        )
      },
      enableSorting: false,
    },
    {
      id: "reason",
      accessorKey: "reason",
      header: "Reason",
      cell: ({ row }) => {
        const text = row.original.reason
        const truncated = text.length > 60 ? `${text.slice(0, 60)}…` : text
        return (
          <span className="text-sm text-muted-foreground" title={text}>
            {truncated}
          </span>
        )
      },
      enableSorting: false,
    },
    {
      id: "status",
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <StatusBadge status={row.original.status} variant="approval" />
      ),
      enableSorting: true,
      meta: { label: "Status" },
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => {
        const approval = row.original
        if (approval.status === "Pending") {
          return (
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-950"
                onClick={() => onAction({ approval, action: "approve" })}
              >
                <CheckCircle className="mr-1 h-3.5 w-3.5" />
                Approve
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={() => onAction({ approval, action: "reject" })}
              >
                <XCircle className="mr-1 h-3.5 w-3.5" />
                Reject
              </Button>
            </div>
          )
        }
        return (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => onAction({ approval, action: "view" })}
          >
            <Eye className="mr-1 h-3.5 w-3.5" />
            View
          </Button>
        )
      },
      enableSorting: false,
      enableHiding: false,
      size: 140,
    },
  ]
}
