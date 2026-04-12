import { NextRequest, NextResponse } from "next/server"
import { thirdPartiesStore } from "@/lib/mock-store"
import { injectLatency } from "@/lib/utils"
import type { ThirdParty } from "@/lib/mock-data/schemas"

export async function GET(request: NextRequest) {
  await injectLatency()

  const { searchParams } = request.nextUrl
  const page = parseInt(searchParams.get("page") ?? "1", 10)
  const pageSize = parseInt(searchParams.get("pageSize") ?? "20", 10)
  const sortBy = searchParams.get("sortBy") ?? undefined
  const sortDir = (searchParams.get("sortDir") ?? "asc") as "asc" | "desc"
  const q = searchParams.get("q") ?? undefined
  const type = searchParams.get("type") ?? undefined

  const filters: Record<string, string> = {}
  if (type && ["Supplier", "RepairVendor", "FinanceCompany"].includes(type)) {
    filters.type = type
  }

  const result = thirdPartiesStore.query({ page, pageSize, sortBy, sortDir, q, filters })

  return NextResponse.json(result)
}

export async function POST(request: NextRequest) {
  await injectLatency()

  const body = (await request.json()) as ThirdParty
  const now = new Date().toISOString()
  const thirdParty: ThirdParty = {
    ...body,
    id: body.id ?? `tp-${Date.now()}`,
    isActive: body.isActive ?? true,
    contactPersons: body.contactPersons ?? [],
    createdAt: now,
    updatedAt: now,
  }

  const created = thirdPartiesStore.create(thirdParty)
  return NextResponse.json(created, { status: 201 })
}
