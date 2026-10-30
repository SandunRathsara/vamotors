import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"
import { runInNewContext } from "node:vm"

const origin = "https://vamotors.example.test"
const assets = [
  "/offline.html",
  "/pwa-icon-192.png",
  "/pwa-icon-512.png",
  "/apple-touch-icon.png",
]
const script = await readFile(
  new URL("../../public/sw.js", import.meta.url),
  "utf8"
)

function worker() {
  const handlers = new Map()
  const stores = new Map()
  const network = []
  let offline = false
  let badAsset = false
  let claimed = false
  let skipped = false
  const key = (request) =>
    new URL(typeof request === "string" ? request : request.url, origin).href
  const caches = {
    async keys() {
      return [...stores.keys()]
    },
    async delete(name) {
      return stores.delete(name)
    },
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map())
      const store = stores.get(name)
      return {
        async put(request, response) {
          store.set(key(request), response.clone())
        },
        async match(request) {
          return store.get(key(request))?.clone()
        },
      }
    },
  }
  runInNewContext(script, {
    URL,
    Request,
    Response,
    caches,
    self: {
      location: { origin },
      addEventListener: (name, handler) => handlers.set(name, handler),
      skipWaiting: async () => {
        skipped = true
      },
      clients: {
        claim: async () => {
          claimed = true
        },
      },
    },
    fetch: async (request, options) => {
      network.push({ request, options })
      if (offline) throw new TypeError("Network unavailable")
      const path = new URL(request.url).pathname
      return new Response(
        path === "/offline.html"
          ? "Public unavailable shell"
          : "Online response",
        {
          status: 200,
          headers: {
            "content-type": badAsset
              ? "application/json"
              : path.endsWith(".png")
                ? "image/png"
                : "text/html",
          },
        }
      )
    },
  })
  return {
    stores,
    caches,
    network,
    handlers,
    offline: () => {
      offline = true
    },
    badAsset: () => {
      badAsset = true
    },
    state: () => ({ claimed, skipped }),
    async lifecycle(name) {
      let task
      handlers.get(name)({
        waitUntil: (promise) => {
          task = promise
        },
      })
      await task
    },
    fetch(path, options = {}) {
      let response
      const request = {
        url: new URL(path, origin).href,
        method: "GET",
        mode: "cors",
        headers: new Headers(),
        ...options,
      }
      handlers.get("fetch")({
        request,
        respondWith: (promise) => {
          response = promise
        },
      })
      return response
    },
  }
}

test("install caches exactly four credential-free public assets; activation deletes only owned old caches", async () => {
  const sw = worker()
  await sw.lifecycle("install")
  assert.deepEqual(
    sw.network.map(({ request }) => new URL(request.url).pathname),
    assets
  )
  for (const { request } of sw.network) {
    assert.equal(request.credentials, "omit")
    assert.equal(request.cache, "no-store")
    assert.equal(request.redirect, "error")
  }
  await sw.caches.open("vamotors-public-shell-old")
  await sw.caches.open("unrelated-owner-cache")
  await sw.lifecycle("activate")
  assert.deepEqual(await sw.caches.keys(), [
    "vamotors-public-shell-v1",
    "unrelated-owner-cache",
  ])
  assert.deepEqual(sw.state(), { claimed: true, skipped: true })
  assert.deepEqual([...sw.handlers.keys()], ["install", "activate", "fetch"])
})

test("bad public asset responses fail installation without activating or storing bytes", async () => {
  const sw = worker()
  sw.badAsset()
  await assert.rejects(
    sw.lifecycle("install"),
    /PUBLIC_SHELL_ASSET_UNAVAILABLE/
  )
  assert.ok([...sw.stores.values()].every((store) => store.size === 0))
  assert.deepEqual(sw.state(), { claimed: false, skipped: false })
})

test("private responses are network-only; offline navigation returns only the generic shell", async () => {
  const sw = worker()
  await sw.lifecycle("install")
  const paths = [
    "/users",
    "/login",
    "/api/auth/get-session",
    "/api/v1/queries/users",
    "/users?_rsc=private",
    "/report.csv",
    "/invoice.pdf",
    "/documents/private",
    "/signed?token=private",
  ]
  for (const path of paths) {
    assert.equal((await sw.fetch(path)).status, 200)
    assert.equal(sw.network.at(-1).options.cache, "no-store")
  }
  sw.offline()
  for (const path of ["/users", "/login", "/customers?private=filter"])
    assert.equal(
      await (await sw.fetch(path, { mode: "navigate" })).text(),
      "Public unavailable shell"
    )
  for (const path of paths)
    await assert.rejects(sw.fetch(path), /Network unavailable/)
  for (const path of ["/api/private", "/report.csv", "/invoice.pdf"])
    await assert.rejects(
      sw.fetch(path, { mode: "navigate" }),
      /Network unavailable/
    )
  await assert.rejects(
    sw.fetch("/users", { mode: "navigate", headers: new Headers({ RSC: "1" }) })
  )
  const store = sw.stores.get("vamotors-public-shell-v1")
  assert.deepEqual(
    [...store.keys()].map((url) => new URL(url).pathname),
    assets
  )
})

test("public cache reads require exact URL and no authorization/RSC; writes and foreign origins are untouched", async () => {
  const sw = worker()
  await sw.lifecycle("install")
  sw.offline()
  assert.equal((await sw.fetch("/pwa-icon-192.png")).status, 200)
  for (const path of [
    "/pwa-icon-192.png?signature=private",
    "/new-public-looking.png",
  ])
    await assert.rejects(sw.fetch(path), /Network unavailable/)
  for (const headers of [{ Authorization: "Bearer private" }, { RSC: "1" }])
    await assert.rejects(
      sw.fetch("/pwa-icon-192.png", { headers: new Headers(headers) })
    )
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "HEAD"])
    assert.equal(
      sw.fetch("/api/v1/commands/recordPurchase", { method }),
      undefined
    )
  assert.equal(
    sw.fetch("https://private-files.example.test/signed.pdf"),
    undefined
  )
})

test("missing fallback fails closed instead of inventing offline data", async () => {
  const sw = worker()
  sw.offline()
  const response = await sw.fetch("/users", { mode: "navigate" })
  assert.equal(response.type, "error")
})
