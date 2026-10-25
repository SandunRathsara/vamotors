import "server-only"
import { betterAuth } from "better-auth"
import { prismaAdapter } from "better-auth/adapters/prisma"
import { APIError } from "better-auth/api"
import { authOptions } from "./auth-options"
import { database, assertEnvironment } from "./db"
import { runtimeConfig } from "./config"

let instance: ReturnType<typeof makeAuth> | undefined
function makeAuth() {
  const config = runtimeConfig()
  const db = database()
  return betterAuth({
    ...authOptions,
    database: prismaAdapter(db, { provider: "postgresql", transaction: true }),
    secret: config.BETTER_AUTH_SECRET,
    baseURL: config.BETTER_AUTH_URL,
    trustedOrigins: [config.APP_ORIGIN],
    rateLimit: { enabled: true },
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            await assertEnvironment(db, true)
            const user = await db.user.findUnique({
              where: { id: session.userId },
            })
            if (!user?.active)
              throw new APIError("FORBIDDEN", { message: "ACCOUNT_INACTIVE" })
            return { data: session }
          },
        },
      },
    },
  })
}
export function authentication() {
  return (instance ??= makeAuth())
}
