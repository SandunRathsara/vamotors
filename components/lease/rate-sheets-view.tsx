"use client"

import * as React from "react"
import { useQuery } from "@tanstack/react-query"

import type { LeaseRateSheet } from "@/lib/mock-data/schemas"
import { CurrencyDisplay } from "@/components/shared/currency-display"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { leaseRateSheetsFixtures } from "@/lib/mock-data/lease-rate-sheets"

// ── Finance company options from fixtures ─────────────────────────────────────

const FINANCE_COMPANIES = Array.from(
  new Map(
    leaseRateSheetsFixtures.map((s) => [s.financeCompanyId, s.financeCompanyName])
  ).entries()
).map(([id, name]) => ({ id, name }))

// ── Constants ─────────────────────────────────────────────────────────────────

const YEAR_COLUMNS = [2018, 2019, 2020, 2021, 2022, 2023, 2024]
const PERIOD_COLUMNS = [12, 24, 36, 48, 60]

// ── Model x Year table ────────────────────────────────────────────────────────

function ModelYearTable({ sheets }: { sheets: LeaseRateSheet[] }) {
  // Group by vehicleModel, for each model collect max loan per year
  const modelYearMap = new Map<string, Map<number, number>>()

  for (const sheet of sheets) {
    if (!modelYearMap.has(sheet.vehicleModel)) {
      modelYearMap.set(sheet.vehicleModel, new Map())
    }
    const yearMap = modelYearMap.get(sheet.vehicleModel)!
    yearMap.set(sheet.manufactureYear, sheet.maxLoanAmount)
  }

  const models = Array.from(modelYearMap.keys()).sort()
  const years = YEAR_COLUMNS.filter((y) =>
    Array.from(modelYearMap.values()).some((m) => m.has(y))
  )

  if (models.length === 0) {
    return <p className="text-sm text-muted-foreground">No rate sheet data available.</p>
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs font-normal">Vehicle Model</TableHead>
            {years.map((y) => (
              <TableHead key={y} className="text-xs font-normal text-right">{y}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {models.map((model) => (
            <TableRow key={model}>
              <TableCell className="text-sm font-normal">{model}</TableCell>
              {years.map((y) => {
                const amount = modelYearMap.get(model)?.get(y)
                return (
                  <TableCell key={y} className="text-sm text-right tabular-nums">
                    {amount !== undefined ? <CurrencyDisplay amount={amount} /> : <span className="text-muted-foreground/40">—</span>}
                  </TableCell>
                )
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

// ── Loan Amount x Period table ────────────────────────────────────────────────

function LoanPeriodTable({ sheets }: { sheets: LeaseRateSheet[] }) {
  // Collect all loan amounts and build installment map: loanAmount -> period -> installment
  const loanPeriodMap = new Map<number, Map<number, number>>()

  for (const sheet of sheets) {
    for (const card of sheet.rateCards) {
      if (!loanPeriodMap.has(card.loanAmount)) {
        loanPeriodMap.set(card.loanAmount, new Map())
      }
      const periodMap = loanPeriodMap.get(card.loanAmount)!
      for (const p of card.periods) {
        if (!periodMap.has(p.months)) {
          periodMap.set(p.months, p.installment)
        }
      }
    }
  }

  const loanAmounts = Array.from(loanPeriodMap.keys()).sort((a, b) => a - b)
  const periods = PERIOD_COLUMNS.filter((p) =>
    Array.from(loanPeriodMap.values()).some((m) => m.has(p))
  )

  if (loanAmounts.length === 0) {
    return <p className="text-sm text-muted-foreground">No rate card data available.</p>
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs font-normal">Loan Amount</TableHead>
            {periods.map((p) => (
              <TableHead key={p} className="text-xs font-normal text-right">{p} mo.</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {loanAmounts.map((amount) => (
            <TableRow key={amount}>
              <TableCell className="text-sm tabular-nums">
                <CurrencyDisplay amount={amount} />
              </TableCell>
              {periods.map((p) => {
                const installment = loanPeriodMap.get(amount)?.get(p)
                return (
                  <TableCell key={p} className="text-sm text-right tabular-nums">
                    {installment !== undefined ? <CurrencyDisplay amount={installment} /> : <span className="text-muted-foreground/40">—</span>}
                  </TableCell>
                )
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function RateSheetsView() {
  const [selectedCompany, setSelectedCompany] = React.useState<string>("all")

  const { data: sheets, isLoading } = useQuery<LeaseRateSheet[]>({
    queryKey: ["lease-rate-sheets", selectedCompany],
    queryFn: async () => {
      const url =
        selectedCompany !== "all"
          ? `/api/lease-rate-sheets?financeCompanyId=${encodeURIComponent(selectedCompany)}`
          : "/api/lease-rate-sheets"
      const res = await fetch(url)
      if (!res.ok) throw new Error("Failed to fetch rate sheets")
      return res.json() as Promise<LeaseRateSheet[]>
    },
    staleTime: 30_000,
  })

  return (
    <div className="space-y-6">
      {/* Finance company filter */}
      <div className="flex items-center gap-3">
        <Label htmlFor="companyFilter" className="text-sm font-normal shrink-0">
          Finance Company
        </Label>
        <Select value={selectedCompany} onValueChange={setSelectedCompany}>
          <SelectTrigger id="companyFilter" className="w-64">
            <SelectValue placeholder="All companies" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All companies</SelectItem>
            {FINANCE_COMPANIES.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-48 w-full rounded-lg" />
          <Skeleton className="h-48 w-full rounded-lg" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Table 1: Vehicle Model x Year */}
          <Card>
            <CardHeader>
              <CardTitle className="text-xl font-semibold">Vehicle Model × Year — Max Loan Amount</CardTitle>
            </CardHeader>
            <CardContent>
              <ModelYearTable sheets={sheets ?? []} />
            </CardContent>
          </Card>

          {/* Table 2: Loan Amount x Period */}
          <Card>
            <CardHeader>
              <CardTitle className="text-xl font-semibold">Loan Amount × Period — Monthly Installment</CardTitle>
            </CardHeader>
            <CardContent>
              <LoanPeriodTable sheets={sheets ?? []} />
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
