// Offline CLI input only. No URL, secret, or live client; generate never connects.
import { betterAuth } from "better-auth"
import { prismaAdapter } from "better-auth/adapters/prisma"
import { authOptions } from "../lib/server/auth-options"

export const auth = betterAuth({
  ...authOptions,
  database: prismaAdapter({}, { provider: "postgresql", transaction: true }),
})
