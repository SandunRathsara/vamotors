import { authenticate } from "@/lib/server/actor"
import { endpoint, noStoreJSON } from "@/lib/server/http"
import { securityQuery } from "@/lib/server/queries"

export async function GET(request: Request) {
  return endpoint(async () => {
    const identity = await authenticate(request.headers)
    return noStoreJSON({
      ok: true,
      data: await securityQuery(
        identity,
        "audit",
        new URL(request.url).searchParams
      ),
    })
  })
}
