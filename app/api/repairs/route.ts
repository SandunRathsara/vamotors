import { NextRequest, NextResponse } from "next/server"
import { repairsStore } from "@/lib/mock-store"
import { injectLatency } from "@/lib/utils"
import type { Repair } from "@/lib/mock-data/schemas"

export async function GET(request: NextRequest) {
  await injectLatency()

  const { searchParams } = request.nextUrl
  const page = parseInt(searchParams.get("page") ?? "1", 10)
  const pageSize = parseInt(searchParams.get("pageSize") ?? "20", 10)
  const sortBy = searchParams.get("sortBy") ?? undefined
  const sortDir = (searchParams.get("sortDir") ?? "asc") as "asc" | "desc"
  const q = searchParams.get("q") ?? undefined
  const status = searchParams.get("status") ?? undefined
  const vendorId = searchParams.get("vendorId") ?? undefined

  const filters: Record<string, string> = {}
  if (status) filters.status = status
  if (vendorId) filters.vendorId = vendorId

  const result = repairsStore.query({ page, pageSize, sortBy, sortDir, q, filters })

  return NextResponse.json(result)
}

export async function POST(request: NextRequest) {
  await injectLatency()

  const body = (await request.json()) as Repair
  const now = new Date().toISOString()
  const repair: Repair = {
    ...body,
    id: body.id ?? `r-${Date.now()}`,
    status: body.status ?? "InProgress",
    createdAt: now,
    updatedAt: now,
  }

  const created = repairsStore.create(repair)
  return NextResponse.json(created, { status: 201 })
}

export async function PATCH(request: NextRequest) {
  await injectLatency()

  const body = (await request.json()) as { id: string } & Partial<Repair>
  const { id, ...patch } = body

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 })
  }

  const updated = repairsStore.update(id, { ...patch, updatedAt: new Date().toISOString() })

  if (!updated) {
    return NextResponse.json({ error: "Repair not found" }, { status: 404 })
  }

  return NextResponse.json(updated)
}
