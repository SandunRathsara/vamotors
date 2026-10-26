import "server-only"
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { authenticate, actorDTO, currentActor } from "./actor"
import { assertEnvironment, database } from "./db"
import { CommandError } from "./errors"
import { requireAdministrator } from "./admin"

// No React/cache wrapper: every page/RSC entry rechecks the live session/grants.
export async function pageActor(administrator = false) {
  try {
    const identity = await authenticate(await headers())
    return await database().$transaction(async (tx) => {
      await assertEnvironment(tx)
      const actor = await currentActor(tx, identity)
      if (administrator) requireAdministrator(actor)
      return { actor: actorDTO(actor), administrator: actor.administrator }
    })
  } catch (error) {
    if (error instanceof CommandError) {
      if (error.status === 401) redirect("/login")
      if (error.status === 403)
        redirect(
          error.code === "ACCOUNT_INACTIVE"
            ? "/login?reason=inactive"
            : "/login?reason=forbidden"
        )
    }
    throw error
  }
}

export async function UnavailablePage() {
  await pageActor()
  return (
    <section className="space-y-3 rounded-lg border p-6">
      <h1 className="text-xl font-semibold">Unavailable</h1>
      <p className="text-muted-foreground">
        This domain is pending real implementation. No demonstration records or
        actions are available.
      </p>
    </section>
  )
}
