import "server-only"
import { constants } from "node:fs"
import {
  lstat,
  open,
  link,
  opendir,
  realpath,
  type FileHandle,
} from "node:fs/promises"
import { createHash, randomUUID } from "node:crypto"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { tmpdir } from "node:os"
import {
  checkDeclaration,
  digest,
  PrivateFileError,
  validateDocument,
  type Declaration,
} from "./validation.js"

export { PrivateFileError, type Declaration } from "./validation.js"

const uuid = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}"
const idPattern = new RegExp(`^${uuid}$`)
const stagePattern = new RegExp(`^s\\.(${uuid})\\.(${uuid})\\.(${uuid})$`)
const finalPattern = new RegExp(
  `^f\\.(${uuid})\\.(${uuid})\\.(${uuid})\\.(${uuid})$`
)
const pendingPattern = new RegExp(`^p\\.(${uuid})\\.(?:s|f)\\.`)
const maxBytes = 5 * 1024 * 1024
const readFlags =
  constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK

export type PrivateFilesConfig = {
  /** Existing dedicated durable directory, current UID, exactly 0700. */
  root: string
  environmentId: string
  /** Include every checkout/public/static directory applicable to the runtime. */
  forbiddenRoots: readonly string[]
  /** Must consult the operator's current capacity policy; unknown means false. */
  mayWrite: () => boolean | Promise<boolean>
}

export type FileMetadata = {
  size: number
  sha256: string
  mime: string
}

/** Opaque in-process authority; bytes remain exclusively inside a WeakMap. */
export type ValidatedBytes = Readonly<{ metadata: Readonly<FileMetadata> }>

function within(parent: string, child: string): boolean {
  const r = relative(parent, child)
  return r === "" || (r !== ".." && !r.startsWith(`..${sep}`) && !isAbsolute(r))
}

function fail(code: ConstructorParameters<typeof PrivateFileError>[0]): never {
  throw new PrivateFileError(code)
}

/** No OS error/cause/path is exposed, including errors thrown by quota hooks. */
async function safe<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof PrivateFileError) throw error
    fail("STORAGE_UNAVAILABLE")
  }
}

function errno(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException)?.code === code
}

/** Loop until complete: write() is allowed to make progress shorter than input. */
export async function writeAll(file: FileHandle, bytes: Buffer): Promise<void> {
  let offset = 0
  while (offset < bytes.length) {
    const { bytesWritten } = await file.write(
      bytes,
      offset,
      bytes.length - offset
    )
    if (bytesWritten <= 0) fail("STORAGE_UNAVAILABLE")
    offset += bytesWritten
  }
}

