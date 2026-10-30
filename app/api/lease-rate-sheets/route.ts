import { authenticate } from "@/lib/server/actor"
import { rateRead } from "@/lib/server/rates"
import { endpoint, noStoreJSON } from "@/lib/server/http"
import { fail } from "@/lib/server/errors"
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export async function GET(request: Request) {
  return endpoint(async () => {
    const identity = await authenticate(request.headers)
    const params = new URL(request.url).searchParams
    if (new Set(params.keys()).size !== [...params.keys()].length)
      fail("INVALID_INPUT", 422)
    return noStoreJSON(
      await rateRead(identity, "rateSheets", Object.fromEntries(params))
    )
  })
}
