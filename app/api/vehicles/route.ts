import { NextRequest, NextResponse } from "next/server"
import { vehiclesStore } from "@/lib/mock-store"
import { injectLatency } from "@/lib/utils"
import type { Vehicle } from "@/lib/mock-data/schemas"

export async function GET(request: NextRequest) {
  await injectLatency()

  const { searchParams } = request.nextUrl
  const page = parseInt(searchParams.get("page") ?? "1", 10)
  const pageSize = parseInt(searchParams.get("pageSize") ?? "20", 10)
  const sortBy = searchParams.get("sortBy") ?? undefined
  const sortDir = (searchParams.get("sortDir") ?? "asc") as "asc" | "desc"
  const q = searchParams.get("q") ?? undefined
  const status = searchParams.get("status") ?? undefined
  const availability = searchParams.get("availability") ?? undefined

  const filters: Record<string, string> = {}
  if (status) filters.status = status
  if (availability !== undefined && availability !== "") {
    filters.isAvailableForSale = availability
  }

  const result = vehiclesStore.query({ page, pageSize, sortBy, sortDir, q, filters })

  return NextResponse.json(result)
}

export async function POST(request: NextRequest) {
  await injectLatency()

  const body = (await request.json()) as Vehicle
  const now = new Date().toISOString()
  const vehicle: Vehicle = {
    ...body,
    id: body.id ?? `v-${Date.now()}`,
    createdAt: now,
    updatedAt: now,
  }

  const created = vehiclesStore.create(vehicle)
  return NextResponse.json(created, { status: 201 })
}
