import { readFile, stat } from "node:fs/promises"
import { parseEnv } from "node:util"
import { databaseURL } from "../lib/server/database-url"

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
  const url = databaseURL(env.DIRECT_URL, "vamotors_migrator")
  if (
    !url ||
    url.hostname !== env.T03_DISPOSABLE_HOST ||
    decodeURI(url.pathname.slice(1)) !== env.T03_DISPOSABLE_DATABASE
  )
    throw new Error("MIGRATOR_TARGET_MISMATCH")
  return env.DIRECT_URL
}
