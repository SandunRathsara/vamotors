/* Public assets only. Never add runtime pages, bundles, data or credentials here. */
const CACHE_PREFIX = "vamotors-public-shell-"
const CACHE_NAME = `${CACHE_PREFIX}v2`
const OFFLINE_URL = "/offline.html"
const PUBLIC_ASSETS = new Map([
  [OFFLINE_URL, "text/html"],
  ["/pwa-icon-192.png", "image/png"],
  ["/pwa-icon-512.png", "image/png"],
  ["/apple-touch-icon.png", "image/png"],
])

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME)
      for (const [path, type] of PUBLIC_ASSETS) {
        const request = new Request(new URL(path, self.location.origin), {
          credentials: "omit",
          cache: "no-store",
          redirect: "error",
        })
        const response = await fetch(request)
        if (
          !response.ok ||
          response.headers.get("content-type")?.split(";")[0] !== type
        )
          throw new Error("PUBLIC_SHELL_ASSET_UNAVAILABLE")
        await cache.put(request, response)
      }
      await self.skipWaiting()
    })()
  )
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await Promise.all(
        (await caches.keys())
          .filter(
            (name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME
          )
          .map((name) => caches.delete(name))
      )
      await self.clients.claim()
    })()
  )
})

self.addEventListener("fetch", (event) => {
  const request = event.request
  const url = new URL(request.url)
  // Writes use the normal network. No sync handlers, persistence or retry queue.
  if (request.method !== "GET" || url.origin !== self.location.origin) return

  const publicAsset =
    PUBLIC_ASSETS.has(url.pathname) &&
    !url.search &&
    !request.headers.has("RSC") &&
    !request.headers.has("Authorization")
  event.respondWith(
    (async () => {
      if (publicAsset) {
        const cached = await (await caches.open(CACHE_NAME)).match(request)
        if (cached) return cached
      }
      try {
        // Preserve cookies, redirects, authorization and online error responses.
        return await fetch(request, { cache: "no-store" })
      } catch (error) {
        // RSC/API/download failures must remain failures, never HTML masquerading as data.
        if (
          request.mode !== "navigate" ||
          request.headers.has("RSC") ||
          request.headers.has("Authorization") ||
          url.pathname === "/api" ||
          url.pathname.startsWith("/api/") ||
          /\.[^/]+$/.test(url.pathname)
        )
          throw error
        const fallback = await (
          await caches.open(CACHE_NAME)
        ).match(OFFLINE_URL)
        return fallback || Response.error()
      }
    })()
  )
})
