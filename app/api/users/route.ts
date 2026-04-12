import { NextRequest, NextResponse } from "next/server"
import { usersStore } from "@/lib/mock-store"
import { injectLatency } from "@/lib/utils"

export async function GET(request: NextRequest) {
  await injectLatency()

  const { searchParams } = new URL(request.url)
  const page = parseInt(searchParams.get("page") ?? "1", 10)
  const pageSize = parseInt(searchParams.get("pageSize") ?? "20", 10)
  const sortBy = searchParams.get("sortBy") ?? undefined
  const sortDir = (searchParams.get("sortDir") ?? "asc") as "asc" | "desc"
  const q = searchParams.get("q") ?? undefined

  const result = usersStore.query({ page, pageSize, sortBy, sortDir, q })

  return NextResponse.json(result)
}

export async function POST(request: NextRequest) {
  await injectLatency()

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  if (!body.name || !body.email || !body.role) {
    return NextResponse.json({ error: "Missing required fields: name, email, role" }, { status: 400 })
  }

  const newUser = usersStore.create({
    id: `u-${Date.now()}`,
    name: String(body.name),
    email: String(body.email),
    role: body.role as "Administrator" | "Manager" | "SalesExecutive" | "FinanceOfficer",
    status: "Active",
    createdAt: new Date().toISOString(),
  })

  return NextResponse.json(newUser, { status: 201 })
}

export async function PATCH(request: NextRequest) {
  await injectLatency()

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const id = String(body.id ?? "")
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 })
  }

  const existing = usersStore.getById(id)
  if (!existing) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
  }

  const patch: Record<string, unknown> = {}
  if (body.role) patch.role = body.role
  if (body.status) patch.status = body.status
  if (body.name) patch.name = body.name

  const updated = usersStore.update(id, patch as Partial<typeof existing>)
  return NextResponse.json(updated)
}
