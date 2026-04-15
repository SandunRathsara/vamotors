import { NextResponse } from "next/server";
import { resetAll } from "@/lib/mock-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/test/reset — rehydrates the in-memory mock store.
 *
 * Gated so it cannot be reached from real production deployments:
 *   - 404 when NODE_ENV === "production", UNLESS TEST_RESET_ENABLED === "1".
 *   - Playwright's webServer runs `next start` which forces NODE_ENV=production,
 *     so the test harness sets TEST_RESET_ENABLED=1 in playwright.config.ts to
 *     open the gate for test runs only. Real Vercel deployments never set
 *     TEST_RESET_ENABLED, so the 404 still applies there.
 *   - Phase 1 will harden this further by also checking a signed header.
 */
export async function POST() {
  const isProd = process.env.NODE_ENV === "production";
  const testOverride = process.env.TEST_RESET_ENABLED === "1";
  if (isProd && !testOverride) {
    return new NextResponse("Not Found", { status: 404 });
  }
  resetAll();
  return NextResponse.json({ ok: true });
}
