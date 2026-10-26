import { NextRequest, NextResponse } from "next/server"
import { injectLatency } from "@/lib/utils"
import { vehicleFixtures } from "@/lib/mock-data/vehicles"
import { thirdPartiesFixtures } from "@/lib/mock-data/third-parties"

export async function GET(request: NextRequest) {
  await injectLatency()

  const { searchParams } = request.nextUrl
  const page = parseInt(searchParams.get("page") ?? "1", 10)
  const pageSize = parseInt(searchParams.get("pageSize") ?? "20", 10)
  const sortBy = searchParams.get("sortBy") ?? undefined
  const sortDir = (searchParams.get("sortDir") ?? "desc") as "asc" | "desc"
  const dateFrom = searchParams.get("dateFrom") ?? undefined
  const dateTo = searchParams.get("dateTo") ?? undefined

  type PurchaseRow = {
    id: string
    date: string
    make: string
    model: string
    year: number
    purchaseType: string
    supplierId: string
    supplierName: string
    purchasePrice: number
    additionalCostsTotal: number
    totalCost: number
  }

  let rows: PurchaseRow[] = vehicleFixtures.map((v) => {
    const supplier = thirdPartiesFixtures.find((t) => t.id === v.supplierId)
    const additionalCostsTotal = v.additionalCosts.reduce((sum, c) => sum + c.amount, 0)
    return {
      id: v.id,
      date: v.purchaseDate,
      make: v.make,
      model: v.model,
      year: v.year,
      purchaseType: v.purchaseType,
      supplierId: v.supplierId,
      supplierName: supplier?.name ?? "Unknown",
      purchasePrice: v.purchasePrice,
      additionalCostsTotal,
      totalCost: v.purchasePrice + additionalCostsTotal,
    }
  })

  if (dateFrom) rows = rows.filter((r) => r.date >= dateFrom)
  if (dateTo) rows = rows.filter((r) => r.date <= dateTo)

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
    rows = [...rows].sort((a, b) => b.date.localeCompare(a.date))
  }

  const total = rows.length
  const start = (page - 1) * pageSize
  const data = rows.slice(start, start + pageSize)

  return NextResponse.json({ data, total, page, pageSize })
}
