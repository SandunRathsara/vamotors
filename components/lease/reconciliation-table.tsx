"use client"

import * as React from "react"
import { parseAsInteger, parseAsString, useQueryStates } from "nuqs"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { format } from "date-fns"

import type { LeaseReconciliation, PaginatedResponse } from "@/lib/mock-data/schemas"
import { StatusBadge } from "@/components/shared/status-badge"
import { CurrencyDisplay } from "@/components/shared/currency-display"
import { DataTableShell } from "@/components/shared/data-table-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { toast } from "sonner"
import type { ColumnDef } from "@tanstack/react-table"

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(dateStr?: string) {
  if (!dateStr) return "—"
  try {
    return format(new Date(dateStr), "dd MMM yyyy")
  } catch {
    return dateStr
  }
}

function SourceBadge({ source }: { source: "VehicleSale" | "Brokerage" }) {
  return (
    <Badge variant={source === "Brokerage" ? "secondary" : "outline"} className="text-xs font-normal">
      {source === "VehicleSale" ? "Vehicle Sale" : "Brokerage"}
    </Badge>
  )
}

// ── Columns factory ───────────────────────────────────────────────────────────

function buildColumns(
  onReconcile: (item: LeaseReconciliation) => void
): ColumnDef<LeaseReconciliation>[] {
  return [
    {
      accessorKey: "date",
      header: "Date",
      cell: ({ row }) => <span className="text-sm tabular-nums">{formatDate(row.original.date)}</span>,
    },
    {
      accessorKey: "source",
      header: "Source",
      cell: ({ row }) => <SourceBadge source={row.original.source} />,
    },
    {
      accessorKey: "entity",
      header: "Entity",
      cell: ({ row }) => <span className="text-sm">{row.original.entity}</span>,
    },
    {
      accessorKey: "dealRef",
      header: "Deal Ref",
      cell: ({ row }) => <span className="text-sm tabular-nums">{row.original.dealRef}</span>,
    },
    {
      accessorKey: "expectedCommission",
      header: "Expected Comm.",
      cell: ({ row }) => <CurrencyDisplay amount={row.original.expectedCommission} />,
    },
    {
      accessorKey: "receivedCommission",
      header: "Received Comm.",
      cell: ({ row }) =>
        row.original.receivedCommission !== undefined ? (
          <CurrencyDisplay amount={row.original.receivedCommission} />
        ) : (
          <span className="text-muted-foreground text-sm">—</span>
        ),
    },
    {
      accessorKey: "discrepancy",
      header: "Discrepancy",
      cell: ({ row }) => {
        const d = row.original.discrepancy
        if (d === undefined) return <span className="text-muted-foreground text-sm">—</span>
        return (
          <CurrencyDisplay
            amount={d}
            className={d > 0 ? "text-destructive" : undefined}
          />
        )
      },
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) =>
        row.original.status !== "Reconciled" ? (
          <Button variant="outline" size="sm" onClick={() => onReconcile(row.original)}>
            Reconcile
          </Button>
        ) : null,
    },
  ]
}

// ── Main component ─────────────────────────────────────────────────────────────

