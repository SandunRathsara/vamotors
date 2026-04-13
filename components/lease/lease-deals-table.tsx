"use client"

import * as React from "react"
import { PlusCircle } from "lucide-react"

import type { LeaseDeal, PaginatedResponse } from "@/lib/mock-data/schemas"
import { useEntityQuery } from "@/hooks/use-entity-query"
import { DataTableShell, type DataTableState } from "@/components/shared/data-table-shell"
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

  const [tableState, setTableState] = React.useState<DataTableState>({
    page: 1,
    perPage: 20,
    sortBy: "",
    sortDir: "asc",
  })

  const { data, isLoading, refetch } = useEntityQuery<PaginatedResponse<LeaseDeal>>(
    "lease-deals",
    "/api/lease-deals",
    {
      page: tableState.page,
      pageSize: tableState.perPage,
      sortBy: tableState.sortBy || undefined,
      sortDir: tableState.sortDir || undefined,
    },
  )

  const deals = data?.data ?? []
  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / tableState.perPage))

  async function handleCreateDeal(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setIsSubmitting(true)
    const fd = new FormData(e.currentTarget)
    const payload = {
      customerId: fd.get("customerId") as string,
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
        emptyState={{
          heading: "No lease deals yet",
          body: "Create a new lease deal to get started.",
        }}
        onStateChange={setTableState}
        toolbarChildren={
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <PlusCircle className="h-4 w-4 mr-1" aria-hidden="true" />
            New Lease Deal
          </Button>
        }
      />

      <Sheet open={dialogOpen} onOpenChange={setDialogOpen}>
        <SheetContent side="right" className="sm:max-w-lg w-full overflow-y-auto">
          <SheetHeader>
            <SheetTitle>New Lease Deal</SheetTitle>
            <SheetDescription>Create a new lease or finance deal</SheetDescription>
          </SheetHeader>
          <div className="px-1 pb-4">
            <form id="new-lease-deal-form" onSubmit={(e) => void handleCreateDeal(e)} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="customerId">Customer ID</Label>
                <Input
                  id="customerId"
                  name="customerId"
                  placeholder="e.g. c-001"
                  required
                />
              </div>
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
            </form>
            <div className="flex justify-end gap-2 pt-4">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" form="new-lease-deal-form" disabled={isSubmitting}>
                {isSubmitting ? "Creating..." : "Create Lease Deal"}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}

// Re-export options for potential reuse
export { DEAL_TYPE_OPTIONS, STATUS_OPTIONS }
