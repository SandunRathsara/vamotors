"use client"

import * as React from "react"

import { vehicleFixtures } from "@/lib/mock-data/vehicles"
import { customerFixtures } from "@/lib/mock-data/customers"
import { useEntityMutation } from "@/hooks/use-entity-mutation"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface RecordSaleDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function RecordSaleDialog({ open, onOpenChange }: RecordSaleDialogProps) {
  const [vehicleId, setVehicleId] = React.useState("")
  const [customerId, setCustomerId] = React.useState("")
  const [saleType, setSaleType] = React.useState<"Cash" | "Advance" | "LeaseFinance" | "TradeIn">("Cash")
  const [salePrice, setSalePrice] = React.useState("")
  const [paymentMethod, setPaymentMethod] = React.useState<"Cash" | "BankTransfer">("Cash")
  const [date, setDate] = React.useState(new Date().toISOString().slice(0, 10))
  const [mileage, setMileage] = React.useState("")

  const { mutate, isPending } = useEntityMutation({
    entityKey: "sales",
    endpoint: "/api/sales",
    method: "POST",
    successMessage: "Sale recorded. Vehicle marked as Sold.",
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!vehicleId || !customerId || !salePrice || !date) return

    mutate(
      {
        vehicleId,
        customerId,
        saleType,
        salePrice: Math.round(parseFloat(salePrice) * 100),
        paymentMethod,
        date,
        mileageAtSale: parseInt(mileage || "0", 10),
        status: saleType === "Advance" ? "AdvancePlaced" : saleType === "LeaseFinance" ? "FinancePending" : "Completed",
        timeline: [],
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
    setCustomerId("")
    setSaleType("Cash")
    setSalePrice("")
    setPaymentMethod("Cash")
    setDate(new Date().toISOString().slice(0, 10))
    setMileage("")
  }

  // Filter to only InStock vehicles
  const availableVehicles = vehicleFixtures.filter((v) =>
    ["InStock", "AdvancePlaced", "FinancePending", "DOReceived"].includes(v.status),
  )

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-lg w-full overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Record Sale</SheetTitle>
          <SheetDescription>Record a completed vehicle sale</SheetDescription>
        </SheetHeader>
        <div className="px-1 pb-4">
          <form id="record-sale-form" onSubmit={handleSubmit} className="space-y-4">
            {/* Vehicle */}
            <div className="space-y-1.5">
              <Label htmlFor="sale-vehicle" className="text-xs font-normal">Vehicle</Label>
              <Select value={vehicleId} onValueChange={setVehicleId} required>
                <SelectTrigger id="sale-vehicle">
                  <SelectValue placeholder="Select vehicle" />
                </SelectTrigger>
                <SelectContent>
                  {availableVehicles.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.make} {v.model} {v.year} — {v.colour}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Customer */}
            <div className="space-y-1.5">
              <Label htmlFor="sale-customer" className="text-xs font-normal">Customer</Label>
              <Select value={customerId} onValueChange={setCustomerId} required>
                <SelectTrigger id="sale-customer">
                  <SelectValue placeholder="Select customer" />
                </SelectTrigger>
                <SelectContent>
                  {customerFixtures.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.fullName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Sale Type */}
            <div className="space-y-1.5">
              <Label htmlFor="sale-type" className="text-xs font-normal">Sale Type</Label>
              <Select value={saleType} onValueChange={(v) => setSaleType(v as typeof saleType)}>
                <SelectTrigger id="sale-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Cash">Cash</SelectItem>
                  <SelectItem value="Advance">Advance</SelectItem>
                  <SelectItem value="LeaseFinance">Lease / Finance</SelectItem>
                  <SelectItem value="TradeIn">Trade-In</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Sale Price */}
            <div className="space-y-1.5">
              <Label htmlFor="sale-price" className="text-xs font-normal">Sale Price (LKR)</Label>
              <Input
                id="sale-price"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={salePrice}
                onChange={(e) => setSalePrice(e.target.value)}
                required
              />
            </div>

            {/* Payment Method */}
            <div className="space-y-1.5">
              <Label htmlFor="payment-method" className="text-xs font-normal">Payment Method</Label>
              <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as typeof paymentMethod)}>
                <SelectTrigger id="payment-method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Cash">Cash</SelectItem>
                  <SelectItem value="BankTransfer">Bank Transfer</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Date */}
            <div className="space-y-1.5">
              <Label htmlFor="sale-date" className="text-xs font-normal">Sale Date</Label>
              <Input
                id="sale-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </div>

            {/* Mileage */}
            <div className="space-y-1.5">
              <Label htmlFor="sale-mileage" className="text-xs font-normal">Mileage at Sale (km)</Label>
              <Input
                id="sale-mileage"
                type="number"
                min="0"
                placeholder="0"
                value={mileage}
                onChange={(e) => setMileage(e.target.value)}
              />
            </div>
          </form>
          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" form="record-sale-form" disabled={isPending || !vehicleId || !customerId || !salePrice}>
              {isPending ? "Recording..." : "Record Sale"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
