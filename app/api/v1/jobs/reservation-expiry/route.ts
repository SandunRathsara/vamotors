import {
  authenticateScheduler,
  executeExpiry,
} from "@/lib/server/reservation-expiry"
import {
  boundedJSON,
  endpoint,
  noStoreJSON,
  sameOrigin,
} from "@/lib/server/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  return endpoint(async () => {
    sameOrigin(request)
    await authenticateScheduler(request)
    return noStoreJSON(await executeExpiry(null, await boundedJSON(request)))
  })
}
