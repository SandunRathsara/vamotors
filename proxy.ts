import { NextResponse } from "next/server"

// Defense in depth for framework-generated 404/405/redirect/RSC responses too.
// Authorization lives at each actual read/command, never in this proxy alone.
export function proxy() {
  const response = NextResponse.next()
  response.headers.set("Cache-Control", "private,no-store")
  response.headers.set("Referrer-Policy", "same-origin")
  response.headers.set("X-Content-Type-Options", "nosniff")
  return response
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
}
