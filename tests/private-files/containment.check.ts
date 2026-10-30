import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { test } from "node:test"
import sharp from "sharp"
import {
  PrivateFileError,
  digest,
  validateDocument,
} from "../../lib/server/private-files/validation.js"

test("two real decoder children are capacity-bounded; a stopped native worker is killed at the fixed deadline", async () => {
  const bytes = await sharp({
    create: { width: 4000, height: 4000, channels: 3, background: "red" },
  })
    .png()
    .toBuffer()
  const declared = {
    size: bytes.length,
    sha256: digest(bytes),
    mime: "image/png",
    filename: "bounded.png",
  }
  const started = Date.now()
  const first = validateDocument(bytes, declared)
  const second = validateDocument(bytes, declared)
  // Attach rejection handlers before intentionally stopping our own children.
  const settled = Promise.allSettled([first, second])
  const listing = spawnSync("/bin/ps", ["-axo", "pid=,ppid=,command="], {
    encoding: "utf8",
    timeout: 1000,
  })
  assert.equal(listing.status, 0)
  const children = listing.stdout
    .split("\n")
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line))
    .filter(
      (match) =>
        match &&
        Number(match[2]) === process.pid &&
        match[3].includes("/document-worker.mjs")
    )
  assert.equal(children.length, 2)
  let pending = true
  try {
    for (const child of children) process.kill(Number(child![1]), "SIGSTOP")
    await assert.rejects(
      validateDocument(bytes, declared),
      (e: unknown) =>
        e instanceof PrivateFileError && e.code === "STORAGE_UNAVAILABLE"
    )
    const results = await settled
    pending = false
    for (const result of results) {
      assert.equal(result.status, "rejected")
      if (result.status === "rejected") {
        assert(result.reason instanceof PrivateFileError)
        assert.equal(result.reason.code, "UPLOAD_MISMATCH")
      }
    }
    assert(Date.now() - started >= 9500)
    assert(Date.now() - started < 13_000)
    // Capacity is released after termination and the genuine decoder still works.
    await validateDocument(bytes, declared)
  } finally {
    for (const child of pending ? children : []) {
      try {
        process.kill(Number(child![1]), "SIGKILL")
      } catch {
        /* Already reaped by supervisor. */
      }
    }
  }
})
