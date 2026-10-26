import { NextRequest, NextResponse } from "next/server"
import { notFound } from "next/navigation"
import { leaseDealsStore } from "@/lib/mock-store"
import { injectLatency } from "@/lib/utils"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, { params }: RouteContext) {
  await injectLatency()

  const { id } = await params
  const deal = leaseDealsStore.getById(id)

  if (!deal) {
    notFound()
  }

  return NextResponse.json(deal)
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  await injectLatency()

  const { id } = await params
  const body = (await request.json()) as Record<string, unknown>
  const updated = leaseDealsStore.update(id, { ...body, updatedAt: new Date().toISOString() })

  if (!updated) {
    return NextResponse.json({ error: "Lease deal not found" }, { status: 404 })
  }

  return NextResponse.json(updated)
}
