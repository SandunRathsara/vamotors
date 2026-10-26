import { NextRequest, NextResponse } from "next/server"
import { customersStore } from "@/lib/mock-store"
import { injectLatency } from "@/lib/utils"
import type { Customer } from "@/lib/mock-data/schemas"

export async function GET(request: NextRequest) {
  await injectLatency()

  const { searchParams } = request.nextUrl
  const page = parseInt(searchParams.get("page") ?? "1", 10)
  const pageSize = parseInt(searchParams.get("pageSize") ?? "20", 10)
  const sortBy = searchParams.get("sortBy") ?? undefined
  const sortDir = (searchParams.get("sortDir") ?? "asc") as "asc" | "desc"
  const q = searchParams.get("q") ?? undefined

  // Search by name, NIC, or phone — the mock store full-text search covers all
  // string fields including fullName, nicPassport, phone
  const result = customersStore.query({ page, pageSize, sortBy, sortDir, q })

  return NextResponse.json(result)
}

export async function POST(request: NextRequest) {
  await injectLatency()

  const body = (await request.json()) as Customer
  const now = new Date().toISOString()
  const customer: Customer = {
    ...body,
    id: body.id ?? `c-${Date.now()}`,
    createdAt: now,
    updatedAt: now,
  }

  const created = customersStore.create(customer)
  return NextResponse.json(created, { status: 201 })
}
