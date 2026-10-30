import { authenticate } from "@/lib/server/actor"
import { downloadAttachment } from "@/lib/server/attachments"
import { endpoint } from "@/lib/server/http"
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export async function GET(
  request: Request,
  context: { params: Promise<{ attachmentId: string }> }
) {
  return endpoint(async () =>
    downloadAttachment(
      await authenticate(request.headers),
      (await context.params).attachmentId,
      new URL(request.url).searchParams
    )
  )
}
