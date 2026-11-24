import { test, expect } from "../fixtures-local"

test("inventory queries require a session and paginate real records", async ({
  local,
  request,
}) => {
  const path = "/api/v1/queries/inventory?page=1&pageSize=10"
  expect((await request.get(local.origin + path)).status()).toBe(401)
  expect((await request.post(local.origin + "/api/test/reset")).status()).toBe(
    404
  )

  const admin = await local.login("ADMIN")
  try {
    const result = await admin.get(path)
    expect(result.status()).toBe(200)
    expect(result.headers()["cache-control"]).toContain("no-store")
    const { data } = await result.json()
    expect(data).toMatchObject({
      data: expect.any(Array),
      page: 1,
      pageSize: 10,
      total: expect.any(Number),
    })
    expect(data.data.length).toBeLessThanOrEqual(10)
  } finally {
    await admin.dispose()
  }
})
