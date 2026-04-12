"use client"

import * as React from "react"

import { vehicleFixtures } from "@/lib/mock-data/vehicles"
import { thirdPartiesFixtures } from "@/lib/mock-data/third-parties"
import { useEntityMutation } from "@/hooks/use-entity-mutation"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface SendRepairDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

// Only RepairVendor type third parties
const repairVendors = thirdPartiesFixtures.filter((t) => t.type === "RepairVendor" && t.isActive)

// Only vehicles that could need repair (InStock or similar)
const repairableVehicles = vehicleFixtures.filter((v) =>
  ["InStock", "AdvancePlaced", "FinancePending", "DOReceived", "InRepair"].includes(v.status),
)

export function SendRepairDialog({ open, onOpenChange }: SendRepairDialogProps) {
  const [vehicleId, setVehicleId] = React.useState("")
  const [vendorId, setVendorId] = React.useState("")
  const [repairRequest, setRepairRequest] = React.useState("")
  const [dateSent, setDateSent] = React.useState(new Date().toISOString().slice(0, 10))

  const { mutate, isPending } = useEntityMutation({
    entityKey: "repairs",
    endpoint: "/api/repairs",
    method: "POST",
    successMessage: "Vehicle sent for repair. Status updated to In Repair.",
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!vehicleId || !vendorId || !repairRequest || !dateSent) return

    mutate(
      {
        vehicleId,
        vendorId,
        repairRequest,
        dateSent,
        status: "InProgress",
      } as Parameters<typeof mutate>[0],
      {
        onSuccess: () => {
          onOpenChange(false)
          resetForm()
        },
      },
    )
  }

  function resetForm() {
    setVehicleId("")
    setVendorId("")
    setRepairRequest("")
    setDateSent(new Date().toISOString().slice(0, 10))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold">Send for Repair</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Vehicle */}
          <div className="space-y-1.5">
            <Label htmlFor="repair-vehicle" className="text-xs font-normal">Vehicle</Label>
            <Select value={vehicleId} onValueChange={setVehicleId} required>
              <SelectTrigger id="repair-vehicle">
                <SelectValue placeholder="Select vehicle" />
              </SelectTrigger>
              <SelectContent>
                {repairableVehicles.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.make} {v.model} {v.year} — {v.colour}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Vendor */}
          <div className="space-y-1.5">
            <Label htmlFor="repair-vendor" className="text-xs font-normal">Repair Vendor</Label>
            <Select value={vendorId} onValueChange={setVendorId} required>
              <SelectTrigger id="repair-vendor">
                <SelectValue placeholder="Select vendor" />
              </SelectTrigger>
              <SelectContent>
                {repairVendors.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Repair Request */}
          <div className="space-y-1.5">
            <Label htmlFor="repair-request" className="text-xs font-normal">Repair Request</Label>
            <Textarea
              id="repair-request"
              placeholder="Describe the repair work required..."
              value={repairRequest}
              onChange={(e) => setRepairRequest(e.target.value)}
              rows={3}
              required
            />
          </div>

          {/* Date Sent */}
          <div className="space-y-1.5">
            <Label htmlFor="repair-date" className="text-xs font-normal">Date Sent</Label>
            <Input
              id="repair-date"
              type="date"
              value={dateSent}
              onChange={(e) => setDateSent(e.target.value)}
              required
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending || !vehicleId || !vendorId || !repairRequest}>
              {isPending ? "Sending..." : "Send for Repair"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
