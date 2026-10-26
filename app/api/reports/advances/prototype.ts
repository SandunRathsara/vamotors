import { NextRequest, NextResponse } from "next/server"
import { injectLatency } from "@/lib/utils"
import { salesFixtures } from "@/lib/mock-data/sales"
import { vehicleFixtures } from "@/lib/mock-data/vehicles"
import { customerFixtures } from "@/lib/mock-data/customers"

export async function GET(request: NextRequest) {
  await injectLatency()

  const { searchParams } = request.nextUrl
  const page = parseInt(searchParams.get("page") ?? "1", 10)
  const pageSize = parseInt(searchParams.get("pageSize") ?? "20", 10)
  const sortBy = searchParams.get("sortBy") ?? undefined
  const sortDir = (searchParams.get("sortDir") ?? "desc") as "asc" | "desc"
  const dateFrom = searchParams.get("dateFrom") ?? undefined
  const dateTo = searchParams.get("dateTo") ?? undefined

  type AdvanceRow = {
    id: string
    vehicleName: string
    customerName: string
    advanceAmount: number
    advancePercentage: number | undefined
    placedDate: string
    expiryDate: string | undefined
    status: string
    resolution: string
  }

  let rows: AdvanceRow[] = salesFixtures
    .filter((s) => s.saleType === "Advance")
    .map((s) => {
      const vehicle = vehicleFixtures.find((v) => v.id === s.vehicleId)
      const customer = customerFixtures.find((c) => c.id === s.customerId)
      return {
        id: s.id,
        vehicleName: vehicle ? `${vehicle.make} ${vehicle.model} ${vehicle.year}` : s.vehicleId,
        customerName: customer?.fullName ?? s.customerId,
        advanceAmount: s.advanceAmount ?? 0,
        advancePercentage: s.advancePercentage,
        placedDate: s.date,
        expiryDate: s.advanceExpiryDate,
        status: s.status,
        resolution: s.status === "Completed" ? "Converted to Sale" : s.status === "Cancelled" ? "Cancelled" : "Active",
      }
    })

  if (dateFrom) rows = rows.filter((r) => r.placedDate >= dateFrom)
  if (dateTo) rows = rows.filter((r) => r.placedDate <= dateTo)

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
    rows = [...rows].sort((a, b) => b.placedDate.localeCompare(a.placedDate))
  }

  const total = rows.length
  const start = (page - 1) * pageSize
  const data = rows.slice(start, start + pageSize)

  return NextResponse.json({ data, total, page, pageSize })
}
