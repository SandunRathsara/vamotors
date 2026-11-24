import { authenticate } from "@/lib/server/actor"
import { endpoint } from "@/lib/server/http"
import { downloadInvoice } from "@/lib/server/invoices"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ saleId: string; version: string }> }
) {
  return endpoint(async () => {
    const identity = await authenticate(request.headers)
    const { saleId, version } = await params
    return downloadInvoice(identity, saleId, version)
  })
}
