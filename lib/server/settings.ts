import "server-only"
import type { Tx } from "./db"
import type { Actor } from "./actor"
import { settingsInput } from "./validators"
import { project } from "./permissions"
import { fail } from "./errors"

/** A missing/corrupt singleton is an operational failure, never default policy. */
export async function currentSettings(tx: Tx) {
  const row = await tx.settings.findUnique({
    where: { singleton: 1 },
    include: { currentVersion: true },
  })
  if (!row) fail("ENVIRONMENT_UNAVAILABLE", 503)
  const parsed = settingsInput.safeParse(row.currentVersion.values)
  if (!parsed.success) fail("INTERNAL_ERROR", 500)
  return {
    ...parsed.data,
    id: row.id,
    revision: row.revision,
    policyVersion: row.currentVersion.version,
  }
}

export async function settingsQuery(
  tx: Tx,
  actor: Actor,
  args: Record<string, string>
) {
  if (Object.keys(args).length) fail("INVALID_INPUT", 422)
  return project(actor.ability, "Settings", await currentSettings(tx))
}
