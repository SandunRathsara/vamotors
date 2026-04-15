import { test, expect } from "@playwright/test";
import { resetStore } from "./fixtures/reset";

test.beforeEach(async ({ page }) => {
  await resetStore(page);
});

test("golden path: dashboard → vehicles list → vehicle detail", async ({ page }) => {
  // 1) Dashboard loads
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/dashboard$/);

  // 2) Navigate to the vehicles list. The Phase 0.1 sidebar links to /vehicles.
  await page.goto("/vehicles");
  await expect(page).toHaveURL(/\/vehicles$/);

  // 3) At least one vehicle row is rendered from the mock store.
  //    The DiceUI data-table renders rows inside a <table> — assert the row count is >= 1
  //    without coupling to a specific make/model so the test stays fixture-agnostic.
  const rows = page.locator("table tbody tr");
  await expect(rows.first()).toBeVisible();
  const rowCount = await rows.count();
  expect(rowCount).toBeGreaterThan(0);

  // 4) Click the first "Make / Model" link in the first row — Phase 0.1 wires this
  //    to /vehicles/<id> via the Link in the vehicleColumns makeModel cell.
  const firstLink = rows.first().locator('a[href^="/vehicles/"]').first();
  await firstLink.click();

  // 5) Land on a vehicle detail page.
  await expect(page).toHaveURL(/\/vehicles\/[^/]+$/);
});
