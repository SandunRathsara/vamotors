import assert from "node:assert/strict"
import { readFile, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

// Resolve from the current app root so this same check can replay an untouched
// rejected checkout, without copying a test into or mutating that checkout.
const { digest, validateDocument } = await import(
  pathToFileURL(resolve("lib/server/private-files/validation.ts")).href
)

// Private copies only: the independent verifier's originals remain read-only.
const root = process.env.T06A_R2_FIXTURES
assert(root, "Set T06A_R2_FIXTURES to an own copy of extended/ and limits/")
const results = []
for (const group of ["extended", "limits"]) {
  const cases = JSON.parse(
    await readFile(join(root, group, "manifest.json"), "utf8")
  ) as { name: string; expected: boolean; sha256: string }[]
  for (const f of cases) {
    const bytes: Buffer = await readFile(join(root, group, f.name))
    assert.equal(digest(bytes), f.sha256)
    let accepted = false,
      error: string | undefined
    const start = Date.now()
    try {
      await validateDocument(bytes, {
        filename: f.name,
        size: bytes.length,
        sha256: f.sha256,
        mime: f.name.endsWith(".pdf") ? "application/pdf" : "image/webp",
      })
      accepted = true
    } catch (e) {
      assert(e instanceof Error)
      error = e.message
      assert.equal(error, "UPLOAD_MISMATCH")
      assert.equal("cause" in e, false)
    }
    const r = { ...f, accepted, error, ms: Date.now() - start }
    results.push(r)
    console.log(JSON.stringify(r))
  }
}
await writeFile(
  join(root, process.env.T06A_R2_RESULT ?? "r2-results.json"),
  JSON.stringify(results, null, 2),
  { mode: 0o600 }
)
const failures = results.filter((r) => r.accepted !== r.expected)
console.log(
  JSON.stringify({
    total: results.length,
    failures: failures.map((r) => r.name),
  })
)
assert.equal(failures.length, 0)
