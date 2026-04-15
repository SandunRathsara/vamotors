import { test, expect } from "@playwright/test";

test.beforeEach(async ({ request }) => {
  // D-14: rehydrate the in-memory mock store before every test so each test
  // starts from the same fixture baseline. Contract is stable for Phase 1+
  // when this handler's body swaps to prisma.$transaction([...deleteMany]).
  // NOTE: route path is /api/test/reset (not /api/__test__/reset) — Next.js
  // App Router treats any folder prefixed with `_` as a private folder and
  // excludes it from routing. See 00.3-01-SUMMARY.md deviation 1.
  const res = await request.post("/api/test/reset");
  expect(res.ok()).toBe(true);
});

test.describe("GET /api/vehicles", () => {
  test("returns the paginated envelope shape", async ({ request }) => {
    const res = await request.get("/api/vehicles?page=1&pageSize=10");
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body).toMatchObject({
      data: expect.any(Array),
      total: expect.any(Number),
      page: 1,
      pageSize: 10,
    });
    expect(body.data.length).toBeLessThanOrEqual(10);
  });

  test("honors the pageSize query param", async ({ request }) => {
    const res = await request.get("/api/vehicles?page=1&pageSize=3");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.pageSize).toBe(3);
    expect(body.data.length).toBeLessThanOrEqual(3);
  });
});

test.describe("POST /api/test/reset", () => {
  test("is reachable in dev/test mode", async ({ request }) => {
    const res = await request.post("/api/test/reset");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });
});
