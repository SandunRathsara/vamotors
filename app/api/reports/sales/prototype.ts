import { NextRequest, NextResponse } from "next/server"
import { injectLatency } from "@/lib/utils"
import { getSalesReport } from "@/lib/mock-data/reports"

export async function GET(request: NextRequest) {
  await injectLatency()

  const { searchParams } = request.nextUrl
  const page = parseInt(searchParams.get("page") ?? "1", 10)
  const pageSize = parseInt(searchParams.get("pageSize") ?? "20", 10)
  const sortBy = searchParams.get("sortBy") ?? undefined
  const sortDir = (searchParams.get("sortDir") ?? "asc") as "asc" | "desc"
  const dateFrom = searchParams.get("dateFrom") ?? undefined
  const dateTo = searchParams.get("dateTo") ?? undefined

  let rows = getSalesReport(dateFrom, dateTo)

  if (sortBy) {
    rows = [...rows].sort((a, b) => {
      let aVal: unknown
      let bVal: unknown
      if (sortBy === "sale.date") {
        aVal = a.sale.date
        bVal = b.sale.date
      } else if (sortBy === "sale.salePrice") {
        aVal = a.sale.salePrice
        bVal = b.sale.salePrice
      } else if (sortBy === "sale.profitLoss") {
        aVal = a.sale.profitLoss ?? 0
        bVal = b.sale.profitLoss ?? 0
      } else {
        aVal = a.vehicle ? a.vehicle.make + " " + a.vehicle.model : ""
        bVal = b.vehicle ? b.vehicle.make + " " + b.vehicle.model : ""
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
