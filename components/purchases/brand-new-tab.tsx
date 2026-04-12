"use client"

import * as React from "react"
import { useForm } from "@tanstack/react-form"
import { format } from "date-fns"
import { CalendarIcon, Plus, Trash2 } from "lucide-react"

import { useEntityMutation } from "@/hooks/use-entity-mutation"
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"

const YEARS = Array.from({ length: 11 }, (_, i) => 2025 - i)

interface AdditionalCost {
  description: string
  amount: string
  date: string
}

interface BrandNewFormValues {
  make: string
  model: string
  year: string
  colour: string
  engineNumber: string
  chassisNumber: string
  fuelType: string
  transmission: string
  companySupplier: string
  purchaseDate: string
  purchasePrice: string
  mileageAtPurchase: string
  listedPrice: string
  additionalCosts: AdditionalCost[]
  internalNotes: string
}

export function BrandNewTab() {
  const { mutate, isPending } = useEntityMutation({
    entityKey: "vehicles",
    endpoint: "/api/purchases",
    method: "POST",
    successMessage: "Purchase recorded. Vehicle added to inventory.",
  })

  const EMPTY_VALUES: BrandNewFormValues = {
    make: "",
    model: "",
    year: "",
    colour: "",
    engineNumber: "",
    chassisNumber: "",
    fuelType: "",
    transmission: "",
    companySupplier: "",
    purchaseDate: "",
    purchasePrice: "",
    mileageAtPurchase: "",
    listedPrice: "",
    additionalCosts: [],
    internalNotes: "",
  }

  const form = useForm({
    defaultValues: EMPTY_VALUES,
    onSubmit: async ({ value }) => {
      const additionalCosts = value.additionalCosts
        .filter((c) => c.description && c.amount)
        .map((c, i) => ({
          id: `ac-new-${Date.now()}-${i}`,
          description: c.description,
          amount: Math.round(parseFloat(c.amount) * 100),
          date: c.date || value.purchaseDate,
        }))

      mutate({
        make: value.make,
        model: value.model,
        year: parseInt(value.year, 10),
        colour: value.colour,
        engineNumber: value.engineNumber,
        chassisNumber: value.chassisNumber,
        fuelType: value.fuelType,
        transmission: value.transmission,
        purchaseType: "BrandNew",
        supplierId: "",
        supplier: value.companySupplier,
        purchaseDate: value.purchaseDate,
        purchasePrice: Math.round(parseFloat(value.purchasePrice) * 100),
        listedPrice: Math.round(parseFloat(value.listedPrice) * 100),
        mileageAtPurchase: parseInt(value.mileageAtPurchase, 10),
        additionalCosts,
        internalNotes: value.internalNotes,
      })
      form.reset()
    },
  })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void form.handleSubmit()
      }}
      className="space-y-6"
    >
      {/* Vehicle Details — no VIN or CR Number per VPRC-03 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-xl font-semibold">Vehicle Details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <form.Field name="make">
            {(field) => (
              <div className="space-y-1">
                <Label htmlFor={field.name} className="text-xs font-normal">Make</Label>
                <Input id={field.name} value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} placeholder="e.g. Toyota" className="text-sm" />
              </div>
            )}
          </form.Field>

          <form.Field name="model">
            {(field) => (
              <div className="space-y-1">
                <Label htmlFor={field.name} className="text-xs font-normal">Model</Label>
                <Input id={field.name} value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} placeholder="e.g. Aqua" className="text-sm" />
              </div>
            )}
          </form.Field>

          <form.Field name="year">
            {(field) => (
              <div className="space-y-1">
                <Label htmlFor={field.name} className="text-xs font-normal">Year</Label>
                <Select value={field.state.value} onValueChange={field.handleChange}>
                  <SelectTrigger id={field.name} className="text-sm"><SelectValue placeholder="Select year" /></SelectTrigger>
                  <SelectContent>{YEARS.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
          </form.Field>

          <form.Field name="colour">
            {(field) => (
              <div className="space-y-1">
                <Label htmlFor={field.name} className="text-xs font-normal">Colour</Label>
                <Input id={field.name} value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} placeholder="e.g. White" className="text-sm" />
              </div>
            )}
          </form.Field>

          <form.Field name="engineNumber">
            {(field) => (
              <div className="space-y-1">
                <Label htmlFor={field.name} className="text-xs font-normal">Engine Number</Label>
                <Input id={field.name} value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} className="text-sm" />
              </div>
            )}
          </form.Field>

          <form.Field name="chassisNumber">
            {(field) => (
              <div className="space-y-1">
                <Label htmlFor={field.name} className="text-xs font-normal">Chassis Number</Label>
                <Input id={field.name} value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} className="text-sm" />
              </div>
            )}
          </form.Field>

          <form.Field name="fuelType">
            {(field) => (
              <div className="space-y-1">
                <Label htmlFor={field.name} className="text-xs font-normal">Fuel Type</Label>
                <Select value={field.state.value} onValueChange={field.handleChange}>
                  <SelectTrigger id={field.name} className="text-sm"><SelectValue placeholder="Select fuel type" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Petrol">Petrol</SelectItem>
                    <SelectItem value="Diesel">Diesel</SelectItem>
                    <SelectItem value="Hybrid">Hybrid</SelectItem>
                    <SelectItem value="Electric">Electric</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </form.Field>

          <form.Field name="transmission">
            {(field) => (
              <div className="space-y-1">
                <Label htmlFor={field.name} className="text-xs font-normal">Transmission</Label>
                <Select value={field.state.value} onValueChange={field.handleChange}>
                  <SelectTrigger id={field.name} className="text-sm"><SelectValue placeholder="Select transmission" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Manual">Manual</SelectItem>
                    <SelectItem value="Automatic">Automatic</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </form.Field>
        </CardContent>
      </Card>

      {/* Supplier */}
      <Card>
        <CardHeader>
          <CardTitle className="text-xl font-semibold">Supplier</CardTitle>
        </CardHeader>
        <CardContent>
          <form.Field name="companySupplier">
            {(field) => (
              <div className="space-y-1 max-w-sm">
                <Label htmlFor={field.name} className="text-xs font-normal">Company Supplier</Label>
                <Input id={field.name} value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} placeholder="e.g. Toyota Lanka (Pvt) Ltd" className="text-sm" />
              </div>
            )}
          </form.Field>
        </CardContent>
      </Card>

      {/* Purchase Details */}
      <Card>
        <CardHeader>
          <CardTitle className="text-xl font-semibold">Purchase Details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <form.Field name="purchaseDate">
            {(field) => (
              <div className="space-y-1">
                <Label className="text-xs font-normal">Purchase Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start text-sm font-normal" type="button">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {field.state.value ? format(new Date(field.state.value), "dd MMM yyyy") : "Pick a date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar mode="single" selected={field.state.value ? new Date(field.state.value) : undefined} onSelect={(date) => field.handleChange(date ? format(date, "yyyy-MM-dd") : "")} />
                  </PopoverContent>
                </Popover>
              </div>
            )}
          </form.Field>

          <form.Field name="purchasePrice">
            {(field) => (
              <div className="space-y-1">
                <Label htmlFor={field.name} className="text-xs font-normal">Purchase Price (LKR)</Label>
                <Input id={field.name} value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} placeholder="e.g. 2950000" className="text-sm" type="text" inputMode="numeric" />
              </div>
            )}
          </form.Field>

          <form.Field name="mileageAtPurchase">
            {(field) => (
              <div className="space-y-1">
                <Label htmlFor={field.name} className="text-xs font-normal">Mileage at Purchase (km)</Label>
                <Input id={field.name} value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} placeholder="e.g. 0" className="text-sm" type="number" />
              </div>
            )}
          </form.Field>

          <form.Field name="listedPrice">
            {(field) => (
              <div className="space-y-1">
                <Label htmlFor={field.name} className="text-xs font-normal">Listed Price (LKR)</Label>
                <Input id={field.name} value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} placeholder="e.g. 3450000" className="text-sm" type="text" inputMode="numeric" />
              </div>
            )}
          </form.Field>
        </CardContent>
      </Card>

      {/* Additional Costs */}
      <form.Field name="additionalCosts" mode="array">
        {(field) => (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-xl font-semibold">Additional Costs</CardTitle>
              <Button type="button" variant="outline" size="sm" onClick={() => field.pushValue({ description: "", amount: "", date: "" })}>
                <Plus className="mr-1 h-4 w-4" />
                Add Cost
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {field.state.value.length === 0 && (
                <p className="text-sm text-muted-foreground">No additional costs added.</p>
              )}
              {field.state.value.map((_, i) => (
                <div key={i} className="flex items-end gap-2">
                  <form.Field name={`additionalCosts[${i}].description`}>
                    {(subField) => (
                      <div className="flex-1 space-y-1">
                        <Label className="text-xs font-normal">Description</Label>
                        <Input value={subField.state.value} onChange={(e) => subField.handleChange(e.target.value)} placeholder="e.g. Registration fee" className="text-sm" />
                      </div>
                    )}
                  </form.Field>
                  <form.Field name={`additionalCosts[${i}].amount`}>
                    {(subField) => (
                      <div className="w-32 space-y-1">
                        <Label className="text-xs font-normal">Amount (LKR)</Label>
                        <Input value={subField.state.value} onChange={(e) => subField.handleChange(e.target.value)} placeholder="e.g. 5000" className="text-sm" type="text" inputMode="numeric" />
                      </div>
                    )}
                  </form.Field>
                  <Button type="button" variant="ghost" size="icon" className="mb-0.5 text-destructive hover:text-destructive" onClick={() => field.removeValue(i)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </form.Field>

      {/* Notes */}
      <Card>
        <CardHeader>
          <CardTitle className="text-xl font-semibold">Notes</CardTitle>
        </CardHeader>
        <CardContent>
          <form.Field name="internalNotes">
            {(field) => (
              <div className="space-y-1">
                <Label htmlFor={field.name} className="text-xs font-normal">Internal Notes</Label>
                <Textarea id={field.name} value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} placeholder="Any internal notes about this purchase..." className="text-sm" rows={3} />
              </div>
            )}
          </form.Field>
        </CardContent>
      </Card>

      <Separator />

      <div className="flex justify-end">
        <Button type="submit" disabled={isPending} className="min-w-[140px]">
          {isPending ? "Recording..." : "Record Purchase"}
        </Button>
      </div>
    </form>
  )
}
