import "server-only"
import { betterAuth } from "better-auth"
import { prismaAdapter } from "better-auth/adapters/prisma"
import { APIError } from "better-auth/api"
import { authOptions } from "./auth-options"
import { authCall, authFailure } from "./auth-failures"
import { database, assertEnvironment } from "./db"
import { runtimeConfig } from "./config"

let instance: ReturnType<typeof makeAuth> | undefined
function makeAuth() {
  const config = runtimeConfig()
  const db = database()
  // Better Auth can swallow adapter failures without invoking either logger.
  // Observe only auth queries, before that loss; the original stays unlogged.
  const authDb = db.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          try {
            return await query(args)
          } catch (error) {
            authFailure()
            throw error
          }
        },
      },
    },
  })
  const auth = betterAuth({
    ...authOptions,
    database: prismaAdapter(authDb, {
      provider: "postgresql",
      transaction: true,
    }),
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
  const handler = auth.handler
  auth.handler = (request) => authCall("http", () => handler(request))
  const getSession = auth.api.getSession
  auth.api.getSession = Object.assign(
    (options: Parameters<typeof getSession>[0]) =>
      authCall("session", () => getSession(options)),
    getSession
  ) as typeof getSession
  return auth
}
export function authentication() {
  return (instance ??= makeAuth())
}
