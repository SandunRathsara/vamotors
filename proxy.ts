import { NextResponse, type NextRequest } from "next/server"
import { authenticate } from "@/lib/server/actor"
import { repairPagePurchase } from "@/lib/server/repair-detail"
import { authenticatedApprovalDetail } from "@/lib/server/approvals"
import { CommandError, publicError } from "@/lib/server/errors"

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
  const approval = request.nextUrl.pathname.match(/^\/approvals\/([^/]+)\/?$/)
  if (approval && ["GET", "HEAD"].includes(request.method)) {
    // Next may stream its RSC shell before notFound() can change HTTP status.
    // This one exact-route preflight enforces404 before headers; the page still
    // repeats the same current-authority lookup, never trusting this as a grant.
    try {
      await authenticatedApprovalDetail(request.headers, approval[1])
    } catch (error) {
      if (
        error instanceof CommandError &&
        (error.status === 401 || error.code === "ACCOUNT_INACTIVE")
      )
        response = NextResponse.redirect(
          new URL("/login?reason=access-changed", request.url)
        )
      else if (
        error instanceof CommandError &&
        [403, 404].includes(error.status)
      )
        response = new NextResponse("Not Found", { status: 404 })
      else response = new NextResponse("Request failed", { status: 500 })
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
