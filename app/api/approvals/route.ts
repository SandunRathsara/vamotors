import { NextRequest, NextResponse } from "next/server"
import { approvalsStore } from "@/lib/mock-store"
import { injectLatency } from "@/lib/utils"

export async function GET(request: NextRequest) {
  await injectLatency()

  const { searchParams } = new URL(request.url)
  const status = searchParams.get("status") ?? undefined
  const page = parseInt(searchParams.get("page") ?? "1", 10)
  const pageSize = parseInt(searchParams.get("pageSize") ?? "20", 10)

  const result = approvalsStore.query({
    page,
    pageSize,
    filters: status ? { status } : undefined,
  })

  return NextResponse.json(result)
}
