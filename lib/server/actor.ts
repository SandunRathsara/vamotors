import "server-only"
import { createHash } from "node:crypto"
import type { Grant } from "../../.planning/implementation/contracts/api"
import { authentication } from "./auth"
import { assertEnvironment, database, type Tx } from "./db"
import { abilityFor, grantSchema } from "./permissions"
import { fail } from "./errors"

const trusted = Symbol("server identity")
export type Identity = {
  readonly sessionId: string
  readonly userId: string
  readonly [trusted]: true
}
export async function authenticate(headers: Headers): Promise<Identity> {
  await assertEnvironment(database())
  const session = await authentication().api.getSession({
    headers,
    query: { disableCookieCache: true },
  })
  if (!session) fail("UNAUTHENTICATED", 401)
  return {
    sessionId: session.session.id,
    userId: session.user.id,
    [trusted]: true,
  }
}
export async function currentActor(tx: Tx, identity: Identity) {
  if (identity[trusted] !== true) fail("UNAUTHENTICATED", 401)
  const session = await tx.session.findUnique({
    where: { id: identity.sessionId },
  })
  if (
    !session ||
    session.userId !== identity.userId ||
    session.expiresAt <= new Date()
  )
    fail("UNAUTHENTICATED", 401)
  const user = await tx.user.findUnique({
    where: { id: identity.userId },
    include: {
      roles: {
        include: {
          role: { include: { permissions: { include: { permission: true } } } },
        },
      },
    },
  })
  if (!user) fail("UNAUTHENTICATED", 401)
  if (!user.active) fail("ACCOUNT_INACTIVE", 403)
  const roles = user.roles
    .map((m) => m.role)
    .filter((r) => r.active)
    .sort((a, b) => a.id.localeCompare(b.id))
  const grants = roles.flatMap((r) =>
    r.permissions.map((p) => grantSchema.parse(p.permission.rule) as Grant)
  )
  const authzRevision = createHash("sha256")
    .update(
      JSON.stringify([
        user.id,
        user.active,
        user.authzRevision,
        roles.map((r) => [
          r.id,
          r.revision,
          r.permissions.map((p) => p.permission.ruleHash).sort(),
        ]),
      ])
    )
    .digest("hex")
  return {
    kind: "USER" as const,
    userId: user.id,
    sessionId: session.id,
    user,
    roles,
    grants,
    ability: abilityFor(grants, user.id),
    authzRevision,
    administrator: roles.some((r) => r.systemKey === "ADMINISTRATOR"),
  }
}
export type Actor = Awaited<ReturnType<typeof currentActor>>
export function actorDTO(actor: Actor) {
  return {
    user: { id: actor.userId, name: actor.user.name, active: true as const },
    roles: actor.roles.map((r) => ({
      id: r.id,
      name: r.name,
      revision: r.revision,
    })),
    authzRevision: actor.authzRevision,
    presentationGrants: actor.grants,
    registryVersion: 1,
    serverTime: new Date().toISOString(),
  }
}
