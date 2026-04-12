"use client"

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { Search, ArrowRight } from "lucide-react"

import type { ComparisonResult } from "@/app/api/lease-comparison/route"
import { CurrencyDisplay } from "@/components/shared/currency-display"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"

// ── Types ─────────────────────────────────────────────────────────────────────

interface ComparisonParams {
  vehicleModel: string
  year: string
  loanAmount: string
  period: string
}

interface ProceedState {
  result: ComparisonResult
  documentFees: string
  governmentFees: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const YEAR_OPTIONS = ["2018", "2019", "2020", "2021", "2022", "2023", "2024"]
const PERIOD_OPTIONS = [
  { value: "12", label: "12 months" },
  { value: "24", label: "24 months" },
  { value: "36", label: "36 months" },
  { value: "48", label: "48 months" },
  { value: "60", label: "60 months" },
]

// ── Proceed panel ─────────────────────────────────────────────────────────────

function ProceedPanel({
  state,
  onBack,
}: {
  state: ProceedState
  onBack: () => void
}) {
  const [docFees, setDocFees] = React.useState(state.documentFees)
  const [govFees, setGovFees] = React.useState(state.governmentFees)

  const docFeesInt = parseInt(docFees.replace(/,/g, ""), 10) || 0
  const govFeesInt = parseInt(govFees.replace(/,/g, ""), 10) || 0
  const totalWithCharges = state.result.totalCost + docFeesInt + govFeesInt

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          ← Back to comparison
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-xl font-semibold">
            Proceed with {state.result.financeCompanyName}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-2 gap-4 rounded-md bg-muted/50 p-4">
            <div>
              <p className="text-xs text-muted-foreground">Loan Amount</p>
              <p className="text-sm font-semibold"><CurrencyDisplay amount={state.result.loanAmount} /></p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Monthly Installment</p>
              <p className="text-sm font-semibold"><CurrencyDisplay amount={state.result.installment} /></p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Period</p>
              <p className="text-sm font-semibold">{state.result.period} months</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Cost</p>
              <p className="text-sm font-semibold"><CurrencyDisplay amount={state.result.totalCost} /></p>
            </div>
          </div>

          <Separator />

          <div className="space-y-4">
            <p className="text-sm font-semibold">Additional Charges</p>
            <div className="space-y-2">
              <Label htmlFor="documentFees">Document Fees (LKR)</Label>
              <Input
                id="documentFees"
                value={docFees}
                onChange={(e) => setDocFees(e.target.value)}
                placeholder="e.g. 25000"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="governmentFees">Government Fees (LKR)</Label>
              <Input
                id="governmentFees"
                value={govFees}
                onChange={(e) => setGovFees(e.target.value)}
                placeholder="e.g. 15000"
              />
            </div>
          </div>

          <Separator />

          <div className="flex items-center justify-between rounded-md bg-muted/50 p-4">
            <span className="text-sm font-semibold">Total with Charges</span>
            <CurrencyDisplay amount={totalWithCharges} className="text-lg font-semibold" />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function LeaseComparisonView() {
  const [searchParams, setSearchParams] = React.useState<ComparisonParams>({
    vehicleModel: "",
    year: "",
    loanAmount: "",
    period: "",
  })
  const [activeParams, setActiveParams] = React.useState<Partial<ComparisonParams>>({})
  const [proceedState, setProceedState] = React.useState<ProceedState | null>(null)

  const queryParams = new URLSearchParams()
  if (activeParams.vehicleModel) queryParams.set("vehicleModel", activeParams.vehicleModel)
  if (activeParams.year) queryParams.set("year", activeParams.year)
  if (activeParams.loanAmount) queryParams.set("loanAmount", activeParams.loanAmount)
  if (activeParams.period) queryParams.set("period", activeParams.period)

  const { data: results, isLoading, isFetching } = useQuery<ComparisonResult[]>({
    queryKey: ["lease-comparison", activeParams],
    queryFn: async () => {
      const url = `/api/lease-comparison${queryParams.toString() ? `?${queryParams.toString()}` : ""}`
      const res = await fetch(url)
      if (!res.ok) throw new Error("Failed to fetch comparison data")
      return res.json() as Promise<ComparisonResult[]>
    },
    enabled: Object.values(activeParams).some(Boolean),
    staleTime: 30_000,
  })

  function handleCompare() {
    setActiveParams({ ...searchParams })
    setProceedState(null)
  }

  if (proceedState) {
    return (
      <ProceedPanel
        state={proceedState}
        onBack={() => setProceedState(null)}
      />
    )
  }

  return (
    <div className="space-y-6">
      {/* Input section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-xl font-semibold">Compare Finance Companies</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="vehicleModel">Vehicle Model</Label>
              <Input
                id="vehicleModel"
                value={searchParams.vehicleModel}
                onChange={(e) => setSearchParams((p) => ({ ...p, vehicleModel: e.target.value }))}
                placeholder="e.g. Toyota Aqua"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="year">Year</Label>
              <Select
                value={searchParams.year}
                onValueChange={(v) => setSearchParams((p) => ({ ...p, year: v }))}
              >
                <SelectTrigger id="year">
                  <SelectValue placeholder="Select year" />
                </SelectTrigger>
                <SelectContent>
                  {YEAR_OPTIONS.map((y) => (
                    <SelectItem key={y} value={y}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="loanAmount">Loan Amount (LKR)</Label>
              <Input
                id="loanAmount"
                value={searchParams.loanAmount}
                onChange={(e) => setSearchParams((p) => ({ ...p, loanAmount: e.target.value }))}
                placeholder="e.g. 30000000"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="period">Period (months)</Label>
              <Select
                value={searchParams.period}
                onValueChange={(v) => setSearchParams((p) => ({ ...p, period: v }))}
              >
                <SelectTrigger id="period">
                  <SelectValue placeholder="Select period" />
                </SelectTrigger>
                <SelectContent>
                  {PERIOD_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <Button onClick={handleCompare} disabled={isFetching}>
              <Search className="h-4 w-4 mr-1" aria-hidden="true" />
              {isFetching ? "Comparing..." : "Compare"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Results section */}
      {isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-48 w-full rounded-lg" />
          ))}
        </div>
      )}

      {!isLoading && results && results.length === 0 && (
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-sm text-muted-foreground">
              No matching rate sheets found. Try different search parameters.
            </p>
          </CardContent>
        </Card>
      )}

      {!isLoading && results && results.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            {results.length} finance {results.length === 1 ? "company" : "companies"} found
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {results.map((result) => (
              <Card key={result.financeCompanyId} className="flex flex-col">
                <CardHeader>
                  <CardTitle className="text-base font-semibold">
                    {result.financeCompanyName}
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col flex-1 gap-4">
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Max Loan Amount</span>
                      <CurrencyDisplay amount={result.maxLoanAmount} />
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Loan Amount</span>
                      <CurrencyDisplay amount={result.loanAmount} />
                    </div>
                    <Separator />
                    <div className="flex justify-between text-sm font-semibold">
                      <span>Monthly Installment</span>
                      <CurrencyDisplay amount={result.installment} />
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Period</span>
                      <span>{result.period} months</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Total Cost</span>
                      <CurrencyDisplay amount={result.totalCost} />
                    </div>
                  </div>
                  <div className="mt-auto">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() =>
                        setProceedState({ result, documentFees: "", governmentFees: "" })
                      }
                    >
                      Proceed
                      <ArrowRight className="h-4 w-4 ml-1" aria-hidden="true" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
