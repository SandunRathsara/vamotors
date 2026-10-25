import { authentication } from "@/lib/server/auth"
import { authCall } from "@/lib/server/auth-failures"
import { assertEnvironment, database } from "@/lib/server/db"
import { endpoint, boundedJSON, sameOrigin } from "@/lib/server/http"
import { fail } from "@/lib/server/errors"
import { z } from "zod"
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export async function POST(request: Request) {
  // No signup/reset/bootstrap/get-session token transport, regardless of flags.
  const path = new URL(request.url).pathname
  if (!["/api/auth/sign-in/email", "/api/auth/sign-out"].includes(path))
    return new Response(null, { status: 404 })
  return authCall("http", () =>
    endpoint(async () => {
      sameOrigin(request)
      await assertEnvironment(database(), true)
      const schema =
        path === "/api/auth/sign-in/email"
          ? z
              .object({
                email: z.string().trim().toLowerCase().email().max(254),
                password: z.string().min(1).max(128),
                rememberMe: z.boolean().optional(),
              })
              .strict()
          : z.object({}).strict()
      const parsed = schema.safeParse(await boundedJSON(request))
      if (!parsed.success) fail("INVALID_INPUT", 422)
      const body = parsed.data
      const response = await authentication().handler(
        new Request(request.url, {
          method: "POST",
          headers: request.headers,
          body: JSON.stringify(body),
        })
      )
      const headers = new Headers(response.headers)
      headers.set("Cache-Control", "private,no-store")
      // Better Auth cookie lifecycle preserved; never return its raw token/user row.
      headers.delete("content-length")
      return new Response(
        JSON.stringify(
          response.ok
            ? { ok: true }
            : { ok: false, error: { code: "UNAUTHENTICATED" } }
        ),
        { status: response.status, headers }
      )
    })
  )
}
export async function GET() {
  return new Response(null, { status: 404 })
}
