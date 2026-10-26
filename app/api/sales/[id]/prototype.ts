import { NextRequest, NextResponse } from "next/server"
import { notFound } from "next/navigation"
import { salesStore } from "@/lib/mock-store"
import { injectLatency } from "@/lib/utils"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, { params }: RouteContext) {
  await injectLatency()

  const { id } = await params
  const sale = salesStore.getById(id)

  if (!sale) {
    notFound()
  }

  return NextResponse.json(sale)
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  await injectLatency()

  const { id } = await params
  const body = (await request.json()) as Record<string, unknown>
  const updated = salesStore.update(id, body)

  if (!updated) {
    return NextResponse.json({ error: "Sale not found" }, { status: 404 })
  }

  return NextResponse.json(updated)
}
