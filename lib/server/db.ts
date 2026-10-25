import "server-only"
import { PrismaClient, type Prisma } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { runtimeConfig } from "./config"
import { fail } from "./errors"

export type Tx = Prisma.TransactionClient
export function createDatabase(connectionString: string) {
  return new PrismaClient({
    adapter: new PrismaPg(
      {
        connectionString,
        max: 4,
        connectionTimeoutMillis: 10000,
        idleTimeoutMillis: 10000,
      },
      { schema: "vamotors" }
    ),
  })
}
const globalDB = globalThis as unknown as { securityDatabase?: PrismaClient }
export function database() {
  const config = runtimeConfig()
  return (globalDB.securityDatabase ??= createDatabase(config.DATABASE_URL))
}
export async function assertEnvironment(tx: Tx, writing = false) {
  const config = runtimeConfig()
  const environment = await tx.environment.findUnique({
    where: { singleton: 1 },
    select: {
      singleton: true,
      id: true,
      name: true,
      allowBusinessWrites: true,
      disposableTest: true,
      bootstrappedAt: true,
    },
  })
  if (
    !environment ||
    environment.id !== config.ENVIRONMENT_ID ||
    environment.name !== config.APP_ENV ||
    !environment.bootstrappedAt ||
    (config.APP_ENV === "disposable-test" && !environment.disposableTest) ||
    (writing &&
      (!environment.allowBusinessWrites || config.APP_ENV === "preview"))
  )
    fail("ENVIRONMENT_UNAVAILABLE", 503)
  return environment
}
