import { AsyncLocalStorage } from "node:async_hooks"
import { randomUUID } from "node:crypto"
import { APIError } from "better-auth/api"

const calls = new AsyncLocalStorage<{
  operation: "http" | "session"
  requestId: string
  emitted: boolean
}>()

// No diagnostic arguments, request strings, headers, or error objects enter logs.
export function authFailure() {
  const call = calls.getStore()
  if (call?.emitted) return
  if (call) call.emitted = true
  try {
    console.error("AUTHENTICATION_FAILURE", {
      operation: call?.operation ?? "library",
      requestId: call?.requestId ?? randomUUID(),
    })
  } catch {
    // A failed event sink must not change authentication response semantics.
  }
}

export function authCall<T>(
  operation: "http" | "session",
  run: () => Promise<T>
): Promise<T> {
  if (calls.getStore()) return run()
  return calls.run(
    { operation, requestId: randomUUID(), emitted: false },
    async () => {
      try {
        const result = await run()
        if (result instanceof Response && result.status >= 500) authFailure()
        return result
      } catch (error) {
        if (error instanceof APIError && error.statusCode < 500) throw error
        authFailure()
        throw new APIError("INTERNAL_SERVER_ERROR", {
          message: "AUTHENTICATION_UNAVAILABLE",
        })
      }
    }
  )
}
