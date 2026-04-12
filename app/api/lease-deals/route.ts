import { NextRequest, NextResponse } from "next/server"
import { leaseDealsStore } from "@/lib/mock-store"
import { injectLatency } from "@/lib/utils"
import type { LeaseDeal } from "@/lib/mock-data/schemas"

export async function GET(request: NextRequest) {
  await injectLatency()

  const { searchParams } = request.nextUrl
  const page = parseInt(searchParams.get("page") ?? "1", 10)
  const pageSize = parseInt(searchParams.get("pageSize") ?? "20", 10)
  const sortBy = searchParams.get("sortBy") ?? undefined
  const sortDir = (searchParams.get("sortDir") ?? "asc") as "asc" | "desc"
  const q = searchParams.get("q") ?? undefined
  const status = searchParams.get("status") ?? undefined
  const dealType = searchParams.get("dealType") ?? undefined
  const financeCompanyId = searchParams.get("financeCompanyId") ?? undefined

  const filters: Record<string, string> = {}
  if (status) filters.status = status
  if (dealType) filters.dealType = dealType
  if (financeCompanyId) filters.financeCompanyId = financeCompanyId

  const result = leaseDealsStore.query({ page, pageSize, sortBy, sortDir, q, filters })

  return NextResponse.json(result)
}

export async function POST(request: NextRequest) {
  await injectLatency()

  const body = (await request.json()) as LeaseDeal
  const now = new Date().toISOString()
  const deal: LeaseDeal = {
    ...body,
    id: body.id ?? `ld-${Date.now()}`,
    guarantors: body.guarantors ?? [],
    cashAdvanceFacility: body.cashAdvanceFacility ?? false,
    inspectionPhotos: body.inspectionPhotos ?? [],
    customerDocChecklist: body.customerDocChecklist ?? {},
    vehicleDocChecklist: body.vehicleDocChecklist ?? {},
    createdAt: now,
    updatedAt: now,
  }

  const created = leaseDealsStore.create(deal)
  return NextResponse.json(created, { status: 201 })
}
