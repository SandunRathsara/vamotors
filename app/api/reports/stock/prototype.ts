import { NextRequest, NextResponse } from "next/server"
import { injectLatency } from "@/lib/utils"
import { getStockReport } from "@/lib/mock-data/reports"

export async function GET(request: NextRequest) {
  await injectLatency()

  const { searchParams } = request.nextUrl
  const page = parseInt(searchParams.get("page") ?? "1", 10)
  const pageSize = parseInt(searchParams.get("pageSize") ?? "20", 10)
  const sortBy = searchParams.get("sortBy") ?? undefined
  const sortDir = (searchParams.get("sortDir") ?? "asc") as "asc" | "desc"

  let rows = getStockReport()

  // Sort
  if (sortBy) {
    rows = [...rows].sort((a, b) => {
      let aVal: unknown
      let bVal: unknown
      if (sortBy === "daysSincePurchase") {
        aVal = a.daysSincePurchase
        bVal = b.daysSincePurchase
      } else if (sortBy === "vehicle.listedPrice") {
        aVal = a.vehicle.listedPrice
        bVal = b.vehicle.listedPrice
      } else if (sortBy === "vehicle.purchaseDate") {
        aVal = a.vehicle.purchaseDate
        bVal = b.vehicle.purchaseDate
      } else {
        aVal = String(a.vehicle.make + " " + a.vehicle.model)
        bVal = String(b.vehicle.make + " " + b.vehicle.model)
      }
      const cmp =
        typeof aVal === "number" && typeof bVal === "number"
          ? aVal - bVal
          : String(aVal ?? "").localeCompare(String(bVal ?? ""))
      return sortDir === "desc" ? -cmp : cmp
    })
  }

  const total = rows.length
  const start = (page - 1) * pageSize
  const data = rows.slice(start, start + pageSize)

  return NextResponse.json({ data, total, page, pageSize })
}
