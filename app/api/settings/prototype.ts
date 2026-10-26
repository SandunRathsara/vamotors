import { NextRequest, NextResponse } from "next/server"
import { settingsStore } from "@/lib/mock-store"
import { injectLatency } from "@/lib/utils"

export async function GET() {
  await injectLatency()
  return NextResponse.json(settingsStore.get())
}

export async function PATCH(request: NextRequest) {
  await injectLatency()

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const updated = settingsStore.update(body as Parameters<typeof settingsStore.update>[0])
  return NextResponse.json(updated)
}