export function ReconciliationTable() {
  const [selectedItem, setSelectedItem] = React.useState<LeaseReconciliation | null>(null)
  const [receivedAmount, setReceivedAmount] = React.useState("")
  const queryClient = useQueryClient()

  const [params, setParams] = useQueryStates({
    page: parseAsInteger.withDefault(1),
    pageSize: parseAsInteger.withDefault(20),
    status: parseAsString.withDefault(""),
    source: parseAsString.withDefault(""),
  })

  const queryKey = ["lease-reconciliation", params]

  const { data, isLoading } = useQuery<PaginatedResponse<LeaseReconciliation>>({
    queryKey,
    queryFn: async () => {
      const sp = new URLSearchParams()
      sp.set("page", String(params.page))
      sp.set("pageSize", String(params.pageSize))
      if (params.status) sp.set("status", params.status)
      if (params.source) sp.set("source", params.source)
      const res = await fetch(`/api/lease-reconciliation?${sp.toString()}`)
      if (!res.ok) throw new Error("Failed to fetch reconciliation data")
      return res.json() as Promise<PaginatedResponse<LeaseReconciliation>>
    },
    staleTime: 30_000,
  })

  const { mutate: reconcile, isPending } = useMutation({
    mutationFn: async (payload: { id: string; receivedCommission: number }) => {
      const res = await fetch("/api/lease-reconciliation", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error("Failed to reconcile")
      return res.json()
    },
    onSuccess: () => {
      toast.success("Commission reconciled.")
      void queryClient.invalidateQueries({ queryKey: ["lease-reconciliation"] })
      setSelectedItem(null)
      setReceivedAmount("")
    },
    onError: () => {
      toast.error("Failed to reconcile. Please try again.")
    },
  })

  function handleConfirmReconcile() {
    if (!selectedItem) return
    const amount = parseInt(receivedAmount.replace(/,/g, ""), 10)
    if (isNaN(amount) || amount < 0) {
      toast.error("Please enter a valid amount.")
      return
    }
    reconcile({ id: selectedItem.id, receivedCommission: amount })
  }

  const items = data?.data ?? []
  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / params.pageSize))
  const isFiltered = Boolean(params.status || params.source)

  function handleClearFilters() {
    void setParams({ status: "", source: "", page: 1 })
  }

  const columns = buildColumns((item) => {
    setSelectedItem(item)
    setReceivedAmount(String(item.expectedCommission))
  })

  if (isLoading && items.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center">
        <span className="text-sm text-muted-foreground">Loading reconciliation data...</span>
      </div>
    )
  }

  return (
    <>
      {/* Filters toolbar */}
      <div className="mb-4 flex flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Label htmlFor="statusFilter" className="text-sm font-normal shrink-0">Status</Label>
          <Select
            value={params.status || "all"}
            onValueChange={(v) => void setParams({ status: v === "all" ? "" : v, page: 1 })}
          >
            <SelectTrigger id="statusFilter" className="w-40">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="Pending">Pending</SelectItem>
              <SelectItem value="Reconciled">Reconciled</SelectItem>
              <SelectItem value="Overdue">Overdue</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="sourceFilter" className="text-sm font-normal shrink-0">Source</Label>
          <Select
            value={params.source || "all"}
            onValueChange={(v) => void setParams({ source: v === "all" ? "" : v, page: 1 })}
          >
            <SelectTrigger id="sourceFilter" className="w-40">
              <SelectValue placeholder="All sources" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              <SelectItem value="VehicleSale">Vehicle Sale</SelectItem>
              <SelectItem value="Brokerage">Brokerage</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <DataTableShell
        columns={columns}
        data={items}
        pageCount={pageCount}
        emptyState={{
          heading: "No commission records",
          body: "Reconciliation entries appear after deals are dispatched.",
        }}
        isFiltered={isFiltered}
        onClearFilters={handleClearFilters}
      />

      {/* Reconcile sheet */}
      <Sheet open={Boolean(selectedItem)} onOpenChange={(open) => { if (!open) setSelectedItem(null) }}>
        <SheetContent side="right" className="sm:max-w-lg w-full overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Reconcile Commission</SheetTitle>
            <SheetDescription>Enter the received commission amount to reconcile</SheetDescription>
          </SheetHeader>
          <div className="px-1 pb-4">
            {selectedItem && (
              <div className="space-y-4">
                <div className="rounded-md bg-muted/50 p-3 space-y-1">
                  <p className="text-sm font-semibold">{selectedItem.entity}</p>
                  <p className="text-xs text-muted-foreground">{selectedItem.dealRef}</p>
                  <div className="flex gap-4 pt-1">
                    <div>
                      <p className="text-xs text-muted-foreground">Expected</p>
                      <CurrencyDisplay amount={selectedItem.expectedCommission} className="text-sm font-semibold" />
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="receivedAmount">Received Commission (LKR cents)</Label>
                  <Input
                    id="receivedAmount"
                    value={receivedAmount}
                    onChange={(e) => setReceivedAmount(e.target.value)}
                    placeholder="Enter received amount"
                  />
                </div>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={() => setSelectedItem(null)}>Cancel</Button>
              <Button onClick={handleConfirmReconcile} disabled={isPending}>
                {isPending ? "Reconciling..." : "Reconcile"}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
