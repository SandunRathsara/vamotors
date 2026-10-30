import { NextResponse, type NextRequest } from "next/server"
import { authenticate } from "@/lib/server/actor"
import { repairPagePurchase } from "@/lib/server/repair-detail"
import { publicError } from "@/lib/server/errors"

// Defense in depth for framework-generated 404/405/redirect/RSC responses too.
// Authorization lives at each actual read/command, never in this proxy alone.
export async function proxy(request: NextRequest) {
  let response: Response = NextResponse.next()
  const repair = request.nextUrl.pathname.match(/^\/repairs\/([^/]+)\/?$/)
  if (repair) {
    try {
      await repairPagePurchase(await authenticate(request.headers), repair[1])
    } catch (error) {
      // Resolve before any layout/loading RSC stream can commit a soft200.
      response = publicError(error, crypto.randomUUID())
    }
  }
  response.headers.set("Cache-Control", "private,no-store")
  response.headers.set("Referrer-Policy", "same-origin")
  response.headers.set("X-Content-Type-Options", "nosniff")
  return response
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
}
