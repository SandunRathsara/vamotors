/** Test-only IO barriers around the REAL adapter, REAL session and restricted DB.
 * No production hook, alternate validator, forged identity or HTTP bypass route. */
import { authenticate } from "../../lib/server/actor"
import {
  completeUpload,
  privateStorage,
  closeImportStorage,
} from "../../lib/server/attachments"
import { database } from "../../lib/server/db"
import { CommandError } from "../../lib/server/errors"
import type { PrivateFiles } from "../../lib/server/private-files"
const timeout = setTimeout(() => process.exit(75), 45000)
const input = await new Promise<{
  cookie: string
  body: unknown
  mode: "validated" | "final" | "validating"
}>((resolve) => process.once("message", resolve))
const barrier = async () => {
  process.send?.({ phase: "barrier" })
  await new Promise<void>((resolve) => process.once("message", () => resolve()))
}
try {
  const store = await privateStorage()
  const wrapped: PrivateFiles = {
    ...store,
    async validateStage(...args) {
      if (input.mode === "validating") await barrier()
      const token = await store.validateStage(...args)
      if (input.mode === "validated") await barrier()
      return token
    },
    async finalize(...args) {
      const result = await store.finalize(...args)
      if (input.mode === "final") await barrier()
      return result
    },
  }
  ;(
    globalThis as unknown as { importPrivateStore: Promise<PrivateFiles> }
  ).importPrivateStore = Promise.resolve(wrapped)
  const identity = await authenticate(new Headers({ cookie: input.cookie }))
  const result = await completeUpload(identity, input.body)
  process.send?.({ phase: "result", status: 200, result })
} catch (error) {
  process.send?.({
    phase: "result",
    status: error instanceof CommandError ? error.status : 500,
    code: error instanceof CommandError ? error.code : "INTERNAL_ERROR",
  })
} finally {
  clearTimeout(timeout)
  await closeImportStorage()
  await database().$disconnect()
  process.disconnect?.()
}
