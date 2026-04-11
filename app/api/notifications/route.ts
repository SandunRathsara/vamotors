import { NextResponse } from "next/server"
import { notificationsStore } from "@/lib/mock-store"
import { injectLatency } from "@/lib/utils"

export async function GET() {
  await injectLatency()

  const all = notificationsStore.getAll()

  return NextResponse.json({
    data: all,
    total: all.length,
  })
}
