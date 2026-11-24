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
      [
        "P2034",
        "40001",
        "40P01",
        "55P03",
        "P2002",
        "23505",
        "P2003",
        "23503",
        "P2004",
        "23514",
        "23502",
        "P2028",
        "57014",
      ].includes(code ?? "")
    )
      return code
  return (
    sqlCode(e.meta, depth + 1) ??
    sqlCode(e.driverAdapterError, depth + 1) ??
    sqlCode(e.cause, depth + 1)
  )
}
export function isDbConstraintError(error: unknown) {
  const code = sqlCode(error)
  return (
    !!code &&
    ["P2002", "23505", "P2003", "23503", "P2004", "23514", "23502"].includes(
      code
    )
  )
}
export async function transaction<T>(
  run: (tx: Tx) => Promise<T>,
  existingTx?: Tx,
  attempts = 3
) {
  if (existingTx) {
    // A PostgreSQL savepoint gives each domain command a separate write XID.
    // Its guards run before the next command changes the source graph.
    await existingTx.$executeRawUnsafe("SAVEPOINT import_command")
    await existingTx.$executeRawUnsafe(
      'UPDATE vamotors."ImportCommandAnchor" SET id=id'
    )
    await existingTx.$executeRawUnsafe(
      "SET LOCAL vamotors.import_command = 'on'"
    )
    const result = await run(existingTx)
    await existingTx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE")
    await existingTx.$executeRawUnsafe("SET CONSTRAINTS ALL DEFERRED")
    await existingTx.$executeRawUnsafe("RELEASE SAVEPOINT import_command")
    await existingTx.$executeRawUnsafe(
      "SET LOCAL vamotors.import_command = 'off'"
    )
    return result
  }
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await database().$transaction(
        async (tx) => {
          // PgBouncer-compatible transaction-local settings, no startup GUCs.
          await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '1500ms'")
          await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '5000ms'")
          await assertEnvironment(tx, true)
          const result = await run(tx)
          // Validate the final graph inside the callback. The pinned Prisma 6
          // client engine retains a pg connection when a deferred COMMIT fails;
          // callback failure takes its working rollback/release path instead.
          await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE")
          return result
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: attempts === 1 ? 1000 : 2000,
          timeout: attempts === 1 ? 6000 : 7000,
        }
      )
    } catch (error) {
      const code = sqlCode(error)
      if (["P2034", "40001", "40P01"].includes(code ?? "")) {
        if (attempt === attempts - 1)
          throw new CommandError("RETRYABLE_TRANSACTION", 503, true)
        await new Promise((resolve) =>
          setTimeout(resolve, 20 + Math.random() * 40)
        )
        continue
      }
      if (attempts === 1 && (code === "P2028" || code === "57014"))
        throw new CommandError(
          "RETRYABLE_TRANSACTION",
          503,
          true,
          undefined,
          "Import timed out. Retry this request or split the batch."
        )
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
