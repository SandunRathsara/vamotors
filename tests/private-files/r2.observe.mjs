// Observe, do not replace, the real supervisor's child exits and /bin/ps samples.
import assert from "node:assert/strict"
import cp from "node:child_process"
import { syncBuiltinESMExports } from "node:module"
import { readFile, writeFile } from "node:fs/promises"
import { resolve, join } from "node:path"
import { pathToFileURL } from "node:url"

const root = process.env.T06A_R2_FIXTURES
assert(root)
const results = []
let current
const spawn = cp.spawn,
  execFile = cp.execFile
cp.spawn = function (...args) {
  const child = Reflect.apply(spawn, this, args)
  const result = current
  if (args[0] === process.execPath)
    child.once("close", (code, signal) =>
      Object.assign(result, { code, signal })
    )
  return child
}
cp.execFile = function (...args) {
  const callback = args.at(-1),
    result = current
  if (args[0] === "/bin/ps" && typeof callback === "function")
    args[args.length - 1] = (error, stdout, stderr) => {
      if (!error)
        result.peakSampledKiB = Math.max(
          result.peakSampledKiB,
          Number(stdout.trim()) || 0
        )
      callback(error, stdout, stderr)
    }
  return Reflect.apply(execFile, this, args)
}
syncBuiltinESMExports()
const { validateDocument, digest } = await import(
  pathToFileURL(resolve("lib/server/private-files/validation.ts")).href
)
for (const name of [
  "16mp-False-False.webp",
  "16mp-False-True.webp",
  "16mp-True-False.webp",
  "16mp-True-True.webp",
]) {
  current = { name, accepted: false, peakSampledKiB: 0 }
  results.push(current)
  const bytes = await readFile(join(root, "limits", name)),
    start = Date.now()
  try {
    await validateDocument(bytes, {
      filename: name,
      mime: "image/webp",
      size: bytes.length,
      sha256: digest(bytes),
    })
    current.accepted = true
  } catch (e) {
    assert.equal(e.message, "UPLOAD_MISMATCH")
  }
  current.ms = Date.now() - start
}
console.log(JSON.stringify(results, null, 2))
await writeFile(
  join(root, process.env.T06A_R2_RESULT ?? "worker-observation.json"),
  JSON.stringify(results, null, 2),
  { mode: 0o600 }
)
assert(results.every((r) => r.accepted === !process.env.T06A_R2_EXPECT_RED))
