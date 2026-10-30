import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import {
  cp,
  mkdir,
  mkdtemp,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises"
import { join, resolve } from "node:path"
import { test } from "node:test"
import { validFixtures } from "./fixtures.js"

const parent = process.env.T06A_TEST_PARENT
assert(parent)
const baseline = process.env.T06A_SUPERVISOR_BASELINE === "25da9d8"
for (const fault of baseline
  ? ["worker"]
  : ["worker", "module", "syntax", "export"])
  test(`missing/broken runtime ${fault} is STORAGE_UNAVAILABLE`, async () => {
    const run = await mkdtemp(join(parent, "infrastructure-")),
      dir = join(run, "lib/server/private-files")
    await mkdir(join(run, "lib/server"), { recursive: true, mode: 0o700 })
    await cp("lib/server/private-files", dir, { recursive: true })
    if (baseline) {
      const source = spawnSync(
        "git",
        [
          "show",
          "25da9d81e1c7158b84f4151ec90d817a33f5a56a:lib/server/private-files/decoder.ts",
        ],
        { encoding: "utf8" }
      )
      assert.equal(source.status, 0)
      await writeFile(join(dir, "decoder.ts"), source.stdout, { mode: 0o600 })
    }
    await symlink(resolve("node_modules"), join(run, "node_modules"))
    await writeFile(join(run, "package.json"), '{"type":"module"}', {
      mode: 0o600,
    })
    const f = (await validFixtures())[1]
    await writeFile(
      join(run, "probe.mjs"),
      `import {validateDocument,digest} from './lib/server/private-files/validation.ts';const b=Buffer.from('${f.bytes.toString("base64")}','base64');try{await validateDocument(b,{size:b.length,sha256:digest(b),mime:'image/png',filename:'probe.png'});console.log('OK')}catch(e){console.log(e.code)}`,
      { mode: 0o600 }
    )
    const probe = () => {
      const result = spawnSync(
        process.execPath,
        ["--import", "tsx", "probe.mjs"],
        { cwd: run, encoding: "utf8", timeout: 15_000 }
      )
      assert.equal(result.status, 0, result.stderr)
      return result.stdout.trim()
    }
    if (!baseline) assert.equal(probe(), "OK")
    if (fault === "syntax")
      await writeFile(
        join(dir, "document-worker.mjs"),
        "this is invalid JavaScript !",
        { mode: 0o600 }
      )
    else if (fault === "export")
      await writeFile(
        join(dir, "image-validation.mjs"),
        "export const validateImage=undefined",
        { mode: 0o600 }
      )
    else
      await unlink(
        join(
          dir,
          fault === "worker" ? "document-worker.mjs" : "image-validation.mjs"
        )
      )
    assert.equal(probe(), "STORAGE_UNAVAILABLE")
  })
