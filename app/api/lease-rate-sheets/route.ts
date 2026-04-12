import { NextRequest, NextResponse } from "next/server"
import { leaseRateSheetsStore } from "@/lib/mock-store"
import { injectLatency } from "@/lib/utils"

export async function GET(request: NextRequest) {
  await injectLatency()

  const { searchParams } = request.nextUrl
  const financeCompanyId = searchParams.get("financeCompanyId") ?? undefined

  let sheets = leaseRateSheetsStore.getAll()

  if (financeCompanyId) {
    sheets = sheets.filter((s) => s.financeCompanyId === financeCompanyId)
  }

  return NextResponse.json(sheets)
}
