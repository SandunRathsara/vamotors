import "server-only"
import { randomUUID } from "node:crypto"
import { runtimeConfig } from "./config"
import { fail, publicError } from "./errors"
export function sameOrigin(request: Request) {
  if (request.headers.get("origin") !== runtimeConfig().APP_ORIGIN)
    fail("FORBIDDEN", 403)
}
export async function boundedJSON(request: Request) {
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    fail("INVALID_INPUT", 415)
  const reader = request.body?.getReader()
  if (!reader) fail("INVALID_INPUT", 400)
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    size += chunk.value.byteLength
    if (size > 1048576) {
      await reader.cancel()
      fail("INVALID_INPUT", 413)
    }
    chunks.push(chunk.value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    ) as unknown
  } catch {
    fail("INVALID_INPUT", 400)
  }
}
export async function endpoint(run: () => Promise<Response>) {
  try {
    return await run()
  } catch (error) {
    return publicError(error, randomUUID())
  }
}
export function noStoreJSON(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "private,no-store" },
  })
}
