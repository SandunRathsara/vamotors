import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  symlink,
  truncate,
  unlink,
  writeFile,
} from "node:fs/promises"
import { join, resolve } from "node:path"
import { test } from "node:test"
import {
  openPrivateFiles,
  PrivateFileError,
  writeAll,
} from "../../lib/server/private-files/index.js"
import {
  digest,
  validateDocument,
} from "../../lib/server/private-files/validation.js"

const parent = process.env.T06A_TEST_PARENT
assert(
  parent && parent === resolve(parent),
  "Set an explicit absolute private T06A_TEST_PARENT outside Git/temp"
)
const parentStat = await lstat(parent)
assert(
  parentStat.isDirectory() &&
    !parentStat.isSymbolicLink() &&
    parentStat.uid === process.getuid!() &&
    (parentStat.mode & 0o777) === 0o700
)
const environmentId = "11111111-1111-4111-8111-111111111111"
const intent = "22222222-2222-4222-8222-222222222222"
const attempt = "33333333-3333-4333-8333-333333333333"
const bytes = Buffer.from("name,value\ncar,123\n")
const declaration = (
  b = bytes,
  mime = "text/csv",
  filename = "fixture.csv"
) => ({ size: b.length, sha256: digest(b), mime, filename })
async function* source(b = bytes) {
  yield b
}
const code = (expected: string) => (error: unknown) => {
  assert(error instanceof PrivateFileError)
  assert.equal(error.code, expected)
  assert.equal(error.message, expected)
  assert(!("cause" in error))
  return true
}
async function fixture() {
  const run = await mkdtemp(join(parent!, "t06a-run-"))
  const root = join(run, "bytes")
  await mkdir(root, { mode: 0o700 })
  const config = {
    root,
    environmentId,
    forbiddenRoots: [process.cwd()],
    mayWrite: () => true,
  }
  return { run, root, config, store: await openPrivateFiles(config) }
}
async function validated(
  store: Awaited<ReturnType<typeof openPrivateFiles>>,
  b = bytes
) {
  const key = store.newStageKey(intent)
  await store.writeStage(key, source(b), declaration(b))
  return { key, token: await store.validateStage(key, declaration(b)) }
}

test("exact validated snapshot, replay, immutable no-overwrite and independent reads", async () => {
  const { store, root } = await fixture()
  try {
    const { key: stage, token } = await validated(store)
    const final = store.newFinalKey(intent, attempt)
    // Actual staging mutation after validation must not change the private snapshot.
    await writeFile(join(root, stage), Buffer.from("name,value\ncar,999\n"))
    const metadata = await store.finalize(final, token)
    assert.deepEqual(await store.readFinal(final, metadata), bytes)
    assert.deepEqual(await store.finalize(final, token), metadata)
    const read = await store.readFinal(final, metadata)
    read.fill(0)
    assert.deepEqual(await store.readFinal(final, metadata), bytes)
    const other = await validated(store, Buffer.from("name,value\ncar,456\n"))
    await assert.rejects(
      store.finalize(final, other.token),
      code("FINAL_CONFLICT")
    )
    assert.deepEqual(await store.readFinal(final, metadata), bytes)
    await assert.rejects(
      store.finalize(store.newFinalKey(randomUUID(), attempt), token),
      code("UPLOAD_MISMATCH")
    )
    await assert.rejects(
      store.finalize(final, { metadata }),
      code("UPLOAD_MISMATCH")
    )
    await assert.rejects(
      store.writeStage(final, source(), declaration()),
      code("INVALID_KEY")
    )
    const inventory = await store.inventory()
    assert.equal(inventory.entries.filter((x) => x.kind === "final").length, 1)
    assert(inventory.entries.some((x) => x.kind === "attempt"))
    assert.equal((await lstat(join(root, final))).mode & 0o777, 0o600)
  } finally {
    await store.close()
  }
})

