import { readFile, writeFile } from "node:fs/promises"
import { openPrivateFiles } from "../../lib/server/private-files/index.js"
import { digest } from "../../lib/server/private-files/validation.js"

const [mode, root, environmentId, manifest] = process.argv.slice(2)
const store = await openPrivateFiles({
  root,
  environmentId,
  forbiddenRoots: [process.cwd()],
  mayWrite: () => mode !== "read",
})
if (mode === "read") {
  const saved = JSON.parse(await readFile(manifest, "utf8"))
  const bytes = await store.readFinal(saved.key, saved.metadata)
  const inventory = await store.inventory()
  console.log(
    JSON.stringify({
      size: bytes.length,
      sha256: digest(bytes),
      finals: inventory.entries.filter((x) => x.kind === "final").length,
    })
  )
  await store.close()
} else if (mode === "crash") {
  const name = store.newStageKey("22222222-2222-4222-8222-222222222222")
  const bytes = Buffer.from("name,value\ncar,123\n")
  await writeFile(manifest, JSON.stringify({ stage: name }), {
    mode: 0o600,
    flag: "wx",
  })
  async function* interrupted() {
    yield bytes.subarray(0, 3)
    process.kill(process.pid, "SIGKILL")
    yield bytes.subarray(3)
  }
  await store.writeStage(name, interrupted(), {
    size: bytes.length,
    sha256: digest(bytes),
    mime: "text/csv",
    filename: "fixture.csv",
  })
} else if (mode === "write") {
  const intent = "22222222-2222-4222-8222-222222222222"
  const stage = store.newStageKey(intent)
  const key = store.newFinalKey(intent, "33333333-3333-4333-8333-333333333333")
  const bytes = Buffer.from("name,value\ncar,123\n")
  const declaration = {
    size: bytes.length,
    sha256: digest(bytes),
    mime: "text/csv",
    filename: "fixture.csv",
  }
  async function* source() {
    yield bytes
  }
  await store.writeStage(stage, source(), declaration)
  const token = await store.validateStage(stage, declaration)
  const metadata = await store.finalize(key, token)
  await writeFile(manifest, JSON.stringify({ key, metadata }), {
    mode: 0o600,
    flag: "wx",
  })
  await store.close()
  console.log(
    JSON.stringify({ size: bytes.length, sha256: digest(bytes), finals: 1 })
  )
} else {
  throw new Error("Expected write, read or crash")
}
// This executable has no listener, DB access, HTTP capability or cleanup path.
