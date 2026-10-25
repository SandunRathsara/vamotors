import "server-only"
import { Prisma } from "@prisma/client"
import { database, assertEnvironment, type Tx } from "./db"
import { CommandError } from "./errors"

function sqlCode(error: unknown, depth = 0): string | undefined {
  if (!error || typeof error !== "object" || depth > 8) return
  const e = error as {
    code?: string
    originalCode?: string
    meta?: unknown
    driverAdapterError?: unknown
    cause?: unknown
  }
  // P2010's code/meta.code can be P2010/N/A. The pinned adapter preserves
  // PostgreSQL SQLSTATE at meta.driverAdapterError.cause.originalCode.
  for (const code of [e.originalCode, e.code])
    if (
      ["P2034", "40001", "40P01", "55P03", "P2002", "23505"].includes(
        code ?? ""
      )
    )
      return code
  return (
    sqlCode(e.meta, depth + 1) ??
    sqlCode(e.driverAdapterError, depth + 1) ??
    sqlCode(e.cause, depth + 1)
  )
}
export async function transaction<T>(run: (tx: Tx) => Promise<T>) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await database().$transaction(
        async (tx) => {
          // PgBouncer-compatible transaction-local settings, no startup GUCs.
          await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '1500ms'")
          await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '5000ms'")
          await assertEnvironment(tx, true)
          return run(tx)
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 2000,
          timeout: 7000,
        }
      )
    } catch (error) {
      const code = sqlCode(error)
      if (["P2034", "40001", "40P01"].includes(code ?? "")) {
        if (attempt === 2)
          throw new CommandError("RETRYABLE_TRANSACTION", 503, true)
        await new Promise((resolve) =>
          setTimeout(resolve, 20 + Math.random() * 40)
        )
        continue
      }
      if (code === "55P03")
        throw new CommandError("COMMAND_IN_PROGRESS", 409, true)
      if (code === "P2002" || code === "23505")
        throw new CommandError("IDENTITY_CONFLICT", 409)
      throw error
    }
  }
  throw new CommandError("RETRYABLE_TRANSACTION", 503, true)
}

/** Acquire BEFORE auth/record locks for future report-affecting commands. */
export async function nextBusinessSequence(tx: Tx) {
  // ponytail: global committed-prefix lock; replace only after measured contention.
  const [row] = await tx.$queryRaw<
    { value: bigint }[]
  >`SELECT value FROM vamotors."BusinessSequence" WHERE id = 1 FOR UPDATE`
  if (!row || row.value >= 9223372036854775807n)
    throw new CommandError("MONEY_OVERFLOW", 422)
  const updated = await tx.businessSequence.update({
    where: { id: 1 },
    data: { value: { increment: 1 } },
  })
  return updated.value
}
