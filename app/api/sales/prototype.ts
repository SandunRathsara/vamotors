import { NextRequest, NextResponse } from "next/server"
import { salesStore } from "@/lib/mock-store"
import { injectLatency } from "@/lib/utils"
import type { Sale } from "@/lib/mock-data/schemas"

export async function GET(request: NextRequest) {
  await injectLatency()

  const { searchParams } = request.nextUrl
  const page = parseInt(searchParams.get("page") ?? "1", 10)
  const pageSize = parseInt(searchParams.get("pageSize") ?? "20", 10)
  const sortBy = searchParams.get("sortBy") ?? undefined
  const sortDir = (searchParams.get("sortDir") ?? "asc") as "asc" | "desc"
  const q = searchParams.get("q") ?? undefined
  const saleType = searchParams.get("saleType") ?? undefined
  const status = searchParams.get("status") ?? undefined
  const dateFrom = searchParams.get("dateFrom") ?? undefined
  const dateTo = searchParams.get("dateTo") ?? undefined

  const filters: Record<string, string> = {}
  if (saleType) filters.saleType = saleType
  if (status) filters.status = status

  let result = salesStore.query({ page: 1, pageSize: 99999, sortBy, sortDir, q, filters })

  // Date range filtering (post-query on full set)
  if (dateFrom || dateTo) {
    const from = dateFrom ? new Date(dateFrom).getTime() : 0
    const to = dateTo ? new Date(dateTo).getTime() : Infinity
    result = {
      ...result,
      data: result.data.filter((s) => {
        const d = new Date(s.date).getTime()
        return d >= from && d <= to
      }),
    }
    result.total = result.data.length
  }

  // Paginate after date filtering
  const start = (page - 1) * pageSize
  const paginated = {
    data: result.data.slice(start, start + pageSize),
    total: result.total,
    page,
    pageSize,
  }

  return NextResponse.json(paginated)
}

export async function POST(request: NextRequest) {
  await injectLatency()

  const body = (await request.json()) as Sale
  const now = new Date().toISOString()
  const sale: Sale = {
    ...body,
    id: body.id ?? `s-${Date.now()}`,
    timeline: body.timeline ?? [{ date: now.slice(0, 10), event: "Sale Recorded", detail: "Sale created via system" }],
    createdAt: now,
    updatedAt: now,
  }

  const created = salesStore.create(sale)
  return NextResponse.json(created, { status: 201 })
}
