import { NextRequest, NextResponse } from "next/server"
import { leaseDispatchStore } from "@/lib/mock-store"
import { injectLatency } from "@/lib/utils"

export async function GET(_request: NextRequest) {
  await injectLatency()

  const all = leaseDispatchStore.getAll()
  const pending = all.filter((d) => d.status === "PendingDispatch")
  const dispatched = all.filter((d) => d.status === "Dispatched")

  return NextResponse.json({ pending, dispatched })
}

export async function PATCH(request: NextRequest) {
  await injectLatency()

  const body = (await request.json()) as {
    id: string
    trackingNumber?: string
    dispatchedBy?: string
  }

  const updated = leaseDispatchStore.update(body.id, {
    status: "Dispatched",
    dispatchedAt: new Date().toISOString(),
    dispatchedBy: body.dispatchedBy ?? "u-001",
    trackingNumber: body.trackingNumber,
  })

  if (!updated) {
    return NextResponse.json({ error: "Dispatch item not found" }, { status: 404 })
  }

  return NextResponse.json(updated)
}
