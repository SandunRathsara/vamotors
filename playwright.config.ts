import { defineConfig } from "@playwright/test"

export default defineConfig({
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  use: { actionTimeout: 20_000, navigationTimeout: 30_000 },
  projects: [
    { name: "api", testDir: "tests/api" },
    ...(["chromium", "firefox", "webkit"] as const).flatMap((browserName) =>
      [360, 1920].map((width) => ({
        name: `${browserName === "chromium" ? "e2e" : browserName}-${width}`,
        testDir: "tests/e2e",
        use: { browserName, viewport: { width, height: 900 } },
      }))
    ),
  ],
})
