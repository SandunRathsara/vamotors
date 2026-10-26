import { NextRequest, NextResponse } from "next/server"
import { cashFlowStore } from "@/lib/mock-store"
import { injectLatency } from "@/lib/utils"

export async function GET(request: NextRequest) {
  await injectLatency()

  const { searchParams } = request.nextUrl
  const page = parseInt(searchParams.get("page") ?? "1", 10)
  const pageSize = parseInt(searchParams.get("pageSize") ?? "20", 10)
  const sortBy = searchParams.get("sortBy") ?? undefined
  const sortDir = (searchParams.get("sortDir") ?? "desc") as "asc" | "desc"
  const type = searchParams.get("type") ?? undefined
  const dateFrom = searchParams.get("dateFrom") ?? undefined
  const dateTo = searchParams.get("dateTo") ?? undefined

  const filters: Record<string, string> = {}
  if (type) filters.type = type

  let result = cashFlowStore.query({ page: 1, pageSize: 99999, sortBy, sortDir, filters })
  let entries = result.data

  if (dateFrom) entries = entries.filter((e) => e.date >= dateFrom)
  if (dateTo) entries = entries.filter((e) => e.date <= dateTo)

  // Compute summary from filtered entries
  const totalInflow = entries.filter((e) => e.amount > 0).reduce((sum, e) => sum + e.amount, 0)
  const totalOutflow = entries.filter((e) => e.amount < 0).reduce((sum, e) => sum + e.amount, 0)
  const netPosition = totalInflow + totalOutflow

  // Paginate after filtering
  const total = entries.length
  const start = (page - 1) * pageSize
  const data = entries.slice(start, start + pageSize)

  return NextResponse.json({
    data,
    total,
    page,
    pageSize,
    summary: { totalInflow, totalOutflow, netPosition },
  })
}
