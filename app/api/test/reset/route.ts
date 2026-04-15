import { NextResponse } from "next/server";
import { resetAll } from "@/lib/mock-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/test/reset — rehydrates the in-memory mock store.
 *
 * Gated so it cannot be reached from real production deployments:
 *   - Hard 404 whenever VERCEL_ENV === "production". No env var combination
 *     can open the gate on a Vercel production deploy.
 *   - Otherwise 404 when NODE_ENV === "production", UNLESS TEST_RESET_ENABLED === "1".
 *   - Playwright's webServer runs `next start` which forces NODE_ENV=production,
 *     so the test harness sets TEST_RESET_ENABLED=1 in playwright.config.ts to
 *     open the gate for test runs only.
 *   - When TEST_RESET_SECRET is set, the request must also present a matching
 *     `x-test-reset-secret` header. This is a defense-in-depth signal so no
 *     single env var can satisfy the gate.
 *
 * SECURITY TODO(phase-1): before swapping resetAll() to prisma.$transaction,
 * add: (1) origin allow-list, (2) rate limit, (3) audit-log each invocation,
 * (4) require TEST_RESET_SECRET to be non-empty (not optional). See WR-01 in
 * .planning/phases/00.3-testing-strategy/00.3-REVIEW.md.
 */
export async function POST(request: Request) {
  const isProd = process.env.NODE_ENV === "production";
  const isVercelProd = process.env.VERCEL_ENV === "production";
  const testOverride = process.env.TEST_RESET_ENABLED === "1";

  // Vercel production can NEVER open the gate, regardless of other env vars.
  if (isVercelProd) {
    return new NextResponse("Not Found", { status: 404 });
  }
  if (isProd && !testOverride) {
    return new NextResponse("Not Found", { status: 404 });
  }

  // Optional second signal: signed header check. When TEST_RESET_SECRET is
  // configured, the request must present a matching header.
  const secret = process.env.TEST_RESET_SECRET;
  if (secret) {
    const headerSecret = request.headers.get("x-test-reset-secret");
    if (headerSecret !== secret) {
      return new NextResponse("Not Found", { status: 404 });
    }
  }

  resetAll();
  return NextResponse.json({ ok: true });
}
