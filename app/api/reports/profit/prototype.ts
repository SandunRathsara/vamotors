import { NextRequest, NextResponse } from "next/server"
import { injectLatency } from "@/lib/utils"
import { getProfitLossReport } from "@/lib/mock-data/reports"
import { repairsFixtures } from "@/lib/mock-data/repairs"

export async function GET(request: NextRequest) {
  await injectLatency()

  const { searchParams } = request.nextUrl
  const page = parseInt(searchParams.get("page") ?? "1", 10)
  const pageSize = parseInt(searchParams.get("pageSize") ?? "20", 10)
  const sortBy = searchParams.get("sortBy") ?? undefined
  const sortDir = (searchParams.get("sortDir") ?? "desc") as "asc" | "desc"
  const dateFrom = searchParams.get("dateFrom") ?? undefined
  const dateTo = searchParams.get("dateTo") ?? undefined

  type ProfitRow = {
    id: string
    vehicleName: string
    purchasePrice: number
    additionalCosts: number
    repairCosts: number
    totalCost: number
    salePrice: number
    profitLoss: number
    margin: number
  }

  let rows: ProfitRow[] = getProfitLossReport(dateFrom, dateTo).map(({ sale, vehicle, costBasis, salePrice, profitLoss }) => {
    const repairCosts = vehicle
      ? repairsFixtures
          .filter((r) => r.vehicleId === vehicle.id && r.status === "Completed")
          .reduce((sum, r) => sum + (r.invoiceAmount ?? 0), 0)
      : 0
    const additionalCosts = vehicle
      ? vehicle.additionalCosts.reduce((sum, c) => sum + c.amount, 0)
      : 0
    const purchasePrice = vehicle?.purchasePrice ?? 0
    const margin = salePrice > 0 ? (profitLoss / salePrice) * 100 : 0
    return {
      id: sale.id,
      vehicleName: vehicle ? `${vehicle.make} ${vehicle.model} ${vehicle.year}` : sale.vehicleId,
      purchasePrice,
      additionalCosts,
      repairCosts,
      totalCost: costBasis,
      salePrice,
      profitLoss,
      margin: Math.round(margin * 100) / 100,
    }
  })

  if (sortBy) {
    rows = [...rows].sort((a, b) => {
      const aVal = (a as Record<string, unknown>)[sortBy]
      const bVal = (b as Record<string, unknown>)[sortBy]
      const cmp =
        typeof aVal === "number" && typeof bVal === "number"
          ? aVal - bVal
          : String(aVal ?? "").localeCompare(String(bVal ?? ""))
      return sortDir === "desc" ? -cmp : cmp
    })
  } else {
    rows = [...rows].sort((a, b) => b.profitLoss - a.profitLoss)
  }

  const total = rows.length
  const start = (page - 1) * pageSize
  const data = rows.slice(start, start + pageSize)

  return NextResponse.json({ data, total, page, pageSize })
}
