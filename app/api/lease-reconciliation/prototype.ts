import { NextRequest, NextResponse } from "next/server"
import { leaseReconciliationStore } from "@/lib/mock-store"
import { injectLatency } from "@/lib/utils"

export async function GET(request: NextRequest) {
  await injectLatency()

  const { searchParams } = request.nextUrl
  const page = parseInt(searchParams.get("page") ?? "1", 10)
  const pageSize = parseInt(searchParams.get("pageSize") ?? "20", 10)
  const status = searchParams.get("status") ?? undefined
  const source = searchParams.get("source") ?? undefined

  const filters: Record<string, string> = {}
  if (status) filters.status = status
  if (source) filters.source = source

  const result = leaseReconciliationStore.query({ page, pageSize, filters })

  return NextResponse.json(result)
}

export async function PATCH(request: NextRequest) {
  await injectLatency()

  const body = (await request.json()) as {
    id: string
    receivedCommission: number
  }

  const existing = leaseReconciliationStore.getById(body.id)
  if (!existing) {
    return NextResponse.json({ error: "Reconciliation record not found" }, { status: 404 })
  }

  const discrepancy = existing.expectedCommission - body.receivedCommission

  const updated = leaseReconciliationStore.update(body.id, {
    receivedCommission: body.receivedCommission,
    discrepancy,
    status: "Reconciled",
  })

  return NextResponse.json(updated)
}
