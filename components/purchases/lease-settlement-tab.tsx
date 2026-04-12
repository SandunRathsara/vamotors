"use client"

import * as React from "react"
import { useForm } from "@tanstack/react-form"
import { format } from "date-fns"
import { CalendarIcon } from "lucide-react"

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

interface LeaseSettlementFormValues {
  make: string
  model: string
  year: string
  colour: string
  engineNumber: string
  chassisNumber: string
  vin: string
  crNumber: string
  fuelType: string
  transmission: string
  purchaseDate: string
  purchasePrice: string
  mileageAtPurchase: string
  listedPrice: string
  institutionType: string
  institutionName: string
  settlementReference: string
  settlementAmount: string
  cashToSeller: string
  internalNotes: string
}

export function LeaseSettlementTab() {
  const { mutate, isPending } = useEntityMutation({
    entityKey: "vehicles",
    endpoint: "/api/purchases",
    method: "POST",
    successMessage: "Purchase recorded. Vehicle added to inventory.",
  })

  const EMPTY_VALUES: LeaseSettlementFormValues = {
    make: "",
    model: "",
    year: "",
    colour: "",
    engineNumber: "",
    chassisNumber: "",
    vin: "",
    crNumber: "",
    fuelType: "",
    transmission: "",
    purchaseDate: "",
    purchasePrice: "",
    mileageAtPurchase: "",
    listedPrice: "",
    institutionType: "",
    institutionName: "",
    settlementReference: "",
    settlementAmount: "",
    cashToSeller: "",
    internalNotes: "",
  }

  const form = useForm({
    defaultValues: EMPTY_VALUES,
    onSubmit: async ({ value }) => {
      mutate({
        make: value.make,
        model: value.model,
        year: parseInt(value.year, 10),
        colour: value.colour,
        engineNumber: value.engineNumber,
        chassisNumber: value.chassisNumber,
        vin: value.vin || undefined,
        crNumber: value.crNumber || undefined,
        fuelType: value.fuelType,
        transmission: value.transmission,
        purchaseType: "LeaseSettlement",
        supplierId: "",
        purchaseDate: value.purchaseDate,
        purchasePrice: Math.round(parseFloat(value.purchasePrice) * 100),
        listedPrice: Math.round(parseFloat(value.listedPrice) * 100),
        mileageAtPurchase: parseInt(value.mileageAtPurchase, 10),
        institutionType: value.institutionType,
        institutionName: value.institutionName,
        settlementReference: value.settlementReference,
        settlementAmount: Math.round(parseFloat(value.settlementAmount) * 100),
        cashToSeller: Math.round(parseFloat(value.cashToSeller) * 100),
        additionalCosts: [],
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
      {/* Vehicle Details */}
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

          <form.Field name="vin">
            {(field) => (
              <div className="space-y-1">
                <Label htmlFor={field.name} className="text-xs font-normal">VIN <span className="text-muted-foreground">(optional)</span></Label>
                <Input id={field.name} value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} className="text-sm" />
              </div>
            )}
          </form.Field>

          <form.Field name="crNumber">
            {(field) => (
              <div className="space-y-1">
                <Label htmlFor={field.name} className="text-xs font-normal">CR Number <span className="text-muted-foreground">(optional)</span></Label>
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
                <Input id={field.name} value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} placeholder="e.g. 62000" className="text-sm" type="number" />
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

      {/* Settlement Details */}
      <Card>
        <CardHeader>
          <CardTitle className="text-xl font-semibold">Settlement Details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <form.Field name="institutionType">
            {(field) => (
              <div className="space-y-1">
                <Label htmlFor={field.name} className="text-xs font-normal">Institution Type</Label>
                <Select value={field.state.value} onValueChange={field.handleChange}>
                  <SelectTrigger id={field.name} className="text-sm"><SelectValue placeholder="Select type" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FinanceCompany">Finance Company</SelectItem>
                    <SelectItem value="Bank">Bank</SelectItem>
                    <SelectItem value="PrivateParty">Private Party</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </form.Field>

          <form.Field name="institutionName">
            {(field) => (
              <div className="space-y-1">
                <Label htmlFor={field.name} className="text-xs font-normal">Institution Name</Label>
                <Input id={field.name} value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} placeholder="e.g. People's Bank" className="text-sm" />
              </div>
            )}
          </form.Field>

          <form.Field name="settlementReference">
            {(field) => (
              <div className="space-y-1">
                <Label htmlFor={field.name} className="text-xs font-normal">Settlement Reference</Label>
                <Input id={field.name} value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} placeholder="Reference number" className="text-sm" />
              </div>
            )}
          </form.Field>

          <form.Field name="settlementAmount">
            {(field) => (
              <div className="space-y-1">
                <Label htmlFor={field.name} className="text-xs font-normal">Settlement Amount (LKR)</Label>
                <Input id={field.name} value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} placeholder="e.g. 1500000" className="text-sm" type="text" inputMode="numeric" />
              </div>
            )}
          </form.Field>

          <form.Field name="cashToSeller">
            {(field) => (
              <div className="space-y-1">
                <Label htmlFor={field.name} className="text-xs font-normal">Cash to Seller (LKR)</Label>
                <Input id={field.name} value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} placeholder="e.g. 500000" className="text-sm" type="text" inputMode="numeric" />
              </div>
            )}
          </form.Field>
        </CardContent>
      </Card>

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
