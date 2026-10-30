import { authenticate } from "@/lib/server/actor"
import { rateRead } from "@/lib/server/rates"
import {
  endpoint,
  noStoreJSON,
  boundedJSON,
  sameOrigin,
} from "@/lib/server/http"
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export async function POST(request: Request) {
  return endpoint(async () => {
    const identity = await authenticate(request.headers)
    sameOrigin(request)
    return noStoreJSON({
      ok: true,
      data: await rateRead(identity, "compare", await boundedJSON(request)),
      redactedFields: [],
      asOf: new Date().toISOString(),
    })
  })
}