test("actual stream size/hash bounds, interrupted/zero writes and observable attempts", async () => {
  const { store, root } = await fixture()
  try {
    for (const b of [
      bytes.subarray(0, 3),
      Buffer.concat([bytes, bytes]),
      Buffer.from("name,value\ncar,999\n"),
    ]) {
      await assert.rejects(
        store.writeStage(store.newStageKey(intent), source(b), declaration()),
        code("UPLOAD_MISMATCH")
      )
    }
    async function* broken() {
      yield bytes.subarray(0, 3)
      throw new Error("private-path-secret")
    }
    await assert.rejects(
      store.writeStage(store.newStageKey(intent), broken(), declaration()),
      code("STORAGE_UNAVAILABLE")
    )
    const { key } = await validated(store)
    await truncate(join(root, key), 3)
    await assert.rejects(
      store.validateStage(key, declaration()),
      code("UPLOAD_MISMATCH")
    )
    await truncate(join(root, key), 5 * 1024 * 1024 + 1)
    await assert.rejects(
      store.validateStage(key, declaration()),
      code("UPLOAD_MISMATCH")
    )
    const growing = store.newStageKey(intent)
    async function* overrun() {
      yield Buffer.alloc(5 * 1024 * 1024)
      yield Buffer.alloc(1)
    }
    await assert.rejects(
      store.writeStage(growing, overrun(), {
        ...declaration(),
        size: 5 * 1024 * 1024,
      }),
      code("UPLOAD_MISMATCH")
    )
    const inventory = await store.inventory()
    assert(inventory.entries.some((x) => x.kind === "attempt" && x.size === 3))
    assert.equal((await store.inventory(1)).truncated, true)
    const file = await open(join(root, "partial-write-check"), "wx", 0o600)
    try {
      const original = file.write.bind(file)
      // Fault injection supplements the real-file interrupted/truncated tests.
      file.write = ((b: Buffer, offset: number, length: number) =>
        original(b, offset, Math.min(length, 2))) as typeof file.write
      await writeAll(file, bytes)
      assert.deepEqual(await readFile(join(root, "partial-write-check")), bytes)
      file.write = (async (buffer: Buffer) => ({
        bytesWritten: 0,
        buffer,
      })) as typeof file.write
      await assert.rejects(writeAll(file, bytes), code("STORAGE_UNAVAILABLE"))
    } finally {
      await file.close()
      await unlink(join(root, "partial-write-check"))
    }
  } finally {
    await store.close()
  }
})

test("concurrent creates/finalizers never clobber bytes", async () => {
  const { store, config } = await fixture()
  const second = await openPrivateFiles(config)
  try {
    const stage = store.newStageKey(intent)
    const result = await Promise.allSettled([
      store.writeStage(stage, source(), declaration()),
      second.writeStage(
        stage,
        source(Buffer.from("name,value\ncar,456\n")),
        declaration(Buffer.from("name,value\ncar,456\n"))
      ),
    ])
    assert.equal(result.filter((x) => x.status === "fulfilled").length, 1)
    const { token } = await validated(store)
    const key = store.newFinalKey(intent, attempt)
    await Promise.all(
      Array.from({ length: 8 }, () => store.finalize(key, token))
    )
    assert.deepEqual(await second.readFinal(key, token.metadata), bytes)
    assert.equal(
      (await second.inventory()).entries.filter((x) => x.kind === "final")
        .length,
      1
    )
  } finally {
    await store.close()
    await second.close()
  }
})

test("traversal, absolute aliases, foreign environment, symlinks, non-files and private modes", async () => {
  const { store, root, run, config } = await fixture()
  try {
    for (const key of [
      "../escape",
      "/etc/passwd",
      "a/../b",
      "x\\y",
      "",
      "s." + "0".repeat(36),
      `s.${randomUUID()}.${intent}.${randomUUID()}`,
    ]) {
      await assert.rejects(
        store.writeStage(key, source(), declaration()),
        code("INVALID_KEY")
      )
    }
    const outside = join(run, "outside")
    await writeFile(outside, bytes, { mode: 0o600, flag: "wx" })
    const stage = store.newStageKey(intent)
    await symlink(outside, join(root, stage))
    await assert.rejects(
      store.validateStage(stage, declaration()),
      code("UNSAFE_STORAGE")
    )
    await assert.rejects(
      store.writeStage(stage, source(), declaration()),
      code("UNSAFE_STORAGE")
    )
    assert.deepEqual(await readFile(outside), bytes)
    await assert.rejects(store.inventory(), code("UNSAFE_STORAGE"))
    await unlink(join(root, stage))
    const directoryKey = store.newStageKey(intent)
    await mkdir(join(root, directoryKey), { mode: 0o700 })
    await assert.rejects(
      store.validateStage(directoryKey, declaration()),
      code("UNSAFE_STORAGE")
    )
    const { key, token } = await validated(store)
    await chmod(join(root, key), 0o644)
    await assert.rejects(
      store.validateStage(key, declaration()),
      code("UNSAFE_STORAGE")
    )
    const final = store.newFinalKey(intent, attempt)
    await symlink(outside, join(root, final))
    await assert.rejects(store.finalize(final, token), code("UNSAFE_STORAGE"))
    await chmod(root, 0o755)
    await assert.rejects(openPrivateFiles(config), code("UNSAFE_STORAGE"))
    await assert.rejects(store.inventory(), code("UNSAFE_STORAGE"))
    await chmod(root, 0o700)
    const alias = join(run, "alias")
    await symlink(root, alias)
    await assert.rejects(
      openPrivateFiles({ ...config, root: alias }),
      code("UNSAFE_STORAGE")
    )
    await assert.rejects(
      openPrivateFiles({ ...config, root: root + "/../bytes" }),
      code("UNSAFE_STORAGE")
    )
    await assert.rejects(
      openPrivateFiles({ ...config, root: "/tmp/not-created" }),
      code("UNSAFE_STORAGE")
    )
    await assert.rejects(
      openPrivateFiles({ ...config, forbiddenRoots: [run] }),
      code("UNSAFE_STORAGE")
    )
    await rename(root, join(run, "moved"))
    await symlink(join(run, "moved"), root)
    await assert.rejects(
      store.readFinal(final, token.metadata),
      code("UNSAFE_STORAGE")
    )
  } finally {
    await store.close()
  }
})

