import { authenticate } from "@/lib/server/actor"
import { putUpload } from "@/lib/server/attachments"
import { endpoint, sameOrigin } from "@/lib/server/http"
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export async function PUT(
  request: Request,
  context: { params: Promise<{ uploadId: string }> }
) {
  return endpoint(async () => {
    const identity = await authenticate(request.headers)
    sameOrigin(request)
    await putUpload(identity, (await context.params).uploadId, request)
    return new Response(null, {
      status: 204,
      headers: { "Cache-Control": "private,no-store" },
    })
  })
}
