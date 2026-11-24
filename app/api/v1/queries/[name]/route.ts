import { authenticate } from "@/lib/server/actor"
import { securityQuery } from "@/lib/server/queries"
import {
  endpoint,
  noStoreJSON,
  boundedJSON,
  sameOrigin,
} from "@/lib/server/http"
import { rateRead } from "@/lib/server/rates"
import { dispatchRead } from "@/lib/server/dispatch"
import { fail } from "@/lib/server/errors"
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

export async function POST(
  request: Request,
  context: { params: Promise<{ name: string }> }
) {
  return endpoint(async () => {
    const identity = await authenticate(request.headers)
    sameOrigin(request)
    const { name } = await context.params
    if (name !== "compare" && name !== "loanMaxima" && name !== "dispatchPreview") fail("NOT_FOUND", 404)
    const body = await boundedJSON(request)
    return noStoreJSON({
      ok: true,
      data:
        name === "dispatchPreview"
          ? await dispatchRead(identity, body)
          : await rateRead(identity, name, body),
      redactedFields: [],
      asOf: new Date().toISOString(),
    })
  })
}
