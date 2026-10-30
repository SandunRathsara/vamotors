import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { after, test } from "node:test"
import { openPrivateFiles } from "../../lib/server/private-files/index.js"
import {
  digest,
  validateDocument,
  PrivateFileError,
} from "../../lib/server/private-files/validation.js"

const root = process.env.T06A_REVIEW_FIXTURES
assert(
  root,
  "Set T06A_REVIEW_FIXTURES to an own private copy of the independent corpus"
)
assert.equal(
  await readFile(join(root, ".author-owned-copy"), "utf8"),
  "t06a2-corrections\n"
)
const manifest = JSON.parse(
  await readFile(join(root, "fixtures-manifest.json"), "utf8")
) as { name: string; sha256: string; expected: boolean }[]
const mimes: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
}
const results: unknown[] = []
const run = await mkdtemp(join(root, "independent-io-")),
  bytesRoot = join(run, "bytes")
await mkdir(bytesRoot, { mode: 0o700 })
const environmentId = "11111111-1111-4111-8111-111111111111"
const store = await openPrivateFiles({
  root: bytesRoot,
  environmentId,
  forbiddenRoots: [process.cwd()],
  mayWrite: () => true,
})
after(async () => {
  await store.close()
  console.log(`retained independent IO: ${run}`)
})
for (const f of manifest)
  test(f.name, async () => {
    const bytes = await readFile(join(root, "fixtures", f.name))
    assert.equal(digest(bytes), f.sha256)
    let accepted = false
    try {
      await validateDocument(bytes, {
        size: bytes.length,
        sha256: digest(bytes),
        mime: mimes[f.name.split(".").at(-1)!],
        filename: f.name,
      })
      accepted = true
    } catch (e) {
      assert(e instanceof PrivateFileError)
      assert.equal(e.code, "UPLOAD_MISMATCH")
    }
    results.push({ name: f.name, accepted, expected: f.expected })
    await writeFile(
      join(root, "author-results.json"),
      JSON.stringify(results, null, 2),
      { mode: 0o600 }
    )
    assert.equal(accepted, f.expected, f.name)
    if (accepted) {
      const intent = randomUUID(),
        stage = store.newStageKey(intent),
        final = store.newFinalKey(intent, randomUUID())
      const d = {
        size: bytes.length,
        sha256: digest(bytes),
        mime: mimes[f.name.split(".").at(-1)!],
        filename: f.name,
      }
      await store.writeStage(
        stage,
        (async function* () {
          yield bytes
        })(),
        d
      )
      const snapshot = await store.validateStage(stage, d)
      await writeFile(join(bytesRoot, stage), Buffer.from("staging changed"))
      const metadata = await store.finalize(final, snapshot)
      assert.deepEqual(await store.readFinal(final, metadata), bytes)
      assert.deepEqual(await store.finalize(final, snapshot), metadata)
      const checkpoint = join(run, f.name + ".json")
      await writeFile(checkpoint, JSON.stringify({ key: final, metadata }), {
        mode: 0o600,
        flag: "wx",
      })
      const restarted = spawnSync(
        process.execPath,
        [
          "--conditions=react-server",
          "--import",
          "tsx",
          "tests/private-files/restart.ts",
          "read",
          bytesRoot,
          environmentId,
          checkpoint,
        ],
        { encoding: "utf8", timeout: 15_000 }
      )
      assert.equal(restarted.status, 0, restarted.stderr)
      assert.equal(JSON.parse(restarted.stdout).sha256, f.sha256)
    }
  })
