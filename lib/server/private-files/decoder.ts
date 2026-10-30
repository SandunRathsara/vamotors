import { execFile, spawn } from "node:child_process"
import { realpathSync } from "node:fs"
import { join } from "node:path"
import { PrivateFileError } from "./validation"

let active = 0
/** Fixed local budget, not a queue or a user-configurable parser/plugin seam. */
export async function decodeDocument(
  bytes: Buffer,
  mime: string
): Promise<void> {
  if (active >= 2) throw new PrivateFileError("STORAGE_UNAVAILABLE")
  active++
  try {
    // A Next server bundle's import.meta.url names a generated chunk, not this
    // source directory. Workers are unbundled server assets in the app root.
    const directory = join(process.cwd(), "lib/server/private-files")
    const modules = realpathSync(join(process.cwd(), "node_modules"))
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          "--max-old-space-size=192",
          "--max-semi-space-size=8",
          "--permission",
          "--allow-addons",
          `--allow-fs-read=${modules}`,
          `--allow-fs-read=${join(process.cwd(), "node_modules")}`,
          `--allow-fs-read=${directory}`,
          join(directory, "document-worker.mjs"),
          mime,
        ],
        {
          // Do not inherit runtime secrets, NODE_OPTIONS or preload hooks.
          env: {
            NODE_ENV: "production",
            UV_THREADPOOL_SIZE: "1",
            VIPS_CONCURRENCY: "1",
          },
          stdio: ["pipe", "ignore", "ignore"],
        }
      )
      let failure: "UPLOAD_MISMATCH" | "STORAGE_UNAVAILABLE" | undefined
      let sampling = false
      const stop = (code: typeof failure = "UPLOAD_MISMATCH") => {
        failure = code
        child.kill("SIGKILL")
      }
      const deadline = setTimeout(() => stop(), 10_000)
      // Heap limits do not cover native image allocations/ArrayBuffers. Parent
      // RSS policing supplements explicit pixel/inflation limits, even if native
      // decoding blocks the child's event loop. This is not an OS security sandbox.
      const memory = setInterval(() => {
        if (!child.pid || sampling) return
        sampling = true
        execFile(
          "/bin/ps",
          ["-o", "rss=", "-p", String(child.pid)],
          { timeout: 1000, maxBuffer: 1024 },
          (error, stdout) => {
            sampling = false
            if (child.exitCode !== null || child.signalCode !== null) return
            // A just-exited/zombie child can disappear from ps before Node's
            // exit event is delivered. It has no resident allocation to police.
            if ((error && error.code === 1) || (!error && !stdout.trim()))
              return
            const rss = Number(stdout.trim())
            if (error || !Number.isFinite(rss) || rss < 0)
              stop("STORAGE_UNAVAILABLE")
            else if (rss > 384 * 1024) stop()
          }
        )
      }, 100)
      child.on("error", () => {
        failure = "STORAGE_UNAVAILABLE"
      })
      child.stdin.on("error", () => {
        /* EPIPE after rejection: exit status is authoritative. */
      })
      child.on("close", (code) => {
        clearTimeout(deadline)
        clearInterval(memory)
        if (!failure && code === 0) resolve()
        else
          reject(
            new PrivateFileError(
              failure ??
                (code === 65 ? "UPLOAD_MISMATCH" : "STORAGE_UNAVAILABLE")
            )
          )
      })
      child.stdin.end(bytes)
    })
  } catch (e) {
    if (e instanceof PrivateFileError) throw e
    throw new PrivateFileError("STORAGE_UNAVAILABLE")
  } finally {
    active--
  }
}
