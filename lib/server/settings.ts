import "server-only"
import { randomUUID } from "node:crypto"
import type { Prisma } from "@prisma/client"
import { database, assertEnvironment, type Tx } from "./db"
import { currentActor, type Actor, type Identity } from "./actor"
import { settingsInput, settingsEnvelope } from "./validators"
import { project, requireFields, fieldsFor } from "./permissions"
import { fail, CommandError } from "./errors"
import { transaction, nextBusinessSequence } from "./transactions"
import { canonical, inputDigest } from "./idempotency"
import { writeReadVersion } from "./audit"
import { runtimeConfig } from "./config"
import type { Applied } from "../../.planning/implementation/contracts/api"

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

const atPath = (row: unknown, path: string): unknown =>
  path
    .split(".")
    .reduce<unknown>(
      (value, key) =>
        value && typeof value === "object"
          ? (value as Record<string, unknown>)[key]
          : undefined,
      row
    )

/** Full replacement, but authority is over the exact changed leaf fields only.
 * Unread values are never sourced from the client for authorization. */
export async function executeSettings(
  identity: Identity,
  raw: unknown
): Promise<Applied> {
  await database().$transaction(async (tx) => {
    await assertEnvironment(tx)
    await currentActor(tx, identity)
  })
  const parsed = settingsEnvelope.safeParse(raw)
  if (!parsed.success) fail("INVALID_INPUT", 422)
  const envelope = parsed.data
  const { reason, ...values } = envelope.input
  const config = runtimeConfig()
  const digest = inputDigest(envelope, config.BETTER_AUTH_SECRET)
  return transaction(async (tx) => {
    await tx.$queryRaw`SELECT value FROM vamotors."BusinessSequence" WHERE id=1 FOR UPDATE`
    await tx.$queryRaw`SELECT vamotors.lock_admin_guard()`
    const actor = await currentActor(tx, identity)
    const before = await currentSettings(tx)
    requireFields(actor.ability, "Settings", "read", before, ["id", "revision"])
    const scope = {
      environmentId: config.ENVIRONMENT_ID,
      actorKey: `USER:${actor.userId}`,
      commandName: "updateSettings",
      idempotencyKey: envelope.idempotencyKey,
    }
    const prior = await tx.commandReceipt.findUnique({
      where: { environmentId_actorKey_commandName_idempotencyKey: scope },
    })
    const paths = fieldsFor("Settings", "update").filter((f) => f !== "company")
    const changed = paths.filter(
      (path) =>
        canonical(atPath(before, path)) !== canonical(atPath(values, path))
    )
    requireFields(
      actor.ability,
      "Settings",
      "update",
      before,
      prior ? [] : changed
    )
    if (prior) {
      const result = prior.result as {
        type: string
        id: string
        revision: number
      }
      if (
        result.type !== "Settings" ||
        result.id !== before.id ||
        !Number.isInteger(result.revision)
      )
        fail("IDEMPOTENCY_MISMATCH")
      const original = await tx.auditEntry.findFirst({
        where: {
          commandId: prior.id,
          entityType: "Settings",
          entityId: before.id,
        },
      })
      if (!original) fail("INTERNAL_ERROR", 500)
      requireFields(
        actor.ability,
        "Settings",
        "update",
        before,
        Object.keys(original.fieldDiff as object)
      )
      if (prior.inputHash !== digest) fail("IDEMPOTENCY_MISMATCH")
      return {
        ok: true,
        status: "APPLIED",
        commandId: prior.id,
        replayed: true,
        result: { ...result, type: "Settings" as const },
        affected: [
          { type: "Settings", id: before.id, revision: before.revision },
        ],
        invalidate: ["settings", "parties", "finance"],
      }
    }
    const ref = envelope.expected.find(
      (r) => r.type === "Settings" && r.id === before.id
    )
    if (!ref) fail("REVISION_REQUIRED", 428)
    if (ref.revision !== before.revision)
      throw new CommandError("STALE_REVISION", 409, false, [
        { type: "Settings", id: before.id, revision: before.revision },
      ])
    if (before.revision === 2147483647 || before.policyVersion === 2147483647)
      fail("REVISION_EXHAUSTED")
    if (values.currency !== before.currency || values.scale !== before.scale) {
      // All currently implemented business roots, including pre-Settings purchases.
      const [row] = await tx.$queryRaw<{ frozen: boolean }[]>`SELECT
        EXISTS(SELECT 1 FROM vamotors."PurchaseRecord") OR
        EXISTS(SELECT id FROM vamotors."Vehicle") OR
        EXISTS(SELECT 1 FROM vamotors."Customer") OR
        EXISTS(SELECT 1 FROM vamotors."Supplier") OR
        EXISTS(SELECT 1 FROM vamotors."RepairVendor") OR
        EXISTS(SELECT 1 FROM vamotors."FinanceCompany") AS frozen`
      if (row.frozen) fail("IMMUTABLE_CURRENCY", 409)
    }
    const sequence = await nextBusinessSequence(tx)
    const version = await tx.settingsVersion.create({
      data: { version: before.policyVersion + 1, values },
    })
    const saved = await tx.settings.update({
      where: { id: before.id, revision: before.revision },
      data: { currentVersionId: version.id, revision: { increment: 1 } },
    })
    const after = {
      ...values,
      id: saved.id,
      revision: saved.revision,
      policyVersion: version.version,
    }
    const commandId = randomUUID()
    const result = {
      type: "Settings" as const,
      id: saved.id,
      revision: saved.revision,
    }
    await tx.commandReceipt.create({
      data: {
        id: commandId,
        ...scope,
        inputHash: digest,
        result,
        businessSequence: sequence,
      },
    })
    await tx.auditEntry.create({
      data: {
        commandId,
        userId: actor.userId,
        actorKind: "USER",
        entityType: "Settings",
        entityId: saved.id,
        action: "update",
        reason,
        fieldDiff: Object.fromEntries(
          changed.map((path) => [
            path,
            { before: atPath(before, path), after: atPath(after, path) },
          ])
        ) as Prisma.InputJsonObject,
      },
    })
    await writeReadVersion(tx, {
      commandId,
      sequence,
      entityType: "Settings",
      entityId: saved.id,
      revision: saved.revision,
      payload: after,
    })
    return {
      ok: true,
      status: "APPLIED",
      commandId,
      replayed: false,
      result,
      affected: [result],
      invalidate: ["settings", "parties", "finance"],
    }
  })
}
