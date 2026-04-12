import { NextRequest, NextResponse } from "next/server"
import { approvalsStore } from "@/lib/mock-store"
import { injectLatency } from "@/lib/utils"

export async function GET(request: NextRequest) {
  await injectLatency()

  const { searchParams } = new URL(request.url)
  const status = searchParams.get("status") ?? undefined
  const category = searchParams.get("category") ?? undefined
  const page = parseInt(searchParams.get("page") ?? "1", 10)
  const pageSize = parseInt(searchParams.get("pageSize") ?? "20", 10)
  const sortBy = searchParams.get("sortBy") ?? undefined
  const sortDir = (searchParams.get("sortDir") ?? "desc") as "asc" | "desc"

  const filters: Record<string, string> = {}
  if (status) filters.status = status
  if (category) filters.category = category

  const result = approvalsStore.query({
    page,
    pageSize,
    sortBy: sortBy ?? "requestDate",
    sortDir,
    filters: Object.keys(filters).length > 0 ? filters : undefined,
  })

  return NextResponse.json(result)
}

export async function PATCH(request: NextRequest) {
  await injectLatency()

  let body: { id?: string; action?: "approve" | "reject" }
  try {
    body = (await request.json()) as { id?: string; action?: "approve" | "reject" }
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { id, action } = body

  if (!id || !action || !["approve", "reject"].includes(action)) {
    return NextResponse.json({ error: "Missing or invalid id / action" }, { status: 400 })
  }

  const existing = approvalsStore.getById(id)
  if (!existing) {
    return NextResponse.json({ error: "Approval not found" }, { status: 404 })
  }

  const updated = approvalsStore.update(id, {
    status: action === "approve" ? "Approved" : "Rejected",
    approvedBy: "u-001",
    approvedDate: new Date().toISOString().split("T")[0],
  })

  return NextResponse.json(updated)
}
