import { NextRequest, NextResponse } from "next/server"
import { injectLatency } from "@/lib/utils"
import { activityFixtures } from "@/lib/mock-data/activity"

export async function GET(request: NextRequest) {
  await injectLatency()

  const { searchParams } = request.nextUrl
  const page = parseInt(searchParams.get("page") ?? "1", 10)
  const pageSize = parseInt(searchParams.get("pageSize") ?? "20", 10)
  const sortBy = searchParams.get("sortBy") ?? undefined
  const sortDir = (searchParams.get("sortDir") ?? "desc") as "asc" | "desc"
  const dateFrom = searchParams.get("dateFrom") ?? undefined
  const dateTo = searchParams.get("dateTo") ?? undefined

  let rows = [...activityFixtures]

  if (dateFrom) rows = rows.filter((r) => r.timestamp >= dateFrom)
  if (dateTo) rows = rows.filter((r) => r.timestamp <= dateTo + "T23:59:59Z")

  if (sortBy) {
    rows = [...rows].sort((a, b) => {
      const aVal = (a as Record<string, unknown>)[sortBy]
      const bVal = (b as Record<string, unknown>)[sortBy]
      const cmp = String(aVal ?? "").localeCompare(String(bVal ?? ""))
      return sortDir === "desc" ? -cmp : cmp
    })
  } else {
    rows = rows.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
  }

  const total = rows.length
  const start = (page - 1) * pageSize
  const data = rows.slice(start, start + pageSize)

  return NextResponse.json({ data, total, page, pageSize })
}
