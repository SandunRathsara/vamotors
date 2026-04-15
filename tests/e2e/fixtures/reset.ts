import type { Page } from "@playwright/test";

/**
 * Rehydrate the mock store via the dev-only test reset endpoint.
 * Called in E2E `test.beforeEach`. Contract survives the Phase 1 Prisma swap.
 *
 * Route path is `/api/test/reset` (not `/api/__test__/reset`) — Next.js App
 * Router treats any folder prefixed with `_` as a private folder. See
 * 00.3-01-SUMMARY.md deviation 1.
 */
export async function resetStore(page: Page): Promise<void> {
  const res = await page.request.post("/api/test/reset");
  if (!res.ok()) {
    throw new Error(`reset endpoint returned ${res.status()}`);
  }
}
