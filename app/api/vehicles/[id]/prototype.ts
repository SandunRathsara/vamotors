import { NextRequest, NextResponse } from "next/server"
import { notFound } from "next/navigation"
import { vehiclesStore } from "@/lib/mock-store"
import { injectLatency } from "@/lib/utils"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, { params }: RouteContext) {
  await injectLatency()

  const { id } = await params
  const vehicle = vehiclesStore.getById(id)

  if (!vehicle) {
    notFound()
  }

  return NextResponse.json(vehicle)
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  await injectLatency()

  const { id } = await params
  const body = (await request.json()) as Record<string, unknown>
  const updated = vehiclesStore.update(id, body)

  if (!updated) {
    return NextResponse.json({ error: "Vehicle not found" }, { status: 404 })
  }

  return NextResponse.json(updated)
}
