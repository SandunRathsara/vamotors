import { readFile, stat } from "node:fs/promises"
import { parseEnv } from "node:util"

/** Private operational files only; never print contents or original exceptions. */
export async function privateEnvironment(path: string) {
  const info = await stat(path)
  if (
    !info.isFile() ||
    (info.mode & 0o077) !== 0 ||
    info.uid !== process.getuid?.()
  )
    throw new Error("PRIVATE_FILE_REQUIRED")
  return parseEnv(await readFile(path, "utf8"))
}
export function authorizedMigration(env: Record<string, string | undefined>) {
  if (
    env.APP_ENV !== "disposable-test" ||
    !env.ENVIRONMENT_ID ||
    env.T03_DISPOSABLE_AUTHORIZATION !== env.ENVIRONMENT_ID ||
    !env.DIRECT_URL ||
    !env.T03_DISPOSABLE_HOST ||
    !env.T03_DISPOSABLE_DATABASE
  )
    throw new Error("DISPOSABLE_AUTHORIZATION_REQUIRED")
  const url = new URL(env.DIRECT_URL)
  if (
    decodeURIComponent(url.username) !== "vamotors_migrator" ||
    url.hostname !== env.T03_DISPOSABLE_HOST ||
    decodeURIComponent(url.pathname.slice(1)) !== env.T03_DISPOSABLE_DATABASE ||
    url.searchParams.has("options") ||
    !["require", "verify-full"].includes(url.searchParams.get("sslmode") ?? "")
  )
    throw new Error("MIGRATOR_TARGET_MISMATCH")
  return env.DIRECT_URL
}