test("leaf symlink swap races never read/write an outside target", async () => {
  const { store, root, run } = await fixture()
  try {
    const target = join(run, "outside")
    const outside = Buffer.from("private outside marker")
    await writeFile(target, outside, { mode: 0o600, flag: "wx" })
    for (let i = 0; i < 25; i++) {
      const stage = store.newStageKey(intent)
      const operation = store.writeStage(stage, source(), declaration())
      const swap = symlink(target, join(root, stage)).catch((e) => {
        assert.equal(e.code, "EEXIST")
      })
      const result = await Promise.allSettled([operation, swap])
      assert.deepEqual(await readFile(target), outside)
      if (result[0].status === "rejected")
        assert(result[0].reason instanceof PrivateFileError)
      await unlink(join(root, stage))
    }
  } finally {
    await store.close()
  }
})

test("quota and unavailable policy stop writes, not retained reads; final tamper detection", async () => {
  const { store, config, root } = await fixture()
  const { token } = await validated(store)
  const key = store.newFinalKey(intent, attempt)
  await store.finalize(key, token)
  await store.close()
  const stopped = await openPrivateFiles({ ...config, mayWrite: () => false })
  try {
    await assert.rejects(
      stopped.writeStage(stopped.newStageKey(intent), source(), declaration()),
      code("QUOTA_STOP")
    )
    assert.deepEqual(await stopped.readFinal(key, token.metadata), bytes)
    await assert.rejects(
      stopped.readFinal(key, { ...token.metadata, sha256: "0".repeat(64) }),
      code("UPLOAD_MISMATCH")
    )
    await writeFile(join(root, key), Buffer.from("name,value\ncar,999\n"))
    await assert.rejects(
      stopped.readFinal(key, token.metadata),
      code("UPLOAD_MISMATCH")
    )
  } finally {
    await stopped.close()
  }
  const broken = await openPrivateFiles({
    ...config,
    mayWrite: () => {
      throw new Error("secret-path")
    },
  })
  try {
    await assert.rejects(
      broken.writeStage(broken.newStageKey(intent), source(), declaration()),
      code("STORAGE_UNAVAILABLE")
    )
  } finally {
    await broken.close()
  }
})

test("capacity revocation during transfer prevents publication and preserves the partial attempt", async () => {
  const { store, config } = await fixture()
  await store.close()
  let allowed = true
  const changing = await openPrivateFiles({
    ...config,
    mayWrite: () => allowed,
  })
  try {
    const key = changing.newStageKey(intent)
    async function* transfer() {
      yield bytes
      allowed = false
    }
    await assert.rejects(
      changing.writeStage(key, transfer(), declaration()),
      code("QUOTA_STOP")
    )
    const inventory = await changing.inventory()
    assert.equal(inventory.entries.filter((x) => x.kind === "stage").length, 0)
    assert.equal(
      inventory.entries.filter((x) => x.kind === "attempt").length,
      1
    )
    await assert.rejects(
      changing.validateStage(key, declaration()),
      code("DOCUMENT_NOT_READY")
    )
  } finally {
    await changing.close()
  }
})

