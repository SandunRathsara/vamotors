"use client"

import * as React from "react"
import { parseAsInteger, parseAsString, useQueryStates } from "nuqs"
import { PlusCircle } from "lucide-react"

import type { LeaseDeal, PaginatedResponse } from "@/lib/mock-data/schemas"
import { useEntityQuery } from "@/hooks/use-entity-query"
import { DataTableShell } from "@/components/shared/data-table-shell"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
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
import { leaseDealsColumns } from "./lease-deals-columns"

const DEAL_TYPE_OPTIONS = [
  { value: "ApplicationProcessing", label: "Application Processing" },
  { value: "Referral", label: "Referral" },
]

const STATUS_OPTIONS = [
  "Initiated",
  "EligibilityPending",
  "Eligible",
  "Processing",
  "DocumentsCollected",
  "Dispatched",
  "Completed",
  "Rejected",
]

export function LeaseDealsTable() {
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [isSubmitting, setIsSubmitting] = React.useState(false)

  const [params, setParams] = useQueryStates({
    page: parseAsInteger.withDefault(1),
    pageSize: parseAsInteger.withDefault(20),
    q: parseAsString.withDefault(""),
    status: parseAsString.withDefault(""),
    dealType: parseAsString.withDefault(""),
    sortBy: parseAsString.withDefault(""),
    sortDir: parseAsString.withDefault("asc"),
  })

  const { data, isLoading, refetch } = useEntityQuery<PaginatedResponse<LeaseDeal>>(
    "lease-deals",
    "/api/lease-deals",
    {
      page: params.page,
      pageSize: params.pageSize,
      q: params.q || undefined,
      status: params.status || undefined,
      dealType: params.dealType || undefined,
      sortBy: params.sortBy || undefined,
      sortDir: params.sortDir || undefined,
    },
  )

  const deals = data?.data ?? []
  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / params.pageSize))
  const isFiltered = Boolean(params.q || params.status || params.dealType)

  function handleClearFilters() {
    void setParams({ q: "", status: "", dealType: "", page: 1 })
  }

  async function handleCreateDeal(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setIsSubmitting(true)
    const fd = new FormData(e.currentTarget)
    const payload = {
      customerId: "c-001",
      vehicleDescription: fd.get("vehicleDescription") as string,
      financeCompanyId: fd.get("financeCompanyId") as string,
      dealType: fd.get("dealType") as string,
      loanAmount: parseInt((fd.get("loanAmount") as string).replace(/,/g, ""), 10),
      status: "Initiated",
      guarantors: [],
      cashAdvanceFacility: false,
      inspectionPhotos: [],
      customerDocChecklist: {},
      vehicleDocChecklist: {},
    }
    try {
      const res = await fetch("/api/lease-deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error("Failed to create lease deal")
      toast.success("Lease deal created successfully")
      setDialogOpen(false)
      void refetch()
    } catch {
      toast.error("Failed to create lease deal. Please try again.")
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isLoading && deals.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center">
        <span className="text-sm text-muted-foreground">Loading lease deals...</span>
      </div>
    )
  }

  return (
    <>
      <DataTableShell
        columns={leaseDealsColumns}
        data={deals}
        pageCount={pageCount}
        searchPlaceholder="Search lease deals..."
        emptyState={{
          heading: "No lease deals yet",
          body: "Create a new lease deal to get started.",
        }}
        isFiltered={isFiltered}
        onClearFilters={handleClearFilters}
        toolbarChildren={
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <PlusCircle className="h-4 w-4 mr-1" aria-hidden="true" />
            New Lease Deal
          </Button>
        }
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New Lease Deal</DialogTitle>
          </DialogHeader>
          <form onSubmit={(e) => void handleCreateDeal(e)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="vehicleDescription">Vehicle Description</Label>
              <Input
                id="vehicleDescription"
                name="vehicleDescription"
                placeholder="e.g. Toyota Axio 2020 White"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="financeCompanyId">Finance Company ID</Label>
              <Input
                id="financeCompanyId"
                name="financeCompanyId"
                placeholder="e.g. tp-023"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dealType">Deal Type</Label>
              <Select name="dealType" defaultValue="ApplicationProcessing">
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {DEAL_TYPE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="loanAmount">Loan Amount (LKR cents)</Label>
              <Input
                id="loanAmount"
                name="loanAmount"
                type="number"
                placeholder="e.g. 30000000"
                required
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Creating..." : "Create Lease Deal"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

// Re-export options for potential reuse
export { DEAL_TYPE_OPTIONS, STATUS_OPTIONS }
