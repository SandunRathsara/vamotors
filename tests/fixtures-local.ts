import { test as base } from "@playwright/test"
import { fixture } from "./security/cycle-edits-fixture"

type LocalApp = Awaited<ReturnType<typeof fixture>>

export const test = base.extend<object, { local: LocalApp }>({
  local: [
    async ({}, provide) => {
      const root = process.env.VAMOTORS_LOCAL_DIR
      if (!root)
        throw Error(
          "Set VAMOTORS_LOCAL_DIR to an isolated pnpm local:setup directory"
        )
      const app = await fixture(root, process.cwd(), 60_000)
      try {
        await app.start()
        await provide(app)
      } finally {
        await app.close()
      }
    },
    { scope: "worker" },
  ],
})
export { expect } from "@playwright/test"
