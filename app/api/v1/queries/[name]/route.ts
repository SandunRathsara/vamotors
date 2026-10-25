import { authenticate } from "@/lib/server/actor"
import { securityQuery } from "@/lib/server/queries"
import { endpoint, noStoreJSON } from "@/lib/server/http"
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export async function GET(
  request: Request,
  context: { params: Promise<{ name: string }> }
) {
  return endpoint(async () => {
    const identity = await authenticate(request.headers)
    const { name } = await context.params
    return noStoreJSON({
      ok: true,
      data: await securityQuery(
        identity,
        name,
        new URL(request.url).searchParams
      ),
      redactedFields: [],
      asOf: new Date().toISOString(),
    })
  })
}