export async function openPrivateFiles(config: PrivateFilesConfig) {
  return safe(async () => {
    const { root, environmentId, mayWrite } = config
    if (
      !isAbsolute(root) ||
      resolve(root) !== root ||
      !idPattern.test(environmentId) ||
      !config.forbiddenRoots.length ||
      !process.getuid ||
      !constants.O_NOFOLLOW
    )
      fail("UNSAFE_STORAGE")
    const uid = process.getuid()
    const forbidden = [
      tmpdir(),
      "/tmp",
      "/private/tmp",
      "/var/tmp",
      ...config.forbiddenRoots,
    ]
    for (const path of forbidden) {
      if (!isAbsolute(path)) fail("UNSAFE_STORAGE")
      if (within(resolve(path), root) || within(root, resolve(path)))
        fail("UNSAFE_STORAGE")
      let canonical = resolve(path)
      try {
        canonical = await realpath(path)
      } catch (error) {
        if (!errno(error, "ENOENT")) throw error
      }
      if (within(canonical, root) || within(root, canonical))
        fail("UNSAFE_STORAGE")
    }
    // Flat namespace: there are no user-controlled intermediate directories.
    // Ancestors must be trusted and non-writable by other unprivileged users.
    let parent = root
    while (true) {
      const stat = await lstat(parent)
      if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        (stat.uid !== uid && stat.uid !== 0) ||
        (stat.mode & 0o022) !== 0
      )
        fail("UNSAFE_STORAGE")
      try {
        await lstat(join(parent, ".git"))
        fail("UNSAFE_STORAGE")
      } catch (error) {
        if (!errno(error, "ENOENT")) throw error
      }
      if (["public", "static"].includes(parent.split(sep).at(-1) ?? ""))
        fail("UNSAFE_STORAGE")
      if (dirname(parent) === parent) break
      parent = dirname(parent)
    }
    const initial = await lstat(root)
    if (initial.uid !== uid || (initial.mode & 0o777) !== 0o700)
      fail("UNSAFE_STORAGE")
    const directory = await open(root, readFlags | constants.O_DIRECTORY)
    const held = await directory.stat()
    if (held.ino !== initial.ino || held.dev !== initial.dev) {
      await directory.close()
      fail("UNSAFE_STORAGE")
    }
    const validated = new WeakMap<
      ValidatedBytes,
      { bytes: Buffer; intent: string }
    >()
    let closed = false
    const assertRoot = async () => {
      if (closed) fail("STORAGE_UNAVAILABLE")
      const now = await lstat(root)
      if (
        !now.isDirectory() ||
        now.isSymbolicLink() ||
        now.ino !== held.ino ||
        now.dev !== held.dev ||
        now.uid !== uid ||
        (now.mode & 0o777) !== 0o700
      )
        fail("UNSAFE_STORAGE")
    }
    const key = (value: string, pattern: RegExp) => {
      const match = pattern.exec(value)
      if (!match || match[1] !== environmentId) fail("INVALID_KEY")
      return match
    }
    const writable = async () => {
      await assertRoot()
      if ((await mayWrite()) !== true) fail("QUOTA_STOP")
    }
    const read = async (name: string, expected?: FileMetadata) => {
      await assertRoot()
      let file: FileHandle
      try {
        file = await open(join(root, name), readFlags)
      } catch (error) {
        if (errno(error, "ENOENT")) fail("DOCUMENT_NOT_READY")
        if (errno(error, "ELOOP")) fail("UNSAFE_STORAGE")
        throw error
      }
      try {
        const before = await file.stat()
        if (
          !before.isFile() ||
          before.uid !== uid ||
          (before.mode & 0o777) !== 0o600
        )
          fail("UNSAFE_STORAGE")
        if (before.size < 1 || before.size > maxBytes) fail("UPLOAD_MISMATCH")
        // Never readFile(): a concurrently growing file must not allocate unbounded memory.
        const bytes = Buffer.alloc(before.size)
        let offset = 0
        while (offset < bytes.length) {
          const { bytesRead } = await file.read(
            bytes,
            offset,
            bytes.length - offset,
            offset
          )
          if (!bytesRead) fail("UPLOAD_MISMATCH")
          offset += bytesRead
        }
        const extra = await file.read(Buffer.alloc(1), 0, 1, offset)
        const after = await file.stat()
        if (
          extra.bytesRead ||
          after.size !== before.size ||
          after.mtimeMs !== before.mtimeMs ||
          after.ctimeMs !== before.ctimeMs
        )
          fail("UPLOAD_MISMATCH")
        if (
          expected &&
          (expected.size !== bytes.length || expected.sha256 !== digest(bytes))
        )
          fail("UPLOAD_MISMATCH")
        await assertRoot()
        return bytes
      } finally {
        await file.close()
      }
    }
    const publish = async (
      name: string,
      source: AsyncIterable<Uint8Array>,
      expected: { size: number; sha256: string }
    ) => {
      await writable()
      // A failed/crashed attempt stays visible; no automatic deletion of any bytes.
      const pending = `p.${randomUUID()}.${name}`
      const pendingPath = join(root, pending)
      const file = await open(
        pendingPath,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600
      )
      try {
        let size = 0
        const hash = createHash("sha256")
        let chunks = 0
        for await (const part of source) {
          if (!(part instanceof Uint8Array)) fail("UPLOAD_MISMATCH")
          if (++chunks > 65536) fail("UPLOAD_MISMATCH")
          size += part.byteLength
          if (size > expected.size || size > maxBytes) fail("UPLOAD_MISMATCH")
          const copy = Buffer.from(part)
          hash.update(copy)
          await writeAll(file, copy)
        }
        if (size !== expected.size || hash.digest("hex") !== expected.sha256)
          fail("UPLOAD_MISMATCH")
        await file.sync()
      } finally {
        await file.close()
        await directory.sync()
      }
      await writable()
      // link is atomic create-if-absent on the required local filesystem, unlike rename.
      try {
        await link(pendingPath, join(root, name))
      } catch (error) {
        if (!errno(error, "EEXIST")) throw error
        const existing = await read(name)
        if (
          existing.length !== expected.size ||
          digest(existing) !== expected.sha256
        )
          fail("FINAL_CONFLICT")
      }
      await directory.sync()
      await read(name, { ...expected, mime: "" })
    }
    return {
      newStageKey(intentId: string): string {
        if (!idPattern.test(intentId)) fail("INVALID_KEY")
        return `s.${environmentId}.${intentId}.${randomUUID()}`
      },
      newFinalKey(intentId: string, attemptId: string): string {
        if (!idPattern.test(intentId) || !idPattern.test(attemptId))
          fail("INVALID_KEY")
        return `f.${environmentId}.${intentId}.${attemptId}.${randomUUID()}`
      },
      writeStage(
        name: string,
        source: AsyncIterable<Uint8Array>,
        declaration: Declaration
      ): Promise<void> {
        return safe(async () => {
          key(name, stagePattern)
          const declared = { ...declaration }
          checkDeclaration(declared)
          await publish(name, source, declared)
        })
      },
      validateStage(
        name: string,
        declaration: Declaration
      ): Promise<ValidatedBytes> {
        return safe(async () => {
          const match = key(name, stagePattern)
          const declared = { ...declaration }
          checkDeclaration(declared)
          const bytes = await read(name, declared)
          await validateDocument(bytes, declared)
          const token = Object.freeze({
            metadata: Object.freeze({
              size: bytes.length,
              sha256: digest(bytes),
              mime: declared.mime,
            }),
          })
          validated.set(token, { bytes, intent: match[2] })
          return token
        })
      },
      finalize(name: string, token: ValidatedBytes): Promise<FileMetadata> {
        return safe(async () => {
          const match = key(name, finalPattern)
          const value = validated.get(token)
          if (!value || value.intent !== match[2]) fail("UPLOAD_MISMATCH")
          async function* source() {
            yield value!.bytes
          }
          await publish(name, source(), token.metadata)
          return { ...token.metadata }
        })
      },
      readFinal(name: string, expected: FileMetadata): Promise<Buffer> {
        return safe(async () => {
          key(name, finalPattern)
          const metadata = { ...expected }
          const bytes = await read(name, metadata)
          // Metadata is authoritative only when supplied from the persisted validated attempt.
          const extensions: Record<string, string> = {
            "text/csv": "csv",
            "image/jpeg": "jpg",
            "image/png": "png",
            "image/webp": "webp",
            "application/pdf": "pdf",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
              "xlsx",
          }
          await validateDocument(bytes, {
            ...metadata,
            filename: `retained.${extensions[metadata.mime] ?? "unsupported"}`,
          })
          return bytes
        })
      },
      inventory(limit = 1000): Promise<{
        entries: {
          key: string
          kind: "stage" | "final" | "attempt"
          size: number
          modifiedAt: string
        }[]
        truncated: boolean
      }> {
        return safe(async () => {
          await assertRoot()
          if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10000)
            fail("INVALID_KEY")
          const entries: {
            key: string
            kind: "stage" | "final" | "attempt"
            size: number
            modifiedAt: string
          }[] = []
          for await (const entry of await opendir(root)) {
            if (entries.length === limit) return { entries, truncated: true }
            const name = entry.name
            let kind: "stage" | "final" | "attempt"
            if (stagePattern.test(name)) {
              key(name, stagePattern)
              kind = "stage"
            } else if (finalPattern.test(name)) {
              key(name, finalPattern)
              kind = "final"
            } else if (pendingPattern.test(name)) {
              const target = name.slice(39)
              key(target, target.startsWith("s.") ? stagePattern : finalPattern)
              kind = "attempt"
            } else fail("UNSAFE_STORAGE")
            const stat = await lstat(join(root, name))
            if (
              !stat.isFile() ||
              stat.isSymbolicLink() ||
              stat.uid !== uid ||
              (stat.mode & 0o777) !== 0o600
            )
              fail("UNSAFE_STORAGE")
            entries.push({
              key: name,
              kind,
              size: stat.size,
              modifiedAt: stat.mtime.toISOString(),
            })
          }
          await assertRoot()
          return { entries, truncated: false }
        })
      },
      async close(): Promise<void> {
        return safe(async () => {
          if (!closed) {
            closed = true
            await directory.close()
          }
        })
      },
    }
  })
}

export type PrivateFiles = Awaited<ReturnType<typeof openPrivateFiles>>