test("CSV parses content, not extension: strict syntax, formula/polyglot and resource bounds", () => {
  for (const valid of [
    bytes,
    Buffer.from('name,value\r\n"car, van","a""b"\r\n'),
  ])
    validateDocument(valid, declaration(valid))
  for (const invalid of [
    "<html>,value\ncar,123\n",
    "name,value\ncar,=1+1\n",
    "name,value\ncar,@evil\n",
    "name,value\ncar,123",
    'name,value\n"unterminated,1\n',
    'name,value\n"a"x,1\n',
    "name,value\na,b,c\n",
    "single\ncolumn\n",
    "a,b\r1,2\r",
    "a,b\n\u00001,2\n",
    "a,b\n" + "x".repeat(8193) + ",1\n",
    "a,b\n" + "1,2\n".repeat(10000),
    Array(129).fill("x").join(",") +
      "\n" +
      Array(129).fill("1").join(",") +
      "\n",
  ]) {
    const b = Buffer.from(invalid)
    assert.throws(
      () => validateDocument(b, declaration(b)),
      code("UPLOAD_MISMATCH")
    )
  }
  for (const change of [
    { size: bytes.length + 1 },
    { sha256: "0".repeat(64) },
    { mime: "text/html" },
    { filename: "../fixture.csv" },
    { filename: "fixture.exe" },
    { size: 5 * 1024 * 1024 + 1 },
  ]) {
    assert.throws(
      () => validateDocument(bytes, { ...declaration(), ...change }),
      code("UPLOAD_MISMATCH")
    )
  }
})

test("JPEG/PNG/WebP/PDF/XLSX explicitly unsupported, including encrypted/truncated/bomb candidates", async () => {
  const { store } = await fixture()
  try {
    for (const [mime, filename, prefix] of [
      ["image/jpeg", "x.jpg", "\xff\xd8\xff"],
      ["image/png", "x.png", "\x89PNG\r\n\x1a\n"],
      ["image/webp", "x.webp", "RIFF0000WEBP"],
      ["application/pdf", "x.pdf", "%PDF-1.7\n/Encrypt /Count 51\n%%EOF"],
      [
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "x.xlsx",
        "PK\x03\x04",
      ],
    ]) {
      const b = Buffer.from(prefix, "latin1")
      assert.throws(
        () => validateDocument(b, declaration(b, mime, filename)),
        code("UNSUPPORTED_VALIDATION")
      )
      assert.throws(
        () => validateDocument(bytes, declaration(bytes, mime, filename)),
        code("UNSUPPORTED_VALIDATION")
      )
      const stage = store.newStageKey(intent)
      await store.writeStage(stage, source(b), declaration(b, mime, filename))
      await assert.rejects(
        store.validateStage(stage, declaration(b, mime, filename)),
        code("UNSUPPORTED_VALIDATION")
      )
    }
    for (const [mime, filename] of [
      ["image/svg+xml", "x.svg"],
      ["text/html", "x.html"],
      ["application/x-executable", "x.exe"],
    ]) {
      assert.throws(
        () => validateDocument(bytes, declaration(bytes, mime, filename)),
        code("UPLOAD_MISMATCH")
      )
    }
  } finally {
    await store.close()
  }
})

function child(mode: string, root: string, manifest: string) {
  return spawnSync(
    process.execPath,
    [
      "--conditions=react-server",
      "--import",
      "tsx",
      "tests/private-files/restart.ts",
      mode,
      root,
      environmentId,
      manifest,
    ],
    { encoding: "utf8" }
  )
}
test("stop/restart in separate processes retains exact hash/size/count; SIGKILL leaves inventoried partial attempt", async () => {
  const { root, run, store, config } = await fixture()
  await store.close()
  const manifest = join(run, "checkpoint.json")
  const written = child("write", root, manifest)
  assert.equal(written.status, 0, written.stderr)
  const read = child("read", root, manifest)
  assert.equal(read.status, 0, read.stderr)
  assert.deepEqual(JSON.parse(read.stdout), JSON.parse(written.stdout))
  assert.deepEqual(JSON.parse(read.stdout), {
    size: bytes.length,
    sha256: digest(bytes),
    finals: 1,
  })
  const interrupted = child("crash", root, join(run, "interrupted.json"))
  assert.equal(interrupted.signal, "SIGKILL")
  const reopened = await openPrivateFiles(config)
  try {
    const inventory = await reopened.inventory()
    assert(inventory.entries.some((x) => x.kind === "attempt" && x.size === 3))
    const failedStage = JSON.parse(
      await readFile(join(run, "interrupted.json"), "utf8")
    ).stage
    await assert.rejects(
      reopened.validateStage(failedStage, declaration()),
      code("DOCUMENT_NOT_READY")
    )
    await reopened.writeStage(failedStage, source(), declaration())
    await reopened.validateStage(failedStage, declaration())
  } finally {
    await reopened.close()
  }
  console.log(
    `retained evidence: bytes=${bytes.length} sha256=${digest(bytes)} finals=1`
  )
})

// No recursive cleanup: every t06a-run-* private fixture is retained for review.
