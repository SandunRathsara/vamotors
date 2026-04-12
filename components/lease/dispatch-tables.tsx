"use client"

import * as React from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { format } from "date-fns"
import { Truck } from "lucide-react"

import type { LeaseDispatch } from "@/lib/mock-data/schemas"
import { StatusBadge } from "@/components/shared/status-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { toast } from "sonner"

// ── Types ─────────────────────────────────────────────────────────────────────

interface DispatchData {
  pending: LeaseDispatch[]
  dispatched: LeaseDispatch[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(dateStr?: string) {
  if (!dateStr) return "—"
  try {
    return format(new Date(dateStr), "dd MMM yyyy HH:mm")
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

// ── Main component ─────────────────────────────────────────────────────────────

export function DispatchTables() {
  const [selectedItem, setSelectedItem] = React.useState<LeaseDispatch | null>(null)
  const [trackingNumber, setTrackingNumber] = React.useState("")
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery<DispatchData>({
    queryKey: ["lease-dispatch"],
    queryFn: async () => {
      const res = await fetch("/api/lease-dispatch")
      if (!res.ok) throw new Error("Failed to fetch dispatch data")
      return res.json() as Promise<DispatchData>
    },
    staleTime: 30_000,
  })

  const { mutate: markDispatched, isPending } = useMutation({
    mutationFn: async (payload: { id: string; trackingNumber?: string }) => {
      const res = await fetch("/api/lease-dispatch", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error("Failed to mark as dispatched")
      return res.json()
    },
    onSuccess: () => {
      toast.success("Documents marked as dispatched.")
      void queryClient.invalidateQueries({ queryKey: ["lease-dispatch"] })
      setSelectedItem(null)
      setTrackingNumber("")
    },
    onError: () => {
      toast.error("Failed to mark as dispatched. Please try again.")
    },
  })

  function handleConfirmDispatch() {
    if (!selectedItem) return
    markDispatched({ id: selectedItem.id, trackingNumber: trackingNumber || undefined })
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-48 w-full rounded-lg" />
        <Skeleton className="h-48 w-full rounded-lg" />
      </div>
    )
  }

  const pending = data?.pending ?? []
  const dispatched = data?.dispatched ?? []

  return (
    <>
      <div className="space-y-6">
        {/* Pending Dispatch table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-xl font-semibold">Pending Dispatch</CardTitle>
          </CardHeader>
          <CardContent>
            {pending.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
                <Truck className="h-8 w-8 text-muted-foreground/40" aria-hidden="true" />
                <p className="text-sm font-semibold">Nothing awaiting dispatch</p>
                <p className="text-sm text-muted-foreground">
                  Completed deals will appear here when ready to dispatch.
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs font-normal">Source</TableHead>
                    <TableHead className="text-xs font-normal">Deal</TableHead>
                    <TableHead className="text-xs font-normal">Customer</TableHead>
                    <TableHead className="text-xs font-normal">Finance Company</TableHead>
                    <TableHead className="text-xs font-normal">File #</TableHead>
                    <TableHead className="text-xs font-normal">Status</TableHead>
                    <TableHead className="text-xs font-normal"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pending.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell><SourceBadge source={item.source} /></TableCell>
                      <TableCell className="text-sm tabular-nums">{item.dealId}</TableCell>
                      <TableCell className="text-sm">{item.customerName}</TableCell>
                      <TableCell className="text-sm">{item.financeCompanyName}</TableCell>
                      <TableCell className="text-sm tabular-nums">{item.fileNumber}</TableCell>
                      <TableCell><StatusBadge status={item.status} /></TableCell>
                      <TableCell>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSelectedItem(item)
                            setTrackingNumber("")
                          }}
                        >
                          Mark Dispatched
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Dispatched table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-xl font-semibold">Dispatched</CardTitle>
          </CardHeader>
          <CardContent>
            {dispatched.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No dispatched items yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs font-normal">Source</TableHead>
                    <TableHead className="text-xs font-normal">Deal</TableHead>
                    <TableHead className="text-xs font-normal">Finance Company</TableHead>
                    <TableHead className="text-xs font-normal">Dispatched At</TableHead>
                    <TableHead className="text-xs font-normal">By</TableHead>
                    <TableHead className="text-xs font-normal">Tracking #</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dispatched.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell><SourceBadge source={item.source} /></TableCell>
                      <TableCell className="text-sm tabular-nums">{item.dealId}</TableCell>
                      <TableCell className="text-sm">{item.financeCompanyName}</TableCell>
                      <TableCell className="text-sm tabular-nums">{formatDate(item.dispatchedAt)}</TableCell>
                      <TableCell className="text-sm">{item.dispatchedBy ?? "—"}</TableCell>
                      <TableCell className="text-sm tabular-nums">{item.trackingNumber ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Mark Dispatched dialog */}
      <Dialog open={Boolean(selectedItem)} onOpenChange={(open) => { if (!open) setSelectedItem(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Mark as Dispatched</DialogTitle>
          </DialogHeader>
          {selectedItem && (
            <div className="space-y-4">
              <div className="rounded-md bg-muted/50 p-3 space-y-1">
                <p className="text-sm font-semibold">{selectedItem.customerName}</p>
                <p className="text-xs text-muted-foreground">{selectedItem.fileNumber} · {selectedItem.financeCompanyName}</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="trackingNumber">Tracking Number (optional)</Label>
                <Input
                  id="trackingNumber"
                  value={trackingNumber}
                  onChange={(e) => setTrackingNumber(e.target.value)}
                  placeholder="e.g. SPL-DISP-1234"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedItem(null)}>Cancel</Button>
            <Button onClick={handleConfirmDispatch} disabled={isPending}>
              {isPending ? "Dispatching..." : "Confirm Dispatch"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
