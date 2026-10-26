import { NextRequest, NextResponse } from "next/server"
import { leaseRateSheetsStore } from "@/lib/mock-store"
import { injectLatency } from "@/lib/utils"

export interface ComparisonResult {
  financeCompanyId: string
  financeCompanyName: string
  vehicleModel: string
  manufactureYear: number
  maxLoanAmount: number
  loanAmount: number
  period: number
  installment: number
  totalCost: number
}

export async function GET(request: NextRequest) {
  await injectLatency()

  const { searchParams } = request.nextUrl
  const vehicleModel = searchParams.get("vehicleModel") ?? undefined
  const year = searchParams.get("year") ? parseInt(searchParams.get("year")!, 10) : undefined
  const loanAmount = searchParams.get("loanAmount") ? parseInt(searchParams.get("loanAmount")!, 10) : undefined
  const period = searchParams.get("period") ? parseInt(searchParams.get("period")!, 10) : undefined

  const allSheets = leaseRateSheetsStore.getAll()

  // Filter by vehicle model and/or year
  let sheets = allSheets
  if (vehicleModel) {
    sheets = sheets.filter((s) =>
      s.vehicleModel.toLowerCase().includes(vehicleModel.toLowerCase())
    )
  }
  if (year !== undefined) {
    sheets = sheets.filter((s) => s.manufactureYear === year)
  }

  // Build comparison results
  const results: ComparisonResult[] = []

  for (const sheet of sheets) {
    // Find matching rate cards
    for (const card of sheet.rateCards) {
      // If loanAmount provided, find closest match
      const targetLoan = loanAmount ?? card.loanAmount
      if (loanAmount && Math.abs(card.loanAmount - loanAmount) > loanAmount * 0.2) continue

      // Find installment for the given period, or first available
      const periodEntry = period
        ? card.periods.find((p) => p.months === period)
        : card.periods[0]

      if (!periodEntry) continue

      results.push({
        financeCompanyId: sheet.financeCompanyId,
        financeCompanyName: sheet.financeCompanyName,
        vehicleModel: sheet.vehicleModel,
        manufactureYear: sheet.manufactureYear,
        maxLoanAmount: sheet.maxLoanAmount,
        loanAmount: card.loanAmount,
        period: periodEntry.months,
        installment: periodEntry.installment,
        totalCost: periodEntry.installment * periodEntry.months,
      })
    }
  }

  // De-duplicate by financeCompanyId — keep the closest loan amount match
  const deduped = new Map<string, ComparisonResult>()
  for (const r of results) {
    const existing = deduped.get(r.financeCompanyId)
    if (!existing) {
      deduped.set(r.financeCompanyId, r)
    } else if (loanAmount) {
      const existingDiff = Math.abs(existing.loanAmount - loanAmount)
      const newDiff = Math.abs(r.loanAmount - loanAmount)
      if (newDiff < existingDiff) deduped.set(r.financeCompanyId, r)
    }
  }

  return NextResponse.json(Array.from(deduped.values()))
}
