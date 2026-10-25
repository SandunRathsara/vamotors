import { z } from "zod"
import { fail } from "./errors"

export function runtimeConfig(
  env: Record<string, string | undefined> = process.env
) {
  const result = z
    .object({
      APP_ENV: z.enum(["local", "disposable-test", "shared-dev", "preview"]),
      ENVIRONMENT_ID: z.string().uuid(),
      DATABASE_URL: z.string().url(),
      APP_ORIGIN: z.string().url(),
      BETTER_AUTH_URL: z.string().url(),
      BETTER_AUTH_SECRET: z.string().min(32),
    })
    .safeParse(env)
  if (
    !result.success ||
    env.DIRECT_URL ||
    Object.keys(env).some((key) => key.startsWith("BOOTSTRAP_"))
  )
    fail("ENVIRONMENT_UNAVAILABLE", 503)
  const config = result.data
  const dbURL = new URL(config.DATABASE_URL)
  const origin = new URL(config.APP_ORIGIN)
  if (
    decodeURIComponent(dbURL.username) !== "vamotors_runtime" ||
    dbURL.searchParams.has("options") ||
    !["require", "verify-full"].includes(
      dbURL.searchParams.get("sslmode") ?? ""
    ) ||
    config.APP_ORIGIN !== origin.origin ||
    config.BETTER_AUTH_URL !== config.APP_ORIGIN ||
    (origin.protocol !== "https:" &&
      !(
        ["local", "disposable-test"].includes(config.APP_ENV) &&
        ["localhost", "127.0.0.1"].includes(origin.hostname)
      ))
  )
    fail("ENVIRONMENT_UNAVAILABLE", 503)
  return config
}
