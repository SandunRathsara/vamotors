import "server-only"
import { authenticate } from "./actor"
import { securityQuery } from "./queries"
import { endpoint, noStoreJSON, sameOrigin } from "./http"

// Retired mock transports deliberately never import their preserved prototypes.
export async function unavailable(request: Request) {
  return endpoint(async () => {
    const identity = await authenticate(request.headers)
    await securityQuery(identity, "currentActor", new URLSearchParams())
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method))
      sameOrigin(request)
    return noStoreJSON(
      {
        ok: false,
        error: {
          code: "UNAVAILABLE",
          message: "Domain implementation pending",
        },
      },
      503
    )
  })
}
