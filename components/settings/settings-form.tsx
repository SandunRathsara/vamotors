"use client"

import * as React from "react"
import { toast } from "sonner"

import type { Settings } from "@/lib/mock-data/schemas"
import { useEntityQuery } from "@/hooks/use-entity-query"
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
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card"
import { AdvanceTiersTable, type AdvanceTier } from "./advance-tiers-table"

// ── Component ─────────────────────────────────────────────────────────────────

export function SettingsForm() {
  // useEntityQuery with a stable params object hits GET /api/settings
  const { data: settings, isLoading } = useEntityQuery<Settings>(
    "settings",
    "/api/settings",
    {},
  )

  // Local form state
  const [companyName, setCompanyName] = React.useState("")
  const [companyPhone, setCompanyPhone] = React.useState("")
  const [companyAddress, setCompanyAddress] = React.useState("")
  const [companyEmail, setCompanyEmail] = React.useState("")
  const [currencyCode, setCurrencyCode] = React.useState("")
  const [currencySymbol, setCurrencySymbol] = React.useState("")
  const [currencyDecimalPlaces, setCurrencyDecimalPlaces] = React.useState("2")
  const [currencyFormat, setCurrencyFormat] = React.useState("symbol-space-amount")
  const [advanceTiers, setAdvanceTiers] = React.useState<AdvanceTier[]>([])
  const [defaultTheme, setDefaultTheme] = React.useState("System")
  const [itemsPerPage, setItemsPerPage] = React.useState("20")
  const [dateFormat, setDateFormat] = React.useState("dd/MM/yyyy")

  // Populate from API once loaded
  const hydrated = React.useRef(false)
  React.useEffect(() => {
    if (settings && !hydrated.current) {
      hydrated.current = true
      setCompanyName(settings.companyName)
      setCompanyPhone(settings.companyPhone)
      setCompanyAddress(settings.companyAddress)
      setCompanyEmail(settings.companyEmail)
      setCurrencyCode(settings.currencyCode)
      setCurrencySymbol(settings.currencySymbol)
      setCurrencyDecimalPlaces(String(settings.currencyDecimalPlaces))
      setCurrencyFormat(settings.currencyFormat)
      setAdvanceTiers(settings.advancePaymentTiers)
      setDefaultTheme(settings.defaultTheme)
      setItemsPerPage(String(settings.itemsPerPage))
      setDateFormat(settings.dateFormat)
    }
  }, [settings])

  const { mutate, isPending } = useEntityMutation<Settings, Partial<Settings>>({
    entityKey: "settings",
    endpoint: "/api/settings",
    method: "PATCH",
    successMessage: "Settings saved.",
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    mutate({
      companyName,
      companyPhone,
      companyAddress,
      companyEmail,
      currencyCode,
      currencySymbol,
      currencyDecimalPlaces: parseInt(currencyDecimalPlaces, 10),
      currencyFormat: currencyFormat as Settings["currencyFormat"],
      advancePaymentTiers: advanceTiers,
      defaultTheme: defaultTheme as Settings["defaultTheme"],
      itemsPerPage: parseInt(itemsPerPage, 10),
      dateFormat,
    })
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-40 rounded-lg border bg-card animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* ── Company Profile ──────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-xl font-semibold">Company Profile</CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            Basic information about your dealership
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="company-name" className="text-xs">Company Name</Label>
            <Input
              id="company-name"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="company-phone" className="text-xs">Phone</Label>
            <Input
              id="company-phone"
              type="tel"
              value={companyPhone}
              onChange={(e) => setCompanyPhone(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="company-email" className="text-xs">Email</Label>
            <Input
              id="company-email"
              type="email"
              value={companyEmail}
              onChange={(e) => setCompanyEmail(e.target.value)}
            />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="company-address" className="text-xs">Address</Label>
            <Textarea
              id="company-address"
              value={companyAddress}
              onChange={(e) => setCompanyAddress(e.target.value)}
              rows={2}
            />
          </div>
        </CardContent>
      </Card>

      {/* ── Currency Configuration ───────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-xl font-semibold">Currency Configuration</CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            How monetary values are displayed across the system
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="currency-code" className="text-xs">Currency Code</Label>
            <Input
              id="currency-code"
              value={currencyCode}
              onChange={(e) => setCurrencyCode(e.target.value)}
              placeholder="LKR"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="currency-symbol" className="text-xs">Currency Symbol</Label>
            <Input
              id="currency-symbol"
              value={currencySymbol}
              onChange={(e) => setCurrencySymbol(e.target.value)}
              placeholder="Rs."
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="decimal-places" className="text-xs">Decimal Places</Label>
            <Select value={currencyDecimalPlaces} onValueChange={setCurrencyDecimalPlaces}>
              <SelectTrigger id="decimal-places">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">0</SelectItem>
                <SelectItem value="1">1</SelectItem>
                <SelectItem value="2">2</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="currency-format" className="text-xs">Format</Label>
            <Select value={currencyFormat} onValueChange={setCurrencyFormat}>
              <SelectTrigger id="currency-format">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="symbol-space-amount">Symbol space amount (Rs. 1,000)</SelectItem>
                <SelectItem value="symbol-amount">Symbol amount (Rs.1,000)</SelectItem>
                <SelectItem value="amount-space-symbol">Amount space symbol (1,000 Rs.)</SelectItem>
                <SelectItem value="amount-symbol">Amount symbol (1,000Rs.)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* ── Advance Payment Tiers ─────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-xl font-semibold">Advance Payment Tiers</CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            Validity periods based on advance percentage paid
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AdvanceTiersTable tiers={advanceTiers} onChange={setAdvanceTiers} />
        </CardContent>
      </Card>

      {/* ── System Preferences ───────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-xl font-semibold">System Preferences</CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            Display and interface preferences
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="default-theme" className="text-xs">Default Theme</Label>
            <Select value={defaultTheme} onValueChange={setDefaultTheme}>
              <SelectTrigger id="default-theme">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="System">System</SelectItem>
                <SelectItem value="Light">Light</SelectItem>
                <SelectItem value="Dark">Dark</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="items-per-page" className="text-xs">Items Per Page</Label>
            <Select value={itemsPerPage} onValueChange={setItemsPerPage}>
              <SelectTrigger id="items-per-page">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10">10</SelectItem>
                <SelectItem value="20">20</SelectItem>
                <SelectItem value="50">50</SelectItem>
                <SelectItem value="100">100</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="date-format" className="text-xs">Date Format</Label>
            <Select value={dateFormat} onValueChange={setDateFormat}>
              <SelectTrigger id="date-format">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="dd/MM/yyyy">dd/MM/yyyy</SelectItem>
                <SelectItem value="MM/dd/yyyy">MM/dd/yyyy</SelectItem>
                <SelectItem value="yyyy-MM-dd">yyyy-MM-dd</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* ── Save ─────────────────────────────────────────────────── */}
      <div className="flex justify-end">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving..." : "Save Changes"}
        </Button>
      </div>
    </form>
  )
}
